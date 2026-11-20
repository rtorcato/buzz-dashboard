import { cookies } from "next/headers";
import { SETUP_COOKIE, setupOpen, setupSessionLeft } from "@/lib/setup";

/** The setup routes' shared gate: open, and a live setup session. */
export async function setupGuard(): Promise<Response | null> {
  if (!setupOpen()) return new Response(null, { status: 404 });
  if (setupSessionLeft((await cookies()).get(SETUP_COOKIE)?.value) <= 0) {
    return new Response(null, { status: 401 });
  }
  return null;
}
