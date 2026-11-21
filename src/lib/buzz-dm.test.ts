import { createHash } from "node:crypto";
import { schnorr } from "@noble/curves/secp256k1.js";
import { expect, it, vi } from "vitest";
import type { ServerEnv } from "./env";

vi.mock("server-only", () => ({}));

const {
  cleanAlertText,
  dmSetup,
  dmText,
  httpAuth,
  openDm,
  relayHttpBase,
  sendDmMessage,
} = await import("./buzz-dm");
const { verifyEvent } = await import("./relay");

const KEY = "11".repeat(32);
const OWNER_KEY = "22".repeat(32);
const pub = (k: string) =>
  Buffer.from(schnorr.getPublicKey(Buffer.from(k, "hex"))).toString("hex");
const OWNER = pub(OWNER_KEY);

const env = (over: Partial<ServerEnv> = {}): ServerEnv => ({
  buzzRelayUrl: "wss://relay.test/some/path",
  buzzPrivateKey: KEY,
  buzzOwnerPubkey: OWNER,
  buzzOwnerPubkeys: [OWNER],
  ...over,
});

it("turns the relay's ws URL into its HTTP base", () => {
  expect(relayHttpBase("wss://relay.test/x")).toBe("https://relay.test");
  expect(relayHttpBase("ws://localhost:3000")).toBe("http://localhost:3000");
  expect(relayHttpBase("https://relay.test")).toBeNull();
  expect(relayHttpBase("nope")).toBeNull();
});

it("uses the dashboard key, or BUZZ_DM_PRIVATE_KEY when set", () => {
  expect(dmSetup(env(), {})).toMatchObject({ ok: true, pubkey: pub(KEY) });
  const other = "33".repeat(32);
  expect(dmSetup(env(), { BUZZ_DM_PRIVATE_KEY: other })).toMatchObject({
    ok: true,
    pubkey: pub(other),
    owner: OWNER,
    relay: "https://relay.test",
  });
});

it("never posts with an owner's key", () => {
  const setup = dmSetup(env({ buzzPrivateKey: OWNER_KEY }), {});
  expect(setup).toMatchObject({ ok: false });
  const viaDm = dmSetup(env(), { BUZZ_DM_PRIVATE_KEY: OWNER_KEY });
  expect(viaDm).toMatchObject({ ok: false });
});

it("refuses a key that is hex but not a valid curve scalar", () => {
  for (const bad of ["00".repeat(32), "ff".repeat(32)]) {
    expect(dmSetup(env({ buzzPrivateKey: bad }), {})).toMatchObject({
      ok: false,
    });
    expect(dmSetup(env(), { BUZZ_DM_PRIVATE_KEY: bad })).toMatchObject({
      ok: false,
    });
  }
});

it("says why it can't set up", () => {
  expect(dmSetup(env({ buzzPrivateKey: "short" }), {})).toMatchObject({
    ok: false,
  });
  expect(
    dmSetup(env({ buzzOwnerPubkey: undefined, buzzOwnerPubkeys: [] }), {}),
  ).toMatchObject({ ok: false });
  expect(dmSetup(env({ buzzRelayUrl: "https://x" }), {})).toMatchObject({
    ok: false,
  });
});

it("signs the HTTP auth over the URL and the body", () => {
  const header = httpAuth(KEY, "https://relay.test/events", "{}", 1000, "n1");
  const event = JSON.parse(
    Buffer.from(header.replace("Nostr ", ""), "base64").toString(),
  );
  expect(verifyEvent(event)).toBe(true);
  expect(event).toMatchObject({ kind: 27235, pubkey: pub(KEY) });
  expect(event.tags).toContainEqual(["u", "https://relay.test/events"]);
  expect(event.tags).toContainEqual(["method", "POST"]);
  expect(event.tags).toContainEqual([
    "payload",
    createHash("sha256").update("{}").digest("hex"),
  ]);
});

it("opens a DM to the owner, then posts into it", async () => {
  const setup = dmSetup(env(), {});
  if (!setup.ok) throw new Error("setup");
  const sent: { url: string; auth: string; body: Record<string, unknown> }[] =
    [];
  const fetchImpl = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      sent.push({
        url: String(url),
        auth: ((init as RequestInit).headers as Record<string, string>)
          .authorization,
        body: JSON.parse(String((init as RequestInit).body)),
      });
      return Response.json({ accepted: true, dm_id: "dm-1" });
    },
  ) as unknown as typeof fetch;

  const dm = await openDm(setup, fetchImpl, 1000);
  expect(dm).toBe("dm-1");
  await sendDmMessage(setup, dm, "Gale is failing", fetchImpl, 1000);

  expect(sent.map((s) => s.url)).toEqual([
    "https://relay.test/events",
    "https://relay.test/events",
  ]);
  const [open, message] = sent.map((s) => s.body);
  expect(open).toMatchObject({ kind: 41010, pubkey: pub(KEY) });
  expect(open.tags).toContainEqual(["p", OWNER]);
  expect(message).toMatchObject({ kind: 9, content: "Gale is failing" });
  expect(message.tags).toEqual([["h", "dm-1"]]);
  for (const s of sent) expect(s.auth).toMatch(/^Nostr /);
});

it("fails when the relay refuses", async () => {
  const setup = dmSetup(env(), {});
  if (!setup.ok) throw new Error("setup");
  const fetchImpl = vi.fn(
    async () => new Response(null, { status: 403 }),
  ) as unknown as typeof fetch;
  await expect(openDm(setup, fetchImpl)).rejects.toThrow("403");
});

it("writes the alert as plain text", () => {
  expect(dmText({ title: "T", detail: "D", link: "https://dash/health" })).toBe(
    "T\nD\nhttps://dash/health",
  );
  expect(dmText({ title: "T", detail: "", link: null })).toBe("T");
});

it("cleans forwarded alert text (#143)", () => {
  expect(
    dmText({
      title: "PR \u202eevil\u0007\nby @rtorcato",
      detail: "line one\r\nline\u0000 two @all",
      link: null,
    }),
  ).toBe("PR evil by @\u200brtorcato\nline one\nline two @\u200ball");
  expect(cleanAlertText("x".repeat(300), 200)).toHaveLength(200);
  expect(cleanAlertText("x".repeat(300), 200).endsWith("…")).toBe(true);
  expect(cleanAlertText("a @ b", 50)).toBe("a @ b");
});
