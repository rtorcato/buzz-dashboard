import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatAge } from "./age";
import type { Claim, GitHub, GitHubItem } from "./github";
import {
  blockedRow,
  ciRow,
  configFailures,
  countsByView,
  excludedLabels,
  failingRow,
  GITHUB_WAIT_MS,
  getNeedsYou,
  githubReads,
  MISSED_WAIT_MS,
  mergeRow,
  type NeedsYouRow,
  needsYouRefs,
  oldestFirst,
  pausedRow,
  quietLine,
  releaseKey,
  releaseRow,
} from "./needs-you";
import type { Releases, RepoRelease } from "./releases";
import type { StatusFeed } from "./status-feed";

vi.mock("next/server", () => ({ connection: async () => {} }));
const loadHive = vi.hoisted(() => vi.fn());
vi.mock("./hive", () => ({ loadHive }));
const loadStatusFeed = vi.hoisted(() =>
  vi.fn(async () => ({ feed: null as StatusFeed | null, stale: false })),
);
vi.mock("./status-feed", () => ({ loadStatusFeed }));
const loadGitHub = vi.hoisted(() => vi.fn());
vi.mock("./github", () => ({ loadGitHub }));
const loadFailing = vi.hoisted(() => vi.fn(async () => null));
const recentBuckets = vi.hoisted(() => vi.fn(async () => []));
vi.mock("./health-data", () => ({ loadFailing, recentBuckets }));
const loadReleases = vi.hoisted(() => vi.fn());
vi.mock("./releases", () => ({ loadReleases }));

const T = (iso: string) => Date.parse(iso) / 1000;
const feed = (usage: StatusFeed["usage"]): StatusFeed => ({
  publishedAt: T("2026-10-16T20:00:00Z"),
  runtime: {},
  usage,
});
const paused = feed({
  fiveH: 78,
  sevenD: 61,
  paused: true,
  fiveHResetsAt: T("2026-10-16T21:00:00Z"),
  sevenDResetsAt: T("2026-10-18T12:00:00Z"),
  fiveHPauseAt: 75,
  sevenDPauseAt: 90,
});

const pr = (over: Partial<GitHubItem>): GitHubItem => ({
  repo: "rtorcato/js-common",
  number: 1,
  title: "",
  url: "",
  isPr: true,
  labels: ["merge-ready"],
  agent: null,
  author: "rtorcato-bot",
  createdAt: T("2026-10-16T12:00:00Z"),
  closedAt: null,
  mergedAt: null,
  reviews: [],
  labelEvents: [],
  ...over,
});
const claim = (over: Partial<Claim>): Claim => ({
  ...pr({ isPr: false, labels: ["ai-blocked"] }),
  claimedAt: T("2026-10-16T12:00:00Z"),
  ...over,
});
const github = (prs: GitHubItem[], claims: Claim[] = []): GitHub => ({
  claims,
  prs,
  releases: [],
  truncated: false,
});

const row = (
  kind: NeedsYouRow["kind"],
  count: number,
  since: string,
): NeedsYouRow => ({
  kind,
  title: kind,
  detail: "",
  count,
  since,
});

describe("needs-you", () => {
  const rows = [
    row("blocked", 3, "2026-10-07T12:00:00Z"),
    row("release", 2, "2026-10-07T10:00:00Z"),
    row("ci", 1, "2026-10-07T11:00:00Z"),
  ];

  it("sorts oldest first", () => {
    expect(oldestFirst(rows).map((r) => r.kind)).toEqual([
      "release",
      "ci",
      "blocked",
    ]);
  });

  it("counts items per owning tab", () => {
    expect(countsByView(rows)).toEqual({ releases: 3, pipeline: 3 });
    expect(countsByView([])).toEqual({});
  });
});

describe("pausedRow", () => {
  const now = T("2026-10-16T20:05:00Z");
  it("names the tripped limit and links to Agents", () => {
    expect(pausedRow(paused, now)).toEqual({
      kind: "paused",
      title: "Paused for usage",
      detail: "5h window at 78% (pauses at 75%)",
      count: 1,
      since: "2026-10-16T20:00:00.000Z",
      resetsAt: T("2026-10-16T21:00:00Z"),
    });
    expect(countsByView([pausedRow(paused, now) as NeedsYouRow])).toEqual({
      agents: 1,
    });
  });
  it("is absent when not paused, not reported, or past the reset", () => {
    expect(pausedRow(null, now)).toBeNull();
    expect(pausedRow(feed(null), now)).toBeNull();
    expect(
      pausedRow(
        feed({
          ...(paused.usage as NonNullable<StatusFeed["usage"]>),
          paused: false,
        }),
        now,
      ),
    ).toBeNull();
    expect(pausedRow(paused, T("2026-10-16T21:00:00Z"))).toBeNull();
  });
});

describe("mergeRow", () => {
  it("lists open merge-ready PRs, oldest first", () => {
    expect(
      mergeRow(
        github([
          pr({ number: 2 }),
          pr({
            repo: "rtorcato/db-common",
            number: 7,
            createdAt: T("2026-10-15T00:00:00Z"),
          }),
          pr({ number: 3, labels: ["ai-review"] }),
          pr({ number: 4, closedAt: T("2026-10-16T13:00:00Z") }),
        ]),
      ),
    ).toEqual({
      kind: "merge",
      title: "2 PRs ready to merge",
      detail: "js-common#2, db-common#7",
      count: 2,
      since: "2026-10-15T00:00:00.000Z",
      keys: ["merge:rtorcato/js-common#2", "merge:rtorcato/db-common#7"],
    });
  });
  it("is absent with none", () => {
    expect(mergeRow(github([pr({ labels: [] })]))).toBeNull();
  });
});

describe("blockedRow", () => {
  it("lists open ai-blocked issues, oldest first", () => {
    expect(
      blockedRow(
        github(
          [],
          [
            claim({ number: 5 }),
            claim({
              repo: "rtorcato/db-common",
              number: 9,
              claimedAt: T("2026-10-15T00:00:00Z"),
            }),
            claim({ number: 6, labels: ["ai-wip"] }),
          ],
        ),
      ),
    ).toEqual({
      kind: "blocked",
      title: "2 issues blocked",
      detail: "js-common#5, db-common#9",
      count: 2,
      since: "2026-10-15T00:00:00.000Z",
      keys: ["blocked:rtorcato/js-common#5", "blocked:rtorcato/db-common#9"],
    });
  });
  it("says item when a blocked PR is in it", () => {
    expect(
      blockedRow(github([], [claim({ number: 5, isPr: true })]))?.title,
    ).toBe("1 item blocked");
  });
  it("is absent with none", () => {
    expect(blockedRow(github([], [claim({ labels: ["ai-wip"] })]))).toBeNull();
  });
});

describe("quietLine", () => {
  it("names the agent, how long and the claim", () => {
    const now = T("2026-10-16T15:00:00Z");
    expect(
      quietLine(
        { agent: "Honey", since: now - 3 * 3600, key: "js-common#5", more: 0 },
        now,
      ),
    ).toBe("Honey has been quiet for 3h while holding js-common#5.");
    expect(
      quietLine(
        { agent: "Honey", since: now - 150 * 60, key: "js-common#5", more: 2 },
        now,
      ),
    ).toBe(
      "Honey has been quiet for 2h 30m while holding js-common#5 and 2 more.",
    );
  });
});

describe("githubReads", () => {
  it("drops the items whose label is excluded", () => {
    expect(githubReads(new Set())).toEqual(["merge", "blocked"]);
    expect(githubReads(new Set(["ai-blocked"]))).toEqual(["merge"]);
    expect(githubReads(new Set(["merge-ready", "ai-blocked"]))).toEqual([]);
  });
});

describe("excludedLabels", () => {
  it("splits a comma list", () => {
    expect([...excludedLabels(" merge-ready, ai-blocked ,")]).toEqual([
      "merge-ready",
      "ai-blocked",
    ]);
    expect(excludedLabels(undefined).size).toBe(0);
  });
});

describe("getNeedsYou", () => {
  beforeEach(() => {
    loadReleases.mockResolvedValue({
      releases: { repos: [], runsUnread: [] },
      fetchedAt: "2026-10-16T20:00:00Z",
    });
    vi.stubEnv("GITHUB_TOKEN", "");
    vi.stubEnv("NEEDS_YOU_EXCLUDE_LABELS", "");
    vi.stubEnv("BUZZ_RELAY_URL", "");
  });
  const relayEnv = () => {
    vi.stubEnv("BUZZ_RELAY_URL", "wss://relay.example");
    vi.stubEnv("BUZZ_PRIVATE_KEY", "a".repeat(64));
  };
  afterEach(() => {
    vi.unstubAllEnvs();
    loadHive.mockReset();
    loadGitHub.mockReset();
  });

  it("lists merge-ready PRs by default", async () => {
    vi.stubEnv("GITHUB_TOKEN", "gh");
    loadGitHub.mockResolvedValue({ github: github([pr({})]), fetchedAt: "" });
    const data = await getNeedsYou();
    expect(data.rows.map((r) => r.kind)).toEqual(["merge"]);
  });

  it("lists ai-blocked issues by default", async () => {
    vi.stubEnv("GITHUB_TOKEN", "gh");
    loadGitHub.mockResolvedValue({
      github: github([], [claim({})]),
      fetchedAt: "",
    });
    const data = await getNeedsYou();
    expect(data.rows.map((r) => r.kind)).toEqual(["blocked"]);
  });

  it("hides merge-ready when NEEDS_YOU_EXCLUDE_LABELS names it", async () => {
    vi.stubEnv("GITHUB_TOKEN", "gh");
    vi.stubEnv("NEEDS_YOU_EXCLUDE_LABELS", "merge-ready");
    loadGitHub.mockResolvedValue({
      github: github([pr({})], [claim({})]),
      fetchedAt: "",
    });
    const data = await getNeedsYou();
    expect(data.rows.map((r) => r.kind)).toEqual(["blocked"]);
  });

  it("skips GitHub when every item it feeds is excluded", async () => {
    vi.stubEnv("GITHUB_TOKEN", "gh");
    vi.stubEnv("NEEDS_YOU_EXCLUDE_LABELS", "merge-ready,ai-blocked");
    const data = await getNeedsYou();
    expect(data.rows).toEqual([]);
    expect(loadGitHub).not.toHaveBeenCalled();
  });

  it("adds release approvals and red CI from the releases read", async () => {
    vi.stubEnv("GITHUB_TOKEN", "gh");
    vi.stubEnv("NEEDS_YOU_EXCLUDE_LABELS", "merge-ready");
    loadReleases.mockResolvedValue({
      releases: {
        repos: [
          {
            repo: "acme/lib",
            url: "https://github.com/acme/lib",
            branch: "main",
            tag: null,
            commits: [],
            moreCommits: false,
            head: null,
            waiting: [
              {
                id: 1,
                number: 1,
                workflow: "release.yml",
                url: "https://github.com/acme/lib/actions/runs/1",
                createdAt: T("2026-10-16T19:00:00Z"),
              },
            ],
            redCi: {
              check: "test",
              url: null,
              since: T("2026-10-16T19:00:00Z"),
            },
            packageName: null,
            npm: null,
          },
        ],
        runsUnread: [],
      },
      fetchedAt: "2026-10-16T20:00:00Z",
    });
    const data = await getNeedsYou();
    expect(data.rows.map((r) => r.kind)).toEqual(["release", "ci"]);
  });

  it("names GitHub when the releases read fails", async () => {
    vi.stubEnv("GITHUB_TOKEN", "gh");
    vi.stubEnv("NEEDS_YOU_EXCLUDE_LABELS", "merge-ready");
    loadReleases.mockResolvedValue({ releases: null, error: "HTTP 502" });
    const data = await getNeedsYou();
    expect(data.failures).toContainEqual({
      source: "GitHub",
      detail: "HTTP 502, so releases and CI on main can't load.",
    });
  });

  it("names GitHub when its read fails", async () => {
    vi.stubEnv("GITHUB_TOKEN", "gh");
    loadGitHub.mockResolvedValue({ github: null, error: "HTTP 502" });
    const data = await getNeedsYou();
    expect(data.failures).toContainEqual({
      source: "GitHub",
      detail: "HTTP 502, so merge-ready PRs and blocked issues can't load.",
    });
  });

  it("doesn't wait on a cold GitHub read", async () => {
    vi.stubEnv("GITHUB_TOKEN", "gh");
    vi.useFakeTimers();
    loadGitHub.mockReturnValue(new Promise(() => {}));
    loadReleases.mockReturnValue(new Promise(() => {}));
    const pending = getNeedsYou();
    await vi.advanceTimersByTimeAsync(2_000);
    const data = await pending;
    vi.useRealTimers();
    expect(data.rows).toEqual([]);
    expect(data.failures.map((f) => f.source)).not.toContain("GitHub");
  });

  it("doesn't hold the next request after a slow read (#162)", async () => {
    vi.stubEnv("GITHUB_TOKEN", "gh");
    vi.useFakeTimers();
    loadGitHub.mockReturnValue(new Promise(() => {}));
    loadReleases.mockReturnValue(new Promise(() => {}));
    const first = getNeedsYou();
    await vi.advanceTimersByTimeAsync(GITHUB_WAIT_MS);
    await first;

    // Still cold: the second request gives up long before GITHUB_WAIT_MS.
    let done = false;
    const second = getNeedsYou().then((d) => {
      done = true;
      return d;
    });
    await vi.advanceTimersByTimeAsync(MISSED_WAIT_MS);
    expect(done).toBe(true);
    expect((await second).rows).toEqual([]);

    // Warm now: the row shows, still without the full wait.
    loadGitHub.mockResolvedValue({ github: github([pr({})]), fetchedAt: "" });
    loadReleases.mockResolvedValue({
      releases: { repos: [], runsUnread: [] },
      fetchedAt: "",
    });
    const third = getNeedsYou();
    await vi.advanceTimersByTimeAsync(MISSED_WAIT_MS);
    const data = await third;
    vi.useRealTimers();
    expect(data.rows.map((r) => r.kind)).toEqual(["merge"]);
  });

  it("is not connected, with no freshness, until a source exists", async () => {
    vi.stubEnv("BUZZ_RELAY_URL", "");
    const data = await getNeedsYou();
    expect(data.connected).toBe(false);
    expect(data.updatedAt).toBeNull();
    expect(data.rows).toEqual([]);
    expect(loadHive).not.toHaveBeenCalled();
  });

  it("lists a usage pause even while the other sources are disconnected", async () => {
    vi.stubEnv("BUZZ_RELAY_URL", "");
    vi.useFakeTimers({ now: Date.parse("2026-10-16T20:05:00Z") });
    loadStatusFeed.mockResolvedValueOnce({ feed: paused, stale: false });
    const data = await getNeedsYou();
    vi.useRealTimers();
    expect(data.connected).toBe(false);
    expect(data.rows.map((r) => r.kind)).toEqual(["paused"]);
  });

  it("takes freshness from a successful relay fetch", async () => {
    relayEnv();
    loadHive.mockResolvedValue({ hive: {}, fetchedAt: "2026-10-09T18:00:00Z" });
    const data = await getNeedsYou();
    expect(data.updatedAt).toBe("2026-10-09T18:00:00Z");
    expect(data.failures.map((f) => f.source)).not.toContain("the Buzz relay");
  });

  it("adds a heads-up for an agent quiet over 2h while holding a claim", async () => {
    relayEnv();
    vi.stubEnv("GITHUB_TOKEN", "gh");
    vi.useFakeTimers({ now: Date.parse("2026-10-16T15:00:00Z") });
    const agent = (name: string, lastSeenAt: number) => ({
      name,
      lastSeenAt,
      pubkeys: [name],
    });
    loadHive.mockResolvedValue({
      hive: {
        agents: [
          agent("Honey", T("2026-10-16T12:00:00Z")),
          agent("Fern", T("2026-10-16T14:00:00Z")),
        ],
      },
      fetchedAt: "",
    });
    loadGitHub.mockResolvedValue({
      github: github(
        [],
        [
          claim({ agent: "Honey", labels: ["ai-wip"], number: 5 }),
          claim({ agent: "Fern", labels: ["ai-wip"], number: 6 }),
        ],
      ),
      fetchedAt: "",
    });
    const data = await getNeedsYou();
    vi.useRealTimers();
    expect(data.headsUp).toEqual([
      "Honey has been quiet for 3h while holding js-common#5.",
    ]);
    expect(data.rows).toEqual([]);
  });

  it("names the relay when its fetch fails, and keeps freshness empty", async () => {
    relayEnv();
    loadHive.mockResolvedValue({ hive: null, error: "Buzz relay timed out" });
    const data = await getNeedsYou();
    expect(data.updatedAt).toBeNull();
    expect(data.failures).toContainEqual({
      source: "the Buzz relay",
      detail: "Buzz relay timed out, so Agents and Timeline can't load.",
    });
  });
});

describe("configFailures", () => {
  const key = "a".repeat(64);
  const ok = {
    BUZZ_RELAY_URL: "wss://relay.example",
    BUZZ_PRIVATE_KEY: key,
    GITHUB_TOKEN: "gh",
  };

  it("is empty when every source is configured", () => {
    expect(configFailures(ok)).toEqual([]);
  });

  it("names the relay when BUZZ_* is missing", () => {
    const [f] = configFailures({
      ...ok,
      BUZZ_RELAY_URL: "",
      BUZZ_PRIVATE_KEY: undefined,
    });
    expect(f.source).toBe("the Buzz relay");
    expect(f.detail).toContain(
      "BUZZ_RELAY_URL and BUZZ_PRIVATE_KEY are not set",
    );
  });

  it("names the relay when the key is not 64-char hex", () => {
    expect(configFailures({ ...ok, BUZZ_PRIVATE_KEY: "nsec1abc" })).toEqual([
      expect.objectContaining({ source: "the Buzz relay" }),
    ]);
  });

  it("names GitHub when GITHUB_TOKEN is missing", () => {
    expect(configFailures({ ...ok, GITHUB_TOKEN: "" })).toEqual([
      expect.objectContaining({ source: "GitHub" }),
    ]);
  });
});

describe("formatAge", () => {
  it.each([
    [-5_000, "0s"],
    [14_000, "14s"],
    [7 * 60_000, "7m"],
    [2 * 3_600_000, "2h"],
    [(2 * 60 + 14) * 60_000, "2h 14m"],
    [50 * 3_600_000, "2d"],
  ])("%i ms -> %s", (ms, out) => {
    expect(formatAge(ms)).toBe(out);
  });
});

describe("failingRow", () => {
  const f = {
    agent: "Gale",
    hour: { attempts: 14, errors: 6, cancelled: 0, maxTokens: 0 },
    since: T("2026-10-16T19:08:00Z"),
  };

  it("says turns for per-turn reports", () => {
    expect(failingRow(f, "signer")).toEqual({
      kind: "failing",
      title: "Gale is failing turns",
      detail: "6 of 14 turns ended in error in the last hour",
      count: 1,
      since: "2026-10-16T19:08:00.000Z",
      keys: ["failing:Gale"],
    });
  });

  it("says API requests, never turns, for OpenTelemetry", () => {
    const row = failingRow(f, "otel");
    expect(row.title).toBe("Gale is failing API requests");
    expect(row.detail).toBe("6 of 14 API requests failed in the last hour");
  });

  it("counts toward Health in the sidebar", () => {
    expect(
      countsByView([failingRow(f, "otel"), failingRow(f, "otel")]),
    ).toEqual({
      health: 2,
    });
  });
});

describe("needsYouRefs", () => {
  it("keeps only GitHub item refs", () => {
    const refs = needsYouRefs({
      connected: true,
      rows: [
        { keys: ["merge:rtorcato/js-common#2", "failing:Gale"] },
        { keys: ["blocked:rtorcato/db-common#9"] },
        { keys: undefined },
      ] as NeedsYouRow[],
      headsUp: [],
      failures: [],
      updatedAt: null,
    });
    expect([...refs]).toEqual(["rtorcato/js-common#2", "rtorcato/db-common#9"]);
  });
});

const repo = (over: Partial<RepoRelease>): RepoRelease => ({
  repo: "acme/lib",
  url: "https://github.com/acme/lib",
  branch: "main",
  tag: { name: "v1.0.0", at: T("2026-10-01T00:00:00Z") },
  commits: [],
  moreCommits: false,
  head: null,
  waiting: [],
  redCi: null,
  packageName: null,
  npm: null,
  ...over,
});
const run = (id: number, iso: string) => ({
  id,
  number: id,
  workflow: "release.yml",
  url: `https://github.com/acme/lib/actions/runs/${id}`,
  createdAt: T(iso),
});

describe("releaseRow", () => {
  it("is null when nothing waits", () => {
    expect(releaseRow({ repos: [repo({})], runsUnread: [] })).toBeNull();
  });

  it("counts every waiting run, oldest first, with one key per run", () => {
    const releases: Releases = {
      repos: [
        repo({ waiting: [run(7, "2026-10-16T18:00:00Z")] }),
        repo({
          repo: "acme/app",
          waiting: [
            run(3, "2026-10-16T12:00:00Z"),
            run(4, "2026-10-16T19:00:00Z"),
          ],
        }),
      ],
      runsUnread: [],
    };
    expect(releaseRow(releases)).toEqual({
      kind: "release",
      title: "3 releases waiting for your approval",
      detail: "lib, app",
      count: 3,
      since: "2026-10-16T12:00:00.000Z",
      keys: [
        releaseKey("acme/lib", 7),
        releaseKey("acme/app", 3),
        releaseKey("acme/app", 4),
      ],
    });
  });
});

describe("ciRow", () => {
  it("is null when every main is green", () => {
    expect(ciRow({ repos: [repo({})], runsUnread: [] })).toBeNull();
  });

  it("names the red repos and dates the oldest failure", () => {
    const red = (since: string) => ({
      check: "test",
      url: null,
      since: T(since),
    });
    const row = ciRow({
      repos: [
        repo({ redCi: red("2026-10-16T10:00:00Z") }),
        repo({ repo: "acme/app" }),
        repo({ repo: "acme/cli", redCi: red("2026-10-16T08:00:00Z") }),
      ],
      runsUnread: [],
    });
    expect(row).toMatchObject({
      kind: "ci",
      title: "Red CI on main in 2 repos",
      detail: "lib, cli",
      count: 2,
      since: "2026-10-16T08:00:00.000Z",
    });
    expect(countsByView(row ? [row] : [])).toEqual({ releases: 2 });
  });
});
