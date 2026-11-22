import { cookies } from "next/headers";
import { readSavedConfig, saveConfig } from "@/lib/config-store";
import { normaliseRelayUrl } from "@/lib/relay-url";
import { SETUP_COOKIE, setupOpen, setupSessionLeft } from "@/lib/setup";
import { checkRelay } from "@/lib/setup-relay";

// Step 3 (#73): tests the relay URL with the dashboard's key and the saved
// attestation. The URL is saved only when every check passes.
export async function POST(request: Request) {
  if (!setupOpen()) return new Response(null, { status: 404 });
  if (setupSessionLeft((await cookies()).get(SETUP_COOKIE)?.value) <= 0) {
    return new Response(null, { status: 401 });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "expected JSON" }, { status: 415 });
  }
  const body = (await request.json().catch(() => null)) as {
    url?: unknown;
  } | null;
  const url = typeof body?.url === "string" ? normaliseRelayUrl(body.url) : "";
  const saved = readSavedConfig();
  if (
    !saved.BUZZ_PRIVATE_KEY ||
    !saved.BUZZ_AUTH_TAG ||
    !saved.BUZZ_OWNER_PUBKEY
  ) {
    return Response.json(
      { error: "Finish the Dashboard key and Owner steps first." },
      { status: 409 },
    );
  }
  const result = await checkRelay({
    url,
    privateKey: saved.BUZZ_PRIVATE_KEY,
    authTag: saved.BUZZ_AUTH_TAG,
    owner: saved.BUZZ_OWNER_PUBKEY,
  });
  if (result.ok) saveConfig({ BUZZ_RELAY_URL: url });
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
