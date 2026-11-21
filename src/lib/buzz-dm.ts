import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { schnorr } from "@noble/curves/secp256k1.js";
import { mergeConfig, readSavedConfig } from "./config-store";
import { readServerEnv, type ServerEnv } from "./env";
import { signEvent } from "./relay";

// The Buzz DM alert channel (#83, DESIGN.md → Settings tabs and Alerts). The
// one place the dashboard posts to the relay, and only ever a DM to the
// owner. The key is the dashboard's own identity (BUZZ_PRIVATE_KEY, the one
// the setup wizard made) or BUZZ_DM_PRIVATE_KEY when it should be another.
// It is never an owner key: that check is below and is not optional.

const HEX64 = /^[0-9a-f]{64}$/i;
const DM_OPEN_KIND = 41010;
const MESSAGE_KIND = 9;
const HTTP_AUTH_KIND = 27235;
const SEND_MS = 10_000;

export type DmSetup =
  | { ok: true; key: string; pubkey: string; owner: string; relay: string }
  | { ok: false; reason: string };

/** The pubkey for `key`, or null when it isn't a valid curve scalar (all zeros, above the curve order). */
const pubkeyOf = (key: string): string | null => {
  try {
    return Buffer.from(schnorr.getPublicKey(Buffer.from(key, "hex"))).toString(
      "hex",
    );
  } catch {
    return null;
  }
};

/** The relay's HTTP base: its ws(s) URL on http(s), no path. */
export function relayHttpBase(relayUrl: string): string | null {
  try {
    const url = new URL(relayUrl);
    const protocol = { "wss:": "https:", "ws:": "http:" }[url.protocol];
    return protocol ? `${protocol}//${url.host}` : null;
  } catch {
    return null;
  }
}

/** Whether a DM can go out, and with which key. Never returns an owner key. */
export function dmSetup(
  env: ServerEnv,
  extra: Record<string, string | undefined> = mergeConfig(
    process.env,
    readSavedConfig(),
  ),
): DmSetup {
  const key = extra.BUZZ_DM_PRIVATE_KEY || env.buzzPrivateKey;
  if (!HEX64.test(key)) {
    return { ok: false, reason: "The posting key must be 64 hex characters" };
  }
  const owner = env.buzzOwnerPubkey;
  if (!owner) return { ok: false, reason: "BUZZ_OWNER_PUBKEY is not set" };
  const relay = relayHttpBase(env.buzzRelayUrl);
  if (!relay) return { ok: false, reason: "BUZZ_RELAY_URL is not a relay URL" };
  const pubkey = pubkeyOf(key.toLowerCase());
  if (!pubkey)
    return { ok: false, reason: "The posting key is not a valid key" };
  if (env.buzzOwnerPubkeys.includes(pubkey)) {
    return {
      ok: false,
      reason:
        "That key belongs to an owner. Give the dashboard a key of its own",
    };
  }
  return { ok: true, key: key.toLowerCase(), pubkey, owner, relay };
}

/** NIP-98 HTTP auth for a POST of `body` to `url`, as the relay expects. */
export function httpAuth(
  key: string,
  url: string,
  body: string,
  now: number,
  nonce: string = randomUUID(),
): string {
  const event = signEvent(
    key,
    HTTP_AUTH_KIND,
    [
      ["u", url],
      ["method", "POST"],
      ["nonce", nonce],
      ["payload", createHash("sha256").update(body).digest("hex")],
    ],
    "",
    now,
  );
  return `Nostr ${Buffer.from(JSON.stringify(event)).toString("base64")}`;
}

/** A non-2xx answer from the relay; callers branch on `status`. */
export class RelayError extends Error {
  constructor(readonly status: number) {
    super(`relay answered ${status}`);
  }
}

async function publish(
  setup: Extract<DmSetup, { ok: true }>,
  kind: number,
  tags: string[][],
  content: string,
  fetchImpl: typeof fetch,
  now: number,
): Promise<unknown> {
  const url = `${setup.relay}/events`;
  const body = JSON.stringify(signEvent(setup.key, kind, tags, content, now));
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: httpAuth(setup.key, url, body, now),
    },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(SEND_MS),
  });
  if (!res.ok) throw new RelayError(res.status);
  return res.json().catch(() => null);
}

/** Opens the DM with the owner and returns its channel id. */
export async function openDm(
  setup: Extract<DmSetup, { ok: true }>,
  fetchImpl: typeof fetch = fetch,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  const id = randomUUID();
  const answer = await publish(
    setup,
    DM_OPEN_KIND,
    [
      ["p", setup.owner],
      ["d", id],
    ],
    "",
    fetchImpl,
    now,
  );
  const said = (answer as { dm_id?: unknown } | null)?.dm_id;
  return typeof said === "string" && said ? said : id;
}

/** Sends `text` into the DM `dm`. */
export async function sendDmMessage(
  setup: Extract<DmSetup, { ok: true }>,
  dm: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
  now = Math.floor(Date.now() / 1000),
) {
  await publish(setup, MESSAGE_KIND, [["h", dm]], text, fetchImpl, now);
}

const TITLE_MAX = 200;
const DETAIL_MAX = 1000;

/**
 * Makes upstream text safe to forward (#143): drops control characters
 * (keeping newlines only where `multiline`) and bidi or zero-width
 * marks, breaks `@` mentions with a
 * zero-width space so they can't resolve, and caps the length.
 */
export function cleanAlertText(text: string, max: number, multiline = false) {
  const kept = multiline
    ? text.replace(/\r\n?/g, "\n").replace(/[^\P{Cc}\n]/gu, "")
    : text.replace(/[\r\n\t]+/g, " ").replace(/\p{Cc}/gu, "");
  const safe = kept
    .replace(
      /[\u200b\u200c\u200e\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029\ufeff]/g,
      "",
    )
    .replace(/@(?=\S)/g, "@\u200b")
    .trim();
  const chars = [...safe];
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : safe;
}

/** The text of one alert as a DM. */
export const dmText = (a: {
  title: string;
  detail: string;
  link: string | null;
}) =>
  [
    cleanAlertText(a.title, TITLE_MAX),
    cleanAlertText(a.detail, DETAIL_MAX, true),
    a.link,
  ]
    .filter(Boolean)
    .join("\n");

/** Loads the env and returns the setup state; for the page and the sender. */
export const loadDmSetup = () => dmSetup(readServerEnv());
