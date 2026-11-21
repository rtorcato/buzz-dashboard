import { cn } from "cn";
import {
  CalendarClock,
  Check,
  CircleAlert,
  Clock,
  Eye,
  GitCompareArrows,
  Pause,
  Play,
  PlugZap,
  Server,
  TriangleAlert,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { formatAge } from "@/lib/age";
import { loadJobs } from "@/lib/jobs";
import {
  countJobs,
  drifted,
  filterJobs,
  JOB_FILTERS,
  type Job,
  type JobFilter,
  type JobStatus,
  jobStatus,
  parseFilter,
  sortJobs,
} from "@/lib/jobs-parse";
import { loadStatusFeed } from "@/lib/status-feed";

export const metadata: Metadata = { title: "Jobs · Hive" };

// DESIGN.md → Jobs (#108), phase 1: read-only. Run, dry run and pause come in
// phase 2. Filters are links, rows are <details>, so there is no client code.

const FILTER_LABEL: Record<JobFilter, string> = {
  all: "All",
  "needs-you": "Needs you",
  warnings: "Warnings",
  drifted: "Drifted",
  paused: "Paused",
};

const STATUS: Record<
  JobStatus,
  { label: string; icon: typeof Check; pill: string; row: string }
> = {
  failed: {
    label: "Failed",
    icon: CircleAlert,
    pill: "border-destructive/30 bg-destructive/10 text-destructive",
    row: "border-l-destructive bg-destructive/5",
  },
  missed: {
    label: "Missed",
    icon: Clock,
    pill: "border-destructive/30 bg-destructive/10 text-destructive",
    row: "border-l-destructive bg-destructive/5",
  },
  warning: {
    label: "Warning",
    icon: TriangleAlert,
    pill: "border-warning/30 bg-warning/10 text-warning",
    row: "border-l-warning",
  },
  paused: {
    label: "Paused",
    icon: Pause,
    pill: "border-border text-muted-foreground",
    row: "border-l-transparent",
  },
  ok: {
    label: "OK",
    icon: Check,
    pill: "border-success/30 bg-success/10 text-success",
    row: "border-l-transparent",
  },
};

const ago = (now: number, s: number) => `${formatAge((now - s) * 1000)} ago`;
const clock = (s: number) =>
  new Date(s * 1000).toLocaleString("en-US", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
const duration = (s: number | null) =>
  s === null
    ? null
    : s < 60
      ? `${s}s`
      : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;

export default async function JobsPage({ searchParams }: PageProps<"/jobs">) {
  const filter = parseFilter((await searchParams).show);
  const [{ feed, stale }, status] = await Promise.all([
    loadJobs(),
    loadStatusFeed(),
  ]);
  const usage = status.feed?.usage ?? null;
  const now = Math.floor(Date.now() / 1000);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Jobs</h2>
          <p className="text-sm text-muted-foreground">
            {feed
              ? "The hive’s scheduled jobs on the Mac. Red means the last run failed or a run was missed."
              : "The hive’s scheduled jobs on the Mac."}
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-dashed px-3 py-1 text-xs text-muted-foreground max-md:hidden">
          <Eye className="size-3.5" aria-hidden />
          Read-only · run and pause come in phase 2
        </span>
      </div>

      {!feed ? <NotConnected /> : null}
      {feed || usage ? (
        <Strip feed={feed} stale={stale} now={now} usage={usage} />
      ) : null}
      {feed && stale ? (
        <p className="text-xs text-muted-foreground">
          No new jobs.json for over 10 minutes. The table keeps the last copy,
          dimmed, as of {clock(feed.publishedAt)}.
        </p>
      ) : null}
      {feed ? (
        <JobsTable jobs={feed.jobs} filter={filter} now={now} stale={stale} />
      ) : null}
    </div>
  );
}

function NotConnected() {
  return (
    <Card className="flex-row items-start gap-4 border-dashed px-5 py-5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <PlugZap className="size-4" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="font-medium">Not connected</p>
        <p className="text-sm text-muted-foreground">
          The dashboard runs on the homelab and can’t see launchd on the Mac.
          Jobs show once the Mac publishes{" "}
          <code className="font-mono">hive/jobs.json</code> next to{" "}
          <code className="font-mono">status.json</code>. Nothing is shown until
          then, so these are never guesses.
        </p>
      </div>
    </Card>
  );
}

type Usage = NonNullable<
  Awaited<ReturnType<typeof loadStatusFeed>>["feed"]
>["usage"];

function Strip({
  feed,
  stale,
  now,
  usage,
}: {
  feed: Awaited<ReturnType<typeof loadJobs>>["feed"];
  stale: boolean;
  now: number;
  usage: Usage;
}) {
  const jobs = feed?.jobs ?? [];
  const red = countJobs(jobs, "needs-you");
  const warn = countJobs(jobs, "warnings");
  const drift = countJobs(jobs, "drifted");
  return (
    <Card className="grid gap-0 py-0 md:grid-cols-4 md:divide-x max-md:grid-cols-2 max-md:divide-y">
      <Tile icon={Server} label="Host">
        <p className="text-xl font-semibold">{feed?.host ?? "–"}</p>
        {feed ? (
          <p
            className={cn(
              "flex items-center gap-1 text-xs",
              stale ? "text-warning" : "text-muted-foreground",
            )}
          >
            {stale ? <TriangleAlert className="size-3" aria-hidden /> : null}
            jobs.json {ago(now, feed.publishedAt).replace(" ago", "")} old
            {stale ? " · is the Mac asleep?" : ""}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">not connected</p>
        )}
      </Tile>
      <Tile icon={Clock} label="Usage">
        {usage ? (
          <>
            <Meter label="5h" pct={usage.fiveH} pauseAt={usage.fiveHPauseAt} />
            <Meter
              label="7d"
              pct={usage.sevenD}
              pauseAt={usage.sevenDPauseAt}
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Usage not reported</p>
        )}
      </Tile>
      <Tile icon={Pause} label="Hive">
        {usage ? (
          <p
            className={cn(
              "flex items-center gap-1.5 text-xl font-semibold",
              usage.paused ? "text-warning" : "text-success",
            )}
          >
            {usage.paused ? (
              <Pause className="size-4" aria-hidden />
            ) : (
              <Play className="size-4" aria-hidden />
            )}
            {usage.paused ? "Paused" : "Running"}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Not reported</p>
        )}
      </Tile>
      <Tile icon={CalendarClock} label="Jobs">
        <p className="text-xl font-semibold">{jobs.length} loaded</p>
        <p className="text-xs text-muted-foreground">
          <span className={red ? "text-destructive" : undefined}>
            {red} need you
          </span>{" "}
          · {warn} warning · {drift} drifted
        </p>
      </Tile>
    </Card>
  );
}

function Tile({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Clock;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5 p-4">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </p>
      {children}
    </div>
  );
}

function Meter({
  label,
  pct,
  pauseAt,
}: {
  label: string;
  pct: number;
  pauseAt: number | null;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-5 text-muted-foreground">{label}</span>
      <div className="relative h-1.5 flex-1 rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
        {pauseAt !== null ? (
          <span
            className="absolute -top-0.5 h-2.5 w-0.5 bg-warning"
            style={{ left: `${pauseAt}%` }}
            aria-hidden
          />
        ) : null}
      </div>
      <span className="w-9 text-right font-semibold tabular-nums">{pct}%</span>
    </div>
  );
}

function JobsTable({
  jobs,
  filter,
  now,
  stale,
}: {
  jobs: Job[];
  filter: JobFilter;
  now: number;
  stale: boolean;
}) {
  const shown = sortJobs(filterJobs(jobs, filter));
  return (
    <div className={cn("space-y-3", stale && "opacity-60")}>
      <nav aria-label="Filter jobs" className="flex flex-wrap gap-1">
        {JOB_FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "all" ? "/jobs" : `/jobs?show=${f}`}
            aria-current={f === filter ? "page" : undefined}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm text-muted-foreground max-md:min-h-11 max-md:content-center",
              f === filter && "bg-muted font-medium text-foreground",
              // Phone shows the first three filters only.
              (f === "drifted" || f === "paused") && "max-md:hidden",
            )}
          >
            {FILTER_LABEL[f]} {countJobs(jobs, f)}
          </Link>
        ))}
      </nav>
      <Card className="gap-0 overflow-hidden py-0">
        <div
          className="grid grid-cols-[8rem_1.6fr_1fr_1fr_1.2fr_8rem] gap-x-4 border-b px-4 py-3 text-xs font-medium text-muted-foreground max-md:hidden"
          aria-hidden
        >
          <span>Status</span>
          <span>Job</span>
          <span>Schedule</span>
          <span>Last run</span>
          <span>Wakes</span>
          <span>Installed</span>
        </div>
        {shown.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No jobs match this filter.
          </p>
        ) : (
          <ul className="divide-y">
            {shown.map((j) => (
              <JobRow key={j.label} job={j} now={now} />
            ))}
          </ul>
        )}
        <p className="border-t px-4 py-3 text-xs text-muted-foreground">
          {jobs.length} jobs · from{" "}
          <code className="font-mono">launchctl print</code> and the job logs,
          published by the Mac every 5 min
        </p>
      </Card>
    </div>
  );
}

function StatusPill({ status }: { status: JobStatus }) {
  const s = STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex h-6 w-fit items-center gap-1 rounded-full border px-2 text-xs font-medium",
        s.pill,
      )}
    >
      <s.icon className="size-3" aria-hidden />
      {s.label}
    </span>
  );
}

function WakeChips({ job }: { job: Job }) {
  if (job.wakes.length === 0)
    return <span className="text-muted-foreground">–</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {job.wakes.map((w) => (
        <span
          key={w.name}
          className={cn(
            "inline-flex h-6 items-center rounded-full px-2 text-xs",
            w.stale
              ? "border border-warning/30 bg-warning/10 text-warning"
              : "bg-muted",
          )}
        >
          {w.stale ? "→ " : ""}
          {w.name}
        </span>
      ))}
    </span>
  );
}

function LastRun({ job, now }: { job: Job; now: number }) {
  if (job.missed) {
    return (
      <span className="text-destructive">
        {job.missedAt ? `${clock(job.missedAt)} · ` : ""}missed
      </span>
    );
  }
  if (!job.lastRun) return <span className="text-muted-foreground">never</span>;
  const r = job.lastRun;
  return (
    <span>
      {ago(now, r.at)}{" "}
      <span
        className={cn(
          "font-mono text-xs",
          r.exit ? "text-destructive" : "text-muted-foreground",
        )}
      >
        exit {r.exit}
        {duration(r.durationS) ? ` · ${duration(r.durationS)}` : ""}
      </span>
    </span>
  );
}

function Installed({ job }: { job: Job }) {
  return drifted(job) ? (
    <span className="inline-flex items-center gap-1 text-warning">
      <GitCompareArrows className="size-3.5" aria-hidden />
      drifted
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <Check className="size-3.5 text-success" aria-hidden />
      matches git
    </span>
  );
}

function JobRow({ job, now }: { job: Job; now: number }) {
  const status = jobStatus(job);
  const fails = job.runs.filter((r) => r === "fail").length;
  return (
    <li className={cn("border-l-4", STATUS[status].row)}>
      <details className="group">
        <summary className="grid cursor-pointer list-none grid-cols-[8rem_1.6fr_1fr_1fr_1.2fr_8rem] items-center gap-x-4 gap-y-2 px-4 py-3 text-sm max-md:grid-cols-2 max-md:min-h-11 [&::-webkit-details-marker]:hidden">
          <span className="max-md:order-2 max-md:justify-self-end">
            <StatusPill status={status} />
          </span>
          <span className="min-w-0 max-md:order-1 max-md:col-span-1">
            <span className="block font-mono font-semibold">{job.name}</span>
            <span className="block text-xs text-muted-foreground">
              {job.purpose}
            </span>
          </span>
          <span className="max-md:order-3">
            {job.schedule}
            {job.next ? (
              <span className="block text-xs text-muted-foreground">
                {job.next}
              </span>
            ) : null}
          </span>
          <span className="max-md:order-4 max-md:justify-self-end max-md:text-right">
            <LastRun job={job} now={now} />
          </span>
          <span className="max-md:order-5 max-md:col-span-2">
            <WakeChips job={job} />
          </span>
          <span className="text-xs max-md:hidden">
            <Installed job={job} />
          </span>
        </summary>
        <div className="grid gap-4 border-t border-dashed px-4 py-4 text-sm md:grid-cols-2">
          <div className="space-y-3">
            {job.lastRun?.logLine ? (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Last log line</p>
                <p className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
                  {job.lastRun.logLine}
                </p>
              </div>
            ) : null}
            {job.runs.length > 0 ? (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Last {job.runs.length} runs
                </p>
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span
                    className="flex gap-1"
                    role="img"
                    aria-label={`${job.runs.length - fails} ok, ${fails} failed`}
                  >
                    {job.runs.map((r, i) => (
                      <span
                        // biome-ignore lint/suspicious/noArrayIndexKey: ordered, never reordered
                        key={i}
                        className={cn(
                          "size-3 rounded-sm",
                          r === "ok" ? "bg-success" : "bg-destructive",
                        )}
                      />
                    ))}
                  </span>
                  {job.runs.length - fails} ok · {fails} failed
                </p>
              </div>
            ) : null}
          </div>
          <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-xs">
            <Def term="Label" mono>
              {job.label}
            </Def>
            <Def term="Loaded">{job.loaded ? "loaded" : "not loaded"}</Def>
            {job.script ? (
              <Def term="Script" mono>
                {job.script}
              </Def>
            ) : null}
            <Def term="Installed copy">
              <Installed job={job} />
              {job.installed.ref ? ` · ${job.installed.ref}` : ""}
            </Def>
            {job.log ? (
              <Def term="Log" mono>
                {job.log}
              </Def>
            ) : null}
          </dl>
        </div>
      </details>
    </li>
  );
}

function Def({
  term,
  mono = false,
  children,
}: {
  term: string;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{term}</dt>
      <dd className={cn("min-w-0 break-all", mono && "font-mono")}>
        {children}
      </dd>
    </>
  );
}
