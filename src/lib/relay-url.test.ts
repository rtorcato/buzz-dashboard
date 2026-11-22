import { describe, expect, it } from "vitest";
import { normaliseRelayUrl } from "./relay-url";

describe("normaliseRelayUrl", () => {
  it("turns an https address into wss", () => {
    expect(normaliseRelayUrl("https://acme.communities.buzz.xyz")).toBe(
      "wss://acme.communities.buzz.xyz",
    );
  });
  it("adds wss to a bare host", () => {
    expect(normaliseRelayUrl("acme.communities.buzz.xyz")).toBe(
      "wss://acme.communities.buzz.xyz",
    );
  });
  it("drops the path, query and fragment of a pasted web address", () => {
    expect(
      normaliseRelayUrl("https://acme.communities.buzz.xyz/channels/x?a=1#b"),
    ).toBe("wss://acme.communities.buzz.xyz");
    expect(normaliseRelayUrl("acme.example.com/home")).toBe(
      "wss://acme.example.com",
    );
  });
  it("keeps wss and ws as typed, minus a trailing slash", () => {
    expect(normaliseRelayUrl("wss://relay.example.com/")).toBe(
      "wss://relay.example.com",
    );
    expect(normaliseRelayUrl("ws://localhost:7777")).toBe(
      "ws://localhost:7777",
    );
  });
  it("uses ws for local hosts without a scheme or over http", () => {
    expect(normaliseRelayUrl("localhost:7777")).toBe("ws://localhost:7777");
    expect(normaliseRelayUrl("http://127.0.0.1:3000/x")).toBe(
      "ws://127.0.0.1:3000",
    );
    expect(normaliseRelayUrl("https://localhost:7777")).toBe(
      "wss://localhost:7777",
    );
  });
  it("trims whitespace and leaves empty input empty", () => {
    expect(normaliseRelayUrl("  https://a.example.com \n")).toBe(
      "wss://a.example.com",
    );
    expect(normaliseRelayUrl("   ")).toBe("");
  });
  it("leaves unknown schemes alone so validation rejects them", () => {
    expect(normaliseRelayUrl("ftp://example.com")).toBe("ftp://example.com");
  });
});
