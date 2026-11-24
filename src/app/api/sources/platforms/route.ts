import { readServerEnv } from "@/lib/env";
import { defaultLinkHosts, RotateBodySchema } from "@/lib/event-ingest";
import { listPlatformTokens, rotatePlatformToken } from "@/lib/ingest-tokens";
import { json, ownerBody, ownerHive } from "@/lib/platform-token-route";

// Event ingest tokens, one per platform (#199). Owner only. GET lists them
// masked. POST creates a platform's token or rotates it; the full token is in
// that one response and never again, and the old one stops working at once.

export async function GET() {
  const h = await ownerHive();
  if ("response" in h) return h.response;
  return json({ platforms: await listPlatformTokens(h.hive) }, 200);
}

export async function POST(request: Request) {
  const h = await ownerHive();
  if ("response" in h) return h.response;
  const body = await ownerBody(request, RotateBodySchema);
  if ("response" in body) return body.response;
  const { platform, linkHosts } = body.data;
  const created = await rotatePlatformToken(
    h.hive,
    platform,
    linkHosts ?? defaultLinkHosts(readServerEnv().buzzRelayUrl),
  );
  return json(created, 200);
}
