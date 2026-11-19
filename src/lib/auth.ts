import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { schnorr } from "@noble/curves/secp256k1.js";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { readServerEnv } from "./env";

// Owner sign-in (#40). Read-only views are public unless
// REQUIRE_SIGN_IN_FOR_READS is set (#115); the dashboard's own writes (snooze
// and ack, alerts, sources, custom stages) always need the owner.
//
// AUTH_MODE picks how the owner proves who they are:
// - "nostr": a NIP-07 browser extension signs a one-time challenge (a NIP-98
//   shaped event, kind 27235) for AUTH_PUBLIC_URL. Allowed keys are
//   BUZZ_OWNER_PUBKEY.
// - "proxy": a reverse proxy that already authenticates (Authentik forward
//   auth, for example) names the user in AUTH_PROXY_HEADER. The header only
//   counts when the request also carries the proxy's shared secret, so a
//   client that reaches the app directly can't claim a user.
// Unset means sign-in is off and nothing can write.
//
// No passwords and no stored keys: the session is an HMAC-signed cookie.

export type AuthMode = "nostr" | "proxy";
type Env = Record<string, string | undefined>;

export const SESSION_COOKIE = "hive_session";
export const CHALLENGE_COOKIE = "hive_challenge";
/** The header a proxy sends with AUTH_PROXY_SECRET. */
export const PROXY_SECRET_HEADER = "x-buzz-proxy-secret";
export const LOGIN_PATH = "/api/auth/login";
/** NIP-98 HTTP auth. */
export const LOGIN_KIND = 27235;

const SESSION_S = 7 * 86_400;
const CHALLENGE_S = 5 * 60;
/** How far a login event's created_at may be from the server clock. */
const MAX_SKEW_S = 60;

/** The configured mode, or null when sign-in is off or incomplete. */
export function authMode(env: Env = process.env): AuthMode | null {
  // Without a pinned origin a login event could be bound to whatever host the
  // request claims (#63).
  if (env.AUTH_MODE === "nostr") return publicOrigin(env) ? "nostr" : null;
  if (env.AUTH_MODE === "proxy") {
    // Both are needed, or anyone could send the header.
    return env.AUTH_PROXY_HEADER && env.AUTH_PROXY_SECRET ? "proxy" : null;
  }
  return null;
}

/**
 * AUTH_PUBLIC_URL's origin (scheme, host and port), or null if it isn't an
 * http(s) URL. Login events must name it, and cookies are Secure unless it is
 * plain http. Never taken from request headers, which the client controls.
 */
export function publicOrigin(env: Env = process.env): string | null {
  try {
    const url = new URL(env.AUTH_PUBLIC_URL ?? "");
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

const b64 = (b: Buffer) => b.toString("base64url");

// Derived from the dashboard's own key, so there is no extra secret to set.
// Rotating BUZZ_PRIVATE_KEY signs everyone out.
function derivedKey(
  context: string,
  privateKey = process.env.BUZZ_PRIVATE_KEY,
): Buffer {
  if (!privateKey) throw new Error("BUZZ_PRIVATE_KEY is not set");
  return createHmac("sha256", privateKey).update(context).digest();
}

const sessionKey = (privateKey?: string) =>
  derivedKey("buzz-dashboard:session:v1", privateKey);

// A secret the dashboard stores, e.g. the owner signer's client key (#68),
// encrypted so a copy of the database alone doesn't yield it. Rotating
// BUZZ_PRIVATE_KEY makes it unreadable, so it has to be set up again.
const secretKey = (privateKey?: string) =>
  derivedKey("buzz-dashboard:stored-secret:v1", privateKey);

/** `plaintext` encrypted with AES-256-GCM, as "<iv>.<ciphertext>.<tag>". */
export function encryptSecret(plaintext: string, key = secretKey()): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return [iv, body, c.getAuthTag()].map(b64).join(".");
}

/** The plaintext of an encryptSecret value, or null if forged or malformed. */
export function decryptSecret(value: string, key = secretKey()): string | null {
  const [iv, body, tag, extra] = value
    .split(".")
    .map((p) => Buffer.from(p, "base64url"));
  if (!iv || !body || !tag || extra || iv.length !== 12 || tag.length !== 16) {
    return null;
  }
  try {
    const d = createDecipheriv("aes-256-gcm", key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

const mac = (body: string, key: Buffer) =>
  createHmac("sha256", key).update(body).digest();

/** `payload` with an expiry, as "<body>.<hmac>". */
export function seal(
  payload: Record<string, unknown>,
  ttlS: number,
  now: number,
  key = sessionKey(),
): string {
  const body = b64(
    Buffer.from(JSON.stringify({ ...payload, exp: now + ttlS })),
  );
  return `${body}.${b64(mac(body, key))}`;
}

/** The payload of a sealed value, or null if forged, malformed or expired. */
export function unseal(
  token: string | undefined,
  now: number,
  key = sessionKey(),
): Record<string, unknown> | null {
  const [body, sig, extra] = (token ?? "").split(".");
  if (!body || !sig || extra !== undefined) return null;
  const want = mac(body, key);
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    return typeof payload?.exp === "number" && payload.exp > now
      ? payload
      : null;
  } catch {
    return null;
  }
}

/** The challenge in a sealed challenge cookie, or null. */
export function cookieChallenge(value: string | undefined, now: number) {
  const p = unseal(value, now);
  return p?.typ === "challenge" && typeof p.challenge === "string"
    ? p.challenge
    : null;
}

/** A fresh challenge and its sealed cookie value. */
export function newChallenge(now: number) {
  const challenge = randomBytes(32).toString("hex");
  return {
    challenge,
    cookie: seal({ typ: "challenge", challenge }, CHALLENGE_S, now),
    maxAge: CHALLENGE_S,
  };
}

const EventSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{64}$/),
  pubkey: z.string().regex(/^[0-9a-f]{64}$/),
  created_at: z.number().int(),
  kind: z.number().int(),
  tags: z.array(z.array(z.string())),
  content: z.string(),
  sig: z.string().regex(/^[0-9a-f]{128}$/),
});

const tag = (tags: string[][], name: string) =>
  tags.find((t) => t[0] === name)?.[1];

/**
 * Checks a signed login event against the challenge it must answer. Returns
 * the signer's pubkey, or why it was refused. `origin` is the configured
 * public origin, so an event signed for another site doesn't log in here.
 */
export function verifyLogin(
  raw: unknown,
  {
    challenge,
    origin,
    owners,
    now,
  }: { challenge: string; origin: string; owners: string[]; now: number },
): { pubkey: string } | { error: string } {
  const parsed = EventSchema.safeParse(raw);
  if (!parsed.success) return { error: "malformed event" };
  const e = parsed.data;
  if (e.kind !== LOGIN_KIND) return { error: "wrong kind" };
  if (Math.abs(now - e.created_at) > MAX_SKEW_S) return { error: "expired" };
  // Compare byte lengths: a multibyte tag of equal char length would throw.
  const given = Buffer.from(tag(e.tags, "challenge") ?? "");
  const want = Buffer.from(challenge);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return { error: "wrong challenge" };
  }
  if (tag(e.tags, "method") !== "POST") return { error: "wrong method" };
  let url: URL;
  try {
    url = new URL(tag(e.tags, "u") ?? "");
  } catch {
    return { error: "wrong url" };
  }
  if (url.origin !== origin || url.pathname !== LOGIN_PATH) {
    return { error: "wrong url" };
  }
  const id = createHash("sha256")
    .update(
      JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]),
    )
    .digest("hex");
  if (id !== e.id) return { error: "bad id" };
  let ok = false;
  try {
    ok = schnorr.verify(
      Buffer.from(e.sig, "hex"),
      Buffer.from(id, "hex"),
      Buffer.from(e.pubkey, "hex"),
    );
  } catch {
    ok = false;
  }
  if (!ok) return { error: "bad signature" };
  if (!owners.includes(e.pubkey)) return { error: "not the owner" };
  return { pubkey: e.pubkey };
}

/** The keys allowed to sign in with Nostr; none while the env is invalid. */
export function ownerPubkeys(): string[] {
  try {
    return readServerEnv().buzzOwnerPubkeys;
  } catch {
    return [];
  }
}

export type Owner =
  | { via: "nostr"; pubkey: string }
  | { via: "proxy"; user: string };

/** The proxy's named user, if the request carries the proxy's secret. */
export function proxyUser(
  get: (name: string) => string | null,
  env: Env = process.env,
): string | null {
  const header = env.AUTH_PROXY_HEADER;
  const secret = env.AUTH_PROXY_SECRET;
  if (!header || !secret) return null;
  const sent = Buffer.from(get(PROXY_SECRET_HEADER) ?? "");
  const want = Buffer.from(secret);
  if (sent.length !== want.length || !timingSafeEqual(sent, want)) return null;
  const user = get(header)?.trim();
  if (!user) return null;
  const allowed = (env.AUTH_PROXY_USERS ?? "").split(/[\s,]+/).filter(Boolean);
  return allowed.length && !allowed.includes(user) ? null : user;
}

/** The owner named by a request's session cookie or proxy headers, or null. */
export function ownerFrom(
  session: string | undefined,
  header: (name: string) => string | null,
  now = Math.floor(Date.now() / 1000),
): Owner | null {
  const mode = authMode();
  if (mode === "proxy") {
    const user = proxyUser(header);
    return user ? { via: "proxy", user } : null;
  }
  if (mode === "nostr") {
    const payload = unseal(session, now);
    const pubkey = payload?.typ === "session" ? payload.pubkey : null;
    // A key removed from BUZZ_OWNER_PUBKEY loses its session at once.
    return typeof pubkey === "string" && ownerPubkeys().includes(pubkey)
      ? { via: "nostr", pubkey }
      : null;
  }
  return null;
}

/** Who is signed in as the owner on this request, or null. */
export async function getOwner(): Promise<Owner | null> {
  const [jar, h] = await Promise.all([cookies(), headers()]);
  return ownerFrom(jar.get(SESSION_COOKIE)?.value, (name) => h.get(name));
}

/**
 * REQUIRE_SIGN_IN_FOR_READS (#115): every page and API read needs the owner,
 * not just writes. Fails closed: with the flag on and sign-in unset, nobody
 * gets in.
 */
export const readsNeedSignIn = (env: Env = process.env) =>
  /^(1|true|yes)$/i.test(env.REQUIRE_SIGN_IN_FOR_READS ?? "");

/** For write handlers: the owner, or throws OwnerRequired (send a 403). */
export async function requireOwner(): Promise<Owner> {
  const owner = await getOwner();
  if (!owner) throw new OwnerRequired();
  return owner;
}

export class OwnerRequired extends Error {
  constructor() {
    super("Owner sign-in required");
  }
}

const BASE = "http://same.invalid";

/**
 * A sign-in `next` as a same-site path, else "/". Resolved the way a browser
 * would, so "/\t/evil.com", "//evil.com" or "/.//evil.com" can't leave the
 * site (#115).
 */
export function safeNext(next: unknown): string {
  if (typeof next !== "string") return "/";
  try {
    const url = new URL(next, BASE);
    // Dot segments collapse after resolving ("/.//evil.com" → "//evil.com"),
    // so the result must not be protocol-relative either.
    const path = `${url.pathname}${url.search}${url.hash}`;
    return url.origin === BASE &&
      next.startsWith("/") &&
      !/^[/\\]{2}/.test(path)
      ? path
      : "/";
  } catch {
    return "/";
  }
}

/** A sealed session for `pubkey` and its lifetime in seconds. */
export const newSession = (pubkey: string, now: number) => ({
  value: seal({ typ: "session", pubkey }, SESSION_S, now),
  maxAge: SESSION_S,
});
