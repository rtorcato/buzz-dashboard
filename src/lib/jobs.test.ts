import { describe, expect, it } from "vitest";
import {
  countJobs,
  filterJobs,
  isJobsStale,
  type Job,
  jobStatus,
  jobsFromJson,
  parseFilter,
  sortJobs,
} from "./jobs-parse";

const raw = (over: Record<string, unknown> = {}) => ({
  label: "xyz.buzz.fizz.ai-ready",
  name: "ai-ready",
  purpose: "Wakes Grimlock",
  schedule: "Every 2 min",
  next: "next in 1 min",
  last_run: {
    at: "2026-11-20T18:00:00Z",
    exit: 0,
    duration_s: 1.2,
    log_line: "ok",
  },
  runs: ["ok", "ok", "fail", "x"],
  wakes: [{ name: "Grimlock" }, { name: "Jazz", stale: true }, {}],
  installed: { matches: true, ref: "abc" },
  ...over,
});
const feed = (jobs: unknown[]) =>
  jobsFromJson({
    version: 1,
    published_at: "2026-11-20T18:00:00Z",
    host: "M4",
    jobs,
  });
const job = (over: Record<string, unknown> = {}): Job => {
  const f = feed([raw(over)]);
  if (!f) throw new Error("feed");
  return f.jobs[0];
};

describe("jobsFromJson", () => {
  it("parses a job and drops junk inside it", () => {
    const j = job();
    expect(j.runs).toEqual(["ok", "ok", "fail"]);
    expect(j.wakes).toEqual([
      { name: "Grimlock", stale: false },
      { name: "Jazz", stale: true },
    ]);
    expect(j.lastRun?.exit).toBe(0);
  });
  it("rejects an unknown version or a bad file", () => {
    expect(jobsFromJson({ version: 2 })).toBeNull();
    expect(jobsFromJson("x")).toBeNull();
    expect(
      jobsFromJson({ version: 1, published_at: "nope", jobs: [] }),
    ).toBeNull();
  });
  it("skips jobs missing a label, name or schedule", () => {
    expect(feed([raw({ label: "" }), {}, raw()])?.jobs).toHaveLength(1);
  });
  it("never guesses that the installed copy matches", () => {
    expect(job({ installed: undefined }).installed.matches).toBe(false);
  });
});

describe("jobStatus", () => {
  it("is failed on a non-zero exit, missed over everything", () => {
    expect(
      jobStatus(job({ last_run: { at: "2026-11-20T18:00:00Z", exit: 127 } })),
    ).toBe("failed");
    expect(
      jobStatus(
        job({
          missed: true,
          last_run: { at: "2026-11-20T18:00:00Z", exit: 1 },
        }),
      ),
    ).toBe("missed");
  });
  it("warns on a stale wake or an unloaded job", () => {
    expect(jobStatus(job())).toBe("warning");
    expect(jobStatus(job({ wakes: [] }))).toBe("ok");
    expect(jobStatus(job({ wakes: [], loaded: false }))).toBe("warning");
  });
  it("shows paused when nothing is red", () => {
    expect(jobStatus(job({ wakes: [], paused: true }))).toBe("paused");
  });
});

describe("filter and sort", () => {
  const jobs = [
    job({ name: "b", wakes: [] }),
    job({ name: "a", missed: true }),
    job({ name: "c", wakes: [], installed: { matches: false } }),
  ];
  it("filters and counts", () => {
    expect(countJobs(jobs, "all")).toBe(3);
    expect(countJobs(jobs, "needs-you")).toBe(1);
    expect(countJobs(jobs, "drifted")).toBe(1);
    expect(filterJobs(jobs, "paused")).toEqual([]);
  });
  it("puts problems first", () => {
    expect(sortJobs(jobs).map((j) => j.name)).toEqual(["a", "b", "c"]);
  });
  it("falls back to all for an unknown filter", () => {
    expect(parseFilter("zzz")).toBe("all");
    expect(parseFilter("drifted")).toBe("drifted");
  });
});

describe("isJobsStale", () => {
  it("turns stale after 10 minutes", () => {
    const f = feed([]);
    if (!f) throw new Error("feed");
    expect(isJobsStale(f, f.publishedAt + 600)).toBe(false);
    expect(isJobsStale(f, f.publishedAt + 601)).toBe(true);
  });
});
