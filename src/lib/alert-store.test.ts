import { beforeEach, expect, it, vi } from "vitest";

// Channel URLs are secrets (#45): never stored in plaintext, and an alert
// only counts as sent once a channel takes it.
const store = new Map<string, unknown>();
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("./history", () => ({
  historyEnabled: () => true,
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
    failing: [
      { agent: "Gale", hour: { attempts: 14, errors: 6 }, since: 1_000 },
    ],
  }),
}));
vi.mock("./github", () => ({ readGitHub: async () => ({ github: null }) }));
vi.stubEnv("BUZZ_PRIVATE_KEY", "test-key");
vi.stubEnv("BUZZ_RELAY_URL", "wss://relay.test");
vi.stubEnv("BUZZ_OWNER_PUBKEY", "ab".repeat(32));
vi.stubEnv("BUZZ_DM_PRIVATE_KEY", "11".repeat(32));

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

it("sets up Buzz DM, and sends alerts as DMs to the owner (#83)", async () => {
  await addChannel("buzz", "");
  const config = await loadAlerts();
  expect(config.channels).toMatchObject([{ type: "buzz", on: true }]);
  await expect(addChannel("buzz", "")).rejects.toThrow(AlertInputError);

  const noon = new Date(2026, 9, 23, 12).getTime();
  await runAlerts(noon);
  // One call to open the DM, one for the message.
  const calls = () =>
    fetchMock.mock.calls as unknown as [string, RequestInit][];
  const kinds = () =>
    calls().map(([, init]) => JSON.parse(String(init.body)).kind);
  expect(kinds()).toEqual([41010, 9]);
  expect(calls()[0][0]).toBe("https://relay.test/events");

  // The DM is remembered: the hourly repeat only posts the message.
  fetchMock.mockClear();
  await runAlerts(noon + 3_600_000);
  expect(kinds()).toEqual([9]);
});

it("refuses to set up Buzz DM without a usable key", async () => {
  vi.stubEnv("BUZZ_DM_PRIVATE_KEY", "not-hex");
  await expect(addChannel("buzz", "")).rejects.toThrow(AlertInputError);
  vi.stubEnv("BUZZ_DM_PRIVATE_KEY", "11".repeat(32));
});
