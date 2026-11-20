import "server-only";

import { z } from "zod";
import { adminEventProblem } from "./channel-admin";
import { verifySignedEdit } from "./projects";
import { type NostrEvent, verifyEvent } from "./relay";

// Passes one owner-signed channel admin event to the relay (#169). The owner's
// browser signs two things: the NIP-29 event, and the NIP-98 HTTP auth the
// relay wants for POST /events, whose `payload` is the hash of that exact
// body. Both arrive here unchanged and leave unchanged; the dashboard adds no
// signature of its own and has no key that could make the change.

/** How far the admin event's created_at may be from the server clock. */
const MAX_SKEW_S = 5 * 60;
const SEND_MS = 10_000;
export const MAX_BODY = 16_000;

export const RelayWriteSchema = z
  .object({
    /** The relay POST body: the signed event as JSON, byte for byte. */
    body: z.string().min(1).max(MAX_BODY),
    /** `Nostr <base64 kind 27235 event>` for that body and the relay URL. */
    authorization: z.string().min(1).max(MAX_BODY),
  })
  .strict();
export type RelayWrite = z.infer<typeof RelayWriteSchema>;

const EventSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{64}$/),
  pubkey: z.string().regex(/^[0-9a-f]{64}$/),
  created_at: z.number().int(),
  kind: z.number().int(),
  tags: z.array(z.array(z.string())),
  content: z.string(),
  sig: z.string().regex(/^[0-9a-f]{128}$/),
});

/**
 * The checked event, or why it was refused. The event must be one the
 * dashboard sends (channel-admin.ts), fresh, validly signed by an owner key,
 * and signed by the same key as its HTTP auth, which must name `relayUrl`,
 * POST and this body. With `session`, both are the session's key.
 */
export function checkRelayWrite(
  input: RelayWrite,
  {
    relayUrl,
    owners,
    session,
    now,
  }: {
    /** The relay's events URL, `https://<relay host>/events`. */
    relayUrl: string;
    owners: string[];
    /** The signed-in key under Nostr sign-in; null under a proxy. */
    session: string | null;
    now: number;
  },
): { event: NostrEvent } | { error: string; status: 400 | 401 | 403 } {
  let raw: unknown;
  try {
    raw = JSON.parse(input.body);
  } catch {
    return { error: "malformed event", status: 400 };
  }
  const parsed = EventSchema.strict().safeParse(raw);
  if (!parsed.success) return { error: "malformed event", status: 400 };
  const e = parsed.data;
  const problem = adminEventProblem(e, owners);
  if (problem) return { error: problem, status: 400 };
  if (Math.abs(now - e.created_at) > MAX_SKEW_S) {
    return { error: "expired", status: 401 };
  }
  if (!verifyEvent(e)) return { error: "bad signature", status: 401 };
  if (!owners.includes(e.pubkey))
    return { error: "not the owner", status: 403 };
  if (session && e.pubkey !== session) {
    return { error: "signed by a different key than the session", status: 403 };
  }
  const auth = verifySignedEdit(input.authorization, {
    url: relayUrl,
    method: "POST",
    body: input.body,
    owners,
    now,
  });
  if ("error" in auth) {
    return {
      error: `relay auth: ${auth.error}`,
      status: auth.error === "not the owner" ? 403 : 401,
    };
  }
  if (auth.event.pubkey !== e.pubkey) {
    return { error: "relay auth signed by a different key", status: 403 };
  }
  return { event: e };
}

export type RelayAnswer =
  | { ok: true; eventId: string; channelId: string | null }
  | { ok: false; error: string };

/** Sends the checked body and auth to the relay as they came. */
export async function forwardRelayWrite(
  input: RelayWrite,
  relayUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RelayAnswer> {
  let res: Response;
  try {
    res = await fetchImpl(relayUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: input.authorization,
      },
      body: input.body,
      redirect: "error",
      signal: AbortSignal.timeout(SEND_MS),
    });
  } catch {
    return { ok: false, error: "Can't reach the Buzz relay." };
  }
  const answer = (await res.json().catch(() => null)) as {
    accepted?: unknown;
    message?: unknown;
    event_id?: unknown;
    channel_id?: unknown;
  } | null;
  // The relay's own words, cut short: they reach the owner's screen.
  const said =
    typeof answer?.message === "string" && answer.message
      ? answer.message.slice(0, 200)
      : null;
  if (!res.ok || answer?.accepted === false) {
    return {
      ok: false,
      error: said ?? `The relay refused the change (${res.status}).`,
    };
  }
  return {
    ok: true,
    eventId: typeof answer?.event_id === "string" ? answer.event_id : "",
    channelId:
      typeof answer?.channel_id === "string" ? answer.channel_id : null,
  };
}
