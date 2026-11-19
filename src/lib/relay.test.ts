import { schnorr } from "@noble/curves/secp256k1.js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { queryRelay, signAuthEvent, signEvent, verifyEvent } = await import(
  "./relay"
);

const env = {
  buzzRelayUrl: "wss://relay.example",
  buzzPrivateKey: "11".repeat(32),
};

describe("signAuthEvent", () => {
  it("signs a valid NIP-42 auth event for the challenge", () => {
    const e = signAuthEvent(env, "abc", 1000);
    expect(e.kind).toBe(22242);
    expect(e.tags).toEqual([
      ["relay", "wss://relay.example"],
      ["challenge", "abc"],
    ]);
    expect(
      schnorr.verify(
        Buffer.from(e.sig, "hex"),
        Buffer.from(e.id, "hex"),
        Buffer.from(e.pubkey, "hex"),
      ),
    ).toBe(true);
  });

  it("adds the NIP-OA tag when set", () => {
    const tag = ["auth", "owner", "", "sig"];
    const e = signAuthEvent(
      { ...env, buzzAuthTag: JSON.stringify(tag) },
      "abc",
    );
    expect(e.tags[2]).toEqual(tag);
  });

  it("rejects a key that isn't hex", () => {
    expect(() =>
      signAuthEvent({ ...env, buzzPrivateKey: "nsec1abc" }, "abc"),
    ).toThrow("64-character hex");
  });
});

describe("verifyEvent", () => {
  const good = signEvent("22".repeat(32), 0, [], '{"name":"Woz"}', 1000);

  it("accepts a correctly signed event", () => {
    expect(verifyEvent(good)).toBe(true);
  });

  it("rejects edited content, a forged pubkey, a bad sig or junk", () => {
    expect(verifyEvent({ ...good, content: '{"name":"Evil"}' })).toBe(false);
    expect(verifyEvent({ ...good, pubkey: "33".repeat(32) })).toBe(false);
    expect(verifyEvent({ ...good, sig: "00".repeat(64) })).toBe(false);
    expect(verifyEvent({ ...good, sig: "zz" })).toBe(false);
  });
});

describe("queryRelay", () => {
  it("drops events that fail verification and counts what arrived", async () => {
    const good = signEvent("22".repeat(32), 0, [], "{}", 1000);
    const forged = { ...good, id: "ff".repeat(32), content: '{"name":"x"}' };
    class FakeSocket {
      onmessage?: (m: { data: string }) => void;
      onerror?: () => void;
      onclose?: () => void;
      constructor() {
        queueMicrotask(() => this.emit(["OK", "id", true]));
      }
      emit(msg: unknown[]) {
        this.onmessage?.({ data: JSON.stringify(msg) });
      }
      send() {
        this.emit(["EVENT", "dashboard", forged]);
        this.emit(["EVENT", "dashboard", good]);
        this.emit(["EOSE", "dashboard"]);
      }
      close() {}
    }
    vi.stubGlobal("WebSocket", FakeSocket);
    const events = await queryRelay(env, [{ kinds: [0] }]);
    vi.unstubAllGlobals();
    expect([...events]).toEqual([good]);
    expect(events.received).toBe(2);
  });
});
