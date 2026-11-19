import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { isStale, parseStatusFeed } = await import("./status-feed");

const T = (iso: string) => Date.parse(iso) / 1000;

describe("parseStatusFeed", () => {
  it("reads the DESIGN.md sample", () => {
    expect(
      parseStatusFeed({
        version: 1,
        published_at: "2026-10-16T19:40:00Z",
        runtime: {
          abc: {
            name: "Bumble",
            state: "running",
            since: "2026-10-16T13:28:00Z",
            last_turn: "2026-10-16T19:36:00Z",
            model: "claude-opus-5-5",
          },
          def: {
            state: "stopped",
            since: "2026-10-16T10:00:00Z",
            last_turn: null,
          },
        },
        usage: {
          five_h: 78,
          seven_d: 61,
          paused: true,
          five_h_resets_at: "2026-10-16T21:00:00Z",
          seven_d_resets_at: null,
          five_h_pause_at: 90,
          seven_d_pause_at: "95",
        },
      }),
    ).toEqual({
      publishedAt: T("2026-10-16T19:40:00Z"),
      runtime: {
        abc: {
          state: "running",
          since: T("2026-10-16T13:28:00Z"),
          lastTurn: T("2026-10-16T19:36:00Z"),
          model: "claude-opus-5-5",
        },
        def: {
          state: "stopped",
          since: T("2026-10-16T10:00:00Z"),
          lastTurn: null,
          model: null,
        },
      },
      usage: {
        fiveH: 78,
        sevenD: 61,
        paused: true,
        fiveHResetsAt: T("2026-10-16T21:00:00Z"),
        sevenDResetsAt: null,
        fiveHPauseAt: 90,
        // Not a number, so not reported.
        sevenDPauseAt: null,
      },
    });
  });

  it("leaves usage null when it is missing or malformed", () => {
    for (const usage of [
      undefined,
      { five_h: 50 },
      { five_h: "50", seven_d: 1 },
    ]) {
      expect(
        parseStatusFeed({
          version: 1,
          published_at: "2026-10-16T19:40:00Z",
          usage,
        })?.usage,
      ).toBeNull();
    }
  });

  it("treats an unknown version or a bad file as not reported", () => {
    expect(
      parseStatusFeed({ version: 2, published_at: "2026-10-16T19:40:00Z" }),
    ).toBeNull();
    expect(parseStatusFeed({ version: 1 })).toBeNull();
    expect(parseStatusFeed([])).toBeNull();
    expect(parseStatusFeed(null)).toBeNull();
  });

  it("skips malformed runtime entries", () => {
    const feed = parseStatusFeed({
      version: 1,
      published_at: "2026-10-16T19:40:00Z",
      runtime: {
        a: { state: "sleeping", since: "2026-10-16T10:00:00Z" },
        b: { state: "running" },
        c: "x",
      },
    });
    expect(feed?.runtime).toEqual({});
  });

  it("keeps Goose agents reported as unknown", () => {
    const feed = parseStatusFeed({
      version: 1,
      published_at: "2026-11-13T19:05:00Z",
      runtime: {
        g: {
          state: "unknown",
          since: "2026-11-13T19:02:12Z",
          last_turn: "2026-11-13T19:02:12Z",
          model: null,
        },
      },
    });
    expect(feed?.runtime.g).toEqual({
      state: "unknown",
      since: T("2026-11-13T19:02:12Z"),
      lastTurn: T("2026-11-13T19:02:12Z"),
      model: null,
    });
  });
});

describe("isStale", () => {
  const feed = { publishedAt: 1000, runtime: {}, usage: null };
  it("is stale after 10 minutes", () => {
    expect(isStale(feed, 1000 + 600)).toBe(false);
    expect(isStale(feed, 1000 + 601)).toBe(true);
  });
});
