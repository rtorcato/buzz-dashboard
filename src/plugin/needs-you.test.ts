import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import * as plugin from "../../plugin/plugin.js";

type Page = {
  id: string;
  primary: boolean;
  badge: () => React.ReactNode;
  component: () => React.ReactNode;
};

const iso = (ago: number) => new Date(Date.now() - ago).toISOString();
const row = (
  kind: string,
  title: string,
  ago: number,
  items: object[] = [],
) => ({
  kind,
  title,
  detail: `${title} detail`,
  count: items.length || 1,
  since: iso(ago),
  items,
});

async function load(output: string | null) {
  let page: Page | undefined;
  const cleanups: Array<() => void> = [];
  const ctx = {
    react: React,
    reflect: { get: () => undefined },
    pages: {
      register: (p: Page) => {
        page = p;
      },
    },
    host: { runCommand: async () => output },
    effect: (fn: () => (() => void) | undefined) => {
      const c = fn();
      if (c) cleanups.push(c);
    },
  };
  plugin.apply(ctx);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const html = (c: () => React.ReactNode) =>
    renderToStaticMarkup(React.createElement(c));
  return {
    page: page as Page,
    page$: () => html((page as Page).component),
    badge$: () => html((page as Page).badge),
    stop: () => {
      for (const c of cleanups) c();
    },
  };
}

const wrap = (needsYou: object) =>
  JSON.stringify({ dashboard: "https://dash.example.com", needsYou });

describe("needs-you plugin", () => {
  it("asks for the right services and no top-level work", () => {
    expect(plugin.inject).toEqual(["react", "pages", "host"]);
  });

  it("lists rows oldest first with links, ages and a row-count badge", async () => {
    const h = 3_600_000;
    const t = await load(
      wrap({
        connected: false,
        failures: [],
        headsUp: [],
        updatedAt: null,
        rows: [
          row("merge", "3 PRs ready to merge", 2 * h, [
            {
              repo: "rtorcato/db-common",
              label: "db-common#160",
              at: iso(2 * h),
            },
            {
              repo: "rtorcato/repo-ai",
              label: "repo-ai#451",
              at: iso(2 * h),
            },
          ]),
          row("release", "Release waiting for your approval", 70 * h, [
            {
              repo: "rtorcato/js-common",
              label: "js-common",
              at: iso(70 * h),
              key: "release:rtorcato/js-common#run-4812",
            },
          ]),
        ],
      }),
    );
    const html = t.page$();
    expect(html.indexOf("Release waiting")).toBeLessThan(
      html.indexOf("3 PRs ready"),
    );
    expect(html).toContain("https://github.com/rtorcato/db-common/pull/160");
    expect(html).toContain(
      "https://github.com/rtorcato/js-common/actions/runs/4812",
    );
    expect(html).toContain("2 waiting");
    expect(html).toContain("2d");
    expect(html).toContain("Open dashboard");
    expect(html).toContain("dash"); // host shown
    // Two rows, not five items.
    expect(t.badge$()).toContain(">2<");
    t.stop();
  });

  it("shows All clear only when connected with no failure", async () => {
    const t = await load(
      wrap({ connected: true, rows: [], failures: [], headsUp: [] }),
    );
    expect(t.page$()).toContain("All clear");
    expect(t.badge$()).toBe("");
    t.stop();
    const off = await load(
      wrap({ connected: false, rows: [], failures: [], headsUp: [] }),
    );
    expect(off.page$()).not.toContain("All clear");
    off.stop();
    const down = await load(
      wrap({
        connected: true,
        rows: [],
        failures: [{ source: "GitHub", detail: "HTTP 502." }],
        headsUp: [],
      }),
    );
    const html = down.page$();
    expect(html).not.toContain("All clear");
    expect(html).toContain("Can’t reach GitHub.");
    down.stop();
  });

  it("says the dashboard is not reachable when the reader fails", async () => {
    for (const out of [null, "not json", JSON.stringify({ rows: [] })]) {
      const t = await load(out);
      expect(t.page$()).toContain("Dashboard not reachable");
      expect(t.badge$()).toBe("");
      t.stop();
    }
  });

  it("only links https GitHub repos it can parse", async () => {
    const t = await load(
      wrap({
        connected: true,
        failures: [],
        headsUp: [],
        rows: [
          row("merge", "PR", 1000, [
            {
              repo: 'x/y"><script>',
              label: "y#1",
              at: iso(1000),
            },
          ]),
        ],
      }),
    );
    const html = t.page$();
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("github.com/x/y");
    t.stop();
  });

  it("owns its polling timer with an effect that cleans up", async () => {
    vi.useFakeTimers();
    const t = await load(wrap({ connected: true, rows: [], failures: [] }));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    t.stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
