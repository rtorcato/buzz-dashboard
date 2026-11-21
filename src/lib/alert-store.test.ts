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
const costByAgentSince = vi.hoisted(() =>
  vi.fn(async (): Promise<{ agent: string; usd: number }[]> => []),
);
vi.mock("./history", () => ({
  costByAgentSince,
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
  recentBuckets: async () => [],
}));
const readHive = vi.hoisted(() =>
  vi.fn(async (): Promise<unknown> => ({ agents: [] })),
);
vi.mock("./hive", () => ({ readHive }));
vi.mock("./status-feed", () => ({
  readStatusFeed: async () => ({ feed: null, stale: false }),
}));
const readGitHub = vi.hoisted(() =>
  vi.fn(async (): Promise<{ github: unknown }> => ({ github: null })),
);
vi.mock("./github", () => ({ readGitHub }));
const readReleases = vi.hoisted(() =>
  vi.fn(async (): Promise<{ releases: unknown }> => ({ releases: null })),
);
vi.mock("./releases", () => ({
  readReleases,
  loadReleases: async () => ({ releases: null }),
}));
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

it("alerts on an ai-blocked issue right away, once", async () => {
  await addChannel("ntfy", URL_);
  const blocked = {
    repo: "rtorcato/js-common",
    number: 5,
    title: "Fix the thing",
    isPr: false,
    labels: ["ai-blocked"],
    closedAt: null,
    claimedAt: 1_000,
  };
  readGitHub.mockResolvedValue({ github: { prs: [], claims: [blocked] } });
  const noon = new Date(2026, 9, 23, 12).getTime();
  await runAlerts(noon);
  await runAlerts(noon + 3_600_000 * 5);
  readGitHub.mockReset();
  readGitHub.mockResolvedValue({ github: null });
  const sent = fetchMock.mock.calls.map((c) =>
    JSON.parse(String((c as unknown as [string, RequestInit])[1].body)),
  );
  expect(sent.filter((b) => b.title === "js-common#5 is blocked")).toHaveLength(
    1,
  );
  expect(store.get("alert_state")).toMatchObject({
    "blocked:rtorcato/js-common#5": { sent: noon },
  });
});

it("alerts once on an agent silent for the rule's hours while holding a claim", async () => {
  await addChannel("ntfy", URL_);
  const noon = new Date(2026, 9, 23, 12).getTime();
  const secs = noon / 1000;
  readHive.mockResolvedValue({
    agents: [
      { name: "Fern", lastSeenAt: secs - 3 * 3600, pubkeys: ["f"] },
      { name: "Honey", lastSeenAt: secs - 60, pubkeys: ["h"] },
    ],
  });
  const claim = (agent: string, number: number) => ({
    repo: "rtorcato/js-common",
    number,
    agent,
    labels: ["ai-wip"],
    closedAt: null,
    claimedAt: secs - 5 * 3600,
  });
  readGitHub.mockResolvedValue({
    github: { prs: [], claims: [claim("Fern", 5), claim("Honey", 6)] },
  });
  const titles = () =>
    fetchMock.mock.calls
      .map((c) =>
        JSON.parse(String((c as unknown as [string, RequestInit])[1].body)),
      )
      .map((b) => b.title)
      .filter((t: string) => t.includes("silent"));
  await runAlerts(noon);
  // 3h quiet: not yet at the 4h default.
  expect(titles()).toEqual([]);
  await runAlerts(noon + 3_600_000);
  await runAlerts(noon + 2 * 3_600_000);
  readGitHub.mockReset();
  readGitHub.mockResolvedValue({ github: null });
  readHive.mockResolvedValue({ agents: [] });
  expect(titles()).toEqual(["Fern is silent while holding a claim"]);
});

it("alerts on an agent over the daily budget, once, and not under it", async () => {
  await addChannel("ntfy", URL_);
  const noon = new Date(2026, 9, 23, 12).getTime();
  costByAgentSince.mockResolvedValue([
    { agent: "Fern", usd: 52.5 },
    { agent: "Honey", usd: 12 },
  ]);
  await runAlerts(noon);
  await runAlerts(noon + 3_600_000);
  costByAgentSince.mockReset();
  costByAgentSince.mockResolvedValue([]);
  const sent = fetchMock.mock.calls
    .map((c) =>
      JSON.parse(String((c as unknown as [string, RequestInit])[1].body)),
    )
    .filter((b) => b.title.includes("today"));
  expect(sent.map((b) => [b.title, b.message])).toEqual([
    ["Fern is over $40 today", "$52.50 so far today · est."],
  ]);
});

it("alerts on a release waiting past the rule's hours, timed from the run", async () => {
  await addChannel("ntfy", URL_);
  vi.stubEnv("GITHUB_TOKEN", "t");
  const noon = new Date(2026, 9, 23, 12).getTime();
  const run = {
    id: 9,
    number: 42,
    workflow: "release.yml",
    url: "https://github.com/rtorcato/js-common/actions/runs/9",
    createdAt: noon / 1000 - 1800,
  };
  readReleases.mockResolvedValue({
    releases: { repos: [{ repo: "rtorcato/js-common", waiting: [run] }] },
  });
  await runAlerts(noon); // waiting 30 min: under the 1h default
  await runAlerts(noon + 1_800_000); // 1h since the run, though first seen 30 min ago
  await runAlerts(noon + 3_600_000); // inside the 4h repeat
  await runAlerts(noon + 1_800_000 + 4 * 3_600_000); // repeats after 4h
  readReleases.mockReset();
  readReleases.mockResolvedValue({ releases: null });
  vi.unstubAllEnvs();
  vi.stubEnv("BUZZ_PRIVATE_KEY", "test-key");
  vi.stubEnv("BUZZ_RELAY_URL", "wss://relay.test");
  vi.stubEnv("BUZZ_OWNER_PUBKEY", "ab".repeat(32));
  vi.stubEnv("BUZZ_DM_PRIVATE_KEY", "11".repeat(32));
  const sent = fetchMock.mock.calls
    .map((c) =>
      JSON.parse(String((c as unknown as [string, RequestInit])[1].body)),
    )
    .filter((b) => b.title.includes("release approval"));
  expect(sent.map((b) => [b.title, b.message])).toEqual([
    ["js-common is waiting for release approval", "release.yml run #42"],
    ["js-common is waiting for release approval", "release.yml run #42"],
  ]);
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

it.each([429, 408, 500])(
  "keeps the saved Buzz DM when the relay answers %i (#143)",
  async (status) => {
    await addChannel("buzz", "");
    const noon = new Date(2026, 9, 23, 12).getTime();
    await runAlerts(noon);
    const saved = store.get("alert_dm");
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(new Response(null, { status }));
    await runAlerts(noon + 3_600_000);
    const kinds = (
      fetchMock.mock.calls as unknown as [string, RequestInit][]
    ).map(([, init]) => JSON.parse(String(init.body)).kind);
    // No reopen: one failed message, no new DM, the saved id unchanged.
    expect(kinds).toEqual([9]);
    expect(store.get("alert_dm")).toEqual(saved);
  },
);

it.each([404, 410])(
  "reopens the Buzz DM when the relay answers %i (#143)",
  async (status) => {
    await addChannel("buzz", "");
    const noon = new Date(2026, 9, 23, 12).getTime();
    await runAlerts(noon);
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(new Response(null, { status }));
    await runAlerts(noon + 3_600_000);
    const kinds = (
      fetchMock.mock.calls as unknown as [string, RequestInit][]
    ).map(([, init]) => JSON.parse(String(init.body)).kind);
    expect(kinds).toEqual([9, 41010, 9]);
  },
);

it("refuses to set up Buzz DM without a usable key", async () => {
  vi.stubEnv("BUZZ_DM_PRIVATE_KEY", "not-hex");
  await expect(addChannel("buzz", "")).rejects.toThrow(AlertInputError);
  vi.stubEnv("BUZZ_DM_PRIVATE_KEY", "11".repeat(32));
});
