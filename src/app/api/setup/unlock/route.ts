import { cookies } from "next/headers";
import { publicOrigin } from "@/lib/auth";
import { SETUP_COOKIE, setupOpen, setupSession, unlock } from "@/lib/setup";

// Trades the token from the container logs for a setup session (#73). Wrong
// tries are counted in memory, so a restart is the only reset.
export async function POST(request: Request) {
  if (!setupOpen()) return new Response(null, { status: 404 });
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "expected JSON" }, { status: 415 });
  }
  const body = (await request.json().catch(() => null)) as {
    token?: unknown;
  } | null;
  const result = unlock(typeof body?.token === "string" ? body.token : "");
  if (!result.ok) {
    return Response.json(
      { triesLeft: result.triesLeft, dead: result.dead },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  const maxAge = result.expires - Math.floor(Date.now() / 1000);
  (await cookies()).set(SETUP_COOKIE, setupSession(result.expires), {
    httpOnly: true,
    sameSite: "lax",
    // No pinned origin yet on a first run, so plain http must still work.
    secure: publicOrigin()?.startsWith("https:") ?? false,
    path: "/",
    maxAge,
  });
  return Response.json(
    { ok: true },
    { headers: { "cache-control": "no-store" } },
  );
}
