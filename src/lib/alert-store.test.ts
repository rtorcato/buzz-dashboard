import { beforeEach, expect, it, vi } from "vitest";

// Channel URLs are secrets (#45): never stored in plaintext, and an alert
// only counts as sent once a channel takes it.
const store = new Map<string, unknown>();
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
// The cleared log (#88), in memory.
type Row = {
  key: string;
  rule: string;
  title: string;
  appearedAt: number;
  clearedAt: number | null;
  acked: boolean;
};
const log: Row[] = [];
const failing = { on: true };
vi.mock("./history", () => ({
  historyEnabled: () => true,
  openLogRows: async () => log.filter((r) => r.clearedAt === null),
  logAppeared: async (
    items: { key: string; rule: string; title: string }[],
    at: number,
  ) => {
    for (const i of items) {
      log.push({ ...i, appearedAt: at, clearedAt: null, acked: false });
    }
  },
  logAcked: async (keys: string[]) => {
    for (const r of log)
      if (keys.includes(r.key) && !r.clearedAt) r.acked = true;
  },
  logCleared: async (keys: string[], at: number) => {
    for (const r of log)
      if (keys.includes(r.key) && !r.clearedAt) r.clearedAt = at;
  },
  getSetting: async (k: string) => store.get(k) ?? null,
  setSetting: async (k: string, v: unknown) => void store.set(k, v),
  updateSetting: async (k: string, change: (v: unknown) => unknown) => {
    const v = change(store.get(k) ?? null);
    store.set(k, v);
    return v;
  },
}));
vi.mock("./cost-source", () => ({
  loadSignerRecord: async () => null,
  loadIngestTokenRecord: async () => ({ hash: "h" }),
}));
vi.mock("./health-data", () => ({
  loadFailing: async () => ({
    source: "otel",
    failing: failing.on
      ? [{ agent: "Gale", hour: { attempts: 14, errors: 6 }, since: 1_000 }]
      : [],
  }),
}));
vi.mock("./github", () => ({ readGitHub: async () => ({ github: null }) }));
vi.stubEnv("BUZZ_PRIVATE_KEY", "test-key");

const {
  addChannel,
  loadAlerts,
  muteItems,
  removeChannel,
  runAlerts,
  AlertInputError,
} = await import("./alert-store");

const URL_ = "https://ntfy.sh/very-secret-topic";
const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  store.clear();
  log.length = 0;
  failing.on = true;
  fetchMock.mockClear();
});

it("stores a channel URL encrypted and adds it to every rule", async () => {
  await addChannel("ntfy", URL_);
  expect(JSON.stringify(store.get("alerts"))).not.toContain("secret");
  const config = await loadAlerts();
  expect(config.channels[0].target).toBe(URL_);
  const id = config.channels[0].id;
  expect(config.rules.merge?.channels).toEqual([id]);
  await removeChannel(id);
  expect((await loadAlerts()).rules.merge?.channels).toEqual([]);
});

it("refuses a URL it can't safely fetch", async () => {
  await expect(addChannel("webhook", "file:///etc/passwd")).rejects.toThrow(
    AlertInputError,
  );
});

it("sends once, and retries next pass only when no channel took it", async () => {
  await addChannel("ntfy", URL_);
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
  const noon = new Date(2026, 9, 23, 12).getTime();
  await runAlerts(noon);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(store.get("alert_state")).toMatchObject({
    "failing:Gale": { sent: null },
  });
  await runAlerts(noon + 60_000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await runAlerts(noon + 120_000);
  // Sent on the second pass; hourly, so not again yet.
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("adds a mute without dropping the others, and a pass keeps both", async () => {
  const noon = new Date(2026, 9, 23, 12).getTime();
  store.set("alert_mute", { "merge:a": { until: null } });
  await muteItems(["failing:Gale"], noon + 3_600_000, noon);
  await runAlerts(noon);
  // GitHub is unread here, so the pass keeps the merge ack too.
  expect(store.get("alert_mute")).toEqual({
    "merge:a": { until: null },
    "failing:Gale": { until: noon + 3_600_000 },
  });
});

it("logs when an item appears and when it clears, with no channels set up", async () => {
  const noon = new Date(2026, 9, 23, 12).getTime();
  await runAlerts(noon);
  await runAlerts(noon + 60_000);
  expect(log).toEqual([
    expect.objectContaining({
      key: "failing:Gale",
      rule: "failing",
      appearedAt: noon,
      clearedAt: null,
      acked: false,
    }),
  ]);
  failing.on = false;
  await runAlerts(noon + 3_600_000);
  expect(log).toHaveLength(1);
  expect(log[0]).toMatchObject({ clearedAt: noon + 3_600_000, acked: false });
});

it("logs an ack before the item clears", async () => {
  const noon = new Date(2026, 9, 23, 12).getTime();
  await runAlerts(noon);
  await muteItems(["failing:Gale"], null, noon);
  await runAlerts(noon + 60_000);
  expect(log[0]).toMatchObject({ acked: true, clearedAt: null });
  failing.on = false;
  await runAlerts(noon + 120_000);
  expect(log[0]).toMatchObject({ acked: true, clearedAt: noon + 120_000 });
});

it("keeps an item open while its source didn't answer", async () => {
  const noon = new Date(2026, 9, 23, 12).getTime();
  // GitHub is unread here (github: null), so merge items can't be judged.
  log.push({
    key: "merge:a#1",
    rule: "merge",
    title: "a#1",
    appearedAt: noon - 1000,
    clearedAt: null,
    acked: false,
  });
  await runAlerts(noon);
  expect(log[0].clearedAt).toBeNull();
});
