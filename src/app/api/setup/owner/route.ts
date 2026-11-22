import { cookies } from "next/headers";
import { ensureDashboardKey, saveConfig } from "@/lib/config-store";
import { SETUP_COOKIE, setupOpen, setupSessionLeft } from "@/lib/setup";
import { checkOwnerTag } from "@/lib/setup-owner";

// Step 2 (#73, #175): saves the owner and the NIP-OA tag once the pasted
// ownership proof checks out against the dashboard's key.
export async function POST(request: Request) {
  if (!setupOpen()) return new Response(null, { status: 404 });
  if (setupSessionLeft((await cookies()).get(SETUP_COOKIE)?.value) <= 0) {
    return new Response(null, { status: 401 });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "expected JSON" }, { status: 415 });
  }
  const body = (await request.json().catch(() => null)) as {
    tag?: unknown;
  } | null;
  const result = checkOwnerTag(
    typeof body?.tag === "string" ? body.tag.trim() : "",
    ensureDashboardKey(),
  );
  if (!result.ok)
    return Response.json(
      { kind: result.kind, looksLikeKey: result.looksLikeKey ?? false },
      { status: 422 },
    );
  saveConfig({ BUZZ_AUTH_TAG: result.tag, BUZZ_OWNER_PUBKEY: result.owner });
  return Response.json(
    { owner: result.owner },
    { headers: { "cache-control": "no-store" } },
  );
}
