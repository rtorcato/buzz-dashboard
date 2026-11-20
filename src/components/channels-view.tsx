"use client";

import { Archive, Eye, EyeOff, Hash, Layers, Lock } from "lucide-react";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatAge } from "@/lib/age";
import {
  CHANNEL_TABS,
  type ChannelMap,
  type ChannelMember,
  type ChannelRow,
  type ChannelTab,
  inTab,
  isUnreadable,
} from "@/lib/channels";

const TAB_LABEL: Record<ChannelTab, string> = {
  all: "All",
  unreadable: "Can't read",
  unassigned: "Unassigned",
  archived: "Archived",
};

const ALL_PROJECTS = "all";
const SHOWN_MEMBERS = 4;

// `now` is unix seconds from the server render, so server and client agree.
export function ChannelsView({ map, now }: { map: ChannelMap; now: number }) {
  const [tab, setTab] = useState<ChannelTab>("all");
  const [project, setProject] = useState(ALL_PROJECTS);
  // Without the registry there is no project to be unassigned from.
  const tabs = CHANNEL_TABS.filter((t) => map.registry || t !== "unassigned");
  const counts = Object.fromEntries(
    CHANNEL_TABS.map((t) => [t, inTab(map.rows, t).length]),
  ) as Record<ChannelTab, number>;
  const readable = map.rows.filter((r) => !r.archived && r.readable).length;
  const projectItems = [
    { value: ALL_PROJECTS, label: "All projects" },
    ...map.projects.map((p) => ({ value: p.slug, label: p.name })),
  ];
  const shown = inTab(map.rows, tab).filter(
    (r) => project === ALL_PROJECTS || r.project?.slug === project,
  );

  return (
    <>
      <div>
        <h1 className="text-[28px] leading-9 font-semibold tracking-tight">
          Channels
        </h1>
        <p className="mt-1 text-muted-foreground">
          {map.rows.length} {map.rows.length === 1 ? "channel" : "channels"} ·{" "}
          {readable} the dashboard can read
        </p>
      </div>

      {counts.unreadable > 0 && (
        <div
          role="status"
          className="flex gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3"
        >
          <EyeOff className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <p className="text-sm">
            <span className="font-semibold">
              The dashboard can&apos;t read {counts.unreadable} active{" "}
              {counts.unreadable === 1 ? "channel" : "channels"}.
            </span>{" "}
            <span className="text-muted-foreground">
              Its identity isn&apos;t a member, so their messages, turns and
              cost don&apos;t show. Agents who work there show &quot;Active in a
              channel this dashboard can&apos;t read&quot; instead of Quiet.
            </span>
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <fieldset className="box-content inline-flex h-11 max-w-full overflow-x-auto rounded-md border shadow-xs sm:box-border sm:h-9">
          <legend className="sr-only">Filter channels</legend>
          {tabs.map((t, i) => (
            <button
              key={t}
              type="button"
              aria-pressed={tab === t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 px-3 text-sm whitespace-nowrap focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none ${i ? "border-l" : ""} ${tab === t ? "bg-accent font-medium" : "text-muted-foreground hover:bg-muted"}`}
            >
              {TAB_LABEL[t]}
              <span className="tabular-nums text-muted-foreground">
                {counts[t]}
              </span>
            </button>
          ))}
        </fieldset>
        {map.registry && map.projects.length > 0 && (
          <Select
            items={projectItems}
            value={project}
            onValueChange={(v) => v && setProject(v)}
          >
            <SelectTrigger
              className="h-11! min-w-44 sm:h-9!"
              aria-label="Filter by project"
            >
              <Layers className="size-4" aria-hidden />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {projectItems.map((i) => (
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
        )}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {map.rows.length === 0
            ? "The relay lists no channels."
            : "No channels match."}
        </p>
      ) : (
        <Card className="gap-0 overflow-hidden p-0">
          {/* Desktop: a table. Phones: stacked rows (see ChannelRowView). */}
          <div
            className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,1fr)_6.5rem] gap-4 border-b px-5 py-3 text-sm text-muted-foreground md:grid"
            aria-hidden
          >
            <span>Channel</span>
            <span>{map.registry ? "Project" : ""}</span>
            <span>Members</span>
            <span>Dashboard</span>
            <span className="text-right whitespace-nowrap">Last message</span>
          </div>
          <ul className="divide-y">
            {shown.map((r) => (
              <ChannelRowView
                key={r.id}
                row={r}
                now={now}
                registry={map.registry}
              />
            ))}
          </ul>
        </Card>
      )}

      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Eye className="size-4 shrink-0" aria-hidden />
        Read-only. Only the hive owner can change channels.
      </p>
    </>
  );
}

function ChannelRowView({
  row: r,
  now,
  registry,
}: {
  row: ChannelRow;
  now: number;
  registry: boolean;
}) {
  const Icon = r.isPrivate ? Lock : Hash;
  return (
    <li
      className={`grid grid-cols-1 items-center gap-x-4 gap-y-2 px-5 py-3.5 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,1fr)_6.5rem] ${r.archived ? "opacity-70" : ""}`}
    >
      <p className="flex min-w-0 items-center gap-2 font-medium">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="sr-only">
          {r.isPrivate ? "Private" : "Open"} channel{" "}
        </span>
        <span className="truncate">{r.name}</span>
      </p>
      <div className="min-w-0 text-sm">
        {registry ? <ProjectCell row={r} /> : null}
      </div>
      <Members members={r.members} />
      <div>
        <ReadBadge row={r} />
      </div>
      <p className="text-sm text-muted-foreground tabular-nums md:text-right">
        <span className="md:hidden">Last message </span>
        {r.lastMessageAt ? (
          formatAge((now - r.lastMessageAt) * 1000)
        ) : (
          <span title="No message in the last 7 days">–</span>
        )}
      </p>
    </li>
  );
}

function ProjectCell({ row: r }: { row: ChannelRow }) {
  if (r.scope === "hive_wide") {
    return <span className="text-muted-foreground">Hive-wide</span>;
  }
  if (r.scope === "project" && r.project) {
    return (
      <span className="inline-flex max-w-full items-center gap-2">
        {r.project.shortLabel && (
          <span
            className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold"
            aria-hidden
          >
            {r.project.shortLabel}
          </span>
        )}
        <span className="truncate font-mono text-[13px]">{r.project.name}</span>
        {r.home && <span className="sr-only"> (home channel)</span>}
      </span>
    );
  }
  return (
    <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground">
      Unassigned
    </span>
  );
}

function ReadBadge({ row: r }: { row: ChannelRow }) {
  const base =
    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap";
  if (r.archived) {
    return (
      <span
        className={`${base} border-transparent bg-muted text-muted-foreground`}
      >
        <Archive className="size-3" aria-hidden />
        Archived
      </span>
    );
  }
  if (isUnreadable(r)) {
    return (
      <span className={`${base} border-warning/25 bg-warning/10 text-warning`}>
        <EyeOff className="size-3" aria-hidden />
        Can&apos;t read · not a member
      </span>
    );
  }
  return (
    <span className={`${base} border-success/25 bg-success/10 text-success`}>
      <Eye className="size-3" aria-hidden />
      Readable
    </span>
  );
}

const initials = (m: ChannelMember) =>
  (m.name ?? "Owner")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2);

function Members({ members }: { members: ChannelMember[] }) {
  const more = members.length - SHOWN_MEMBERS;
  return (
    <div className="flex items-center gap-2">
      <ul
        className="flex -space-x-2"
        aria-label={`${members.length} ${members.length === 1 ? "member" : "members"}`}
      >
        {members.slice(0, SHOWN_MEMBERS).map((m) => (
          <li
            key={m.pubkey}
            title={m.name ?? "A person"}
            className="flex size-7 items-center justify-center overflow-hidden rounded-full border-2 border-card bg-muted text-[10px] font-medium"
          >
            {m.picture ? (
              // biome-ignore lint/performance/noImgElement: a 28px profile picture from /api/avatar; next/image would need every host allow-listed.
              <img
                src={m.picture}
                alt=""
                className="size-full object-cover"
                referrerPolicy="no-referrer"
                loading="lazy"
              />
            ) : (
              <span aria-hidden>{initials(m)}</span>
            )}
          </li>
        ))}
        {more > 0 && (
          <li
            className="flex size-7 items-center justify-center rounded-full border-2 border-card bg-muted text-[10px] text-muted-foreground"
            aria-hidden
          >
            +{more}
          </li>
        )}
      </ul>
      <span className="text-sm text-muted-foreground tabular-nums" aria-hidden>
        {members.length}
      </span>
    </div>
  );
}
