import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mergeConfig, readSavedConfig } from "./config-store";

// First-run setup gate (#73, DESIGN.md → Setup wizard → The gate). The token
// lives in memory only: it is printed to the logs at start, works for 60
// minutes and 5 tries, and a restart makes a new one. State hangs off
// globalThis so instrumentation, the proxy and route handlers (separate
// bundles, one process) see the same token.

export const SETUP_COOKIE = "hive_setup";
export const SETUP_TTL_S = 60 * 60;
export const MAX_TRIES = 5;
const RELAY_KEYS = [
  "BUZZ_RELAY_URL",
  "BUZZ_PRIVATE_KEY",
  "BUZZ_AUTH_TAG",
  "BUZZ_OWNER_PUBKEY",
] as const;

type State = {
  token: string;
  expires: number; // epoch seconds
  tries: number;
  used: boolean;
  sessionKey: Buffer; // signs the setup session cookie; dies with the process
};
const g = globalThis as { __hiveSetup?: State };

/** Setup is served until all four relay settings exist, env or saved. */
export function setupOpen(
  env: Record<string, string | undefined> = process.env,
  saved = readSavedConfig(),
): boolean {
  const merged = mergeConfig(env, saved);
  return !RELAY_KEYS.every((k) => merged[k]);
}

function groups(hex: string) {
  return hex.toUpperCase().match(/.{4}/g)?.join("-") ?? hex;
}

/** A fresh token, replacing any old one. Returned so start-up can log it. */
export function newSetupToken(now = Math.floor(Date.now() / 1000)): string {
  const token = groups(randomBytes(8).toString("hex"));
  g.__hiveSetup = {
    token,
    expires: now + SETUP_TTL_S,
    tries: 0,
    used: false,
    sessionKey: randomBytes(32),
  };
  return token;
}

export type Unlock =
  | { ok: true; expires: number }
  | { ok: false; triesLeft: number; dead: boolean };

/** Checks a pasted token. The right one is used up; wrong ones count. */
export function unlock(
  given: string,
  now = Math.floor(Date.now() / 1000),
): Unlock {
  const s = g.__hiveSetup;
  if (!s || s.used || now >= s.expires || s.tries >= MAX_TRIES) {
    return { ok: false, triesLeft: 0, dead: true };
  }
  const a = Buffer.from(given.trim().toUpperCase());
  const b = Buffer.from(s.token);
  if (a.length === b.length && timingSafeEqual(a, b)) {
    s.used = true;
    return { ok: true, expires: s.expires };
  }
  s.tries++;
  return {
    ok: false,
    triesLeft: MAX_TRIES - s.tries,
    dead: s.tries >= MAX_TRIES,
  };
}

/** The setup session cookie value, valid until the token's 60 minutes end. */
export function setupSession(expires: number): string {
  const s = g.__hiveSetup;
  if (!s) throw new Error("no setup token");
  const body = String(expires);
  return `${body}.${createHmac("sha256", s.sessionKey).update(body).digest("base64url")}`;
}

/** Seconds left on a valid setup session, else 0. */
export function setupSessionLeft(
  cookie: string | undefined,
  now = Math.floor(Date.now() / 1000),
): number {
  const s = g.__hiveSetup;
  const [body, sig] = (cookie ?? "").split(".");
  if (!s || !body || !sig || !s.used || Number(body) !== s.expires) return 0;
  const want = Buffer.from(setupSession(s.expires).split(".")[1]);
  const got = Buffer.from(sig);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return 0;
  return Math.max(0, s.expires - now);
}
