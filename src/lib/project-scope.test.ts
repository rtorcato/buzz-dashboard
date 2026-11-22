import { describe, expect, it } from "vitest";
import type { NeedsYouRow } from "./needs-you-rows";
import {
  agentInScope,
  channelInScope,
  channelProjectLabel,
  chipLabel,
  elsewhereCount,
  eventScope,
  isApp,
  needsYouCount,
  parseProjectParam,
  projectInitials,
  releaseModelLabel,
  repoInScope,
  resolveScope,
  type ScopeProject,
  scopeNeedsYou,
  scopeOfProject,
  slugOfPath,
  withProject,
} from "./project-scope";

const project = (over: Partial<ScopeProject> = {}): ScopeProject => ({
  slug: "db-common",
  name: "db-common",
  shortLabel: "DB",
  releaseModel: "changesets",
  defaultBranch: "main",
  devBranch: null,
  repos: ["rtorcato/db-common"],
  channels: ["ch-db"],
  channelNames: ["db-common"],
  agents: ["Devastator"],
  ...over,
});

const dbCommon = project();
const dashboard = project({
  slug: "buzz-dashboard",
  name: "buzz-dashboard",
  shortLabel: "BD",
  releaseModel: "app_dev",
  devBranch: "dev",
  repos: ["rtorcato/buzz-dashboard"],
  channels: ["ch-bd"],
  channelNames: ["buzz-dashboard"],
  agents: ["Shockwave", "Devastator"],
});
const all = [dbCommon, dashboard];

describe("parseProjectParam", () => {
  it("reads one slug or a comma list", () => {
    expect(parseProjectParam("db-common")).toEqual(["db-common"]);
    expect(parseProjectParam("db-common,buzz-dashboard")).toEqual([
      "db-common",
      "buzz-dashboard",
    ]);
  });
  it("drops invalid slugs and repeats, and lowercases", () => {
    expect(parseProjectParam("DB-Common, ,../x,db-common,a b")).toEqual([
      "db-common",
    ]);
  });
  it("is empty without a value", () => {
    expect(parseProjectParam(undefined)).toEqual([]);
    expect(parseProjectParam("")).toEqual([]);
    expect(parseProjectParam(null)).toEqual([]);
  });
  it("takes the first of a repeated param", () => {
    expect(parseProjectParam(["a", "b"])).toEqual(["a"]);
  });
});

describe("slugOfPath", () => {
  it("reads a project page's slug", () => {
    expect(slugOfPath("/projects/db-common")).toBe("db-common");
    expect(slugOfPath("/projects/db-common/")).toBe("db-common");
  });
  it("is null elsewhere", () => {
    expect(slugOfPath("/projects")).toBeNull();
    expect(slugOfPath("/pipeline")).toBeNull();
    expect(slugOfPath("/projects/a/b")).toBeNull();
  });
});

describe("resolveScope", () => {
  it("unions the projects it finds", () => {
    const { scope, unknown } = resolveScope(all, [
      "db-common",
      "buzz-dashboard",
    ]);
    expect(unknown).toEqual([]);
    expect(scope?.names).toEqual(["db-common", "buzz-dashboard"]);
    expect(scope?.repos).toEqual([
      "rtorcato/db-common",
      "rtorcato/buzz-dashboard",
    ]);
    expect(scope?.channels).toEqual(["ch-db", "ch-bd"]);
    // Devastator is in both and listed once.
    expect(scope?.agents).toEqual(["Devastator", "Shockwave"]);
  });
  it("reports slugs that name no project", () => {
    const { scope, unknown } = resolveScope(all, ["db-common", "nope"]);
    expect(scope?.slugs).toEqual(["db-common"]);
    expect(unknown).toEqual(["nope"]);
  });
  it("has no scope when nothing matches, so a view shows everything", () => {
    expect(resolveScope(all, ["nope"]).scope).toBeNull();
    expect(resolveScope(all, []).scope).toBeNull();
  });
});

describe("chipLabel", () => {
  it("names one project or counts the rest", () => {
    expect(chipLabel({ names: ["db-common"] })).toBe("db-common");
    expect(chipLabel({ names: ["db-common", "a", "b"] })).toBe("db-common + 2");
  });
});

describe("matching by repo, channel and agent", () => {
  const scope = scopeOfProject(dbCommon);
  it("matches a repo in any case", () => {
    expect(repoInScope(scope, "Rtorcato/DB-Common")).toBe(true);
    expect(repoInScope(scope, "rtorcato/js-common")).toBe(false);
    expect(repoInScope(scope, null)).toBe(false);
  });
  it("matches a channel id", () => {
    expect(channelInScope(scope, "ch-db")).toBe(true);
    expect(channelInScope(scope, "ch-bd")).toBe(false);
    expect(channelInScope(scope, null)).toBe(false);
  });
  it("matches an agent by name", () => {
    expect(agentInScope(scope, "Devastator")).toBe(true);
    expect(agentInScope(scope, "Bumble")).toBe(false);
    expect(agentInScope(scope, undefined)).toBe(false);
  });
});

describe("eventScope", () => {
  it("gives the repos lowercase and the channels as they are", () => {
    expect(
      eventScope({ repos: ["rtorcato/DB-Common"], channels: ["ch-db"] }),
    ).toEqual({ repos: ["rtorcato/db-common"], channels: ["ch-db"] });
  });
});

const T = (s: string) => `${s}T00:00:00.000Z`;
const rows: NeedsYouRow[] = [
  {
    kind: "merge",
    title: "3 PRs ready to merge",
    detail: "db-common#2, buzz-dashboard#9, db-common#7",
    count: 3,
    since: T("2026-10-01"),
    keys: [
      "merge:rtorcato/db-common#2",
      "merge:rtorcato/buzz-dashboard#9",
      "merge:rtorcato/db-common#7",
    ],
    items: [
      {
        repo: "rtorcato/db-common",
        label: "db-common#2",
        at: T("2026-10-03"),
        key: "merge:rtorcato/db-common#2",
      },
      {
        repo: "rtorcato/buzz-dashboard",
        label: "buzz-dashboard#9",
        at: T("2026-10-01"),
        key: "merge:rtorcato/buzz-dashboard#9",
      },
      {
        repo: "rtorcato/db-common",
        label: "db-common#7",
        at: T("2026-10-05"),
        key: "merge:rtorcato/db-common#7",
      },
    ],
  },
  {
    kind: "blocked",
    title: "1 item blocked",
    detail: "buzz-dashboard#4",
    count: 1,
    since: T("2026-10-02"),
    keys: ["blocked:rtorcato/buzz-dashboard#4"],
    items: [
      {
        repo: "rtorcato/buzz-dashboard",
        label: "buzz-dashboard#4",
        at: T("2026-10-02"),
        key: "blocked:rtorcato/buzz-dashboard#4",
        pr: true,
      },
    ],
  },
  {
    kind: "failing",
    title: "Devastator is failing turns",
    detail: "6 of 14 turns ended in error in the last hour",
    count: 1,
    since: T("2026-10-04"),
    keys: ["failing:Devastator"],
    items: [
      {
        repo: null,
        agent: "Devastator",
        label: "Devastator",
        at: T("2026-10-04"),
        key: "failing:Devastator",
      },
    ],
  },
  {
    kind: "paused",
    title: "Paused for usage",
    detail: "5h at 91%",
    count: 1,
    since: T("2026-10-06"),
  },
  {
    kind: "release",
    title: "2 releases waiting for your approval",
    detail: "db-common, js-common",
    count: 2,
    since: T("2026-10-01"),
    keys: [
      "release:rtorcato/db-common#run-1",
      "release:rtorcato/js-common#run-2",
    ],
    items: [
      {
        repo: "rtorcato/db-common",
        label: "db-common",
        at: T("2026-10-02"),
        key: "release:rtorcato/db-common#run-1",
      },
      {
        repo: "rtorcato/js-common",
        label: "js-common",
        at: T("2026-10-01"),
        key: "release:rtorcato/js-common#run-2",
      },
    ],
  },
];

describe("scopeNeedsYou", () => {
  it("returns every row with no scope", () => {
    expect(scopeNeedsYou(rows, null)).toBe(rows);
  });

  it("rebuilds a group to just the project's items", () => {
    const [merge] = scopeNeedsYou(rows, scopeOfProject(dbCommon));
    expect(merge).toMatchObject({
      kind: "merge",
      title: "2 PRs ready to merge",
      detail: "db-common#2, db-common#7",
      count: 2,
      since: T("2026-10-03"),
      keys: ["merge:rtorcato/db-common#2", "merge:rtorcato/db-common#7"],
    });
  });

  it("keeps a row whole when every item is the project's", () => {
    const out = scopeNeedsYou(rows, scopeOfProject(dbCommon));
    const release = out.find((r) => r.kind === "release");
    expect(release?.title).toBe("1 release waiting for your approval");
    expect(release?.detail).toBe("db-common");
    const blocked = scopeNeedsYou(rows, scopeOfProject(dashboard)).find(
      (r) => r.kind === "blocked",
    );
    expect(blocked?.title).toBe("1 item blocked");
    expect(blocked).toBe(rows[1]);
  });

  it("places a failing agent by the project's agents", () => {
    const kinds = (s: ScopeProject) =>
      scopeNeedsYou(rows, scopeOfProject(s)).map((r) => r.kind);
    expect(kinds(dbCommon)).toContain("failing");
    expect(kinds(project({ agents: ["Bumble"] }))).not.toContain("failing");
  });

  it("drops a hive-wide row, which belongs to no project", () => {
    expect(
      scopeNeedsYou(rows, scopeOfProject(dbCommon)).map((r) => r.kind),
    ).not.toContain("paused");
  });

  it("drops a row with none of the project's items", () => {
    expect(
      scopeNeedsYou(
        rows,
        scopeOfProject(project({ repos: ["x/y"], agents: [] })),
      ),
    ).toEqual([]);
  });

  it("says item when a blocked PR stays in the subset", () => {
    const mixed: NeedsYouRow = {
      kind: "blocked",
      title: "2 items blocked",
      detail: "a#1, b#2",
      count: 2,
      since: T("2026-10-01"),
      items: [
        { repo: "o/a", label: "a#1", at: T("2026-10-01") },
        { repo: "o/b", label: "b#2", at: T("2026-10-02"), pr: true },
      ],
    };
    const only = (repo: string) =>
      scopeNeedsYou(
        [mixed],
        scopeOfProject(project({ repos: [repo], agents: [] })),
      )[0].title;
    expect(only("o/a")).toBe("1 issue blocked");
    expect(only("o/b")).toBe("1 item blocked");
  });

  it("counts what needs the owner per project", () => {
    expect(needsYouCount(rows, dbCommon)).toBe(2 + 1 + 1);
    expect(needsYouCount(rows, dashboard)).toBe(1 + 1 + 1);
  });

  it("counts what sits in other projects, hive-wide included", () => {
    const scope = scopeOfProject(dbCommon);
    // 3 + 1 + 1 + 1 + 2 = 8 items; the project has 4.
    expect(elsewhereCount(rows, scope)).toBe(4);
    expect(elsewhereCount(rows, null)).toBe(0);
  });
});

describe("withProject", () => {
  it("adds the filter to a path or a query", () => {
    expect(withProject("/pipeline", ["db-common"])).toBe(
      "/pipeline?project=db-common",
    );
    expect(withProject("/pipeline?tab=flow", ["db-common"])).toBe(
      "/pipeline?tab=flow&project=db-common",
    );
  });
  it("replaces an earlier filter and writes a list with commas", () => {
    expect(withProject("/cost?project=x&range=7d", ["a", "b"])).toBe(
      "/cost?project=a,b&range=7d",
    );
  });
  it("removes it with no slugs and keeps the rest and the hash", () => {
    expect(withProject("/cost?project=x&range=7d#top", [])).toBe(
      "/cost?range=7d#top",
    );
    expect(withProject("/cost?project=x", [])).toBe("/cost");
  });
});

describe("labels", () => {
  it("words the release model", () => {
    expect(releaseModelLabel(dbCommon)).toBe("Changesets");
    expect(releaseModelLabel(project({ releaseModel: "milestone" }))).toBe(
      "Milestone batch",
    );
    expect(releaseModelLabel(dashboard)).toBe("App · dev → main");
    expect(releaseModelLabel(project({ releaseModel: "none" }))).toBe(
      "No releases",
    );
    expect(releaseModelLabel(project({ releaseModel: "unknown" }))).toBe(
      "Release model not set",
    );
  });
  it("calls a dev-branch project an app", () => {
    expect(isApp(dashboard)).toBe(true);
    expect(isApp(dbCommon)).toBe(false);
  });
  it("makes tile letters from the label or the name", () => {
    expect(projectInitials(dbCommon)).toBe("DB");
    expect(projectInitials({ name: "repo-tooling", shortLabel: null })).toBe(
      "RT",
    );
    expect(projectInitials({ name: "homelab", shortLabel: null })).toBe("HO");
  });
  it("places a channel in a project, hive-wide or nowhere", () => {
    expect(channelProjectLabel("ch-db", all, [])).toBe("db-common");
    expect(channelProjectLabel("ch-rel", all, ["ch-rel"])).toBe("Hive-wide");
    expect(channelProjectLabel("ch-x", all, ["ch-rel"])).toBe("Unassigned");
  });
});
