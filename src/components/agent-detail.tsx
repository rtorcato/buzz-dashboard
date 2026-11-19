"use client";

import {
  ArrowLeft,
  CircleHelp,
  ExternalLink,
  GitPullRequest,
  MessageSquare,
  PlugZap,
  TicketCheck,
  Timer,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { AgentMessages } from "@/components/agent-messages";
import { AgentSettings } from "@/components/agent-settings";
import {
  Avatar,
  type FeedInfo,
  Morph,
  RuntimeRow,
  Stat,
  StatusBadge,
} from "@/components/agents-view";
import { CopyButton } from "@/components/copy-button";
import { AnimatedNumber } from "@/components/motion-primitives/animated-number";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Card } from "@/components/ui/card";
import { formatAge } from "@/lib/age";
import { agentSlug, agentStatus, type DayGroup, morphName } from "@/lib/agents";
import type { Agent } from "@/lib/hive";
import { npubEncode } from "@/lib/npub";
import type { Runtime } from "@/lib/status-feed";

const STATE_LABEL = {
  running: "Running",
  stopped: "Stopped",
  // Goose agents run per turn, so they have no on/off state.
  unknown: "Not reported",
} as const;

// DESIGN.md → "Agent page" (#27). Read-only: every action is an outbound link.
// Claims and PRs aren't read on this page yet, so those sections say so.

const ago = (s: number) => (s < 60 ? "just now" : `${formatAge(s * 1000)} ago`);

export function AgentDetail({
  agent: a,
  now,
  runtime,
  feed,
  groups,
  activity,
  owners,
  admin = false,
}: {
  agent: Agent;
  now: number;
  runtime?: Runtime;
  feed: FeedInfo;
  /** The agent's messages by day, formatted on the server. */
  groups: DayGroup[];
  /** Messages per day for 30 days, oldest first, or null if the query failed. */
  activity: number[] | null;
  /** GITHUB_OWNERS; the PR links hide without it. */
  owners: string[];
  /** Signed in as the owner (the first admin): shows Agent settings. */
  admin?: boolean;
}) {
  const status = agentStatus(a, now, runtime);
  const week = a.daily.reduce((n, d) => n + d, 0);
  const users = owners.map((o) => `user:${o}`).join(" ");
  const prs =
    owners.length > 0
      ? `https://github.com/search?type=pullrequests&q=${encodeURIComponent(`${users} is:pr "@${a.name}"`)}`
      : null;

  return (
    <div className="space-y-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <Link
              href="/agents"
              className="inline-flex h-9 items-center gap-1.5 rounded-md outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <ArrowLeft className="size-4" aria-hidden />
              Agents
            </Link>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{a.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <Card className="flex-col items-center gap-6 p-6 text-center sm:flex-row sm:items-start sm:text-left">
        {/* Wrapped: Card drops its top padding when an img is the first child. */}
        <div className="shrink-0">
          <Morph name={morphName("avatar", agentSlug(a.name))}>
            <Avatar
              agent={a}
              className="size-28 text-4xl ring-1 ring-border sm:size-44 sm:text-5xl"
            />
          </Morph>
        </div>
        <div className="w-full min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
            <Morph name={morphName("name", agentSlug(a.name))}>
              <h1 className="text-3xl font-semibold tracking-tight">
                {a.name}
              </h1>
            </Morph>
            <StatusBadge status={status} />
          </div>
          <p className="text-muted-foreground">
            {a.role && `${a.role} · `}
            <span className="font-mono text-sm">@{a.name}</span> in PR headers
          </p>
          {prs && (
            <div className="grid grid-cols-1 gap-2 sm:flex">
              <OutLink href={prs}>PRs</OutLink>
            </div>
          )}
          <RuntimeRow
            runtime={runtime}
            now={now}
            feed={feed}
            lastSeenAt={a.lastSeenAt}
          />
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Messages today"
          icon={MessageSquare}
          value={<AnimatedNumber value={a.messagesToday} />}
          sub={`${week} this week`}
        />
        <Stat
          label="PRs opened (7d)"
          icon={GitPullRequest}
          value={<span className="text-muted-foreground">–</span>}
          sub="Needs the GitHub reader"
        />
        <Stat
          label="Open claims"
          icon={TicketCheck}
          value={<span className="text-muted-foreground">–</span>}
          sub="Needs the GitHub reader"
        />
        <Stat
          label="Median PR to merge"
          icon={Timer}
          value={<span className="text-muted-foreground">–</span>}
          sub="Needs the GitHub reader"
        />
      </div>

      {/* Two columns at xl. Below that the wrappers dissolve (`contents`) so
          `order` can interleave them: claims first, then runtime and PRs. */}
      <div className="flex flex-col gap-4 xl:grid xl:grid-cols-3 xl:items-start">
        <div className="contents xl:col-span-2 xl:flex xl:flex-col xl:gap-4">
          <Section title="Open claims" className="order-1 xl:order-none">
            <NotRead what="Claims" />
          </Section>
          <Activity daily={activity ?? a.daily} />
          <Section title="Messages" className="order-5 xl:order-none">
            <AgentMessages groups={groups} />
          </Section>
        </div>
        <div className="contents xl:flex xl:flex-col xl:gap-4">
          <Section title="Runtime" className="order-2 xl:order-none">
            <RuntimeDetail runtime={runtime} now={now} feed={feed} />
          </Section>
          {admin && (
            <AgentSettings
              name={a.name}
              className="order-2 xl:order-none"
              data={{
                model: runtime?.model ?? null,
                // ponytail: no feed field for effort; the relay config reader adds it.
                effort: null,
                source: feed
                  ? `From the status feed · as of ${ago(now - feed.publishedAt)}`
                  : "Not reported",
                stopped: runtime?.state === "stopped",
              }}
            />
          )}
          <Section
            title="Recent PRs"
            className="order-3 xl:order-none"
            action={prs && <OutLink href={prs}>All on GitHub</OutLink>}
          >
            <NotRead what="PRs" />
          </Section>
          <Section
            title="Where they talk"
            note="Last 7 days"
            className="order-6 xl:order-none"
          >
            <Channels groups={groups} />
          </Section>
          <Section title="Identity" className="order-7 xl:order-none">
            <Identity agent={a} />
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  note,
  action,
  className = "",
  children,
}: {
  title: string;
  note?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={`gap-4 p-5 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">{title}</h2>
          {note && <p className="text-sm text-muted-foreground">{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

function OutLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-11 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-9"
    >
      {children}
      <ExternalLink className="size-3.5" aria-hidden />
    </a>
  );
}

function NotRead({ what }: { what: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground">
      <PlugZap className="size-4 shrink-0" aria-hidden />
      <p>{what} aren&apos;t shown on this page yet.</p>
    </div>
  );
}

const RANGES = [7, 14, 30] as const;

// A range the data doesn't cover (the 30-day query failed) isn't offered.
function Activity({ daily }: { daily: number[] }) {
  const ranges = RANGES.filter((r) => r <= daily.length);
  const [range, setRange] = useState<number>(7);
  return (
    <Section
      title="Activity"
      note={`Messages per day, last ${range} days`}
      className="order-4 xl:order-none"
      action={
        ranges.length > 1 && (
          // The same toggle as the Agents filter. Phones always show 7 days.
          <fieldset className="hidden h-9 rounded-md border shadow-xs sm:inline-flex">
            <legend className="sr-only">Activity range</legend>
            {ranges.map((r, i) => (
              <button
                key={r}
                type="button"
                aria-pressed={range === r}
                onClick={() => setRange(r)}
                className={`flex min-w-9 items-center px-3 text-sm tabular-nums focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none ${i ? "border-l" : ""} ${range === r ? "bg-accent font-medium" : "text-muted-foreground hover:bg-muted"}`}
              >
                {r}d
              </button>
            ))}
          </fieldset>
        )
      }
    >
      <Bars values={daily.slice(-range)} />
    </Section>
  );
}

// ponytail: CSS bars, not a Recharts BarChart, like the cards' sparkline.
function Bars({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  // Counts above the bars only fit up to 14 of them; 30 use a tooltip.
  const labelled = values.length <= 14;
  return (
    <div
      className="flex h-32 items-end gap-1 sm:gap-2"
      role="img"
      aria-label={`Messages per day, last ${values.length} days: ${values.join(", ")}`}
    >
      {values.map((v, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed day series.
          key={i}
          title={labelled ? undefined : String(v)}
          // Phones show the last 7 days only (DESIGN.md → Rules).
          className={`flex-1 flex-col items-center gap-1 text-xs text-muted-foreground tabular-nums ${i < values.length - 7 ? "hidden sm:flex" : "flex"}`}
        >
          {labelled && v}
          <div
            className="w-full rounded-sm"
            style={{
              height: `${Math.max(2, (v / max) * 96)}px`,
              background:
                i === values.length - 1 ? "var(--chart-1)" : "var(--chart-3)",
            }}
          />
        </div>
      ))}
    </div>
  );
}

function RuntimeDetail({
  runtime: r,
  now,
  feed,
}: {
  runtime?: Runtime;
  now: number;
  feed: FeedInfo;
}) {
  if (!r || !feed) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CircleHelp className="size-4 shrink-0" aria-hidden />
        Not reported. The status feed has no runtime for this agent.
      </p>
    );
  }
  const rows: [string, ReactNode][] = [
    ["State", STATE_LABEL[r.state]],
    ...(r.state === "unknown"
      ? []
      : ([
          [r.state === "running" ? "Since" : "Stopped at", ago(now - r.since)],
        ] as [string, ReactNode][])),
    ["Last turn", r.lastTurn === null ? "Not reported" : ago(now - r.lastTurn)],
    [
      "Model",
      <span key="model" className="font-mono text-xs">
        {r.model ?? "–"}
      </span>,
    ],
  ];
  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <p
        className={`border-t pt-3 text-xs ${feed.stale ? "text-warning" : "text-muted-foreground"}`}
      >
        From the status feed · as of {ago(now - feed.publishedAt)}
      </p>
    </>
  );
}

function Channels({ groups }: { groups: DayGroup[] }) {
  const counts = new Map<string, number>();
  for (const m of groups.flatMap((g) => g.items)) {
    if (m.channel) counts.set(m.channel, (counts.get(m.channel) ?? 0) + 1);
  }
  const top = [...counts].sort((x, y) => y[1] - x[1]).slice(0, 5);
  if (top.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No messages this week.</p>
    );
  }
  const max = top[0][1];
  return (
    <ul className="space-y-3 text-sm">
      {top.map(([channel, n]) => (
        <li key={channel} className="space-y-1">
          <div className="flex justify-between gap-3">
            <span className="truncate font-mono text-xs">#{channel}</span>
            <span className="tabular-nums text-muted-foreground">{n}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(n / max) * 100}%`,
                background: "var(--chart-3)",
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Identity({ agent: a }: { agent: Agent }) {
  const npub = npubEncode(a.pubkeys[0]);
  const older = a.pubkeys.length - 1;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs"
          title={npub}
        >
          {npub.slice(0, 16)}…{npub.slice(-6)}
        </span>
        <CopyButton value={npub} label="Copy npub" />
      </div>
      {(older > 0 || a.formerNames.length > 0) && (
        <p className="text-muted-foreground">
          {older > 0 &&
            `Also seen as ${older} older ${older === 1 ? "identity" : "identities"}`}
          {older > 0 && a.formerNames.length > 0 && " · "}
          {a.formerNames.length > 0 && `formerly ${a.formerNames.join(", ")}`}
        </p>
      )}
      {a.homeChannel && (
        <p className="text-muted-foreground">
          Home channel{" "}
          <span className="font-mono text-xs text-foreground">
            #{a.homeChannel}
          </span>
        </p>
      )}
    </div>
  );
}
