import { describe, expect, it } from "vitest";
import type { HistoryEvent } from "./history-schema";
import {
  groupByDay,
  liveEvents,
  liveMatches,
  type Names,
  parseFilters,
  snippet,
  splitMatches,
  toRow,
} from "./timeline";

const names: Names = {
  actor: (raw) => (raw === "ab".repeat(32) ? "Fern" : raw),
  channel: (id) => (id === "c1" ? "example-app" : null),
};

const event = (e: Partial<HistoryEvent>): HistoryEvent => ({
  source: "github",
  sourceId: "x",
  kind: "pr_opened",
  at: new Date("2026-10-22T15:12:00Z"),
  actor: null,
  repo: null,
  channel: null,
  title: null,
  url: null,
  body: null,
  data: null,
  ingestedAt: new Date(),
  hive: null,
  ...e,
});

describe("parseFilters", () => {
  it("keeps known values and drops the rest", () => {
    expect(
      parseFilters({
        q: " example-app#42 ",
        source: "buzz",
        type: "prs",
        range: "30d",
        repo: "o/r",
      }),
    ).toEqual({
      q: "example-app#42",
      repo: "o/r",
      agent: null,
      source: "buzz",
      type: "prs",
      range: "30d",
    });
    const junk = parseFilters({ source: "gitlab", type: "x", range: "1y" });
    expect([junk.source, junk.type, junk.range]).toEqual([null, null, "14d"]);
  });
});

describe("snippet", () => {
  it("centres a long text on the first match", () => {
    const text = `${"a ".repeat(200)}needle${" b".repeat(200)}`;
    const s = snippet(text, "NEEDLE");
    expect(s).toContain("needle");
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
  });

  it("leaves short text alone and flattens whitespace", () => {
    expect(snippet("one\n\ntwo")).toBe("one two");
  });
});

describe("splitMatches", () => {
  it("puts matches at odd indexes, case-insensitive, regex-safe", () => {
    expect(splitMatches("Fix a+b and A+B", "a+b")).toEqual([
      "Fix ",
      "a+b",
      " and ",
      "A+B",
      "",
    ]);
    expect(splitMatches("text", "")).toEqual(["text"]);
  });
});

describe("toRow", () => {
  it("builds a GitHub PR row", () => {
    const row = toRow(
      event({
        kind: "pr_merged",
        actor: "Atlas",
        repo: "o/example-app",
        title: "feat: empty state",
        url: "https://github.com/o/example-app/pull/42",
        data: { number: 42 },
      }),
      names,
    );
    expect(row).toMatchObject({
      source: "github",
      icon: "merged",
      actor: "Atlas",
      verb: "merged",
      target: "example-app#42",
      snippet: "feat: empty state",
      chips: ["example-app"],
    });
  });

  it("builds a Buzz message row with the agent and channel names", () => {
    const row = toRow(
      event({
        source: "buzz",
        kind: "message",
        actor: "ab".repeat(32),
        channel: "c1",
        body: "PR up",
      }),
      names,
    );
    expect(row).toMatchObject({
      source: "buzz",
      icon: "message",
      actor: "Fern",
      verb: "posted in #example-app",
      target: null,
      chips: ["#example-app"],
    });
  });

  it("builds label and release rows (#54)", () => {
    const label = (action: string) =>
      toRow(
        event({
          kind: "labelled",
          actor: "rtorcato",
          repo: "o/example-app",
          data: { number: 42, label: "ai-ready", action },
        }),
        names,
      );
    expect(label("added")).toMatchObject({
      verb: "added ai-ready to",
      target: "example-app#42",
    });
    expect(label("removed").verb).toBe("removed ai-ready from");
    expect(
      toRow(
        event({
          kind: "released",
          actor: "github-actions[bot]",
          repo: "o/example-app",
          title: "v1.2.0",
          data: { tag: "v1.2.0" },
        }),
        names,
      ),
    ).toMatchObject({
      verb: "released",
      target: "example-app v1.2.0",
      chips: ["example-app"],
    });
  });

  it("falls back for unknown channels and kinds", () => {
    expect(
      toRow(event({ source: "buzz", channel: "zz", body: "hi" }), names).verb,
    ).toBe("posted");
    expect(toRow(event({ kind: "pr_reopened" }), names)).toMatchObject({
      icon: "other",
      verb: "pr reopened",
      actor: "Someone",
    });
  });
});

describe("groupByDay", () => {
  it("starts a group whenever the day changes", () => {
    const rows = [30, 20, 5].map((at) =>
      toRow(event({ sourceId: String(at), at: new Date(at * 1000) }), names),
    );
    const groups = groupByDay(rows, (at) => (at >= 10 ? 10 : 0));
    expect(groups.map((g) => [g.start, g.rows.length])).toEqual([
      [10, 2],
      [0, 1],
    ]);
  });
});

describe("liveEvents", () => {
  const since = Date.parse("2026-10-22T00:00:00Z") / 1000;
  const github = [
    {
      source: "github",
      sourceId: "o/example-app#42:opened",
      kind: "pr_opened",
      at: new Date("2026-10-22T15:00:00Z"),
      actor: "Fern",
      repo: "o/example-app",
      data: { number: 42 },
    },
    {
      source: "github",
      sourceId: "o/example-app#41:opened",
      kind: "pr_opened",
      at: new Date("2026-10-21T15:00:00Z"),
    },
  ];
  const feed = [
    {
      id: "m1",
      at: Date.parse("2026-10-22T16:00:00Z") / 1000,
      author: "Fern",
      isAgent: true,
      channel: "example-app",
      text: "PR up",
    },
  ];

  it("keeps today's events, newest first, with nulls filled in", () => {
    const events = liveEvents(github, feed, since);
    expect(events.map((e) => e.sourceId)).toEqual([
      "m1",
      "o/example-app#42:opened",
    ]);
    expect(events[0]).toMatchObject({
      source: "buzz",
      kind: "message",
      actor: "Fern",
      channel: "example-app",
      body: "PR up",
      url: null,
    });
    expect(events[1].title).toBeNull();
  });

  it("filters by type and by any of the agent's names and keys", () => {
    const [message, pr] = liveEvents(github, feed, since);
    expect(liveMatches(pr, "prs", null)).toBe(true);
    expect(liveMatches(message, "prs", null)).toBe(false);
    expect(liveMatches(message, null, ["Fern", "ab".repeat(32)])).toBe(true);
    expect(liveMatches(message, null, ["Gale"])).toBe(false);
    expect(liveMatches(message, "messages", ["Fern"])).toBe(true);
  });
});
