import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));

const {
  bumpOf,
  detailQuery,
  nextTag,
  packageNameOf,
  parseCommit,
  readReleases,
  redCiOf,
  runState,
  sortRepos,
  tagVersion,
  toRepo,
  typeCounts,
} = await import("./releases");
type RepoRelease = import("./releases").RepoRelease;
type Commit = import("./releases").Commit;

const T = (iso: string) => Date.parse(iso) / 1000;

const commit = (message: string, at = "2026-11-10T00:00:00Z"): Commit => ({
  oid: message,
  short: "abc1234",
  ...parseCommit(message),
  at: T(at),
});

const repo = (over: Partial<RepoRelease>): RepoRelease => ({
  repo: "acme/lib",
  url: "https://github.com/acme/lib",
  branch: "main",
  tag: { name: "v1.2.3", at: T("2026-11-01T00:00:00Z") },
  commits: [],
  moreCommits: false,
  head: null,
  waiting: [],
  redCi: null,
  packageName: null,
  npm: null,
  ...over,
});

describe("parseCommit", () => {
  it("splits type, scope, subject and the squash PR number", () => {
    expect(parseCommit("feat(fetch): add a retry option (#212)")).toEqual({
      subject: "add a retry option",
      type: "feat",
      breaking: false,
      pr: 212,
    });
  });

  it("reads ! and a BREAKING CHANGE footer as breaking", () => {
    expect(parseCommit("fix!: drop node 18").breaking).toBe(true);
    expect(
      parseCommit("refactor: new config\n\nBREAKING CHANGE: renamed key")
        .breaking,
    ).toBe(true);
  });

  it("keeps a non-conventional subject whole, with no type", () => {
    expect(parseCommit("Merge branch 'dev'")).toEqual({
      subject: "Merge branch 'dev'",
      type: null,
      breaking: false,
      pr: null,
    });
  });
});

describe("bumpOf and nextTag", () => {
  it("picks the biggest bump the commits ask for", () => {
    expect(bumpOf([commit("chore: deps"), commit("docs: readme")])).toBeNull();
    expect(bumpOf([commit("fix: x"), commit("perf: y")])).toBe("patch");
    expect(bumpOf([commit("fix: x"), commit("feat: y")])).toBe("minor");
    expect(bumpOf([commit("feat: y"), commit("chore!: z")])).toBe("major");
  });

  it("keeps the tag's prefix", () => {
    expect(nextTag("v2.3.1", "minor")).toBe("v2.4.0");
    expect(nextTag("v2.3.1", "major")).toBe("v3.0.0");
    expect(nextTag("@acme/lib@1.0.9", "patch")).toBe("@acme/lib@1.0.10");
    expect(nextTag("v0.2.1-beta", "patch")).toBe("v0.2.1");
    expect(nextTag("nightly", "patch")).toBeNull();
  });

  it("reads the version out of a tag", () => {
    expect(tagVersion("v6.2.0")).toBe("6.2.0");
    expect(tagVersion("@acme/lib@6.2.1")).toBe("6.2.1");
    expect(tagVersion("release-candidate")).toBeNull();
  });
});

describe("typeCounts", () => {
  it("puts breaking first, then feat, fix, perf, then the rest by name", () => {
    const commits = [
      commit("chore: a"),
      commit("fix: b"),
      commit("docs: c"),
      commit("feat!: d"),
      commit("fix: e"),
      commit("feat: f"),
    ];
    expect(typeCounts(commits)).toEqual([
      ["feat!", 1],
      ["feat", 1],
      ["fix", 2],
      ["chore", 1],
      ["docs", 1],
    ]);
  });
});

describe("toRepo", () => {
  const list = {
    nameWithOwner: "acme/lib",
    url: "https://github.com/acme/lib",
    isFork: false,
    workflow: { id: "x" },
    tags: {
      nodes: [
        {
          name: "v1.2.3",
          target: {
            __typename: "Tag",
            target: { oid: "t", committedDate: "2026-11-01T00:00:00Z" },
          },
        },
      ],
    },
  };
  const node = (oid: string, message: string) => ({
    oid,
    abbreviatedOid: oid.slice(0, 7),
    message,
    committedDate: "2026-11-05T00:00:00Z",
  });

  it("collects the commits above the tag and reads package and CI", () => {
    const r = toRepo(list, {
      pkg: { text: JSON.stringify({ name: "@acme/lib" }) },
      defaultBranchRef: {
        name: "main",
        target: {
          history: {
            nodes: [
              node("c3", "feat: three (#3)"),
              node("c2", "chore: two"),
              node("t", "chore(release): 1.2.3"),
              node("c0", "fix: older"),
            ],
          },
          statusCheckRollup: { state: "SUCCESS", contexts: { nodes: [] } },
        },
      },
    });
    expect(r.commits.map((c) => c.oid)).toEqual(["c3", "c2"]);
    expect(r.commits[0]).toMatchObject({ type: "feat", pr: 3 });
    expect(r.moreCommits).toBe(false);
    expect(r.tag).toEqual({ name: "v1.2.3", at: T("2026-11-01T00:00:00Z") });
    expect(r.head).toEqual({ short: "c3", subject: "feat: three (#3)" });
    expect(r.packageName).toBe("@acme/lib");
    expect(r.redCi).toBeNull();
  });

  it("flags a history that never reaches the tag", () => {
    const r = toRepo(list, {
      pkg: null,
      defaultBranchRef: {
        name: "main",
        target: { history: { nodes: [node("c9", "fix: x")] } },
      },
    });
    expect(r.commits).toHaveLength(1);
    expect(r.moreCommits).toBe(true);
  });

  it("survives a repo GitHub returned nothing for", () => {
    const r = toRepo({ ...list, tags: { nodes: [] } }, null);
    expect(r).toMatchObject({ tag: null, commits: [], moreCommits: false });
  });
});

describe("redCiOf", () => {
  it("names the first failed check and only trusts github.com links", () => {
    expect(
      redCiOf({
        state: "FAILURE",
        contexts: {
          nodes: [
            {
              __typename: "CheckRun",
              name: "lint",
              conclusion: "SUCCESS",
              detailsUrl: null,
              completedAt: null,
            },
            {
              __typename: "CheckRun",
              name: "test (ubuntu, node 22)",
              conclusion: "FAILURE",
              detailsUrl: "https://github.com/acme/lib/actions/runs/1/job/2",
              completedAt: "2026-11-10T12:00:00Z",
            },
          ],
        },
      }),
    ).toEqual({
      check: "test (ubuntu, node 22)",
      url: "https://github.com/acme/lib/actions/runs/1/job/2",
      since: T("2026-11-10T12:00:00Z"),
    });
    expect(
      redCiOf({
        state: "ERROR",
        contexts: {
          nodes: [
            {
              __typename: "StatusContext",
              context: "ci/legacy",
              state: "ERROR",
              targetUrl: "https://evil.example/x",
              createdAt: "2026-11-10T12:00:00Z",
            },
          ],
        },
      })?.url,
    ).toBeNull();
  });

  it("is null for green or pending", () => {
    expect(redCiOf(null)).toBeNull();
    expect(redCiOf({ state: "PENDING", contexts: { nodes: [] } })).toBeNull();
  });
});

describe("packageNameOf", () => {
  it("returns publishable names only", () => {
    expect(packageNameOf('{"name":"@acme/lib"}')).toBe("@acme/lib");
    expect(packageNameOf('{"name":"lib","private":true}')).toBeNull();
    expect(packageNameOf('{"name":"../../evil"}')).toBeNull();
    expect(packageNameOf("not json")).toBeNull();
    expect(packageNameOf(undefined)).toBeNull();
  });
});

describe("runState and sortRepos", () => {
  const waiting = repo({
    repo: "acme/w",
    waiting: [
      {
        id: 1,
        number: 9,
        workflow: "release.yml",
        url: "https://github.com/acme/w/actions/runs/1",
        createdAt: T("2026-11-10T00:00:00Z"),
      },
    ],
  });
  const red = repo({
    repo: "acme/r",
    redCi: { check: "test", url: null, since: 0 },
  });
  const many = repo({
    repo: "acme/m",
    commits: [commit("feat: a"), commit("fix: b")],
  });
  const one = repo({ repo: "acme/o", commits: [commit("fix: a")] });
  const chores = repo({ repo: "acme/c", commits: [commit("chore: a")] });
  const current = repo({
    repo: "acme/a",
    npm: { version: "1.2.3", publishedAt: T("2026-11-02T00:00:00Z") },
  });
  const other = repo({ repo: "acme/b" });

  it("orders waiting, red, most releasing, other commits, up to date", () => {
    expect(
      sortRepos([other, current, chores, one, many, red, waiting]).map(
        (r) => r.repo,
      ),
    ).toEqual([
      "acme/w",
      "acme/r",
      "acme/m",
      "acme/o",
      "acme/c",
      "acme/a",
      "acme/b",
    ]);
  });

  it("gives each repo its Release run cell", () => {
    expect(runState(waiting)).toEqual({
      kind: "waiting",
      since: T("2026-11-10T00:00:00Z"),
    });
    expect(runState(red)).toEqual({ kind: "red" });
    expect(runState(one)).toEqual({ kind: "not-started" });
    expect(runState(current)).toEqual({
      kind: "published",
      at: T("2026-11-02T00:00:00Z"),
    });
    expect(runState(chores)).toEqual({ kind: "none" });
  });
});

describe("detailQuery", () => {
  it("passes repo names as variables, never in the query text", () => {
    const q = detailQuery(2);
    expect(q).toContain("$o0: String!, $n0: String!, $o1: String!");
    expect(q).toContain("r1: repository(owner: $o1, name: $n1) { ...D }");
    expect(q).toContain("fragment D on Repository");
  });
});

describe("readReleases (#162)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("answers at once after a failed read, and retries after a minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubEnv("GITHUB_TOKEN", "gh");
    vi.stubEnv("GITHUB_OWNERS", "acme");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = vi.fn(async () => new Response("{}", { status: 502 }));
    vi.stubGlobal("fetch", fetch);

    const first = await readReleases();
    expect(first.releases).toBeNull();
    const calls = fetch.mock.calls.length;
    expect(calls).toBeGreaterThan(0);

    expect(await readReleases()).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(calls);

    vi.setSystemTime(Date.now() + 61_000);
    await readReleases();
    expect(fetch.mock.calls.length).toBeGreaterThan(calls);
  });
});
