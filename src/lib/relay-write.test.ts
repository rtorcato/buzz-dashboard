import { schnorr } from "@noble/curves/secp256k1.js";
import { describe, expect, it, vi } from "vitest";
import { addMemberTemplate, removeMemberTemplate } from "./channel-admin";

vi.mock("server-only", () => ({}));

const { checkRelayWrite, forwardRelayWrite } = await import("./relay-write");
const { signEvent } = await import("./relay");
const { httpAuth } = await import("./buzz-dm");

const OWNER_KEY = "22".repeat(32);
const OTHER_KEY = "33".repeat(32);
const pub = (k: string) =>
  Buffer.from(schnorr.getPublicKey(Buffer.from(k, "hex"))).toString("hex");
const OWNER = pub(OWNER_KEY);
const URL_ = "https://relay.test/events";
const ID = "11111111-2222-3333-4444-555555555555";
const NOW = 1_800_000_000;
const A = "a".repeat(64);

function write(
  key = OWNER_KEY,
  template = addMemberTemplate(ID, A, NOW),
  { authKey = key, url = URL_, at = NOW } = {},
) {
  const body = JSON.stringify(
    signEvent(key, template.kind, template.tags, template.content, at),
  );
  return { body, authorization: httpAuth(authKey, url, body, at) };
}

const opts = (over = {}) => ({
  relayUrl: URL_,
  owners: [OWNER],
  session: OWNER,
  now: NOW,
  ...over,
});

describe("checkRelayWrite", () => {
  it("passes an owner-signed add with matching relay auth", () => {
    const r = checkRelayWrite(write(), opts());
    expect("event" in r && r.event.kind).toBe(9000);
  });
  it("passes under a proxy, with no session key", () => {
    expect("event" in checkRelayWrite(write(), opts({ session: null }))).toBe(
      true,
    );
  });
  it("refuses a key that isn't an owner", () => {
    expect(checkRelayWrite(write(OTHER_KEY), opts())).toMatchObject({
      status: 403,
    });
  });
  it("refuses an owner key other than the session's", () => {
    expect(
      checkRelayWrite(
        write(),
        opts({ owners: [OWNER, pub(OTHER_KEY)], session: pub(OTHER_KEY) }),
      ),
    ).toMatchObject({ status: 403 });
  });
  it("refuses relay auth for another URL or from another key", () => {
    expect(
      checkRelayWrite(
        write(OWNER_KEY, undefined, { url: "https://evil.test/events" }),
        opts(),
      ),
    ).toMatchObject({ error: "relay auth: wrong url" });
    expect(
      checkRelayWrite(
        write(OWNER_KEY, undefined, { authKey: OTHER_KEY }),
        opts({ owners: [OWNER, pub(OTHER_KEY)] }),
      ),
    ).toMatchObject({ status: 403 });
  });
  it("refuses auth for a different body", () => {
    const w = write();
    const other = write(OWNER_KEY, removeMemberTemplate(ID, A, NOW));
    expect(
      checkRelayWrite(
        { body: other.body, authorization: w.authorization },
        opts(),
      ),
    ).toMatchObject({ status: 401 });
  });
  it("refuses a tampered event", () => {
    const w = write();
    const e = JSON.parse(w.body);
    e.tags[1][1] = "b".repeat(64);
    const body = JSON.stringify(e);
    expect(
      checkRelayWrite(
        { body, authorization: httpAuth(OWNER_KEY, URL_, body, NOW) },
        opts(),
      ),
    ).toMatchObject({ error: "bad signature" });
  });
  it("refuses an old event and kinds outside the allowlist", () => {
    expect(
      checkRelayWrite(write(OWNER_KEY, undefined, { at: NOW - 3600 }), opts()),
    ).toMatchObject({ status: 401 });
    const del = write(OWNER_KEY, {
      kind: 9008,
      created_at: NOW,
      tags: [["h", ID]],
      content: "",
    });
    expect(checkRelayWrite(del, opts())).toMatchObject({ status: 400 });
  });
  it("refuses removing the owner", () => {
    const w = write(OWNER_KEY, removeMemberTemplate(ID, OWNER, NOW));
    expect(checkRelayWrite(w, opts())).toMatchObject({ status: 400 });
  });
});

describe("forwardRelayWrite", () => {
  it("sends the body and auth unchanged", async () => {
    const w = write();
    const fetchImpl = vi.fn(async () =>
      Response.json({ accepted: true, event_id: "e1", channel_id: null }),
    );
    expect(
      await forwardRelayWrite(w, URL_, fetchImpl as unknown as typeof fetch),
    ).toEqual({ ok: true, eventId: "e1", channelId: null });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(URL_);
    expect(init.body).toBe(w.body);
    expect((init.headers as Record<string, string>).authorization).toBe(
      w.authorization,
    );
    expect(init.redirect).toBe("error");
  });
  it("reports the relay's refusal", async () => {
    const refuse = async () =>
      Response.json({ accepted: false, message: "not an admin" });
    expect(
      await forwardRelayWrite(write(), URL_, refuse as unknown as typeof fetch),
    ).toEqual({ ok: false, error: "not an admin" });
    const down = async () => {
      throw new Error("x");
    };
    expect(
      await forwardRelayWrite(write(), URL_, down as unknown as typeof fetch),
    ).toMatchObject({ ok: false });
  });
});
