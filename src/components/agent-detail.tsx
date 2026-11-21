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
import { EditProfile } from "@/components/agent-profile";
import { AgentSettings } from "@/components/agent-settings";
import {
  Avatar,
  type FeedInfo,
  Morph,
  RuntimeRow,
  StatusBadge,
} from "@/components/agents-view";
import { CopyButton } from "@/components/copy-button";
import { KpiCard } from "@/components/kpi-card";
import { AnimatedNumber } from "@/components/motion-primitives/animated-number";
import { ActivityChart, type Series } from "@/components/overview-charts";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatAge } from "@/lib/age";
import { agentSlug, agentStatus, type DayGroup, morphName } from "@/lib/agents";
import { formatDuration, median } from "@/lib/flow";
import type { Agent } from "@/lib/hive";
import { npubEncode } from "@/lib/npub";
import { countInto } from "@/lib/overview-range";
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
  turns,
  prs,
  buzzUrl,
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
  /** Signed in as the owner (the first admin): shows Agent settings and Edit profile. */
  admin?: boolean;
  /** Turns and errors per day for 30 days, or null without a source. */
  turns: { turns: number[]; errors: number[] } | null;
  /** The agent's PRs from GitHub, newest first, or null when it isn't read. */
  prs: AgentPr[] | null;
  /** BUZZ_WEB_URL, where Open channel goes, or null to hide it. */
  buzzUrl: string | null;
}) {
  const status = agentStatus(a, now, runtime);
  const week = a.daily.reduce((n, d) => n + d, 0);
  const days7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now * 1000);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (6 - i));
    return d.getTime() / 1000;
  });
  const opened7 = (prs ?? []).filter((p) => p.createdAt >= days7[0]);
  const medianMerge = median(
    (prs ?? [])
      .filter((p) => p.mergedAt !== null && p.mergedAt >= now - 7 * 86_400)
      .map((p) => (p.mergedAt as number) - p.createdAt),
  );
  const users = owners.map((o) => `user:${o}`).join(" ");
  const prsUrl =
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

      {/* DESIGN.md → Obsidian redesign → Agent page → Hero. The faint violet
          radial in the corner is part of the background glow. */}
      <Card
        className="flex-col items-center gap-6 p-6 text-center sm:flex-row sm:items-start sm:text-left"
        style={{
          backgroundImage:
            "radial-gradient(600px 300px at 0% 0%, rgb(124 108 255 / 0.12), transparent 60%)",
        }}
      >
        {/* Wrapped: Card drops its top padding when an img is the first child. */}
        <div className="shrink-0">
          <Morph name={morphName("avatar", agentSlug(a.name))}>
            <Avatar
              agent={a}
              className="size-[132px] rounded-[32px]! text-4xl ring-1 ring-border"
            />
          </Morph>
        </div>
        <div className="w-full min-w-0 space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
                <Morph name={morphName("name", agentSlug(a.name))}>
                  <h1 className="text-[40px] leading-tight font-bold tracking-[-0.025em]">
                    {a.name}
                  </h1>
                </Morph>
                <StatusBadge status={status} />
              </div>
              <p className="text-muted-foreground">
                {a.role && `${a.role} · `}
                <span className="font-mono text-sm">@{a.name}</span> in PR
                headers
              </p>
              <MetaRow agent={a} runtime={runtime} now={now} />
            </div>
            {(buzzUrl || prs !== null || prsUrl || admin) && (
              <div className="grid grid-cols-1 gap-2 sm:flex sm:shrink-0">
                {buzzUrl && (
                  <OutLink href={buzzUrl} solid>
                    Open channel
                  </OutLink>
                )}
                {prsUrl && <OutLink href={prsUrl}>PRs</OutLink>}
                {admin && <EditProfile agent={a} />}
              </div>
            )}
          </div>
          <RuntimeRow
            runtime={runtime}
            now={now}
            feed={feed}
            lastSeenAt={a.lastSeenAt}
          />
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          kpi={{
            label: "Messages today",
            icon: MessageSquare,
            tone: "violet",
            value: <AnimatedNumber value={a.messagesToday} />,
            sub: `${week} this week`,
            spark: a.daily,
            delta: null,
          }}
        />
        <KpiCard
          kpi={{
            label: "PRs opened (7d)",
            icon: GitPullRequest,
            tone: "cyan",
            value: prs ? String(opened7.length) : "–",
            sub: prs
              ? `${opened7.filter((p) => p.mergedAt !== null).length} merged`
              : "GitHub isn't connected",
            spark: prs
              ? countInto(
                  days7,
                  opened7.map((p) => p.createdAt),
                )
              : null,
            delta: null,
          }}
        />
        <KpiCard
          kpi={{
            label: "Open claims",
            icon: TicketCheck,
            tone: "pink",
            value: "–",
            sub: "Not read on this page yet",
            spark: null,
            delta: null,
          }}
        />
        <KpiCard
          kpi={{
            label: "Median PR to merge",
            icon: Timer,
            tone: "green",
            value: medianMerge === null ? "–" : formatDuration(medianMerge),
            sub: "Last 7 days",
            spark: null,
            delta: null,
          }}
        />
      </div>

      {/* Two columns at xl. Below that the wrappers dissolve (`contents`) so
          `order` can interleave them: claims first, then runtime and PRs. */}
      <div className="flex flex-col gap-4 xl:grid xl:grid-cols-3 xl:items-start">
        <div className="contents xl:col-span-2 xl:flex xl:flex-col xl:gap-4">
          <Section title="Open claims" className="order-1 xl:order-none">
            <NotRead what="Claims" />
          </Section>
          <TurnsAndErrors daily={activity ?? a.daily} turns={turns} now={now} />
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
            title={hasMerges(prs, now) ? "Recent merges" : "Recent PRs"}
            className="order-3 xl:order-none"
            action={prsUrl && <OutLink href={prsUrl}>All on GitHub</OutLink>}
          >
            <RecentPrs prs={prs} now={now} />
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

function OutLink({
  href,
  solid = false,
  children,
}: {
  href: string;
  /** Solid violet, no glow (Open channel). Otherwise outline. */
  solid?: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex h-11 items-center justify-center gap-1.5 rounded-[10px] px-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-9 ${solid ? "bg-primary text-primary-foreground hover:bg-primary/80" : "border hover:bg-muted"}`}
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

/**
 * DESIGN.md → Obsidian redesign → Agent page → Turns and errors, in the Hive
 * activity style. Messages stay as the first line so the chart says something
 * without a turn source. Latency has no source in v1.
 */
function TurnsAndErrors({
  daily,
  turns,
  now,
}: {
  /** Messages per day, oldest first: 30 entries, or 7 if that query failed. */
  daily: number[];
  turns: { turns: number[]; errors: number[] } | null;
  now: number;
}) {
  const ranges = RANGES.filter((r) => r <= daily.length);
  const [pick, setRange] = useState<number>(14);
  const range = ranges.includes(pick as (typeof RANGES)[number])
    ? pick
    : ranges[ranges.length - 1];
  const labels = Array.from({ length: range }, (_, i) =>
    new Date((now - (range - 1 - i) * 86_400) * 1000).toLocaleDateString(
      "en-US",
      { month: "short", day: "numeric" },
    ),
  );
  const series: Series[] = [
    {
      label: "Messages",
      color: "var(--series-1)",
      values: daily.slice(-range),
    },
    {
      label: "Turns",
      color: "var(--series-2)",
      values: turns?.turns.slice(-range) ?? null,
    },
    {
      label: "Errors",
      color: "var(--series-3)",
      values: turns?.errors.slice(-range) ?? null,
    },
    { label: "Latency", color: "var(--muted-foreground)", values: null },
  ];
  return (
    <Section
      title="Turns and errors"
      note={`Per day, last ${range} days`}
      className="order-4 xl:order-none"
      action={
        ranges.length > 1 && (
          <ToggleGroup
            variant="outline"
            aria-label="Range"
            spacing={0}
            value={[String(range)]}
            onValueChange={(v) => v[0] && setRange(Number(v[0]))}
          >
            {ranges.map((r) => (
              <ToggleGroupItem
                key={r}
                value={String(r)}
                className="h-9 px-3 tabular-nums"
              >
                {r}d
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )
      }
    >
      <ActivityChart series={series} labels={labels} height={180} />
    </Section>
  );
}

/** A PR the agent's `@Name` header claims, slimmed for the browser. */
export type AgentPr = {
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  /** Unix seconds. */
  createdAt: number;
  mergedAt: number | null;
  closedAt: number | null;
  /** GitHub logins of its reviewers, deduplicated, author excluded. */
  reviewers: string[];
};

const MERGES_WITHIN_S = 14 * 86_400;
const hasMerges = (prs: AgentPr[] | null, now: number) =>
  (prs ?? []).some(
    (p) => p.mergedAt !== null && p.mergedAt >= now - MERGES_WITHIN_S,
  );
const prKey = (p: AgentPr) => `${p.repo.split("/").pop()}#${p.number}`;

/**
 * Recent merges (a merged PR in the last 14 days) or Recent PRs: the last 5
 * PRs whose body names `@Name`, the same attribution as Pipeline.
 */
function RecentPrs({ prs, now }: { prs: AgentPr[] | null; now: number }) {
  if (prs === null) return <NotRead what="PRs" />;
  if (prs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No PRs in the last 30 days.
      </p>
    );
  }
  if (hasMerges(prs, now)) {
    const merged = prs
      .filter((p) => p.mergedAt !== null && p.mergedAt >= now - MERGES_WITHIN_S)
      .slice(0, 5);
    const longest = Math.max(
      1,
      ...merged.map((p) => (p.mergedAt as number) - p.createdAt),
    );
    return (
      <ul className="space-y-3 text-sm">
        {merged.map((p) => {
          const took = (p.mergedAt as number) - p.createdAt;
          return (
            <li key={p.url} className="space-y-1.5">
              <a
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="block truncate outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="font-mono text-[13px] text-series-1">
                  {prKey(p)}
                </span>{" "}
                {p.title}
              </a>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="truncate font-mono">{p.repo}</span>
                <Reviewers logins={p.reviewers} />
                <span className="ml-auto rounded-full bg-success/12 px-2 py-0.5 font-medium text-success">
                  Merged
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-chip" aria-hidden>
                  <div
                    className="h-full rounded-full bg-series-1"
                    style={{ width: `${Math.max(4, (took / longest) * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  <span className="sr-only">open to merged in </span>
                  {formatDuration(took)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <ul className="space-y-2.5 text-sm">
      {prs.slice(0, 5).map((p) => {
        const state =
          p.mergedAt !== null
            ? "merged"
            : p.closedAt !== null
              ? "closed"
              : "open";
        return (
          <li key={p.url} className="flex items-center gap-2">
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATE_PILL[state]}`}
            >
              {state}
            </span>
            <a
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {p.title}
            </a>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {prKey(p)}
            </span>
            <span className="shrink-0 text-xs text-faint tabular-nums">
              {formatAge((now - p.createdAt) * 1000)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const STATE_PILL = {
  open: "bg-info/12 text-info",
  merged: "bg-success/12 text-success",
  closed: "bg-chip text-muted-foreground",
} as const;

function Reviewers({ logins }: { logins: string[] }) {
  if (logins.length === 0) {
    return (
      <span>
        –<span className="sr-only">no reviewers</span>
      </span>
    );
  }
  return (
    <span className="flex -space-x-1.5">
      {logins.slice(0, 4).map((l) => (
        // biome-ignore lint/performance/noImgElement: a GitHub avatar at 20px; next/image would need the host allow-listed.
        <img
          key={l}
          src={`https://github.com/${encodeURIComponent(l)}.png?size=40`}
          alt={l}
          title={l}
          className="size-5 rounded-full bg-chip ring-2 ring-card"
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      ))}
    </span>
  );
}

/** Home #channel, Model, Uptime and the truncated npub, in the hero. */
function MetaRow({
  agent: a,
  runtime: r,
  now,
}: {
  agent: Agent;
  runtime?: Runtime;
  now: number;
}) {
  const npub = npubEncode(a.pubkeys[0]);
  const items: [string, ReactNode][] = [
    ...(a.homeChannel
      ? ([
          [
            "Home",
            <span key="h" className="font-mono">
              #{a.homeChannel}
            </span>,
          ],
        ] as [string, ReactNode][])
      : []),
    ...(r?.model
      ? ([
          [
            "Model",
            <span key="m" className="font-mono">
              {r.model}
            </span>,
          ],
        ] as [string, ReactNode][])
      : []),
    ...(r?.state === "running"
      ? ([["Uptime", formatAge((now - r.since) * 1000)]] as [
          string,
          ReactNode,
        ][])
      : []),
    [
      "npub",
      <span key="n" className="font-mono" title={npub}>
        {npub.slice(0, 12)}…{npub.slice(-4)}
      </span>,
    ],
  ];
  return (
    <dl className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs sm:justify-start">
      {items.map(([k, v]) => (
        <div key={k} className="flex gap-1.5">
          <dt className="text-muted-foreground">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
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
