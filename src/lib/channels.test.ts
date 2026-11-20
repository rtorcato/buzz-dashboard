import { describe, expect, it } from "vitest";
import {
  buildChannelMap,
  type ChannelMap,
  inTab,
  unreadableByAgent,
} from "./channels";
import type { NostrEvent } from "./relay";

const hex = (c: string) => c.repeat(64);
const DASH = hex("d");
const FERN = hex("1");
const OWNER = hex("2");

const meta = (id: string, name: string, flags: string[] = []): NostrEvent => ({
  id: `m-${id}`,
  pubkey: hex("a"),
  created_at: 100,
  kind: 39000,
  tags: [["d", id], ["name", name], ...flags.map((f) => [f])],
  content: "",
  sig: "",
});
const members = (id: string, keys: string[], created_at = 100): NostrEvent => ({
  id: `l-${id}-${created_at}`,
  pubkey: hex("a"),
  created_at,
  kind: 39002,
  tags: [["d", id], ...keys.map((k) => ["p", k])],
  content: "",
  sig: "",
});

const agents = [{ name: "Fern", picture: null, pubkeys: [FERN] }];
const base = {
  dashboard: DASH,
  projects: [{ slug: "app", name: "app", shortLabel: "AP" }],
  agents,
  lastMessageByName: {},
};

function build(
  over: Partial<Parameters<typeof buildChannelMap>[0]> = {},
): ChannelMap {
  return buildChannelMap({
    ...base,
    assignments: [],
    events: [
      meta("a", "app", ["private"]),
      meta("b", "general"),
      meta("c", "secret", ["private"]),
      meta("d", "old", ["private", "archived"]),
      members("a", [FERN, DASH, OWNER]),
      members("b", [FERN]),
      members("c", [FERN, OWNER]),
    ],
    ...over,
  });
}

const row = (m: ChannelMap, name: string) => {
  const r = m.rows.find((x) => x.name === name);
  if (!r) throw new Error(`no ${name}`);
  return r;
};

describe("readability", () => {
  const m = build();
  it("reads a private channel only as a member", () => {
    expect(row(m, "app").readable).toBe(true);
    expect(row(m, "secret").readable).toBe(false);
  });
  it("reads an open channel without being a member", () => {
    expect(row(m, "general").readable).toBe(true);
  });
  it("uses the newest member list", () => {
    const newer = build({
      events: [
        meta("c", "secret", ["private"]),
        members("c", [FERN], 100),
        members("c", [FERN, DASH], 200),
      ],
    });
    expect(row(newer, "secret").readable).toBe(true);
  });
});

describe("project mapping", () => {
  it("maps project, hive-wide and unassigned", () => {
    const m = build({
      assignments: [
        { channelId: "a", scope: "project", project: "app", home: true },
        { channelId: "b", scope: "hive_wide", project: null, home: false },
      ],
    });
    expect(row(m, "app")).toMatchObject({ scope: "project", home: true });
    expect(row(m, "app").project?.slug).toBe("app");
    expect(row(m, "general").scope).toBe("hive_wide");
    expect(row(m, "secret").scope).toBe("unassigned");
    expect(m.projects.map((p) => p.slug)).toEqual(["app"]);
  });
  it("has no registry without assignments", () => {
    expect(build({ assignments: null }).registry).toBe(false);
  });
  it("treats an assignment to an unknown project as unassigned", () => {
    const m = build({
      assignments: [
        { channelId: "a", scope: "project", project: "gone", home: false },
      ],
    });
    expect(row(m, "app").scope).toBe("unassigned");
  });
});

describe("members and order", () => {
  it("names agents first and leaves people unnamed", () => {
    const [first, second] = row(build(), "app").members;
    expect(first.name).toBe("Fern");
    expect(second.name).toBeNull();
  });
  it("sorts live channels by newest message, archived last", () => {
    const m = build({ lastMessageByName: { general: 50, secret: 90 } });
    expect(m.rows.map((r) => r.name)).toEqual([
      "secret",
      "general",
      "app",
      "old",
    ]);
  });
});

describe("tabs", () => {
  const m = build();
  const names = (tab: Parameters<typeof inTab>[1]) =>
    inTab(m.rows, tab).map((r) => r.name);
  it("lists unreadable live channels only", () => {
    expect(names("unreadable")).toEqual(["secret"]);
  });
  it("keeps archived channels out of Unassigned", () => {
    expect(names("unassigned").sort()).toEqual(["app", "general", "secret"]);
    expect(names("archived")).toEqual(["old"]);
    expect(names("all")).toHaveLength(4);
  });
});

describe("unreadableByAgent", () => {
  it("lists the unreadable channels each agent is in", () => {
    expect(unreadableByAgent(build().rows)).toEqual({ Fern: ["secret"] });
  });
});

describe("channel admin fields (#169)", () => {
  it("reads the description from the about tag", () => {
    const m = build({
      events: [
        {
          ...meta("a", "app"),
          tags: [
            ["d", "a"],
            ["name", "app"],
            ["about", "Shared config"],
          ],
        },
        meta("b", "general"),
      ],
    });
    expect(row(m, "app").description).toBe("Shared config");
    expect(row(m, "general").description).toBe("");
  });
  it("takes the newer of the assignment's and the log's revision", () => {
    const m = build({
      assignments: [
        {
          channelId: "a",
          scope: "project",
          project: "app",
          home: true,
          revision: 3,
        },
      ],
      // b was assigned and then unassigned: only the log remembers it.
      revisions: { a: 2, b: 5 },
    });
    expect(row(m, "app").revision).toBe(3);
    expect(row(m, "general").revision).toBe(5);
    expect(row(m, "secret").revision).toBe(0);
  });
  it("offers every live project as a choice, used or not", () => {
    const m = build({
      projects: [
        { slug: "app", name: "app", shortLabel: "AP" },
        { slug: "lib", name: "lib", shortLabel: null },
        { slug: "gone", name: "gone", shortLabel: null, archivedAt: "2026" },
      ],
    });
    expect(m.choices.map((p) => p.slug)).toEqual(["app", "lib"]);
  });
});
