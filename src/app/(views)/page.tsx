import { cn } from "cn";
import {
  ArrowRight,
  Bot,
  Coins,
  GitMerge,
  MessageSquare,
  OctagonAlert,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Avatar } from "@/components/agents-view";
import { type Kpi, KpiCard } from "@/components/kpi-card";
import {
  ActivityChart,
  Donut,
  Heatmap,
  type Series,
} from "@/components/overview-charts";
import {
  Greeting,
  OpenOnRedirect,
  OverviewAgents,
  OverviewRangeToggle,
} from "@/components/overview-client";
import { Card } from "@/components/ui/card";
import { formatAge } from "@/lib/age";
import { agentStatus, runtimeFor } from "@/lib/agents";
import { formatTokens, formatUsd } from "@/lib/cost";
import { costConnected } from "@/lib/cost-source";
import {
  type FlowPr,
  formatDuration,
  median,
  mergedIn,
  toPrs,
} from "@/lib/flow";
import { type GitHub, loadGitHub } from "@/lib/github";
import { SLOT_S, SOURCE_KINDS } from "@/lib/health";
import { healthSource, loadFailing } from "@/lib/health-data";
import {
  costByDay,
  costSince,
  countEvents,
  countEventsByDay,
  countEventsByWeekHour,
  healthBuckets,
  historyEnabled,
  listEvents,
  prEvents,
  retentionDays,
} from "@/lib/history";
import { type Agent, type Hive, loadHive } from "@/lib/hive";
import { githubRows } from "@/lib/ingest";
import { getNeedsYou } from "@/lib/needs-you";
import { npubEncode } from "@/lib/npub";
import {
  bucketsFor,
  countInto,
  delta,
  heatStep,
  OVERVIEW_RANGES,
  type OverviewRange,
  parseRange,
  peakCell,
  rangesFor,
  type Spend,
  spendByModel,
  stageCounts,
  sumInto,
  turnSeries,
  weekHourGrid,
} from "@/lib/overview";
import { dayName, hourLabel } from "@/lib/overview-range";
import { loadRequestScope } from "@/lib/project-data";
import { scopeNeedsYou } from "@/lib/project-scope";
import { one } from "@/lib/query";
import { loadStatusFeed, type Runtime } from "@/lib/status-feed";
import { liveEvents, type Names, type Row, toRow } from "@/lib/timeline";

export const metadata: Metadata = { title: "Overview · Hive" };

const DAY_S = 86_400;
// Day and hour labels follow the server clock, like "Today" on the other views.
const dayLabel = (at: number) =>
  new Date(at * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
const hourOf = (at: number) => hourLabel(new Date(at * 1000).getHours(), true);

// DESIGN.md → Obsidian redesign → Overview. Each section reads one named
// source and shows nothing when that source isn't connected.
export default async function OverviewPage({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const history = historyEnabled();
  const range = parseRange(one(params.range), history);
  const nowD = new Date();
  const now = Math.floor(nowD.getTime() / 1000);
  const buckets = bucketsFor(range, nowD);
  const starts = buckets.starts;
  const span = range === "24h" ? DAY_S : OVERVIEW_RANGES[range] * DAY_S;
  const from = range === "24h" ? now - DAY_S : starts[0];
  const prevFrom = from - span;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [{ hive }, { feed }, { github }, needsYou, costOn, source, { scope }] =
    await Promise.all([
      loadHive(),
      loadStatusFeed(),
      loadGitHub(),
      getNeedsYou(),
      costConnected().catch(() => false),
      healthSource().catch(() => null),
      loadRequestScope(params),
    ]);
  // The layout already shows the relay's Alert.
  if (!hive) return <OpenOnRedirect />;

  const agentTimes = hive.agents.flatMap((a) => a.messages.map((m) => m.at));
  const reads = await readHistory({
    history,
    range,
    from,
    prevFrom,
    now,
    timeZone,
    costOn,
    source,
  });

  // Messages: the relay covers 7 days, so 24h (and 7d without the store) read
  // it; 30d and 90d read the history store.
  // The agents' per-day counts, the same numbers the Agents view shows. They
  // cover the 7 days of dayStarts, oldest first.
  const daily = hive.agents.reduce(
    (sum, a) => sum.map((n, i) => n + (a.daily[i] ?? 0)),
    [0, 0, 0, 0, 0, 0, 0],
  );
  const msgSeries =
    reads.messagesByDay && range !== "24h" && range !== "7d"
      ? sumInto(starts, reads.messagesByDay)
      : range === "7d"
        ? daily
        : countInto(starts, agentTimes);
  const msgTotal = msgSeries.reduce((a, b) => a + b, 0);
  const msgPrev = !history
    ? null
    : range === "24h"
      ? agentTimes.filter((t) => t >= prevFrom && t < from).length
      : reads.messagesPrev;

  // PRs merged: GitHub, through the store's flow events when there is one.
  const merged = reads.prs
    ? mergedIn(reads.prs, from, now + 1).map((p) => p.merged as number)
    : (github?.prs ?? []).flatMap((p) =>
        p.mergedAt !== null && p.mergedAt >= from ? [p.mergedAt] : [],
      );
  const mergedPrev =
    reads.prs && reads.prevKept
      ? mergedIn(reads.prs, prevFrom, from).length
      : null;
  const medianMerge = reads.prs
    ? median(
        mergedIn(reads.prs, from, now + 1).map(
          (p: FlowPr) => (p.merged as number) - p.opened,
        ),
      )
    : null;

  const runtimes: Record<string, Runtime> = {};
  for (const a of hive.agents) {
    const r = feed && runtimeFor(a, feed.runtime);
    if (r) runtimes[a.name] = r;
  }
  const active = hive.agents.filter(
    (a) => agentStatus(a, now, runtimes[a.name]) === "active",
  ).length;
  // Agents that posted each day, from the same per-day counts.
  const activePerDay = daily.map(
    (_, i) => hive.agents.filter((a) => (a.daily[i] ?? 0) > 0).length,
  );
  const labels = starts.map(buckets.unit === "hour" ? hourOf : dayLabel);
  const activity: Series[] = [
    { label: "Messages", color: "var(--series-1)", values: msgSeries },
    {
      label: "Agent turns",
      color: "var(--series-2)",
      values: reads.turns?.turns ?? null,
    },
    {
      label: "Errors",
      color: "var(--series-3)",
      values: reads.turns?.errors ?? null,
    },
  ];

  const grid = reads.weekHour
    ? reads.weekHour
    : weekHourGrid(agentTimes.filter((t) => t >= now - 7 * DAY_S));
  const peak = peakCell(grid);
  const max = Math.max(0, ...grid.flat());
  const steps = grid.map((r) => r.map((n) => heatStep(n, max)));

  const failing = reads.failing;
  const working = hive.agents.filter((a) => a.messagesToday > 0).length;
  const today = new Date(nowD).setHours(0, 0, 0, 0) / 1000;
  const channels = new Set([
    ...hive.feed.filter((f) => f.isAgent && f.channel).map((f) => f.channel),
    ...hive.agents.flatMap((a) =>
      a.messages
        .filter((m) => m.at >= today && m.channel)
        .map((m) => m.channel),
    ),
  ]).size;
  // The greeting's count follows a picked project (#167), like the card.
  const needs = scopeNeedsYou(needsYou.rows, scope).length;
  const rangeLabel = range;

  const kpis: Kpi[] = [
    {
      label: "Active agents · now",
      icon: Bot,
      tone: "violet",
      value: String(active),
      spark: activePerDay,
      // "Now" has no previous period of the same length.
      delta: null,
    },
    {
      label: `Messages · ${rangeLabel}`,
      icon: MessageSquare,
      tone: "cyan",
      value: msgTotal.toLocaleString("en-US"),
      spark: msgSeries,
      delta: history ? delta(msgTotal, msgPrev) : null,
    },
    {
      label: `PRs merged · ${rangeLabel}`,
      icon: GitMerge,
      tone: "green",
      value: String(merged.length),
      spark: countInto(starts, merged),
      delta: history ? delta(merged.length, mergedPrev) : null,
    },
  ];
  if (reads.cost) {
    kpis.push({
      label: `Est. cost · ${rangeLabel}`,
      icon: Coins,
      tone: "pink",
      value: formatUsd(reads.cost.total),
      spark: reads.cost.series,
      delta: delta(reads.cost.total, reads.cost.prev),
      neutral: true,
    });
  }

  return (
    <div className="space-y-6">
      <OpenOnRedirect />
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="mr-auto space-y-1">
          <Greeting />
          <p className="text-sm text-muted-foreground">
            {plural(working, "agent")} working across{" "}
            {plural(channels, "channel")}
            {". "}
            {needs === 0
              ? "Nothing needs a look."
              : `${needs === 1 ? "One" : needs} ${needs === 1 ? "needs" : "need"} a look.`}
          </p>
        </div>
        <OverviewRangeToggle range={range} ranges={rangesFor(history)} />
      </div>

      <div
        className={cn(
          "grid grid-cols-2 gap-4",
          kpis.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3",
        )}
      >
        {kpis.map((k) => (
          <KpiCard key={k.label} kpi={k} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          className={cn(
            "gap-4 p-5",
            reads.spend ? "lg:col-span-2" : "lg:col-span-3",
          )}
        >
          <div>
            <h2 className="font-semibold">Hive activity</h2>
            <p className="text-xs text-muted-foreground">
              {buckets.unit === "hour"
                ? "Per hour, last 24 hours"
                : `Per day, last ${range}`}
            </p>
          </div>
          <ActivityChart series={activity} labels={labels} />
        </Card>
        {reads.spend && <SpendCard spend={reads.spend} range={range} />}
      </div>

      <OverviewAgents
        agents={hive.agents}
        now={now}
        runtimes={runtimes}
        failing={failing}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <LiveFeed
          rows={reads.live ?? liveRows(hive, github, now)}
          hive={hive}
          now={now}
        />
        <PipelineCard github={github} median={medianMerge} history={history} />
        <Card className="gap-4 p-5">
          <div>
            <h2 className="font-semibold">When the hive works</h2>
            <p className="text-xs text-muted-foreground">
              {reads.weekHour
                ? `Average per weekday and hour, last ${range}`
                : "Messages by weekday and hour, last 7 days"}
            </p>
          </div>
          <Heatmap
            grid={grid}
            steps={steps}
            unit={reads.weekHour ? "messages on average" : "messages"}
          />
          <p className="text-sm text-muted-foreground">
            {peak
              ? `Busiest: ${dayName(peak.day)} ${hourLabel(peak.hour, false)}`
              : "No messages yet."}
          </p>
        </Card>
      </div>
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

type HistoryReads = {
  messagesByDay: { at: number; value: number }[] | null;
  messagesPrev: number | null;
  prs: FlowPr[] | null;
  turns: { turns: number[]; errors: number[] } | null;
  cost: { total: number; prev: number | null; series: number[] } | null;
  spend: Spend | null;
  weekHour: number[][] | null;
  live: Row[] | null;
  failing: string[];
  /**
   * False when the previous period reaches past HISTORY_RETENTION_DAYS: the
   * store has pruned it, so a delta would compare against nothing.
   */
  prevKept: boolean;
};

// Every store read the Overview makes. A failed read leaves its section out,
// like a source that isn't connected, and never takes the page down.
async function readHistory(o: {
  history: boolean;
  range: OverviewRange;
  from: number;
  prevFrom: number;
  now: number;
  timeZone: string;
  costOn: boolean;
  source: Awaited<ReturnType<typeof healthSource>>;
}): Promise<HistoryReads> {
  const out: HistoryReads = {
    messagesByDay: null,
    messagesPrev: null,
    prs: null,
    turns: null,
    cost: null,
    spend: null,
    weekHour: null,
    live: null,
    failing: [],
    prevKept: o.prevFrom >= o.now - retentionDays() * DAY_S,
  };
  const date = (s: number) => new Date(s * 1000);
  const starts = bucketsFor(o.range, date(o.now)).starts;
  const tasks: Promise<unknown>[] = [];
  const attempt = (what: string, fn: () => Promise<void>) =>
    tasks.push(fn().catch((err) => console.error(`Overview, ${what}:`, err)));

  if (o.source) {
    const source = o.source;
    attempt("turns", async () => {
      const b = await healthBuckets(
        date(o.from - SLOT_S),
        SOURCE_KINDS[source],
      );
      out.turns = turnSeries(b, starts);
    });
    attempt("failing", async () => {
      const f = await loadFailing(o.now, source);
      out.failing = f?.failing.map((a) => a.agent) ?? [];
    });
  }
  if (o.history) {
    const buzz = { source: "buzz" as const, kinds: ["message"] };
    attempt("messages", async () => {
      const [days, prev] = await Promise.all([
        countEventsByDay({ ...buzz, since: date(o.from) }, o.timeZone),
        countEvents({ ...buzz, since: date(o.prevFrom), until: date(o.from) }),
      ]);
      out.messagesByDay = days.map((d) => ({
        at: d.day.getTime() / 1000,
        value: d.count,
      }));
      out.messagesPrev = out.prevKept ? prev : null;
    });
    attempt("PRs", async () => {
      out.prs = toPrs(await prEvents(date(o.prevFrom - 30 * DAY_S)));
    });
    if (o.range === "30d" || o.range === "90d") {
      attempt("heatmap", async () => {
        const cells = await countEventsByWeekHour(
          { ...buzz, since: date(o.from) },
          o.timeZone,
        );
        const weeks = OVERVIEW_RANGES[o.range] / 7;
        const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
        for (const c of cells)
          grid[c.dow][c.hour] = Math.round((c.count / weeks) * 10) / 10;
        out.weekHour = grid;
      });
    }
    attempt("live feed", async () => {
      out.live = await historyLive();
    });
  }
  if (o.costOn) {
    attempt("cost", async () => {
      // Daily rows can't fill hourly buckets, so at 24h the sparkline shows 7 days.
      const sparkStarts =
        o.range === "24h" ? bucketsFor("7d", date(o.now)).starts : starts;
      const since = Math.min(o.from, sparkStarts[0]);
      const [rows, upToNow, sincePrev] = await Promise.all([
        costByDay(date(since), o.timeZone),
        costSince(date(o.from)),
        costSince(date(o.prevFrom)),
      ]);
      // Cost rows are per local day, so the donut covers whole days from the
      // range's first one. The KPI reads the exact window.
      const fromDay = new Date(o.from * 1000).setHours(0, 0, 0, 0) / 1000;
      out.spend = spendByModel(
        rows.filter((r) => r.day.getTime() / 1000 >= fromDay),
      );
      out.cost = {
        total: upToNow,
        prev: out.prevKept ? sincePrev - upToNow : null,
        series: sumInto(
          sparkStarts,
          rows
            .filter((r) => r.metric === "cost")
            .map((r) => ({ at: r.day.getTime() / 1000, value: r.value })),
        ),
      };
    });
  }
  await Promise.all(tasks);
  return out;
}

// The latest 6 Timeline events, from the store.
async function historyLive(): Promise<Row[] | null> {
  const [events, { hive }] = await Promise.all([
    listEvents({ limit: 6 }),
    loadHive(),
  ]);
  return events.map((e) => toRow(e, names(hive)));
}

// Without the store: the Timeline's live feed, today's GitHub and relay rows.
function liveRows(hive: Hive, github: GitHub | null, now: number): Row[] {
  const today = new Date(now * 1000).setHours(0, 0, 0, 0) / 1000;
  return liveEvents(github ? githubRows(github) : [], hive.feed, today)
    .slice(0, 6)
    .map((e) => toRow(e, { ...names(hive), channel: (name) => name }));
}

function names(hive: Hive | null): Names {
  const byKey = new Map(
    (hive?.agents ?? []).flatMap((a) => a.pubkeys.map((k) => [k, a.name])),
  );
  return {
    actor: (raw) => {
      const name = byKey.get(raw);
      if (name) return name;
      if (!/^[0-9a-f]{64}$/.test(raw)) return raw;
      const npub = npubEncode(raw);
      return `${npub.slice(0, 10)}…${npub.slice(-4)}`;
    },
    channel: (id) => hive?.channels[id] ?? null,
  };
}

function SpendCard({ spend, range }: { spend: Spend; range: OverviewRange }) {
  const colors = ["var(--model-1)", "var(--model-2)", "var(--model-3)"];
  const tiers = [0, 1, 2].filter((t) => spend.byTier[t] > 0 || spend.names[t]);
  const sum = spend.byTier[0] + spend.byTier[1] + spend.byTier[2];
  return (
    <Card className="gap-4 p-5">
      <div>
        <h2 className="font-semibold">Spend by model</h2>
        <p className="text-xs text-muted-foreground">Estimated, last {range}</p>
      </div>
      <Donut
        values={spend.byTier}
        colors={colors}
        center={formatUsd(spend.total)}
        sub="est."
      />
      <ul className="space-y-2 text-sm">
        {tiers.map((t) => (
          <li key={t} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: colors[t] }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
              {spend.names[t] || "other"}
            </span>
            <span className="tabular-nums">{formatUsd(spend.byTier[t])}</span>
            <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
              {sum ? Math.round((spend.byTier[t] / sum) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-2 gap-2 border-t pt-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Cache hit</dt>
          <dd className="font-semibold tabular-nums">
            {spend.cacheHit === null
              ? "–"
              : `${Math.round(spend.cacheHit * 100)}%`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Tokens</dt>
          <dd className="font-semibold tabular-nums">
            {formatTokens(spend.tokens)}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

function LiveFeed({
  rows,
  hive,
  now,
}: {
  rows: Row[];
  hive: Hive;
  now: number;
}) {
  const byName = new Map(hive.agents.map((a) => [a.name, a]));
  return (
    <Card className="gap-3 p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Live feed</h2>
        <Link
          href="/timeline"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          Open Timeline
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing yet today.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const agent: Agent | undefined = byName.get(r.actor);
            return (
              <li key={r.id} className="flex gap-2.5 text-sm">
                {agent ? (
                  <Avatar agent={agent} className="size-7 text-[10px]" />
                ) : (
                  <span
                    className="size-7 shrink-0 rounded-full bg-chip"
                    aria-hidden
                  />
                )}
                <p className="min-w-0 flex-1">
                  <span className="font-medium">{r.actor}</span>{" "}
                  <span className="text-muted-foreground">{r.verb}</span>{" "}
                  {r.target && (
                    <span className="font-mono text-[13px] text-series-1">
                      {r.target}
                    </span>
                  )}
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.snippet}
                  </span>
                </p>
                <span className="shrink-0 text-xs text-faint tabular-nums">
                  {formatAge(Math.max(0, now - r.at) * 1000)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function PipelineCard({
  github,
  median: med,
  history,
}: {
  github: GitHub | null;
  median: number | null;
  history: boolean;
}) {
  const stages = stageCounts(github?.claims ?? []);
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <Card className="gap-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">PR pipeline</h2>
        <Link
          href="/pipeline"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          Pipeline
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      {!github ? (
        <p className="text-sm text-muted-foreground">
          GitHub isn&apos;t connected.
        </p>
      ) : (
        <ul className="space-y-3">
          {stages.map((s) => {
            const blocked = s.label === "ai-blocked";
            return (
              <li key={s.label} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 font-mono text-[13px]">
                    {blocked && s.count > 0 && (
                      <OctagonAlert
                        className="size-3.5 text-destructive"
                        aria-hidden
                      />
                    )}
                    {s.label}
                  </span>
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      blocked && s.count > 0 && "text-destructive",
                    )}
                  >
                    {s.count}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-chip" aria-hidden>
                  <div
                    className="h-full rounded-full bg-series-1"
                    style={{ width: `${(s.count / max) * 100}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {history && med !== null && (
        <p className="border-t pt-3 text-sm text-muted-foreground">
          Median open → merged{" "}
          <span className="font-semibold text-foreground">
            {formatDuration(med)}
          </span>
        </p>
      )}
    </Card>
  );
}
