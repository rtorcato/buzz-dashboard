"use client";

import {
  Activity,
  CircleCheck,
  CircleHelp,
  ClockAlert,
  type LucideIcon,
  MessageSquare,
  Moon,
  PowerOff,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState, ViewTransition } from "react";
import { AnimatedNumber } from "@/components/motion-primitives/animated-number";
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
  type AgentStatus,
  agentSlug,
  agentStats,
  agentStatus,
  morphName,
  type Runtimes,
  SORTS,
  type Sort,
  sortAgents,
} from "@/lib/agents";
import type { Agent } from "@/lib/hive";
import { quietLabel, useSettings } from "@/lib/settings";
import type { Runtime } from "@/lib/status-feed";

const STATUS: Record<
  AgentStatus,
  { label: string; icon: LucideIcon; tone: string }
> = {
  stopped: {
    label: "Stopped",
    icon: PowerOff,
    tone: "border-transparent bg-muted text-muted-foreground",
  },
  active: {
    label: "Active",
    icon: CircleCheck,
    tone: "border-success/25 bg-success/10 text-success",
  },
  idle: {
    label: "Idle",
    icon: Moon,
    tone: "border-transparent bg-muted text-muted-foreground",
  },
  quiet: {
    label: "Quiet",
    icon: ClockAlert,
    tone: "border-warning/25 bg-warning/10 text-warning",
  },
};

const FILTERS = ["all", "active", "quiet", "stopped"] as const;
type Filter = (typeof FILTERS)[number];

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

/** The status feed's age; null when it isn't reported. */
export type FeedInfo = { publishedAt: number; stale: boolean } | null;

const ago = (s: number) => (s < 60 ? "just now" : `${formatAge(s * 1000)} ago`);

// `now` is unix seconds from the server render, so server and client agree.
export function AgentsView({
  agents,
  now,
  runtimes,
  feed,
}: {
  agents: Agent[];
  now: number;
  runtimes: Runtimes;
  feed: FeedInfo;
}) {
  const settings = useSettings();
  // A pick on this page wins over the saved default until the page reloads.
  const [filterPick, setFilter] = useState<Filter | null>(null);
  const [sortPick, setSort] = useState<Sort | null>(null);
  const filter = filterPick ?? settings.agentFilter;
  const sort = sortPick ?? settings.agentSort;
  const quietAfterS = settings.quietAfterMinutes * 60;
  const stats = agentStats(agents, now, runtimes, quietAfterS);
  // Hidden agents leave this view but still count in the stats and Needs you.
  // Pinned ones go first, keeping the sort order within each group.
  const sorted = sortAgents(agents, sort, now, runtimes, quietAfterS).filter(
    (a) => !settings.hidden.includes(a.name),
  );
  const shown = [
    ...sorted.filter((a) => settings.pinned.includes(a.name)),
    ...sorted.filter((a) => !settings.pinned.includes(a.name)),
  ].filter(
    (a) =>
      filter === "all" ||
      agentStatus(a, now, runtimes[a.name], quietAfterS) === filter,
  );
  const sortItems = Object.entries(SORTS).map(([value, label]) => ({
    value,
    label: `Sort: ${label}`,
  }));

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Running"
          icon={Activity}
          value={
            feed ? (
              <>
                <AnimatedNumber value={stats.running} />
                <span className="text-lg text-muted-foreground">
                  {" "}
                  / {agents.length}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">–</span>
            )
          }
          sub={
            !feed
              ? "Runtime not reported"
              : stats.stopped.length
                ? `Stopped: ${stats.stopped.join(" · ")}`
                : "No agent is stopped"
          }
        />
        <Stat
          label="Active now"
          icon={Zap}
          value={
            <>
              {stats.active}
              <span className="text-lg text-muted-foreground">
                {" "}
                / {agents.length}
              </span>
            </>
          }
          sub="Posted in the last 15 min"
        />
        <Stat
          label={`Quiet > ${quietLabel(settings.quietAfterMinutes)}`}
          icon={ClockAlert}
          warn={stats.quiet.length > 0}
          value={stats.quiet.length}
          sub={
            stats.quiet.length === 0
              ? "Everyone posted recently"
              : stats.quiet.slice(0, 2).join(" · ") +
                (stats.quiet.length > 2 ? ` +${stats.quiet.length - 2}` : "")
          }
        />
        <Stat
          label="Messages today"
          icon={MessageSquare}
          value={stats.today}
          sub={
            stats.vsAverage === null
              ? "No history this week"
              : `${stats.vsAverage >= 0 ? "+" : ""}${stats.vsAverage}% vs 7-day average`
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold">Agents</h2>
        {/* Phones: Agents · Sort on row 1, the filter full-width on row 2. */}
        <fieldset className="order-last box-content inline-flex h-11 w-full basis-full rounded-md border shadow-xs sm:order-none sm:box-border sm:h-9 sm:w-auto sm:basis-auto">
          <legend className="sr-only">Filter agents</legend>
          {FILTERS.map((f, i) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`flex min-w-9 flex-1 items-center justify-center px-2 text-sm sm:flex-none sm:px-3 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none ${i ? "border-l" : ""} ${filter === f ? "bg-accent font-medium" : "text-muted-foreground hover:bg-muted"}`}
            >
              {capitalize(f)}
            </button>
          ))}
        </fieldset>
        <Select
          items={sortItems}
          value={sort}
          onValueChange={(v) => v && setSort(v as Sort)}
        >
          <SelectTrigger
            className="h-11! min-w-44 sm:h-9!"
            aria-label="Sort agents"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sortItems.map((i) => (
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
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {filter === "all"
            ? "No agents yet."
            : `No ${filter} agents right now.`}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((a) => (
            <AgentCard
              key={a.name}
              agent={a}
              now={now}
              runtime={runtimes[a.name]}
              feed={feed}
              quietAfterS={quietAfterS}
            />
          ))}
        </div>
      )}
    </>
  );
}

export function Stat({
  label,
  icon: Icon,
  value,
  sub,
  warn = false,
}: {
  label: string;
  icon: LucideIcon;
  value: ReactNode;
  sub: string;
  warn?: boolean;
}) {
  return (
    <Card className="gap-0 p-5">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{label}</span>
        <Icon className={`size-4 ${warn ? "text-warning" : ""}`} aria-hidden />
      </div>
      <div
        className={`mt-2 text-3xl font-semibold tracking-tight tabular-nums ${warn ? "text-warning" : ""}`}
      >
        {value}
      </div>
      <p className="mt-1 truncate text-xs text-muted-foreground">{sub}</p>
    </Card>
  );
}

function AgentCard({
  agent: a,
  now,
  runtime,
  feed,
  quietAfterS,
}: {
  agent: Agent;
  now: number;
  runtime?: Runtime;
  feed: FeedInfo;
  quietAfterS: number;
}) {
  const status = agentStatus(a, now, runtime, quietAfterS);
  const ago = a.lastSeenAt ? formatAge((now - a.lastSeenAt) * 1000) : null;
  const quiet = status === "quiet";

  return (
    <Link
      href={`/agents/${agentSlug(a.name)}`}
      className="group min-w-0 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Card
        className={`h-full gap-0 p-5 transition duration-150 group-hover:-translate-y-0.5 group-hover:border-foreground/20 motion-reduce:transform-none ${quiet ? "ring-1 ring-warning/40" : ""} ${status === "stopped" ? "opacity-80" : ""}`}
      >
        <div className="flex items-center gap-3">
          <Morph name={morphName("avatar", agentSlug(a.name))}>
            <Avatar agent={a} />
          </Morph>
          <div className="min-w-0 flex-1">
            <Morph name={morphName("name", agentSlug(a.name))}>
              <p className="truncate font-semibold">{a.name}</p>
            </Morph>
            {a.role && (
              <p className="truncate text-sm text-muted-foreground">{a.role}</p>
            )}
          </div>
          <StatusBadge status={status} quietFor={quiet ? ago : null} />
        </div>
        <RuntimeRow
          runtime={runtime}
          now={now}
          feed={feed}
          lastSeenAt={a.lastSeenAt}
        />
        <div className="mt-3 rounded-md bg-muted/60 px-3 py-2">
          <p className="text-xs text-muted-foreground">Working on</p>
          <p className="truncate text-sm font-medium" title={a.workingOn ?? ""}>
            {a.workingOn ?? "No messages this week"}
          </p>
        </div>
        <div className="mt-4 flex items-end justify-between gap-3">
          <div className="min-w-0 text-sm text-muted-foreground">
            <p>
              Last seen{" "}
              <span className="text-foreground tabular-nums">
                {ago ? `${ago} ago` : "not this week"}
              </span>
            </p>
            <p className="truncate">
              {a.homeChannel && `#${a.homeChannel} · `}
              <span className="text-foreground tabular-nums">
                {a.messagesToday}
              </span>{" "}
              msgs today
            </p>
          </div>
          <Sparkline values={a.daily} warn={quiet} />
        </div>
      </Card>
    </Link>
  );
}

export function StatusBadge({
  status,
  quietFor = null,
}: {
  status: AgentStatus;
  /** "3h": shown as "Quiet 3h". */
  quietFor?: string | null;
}) {
  const { label, icon: Icon, tone } = STATUS[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${tone}`}
    >
      <Icon className="size-3" aria-hidden />
      {quietFor ? `${label} ${quietFor}` : label}
    </span>
  );
}

export function RuntimeRow({
  runtime: r,
  now,
  feed,
  lastSeenAt,
}: {
  runtime?: Runtime;
  now: number;
  feed: FeedInfo;
  lastSeenAt: number | null;
}) {
  if (!r) {
    return (
      <div className="mt-4 flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs text-muted-foreground">
        <CircleHelp className="size-3.5" aria-hidden />
        Runtime not reported
      </div>
    );
  }
  const running = r.state === "running";
  // ponytail: the feed's last_turn is always null today (Desktop logs no
  // per-turn line), so fall back to the relay's last message time.
  const turn = r.lastTurn ?? lastSeenAt;
  return (
    <div className="mt-4 flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs">
      <p className="min-w-0 truncate">
        <span
          className={`mr-1.5 inline-block size-2 ${running ? "rounded-full bg-success" : "rounded-[2px] bg-muted-foreground/60"}`}
          aria-hidden
        />
        <span
          className={
            running ? "font-medium text-success" : "text-muted-foreground"
          }
        >
          {running ? "Running" : "Stopped"}
        </span>
        <span className="text-muted-foreground tabular-nums">
          {" · "}
          {running
            ? `up ${formatAge((now - r.since) * 1000)}`
            : ago(now - r.since)}
        </span>
        {feed?.stale && (
          <span className="text-warning tabular-nums">
            {" · as of "}
            {ago(now - feed.publishedAt)}
          </span>
        )}
      </p>
      <p className="shrink-0 text-muted-foreground">
        {r.lastTurn === null ? "Last seen" : "Last turn"}{" "}
        <span className="text-foreground tabular-nums">
          {turn === null ? "none" : ago(now - turn)}
        </span>
      </p>
    </div>
  );
}

// The card → agent page morph (DESIGN.md → Motion). `default="none"` keeps
// these from crossfading on every other transition; `share` keeps the pair.
export function Morph({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  return (
    <ViewTransition name={name} share="morph" default="none">
      {children}
    </ViewTransition>
  );
}

export function Avatar({
  agent: a,
  className = "size-10 text-xs",
}: {
  agent: Agent;
  /** Size and initials text size. */
  className?: string;
}) {
  // Relay-hosted pictures need auth, so fall back to initials when one fails.
  const [failed, setFailed] = useState(false);
  if (a.picture && !failed) {
    return (
      // biome-ignore lint/performance/noImgElement: a remote profile picture at 40px; next/image would need every host allow-listed.
      <img
        src={a.picture}
        alt=""
        className={`shrink-0 rounded-full bg-muted object-cover ${className}`}
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  const initials = a.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2);
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-muted font-medium ${className}`}
      aria-hidden
    >
      {initials}
    </span>
  );
}

// ponytail: a 7-bar SVG copied from the mockup, not a Recharts BarChart. It has
// no axes, tooltip or legend to justify the dependency. Swap it in when
// Pipeline or Timeline adds Recharts.
function Sparkline({ values, warn }: { values: number[]; warn: boolean }) {
  const max = Math.max(1, ...values);
  const [w, gap, h] = [8, 3, 28];
  return (
    <svg
      width={values.length * (w + gap)}
      height={h}
      role="img"
      aria-label={`Messages per day, last 7 days: ${values.join(", ")}`}
      className="shrink-0"
    >
      {values.map((v, i) => {
        const bar = Math.max(2, (v / max) * h);
        return (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed 7-day series.
            key={i}
            x={i * (w + gap)}
            y={h - bar}
            width={w}
            height={bar}
            rx={2}
            fill={warn ? "var(--warning)" : "var(--chart-1)"}
            opacity={i === values.length - 1 ? 1 : 0.45}
          />
        );
      })}
    </svg>
  );
}
