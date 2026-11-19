import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";

// Sign out (#40): drops the session cookie. Harmless to call signed out.
export async function POST(request: Request) {
  // As on login: a JSON body needs a CORS preflight cross-site, which this
  // route never answers, so another site can't sign you out (#115).
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "expected JSON" }, { status: 415 });
  }
  (await cookies()).delete(SESSION_COOKIE);
  return new Response(null, { status: 204 });
}
