import "server-only";

import { z } from "zod";
import {
  ARTIFACT_KIND,
  CHANNEL_METADATA_KIND,
  CURRENT_LIMIT,
  DISCOVERY_LIMIT,
} from "./agent-config";
import { verifySignedEdit } from "./projects";

// Passes one owner-signed agent config read to the relay (#194). The owner's
// browser signs the NIP-98 auth for POST <relay>/query (or /count) over the
// exact body; this checks it and forwards both unchanged. The dashboard adds
// no signature and holds no key that could read a config channel, so its own
// read identity never joins one. The answer passes through to the browser
// and is never stored or logged.

const SEND_MS = 10_000;
export const MAX_BODY = 4_000;
/** The largest relay answer passed back: 100 revisions at the event cap. */
export const MAX_ANSWER = 8 * 1024 * 1024;

export const ConfigQuerySchema = z
  .object({
    path: z.enum(["query", "count"]),
    /** The relay POST body: `[filter]`, byte for byte. */
    body: z.string().min(1).max(MAX_BODY),
    /** `Nostr <base64 kind 27235 event>` for that body and URL. */
    authorization: z.string().min(1).max(MAX_BODY),
  })
  .strict();
export type ConfigQueryInput = z.infer<typeof ConfigQuerySchema>;

const Hex = z.string().regex(/^[0-9a-f]{64}$/);
const Uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const one = <T extends z.ZodType>(t: T) => z.tuple([t]);

// The only reads this route passes: config channel discovery, the channel's
// current heads, and one artifact's history (or its count). Anything else is
// refused, so the route is no general relay read for an owner's session.
const Discovery = z
  .object({
    kinds: one(z.literal(CHANNEL_METADATA_KIND)),
    authors: one(Hex),
    "#P": one(Hex),
    "#t": one(Hex),
    limit: z.number().int().min(1).max(DISCOVERY_LIMIT),
  })
  .strict();
const Current = z
  .object({
    kinds: one(z.literal(ARTIFACT_KIND)),
    "#h": one(Uuid),
    artifact: z.literal("current"),
    limit: z.number().int().min(1).max(CURRENT_LIMIT),
  })
  .strict();
const History = z
  .object({
    kinds: one(z.literal(ARTIFACT_KIND)),
    "#h": one(Uuid),
    "#d": one(Uuid),
    artifact: z.literal("history"),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

/** Why `body` isn't one allowed filter for `path` signed by `signer`, or null. */
export function filterProblem(
  path: ConfigQueryInput["path"],
  body: string,
  signer: string,
): string | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return "malformed filter";
  }
  const filter = z.tuple([z.unknown()]).safeParse(raw);
  if (!filter.success) return "expected one filter";
  const f = filter.data[0];
  if (path === "count") {
    return History.safeParse(f).success ? null : "filter not allowed";
  }
  const discovery = Discovery.safeParse(f);
  if (discovery.success) {
    // Only the signer's own config channels.
    return discovery.data["#P"][0] === signer ? null : "not your channels";
  }
  return Current.safeParse(f).success || History.safeParse(f).success
    ? null
    : "filter not allowed";
}

/**
 * Checks one read. The NIP-98 auth must be fresh, signed by an owner (the
 * session's key under Nostr sign-in), and name POST `<relay>/<path>` and
 * this body; the body must be one allowed filter.
 */
export function checkConfigQuery(
  input: ConfigQueryInput,
  {
    relay,
    owners,
    session,
    now,
  }: {
    /** The relay's HTTP origin, `https://<relay host>`. */
    relay: string;
    owners: string[];
    /** The signed-in key under Nostr sign-in; null under a proxy. */
    session: string | null;
    now: number;
  },
): { url: string } | { error: string; status: 400 | 401 | 403 } {
  const url = `${relay}/${input.path}`;
  const auth = verifySignedEdit(input.authorization, {
    url,
    method: "POST",
    body: input.body,
    owners,
    now,
  });
  if ("error" in auth) {
    return {
      error: auth.error,
      status: auth.error === "not the owner" ? 403 : 401,
    };
  }
  if (session && auth.event.pubkey !== session) {
    return { error: "signed by a different key than the session", status: 403 };
  }
  const problem = filterProblem(input.path, input.body, auth.event.pubkey);
  if (problem) return { error: problem, status: 400 };
  return { url };
}

export type ConfigAnswer =
  | { ok: true; status: number; text: string }
  | { ok: false; error: string };

/** Sends the checked body and auth to the relay as they came. */
export async function forwardConfigQuery(
  input: ConfigQueryInput,
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ConfigAnswer> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: input.authorization,
      },
      body: input.body,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(SEND_MS),
    });
  } catch {
    return { ok: false, error: "Can't reach the Buzz relay." };
  }
  const text = await res.text().catch(() => "");
  if (text.length > MAX_ANSWER) {
    return { ok: false, error: "The relay's answer was too large." };
  }
  if (!res.ok) {
    const said = (() => {
      try {
        const e = (JSON.parse(text) as { error?: unknown }).error;
        return typeof e === "string" && e ? e.slice(0, 200) : null;
      } catch {
        return null;
      }
    })();
    return {
      ok: false,
      error: said ?? `The relay refused the read (${res.status}).`,
    };
  }
  return { ok: true, status: res.status, text };
}

/** The relay's own signing key, from its NIP-11 `self`, or null. */
export async function relaySelf(
  relay: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl(relay, {
      headers: { accept: "application/nostr+json" },
      redirect: "error",
      signal: AbortSignal.timeout(SEND_MS),
      next: { revalidate: 600 },
    } as RequestInit);
    if (!res.ok) return null;
    const self = ((await res.json()) as { self?: unknown }).self;
    return typeof self === "string" && /^[0-9a-f]{64}$/.test(self)
      ? self
      : null;
  } catch {
    return null;
  }
}
