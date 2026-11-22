import { describe, expect, it } from "vitest";
import {
  agentSlug,
  agentStats,
  agentStatus,
  byDay,
  findAgent,
  morphName,
  runtimeFor,
  sortAgents,
} from "./agents";
import type { Agent } from "./hive";

const NOW = 1_000_000;
const agent = (
  name: string,
  agoS: number | null,
  daily = [0, 0, 0, 0, 0, 0, 0],
): Agent => ({
  name,
  role: "",
  picture: null,
  pubkeys: [name],
  lastSeenAt: agoS === null ? null : NOW - agoS,
  workingOn: null,
  homeChannel: null,
  messagesToday: daily[6],
  daily,
  messages: [],
  formerNames: [],
});

describe("byDay", () => {
  it("groups newest first under Today, Yesterday, then dates", () => {
    const now = new Date(2026, 9, 16, 15, 0).getTime() / 1000;
    const at = (d: number, h: number) =>
      new Date(2026, 9, d, h, 5).getTime() / 1000;
    const msgs = [
      { id: "1", at: at(16, 14), channel: "general", text: "a" },
      { id: "2", at: at(16, 9), channel: "reviews", text: "b" },
      { id: "3", at: at(15, 9), channel: null, text: "c" },
      { id: "4", at: at(12, 9), channel: null, text: "d" },
    ];
    const groups = byDay({ ...agent("x", 0), messages: msgs }, now);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ["Today", ["1", "2"]],
      ["Yesterday", ["3"]],
      ["Mon, Oct 12", ["4"]],
    ]);
    expect(groups[0].items[0].time).toBe("2:05 PM");
  });
});

describe("findAgent", () => {
  const prime = { ...agent("Optimus Prime", 0), formerNames: ["Fizz"] };
  const agents = [agent("Woz", 0), prime];
  it("finds by slug, redirects former names, else null", () => {
    expect(agentSlug(" Optimus  Prime ")).toBe("optimus-prime");
    expect(findAgent(agents, "optimus-prime")).toEqual({ agent: prime });
    expect(findAgent(agents, "fizz")).toEqual({ redirect: "optimus-prime" });
    expect(findAgent(agents, "nobody")).toBeNull();
  });
});

describe("agentStatus", () => {
  it.each([
    [0, "active"],
    [15 * 60, "active"],
    [15 * 60 + 1, "idle"],
    [2 * 3600, "idle"],
    [2 * 3600 + 1, "quiet"],
    [null, "quiet"],
  ])("%s s ago -> %s", (ago, status) => {
    expect(agentStatus(agent("a", ago), NOW)).toBe(status);
  });
});

describe("Active elsewhere (#168)", () => {
  const running = {
    state: "running",
    since: NOW - 5 * 3600,
    lastTurn: NOW - 60,
    model: null,
  } as const;
  const quietAgent = agent("a", 3 * 3600);
  it("replaces Quiet when the runtime is working and a channel is unreadable", () => {
    expect(agentStatus(quietAgent, NOW, running, undefined, ["repo"])).toBe(
      "elsewhere",
    );
  });
  it("stays Quiet with no unreadable channel", () => {
    expect(agentStatus(quietAgent, NOW, running, undefined, [])).toBe("quiet");
  });
  it("stays Quiet with no runtime evidence", () => {
    expect(agentStatus(quietAgent, NOW, undefined, undefined, ["repo"])).toBe(
      "quiet",
    );
  });
  it("leaves Active and Stopped alone", () => {
    expect(agentStatus(agent("a", 60), NOW, running, undefined, ["repo"])).toBe(
      "active",
    );
    expect(
      agentStatus(
        quietAgent,
        NOW,
        { ...running, state: "stopped" },
        undefined,
        ["repo"],
      ),
    ).toBe("stopped");
  });
  it("no longer counts the agent as quiet in the stats", () => {
    const stats = agentStats([quietAgent], NOW, { a: running }, undefined, {
      a: ["repo"],
    });
    expect(stats.quiet).toEqual([]);
  });
});

describe("sortAgents", () => {
  const list = [
    agent("Bee", 60),
    agent("Ant", 5 * 3600),
    agent("Cat", 30),
    agent("Dog", 3 * 3600),
  ];
  const names = (s: Parameters<typeof sortAgents>[1]) =>
    sortAgents(list, s, NOW).map((a) => a.name);

  it("puts the longest-quiet first, then the most recent", () => {
    expect(names("attention")).toEqual(["Ant", "Dog", "Cat", "Bee"]);
  });

  it("sorts by last seen and by name", () => {
    expect(names("recent")).toEqual(["Cat", "Bee", "Dog", "Ant"]);
    expect(names("name")).toEqual(["Ant", "Bee", "Cat", "Dog"]);
  });
});

describe("agentStats", () => {
  it("counts active, quiet and today's messages vs the 7-day average", () => {
    const stats = agentStats(
      [
        agent("Bee", 60, [6, 6, 6, 6, 6, 6, 9]),
        agent("Ant", 5 * 3600, [4, 4, 4, 4, 4, 4, 1]),
      ],
      NOW,
    );
    expect(stats).toEqual({
      running: 0,
      stopped: [],
      active: 1,
      quiet: ["Ant"],
      today: 10,
      vsAverage: 0,
    });
  });

  it("has no comparison without history", () => {
    expect(agentStats([agent("Bee", 60)], NOW).vsAverage).toBeNull();
  });
});

describe("runtime", () => {
  const stopped = {
    state: "stopped",
    since: NOW - 60,
    lastTurn: null,
    model: null,
  } as const;
  const running = {
    state: "running",
    since: NOW - 9,
    lastTurn: NOW,
    model: null,
  } as const;

  it("ranks Stopped above every relay status", () => {
    expect(agentStatus(agent("a", 0), NOW, stopped)).toBe("stopped");
    expect(agentStatus(agent("a", 0), NOW, running)).toBe("active");
  });

  it("prefers a running identity, then the newest", () => {
    const a = { ...agent("a", 0), pubkeys: ["old", "new", "gone"] };
    expect(runtimeFor(a, { old: stopped, new: running })).toBe(running);
    const later = { ...stopped, since: NOW };
    expect(runtimeFor(a, { old: stopped, new: later })).toBe(later);
    expect(runtimeFor(a, {})).toBeUndefined();
  });

  it("sorts parked agents last and counts running and stopped", () => {
    const list = [agent("Bee", 60), agent("Ant", 5 * 3600), agent("Cat", 30)];
    const runtimes = { Cat: stopped, Bee: running };
    expect(
      sortAgents(list, "attention", NOW, runtimes).map((a) => a.name),
    ).toEqual(["Ant", "Bee", "Cat"]);
    const stats = agentStats(list, NOW, runtimes);
    expect([stats.running, stats.stopped]).toEqual([1, ["Cat"]]);
  });
});

describe("morphName", () => {
  it("is a CSS ident per agent and part", () => {
    expect(morphName("avatar", "optimus-prime")).toBe(
      "agent-avatar-optimus-prime",
    );
    expect(morphName("name", "zoë.x")).toBe("agent-name-zo__x");
  });
});
