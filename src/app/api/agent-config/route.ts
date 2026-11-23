import {
  ConfigQuerySchema,
  checkConfigQuery,
  forwardConfigQuery,
  MAX_BODY,
} from "@/lib/agent-config-proxy";
import { OwnerRequired, ownerPubkeys, requireOwner } from "@/lib/auth";
import { relayHttpBase } from "@/lib/buzz-dm";
import { readServerEnv } from "@/lib/env";

// Agent config reads (#194): passes one owner-signed read of an agent's
// config channel to the relay and its answer back. The owner's browser signs
// the relay's HTTP auth; this route checks it and sends it on unchanged. It
// never signs, stores or logs anything, and the dashboard's own relay key is
// never used, so it never joins a config channel.

const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request) {
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
  let relay: string | null = null;
  try {
    relay = relayHttpBase(readServerEnv().buzzRelayUrl);
  } catch {
    relay = null;
  }
  if (!relay) return json({ error: "no relay configured" }, 503);

  const text = await request.text();
  if (text.length > 2 * MAX_BODY + 100)
    return json({ error: "too large" }, 413);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json({ error: "bad request" }, 400);
  }
  const input = ConfigQuerySchema.safeParse(raw);
  if (!input.success) return json({ error: "bad request" }, 400);

  const checked = checkConfigQuery(input.data, {
    relay,
    owners: ownerPubkeys(),
    session: owner.via === "nostr" ? owner.pubkey : null,
    now: Math.floor(Date.now() / 1000),
  });
  if ("error" in checked) return json({ error: checked.error }, checked.status);

  const answer = await forwardConfigQuery(input.data, checked.url);
  if (!answer.ok) return json({ error: answer.error }, 502);
  return new Response(answer.text, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}
