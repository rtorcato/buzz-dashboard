import { cookies } from "next/headers";
import { ensureDashboardKey } from "@/lib/config-store";
import { SETUP_COOKIE, setupOpen, setupSessionLeft } from "@/lib/setup";

// Step 1 (#73): the dashboard's own key, made on first visit. Only the public
// key leaves the server.
export async function GET() {
  if (!setupOpen()) return new Response(null, { status: 404 });
  if (setupSessionLeft((await cookies()).get(SETUP_COOKIE)?.value) <= 0) {
    return new Response(null, { status: 401 });
  }
  return Response.json(
    { pubkey: ensureDashboardKey() },
    { headers: { "cache-control": "no-store" } },
  );
}
