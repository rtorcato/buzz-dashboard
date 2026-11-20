import { OwnerRequired, ownerPubkeys, requireOwner } from "@/lib/auth";
import { relayHttpBase } from "@/lib/buzz-dm";
import { readServerEnv } from "@/lib/env";
import { json } from "@/lib/registry-route";
import {
  checkRelayWrite,
  forwardRelayWrite,
  MAX_BODY,
  RelayWriteSchema,
} from "@/lib/relay-write";

// Channel admin (#169): passes one owner-signed NIP-29 event (create, edit,
// archive, add or remove a member) to the relay. The owner's extension signs
// both the event and the relay's HTTP auth; this route checks them and sends
// them on unchanged. It never signs anything itself.

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
  const relayUrl = `${relay}/events`;

  const text = await request.text();
  if (text.length > 2 * MAX_BODY + 100)
    return json({ error: "too large" }, 413);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json({ error: "bad request" }, 400);
  }
  const input = RelayWriteSchema.safeParse(raw);
  if (!input.success) return json({ error: "bad request" }, 400);

  const checked = checkRelayWrite(input.data, {
    relayUrl,
    owners: ownerPubkeys(),
    session: owner.via === "nostr" ? owner.pubkey : null,
    now: Math.floor(Date.now() / 1000),
  });
  if ("error" in checked) {
    return json({ error: checked.error }, checked.status);
  }
  const answer = await forwardRelayWrite(input.data, relayUrl);
  return answer.ok ? json(answer, 200) : json({ error: answer.error }, 502);
}
