"use client";

import { cn } from "cn";
import {
  BookOpen,
  Check,
  CircleCheckBig,
  GitBranch,
  KeyRound,
  Lock,
  type LucideIcon,
  Pencil,
  Plug,
  Plus,
  Radio,
  RotateCcw,
  Terminal,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import { formatAge } from "@/lib/age";
import { hostError, MAX_LINK_HOSTS, PLATFORM_RE } from "@/lib/event-ingest";

// DESIGN.md → Settings → Sources → Event ingest (#199), to Arcee's mockup
// signed off by the owner on 2026-11-24: one row per platform token, a
// shown-once token, a chip editor for link hosts, and plain confirms for
// rotate and revoke.

export type PlatformRow = {
  platform: string;
  masked: string;
  linkHosts: string[];
  createdAt: string;
  lastEventAt: string | null;
};

export const INGEST_DOCS =
  "https://docs.torcato.dev/buzz-dashboard/docs/event-ingest";

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const iconFor = (platform: string): LucideIcon =>
  platform === "buzz"
    ? Radio
    : platform.startsWith("claude")
      ? Terminal
      : /github|gitlab|actions|ci$/.test(platform)
        ? GitBranch
        : Plug;

async function call(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 403) {
      return { ok: false, error: "Sign in as the owner first." };
    }
    if (!res.ok) return { ok: false, error: "That didn’t work. Try again." };
    return { ok: true, data: res.status === 204 ? null : await res.json() };
  } catch {
    return { ok: false, error: "That didn’t work. Try again." };
  }
}

export function EventIngestCard({
  endpoint,
  platforms,
  defaultHosts,
  canEdit,
  now,
}: {
  endpoint: string;
  platforms: PlatformRow[];
  /** github.com and the relay host, for a new platform. */
  defaultHosts: string[];
  canEdit: boolean;
  /** The server's clock, so "last event 4m ago" renders the same on both sides. */
  now: number;
}) {
  const router = useRouter();
  // The full token, only right after it was created or rotated.
  const [fresh, setFresh] = useState<{
    platform: string;
    token: string;
  } | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const issue = async (platform: string, linkHosts?: string[]) => {
    setBusy(true);
    setError(null);
    const r = await call("/api/sources/platforms", "POST", {
      platform,
      ...(linkHosts ? { linkHosts } : {}),
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    setFresh({ platform, token: (r.data as { token: string }).token });
    router.refresh();
    return true;
  };

  const revoke = async (platform: string) => {
    setBusy(true);
    setError(null);
    const r = await call(`/api/sources/platforms/${platform}`, "DELETE");
    setBusy(false);
    if (!r.ok) return setError(r.error);
    if (fresh?.platform === platform) setFresh(null);
    router.refresh();
  };

  const saveHosts = async (platform: string, linkHosts: string[]) => {
    setBusy(true);
    setError(null);
    const r = await call(`/api/sources/platforms/${platform}`, "PATCH", {
      linkHosts,
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setEditing(null);
    router.refresh();
  };

  // A token just created for a platform the list hasn't caught up with yet.
  const rows =
    fresh && !platforms.some((p) => p.platform === fresh.platform)
      ? [
          ...platforms,
          {
            platform: fresh.platform,
            masked: "",
            linkHosts: [],
            createdAt: new Date(now).toISOString(),
            lastEventAt: null,
          },
        ]
      : platforms;

  return (
    <div className="space-y-0">
      <div className="space-y-4 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 font-medium">
            <Plug className="size-4 text-muted-foreground" aria-hidden />
            Event ingest
          </h3>
          <Button
            className="h-9 max-md:h-11"
            disabled={!canEdit || busy}
            onClick={() => setAdding(true)}
          >
            <Plus aria-hidden />
            Add platform
          </Button>
        </div>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Endpoint · one token per platform. The platform comes from the
            token, never the request body.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2 font-mono text-[13px]">
              POST {endpoint}
            </code>
            <CopyButton value={endpoint} label="Copy endpoint" />
          </div>
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 border-t px-4 py-10 text-center">
          <span className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Plug className="size-4" aria-hidden />
          </span>
          <p className="font-medium">No platforms yet</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Add one for each place your agents run, like buzz, claude-code or
            github-actions. Each gets its own token.
          </p>
        </div>
      ) : (
        <ul className="-mx-4 divide-y border-t sm:-mx-6">
          {rows.map((p) => (
            <PlatformItem
              key={p.platform}
              row={p}
              now={now}
              fresh={fresh?.platform === p.platform ? fresh.token : null}
              onDone={() => setFresh(null)}
              editing={editing === p.platform}
              onEdit={() => setEditing(p.platform)}
              onCancelEdit={() => setEditing(null)}
              onSaveHosts={(hosts) => saveHosts(p.platform, hosts)}
              onRotate={() => issue(p.platform)}
              onRevoke={() => revoke(p.platform)}
              canEdit={canEdit}
              busy={busy}
              endpoint={endpoint}
            />
          ))}
        </ul>
      )}

      <p className="-mx-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t px-4 pt-4 text-xs text-muted-foreground sm:-mx-6 sm:px-6">
        <span className="flex items-center gap-2">
          <Lock className="size-3.5 shrink-0" aria-hidden />
          Tokens are hashed. Only the last 4 characters are kept. Rotate or
          revoke one platform without touching the others.
        </span>
        <a
          href={INGEST_DOCS}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-foreground underline underline-offset-3"
        >
          <BookOpen className="size-3.5" aria-hidden />
          Ingest API docs
        </a>
      </p>

      <AddPlatformDialog
        open={adding}
        onOpenChange={setAdding}
        taken={platforms.map((p) => p.platform)}
        defaultHosts={defaultHosts}
        busy={busy}
        onCreate={async (platform, hosts) => {
          if (await issue(platform, hosts)) setAdding(false);
        }}
      />
    </div>
  );
}

function StatusBadge({ last }: { last: string | null }) {
  return last ? (
    <span className="inline-flex items-center gap-1 rounded-md border border-success/20 bg-success/10 px-1.5 py-0.5 text-xs font-medium text-success">
      <CircleCheckBig className="size-3" aria-hidden />
      Receiving
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-md border border-warning/20 bg-warning/10 px-1.5 py-0.5 text-xs font-medium text-warning">
      <TriangleAlert className="size-3" aria-hidden />
      No events yet
    </span>
  );
}

function HostChip({ host, onRemove }: { host: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-0.5 font-mono text-xs">
      {host}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${host}`}
          className="-mr-0.5 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3" aria-hidden />
        </button>
      )}
    </span>
  );
}

function PlatformItem({
  row,
  now,
  fresh,
  onDone,
  editing,
  onEdit,
  onCancelEdit,
  onSaveHosts,
  onRotate,
  onRevoke,
  canEdit,
  busy,
  endpoint,
}: {
  row: PlatformRow;
  now: number;
  fresh: string | null;
  onDone: () => void;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveHosts: (hosts: string[]) => void;
  onRotate: () => void;
  onRevoke: () => void;
  canEdit: boolean;
  busy: boolean;
  endpoint: string;
}) {
  const Icon = iconFor(row.platform);
  const off = !canEdit || busy;
  // On a phone the actions wrap under the link hosts (mockup state 9).
  const actions = (className: string) => (
    <div className={cn("flex items-center gap-1", className)}>
      <ConfirmAction
        trigger={
          <>
            <RotateCcw aria-hidden />
            Rotate
          </>
        }
        variant="outline"
        disabled={off}
        title={`Rotate the ${row.platform} token?`}
        description={
          <>
            Anything posting as{" "}
            <code className="font-mono">{row.platform}</code> gets 401 until you
            give it the new token. The new one is shown once.
          </>
        }
        action="Rotate"
        onConfirm={onRotate}
      />
      <ConfirmAction
        trigger={
          <>
            <Trash2 aria-hidden />
            Revoke
          </>
        }
        variant="ghost"
        triggerClassName="text-destructive hover:text-destructive"
        disabled={off}
        title={`Revoke the ${row.platform} token?`}
        description={
          <>
            Anything posting as{" "}
            <code className="font-mono">{row.platform}</code> gets 401 from now
            on. Its past events stay on the timeline. The other platforms keep
            working. This can’t be undone.
          </>
        }
        action={
          <>
            <Trash2 aria-hidden />
            Revoke
          </>
        }
        onConfirm={onRevoke}
      />
    </div>
  );
  const meta = [
    // The mockup's short mask: hive_evt_••••a3f9.
    row.masked ? `hive_evt_••••${row.masked.slice(-4)}` : null,
    `created ${shortDate(row.createdAt)}`,
    row.lastEventAt &&
      `last event ${formatAge(now - new Date(row.lastEventAt).getTime())} ago`,
  ].filter(Boolean);

  return (
    <li
      className={cn(
        "flex gap-3 px-4 py-4 sm:px-6",
        fresh && "border-l-2 border-l-primary bg-primary/5",
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-medium">{row.platform}</span>
              {fresh ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-warning/20 bg-warning/10 px-1.5 py-0.5 text-xs font-medium text-warning">
                  <KeyRound className="size-3" aria-hidden />
                  New token
                </span>
              ) : (
                <StatusBadge last={row.lastEventAt} />
              )}
            </p>
            {!fresh && (
              <p className="font-mono text-xs text-muted-foreground">
                {meta.join(" · ")}
              </p>
            )}
          </div>
          {fresh ? (
            <Button
              variant="outline"
              className="h-9 max-md:h-11"
              onClick={onDone}
            >
              <Check aria-hidden />
              Done
            </Button>
          ) : (
            actions("max-sm:hidden")
          )}
        </div>

        {fresh && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2 font-mono text-[13px]">
                {fresh}
              </code>
              <CopyButton value={fresh} label="Copy token" />
            </div>
            <p className="text-xs text-warning">
              Copy it now. It isn’t shown again. Send it as{" "}
              <code className="font-mono">Authorization: Bearer …</code> to{" "}
              <code className="font-mono">{endpoint}</code>.
            </p>
          </div>
        )}

        {editing ? (
          <HostsEditor
            initial={row.linkHosts}
            busy={busy}
            onSave={onSaveHosts}
            onCancel={onCancelEdit}
          />
        ) : (
          row.linkHosts.length + Number(!fresh) > 0 && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span className="mr-1">Link hosts</span>
              {row.linkHosts.map((h) => (
                <HostChip key={h} host={h} />
              ))}
              {!fresh && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="max-md:h-11"
                  disabled={off}
                  onClick={onEdit}
                >
                  <Pencil aria-hidden />
                  Edit
                </Button>
              )}
            </p>
          )
        )}
        {!fresh && !editing && actions("pt-1 sm:hidden")}
      </div>
    </li>
  );
}

function ConfirmAction({
  trigger,
  variant,
  triggerClassName,
  disabled,
  title,
  description,
  action,
  onConfirm,
}: {
  trigger: ReactNode;
  variant: "outline" | "ghost";
  triggerClassName?: string;
  disabled: boolean;
  title: string;
  description: ReactNode;
  action: ReactNode;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            variant={variant}
            className={cn("h-9 max-md:h-11", triggerClassName)}
            disabled={disabled}
          />
        }
      >
        {trigger}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Chips plus an input: Enter or comma adds a host; a pasted URL is caught inline. */
function HostsField({
  hosts,
  onChange,
  label,
  hint,
}: {
  hosts: string[];
  onChange: (hosts: string[]) => void;
  label: string;
  hint: string;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const id = `hosts-${label.replace(/\W+/g, "-").toLowerCase()}`;

  const add = () => {
    const v = draft.trim().toLowerCase();
    if (!v) return;
    const why = hostError(v);
    if (why) return setError(why);
    if (hosts.length >= MAX_LINK_HOSTS) {
      return setError(`At most ${MAX_LINK_HOSTS} hosts.`);
    }
    if (!hosts.includes(v)) onChange([...hosts, v]);
    setDraft("");
    setError(null);
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div
        className={cn(
          "flex flex-wrap items-center gap-1.5 rounded-md border bg-background p-1.5 dark:bg-input/30",
          error && "border-destructive",
        )}
      >
        {hosts.map((h) => (
          <HostChip
            key={h}
            host={h}
            onRemove={() => onChange(hosts.filter((x) => x !== h))}
          />
        ))}
        <input
          id={id}
          value={draft}
          placeholder="Add a host…"
          aria-invalid={error !== null}
          aria-describedby={`${id}-hint`}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            } else if (e.key === "Backspace" && !draft && hosts.length) {
              onChange(hosts.slice(0, -1));
            }
          }}
          onBlur={add}
          className="min-w-40 flex-1 bg-transparent px-1.5 py-1 font-mono text-[13px] outline-none max-md:h-9"
        />
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {hint}
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function HostsEditor({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: string[];
  busy: boolean;
  onSave: (hosts: string[]) => void;
  onCancel: () => void;
}) {
  const [hosts, setHosts] = useState(initial);
  return (
    <div className="space-y-3 pt-1">
      <HostsField
        hosts={hosts}
        onChange={setHosts}
        label="Allowed link hosts"
        hint="Exact hostnames, https only. Press Enter to add. A link to any other host is rejected with 400."
      />
      <div className="flex items-center gap-2">
        <Button
          className="h-9 max-md:h-11"
          disabled={busy}
          onClick={() => onSave(hosts)}
        >
          Save hosts
        </Button>
        <Button variant="ghost" className="h-9 max-md:h-11" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function AddPlatformDialog({
  open,
  onOpenChange,
  taken,
  defaultHosts,
  busy,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taken: string[];
  defaultHosts: string[];
  busy: boolean;
  onCreate: (platform: string, hosts: string[]) => void;
}) {
  const [name, setName] = useState("");
  const [hosts, setHosts] = useState(defaultHosts);
  const [touched, setTouched] = useState(false);
  const v = name.trim();
  const problem = !v
    ? "Enter a platform name."
    : !PLATFORM_RE.test(v)
      ? "Lowercase letters, digits and dashes only, starting with a letter or digit."
      : taken.includes(v)
        ? "That platform already has a token. Use Rotate on its row."
        : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setName("");
          setHosts(defaultHosts);
          setTouched(false);
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!problem) onCreate(v, hosts);
          }}
        >
          <DialogHeader>
            <DialogTitle>Add a platform</DialogTitle>
            <DialogDescription>
              It gets its own token. Events it posts are stamped with this name.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="platform-name" className="text-sm font-medium">
              Platform
            </label>
            <Input
              id="platform-name"
              value={name}
              autoComplete="off"
              spellCheck={false}
              maxLength={32}
              aria-invalid={touched && problem !== null}
              className="font-mono max-md:h-11"
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched(true)}
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, digits and dashes, up to 32. Like{" "}
              <code className="font-mono">claude-code</code>. One token per
              platform.
            </p>
            {touched && problem && (
              <p role="alert" className="text-xs text-destructive">
                {problem}
              </p>
            )}
          </div>
          <HostsField
            hosts={hosts}
            onChange={setHosts}
            label="Allowed link hosts"
            hint="Starts with GitHub and your relay. Links to other hosts are rejected."
          />
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="max-md:h-11"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="max-md:h-11" disabled={busy}>
              <KeyRound aria-hidden />
              Create token
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
