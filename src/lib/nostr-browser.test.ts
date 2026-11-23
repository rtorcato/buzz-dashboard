import { afterEach, describe, expect, it, vi } from "vitest";
import { configWrite } from "./nostr-browser";

const ID = "a".repeat(64);
const signer = {
  getPublicKey: async () => "b".repeat(64),
  signEvent: async (e: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  }) => ({
    ...e,
    id: e.kind === 27235 ? "c".repeat(64) : ID,
    pubkey: "b".repeat(64),
    sig: "0".repeat(128),
  }),
};
const template = { kind: 45010, created_at: 1, tags: [], content: "{}" };

function answer(status: number, body: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("configWrite", () => {
  it("counts the relay's yes as saved", async () => {
    answer(200, JSON.stringify({ accepted: true, event_id: ID }));
    expect(
      await configWrite(signer, "https://relay.test", template),
    ).toMatchObject({ ok: true });
  });
  it("counts a duplicate as saved", async () => {
    answer(
      400,
      JSON.stringify({ accepted: false, message: "duplicate: have it" }),
    );
    expect(
      await configWrite(signer, "https://relay.test", template),
    ).toMatchObject({ ok: true });
  });
  it("passes a refusal on", async () => {
    answer(
      400,
      JSON.stringify({ accepted: false, message: "conflict: stale prev" }),
    );
    expect(await configWrite(signer, "https://relay.test", template)).toEqual({
      ok: false,
      message: "conflict: stale prev",
    });
  });
  it("doesn't call an unreadable 200 saved", async () => {
    answer(200, "<html>proxy</html>");
    const r = await configWrite(signer, "https://relay.test", template);
    expect(r).toMatchObject({ ok: false });
    answer(200, JSON.stringify({}));
    expect(
      await configWrite(signer, "https://relay.test", template),
    ).toMatchObject({ ok: false });
  });
});
