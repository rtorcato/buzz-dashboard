import { cn } from "cn";
import {
  ArrowRight,
  ChevronRight,
  Clock,
  Database,
  GitMerge,
  GitPullRequest,
  Hourglass,
  Layers2,
  type LucideIcon,
  MessageSquareDiff,
  OctagonAlert,
  Plus,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { FlowFilters, FlowSortSelect } from "@/components/pipeline-filters";
import { EmptyState, SourceDown } from "@/components/states";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  currentStep,
  DEFAULT_FLOW_RANGE,
  FLOW_RANGES,
  FLOW_SORTS,
  type FlowPr,
  type FlowRange,
  type FlowSort,
  formatDuration,
  type GroupRow,
  groupBy,
  isOpen,
  isStalled,
  STEP_WAITS,
  STEPS,
  slowestIndex,
  slowestStep,
  stepTimes,
  summarize,
  tableRows,
  toPrs,
  topLabels,
} from "@/lib/flow";
import { PR_WINDOW_DAYS } from "@/lib/github";
import {
  historyEnabled,
  historyStats,
  prEvents,
  retentionDays,
} from "@/lib/history";
import { loadRequestScope } from "@/lib/project-data";
import { eventScope, type Scope, withProject } from "@/lib/project-scope";
import { one, ownKey } from "@/lib/query";

export const metadata: Metadata = { title: "Pipeline · Hive" };

const TABLE_ROWS = 10;
/** The PRs table's bars share a fixed scale, so rows compare. */
const TABLE_SCALE_S = 3 * 86_400;
const STAGE_BG = ["bg-stage-1", "bg-stage-2", "bg-stage-3"];
const STAGE_FG = [
  "text-stage-1-foreground",
  "text-stage-2-foreground",
  "text-stage-3-foreground",
];
/** "Slowest step this week: {title}". */
const SLOW_TITLES = [
  "waiting for a first review",
  "review and changes",
  "approved, waiting to merge",
];

const shortDate = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

const initials = (name: string) =>
  name
    .split(/[\s-]+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

const dur = (s: number | null) => (s === null ? "—" : formatDuration(s));

// DESIGN.md → Views → Pipeline: a Now / Flow tab row. Links, not client
// tabs, so each tab is its own server render and URL.
function PipelineTabs({ flow, scope }: { flow: boolean; scope: Scope | null }) {
  const slugs = scope?.slugs ?? [];
  const tabs = [
    { label: "Now", href: withProject("/pipeline", slugs), active: !flow },
    {
      label: "Flow",
      href: withProject("/pipeline?tab=flow", slugs),
      active: flow,
    },
  ];
  return (
    <nav
      aria-label="Pipeline"
      className="inline-flex h-9 w-fit shrink-0 items-center rounded-lg bg-muted p-[3px] text-muted-foreground"
    >
      {tabs.map((t) => (
        <Link
          key={t.label}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={cn(
            "inline-flex h-full items-center rounded-md px-3 text-sm font-medium text-foreground/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
            t.active &&
              "bg-background text-foreground shadow-sm dark:border dark:border-input dark:bg-input/30",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export default async function PipelinePage({
  searchParams,
}: PageProps<"/pipeline">) {
  const params = await searchParams;
  const history = historyEnabled();
  const { scope } = await loadRequestScope(params);
  // Without a database there is no Flow tab (DESIGN.md:20), only Now.
  if (!history || one(params.tab) !== "flow") {
    return (
      <div className="space-y-6">
        <h2 className="sr-only">Pipeline</h2>
        {history && <PipelineTabs flow={false} scope={scope} />}
        {/* ponytail: placeholder until the Now view lands. */}
        <EmptyState icon={GitPullRequest} title="Pipeline is not built yet">
          ai-* label counts and PR throughput from GitHub.
        </EmptyState>
      </div>
    );
  }
  return <Flow params={params} scope={scope} />;
}

async function Flow({
  params,
  scope,
}: {
  params: Record<string, string | string[] | undefined>;
  scope: Scope | null;
}) {
  const range: FlowRange = ownKey(
    FLOW_RANGES,
    one(params.range),
    DEFAULT_FLOW_RANGE,
  );
  const sort: FlowSort = ownKey(FLOW_SORTS, one(params.sort), "stalled");
  const repo = one(params.repo);
  const agent = one(params.agent);
  const days = FLOW_RANGES[range];
  const nowMs = Date.now();
  const now = Math.floor(nowMs / 1000);
  // This period and the one before it, plus the GitHub read's window so a PR
  // merged early in the range still has its opening.
  const back = Math.min(2 * days + PR_WINDOW_DAYS, retentionDays());
  const since = new Date(nowMs - back * 86_400_000);

  let data: Awaited<ReturnType<typeof readFlow>>;
  try {
    data = await readFlow(since, scope);
  } catch (err) {
    console.error("Pipeline flow:", err);
    return (
      <SourceDown source="the history database">
        The Pipeline flow query failed. Check DATABASE_URL and that Postgres is
        running; the other views are unaffected.
      </SourceDown>
    );
  }
  const all = toPrs(data.events);
  const repos = [...new Set(all.map((p) => p.repo))].sort();
  const agents = [...new Set(all.map((p) => p.agent))].sort();
  const prs = all.filter(
    (p) => (!repo || p.repo === repo) && (!agent || p.agent === agent),
  );

  const s = summarize(prs, now, days);
  const slow = slowestStep(s.merged, s.prevMerged, now);
  const period = days === 7 ? "this week" : `last ${days}d`;
  const prevPeriod = days === 7 ? "last week" : `the ${days}d before`;

  const byRepo = groupBy(s.merged, (p) => p.repo, now);
  const prevByRepo = new Map(
    groupBy(s.prevMerged, (p) => p.repo, now).map((r) => [r.name, r]),
  );
  const byAgent = groupBy(s.merged, (p) => p.agent, now);

  const showSlow = slow !== null && one(params.slow) === "1";
  const rows = showSlow ? slow.waited : tableRows(prs, s.merged, now, sort);
  const showAll = one(params.all) === "1";
  const shown = showAll ? rows : rows.slice(0, TABLE_ROWS);
  const href = (extra: Record<string, string>) =>
    `/pipeline?${new URLSearchParams({
      ...Object.fromEntries(
        Object.entries(params).filter(
          (e): e is [string, string] => typeof e[1] === "string",
        ),
      ),
      ...extra,
    })}#prs`;

  return (
    <div className="space-y-6">
      <h2 className="sr-only">Pipeline flow</h2>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <PipelineTabs flow scope={scope} />
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Database className="size-3.5" aria-hidden />
          History from the database
          {data.since && <> · since {shortDate(data.since)}</>}
        </p>
        <div className="min-w-0 max-md:w-full md:ml-auto">
          <FlowFilters
            range={range}
            repo={repo}
            agent={agent}
            repos={repos}
            agents={agents}
          />
        </div>
      </div>

      {prs.length === 0 ? (
        <EmptyState icon={GitPullRequest} title="No PRs to measure yet">
          {repo || agent ? (
            <>
              No stored PRs match these filters.{" "}
              <Link
                href={withProject("/pipeline?tab=flow", scope?.slugs ?? [])}
                className="underline underline-offset-3"
              >
                Clear filters
              </Link>
            </>
          ) : (
            "The ingester stores PR openings, reviews and merges every minute, so Flow fills in shortly."
          )}
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <FlowStat
              label="Median cycle time"
              icon={Clock}
              value={dur(s.medianCycle)}
              sub={`opened → merged${trend(s.medianCycle, s.prevMedianCycle, prevPeriod)}`}
            />
            <FlowStat
              label="Merged"
              icon={GitMerge}
              value={s.merged.length}
              sub={`${period} · ${s.prevMerged.length} ${prevPeriod}`}
            />
            <FlowStat
              label="Change requests"
              icon={MessageSquareDiff}
              value={
                s.changeRequests === null ? (
                  "—"
                ) : (
                  <>
                    {s.changeRequests.toFixed(1)}
                    <span className="text-lg text-muted-foreground">
                      {" "}
                      per PR
                    </span>
                  </>
                )
              }
              sub={`${s.approvedFirst} of ${s.merged.length} approved on first review`}
            />
            <FlowStat
              label="Stalled now"
              icon={s.stalled.length ? OctagonAlert : Hourglass}
              value={s.stalled.length}
              sub="no activity for 24h or more"
              alert={s.stalled.length > 0}
            />
          </div>

          {slow && (
            <Card className="flex-row items-center gap-4 px-4 sm:px-6">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Hourglass className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  Slowest step {period}: {SLOW_TITLES[slow.step]}
                </p>
                <p className="text-sm text-muted-foreground">
                  PRs waited a median{" "}
                  <strong className="text-foreground">
                    {formatDuration(slow.median)}
                  </strong>{" "}
                  {STEP_WAITS[slow.step]}, {slow.ratio.toFixed(1)}× {prevPeriod}
                  . {slow.waited.length} of {s.merged.length} waited 12h or
                  more.
                </p>
              </div>
              {slow.waited.length > 0 && (
                <Link
                  href={href({ slow: "1" })}
                  scroll={false}
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "h-9 shrink-0 max-sm:hidden",
                  )}
                >
                  Show those {slow.waited.length}
                  <ChevronRight aria-hidden />
                </Link>
              )}
            </Card>
          )}

          {byRepo.length > 0 && (
            <RepoChart
              rows={byRepo}
              prev={prevByRepo}
              prevPeriod={prevPeriod}
            />
          )}

          <Card id="prs" className="scroll-mt-20 gap-0 py-0">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
              <h3 className="flex items-center gap-2 font-medium">
                {showSlow
                  ? `Waited 12h or more ${STEP_WAITS[slow.step]}`
                  : `PRs ${period}`}
                <span className="rounded-full bg-muted px-2 text-xs text-muted-foreground tabular-nums">
                  {rows.length}
                </span>
              </h3>
              {showSlow ? (
                <Link
                  href={href({ slow: "" })}
                  scroll={false}
                  className="text-sm underline underline-offset-3"
                >
                  Show every PR
                </Link>
              ) : (
                <FlowSortSelect sort={sort} />
              )}
            </div>
            <PrTable rows={shown} now={now} />
            <footer className="flex items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground sm:px-6">
              <span>
                Showing {shown.length} of {rows.length}
              </span>
              {!showAll && rows.length > shown.length && (
                <Link
                  href={href({ all: "1" })}
                  scroll={false}
                  className="text-sm text-foreground underline underline-offset-3"
                >
                  Show all
                </Link>
              )}
            </footer>
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            <GroupTable
              title="By repo"
              first="Repo"
              rows={byRepo}
              mono
              last={[
                "Slowest step",
                (r) => {
                  const i = slowestIndex(r.steps);
                  return i === null ? "—" : STEPS[i];
                },
              ]}
            />
            <GroupTable
              title="By agent"
              first="Agent"
              rows={byAgent}
              last={["Wait for review", (r) => dur(r.steps[0])]}
            />
          </div>
        </>
      )}

      <StagesCard labels={topLabels(all)} />
    </div>
  );
}

async function readFlow(since: Date, scope: Scope | null) {
  // A project reads its repos' events through the repo index (#166).
  const [events, stats] = await Promise.all([
    prEvents(since, scope ? eventScope(scope) : undefined),
    historyStats(),
  ]);
  return { events, since: stats.since };
}

/** " · 3h faster than last week", or nothing without both medians. */
function trend(cur: number | null, prev: number | null, prevPeriod: string) {
  if (cur === null || prev === null) return "";
  const d = Math.abs(cur - prev);
  if (d < 60) return ` · same as ${prevPeriod}`;
  return ` · ${formatDuration(d)} ${cur < prev ? "faster" : "slower"} than ${prevPeriod}`;
}

function FlowStat({
  label,
  icon: Icon,
  value,
  sub,
  alert = false,
}: {
  label: string;
  icon: LucideIcon;
  value: ReactNode;
  sub: string;
  alert?: boolean;
}) {
  return (
    <Card
      className={cn(
        "gap-0 p-5",
        alert && "ring-destructive/55 ring-2 bg-destructive/5",
      )}
    >
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{label}</span>
        <Icon
          className={cn("size-4", alert && "text-destructive")}
          aria-hidden
        />
      </div>
      <div
        className={cn(
          "mt-2 text-3xl font-semibold tracking-tight tabular-nums",
          alert && "text-destructive",
        )}
      >
        {value}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </Card>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {STEPS.map((step, i) => (
        <li key={step} className="flex items-center gap-1.5">
          <span
            className={cn("size-2.5 rounded-sm", STAGE_BG[i])}
            aria-hidden
          />
          {step}
        </li>
      ))}
    </ul>
  );
}

// A round axis step that gives about 4 grid lines.
function axisStep(maxS: number) {
  const hours = Math.max(1, maxS / 3600 / 4);
  const nice = [1, 2, 5, 10, 20, 24, 48, 120, 240].find((n) => n >= hours);
  return (nice ?? Math.ceil(hours)) * 3600;
}

function RepoChart({
  rows,
  prev,
  prevPeriod,
}: {
  rows: GroupRow[];
  prev: Map<string, GroupRow>;
  prevPeriod: string;
}) {
  const total = (r: GroupRow) =>
    r.steps.reduce<number>((a, b) => a + (b ?? 0), 0);
  const step = axisStep(Math.max(...rows.map(total)));
  const scale = Math.max(
    step,
    Math.ceil(Math.max(...rows.map(total)) / step) * step,
  );
  const ticks = Array.from({ length: scale / step + 1 }, (_, i) => i * step);
  return (
    <Card className="gap-4 px-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-medium">Median time in each step, by repo</h3>
        <Legend />
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center gap-3">
            <span
              className="w-20 shrink-0 sm:w-[120px] truncate font-mono text-xs"
              title={r.name}
            >
              {r.name.split("/").pop()}
            </span>
            <div className="relative h-6 flex-1">
              {ticks.map((t) => (
                <span
                  key={t}
                  className="absolute inset-y-0 border-l border-dashed border-border"
                  style={{ left: `${(t / scale) * 100}%` }}
                  aria-hidden
                />
              ))}
              <div className="relative flex h-full gap-px">
                {r.steps.map((s, i) => {
                  const pct = ((s ?? 0) / scale) * 100;
                  const last = prev.get(r.name)?.steps[i];
                  const tip = `${r.name} · ${STEPS[i]}: median ${dur(s)} over ${r.merged} PR${r.merged === 1 ? "" : "s"}${last == null ? "" : ` · ${prevPeriod} ${formatDuration(last)}`}`;
                  return pct > 0 ? (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: steps are fixed and ordered
                      key={i}
                      title={tip}
                      className={cn(
                        "flex h-full items-center justify-center overflow-hidden rounded-sm text-[11px] font-medium whitespace-nowrap",
                        STAGE_BG[i],
                        STAGE_FG[i],
                      )}
                      style={{ width: `${pct}%` }}
                    >
                      <span className="sr-only">{tip}</span>
                      <span
                        aria-hidden
                        className={cn("max-sm:hidden", pct < 14 && "hidden")}
                      >
                        {dur(s)}
                      </span>
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-3" aria-hidden>
        <span className="w-20 shrink-0 sm:w-[120px]" />
        <div className="relative h-4 flex-1 text-xs text-muted-foreground">
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute -translate-x-1/2 tabular-nums first:translate-x-0 last:-translate-x-full"
              style={{ left: `${(t / scale) * 100}%` }}
            >
              {t === 0 ? "0" : formatDuration(t)}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

// A thin stacked bar on the fixed 0 to 3 days scale. The stalled step is
// hatched with a dashed outline, so the stall reads without colour.
function PrBar({ pr, now }: { pr: FlowPr; now: number }) {
  const steps = stepTimes(pr, now);
  const stalled = isStalled(pr, now) ? currentStep(pr) : null;
  const label = steps
    .map((s, i) => `${STEPS[i]} ${formatDuration(s)}`)
    .join(", ");
  return (
    <div
      className="flex h-2.5 w-full max-w-48 gap-px rounded-sm bg-muted"
      role="img"
      aria-label={label}
    >
      {steps.map((s, i) => {
        const pct = Math.min(100, (s / TABLE_SCALE_S) * 100);
        return pct > 0 ? (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: steps are fixed and ordered
            key={i}
            className={cn(
              "h-full rounded-sm",
              stalled === i
                ? "bg-[repeating-linear-gradient(135deg,var(--destructive)_0_2px,transparent_2px_5px)] outline-1 outline-destructive outline-dashed"
                : STAGE_BG[i],
            )}
            style={{ width: `${pct}%` }}
          />
        ) : null;
      })}
    </div>
  );
}

function StateBadge({ pr, now }: { pr: FlowPr; now: number }) {
  const tone =
    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap";
  if (pr.merged !== null) {
    return (
      <span
        className={cn(tone, "border-success/20 bg-success/10 text-success")}
      >
        <GitMerge className="size-3" aria-hidden />
        Merged
      </span>
    );
  }
  if (isStalled(pr, now)) {
    const step = currentStep(pr);
    const where = ["waiting for review", "in review", "waiting to merge"][step];
    return (
      <span
        className={cn(
          tone,
          "border-destructive/20 bg-destructive/10 text-destructive",
        )}
      >
        <OctagonAlert className="size-3" aria-hidden />
        Stalled · {formatDuration(stepTimes(pr, now)[step])} {where}
      </span>
    );
  }
  return (
    <span className={cn(tone, "border-info/20 bg-info/10 text-info")}>
      <GitPullRequest className="size-3" aria-hidden />
      {pr.firstReview === null ? "Open" : "In review"}
    </span>
  );
}

function PrTable({ rows, now }: { rows: FlowPr[]; now: number }) {
  if (!rows.length) {
    return (
      <p className="border-t px-4 py-10 text-center text-muted-foreground sm:px-6">
        No PRs merged or open in this range.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto border-t">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="px-4 py-2 font-medium sm:pl-6">PR</th>
            <th className="px-2 py-2 font-medium max-md:hidden">Author</th>
            <th className="px-2 py-2 font-medium">
              Time in each step
              <span className="font-normal"> · 0 to 3 days</span>
            </th>
            <th className="px-2 py-2 font-medium">Total</th>
            <th className="px-4 py-2 font-medium sm:pr-6">State</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((pr) => {
            const total = (pr.merged ?? now) - pr.opened;
            return (
              <tr
                key={pr.key}
                className={cn(isStalled(pr, now) && "bg-destructive/5")}
              >
                <td className="max-w-72 px-4 py-3 sm:pl-6">
                  {pr.url ? (
                    <a
                      href={pr.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[13px] hover:underline"
                    >
                      {pr.repo.split("/").pop()}#{pr.number}
                    </a>
                  ) : (
                    <span className="font-mono text-[13px]">
                      {pr.repo.split("/").pop()}#{pr.number}
                    </span>
                  )}
                  <p className="truncate text-muted-foreground">{pr.title}</p>
                </td>
                <td className="px-2 py-3 max-md:hidden">
                  <span className="flex items-center gap-1.5 whitespace-nowrap">
                    <Avatar className="size-5">
                      <AvatarFallback className="text-[10px] font-medium">
                        {initials(pr.agent)}
                      </AvatarFallback>
                    </Avatar>
                    {pr.agent}
                  </span>
                </td>
                <td className="min-w-28 px-2 py-3">
                  <PrBar pr={pr} now={now} />
                </td>
                <td className="px-2 py-3 whitespace-nowrap tabular-nums">
                  {formatDuration(total)}
                  {isOpen(pr) && (
                    <span className="text-muted-foreground"> so far</span>
                  )}
                </td>
                <td className="px-4 py-3 sm:pr-6">
                  <StateBadge pr={pr} now={now} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GroupTable({
  title,
  first,
  rows,
  mono = false,
  last: [lastLabel, lastValue],
}: {
  title: string;
  first: string;
  rows: GroupRow[];
  mono?: boolean;
  last: [string, (r: GroupRow) => string];
}) {
  return (
    <Card className="gap-0 py-0">
      <h3 className="px-4 py-4 font-medium sm:px-6">{title}</h3>
      {rows.length === 0 ? (
        <p className="border-t px-4 py-6 text-center text-muted-foreground sm:px-6">
          No merges in this range.
        </p>
      ) : (
        <div className="overflow-x-auto border-t">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-2 font-medium sm:pl-6">{first}</th>
                <th className="px-2 py-2 text-right font-medium">Merged</th>
                <th className="px-2 py-2 text-right font-medium">
                  Median cycle
                </th>
                <th className="px-4 py-2 font-medium sm:pr-6">{lastLabel}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.name}>
                  <td
                    className={cn(
                      "max-w-48 truncate px-4 py-2.5 sm:pl-6",
                      mono && "font-mono text-[13px]",
                    )}
                    title={r.name}
                  >
                    {mono ? r.name.split("/").pop() : r.name}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">
                    {r.merged}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">
                    {dur(r.medianCycle)}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground sm:pr-6">
                    {lastValue(r)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// DESIGN.md → Pipeline flow → Stages. Read-only for now: saving stages needs
// owner sign-in (#40), and label stages need label history (#54).
function StagesCard({ labels }: { labels: string[] }) {
  return (
    <Card className="gap-4 px-4 sm:px-6">
      <div className="flex items-center gap-2">
        <Layers2 className="size-4 text-muted-foreground" aria-hidden />
        <h3 className="font-medium">How Flow splits a PR’s time</h3>
      </div>
      <fieldset disabled className="grid gap-3 md:grid-cols-2">
        <legend className="sr-only">Stages</legend>
        <StageOption
          checked
          title="PR lifecycle"
          badge="Default"
          text="Opened → first review → changes → merged. Works on any repo, GitHub or Buzz, with no setup."
        >
          <p className="text-xs text-muted-foreground">
            Steps: {STEPS.join(", ")}.
          </p>
        </StageOption>
        <StageOption
          checked={false}
          title="Custom stages"
          badge="Optional"
          text="Use your own labels as stages, in order. For teams that move work through labels."
        >
          {labels.length > 0 && (
            <div className="space-y-1.5">
              <p className="flex flex-wrap items-center gap-1.5">
                {labels.map((l, i) => (
                  <span key={l} className="flex items-center gap-1.5">
                    {i > 0 && (
                      <ArrowRight
                        className="size-3 text-muted-foreground"
                        aria-hidden
                      />
                    )}
                    <span className="rounded-md border px-1.5 font-mono text-xs">
                      {l}
                    </span>
                  </span>
                ))}
                <span className="inline-flex items-center gap-1 px-1.5 text-xs text-muted-foreground">
                  <Plus className="size-3" aria-hidden />
                  Add label
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                Example only. Nothing changes until you pick this.
              </p>
            </div>
          )}
        </StageOption>
      </fieldset>
      <p className="text-xs text-muted-foreground">Sign in to change stages.</p>
    </Card>
  );
}

function StageOption({
  checked,
  title,
  badge,
  text,
  children,
}: {
  checked: boolean;
  title: string;
  badge: string;
  text: string;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex gap-3 rounded-lg border p-4",
        checked && "border-foreground/30 bg-muted/40",
      )}
    >
      <input
        type="radio"
        name="stages"
        checked={checked}
        readOnly
        className="mt-1 size-4 accent-foreground"
      />
      <span className="min-w-0 space-y-1.5">
        <span className="flex items-center gap-2 font-medium">
          {title}
          <span className="rounded-md border px-1.5 text-xs font-normal text-muted-foreground">
            {badge}
          </span>
        </span>
        <span className="block text-sm text-muted-foreground">{text}</span>
        {children}
      </span>
    </label>
  );
}
