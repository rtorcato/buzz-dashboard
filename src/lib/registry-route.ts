import "server-only";

import type { z } from "zod";
import {
  OwnerRequired,
  ownerPubkeys,
  publicOrigin,
  requireOwner,
} from "./auth";
import { readServerEnv } from "./env";
import { historyEnabled } from "./history";
import { hiveOf, RegistryError, verifySignedEdit } from "./projects";
import type { NostrEvent } from "./relay";

// The shared front of the registry's API routes (#166).

const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** The hive key for a read, or a response saying why there is none. */
export function registryHive(): { hive: string } | { response: Response } {
  // The registry lives in the history store (Devastator's call on #166).
  if (!historyEnabled())
    return { response: new Response(null, { status: 404 }) };
  let hive: string | null = null;
  try {
    hive = hiveOf(readServerEnv().buzzRelayUrl);
  } catch {
    hive = null;
  }
  return hive
    ? { hive }
    : { response: json({ error: "no relay configured" }, 503) };
}

/**
 * Runs one signed registry write. The request needs the owner's session and a
 * NIP-98 event in its Authorization header, signed by an owner key (the
 * session's own key under Nostr sign-in), naming this exact URL and method,
 * with the body's hash. Then the body is parsed with `schema` and `run` gets
 * the hive, the input and the signed event.
 */
export async function signedWrite<S extends z.ZodType>(
  request: Request,
  path: string,
  schema: S,
  run: (hive: string, input: z.infer<S>, event: NostrEvent) => Promise<unknown>,
): Promise<Response> {
  const h = registryHive();
  if ("response" in h) return h.response;
  // A JSON body needs a CORS preflight cross-site, which nothing here answers.
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return json({ error: "expected JSON" }, 415);
  }
  let owner: Awaited<ReturnType<typeof requireOwner>>;
  try {
    owner = await requireOwner();
  } catch (err) {
    if (err instanceof OwnerRequired) {
      return json({ error: "owner sign-in required" }, 403);
    }
    throw err;
  }
  const origin = publicOrigin();
  if (!origin) {
    return json({ error: "AUTH_PUBLIC_URL is needed to sign edits" }, 503);
  }
  const body = await request.text();
  if (body.length > 64_000) return json({ error: "too large" }, 413);
  const signed = verifySignedEdit(request.headers.get("authorization"), {
    url: `${origin}${path}`,
    method: "POST",
    body,
    owners: ownerPubkeys(),
    now: Math.floor(Date.now() / 1000),
  });
  if ("error" in signed) {
    return json(
      { error: signed.error },
      signed.error === "not the owner" ? 403 : 401,
    );
  }
  // Under Nostr sign-in, the edit is signed by the key that signed in.
  if (owner.via === "nostr" && owner.pubkey !== signed.event.pubkey) {
    return json({ error: "signed by a different key than the session" }, 403);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return json({ error: "bad request" }, 400);
  }
  const input = schema.safeParse(raw);
  if (!input.success) {
    return json(
      { error: input.error.issues[0]?.message ?? "bad request" },
      400,
    );
  }
  try {
    return json(await run(h.hive, input.data, signed.event), 200);
  } catch (err) {
    if (err instanceof RegistryError)
      return json({ error: err.message }, err.status);
    throw err;
  }
}

export { json };
