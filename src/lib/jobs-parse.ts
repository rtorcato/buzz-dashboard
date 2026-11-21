// Pure half of the jobs feed: the file's shape, its parser, and the status
// rules. No I/O, so it tests without mocks.

export type Wake = { name: string; stale: boolean };
export type RunDot = "ok" | "fail";

export type Job = {
  /** launchd label, e.g. "xyz.buzz.fizz.morning-standup". */
  label: string;
  name: string;
  purpose: string;
  /** Plain words, e.g. "Weekdays 09:00". */
  schedule: string;
  /** Plain words, e.g. "next Mon 09:00", or null. */
  next: string | null;
  loaded: boolean;
  paused: boolean;
  /** The schedule says it should have run and it didn't. */
  missed: boolean;
  /** Unix seconds the missed run was due. */
  missedAt: number | null;
  lastRun: {
    at: number;
    exit: number;
    durationS: number | null;
    logLine: string | null;
  } | null;
  /** Newest last, at most 10. */
  runs: RunDot[];
  wakes: Wake[];
  script: string | null;
  log: string | null;
  installed: { matches: boolean; ref: string | null };
};

export type JobsFeed = {
  /** Unix seconds. */
  publishedAt: number;
  host: string;
  jobs: Job[];
};

export const JOBS_STALE_AFTER_S = 10 * 60;

export type JobStatus = "failed" | "missed" | "warning" | "paused" | "ok";

/** Failed and missed are red, a warning is amber. Drift is its own flag. */
export function jobStatus(j: Job): JobStatus {
  if (j.missed) return "missed";
  if (j.lastRun && j.lastRun.exit !== 0) return "failed";
  if (j.paused) return "paused";
  if (!j.loaded || j.wakes.some((w) => w.stale)) return "warning";
  return "ok";
}

export const drifted = (j: Job) => !j.installed.matches;
export const needsYou = (j: Job) => {
  const s = jobStatus(j);
  return s === "failed" || s === "missed";
};

export const JOB_FILTERS = [
  "all",
  "needs-you",
  "warnings",
  "drifted",
  "paused",
] as const;
export type JobFilter = (typeof JOB_FILTERS)[number];

export const parseFilter = (v: unknown): JobFilter =>
  JOB_FILTERS.find((f) => f === v) ?? "all";

const MATCH: Record<JobFilter, (j: Job) => boolean> = {
  all: () => true,
  "needs-you": needsYou,
  warnings: (j) => jobStatus(j) === "warning",
  drifted: drifted,
  paused: (j) => j.paused,
};

export const filterJobs = (jobs: Job[], f: JobFilter) => jobs.filter(MATCH[f]);

export const countJobs = (jobs: Job[], f: JobFilter) =>
  filterJobs(jobs, f).length;

const RANK: Record<JobStatus, number> = {
  failed: 0,
  missed: 0,
  warning: 1,
  paused: 2,
  ok: 3,
};

/** Problems first, then by name. */
export const sortJobs = (jobs: Job[]) =>
  [...jobs].sort(
    (a, b) =>
      RANK[jobStatus(a)] - RANK[jobStatus(b)] || a.name.localeCompare(b.name),
  );

export const isJobsStale = (feed: JobsFeed, now: number) =>
  now - feed.publishedAt > JOBS_STALE_AFTER_S;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const secs = (v: unknown) => {
  const n =
    typeof v === "string" ? Math.floor(Date.parse(v) / 1000) : Number.NaN;
  return Number.isNaN(n) ? null : n;
};

function parseJob(raw: unknown): Job | null {
  if (!isObject(raw)) return null;
  const label = str(raw.label);
  const name = str(raw.name);
  const schedule = str(raw.schedule);
  if (!label || !name || !schedule) return null;
  const lr = isObject(raw.last_run) ? raw.last_run : null;
  const at = lr ? secs(lr.at) : null;
  const lastRun =
    lr && at !== null && typeof lr.exit === "number"
      ? {
          at,
          exit: lr.exit,
          durationS: typeof lr.duration_s === "number" ? lr.duration_s : null,
          logLine: str(lr.log_line),
        }
      : null;
  const inst = isObject(raw.installed) ? raw.installed : null;
  return {
    label,
    name,
    purpose: str(raw.purpose) ?? "",
    schedule,
    next: str(raw.next),
    loaded: raw.loaded !== false,
    paused: raw.paused === true,
    missed: raw.missed === true,
    missedAt: secs(raw.missed_at),
    lastRun,
    runs: (Array.isArray(raw.runs) ? raw.runs : [])
      .filter((r): r is RunDot => r === "ok" || r === "fail")
      .slice(-10),
    wakes: (Array.isArray(raw.wakes) ? raw.wakes : []).flatMap((w) =>
      isObject(w) && str(w.name)
        ? [{ name: str(w.name) as string, stale: w.stale === true }]
        : [],
    ),
    script: str(raw.script),
    log: str(raw.log),
    // Unknown means we can't say it matches, so it shows as drifted.
    installed: { matches: inst?.matches === true, ref: str(inst?.ref) },
  };
}

/** The feed, or null for an unknown version or a malformed file. */
export function jobsFromJson(json: unknown): JobsFeed | null {
  if (!isObject(json) || json.version !== 1) return null;
  const publishedAt = secs(json.published_at);
  if (publishedAt === null || !Array.isArray(json.jobs)) return null;
  return {
    publishedAt,
    host: str(json.host) ?? "Mac",
    jobs: json.jobs.flatMap((j) => {
      const p = parseJob(j);
      return p ? [p] : [];
    }),
  };
}
