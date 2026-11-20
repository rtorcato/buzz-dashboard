"use client";

import {
  Archive,
  ArchiveRestore,
  Ellipsis,
  ExternalLink,
  Eye,
  Hash,
  KeyRound,
  Layers,
  Lock,
  Pencil,
  Plus,
  ShieldCheck,
  UserPlus,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  aboutProblem,
  type ChannelState,
  changeCount,
  cleanName,
  createTemplate,
  eventCount,
  nameProblem,
  type ProjectChoice,
  planEdit,
  type Step,
  templatesFor,
  type Visibility,
} from "@/lib/channel-admin";
import type { ChannelProject, ChannelRow } from "@/lib/channels";
import {
  nostrExtension,
  registryWrite,
  relayWrite,
  SignError,
} from "@/lib/nostr-browser";

// Channel admin (#169), DESIGN.md → Channels → Channel admin. Only the owner
// sees any of this. Changes collect in a sheet or dialog and nothing is sent
// until the signing step, where the owner's extension signs each relay event.

/** What the page hands the owner's admin controls. All of it is public keys. */
export type AdminContext = {
  /** The relay's `https://…/events`, which the relay auth must name. */
  relayEventsUrl: string;
  /** The dashboard identity's pubkey: the "reader". */
  dashboard: string;
  owners: string[];
  /** The signed-in owner's npub, or null under a proxy. */
  ownerNpub: string | null;
  agents: { pubkey: string; name: string }[];
  /** The first GITHUB_OWNERS entry, for a new channel's new project. */
  githubOwner: string | null;
  /** BUZZ_WEB_URL, for "Open in Buzz". */
  buzzUrl: string | null;
};

type Badge = "relay" | "dashboard";

/** One line of the signing dialog and what it does when signed. */
export type SignItem = {
  key: string;
  icon: "key" | "layers";
  title: React.ReactNode;
  detail: string;
  badge: Badge;
  /** Relay events it signs; 0 for a dashboard save. */
  events: number;
  run: (n: NonNullable<ReturnType<typeof nostrExtension>>) => Promise<void>;
};

export type SignJob = {
  title: string;
  items: SignItem[];
  /** Back to the form the job came from, with its changes kept. */
  back?: () => void;
};

const shortNpub = (npub: string) => `${npub.slice(0, 12)}…${npub.slice(-4)}`;

export function nameOf(pubkey: string, admin: AdminContext): string {
  if (admin.owners.includes(pubkey)) return "Owner";
  if (pubkey === admin.dashboard) return "buzz-dashboard";
  return (
    admin.agents.find((a) => a.pubkey === pubkey)?.name ??
    `${pubkey.slice(0, 8)}…`
  );
}

const roleOf = (pubkey: string, admin: AdminContext) =>
  admin.owners.includes(pubkey)
    ? "Owner"
    : pubkey === admin.dashboard
      ? "Reader · this dashboard"
      : "Member";

const initials = (name: string) =>
  name === "buzz-dashboard"
    ? "DB"
    : name === "Owner"
      ? "OW"
      : name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2) || "?";

const listNames = (pubkeys: string[], admin: AdminContext) =>
  pubkeys
    .map((p) =>
      p === admin.dashboard ? "buzz-dashboard (reader)" : nameOf(p, admin),
    )
    .join(", ");

const choiceOf = (row: ChannelRow): ProjectChoice =>
  row.scope === "hive_wide"
    ? { scope: "hive_wide" }
    : row.scope === "project" && row.project
      ? { scope: "project", slug: row.project.slug }
      : { scope: null };

const choiceValue = (c: ProjectChoice) =>
  c.scope === "project" ? `p:${c.slug}` : (c.scope ?? "none");

const choiceFrom = (v: string): ProjectChoice =>
  v.startsWith("p:")
    ? { scope: "project", slug: v.slice(2) }
    : v === "hive_wide"
      ? { scope: "hive_wide" }
      : { scope: null };

const stateOf = (row: ChannelRow): ChannelState => ({
  name: row.name,
  about: row.description,
  members: row.members.map((m) => m.pubkey),
  archived: row.archived,
  project: choiceOf(row),
});

// ---------------------------------------------------------------------------
// Turning changes into signing lines.

function assignBody(
  choice: ProjectChoice,
  revision: number,
  home = false,
): Record<string, unknown> {
  return choice.scope === "project"
    ? {
        base_revision: revision,
        scope: "project",
        project: choice.slug,
        is_home: home,
        label: null,
      }
    : { base_revision: revision, scope: choice.scope, label: null };
}

function projectTitle(
  choice: ProjectChoice,
  projects: ChannelProject[],
): React.ReactNode {
  if (choice.scope === "hive_wide") return "Mark as Hive-wide";
  if (choice.scope === null) return "Remove from its project";
  const name =
    projects.find((p) => p.slug === choice.slug)?.name ?? choice.slug;
  return (
    <>
      Assign to project <span className="font-mono">{name}</span>
    </>
  );
}

/** The signing lines for one channel's steps, in sending order. */
export function stepItems(
  channel: { id: string; name: string; revision: number },
  steps: Step[],
  admin: AdminContext,
  projects: ChannelProject[],
  newProject?: { slug: string; name: string; repo: string },
): SignItem[] {
  const relay =
    (step: Step) =>
    async (n: NonNullable<ReturnType<typeof nostrExtension>>) => {
      const at = Math.floor(Date.now() / 1000);
      for (const t of templatesFor(channel.id, step, at)) {
        await relayWrite(n, admin.relayEventsUrl, t);
      }
    };
  return steps.flatMap((step, i): SignItem[] => {
    const key = `${channel.id}:${i}:${step.type}`;
    switch (step.type) {
      case "edit": {
        const renamed = step.name !== undefined;
        const described = step.about !== undefined;
        return [
          {
            key,
            icon: "key",
            title:
              renamed && described
                ? "Rename and update description"
                : renamed
                  ? `Rename to #${step.name}`
                  : "Update description",
            detail: described
              ? step.about
                ? `"${step.about}"`
                : "Clear the description"
              : `Was #${channel.name}`,
            badge: "relay",
            events: eventCount(step),
            run: relay(step),
          },
        ];
      }
      case "add":
      case "remove": {
        const n = step.pubkeys.length;
        const verb = step.type === "add" ? "Add" : "Remove";
        return [
          {
            key,
            icon: "key",
            title: `${verb} ${n} ${n === 1 ? "member" : "members"}`,
            detail: listNames(step.pubkeys, admin),
            badge: "relay",
            events: eventCount(step),
            run: relay(step),
          },
        ];
      }
      case "archive":
        return [
          {
            key,
            icon: "key",
            title: step.archived ? "Archive channel" : "Unarchive channel",
            detail: step.archived
              ? "Hides it from the hive and stops new messages"
              : "Brings it back to the hive",
            badge: "relay",
            events: 1,
            run: relay(step),
          },
        ];
      case "project": {
        const lines: SignItem[] = [];
        if (newProject) {
          lines.push({
            key: `${key}:new`,
            icon: "layers",
            title: (
              <>
                Add project <span className="font-mono">{newProject.slug}</span>
              </>
            ),
            detail: `With the repo ${newProject.repo}`,
            badge: "dashboard",
            events: 0,
            run: async (n) => {
              await registryWrite(n, "/api/projects", {
                slug: newProject.slug,
                set: { name: newProject.name },
                repos: { add: [{ repo: newProject.repo, primary: true }] },
              });
            },
          });
        }
        lines.push({
          key,
          icon: "layers",
          title: projectTitle(step.choice, [
            ...projects,
            ...(newProject
              ? [
                  {
                    slug: newProject.slug,
                    name: newProject.name,
                    shortLabel: null,
                  },
                ]
              : []),
          ]),
          detail: "Saved in the dashboard after the signed changes land",
          badge: "dashboard",
          events: 0,
          run: async (n) => {
            await registryWrite(
              n,
              `/api/channel-assignments/${encodeURIComponent(channel.id)}`,
              assignBody(step.choice, channel.revision, Boolean(newProject)),
            );
          },
        });
        return lines;
      }
    }
    return [];
  });
}

// ---------------------------------------------------------------------------
// The row menu.

export type EditFocus = "details" | "members" | "project";

export function ChannelRowMenu({
  row,
  admin,
  registry,
  onEdit,
  onSign,
}: {
  row: ChannelRow;
  admin: AdminContext;
  registry: boolean;
  onEdit: (focus: EditFocus) => void;
  onSign: (job: SignJob) => void;
}) {
  const reading = row.members.some((m) => m.pubkey === admin.dashboard);
  const channel = { id: row.id, name: row.name, revision: row.revision };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="max-md:size-11"
            aria-label={`Manage #${row.name}`}
          />
        }
      >
        <Ellipsis aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate">
            #{row.name}
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={() => onEdit("details")}>
            <Pencil aria-hidden />
            Rename and describe
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onEdit("members")}>
            <UserPlus aria-hidden />
            Members
          </DropdownMenuItem>
          {registry && (
            <DropdownMenuItem onClick={() => onEdit("project")}>
              <Layers aria-hidden />
              Assign to project
            </DropdownMenuItem>
          )}
          {!reading && !row.archived && (
            <DropdownMenuItem
              onClick={() =>
                onSign({
                  title: `Sign 1 change to #${row.name}`,
                  items: stepItems(
                    channel,
                    [{ type: "add", pubkeys: [admin.dashboard] }],
                    admin,
                    [],
                  ),
                })
              }
            >
              <Eye aria-hidden />
              Let the dashboard read it
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        {admin.buzzUrl && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              render={
                <a href={admin.buzzUrl} target="_blank" rel="noreferrer" />
              }
            >
              <ExternalLink aria-hidden />
              Open in Buzz
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant={row.archived ? "default" : "destructive"}
          onClick={() =>
            onSign({
              title: `Sign 1 change to #${row.name}`,
              items: stepItems(
                channel,
                [{ type: "archive", archived: !row.archived }],
                admin,
                [],
              ),
            })
          }
        >
          {row.archived ? (
            <ArchiveRestore aria-hidden />
          ) : (
            <Archive aria-hidden />
          )}
          {row.archived ? "Unarchive channel" : "Archive channel"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "Add the dashboard to N": one signed add per channel it can't read. */
export function addDashboardJob(
  rows: ChannelRow[],
  admin: AdminContext,
): SignJob {
  return {
    title: `Sign ${rows.length} ${rows.length === 1 ? "change" : "changes"}`,
    items: rows.flatMap((r) =>
      stepItems(
        { id: r.id, name: r.name, revision: r.revision },
        [{ type: "add", pubkeys: [admin.dashboard] }],
        admin,
        [],
      ).map((item) => ({ ...item, title: `Add the dashboard to #${r.name}` })),
    ),
  };
}

// ---------------------------------------------------------------------------
// Small pieces.

function MemberAvatar({ name }: { name: string }) {
  return (
    <span
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium"
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <label htmlFor={htmlFor} className="text-sm text-muted-foreground">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

function NameInput({
  id,
  value,
  onChange,
  invalid,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative">
      <Hash
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        className="h-11 pl-8 sm:h-10"
      />
    </div>
  );
}

function ProjectSelect({
  id,
  value,
  onChange,
  projects,
  extra = [],
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  projects: ChannelProject[];
  extra?: { value: string; label: string }[];
}) {
  const items = [
    ...extra,
    ...projects.map((p) => ({ value: `p:${p.slug}`, label: p.name })),
    { value: "hive_wide", label: "Hive-wide" },
    { value: "none", label: "No project" },
  ];
  return (
    <Select items={items} value={value} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger id={id} className="h-11! w-full sm:h-10!">
        <Layers className="size-4" aria-hidden />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem
            key={i.value}
            value={i.value}
            className="min-h-11 sm:min-h-0"
          >
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AddMemberMenu({
  admin,
  present,
  onAdd,
  label = "Add",
  withDashboard = true,
}: {
  admin: AdminContext;
  present: string[];
  onAdd: (pubkey: string) => void;
  label?: string;
  /** Offer the dashboard as a reader; the new-channel form has a switch. */
  withDashboard?: boolean;
}) {
  const options = [
    ...admin.agents
      .filter((a) => !present.includes(a.pubkey))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({ pubkey: a.pubkey, name: a.name })),
    ...(!withDashboard || present.includes(admin.dashboard)
      ? []
      : [{ pubkey: admin.dashboard, name: "buzz-dashboard (reader)" }]),
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={!options.length}
        render={<Button variant="ghost" size="sm" className="max-md:h-11" />}
      >
        <UserPlus aria-hidden />
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-72 w-56 overflow-y-auto"
      >
        {options.map((o) => (
          <DropdownMenuItem key={o.pubkey} onClick={() => onAdd(o.pubkey)}>
            {o.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// The edit sheet (4b, p4).

export function EditChannelSheet({
  row,
  admin,
  registry,
  projects,
  open,
  focus,
  onClose,
  onReview,
}: {
  row: ChannelRow;
  admin: AdminContext;
  registry: boolean;
  projects: ChannelProject[];
  open: boolean;
  focus: EditFocus;
  onClose: () => void;
  onReview: (job: SignJob) => void;
}) {
  const ids = useId();
  const before = stateOf(row);
  const [draft, setDraft] = useState<ChannelState>(before);
  const steps = planEdit(before, draft);
  const changes = changeCount(steps);
  const nameError = nameProblem(draft.name);
  const aboutError = aboutProblem(draft.about);
  const Icon = row.isPrivate ? Lock : Hash;
  const added = draft.members.filter((p) => !before.members.includes(p));
  const removed = before.members.filter((p) => !draft.members.includes(p));
  const shown = [...before.members, ...added];

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md"
      >
        <SheetHeader className="flex-row items-center gap-3 border-b p-4 pr-12">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Icon className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <SheetTitle className="truncate text-lg font-semibold">
              #{row.name}
            </SheetTitle>
            <SheetDescription>
              {row.isPrivate ? "Private" : "Open"} · {row.members.length}{" "}
              {row.members.length === 1 ? "member" : "members"}
            </SheetDescription>
          </div>
        </SheetHeader>

        <div className="grid flex-1 content-start gap-6 overflow-y-auto p-4">
          <Field label="Name" htmlFor={`${ids}-name`} error={nameError}>
            <NameInput
              id={`${ids}-name`}
              value={draft.name}
              onChange={(name) => setDraft({ ...draft, name })}
              invalid={Boolean(nameError)}
              autoFocus={focus === "details"}
            />
          </Field>
          <Field
            label="Description"
            htmlFor={`${ids}-about`}
            error={aboutError}
          >
            <Input
              id={`${ids}-about`}
              value={draft.about}
              onChange={(e) => setDraft({ ...draft, about: e.target.value })}
              aria-invalid={Boolean(aboutError) || undefined}
              className="h-11 sm:h-10"
            />
          </Field>
          {registry && (
            <Field
              label="Project"
              htmlFor={`${ids}-project`}
              hint="Saved in the dashboard. It doesn't change the channel on the relay."
            >
              <ProjectSelect
                id={`${ids}-project`}
                value={choiceValue(draft.project)}
                onChange={(v) => setDraft({ ...draft, project: choiceFrom(v) })}
                projects={projects}
              />
            </Field>
          )}

          <section className="grid gap-2" aria-labelledby={`${ids}-members`}>
            <div className="flex items-center justify-between">
              <h3
                id={`${ids}-members`}
                className="text-sm text-muted-foreground"
              >
                Members
              </h3>
              <AddMemberMenu
                admin={admin}
                present={draft.members}
                onAdd={(p) =>
                  setDraft({ ...draft, members: [...draft.members, p] })
                }
              />
            </div>
            <ul className="divide-y rounded-xl border px-4">
              {shown.map((p) => {
                const name = nameOf(p, admin);
                const isNew = added.includes(p);
                const isGone = removed.includes(p);
                const owner = admin.owners.includes(p);
                return (
                  <li key={p} className="flex items-center gap-3 py-3">
                    <MemberAvatar name={name} />
                    <span className="grid min-w-0 flex-1 leading-tight">
                      <span
                        className={`truncate font-medium ${isGone ? "text-muted-foreground line-through" : ""}`}
                      >
                        {name}
                      </span>
                      <span className="truncate text-sm text-muted-foreground">
                        {roleOf(p, admin)}
                      </span>
                    </span>
                    {isNew ? (
                      <button
                        type="button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            members: draft.members.filter((m) => m !== p),
                          })
                        }
                        className="inline-flex min-h-11 items-center gap-1 rounded-md bg-success/10 px-2.5 text-sm text-success sm:min-h-7"
                        aria-label={`Adding ${name}. Undo`}
                      >
                        <Plus className="size-3.5" aria-hidden />
                        Adding
                      </button>
                    ) : isGone ? (
                      <button
                        type="button"
                        onClick={() =>
                          setDraft({ ...draft, members: [...draft.members, p] })
                        }
                        className="inline-flex min-h-11 items-center rounded-md bg-destructive/10 px-2.5 text-sm text-destructive sm:min-h-7"
                        aria-label={`Removing ${name}. Undo`}
                      >
                        Removing · Undo
                      </button>
                    ) : owner ? null : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="max-md:size-11"
                        aria-label={`Remove ${name}`}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            members: draft.members.filter((m) => m !== p),
                          })
                        }
                      >
                        <X aria-hidden />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section
            className={`flex items-start gap-3 rounded-xl border p-4 ${draft.archived && !row.archived ? "border-destructive/40 bg-destructive/5" : row.archived ? "" : "border-destructive/25"}`}
          >
            {row.archived ? (
              <ArchiveRestore className="mt-0.5 size-5 shrink-0" aria-hidden />
            ) : (
              <Archive className="mt-0.5 size-5 shrink-0" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {row.archived ? "Unarchive channel" : "Archive channel"}
              </p>
              <p className="text-sm text-muted-foreground">
                {row.archived
                  ? "Brings it back to the hive."
                  : "Hides it from the hive and stops new messages. You can unarchive it later."}
              </p>
            </div>
            <Button
              variant="outline"
              className={`max-md:h-11 ${row.archived ? "" : "border-destructive/40 text-destructive hover:bg-destructive/10"}`}
              aria-pressed={draft.archived !== row.archived}
              onClick={() => setDraft({ ...draft, archived: !draft.archived })}
            >
              {draft.archived !== row.archived
                ? "Undo"
                : row.archived
                  ? "Unarchive"
                  : "Archive"}
            </Button>
          </section>
        </div>

        <SheetFooter className="flex-row items-center gap-2 border-t">
          <span className="mr-auto text-sm text-muted-foreground tabular-nums">
            {changes} {changes === 1 ? "change" : "changes"}
          </span>
          <Button variant="ghost" className="max-md:h-11" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="max-md:h-11"
            disabled={!changes || Boolean(nameError) || Boolean(aboutError)}
            onClick={() => {
              const items = stepItems(
                { id: row.id, name: row.name, revision: row.revision },
                steps,
                admin,
                projects,
              );
              const n = items.length;
              onReview({
                title: `Sign ${n} ${n === 1 ? "change" : "changes"} to #${row.name}`,
                items,
              });
            }}
          >
            <KeyRound aria-hidden />
            Review and sign
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// New channel (4d).

const slugFor = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/, "");

export function NewChannelDialog({
  admin,
  registry,
  projects,
  taken,
  open,
  onClose,
  onReview,
}: {
  admin: AdminContext;
  registry: boolean;
  projects: ChannelProject[];
  /** Names already in use, lowercase. */
  taken: string[];
  open: boolean;
  onClose: () => void;
  onReview: (job: SignJob) => void;
}) {
  const ids = useId();
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [reader, setReader] = useState(true);
  const [visibility, setVisibility] = useState<Visibility>("private");
  // Null follows the name: its project, or a new one for its repo.
  const [picked, setPicked] = useState<string | null>(null);

  const clean = cleanName(name);
  const slug = slugFor(clean);
  const existing = projects.find((p) => p.slug === slug);
  const repo =
    admin.githubOwner && slug && /^[a-z0-9._-]+$/.test(clean.toLowerCase())
      ? `${admin.githubOwner.toLowerCase()}/${clean.toLowerCase()}`
      : null;
  const canAddProject = registry && !existing && Boolean(repo) && Boolean(slug);
  const auto = existing ? `p:${existing.slug}` : canAddProject ? "new" : "none";
  const value = picked === "new" && !canAddProject ? "none" : (picked ?? auto);
  const nameError = name ? nameProblem(name) : null;
  const duplicate = taken.includes(clean.toLowerCase());

  const submit = () => {
    const id = crypto.randomUUID();
    const all = [...members, ...(reader ? [admin.dashboard] : [])];
    const channel = { id, name: clean, revision: 0 };
    const steps: Step[] = [];
    if (all.length) steps.push({ type: "add", pubkeys: all });
    const choice: ProjectChoice =
      value === "new" ? { scope: "project", slug } : choiceFrom(value);
    if (registry && choice.scope !== null) {
      steps.push({ type: "project", choice });
    }
    const create: SignItem = {
      key: `${id}:create`,
      icon: "key",
      title: `Create #${clean}`,
      detail: `${visibility === "private" ? "Private" : "Open"} channel`,
      badge: "relay",
      events: 1,
      run: async (n) => {
        await relayWrite(
          n,
          admin.relayEventsUrl,
          createTemplate(
            id,
            { name: clean, about: "", visibility },
            Math.floor(Date.now() / 1000),
          ),
        );
      },
    };
    const items = [
      create,
      ...stepItems(
        channel,
        steps,
        admin,
        projects,
        value === "new" && repo ? { slug, name: clean, repo } : undefined,
      ),
    ];
    const events = items.reduce((n, i) => n + i.events, 0);
    onReview({
      title: `Create #${clean}: sign ${events} ${events === 1 ? "event" : "events"}`,
      items,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            New channel
          </DialogTitle>
          <DialogDescription className="sr-only">
            Create a relay channel. Your Nostr extension signs it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          <Field
            label="Name"
            htmlFor={`${ids}-name`}
            error={
              nameError ??
              (duplicate ? "A channel already has that name." : null)
            }
          >
            <NameInput
              id={`${ids}-name`}
              value={name}
              onChange={setName}
              invalid={Boolean(nameError) || duplicate}
              autoFocus
            />
          </Field>
          {registry && (
            <Field
              label="Project"
              htmlFor={`${ids}-project`}
              hint={
                value === "new" && repo
                  ? `No project for this repo yet. Creating the channel adds one with the repo ${repo}.`
                  : undefined
              }
            >
              <ProjectSelect
                id={`${ids}-project`}
                value={value}
                onChange={setPicked}
                projects={projects}
                extra={
                  canAddProject
                    ? [{ value: "new", label: `${slug} (new project)` }]
                    : []
                }
              />
            </Field>
          )}
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground" id={`${ids}-m`}>
                Members
              </span>
              <AddMemberMenu
                admin={admin}
                withDashboard={false}
                present={members}
                onAdd={(p) => setMembers([...members, p])}
                label="Add an agent"
              />
            </div>
            {members.length ? (
              <ul className="flex flex-wrap gap-2" aria-labelledby={`${ids}-m`}>
                {members.map((p) => (
                  <li
                    key={p}
                    className="inline-flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pr-1 pl-2.5 text-sm"
                  >
                    {nameOf(p, admin)}
                    <button
                      type="button"
                      className="flex size-7 items-center justify-center rounded-full hover:bg-muted"
                      aria-label={`Remove ${nameOf(p, admin)}`}
                      onClick={() => setMembers(members.filter((m) => m !== p))}
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No agents yet. You can add them later.
              </p>
            )}
          </div>
          <div className="flex items-start gap-3">
            <Switch
              checked={reader}
              onCheckedChange={setReader}
              className="mt-1"
              aria-labelledby={`${ids}-reader`}
              aria-describedby={`${ids}-reader-d`}
            />
            <span className="grid leading-tight">
              <span id={`${ids}-reader`} className="font-medium">
                Let the dashboard read it
              </span>
              <span
                id={`${ids}-reader-d`}
                className="text-sm text-muted-foreground"
              >
                Adds this dashboard&apos;s identity as a reader
              </span>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <fieldset className="inline-flex h-11 rounded-md border shadow-xs sm:h-9">
              <legend className="sr-only">Visibility</legend>
              {(["private", "open"] as const).map((v, i) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={visibility === v}
                  onClick={() => setVisibility(v)}
                  className={`flex items-center gap-1.5 px-3 text-sm ${i ? "border-l" : ""} ${visibility === v ? "bg-accent font-medium" : "text-muted-foreground hover:bg-muted"}`}
                >
                  {v === "private" && <Lock className="size-3.5" aria-hidden />}
                  {v === "private" ? "Private" : "Open"}
                </button>
              ))}
            </fieldset>
            <span className="text-sm text-muted-foreground">
              Private is the hive default
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" className="max-md:h-11" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="max-md:h-11"
            disabled={!clean || Boolean(nameError) || duplicate}
            onClick={submit}
          >
            <KeyRound aria-hidden />
            Create and sign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// The signing step (4c, p5).

type Progress = "waiting" | "signing" | "done" | "failed";

export function SignDialog({
  job,
  admin,
  onClose,
  onDone,
}: {
  job: SignJob;
  admin: AdminContext;
  onClose: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const events = job.items.reduce((n, i) => n + i.events, 0);
  const finished = job.items.every((i) => progress[i.key] === "done");

  const sign = async () => {
    const n = nostrExtension();
    if (!n) {
      setError("No Nostr extension found. Install one, then try again.");
      return;
    }
    setBusy(true);
    setError(null);
    for (const item of job.items) {
      if (progress[item.key] === "done") continue;
      setProgress((p) => ({ ...p, [item.key]: "signing" }));
      try {
        await item.run(n);
        setProgress((p) => ({ ...p, [item.key]: "done" }));
      } catch (err) {
        setProgress((p) => ({ ...p, [item.key]: "failed" }));
        setError(
          err instanceof SignError
            ? err.message
            : "Something went wrong. Nothing more was sent.",
        );
        setBusy(false);
        // What already landed is on the relay; show it.
        router.refresh();
        return;
      }
    }
    setBusy(false);
    toast("Channel changes saved");
    router.refresh();
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {job.title}
          </DialogTitle>
          <DialogDescription>
            Your Nostr extension asks you to approve each one.
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-3">
          {job.items.map((item) => {
            const state = progress[item.key] ?? "waiting";
            return (
              <li
                key={item.key}
                className={`flex items-start gap-3 rounded-xl border p-4 ${state === "failed" ? "border-destructive/50" : ""}`}
              >
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-full ${item.badge === "relay" ? "bg-primary/15 text-primary" : "bg-muted"}`}
                  aria-hidden
                >
                  {item.icon === "key" ? (
                    <KeyRound className="size-4" />
                  ) : (
                    <Layers className="size-4" />
                  )}
                </span>
                <span className="grid min-w-0 flex-1 leading-snug">
                  <span className="font-medium">{item.title}</span>
                  <span className="text-sm break-words text-muted-foreground">
                    {item.detail}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
                    state === "done"
                      ? "bg-success/10 text-success"
                      : state === "failed"
                        ? "bg-destructive/10 text-destructive"
                        : state === "signing"
                          ? "bg-warning/10 text-warning"
                          : item.badge === "relay"
                            ? "bg-primary/15 text-primary"
                            : "bg-muted text-muted-foreground"
                  }`}
                >
                  {state === "done"
                    ? "Saved"
                    : state === "failed"
                      ? "Not saved"
                      : state === "signing"
                        ? "Waiting for you"
                        : item.badge === "relay"
                          ? "Relay · signed"
                          : "Dashboard"}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {admin.ownerNpub ? (
              <>
                Signed as{" "}
                <span className="font-mono">{shortNpub(admin.ownerNpub)}</span>,
                the hive owner.
              </>
            ) : (
              "Signed by your Nostr extension as the hive owner."
            )}{" "}
            Messages and threads stay in Buzz Desktop.
          </span>
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          {job.back && !busy && !Object.keys(progress).length && (
            <Button variant="ghost" className="max-md:h-11" onClick={job.back}>
              Back
            </Button>
          )}
          {!job.back && !busy && (
            <Button variant="ghost" className="max-md:h-11" onClick={onClose}>
              Cancel
            </Button>
          )}
          <Button
            className="max-md:h-11"
            disabled={busy || finished}
            onClick={sign}
          >
            <KeyRound aria-hidden />
            {busy
              ? "Signing…"
              : error
                ? "Try the rest again"
                : events
                  ? `Sign ${events} ${events === 1 ? "event" : "events"}`
                  : "Sign and save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
