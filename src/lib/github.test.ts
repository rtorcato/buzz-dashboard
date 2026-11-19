import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.stubEnv("GITHUB_OWNERS", "acme, acme-labs");
vi.stubEnv("GITHUB_TRUSTED_AUTHORS", "acme-bot,acme");
vi.stubEnv(
  "AGENT_ALIASES",
  JSON.stringify({
    "Optimus Prime": "Prime",
    Fizz: "Prime",
    Comb: "Shockwave",
    Zoey: "Arcee",
  }),
);

const {
  buildQuery,
  claimFrom,
  claimQuery,
  getGitHub,
  headerAgent,
  prQueries,
  toClaim,
  toItem,
  toReleases,
} = await import("./github");

const header = (name: string) =>
  `🤖 *Automated — \`@${name}\` 🐝 (Buzz agent) via ai-loop.*`;

const comment = (
  body: string | null,
  createdAt: string,
  login = "acme-bot",
) => ({
  body,
  createdAt,
  author: { login },
});

const raw = (over: Record<string, unknown> = {}) => ({
  __typename: "PullRequest" as "Issue" | "PullRequest",
  number: 7,
  title: "feat: thing",
  url: "https://github.com/acme/js-common/pull/7",
  body: `${header("Shockwave")}\n\nBody.`,
  createdAt: "2026-10-18T10:00:00Z",
  closedAt: null,
  mergedAt: null,
  author: { login: "acme-bot" },
  repository: { nameWithOwner: "acme/js-common" },
  labels: { nodes: [{ name: "ai-review" }] },
  ...over,
});

const at = (iso: string) => Date.parse(iso) / 1000;

describe("headerAgent", () => {
  it("reads the agent from the header, after a hidden marker", () => {
    expect(headerAgent(`<!-- ai-issue-loop:x -->\n${header("Jazz")}`)).toBe(
      "Jazz",
    );
  });

  it("maps former names and ignores bodies without a header", () => {
    expect(headerAgent(header("Optimus Prime"))).toBe("Prime");
    expect(headerAgent(header("Comb"))).toBe("Shockwave");
    expect(headerAgent("Bumps braces from 3.0.2 to 3.0.4.")).toBeNull();
    expect(headerAgent("Ping `@Jazz` please")).toBeNull();
    expect(headerAgent(null)).toBeNull();
  });
});

describe("toItem", () => {
  it("attributes a PR from its body and keeps the repo's case", () => {
    expect(
      toItem(
        raw({
          repository: { nameWithOwner: "acme/Buzz-dashboard" },
          mergedAt: "2026-10-18T12:00:00Z",
        }),
      ),
    ).toMatchObject({
      repo: "acme/Buzz-dashboard",
      isPr: true,
      agent: "Shockwave",
      labels: ["ai-review"],
      createdAt: at("2026-10-18T10:00:00Z"),
      mergedAt: at("2026-10-18T12:00:00Z"),
      closedAt: null,
    });
  });

  it("keeps submitted reviews and drops pending ones (#47)", () => {
    expect(
      toItem(
        raw({
          reviews: {
            nodes: [
              {
                state: "CHANGES_REQUESTED",
                submittedAt: "2026-10-18T11:00:00Z",
                author: { login: "alice" },
              },
              { state: "PENDING", submittedAt: null, author: null },
              null,
              {
                state: "APPROVED",
                submittedAt: "2026-10-18T11:30:00Z",
                author: null,
              },
            ],
          },
        }),
      ).reviews,
    ).toEqual([
      {
        state: "CHANGES_REQUESTED",
        at: at("2026-10-18T11:00:00Z"),
        author: "alice",
      },
      { state: "APPROVED", at: at("2026-10-18T11:30:00Z"), author: "ghost" },
    ]);
    expect(toItem(raw({ __typename: "Issue" })).reviews).toEqual([]);
  });

  it("ignores a header in a PR from anyone but the bot or the owner (#37)", () => {
    expect(toItem(raw({ author: { login: "mallory" } })).agent).toBeNull();
    expect(toItem(raw({ author: null })).agent).toBeNull();
    expect(toItem(raw({ author: { login: "acme" } })).agent).toBe("Shockwave");
  });

  it("trusts nobody when GITHUB_TRUSTED_AUTHORS is unset", () => {
    vi.stubEnv("GITHUB_TRUSTED_AUTHORS", "");
    try {
      expect(toItem(raw()).agent).toBeNull();
    } finally {
      vi.stubEnv("GITHUB_TRUSTED_AUTHORS", "acme-bot,acme");
    }
  });

  it("never attributes an issue to its filer", () => {
    expect(toItem(raw({ __typename: "Issue" }))).toMatchObject({
      isPr: false,
      agent: null,
      mergedAt: null,
    });
  });
});

describe("claims", () => {
  it("take the newest claim comment's header", () => {
    expect(
      claimFrom([
        comment(
          `${header("Bumble")}\n\nClaimed by \`@Bumble\`.`,
          "2026-10-01T00:00:00Z",
        ),
        comment(
          `${header("Jazz")}\n\nCode review passed.`,
          "2026-10-02T00:00:00Z",
        ),
        comment(
          `${header("Fizz")}\n\nClaimed by \`@Fizz\`.`,
          "2026-10-03T00:00:00Z",
        ),
        comment(null, "2026-10-04T00:00:00Z"),
      ]),
    ).toEqual({ agent: "Prime", at: at("2026-10-03T00:00:00Z") });
  });

  it("skip a forged claim comment from another author (#37)", () => {
    expect(
      claimFrom([
        comment(
          `${header("Bumble")}\n\nClaimed by \`@Bumble\`.`,
          "2026-10-01T00:00:00Z",
        ),
        comment(
          `${header("Jazz")}\n\nClaimed by \`@Jazz\`.`,
          "2026-10-02T00:00:00Z",
          "mallory",
        ),
      ]),
    ).toEqual({ agent: "Bumble", at: at("2026-10-01T00:00:00Z") });
  });

  it("are unattributed without a claim comment", () => {
    const issue = raw({
      __typename: "Issue",
      comments: { nodes: [comment(header("Jazz"), "2026-10-02T00:00:00Z")] },
    });
    expect(toClaim(issue)).toMatchObject({
      agent: null,
      claimedAt: at("2026-10-18T10:00:00Z"),
    });
  });

  it("use a PR's own header and creation time", () => {
    expect(toClaim(raw())).toMatchObject({
      agent: "Shockwave",
      claimedAt: at("2026-10-18T10:00:00Z"),
    });
  });
});

describe("queries", () => {
  it("cover 30 days in contiguous 1-day slices up to today", () => {
    const q = prQueries(new Date("2026-10-19T14:00:00Z"), [
      "acme",
      "acme-labs",
    ]);
    expect(q).toHaveLength(30);
    expect(q[0]).toBe(
      "is:pr user:acme user:acme-labs created:2026-09-19..2026-09-19",
    );
    expect(q[1]).toContain("created:2026-09-20..2026-09-20");
    expect(q.at(-2)).toContain("created:2026-10-17..2026-10-17");
    expect(q.at(-1)).toContain("created:>=2026-10-18");
  });

  it("ask for every claim label on both owners", () => {
    expect(claimQuery(["acme", "acme-labs"])).toBe(
      "is:open label:ai-wip,ai-review,ai-changes,ai-blocked user:acme user:acme-labs",
    );
  });

  it("pass search strings as variables only", () => {
    const q = buildQuery(["claims", "s0", "s1"]);
    expect(q).toMatch(
      /^query\(\$claims: String!, \$s0: String!, \$s1: String!\)/,
    );
    expect(q).toContain("s1: search(type: ISSUE, query: $s1, first: 100)");
    expect(q).not.toContain("user:");
    // Only the claims search reads comments.
    expect(q.match(/comments\(last: 30\)/g)).toHaveLength(1);
    expect(buildQuery(["s0"])).not.toContain("comments");
  });
});

describe("label events and releases (#54)", () => {
  it("reads label changes from the timeline, oldest first", () => {
    const item = toItem(
      raw({
        timelineItems: {
          nodes: [
            {
              __typename: "LabeledEvent",
              createdAt: "2026-10-18T10:00:00Z",
              actor: { login: "rtorcato" },
              label: { name: "ai-ready" },
            },
            null,
            {
              __typename: "UnlabeledEvent",
              createdAt: "2026-10-18T11:00:00Z",
              actor: null,
              label: { name: "ai-ready" },
            },
          ],
        },
      }),
    );
    expect(item.labelEvents).toEqual([
      {
        label: "ai-ready",
        action: "added",
        at: at("2026-10-18T10:00:00Z"),
        actor: "rtorcato",
      },
      {
        label: "ai-ready",
        action: "removed",
        at: at("2026-10-18T11:00:00Z"),
        actor: "ghost",
      },
    ]);
  });

  it("keeps published releases and drops drafts", () => {
    const rel = (over: object) => ({
      name: "",
      tagName: "v1.0.0",
      url: "u",
      publishedAt: "2026-10-18T10:00:00Z",
      isDraft: false,
      isPrerelease: false,
      author: { login: "github-actions[bot]" },
      ...over,
    });
    expect(
      toReleases({
        repositoryOwner: {
          repositories: {
            nodes: [
              {
                nameWithOwner: "acme/app",
                releases: {
                  nodes: [
                    rel({}),
                    rel({ tagName: "v2.0.0", isDraft: true }),
                    rel({ tagName: "v1.1.0", publishedAt: null }),
                  ],
                },
              },
              null,
            ],
          },
        },
      }),
    ).toEqual([
      {
        repo: "acme/app",
        tag: "v1.0.0",
        name: "v1.0.0",
        url: "u",
        publishedAt: at("2026-10-18T10:00:00Z"),
        author: "github-actions[bot]",
        prerelease: false,
      },
    ]);
    expect(toReleases({ repositoryOwner: null })).toEqual([]);
  });
});

describe("getGitHub", () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (body: unknown, status = 200) =>
    vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify(body), { status }),
    );

  // Answers each request with the searches it asked for.
  const serve = (data: Record<string, unknown>) =>
    vi.fn(async (_url: string, init: RequestInit) => {
      const { variables } = JSON.parse(init.body as string);
      const answer = Object.fromEntries(
        Object.keys(variables).map((k) => [
          k,
          data[k] ?? { issueCount: 0, nodes: [] },
        ]),
      );
      return new Response(JSON.stringify({ data: answer }));
    });

  it("reads claims and PRs in a few sequential requests", async () => {
    const issue = raw({
      __typename: "Issue",
      number: 3,
      createdAt: "2026-10-18T11:00:00Z",
      comments: {
        nodes: [
          comment(
            `${header("Soundwave")}\n\nClaimed by \`@Soundwave\`.`,
            "2026-10-18T12:00:00Z",
          ),
        ],
      },
    });
    const fetch = serve({
      claims: { issueCount: 2, nodes: [raw(), issue] },
      s29: { issueCount: 2, nodes: [raw({ number: 8 }), null] },
    });
    vi.stubGlobal("fetch", fetch);

    const gh = await getGitHub("t0k", new Date("2026-10-19T14:00:00Z"));
    // 31 searches, 4 per request, then one releases read per owner.
    expect(fetch).toHaveBeenCalledTimes(10);
    const sent = fetch.mock.calls.slice(0, 8).map(([url, init]) => {
      expect(url).toBe("https://api.github.com/graphql");
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer t0k");
      return JSON.parse(init.body as string).variables;
    });
    expect(sent[0].claims).toBe(claimQuery(["acme", "acme-labs"]));
    expect(sent[7].s29).toContain("created:>=2026-10-18");

    expect(gh.claims.map((c) => [c.number, c.agent, c.claimedAt])).toEqual([
      [3, "Soundwave", at("2026-10-18T12:00:00Z")],
      [7, "Shockwave", at("2026-10-18T10:00:00Z")],
    ]);
    expect(gh.prs.map((p) => p.number)).toEqual([8]);
    expect(gh.truncated).toBe(false);
  });

  it("keeps PRs and claims when a releases read fails", async () => {
    const search = serve({ claims: { issueCount: 1, nodes: [raw()] } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) =>
        "owner" in JSON.parse(init.body as string).variables
          ? new Response("{}", { status: 502 })
          : search(url, init),
      ),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const gh = await getGitHub("t0k");
    expect(gh.claims).toHaveLength(1);
    expect(gh.releases).toEqual([]);
  });

  it("refuses to search without GITHUB_OWNERS", async () => {
    const fetch = serve({});
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("GITHUB_OWNERS", " , ");
    try {
      await expect(getGitHub("t0k")).rejects.toThrow(
        "GITHUB_OWNERS is not set",
      );
    } finally {
      vi.stubEnv("GITHUB_OWNERS", "acme, acme-labs");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("flags a search that returned fewer nodes than it matched", async () => {
    vi.stubGlobal("fetch", serve({ claims: { issueCount: 101, nodes: [] } }));
    expect((await getGitHub("t0k")).truncated).toBe(true);
  });

  it("fails without leaking the token or GitHub's message", async () => {
    vi.stubGlobal("fetch", respond({}, 401));
    await expect(getGitHub("t0k")).rejects.toThrow(
      "GitHub GraphQL failed: HTTP 401",
    );
    vi.stubGlobal(
      "fetch",
      respond({ data: null, errors: [{ type: "RATE_LIMITED", message: "x" }] }),
    );
    await expect(getGitHub("t0k")).rejects.toThrow(
      "GitHub GraphQL error: RATE_LIMITED",
    );
  });
});

describe("headerAgent escapes", () => {
  it("drops a backslash before the closing tick", () => {
    expect(headerAgent("🤖 *Automated — `@Bumble\\` 🐝 (Buzz agent)")).toBe(
      "Bumble",
    );
    expect(headerAgent(header("Zoey"))).toBe("Arcee");
  });
});
