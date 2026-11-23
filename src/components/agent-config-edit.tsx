"use client";

// Owner-only edit and save of an agent's relay config (#195). DESIGN.md →
// "Editing agents (owner)" and "Saving". The page reads the config in the
// owner's browser (#194); this adds the edit state that the hero buttons,
// the Agent settings card and the unsaved bar share. A save signs a new
// revision with the owner's extension and posts it straight to the relay,
// so instructions never pass through the dashboard server.

import {
  CircleCheck,
  Info,
  Pencil,
  RefreshCw,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type AgentConfig,
  type AgentSettingsValues,
  type ConfigEvent,
  readAgentConfig,
  readFailure,
} from "@/lib/agent-config";
import {
  type Choices,
  changedLabels,
  changeNote,
  editableType,
  type LineDiff,
  lineDiffBlock,
  nextInstructionsContent,
  nextSettingsContent,
  pruneEdits,
  refusalOf,
  refusalText,
  revertSettingsContent,
  revisionTemplate,
  type SettingsDraft,
  settingsLines,
} from "@/lib/agent-config-edit";
import { configRead, configWrite, nostrExtension } from "@/lib/nostr-browser";

/** What the browser needs to read the relay config; null when it can't. */
export type RelayConfigTarget = {
  /** The relay's HTTP origin. */
  relay: string;
  /** The relay's own key (NIP-11 `self`): it signs channel metadata. */
  relaySelf: string;
  /** The agent's current pubkey. */
  agent: string;
  /**
   * The hive owner's key (the first admin), whose key alone is a member of
   * each agent's config channel. Null when sign-in doesn't name one.
   */
  owner: string | null;
  /** Models this hive already runs (status feed), offered in Model. */
  models: string[];
};

export type ConfigRead =
  | { state: "idle" }
  | { state: "reading" }
  | { state: "read"; config: AgentConfig }
  | { state: "failed"; why: string };

/** Who the browser's signer is on this hive. */
export type SignerRole =
  /** The hive owner: may read and edit. */
  | "owner"
  /** Another admin: Edit disabled, no read. */
  | "admin"
  /** No signer yet, or no owner named. */
  | "unknown";

/** A save to review: the new content per artifact that changes. */
type Pending = {
  kind: "edit" | "revert";
  settings: string | null;
  instructions: string | null;
  problem: string | null;
};

/** The revisions the last save replaced, for "Revert to N". */
type Prior = {
  settings: ConfigEvent | null;
  instructions: ConfigEvent | null;
  revision: number | null;
};

type Ctx = {
  name: string;
  read: ConfigRead;
  role: SignerRole;
  /** The settings and instructions heads are readable and editable. */
  canEdit: boolean;
  editing: boolean;
  edits: SettingsDraft;
  instructions: string | null;
  choices: Choices;
  base: { settings: AgentSettingsValues | null; instructions: string | null };
  changed: string[];
  prior: Prior | null;
  startEdit: () => void;
  cancelEdit: () => void;
  setEdit: (key: keyof SettingsDraft, value: string) => void;
  setInstructions: (text: string) => void;
  openReview: () => void;
  openRevert: () => void;
};

const AgentConfigContext = createContext<Ctx | null>(null);

/** The edit state, or null outside the provider (viewers). */
export const useAgentConfig = () => useContext(AgentConfigContext);

const settingsOf = (c: AgentConfig | null) =>
  c?.settings.state === "ok" ? c.settings.value : null;
const instructionsOf = (c: AgentConfig | null) =>
  c?.instructions.state === "ok" ? c.instructions.value : null;

export function AgentConfigProvider({
  name,
  target,
  children,
}: {
  name: string;
  target: RelayConfigTarget | null;
  children: ReactNode;
}) {
  const [read, setRead] = useState<ConfigRead>({ state: "idle" });
  const [role, setRole] = useState<SignerRole>("unknown");
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<SettingsDraft>({});
  const [instructions, setInstr] = useState<string | null>(null);
  const [review, setReview] = useState<"edit" | "revert" | null>(null);
  const [prior, setPrior] = useState<Prior | null>(null);
  const relay = target?.relay;
  const relaySelf = target?.relaySelf;
  const agent = target?.agent;
  const owner = target?.owner ?? null;

  const load = useCallback(async (): Promise<AgentConfig | null> => {
    const n = nostrExtension();
    if (!relay || !relaySelf || !agent || !n) return null;
    let signer: string;
    try {
      signer = await n.getPublicKey();
    } catch {
      setRead({ state: "failed", why: "Your signer didn't answer." });
      return null;
    }
    // Only the owner's key is in the config channel. Another admin can't
    // read it, so the card shows the status feed without asking the relay.
    if (owner && signer !== owner) {
      setRole("admin");
      setRead({ state: "idle" });
      return null;
    }
    setRole(owner ? "owner" : "unknown");
    setRead((r) => (r.state === "read" ? r : { state: "reading" }));
    try {
      const config = await readAgentConfig(
        (path, f) => configRead(n, relay, path, f),
        { relaySelf, owner: signer, agent },
      );
      setRead({ state: "read", config });
      // A key that reads the channel is the owner's, even unnamed.
      setRole("owner");
      return config;
    } catch (err) {
      setRead({ state: "failed", why: readFailure(err) });
      return null;
    }
  }, [relay, relaySelf, agent, owner]);

  useEffect(() => {
    load();
  }, [load]);

  const config = read.state === "read" ? read.config : null;
  const settings = settingsOf(config);
  const baseInstructions = instructionsOf(config);
  const canEdit =
    role === "owner" &&
    settings !== null &&
    baseInstructions !== null &&
    editableType(settings.agentType);

  const choices = useMemo<Choices>(() => {
    const model = new Set(target?.models ?? []);
    if (settings?.model) model.add(settings.model);
    const effort = new Set<string>();
    if (settings?.effort) effort.add(settings.effort);
    return { model: [...model].sort(), effort: [...effort] };
  }, [target?.models, settings?.model, settings?.effort]);

  const base = useMemo(
    () => ({ settings, instructions: baseInstructions }),
    [settings, baseInstructions],
  );
  const baseDraft = useMemo<SettingsDraft>(
    () => ({
      model: settings?.model ?? "",
      provider: settings?.provider ?? "",
      effort: settings?.effort ?? "",
      scope: settings?.scope ?? "",
    }),
    [settings],
  );
  const liveEdits = pruneEdits(baseDraft, edits);
  const instructionsChanged =
    instructions !== null && instructions !== baseInstructions;
  const changed = editing ? changedLabels(liveEdits, instructionsChanged) : [];

  const reset = () => {
    setEdits({});
    setInstr(null);
  };

  const ctx: Ctx = {
    name,
    read,
    role,
    canEdit,
    editing,
    edits: liveEdits,
    instructions: instructionsChanged ? instructions : null,
    choices,
    base,
    changed,
    prior,
    startEdit: () => canEdit && setEditing(true),
    cancelEdit: () => {
      reset();
      setEditing(false);
    },
    setEdit: (key, value) => setEdits((e) => ({ ...e, [key]: value })),
    setInstructions: setInstr,
    openReview: () => changed.length > 0 && setReview("edit"),
    openRevert: () => prior && setReview("revert"),
  };

  const pending = useMemo<Pending | null>(() => {
    if (!review || !config) return null;
    const s = config.settings;
    const i = config.instructions;
    if (s.state === "missing" || i.state === "missing") return null;
    if (review === "revert") {
      if (!prior) return null;
      let problem: string | null = null;
      let settingsContent: string | null = null;
      if (prior.settings && prior.settings.content !== s.event.content) {
        const r = revertSettingsContent(prior.settings);
        if ("problem" in r) problem = r.problem;
        else settingsContent = r.content;
      }
      const instructionsContent =
        prior.instructions && prior.instructions.content !== i.event.content
          ? prior.instructions.content
          : null;
      return {
        kind: "revert",
        settings: settingsContent,
        instructions: instructionsContent,
        problem,
      };
    }
    let problem: string | null = null;
    let settingsContent: string | null = null;
    let instructionsContent: string | null = null;
    if (Object.keys(liveEdits).length) {
      const r = nextSettingsContent(s.event, liveEdits, choices);
      if ("problem" in r) problem = r.problem;
      else settingsContent = r.content;
    }
    if (instructionsChanged && instructions !== null) {
      const r = nextInstructionsContent(i.event, instructions);
      if ("problem" in r) problem ??= r.problem;
      else instructionsContent = r.content;
    }
    return {
      kind: "edit",
      settings: settingsContent,
      instructions: instructionsContent,
      problem,
    };
  }, [
    review,
    config,
    prior,
    liveEdits,
    choices,
    instructions,
    instructionsChanged,
  ]);

  const defaultNote =
    review === "revert"
      ? `Revert to revision ${prior?.revision ?? "before"}`
      : changeNote(
          name,
          baseDraft,
          { ...baseDraft, ...liveEdits },
          instructionsChanged,
        );

  const saved = (from: AgentConfig) => {
    const revision = from.revision;
    setPrior({
      settings: from.settings.state === "missing" ? null : from.settings.event,
      instructions:
        from.instructions.state === "missing" ? null : from.instructions.event,
      revision,
    });
    reset();
    setEditing(false);
    setReview(null);
    const next = revision === null ? null : revision + 1;
    toast.success(`Saved. ${name} uses it from its next turn.`, {
      icon: <CircleCheck className="size-4 text-success" aria-hidden />,
      description: next
        ? `Revision ${next} · No restart needed`
        : "No restart needed",
      action: {
        label: (
          <span className="inline-flex items-center gap-1">
            <RotateCcw className="size-3.5" aria-hidden />
            Revert
          </span>
        ),
        onClick: () => setReview("revert"),
      },
    });
  };

  return (
    <AgentConfigContext.Provider value={ctx}>
      {children}
      <LeaveGuard dirty={changed.length > 0} />
      {target && (
        <ReviewDialog
          name={name}
          open={review !== null}
          onOpenChange={(o) => !o && setReview(null)}
          config={config}
          pending={pending}
          defaultNote={defaultNote}
          relay={target.relay}
          reload={load}
          onSaved={saved}
        />
      )}
    </AgentConfigContext.Provider>
  );
}

/** The hero row's Edit, or Cancel and Review and save while editing. */
export function AgentConfigButtons() {
  const ctx = useAgentConfig();
  if (!ctx) return null;
  if (ctx.role === "admin") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              aria-disabled
              className="h-11 cursor-not-allowed opacity-50 sm:h-9"
              onClick={(e) => e.preventDefault()}
            />
          }
        >
          <Pencil aria-hidden />
          Edit
        </TooltipTrigger>
        <TooltipContent>
          Only the owner&apos;s key can change agents on this hive.
        </TooltipContent>
      </Tooltip>
    );
  }
  if (!ctx.canEdit) return null;
  if (!ctx.editing) {
    return (
      <Button variant="outline" className="h-11 sm:h-9" onClick={ctx.startEdit}>
        <Pencil aria-hidden />
        Edit
      </Button>
    );
  }
  return (
    <>
      <Button variant="ghost" className="h-11 sm:h-9" onClick={ctx.cancelEdit}>
        Cancel
      </Button>
      <Button
        className="h-11 sm:h-9"
        disabled={ctx.changed.length === 0}
        onClick={ctx.openReview}
      >
        Review and save
      </Button>
    </>
  );
}

/** The amber "Editing" badge beside the agent's name. */
export function EditingBadge() {
  const ctx = useAgentConfig();
  if (!ctx?.editing) return null;
  return (
    <Badge
      variant="outline"
      className="border-warning/40 bg-warning/10 text-warning"
    >
      <Pencil aria-hidden />
      Editing
    </Badge>
  );
}

/** The sticky bar under the main column while there are changes. */
export function UnsavedBar() {
  const ctx = useAgentConfig();
  if (!ctx || ctx.changed.length === 0) return null;
  const n = ctx.changed.length;
  return (
    <div className="sticky bottom-2.5 z-20 flex items-center gap-3 rounded-lg border bg-card px-4 py-2 shadow-lg sm:bottom-4">
      <span className="size-2 shrink-0 rounded-full bg-warning" aria-hidden />
      <p className="min-w-0 flex-1 truncate text-sm" aria-live="polite">
        {n} unsaved change{n === 1 ? "" : "s"}
        <span className="text-muted-foreground max-sm:hidden">
          {" "}
          · {ctx.changed.join(", ")}
        </span>
      </p>
      <Button variant="ghost" className="h-11 sm:h-9" onClick={ctx.cancelEdit}>
        Discard
      </Button>
      <Button className="h-11 sm:h-9" onClick={ctx.openReview}>
        Review and save
      </Button>
    </div>
  );
}

/**
 * Asks before leaving with unsaved changes: the browser's own prompt for a
 * reload or closed tab, and an AlertDialog for a link inside the dashboard.
 */
function LeaveGuard({ dirty }: { dirty: boolean }) {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => e.preventDefault();
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement) || a.target === "_blank") return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      setHref(url.href);
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, [dirty]);
  return (
    <AlertDialog open={href !== null} onOpenChange={(o) => !o && setHref(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
          <AlertDialogDescription>
            Your changes to this agent&apos;s settings aren&apos;t saved yet.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              // A full load: the guard is gone once we navigate.
              if (href) location.assign(href);
            }}
          >
            Leave
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type Failure = { text: string; conflict: boolean };

function ReviewDialog({
  name,
  open,
  onOpenChange,
  config,
  pending,
  defaultNote,
  relay,
  reload,
  onSaved,
}: {
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: AgentConfig | null;
  pending: Pending | null;
  defaultNote: string;
  relay: string;
  reload: () => Promise<AgentConfig | null>;
  onSaved: (replaced: AgentConfig) => void;
}) {
  const [note, setNote] = useState(defaultNote);
  const noteId = useId();
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState<"saving" | "reloading" | null>(null);
  // A fresh note and no old failure each time it opens. Only on open: the
  // note stays as typed while the diff refreshes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on open only.
  useEffect(() => {
    if (open) {
      setNote(defaultNote);
      setFailure(null);
    }
  }, [open]);

  const s = config?.settings;
  const i = config?.instructions;
  const blocks: { title: string; right: string; lines: LineDiff[] }[] = [];
  if (pending?.settings && s && s.state !== "missing") {
    const rev = config?.revision;
    blocks.push({
      title: "settings",
      right: rev ? `revision ${rev} → ${rev + 1}` : "new revision",
      lines: lineDiffBlock(
        settingsLines(s.event.content),
        settingsLines(pending.settings),
      ),
    });
  }
  if (pending?.instructions && i && i.state !== "missing") {
    const lines = lineDiffBlock(
      instructionsText(i.event.content),
      instructionsText(pending.instructions),
    );
    const n = lines.filter((l) => l.op !== " ").length;
    blocks.push({
      title: "instructions",
      right: `${n} line${n === 1 ? "" : "s"}`,
      lines,
    });
  }
  const nothing = pending !== null && !pending.problem && blocks.length === 0;

  const save = async () => {
    const n = nostrExtension();
    if (!n || !config || !pending || pending.problem) return;
    setBusy("saving");
    setFailure(null);
    try {
      const writes: [ConfigEvent, string][] = [];
      if (pending.settings && s && s.state !== "missing")
        writes.push([s.event, pending.settings]);
      if (pending.instructions && i && i.state !== "missing")
        writes.push([i.event, pending.instructions]);
      let wrote = 0;
      for (const [head, content] of writes) {
        const answer = await configWrite(
          n,
          relay,
          revisionTemplate(head, content, { note }),
        );
        if (!answer.ok) {
          setFailure({
            text:
              wrote > 0
                ? `${refusalText(name, answer.message)} The settings part was saved.`
                : refusalText(name, answer.message),
            conflict: refusalOf(answer.message) === "conflict",
          });
          // Half saved: read the new head so the next try builds on it.
          if (wrote > 0) await reload();
          return;
        }
        wrote++;
      }
      await reload();
      onSaved(config);
    } catch (err) {
      setFailure({
        text:
          err instanceof Error && err.message
            ? `Not saved. ${err.message}`
            : "Not saved. Your edits are kept.",
        conflict: false,
      });
    } finally {
      setBusy(null);
    }
  };

  const reloadKeep = async () => {
    setBusy("reloading");
    const fresh = await reload();
    setBusy(null);
    setFailure(
      fresh
        ? null
        : { text: "Couldn't read the relay config again.", conflict: false },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[100dvh] overflow-y-auto max-sm:h-[100dvh] max-sm:max-w-full max-sm:rounded-none sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Review and save · {name}</DialogTitle>
          <DialogDescription>
            Saving signs a new revision with your key and publishes it to the
            relay.
          </DialogDescription>
        </DialogHeader>
        {failure && (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden />
            <AlertDescription className="space-y-2">
              <p>
                <strong>Not saved.</strong>{" "}
                {failure.text.replace(/^Not saved\.\s*/, "")}
              </p>
              {failure.conflict && (
                <Button
                  variant="outline"
                  className="h-11 sm:h-9"
                  disabled={busy !== null}
                  onClick={reloadKeep}
                >
                  <RefreshCw
                    aria-hidden
                    className={busy === "reloading" ? "animate-spin" : ""}
                  />
                  Reload and keep my edits
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}
        {pending?.problem && (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden />
            <AlertDescription>
              <strong>Can&apos;t save.</strong> {pending.problem}
            </AlertDescription>
          </Alert>
        )}
        {nothing && (
          <p className="text-sm text-muted-foreground">
            Nothing to save. The relay config already matches.
          </p>
        )}
        {blocks.map((b) => (
          <DiffBlock key={b.title} {...b} />
        ))}
        <div className="grid gap-1.5 text-sm">
          <label htmlFor={noteId} className="text-muted-foreground">
            Change note
          </label>
          <Input
            id={noteId}
            value={note}
            maxLength={280}
            onChange={(e) => setNote(e.target.value)}
            className="h-11 sm:h-9"
          />
        </div>
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {name} uses this from its next turn. No restart. A turn that&apos;s
          already running finishes on the old settings.
        </p>
        <DialogFooter className="max-sm:flex-col-reverse">
          <Button
            variant="ghost"
            className="h-11 sm:h-9"
            onClick={() => onOpenChange(false)}
          >
            {pending?.kind === "revert" ? "Cancel" : "Back to editing"}
          </Button>
          <Button
            className="h-11 sm:h-9"
            disabled={
              busy !== null ||
              !pending ||
              !!pending.problem ||
              nothing ||
              failure?.conflict === true
            }
            onClick={save}
          >
            {busy === "saving" ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const instructionsText = (content: string) => {
  try {
    const t = (JSON.parse(content) as { text?: unknown }).text;
    return typeof t === "string" ? t : "";
  } catch {
    return "";
  }
};

function DiffBlock({
  title,
  right,
  lines,
}: {
  title: string;
  right: string;
  lines: LineDiff[];
}) {
  return (
    <section className="overflow-hidden rounded-md border">
      <header className="flex items-center justify-between gap-3 bg-muted px-3 py-1.5 font-mono text-xs">
        <span>{title}</span>
        <span className="text-muted-foreground">{right}</span>
      </header>
      <pre className="max-h-72 overflow-auto py-1 font-mono text-xs">
        {lines.map((l, k) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed diff.
            key={k}
            className={`px-3 whitespace-pre-wrap break-all ${
              l.op === "-"
                ? "bg-destructive/10"
                : l.op === "+"
                  ? "bg-success/10"
                  : "text-muted-foreground"
            }`}
          >
            {l.op === " " ? (l.text === "…" ? "" : "  ") : `${l.op} `}
            {l.text}
          </div>
        ))}
      </pre>
    </section>
  );
}
