import { LinkHostsBodySchema, PLATFORM_RE } from "@/lib/event-ingest";
import { revokePlatformToken, setLinkHosts } from "@/lib/ingest-tokens";
import { json, ownerBody, ownerHive } from "@/lib/platform-token-route";

// One platform's ingest token (#199). Owner only. PATCH replaces its link
// allowlist; DELETE revokes the token. Events it already posted stay.

type Params = { params: Promise<{ platform: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { platform } = await params;
  if (!PLATFORM_RE.test(platform)) return json({ error: "not found" }, 404);
  const h = await ownerHive();
  if ("response" in h) return h.response;
  const body = await ownerBody(request, LinkHostsBodySchema);
  if ("response" in body) return body.response;
  const updated = await setLinkHosts(h.hive, platform, body.data.linkHosts);
  return updated ? json(updated, 200) : json({ error: "not found" }, 404);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { platform } = await params;
  if (!PLATFORM_RE.test(platform)) return json({ error: "not found" }, 404);
  const h = await ownerHive();
  if ("response" in h) return h.response;
  return (await revokePlatformToken(h.hive, platform))
    ? new Response(null, { status: 204 })
    : json({ error: "not found" }, 404);
}
