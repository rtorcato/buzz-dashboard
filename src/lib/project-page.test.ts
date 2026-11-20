import { describe, expect, it } from "vitest";
import type { Claim, GitHub, GitHubItem } from "./github";
import {
  openAsks,
  parsePrTab,
  projectKpis,
  projectPrs,
  prStage,
  prsFor,
} from "./project-page";
import { resolveScope, type ScopeProject } from "./project-scope";

const NOW = 1_800_000_000;
const DAY = 86_400;

const item = (over: Partial<GitHubItem> = {}): GitHubItem => ({
  repo: "rtorcato/db-common",
  number: 1,
  title: "feat: x",
  url: "https://github.com/rtorcato/db-common/pull/1",
  isPr: true,
  labels: [],
  agent: null,
  author: "rtorcato-bot",
  createdAt: NOW - DAY,
  closedAt: null,
  mergedAt: null,
  reviews: [],
  labelEvents: [],
  ...over,
});
const claim = (over: Partial<Claim> = {}): Claim => ({
  ...item({ isPr: false, ...over }),
  claimedAt: NOW - 2 * DAY,
  ...over,
});
const github = (prs: GitHubItem[], claims: Claim[] = []): GitHub => ({
  prs,
  claims,
  releases: [],
  truncated: false,
});

const dbCommon: ScopeProject = {
  slug: "db-common",
  name: "db-common",
  shortLabel: null,
  releaseModel: "changesets",
  defaultBranch: "main",
  devBranch: null,
  repos: ["rtorcato/db-common"],
  channels: [],
  channelNames: [],
  agents: [],
};
const scope = resolveScope([dbCommon], ["db-common"]).scope;
if (!scope) throw new Error("scope");

describe("prStage", () => {
  it("reads the stage from labels and title", () => {
    expect(prStage(item({ labels: ["merge-ready"] })).label).toBe(
      "merge-ready",
    );
    expect(prStage(item({ labels: ["ai-needs-db"] }))).toEqual({
      label: "ai-needs-db",
      tone: "database",
    });
    expect(prStage(item({ labels: ["ai-review"] })).label).toBe("ai-review");
    expect(prStage(item({ title: "chore: version packages" })).label).toBe(
      "release",
    );
    expect(prStage(item()).label).toBe("open");
  });
  it("puts a blocked or changes-requested PR first", () => {
    expect(prStage(item({ labels: ["merge-ready", "ai-blocked"] })).tone).toBe(
      "blocked",
    );
    expect(prStage(item({ labels: ["ai-changes"] })).tone).toBe("blocked");
  });
  it("says merged or closed for a finished PR", () => {
    expect(prStage(item({ mergedAt: NOW })).label).toBe("merged");
    expect(prStage(item({ closedAt: NOW })).label).toBe("closed");
  });
});

describe("projectPrs and prsFor", () => {
  const gh = github([
    item({ number: 1 }),
    item({ number: 2, repo: "rtorcato/js-common" }),
    item({ number: 3, mergedAt: NOW - DAY, closedAt: NOW - DAY }),
  ]);
  it("keeps the project's repos only, in any case", () => {
    expect(projectPrs(gh, scope).map((p) => p.number)).toEqual([1, 3]);
    expect(
      projectPrs(github([item({ repo: "Rtorcato/DB-Common" })]), scope),
    ).toHaveLength(1);
  });
  it("splits open from merged", () => {
    const prs = projectPrs(gh, scope);
    expect(prsFor(prs, "open").map((p) => p.number)).toEqual([1]);
    expect(prsFor(prs, "merged").map((p) => p.number)).toEqual([3]);
  });
  it("parses the tab, open by default", () => {
    expect(parsePrTab("merged")).toBe("merged");
    expect(parsePrTab("x")).toBe("open");
    expect(parsePrTab(null)).toBe("open");
  });
});

describe("projectKpis", () => {
  it("counts the project's PRs, merges and claims", () => {
    const k = projectKpis(
      github(
        [
          item({ number: 1, labels: ["merge-ready"] }),
          item({ number: 2 }),
          item({
            number: 3,
            createdAt: NOW - 3 * DAY,
            mergedAt: NOW - 3 * DAY + 3600,
            closedAt: NOW - 3 * DAY + 3600,
          }),
          item({
            number: 4,
            createdAt: NOW - 2 * DAY,
            mergedAt: NOW - 2 * DAY + 7200,
            closedAt: NOW - 2 * DAY + 7200,
          }),
          // Merged before the week, and in another repo.
          item({
            number: 5,
            createdAt: NOW - 20 * DAY,
            mergedAt: NOW - 19 * DAY,
            closedAt: NOW - 19 * DAY,
          }),
          item({ number: 6, repo: "rtorcato/js-common" }),
        ],
        [
          claim({ number: 10 }),
          claim({ number: 11, labels: ["ai-blocked"] }),
          claim({ number: 12, repo: "rtorcato/js-common" }),
        ],
      ),
      scope,
      NOW,
    );
    expect(k).toEqual({
      openPrs: 2,
      mergeReady: 1,
      merged7d: 2,
      medianOpenToMerged: 5400,
      claimed: 2,
      blocked: 1,
    });
  });
  it("has no median without a merge this week", () => {
    expect(projectKpis(github([]), scope, NOW).medianOpenToMerged).toBeNull();
  });
});

describe("openAsks", () => {
  it("lists blocked items, merge-ready PRs and specialist asks, oldest first", () => {
    const asks = openAsks(
      github(
        [
          item({ number: 1, labels: ["merge-ready"], createdAt: NOW - DAY }),
          item({
            number: 2,
            labels: ["ai-needs-db"],
            createdAt: NOW - 3 * DAY,
          }),
          item({ number: 3, labels: ["ai-review"] }),
          item({
            number: 4,
            labels: ["merge-ready"],
            repo: "rtorcato/js-common",
          }),
        ],
        [
          claim({
            number: 9,
            labels: ["ai-blocked"],
            claimedAt: NOW - 5 * DAY,
          }),
        ],
      ),
      scope,
    );
    expect(asks.map((a) => [a.kind, a.ref])).toEqual([
      ["blocked", "db-common#9"],
      ["needs", "db-common#2"],
      ["merge", "db-common#1"],
    ]);
    expect(asks[1].detail).toBe("ai-needs-db");
  });
  it("lists a blocked PR once", () => {
    const blockedPr = item({
      number: 7,
      labels: ["ai-blocked", "merge-ready"],
    });
    const asks = openAsks(
      github([blockedPr], [claim({ ...blockedPr, claimedAt: NOW })]),
      scope,
    );
    expect(asks).toHaveLength(1);
    expect(asks[0].kind).toBe("blocked");
  });
  it("skips a closed PR", () => {
    expect(
      openAsks(
        github([item({ labels: ["merge-ready"], closedAt: NOW })]),
        scope,
      ),
    ).toEqual([]);
  });
});
