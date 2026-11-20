import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { checkRelay, validRelayUrl } = await import("./setup-relay");

const input = {
  url: "wss://relay.example.com",
  privateKey: "a".repeat(64),
  authTag: "[]",
  owner: "b".repeat(64),
};
const states = (r: Awaited<ReturnType<typeof checkRelay>>) =>
  r.checks.map((c) => c.state);

describe("checkRelay", () => {
  it("passes all three checks and times the connection", async () => {
    let t = 1000;
    const r = await checkRelay(
      input,
      (async () => [] as never) as never,
      () => (t += 42),
    );
    expect(r.ok).toBe(true);
    expect(states(r)).toEqual(["ok", "ok", "ok"]);
    expect(r.checks[0].detail).toBe("42 ms");
  });
  it("reports a refused login with the relay's words and skips the rest", async () => {
    const r = await checkRelay(input, (async () => {
      throw new Error("Buzz relay refused auth: restricted: not a member");
    }) as never);
    expect(states(r)).toEqual(["skipped", "failed", "skipped"]);
    expect(r.checks[1].title).toBe("The relay refused the login");
    expect(r.checks[1].relaySaid).toBe("restricted: not a member");
  });
  it("reports an unreachable relay", async () => {
    const r = await checkRelay(input, (async () => {
      throw new Error("Can't reach the Buzz relay");
    }) as never);
    expect(states(r)).toEqual(["failed", "skipped", "skipped"]);
  });
  it("rejects a non-websocket address without connecting", async () => {
    const query = vi.fn();
    const r = await checkRelay(
      { ...input, url: "https://x.com" },
      query as never,
    );
    expect(r.ok).toBe(false);
    expect(query).not.toHaveBeenCalled();
    expect(validRelayUrl("wss://a.b")).toBe(true);
    expect(validRelayUrl("nope")).toBe(false);
  });
});
