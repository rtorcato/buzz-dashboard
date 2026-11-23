import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { relaySelf } = await import("./relay-info");

const RELAY = "https://relay.test";
const SELF = "f".repeat(64);

describe("relaySelf", () => {
  it("reads NIP-11 self", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ self: SELF, pubkey: null })),
    );
    expect(await relaySelf(RELAY, fetchImpl)).toBe(SELF);
  });
  it("is null for a missing or malformed key", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({})));
    expect(await relaySelf(RELAY, fetchImpl)).toBeNull();
    const bad = vi.fn(async () => new Response(JSON.stringify({ self: "x" })));
    expect(await relaySelf(RELAY, bad)).toBeNull();
  });
});
