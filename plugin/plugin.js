// @ts-nocheck: plain JS for Buzz to load as one file; the dashboard build does not check it.
// biome-ignore-all lint/correctness/noComponentHookFactories: a Buzz plugin has one file and no imports, so its components close over ctx inside apply().
// Needs you for Buzz Desktop (buzz-dashboard#193). Read only.
//
// The page holds no data source and no credential. The hash-pinned reader
// script fetches /api/needs-you from your own buzz-dashboard with a read token
// from the macOS Keychain; this file only draws what the reader prints.
// Plain JS, no imports: React comes from ctx.react.

export const inject = ["react", "pages", "host"];

const POLL_MS = 90_000;
const GITHUB = "https://github.com";
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

// Same compact age as the dashboard: "14s", "7m", "2h 14m", "3d".
function formatAge(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? h + "h " + (m % 60) + "m" : h + "h";
  return Math.floor(h / 24) + "d";
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

// The reader's output, or null when it isn't the shape we expect.
function parse(text) {
  if (typeof text !== "string") return null;
  try {
    const out = JSON.parse(text);
    const d = out && out.needsYou;
    if (
      !out ||
      typeof out.dashboard !== "string" ||
      !d ||
      !Array.isArray(d.rows) ||
      !Array.isArray(d.failures)
    ) {
      return null;
    }
    return { dashboard: out.dashboard, data: d };
  } catch {
    return null;
  }
}

// Where an item goes on GitHub. Null when the data names nothing linkable.
function itemHref(kind, item) {
  if (!item || typeof item.repo !== "string" || !REPO.test(item.repo)) {
    return null;
  }
  const base = GITHUB + "/" + item.repo;
  const num = /#(\d+)$/.exec(item.label || "");
  if (kind === "merge" && num) return base + "/pull/" + num[1];
  if (kind === "blocked" && num) {
    return base + (item.pr ? "/pull/" : "/issues/") + num[1];
  }
  const run = /#run-(\d+)$/.exec(item.key || "");
  if (kind === "release") {
    return base + "/actions" + (run ? "/runs/" + run[1] : "");
  }
  if (kind === "ci") return base + "/actions";
  return null;
}

// Tabler-style 24px strokes, drawn inline: API v1 allows one file and no assets.
const ICONS = {
  release: [
    "M4 13a8 8 0 0 1 7 7a6 6 0 0 0 3 -5a9 9 0 0 0 6 -8a3 3 0 0 0 -3 -3a9 9 0 0 0 -8 6a6 6 0 0 0 -5 3",
    "M7 14a6 6 0 0 0 -3 6a6 6 0 0 0 6 -3",
    "M15 9m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
  ],
  blocked: ["M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0", "M5.7 5.7l12.6 12.6"],
  ci: ["M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0", "M10 10l4 4m0 -4l-4 4"],
  merge: [
    "M7 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
    "M7 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
    "M17 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
    "M7 8v8",
    "M7 8a4 4 0 0 0 4 4h4",
  ],
  paused: ["M7 5v14", "M17 5v14"],
  failing: [
    "M12 9v4",
    "M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.871l-8.106 -13.534a1.914 1.914 0 0 0 -3.274 0z",
    "M12 16h.01",
  ],
  refresh: [
    "M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4",
    "M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4",
  ],
  external: [
    "M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6",
    "M11 13l9 -9",
    "M15 4h5v5",
  ],
  clear: ["M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0", "M9 12l2 2l4 -4"],
  down: [
    "M9.785 6l8.215 8.215l-2.054 2.054a5.81 5.81 0 1 1 -8.215 -8.215l2.054 -2.054z",
    "M4 20l3.5 -3.5",
    "M15 4l-3.5 3.5",
    "M20 9l-3.5 3.5",
  ],
};

// Each kind's tile: a tint of a host role, with the matching icon colour.
const TONES = {
  release: "var(--text-warning)",
  blocked: "var(--text-danger)",
  ci: "var(--text-danger)",
  merge: "var(--text-secondary)",
  paused: "var(--text-secondary)",
  failing: "var(--text-danger)",
};

export function apply(ctx) {
  const React = ctx.react;
  const h = React.createElement;
  const ui = ctx.reflect.get("ui");

  // One store for the page and the nav badge. Polling is owned by ctx.effect,
  // so the badge stays current with the page closed.
  const store = {
    state: { status: "loading", rows: 0, data: null, dashboard: "", at: 0 },
    listeners: new Set(),
    busy: false,
  };
  const set = (patch) => {
    store.state = { ...store.state, ...patch };
    for (const l of store.listeners) l();
  };
  const subscribe = (l) => {
    store.listeners.add(l);
    return () => store.listeners.delete(l);
  };
  const snapshot = () => store.state;

  async function refresh() {
    if (store.busy) return;
    store.busy = true;
    try {
      const out = parse(await ctx.host.runCommand("read"));
      if (out) {
        set({
          status: "ok",
          data: out.data,
          dashboard: out.dashboard,
          rows: out.data.rows.length,
          at: Date.now(),
        });
      } else {
        // Keep the dashboard name and the last good time for the header.
        set({ status: "down", data: null, rows: 0 });
      }
    } catch {
      set({ status: "down", data: null, rows: 0 });
    } finally {
      store.busy = false;
    }
  }

  ctx.effect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  });

  const icon = (paths, size, extra) =>
    h(
      "svg",
      {
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 2,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": true,
        style: { flex: "none", ...extra },
      },
      paths.map((d, i) => h("path", { key: i, d })),
    );

  const button = (props, children) =>
    ui && ui.Button
      ? h(ui.Button, { variant: "subtle", size: "md", ...props }, children)
      : h("button", { type: "button", ...props }, children);

  function Chip({ href, children }) {
    const style = {
      display: "inline-flex",
      alignItems: "center",
      gap: "var(--space-1)",
      padding: "2px var(--space-2)",
      borderRadius: "var(--radius-chip)",
      background: "var(--affordance-subtle)",
      color: "var(--text-primary)",
      fontFamily: "ui-monospace, monospace",
      fontSize: 12,
      textDecoration: "none",
    };
    if (!href) return h("span", { style }, children);
    return h(
      "a",
      { href, target: "_blank", rel: "noopener noreferrer", style },
      children,
      icon(ICONS.external, 12),
    );
  }

  function Row({ row, now }) {
    const since = Date.parse(row.since);
    const tone = TONES[row.kind] || "var(--text-secondary)";
    const items = Array.isArray(row.items) ? row.items : [];
    const chips = items.flatMap((item, i) => {
      if (typeof item.label !== "string") return [];
      const href = itemHref(row.kind, item);
      // An agent's own row has nothing to open on GitHub.
      if (!href && row.kind === "failing") return [];
      return [h(Chip, { key: i, href }, item.label)];
    });
    const resets =
      typeof row.resetsAt === "number" && row.resetsAt * 1000 > now
        ? "Resumes in " + formatAge(row.resetsAt * 1000 - now)
        : null;
    return h(
      "li",
      {
        style: {
          display: "flex",
          gap: "var(--space-3)",
          padding: "var(--space-3) var(--space-panel-inset)",
          borderTop: "1px solid var(--border-standard)",
        },
      },
      h(
        "span",
        {
          style: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            flex: "none",
            borderRadius: "var(--radius-control)",
            background: "var(--affordance-subtle)",
            color: tone,
          },
        },
        icon(ICONS[row.kind] || ICONS.failing, 16),
      ),
      h(
        "div",
        { style: { flex: 1, minWidth: 0 } },
        h("div", { style: { fontWeight: 600 } }, row.title),
        h(
          "div",
          { style: { color: "var(--text-secondary)", fontSize: 13 } },
          row.detail,
        ),
        chips.length
          ? h(
              "div",
              {
                style: {
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "var(--space-2)",
                  marginTop: "var(--space-2)",
                },
              },
              chips,
            )
          : null,
        resets
          ? h(
              "div",
              {
                style: {
                  color: "var(--text-metadata)",
                  fontSize: 12,
                  marginTop: "var(--space-1)",
                },
              },
              resets,
            )
          : null,
      ),
      h(
        "div",
        { style: { textAlign: "right", flex: "none", whiteSpace: "nowrap" } },
        h(
          "div",
          { style: { fontWeight: 600, fontVariantNumeric: "tabular-nums" } },
          Number.isFinite(since) ? formatAge(now - since) : "",
        ),
        h(
          "div",
          { style: { color: "var(--text-metadata)", fontSize: 12 } },
          "waiting",
        ),
      ),
    );
  }

  function Notice({ iconPaths, color, title, children, action }) {
    return h(
      "div",
      {
        className: "ui-card",
        style: {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: "var(--space-8) var(--space-panel-inset)",
          textAlign: "center",
        },
      },
      icon(iconPaths, 28, { color }),
      h("div", { style: { fontWeight: 600 } }, title),
      h(
        "p",
        { style: { color: "var(--text-secondary)", margin: 0, maxWidth: 420 } },
        children,
      ),
      action,
    );
  }

  function Page() {
    const s = React.useSyncExternalStore(subscribe, snapshot, snapshot);
    // A clock for ages; owned by the page, so it only runs while it is open.
    const [now, setNow] = React.useState(Date.now());
    React.useEffect(() => {
      const t = setInterval(() => setNow(Date.now()), 30_000);
      return () => clearInterval(t);
    }, []);
    const host = hostOf(s.dashboard);
    const data = s.data;
    const rows = data
      ? data.rows
          .slice()
          .sort((a, b) => String(a.since).localeCompare(String(b.since)))
      : [];
    const ago = s.at ? formatAge(now - s.at) : "";
    const where = host ? " from " + host : "";
    const sub =
      s.status === "ok"
        ? (rows.length ? rows.length + " waiting · " : "") +
          "Updated " +
          ago +
          " ago" +
          where
        : s.status === "down" && s.at
          ? "Last good data " + ago + " ago" + where
          : "";
    const dashLink =
      s.dashboard.startsWith("https://") &&
      h(
        "a",
        {
          href: s.dashboard,
          target: "_blank",
          rel: "noopener noreferrer",
          style: {
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-2)",
            padding: "var(--space-2) var(--space-3)",
            borderRadius: "var(--radius-pill)",
            background: "var(--affordance-subtle)",
            color: "var(--text-primary)",
            textDecoration: "none",
          },
        },
        icon(ICONS.external, 16),
        "Open dashboard",
      );
    const refreshButton =
      s.status !== "down" &&
      button(
        { onClick: refresh, variant: "ghost" },
        h(
          "span",
          { style: { display: "inline-flex", gap: "var(--space-2)" } },
          icon(ICONS.refresh, 16),
          "Refresh",
        ),
      );

    let body;
    if (s.status === "loading") {
      body = h("p", { style: { color: "var(--text-secondary)" } }, "Loading…");
    } else if (s.status === "down") {
      body = h(
        Notice,
        {
          iconPaths: ICONS.down,
          color: "var(--text-secondary)",
          title: "Dashboard not reachable",
          action: button(
            { onClick: refresh },
            h(
              "span",
              { style: { display: "inline-flex", gap: "var(--space-2)" } },
              icon(ICONS.refresh, 16),
              "Try again",
            ),
          ),
        },
        "Buzz couldn’t read " +
          (host || "your dashboard") +
          ". Check that the dashboard is running and the read token is in your Keychain.",
      );
    } else {
      const alerts = data.failures.map((f, i) =>
        h(
          "div",
          {
            key: "f" + i,
            style: {
              display: "flex",
              gap: "var(--space-2)",
              padding: "var(--space-3)",
              borderRadius: "var(--radius-row)",
              border: "1px solid var(--border-danger)",
              color: "var(--text-danger)",
              marginBottom: "var(--space-3)",
            },
          },
          icon(ICONS.failing, 18),
          h(
            "span",
            null,
            h("strong", null, "Can’t reach " + f.source + ". "),
            f.detail,
          ),
        ),
      );
      let list;
      if (rows.length > 0) {
        list = h(
          "ul",
          {
            className: "ui-card",
            style: { listStyle: "none", margin: 0, padding: 0 },
          },
          rows.map((row, i) => h(Row, { key: i, row, now })),
        );
      } else if (data.connected && data.failures.length === 0) {
        list = h(
          Notice,
          {
            iconPaths: ICONS.clear,
            color: "var(--text-success)",
            title: "All clear",
          },
          "Nothing needs you right now. This page checks again every 90 seconds.",
        );
      } else if (!data.connected && data.failures.length === 0) {
        list = h(
          Notice,
          {
            iconPaths: ICONS.down,
            color: "var(--text-secondary)",
            title: "Not connected yet",
          },
          "The dashboard isn’t reading releases, CI or blocked work yet, so it can’t say whether anything needs you.",
        );
      } else {
        list = null;
      }
      body = h(React.Fragment, null, alerts, list);
    }

    return h(
      "section",
      {
        style: {
          padding: "var(--space-panel-inset)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
          overflow: "auto",
        },
      },
      h(
        "div",
        {
          style: {
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "var(--space-3)",
          },
        },
        h(
          "div",
          { style: { minWidth: 0 } },
          h("h1", { style: { margin: 0 } }, "Needs you"),
          sub
            ? h(
                "div",
                { style: { color: "var(--text-metadata)", fontSize: 13 } },
                sub,
              )
            : null,
        ),
        h(
          "div",
          {
            style: {
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "var(--space-2)",
            },
          },
          refreshButton,
          dashLink,
        ),
      ),
      body,
    );
  }

  // The nav badge counts rows, not items, and hides at zero or when the
  // dashboard can't be reached.
  function Badge() {
    const s = React.useSyncExternalStore(subscribe, snapshot, snapshot);
    if (s.status !== "ok" || s.rows === 0) return null;
    return h(
      "span",
      {
        style: {
          minWidth: 20,
          padding: "0 6px",
          borderRadius: "var(--radius-pill)",
          background: "var(--affordance-prominent)",
          color: "var(--text-on-prominent)",
          fontSize: 12,
          lineHeight: "20px",
          textAlign: "center",
          fontVariantNumeric: "tabular-nums",
        },
        "aria-label": s.rows + " waiting",
      },
      s.rows,
    );
  }

  ctx.pages.register({
    id: "needs-you",
    title: "Needs you",
    primary: true,
    badge: Badge,
    component: Page,
  });
}
