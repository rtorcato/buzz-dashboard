import { describe, expect, it, vi } from "vitest";
import type { ProjectView } from "./project-store";

vi.mock("server-only", () => ({}));

const { toScopeProject } = await import("./project-data");

const view = (over: Partial<ProjectView> = {}): ProjectView => ({
  id: "1",
  slug: "db-common",
  name: "db-common",
  shortLabel: "DB",
  releaseModel: "changesets",
  defaultBranch: "main",
  devBranch: null,
  sortOrder: 0,
  revision: 1,
  archivedAt: null,
  repos: [
    { repo: "rtorcato/db-common", primary: true },
    { repo: "RTorcato/Other", primary: false },
  ],
  channels: [
    { channelId: "ch-db", home: true, label: null, revision: 0 },
    { channelId: "ch-gone", home: false, label: null, revision: 0 },
  ],
  agents: [
    { pubkey: "a".repeat(64), role: null },
    { pubkey: "b".repeat(64), role: "Reviewer" },
    { pubkey: "c".repeat(64), role: null },
  ],
  ...over,
});

describe("toScopeProject", () => {
  const agents = [
    { name: "Devastator", pubkeys: ["a".repeat(64)] },
    { name: "Jazz", pubkeys: ["b".repeat(64), "d".repeat(64)] },
  ];

  it("flattens the registry's links for the filters", () => {
    const p = toScopeProject(view(), agents, { "ch-db": "db-common" });
    expect(p.repos).toEqual(["rtorcato/db-common", "rtorcato/other"]);
    expect(p.channels).toEqual(["ch-db", "ch-gone"]);
    // A channel the relay doesn't name keeps its slot with an empty name.
    expect(p.channelNames).toEqual(["db-common", ""]);
    // An agent the relay doesn't list (pubkey c) is left out.
    expect(p.agents).toEqual(["Devastator", "Jazz"]);
  });

  it("keeps the model and branches the switcher words", () => {
    const p = toScopeProject(
      view({ releaseModel: "app_dev", devBranch: "dev" }),
      agents,
      {},
    );
    expect(p).toMatchObject({ releaseModel: "app_dev", devBranch: "dev" });
  });
});
