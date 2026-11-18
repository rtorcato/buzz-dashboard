import { afterEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./env", () => ({
  readServerEnv: () => ({ buzzOwnerPubkey: "a".repeat(64) }),
}));
const queryRelay = vi.fn();
vi.mock("./relay", () => ({ queryRelay }));

const { readHive } = await import("./hive");

const MIN = 60_000;

afterEach(() => {
  vi.restoreAllMocks();
});

// readHive keeps module state, so the steps run in order in one test.
it("waits after a failed relay read, then reads again", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const t0 = Date.UTC(2026, 10, 17, 12);

  queryRelay.mockRejectedValue(new Error("relay down"));
  expect(await readHive(t0)).toBeNull();
  const failedCalls = queryRelay.mock.calls.length;
  expect(failedCalls).toBeGreaterThan(0);

  // The next pass, a minute later, doesn't ask the relay.
  expect(await readHive(t0 + MIN)).toBeNull();
  expect(queryRelay.mock.calls.length).toBe(failedCalls);

  // Two minutes on, it tries again, and a success is reused.
  queryRelay.mockReset();
  queryRelay.mockResolvedValue([]);
  const hive = await readHive(t0 + 2 * MIN);
  expect(hive).not.toBeNull();
  const okCalls = queryRelay.mock.calls.length;
  expect(okCalls).toBeGreaterThan(0);
  expect(await readHive(t0 + 3 * MIN)).toBe(hive);
  expect(queryRelay.mock.calls.length).toBe(okCalls);
});
