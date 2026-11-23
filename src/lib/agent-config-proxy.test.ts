import { schnorr } from "@noble/curves/secp256k1.js";
import { describe, expect, it, vi } from "vitest";
import { currentFilter, discoveryFilter, historyFilter } from "./agent-config";

vi.mock("server-only", () => ({}));

const { checkConfigQuery, filterProblem, forwardConfigQuery, relaySelf } =
  await import("./agent-config-proxy");
const { httpAuth } = await import("./buzz-dm");

const OWNER_KEY = "22".repeat(32);
const OTHER_KEY = "33".repeat(32);
const pub = (k: string) =>
  Buffer.from(schnorr.getPublicKey(Buffer.from(k, "hex"))).toString("hex");
const OWNER = pub(OWNER_KEY);
const RELAY = "https://relay.test";
const SELF = "f".repeat(64);
const AGENT = "a".repeat(64);
const CH = "11111111-2222-4333-8444-555555555555";
const D = "66666666-7777-5888-9999-aaaaaaaaaaaa";
const NOW = 1_800_000_000;

function read(
  filter: Record<string, unknown>,
  {
    path = "query",
    key = OWNER_KEY,
    url,
    at = NOW,
  }: { path?: "query" | "count"; key?: string; url?: string; at?: number } = {},
) {
  const body = JSON.stringify([filter]);
  const signed = url ?? `${RELAY}/${path}`;
  return { path, body, authorization: httpAuth(key, signed, body, at) };
}

const opts = (over = {}) => ({
  relay: RELAY,
  owners: [OWNER],
  session: OWNER,
  now: NOW,
  ...over,
});

describe("checkConfigQuery", () => {
  it("passes discovery, current heads and history signed by the owner", () => {
    for (const f of [
      discoveryFilter(SELF, OWNER, AGENT),
      currentFilter(CH),
      historyFilter(CH, D, { limit: 100, offset: 0 }),
    ]) {
      expect(checkConfigQuery(read(f), opts())).toEqual({
        url: `${RELAY}/query`,
      });
    }
  });
  it("passes a history count to /count", () => {
    const r = checkConfigQuery(
      read(historyFilter(CH, D), { path: "count" }),
      opts(),
    );
    expect(r).toEqual({ url: `${RELAY}/count` });
  });
  it("passes under a proxy, with no session key", () => {
    expect(
      checkConfigQuery(read(currentFilter(CH)), opts({ session: null })),
    ).toEqual({ url: `${RELAY}/query` });
  });
  it("refuses a key that isn't an owner", () => {
    expect(
      checkConfigQuery(read(currentFilter(CH), { key: OTHER_KEY }), opts()),
    ).toMatchObject({ status: 403 });
  });
  it("refuses an owner key other than the session's", () => {
    const other = pub(OTHER_KEY);
    expect(
      checkConfigQuery(
        read(currentFilter(CH)),
        opts({ owners: [OWNER, other], session: other }),
      ),
    ).toMatchObject({ status: 403 });
  });
  it("refuses auth for another URL, path or a stale time", () => {
    const f = currentFilter(CH);
    expect(
      checkConfigQuery(read(f, { url: "https://evil.test/query" }), opts()),
    ).toMatchObject({ status: 401, error: "wrong url" });
    // Signed for /query but sent as /count.
    const q = read(historyFilter(CH, D));
    expect(checkConfigQuery({ ...q, path: "count" }, opts())).toMatchObject({
      status: 401,
    });
    expect(checkConfigQuery(read(f, { at: NOW - 3600 }), opts())).toMatchObject(
      { status: 401, error: "expired" },
    );
  });
  it("refuses a body that differs from the signed one", () => {
    const r = read(currentFilter(CH));
    const body = JSON.stringify([{ ...currentFilter(CH), limit: 15 }]);
    expect(checkConfigQuery({ ...r, body }, opts())).toMatchObject({
      status: 401,
    });
  });
  it("refuses discovery of someone else's channels", () => {
    expect(
      checkConfigQuery(read(discoveryFilter(SELF, AGENT, AGENT)), opts()),
    ).toMatchObject({ status: 400, error: "not your channels" });
  });
});

describe("filterProblem", () => {
  const p = (f: unknown, path: "query" | "count" = "query") =>
    filterProblem(path, JSON.stringify(f), OWNER);
  it("takes only the config reads", () => {
    // Generic reads, messages, other kinds, extra keys, or two filters.
    expect(p([{ kinds: [9], "#h": [CH] }])).toBe("filter not allowed");
    expect(p([{ kinds: [30174], authors: [AGENT] }])).toBe(
      "filter not allowed",
    );
    expect(p([{ ...currentFilter(CH), authors: [OWNER] }])).toBe(
      "filter not allowed",
    );
    expect(p([{ ...currentFilter(CH), limit: 500 }])).toBe(
      "filter not allowed",
    );
    expect(p([currentFilter(CH), currentFilter(CH)])).toBe(
      "expected one filter",
    );
    expect(p([{ ...currentFilter(CH), "#h": [CH, CH] }])).toBe(
      "filter not allowed",
    );
    expect(p([{ ...historyFilter(CH, D), offset: 20_000 }])).toBe(
      "filter not allowed",
    );
    expect(p("[")).toBe("expected one filter");
  });
  it("counts only history", () => {
    expect(p([currentFilter(CH)], "count")).toBe("filter not allowed");
    expect(p([historyFilter(CH, D)], "count")).toBeNull();
  });
});

describe("forwardConfigQuery", () => {
  const input = read(currentFilter(CH));
  it("sends the body and auth unchanged and passes the answer back", async () => {
    const fetchImpl = vi.fn(async () => new Response("[]", { status: 200 }));
    const r = await forwardConfigQuery(input, `${RELAY}/query`, fetchImpl);
    expect(r).toEqual({ ok: true, status: 200, text: "[]" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`${RELAY}/query`);
    expect(init.body).toBe(input.body);
    expect((init.headers as Record<string, string>).authorization).toBe(
      input.authorization,
    );
    expect(init.redirect).toBe("error");
  });
  it("relays the relay's refusal in its words, cut short", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "restricted: not a member" }), {
          status: 403,
        }),
    );
    expect(
      await forwardConfigQuery(input, `${RELAY}/query`, fetchImpl),
    ).toEqual({ ok: false, error: "restricted: not a member" });
  });
  it("says so when the relay can't be reached", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("down");
    });
    expect(
      await forwardConfigQuery(input, `${RELAY}/query`, fetchImpl),
    ).toEqual({ ok: false, error: "Can't reach the Buzz relay." });
  });
});

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
