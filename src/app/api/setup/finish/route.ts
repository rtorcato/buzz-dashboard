import {
  applySavedConfig,
  readSavedConfig,
  saveConfig,
} from "@/lib/config-store";
import { setupGuard } from "../guard";

// Step 5 (#73): closes setup for good. SETUP_DONE makes setupOpen() false, so
// the token, the session and every setup route stop working at once.
export async function POST() {
  const denied = await setupGuard();
  if (denied) return denied;
  const saved = readSavedConfig();
  const have = (k: string) => process.env[k] || saved[k];
  const missing = [
    "BUZZ_RELAY_URL",
    "BUZZ_PRIVATE_KEY",
    "BUZZ_AUTH_TAG",
    "BUZZ_OWNER_PUBKEY",
  ].filter((k) => !have(k));
  if (missing.length) {
    return Response.json(
      { error: "Finish the Dashboard key, Owner and Relay steps first." },
      { status: 409 },
    );
  }
  saveConfig({ SETUP_DONE: "1" });
  applySavedConfig();
  // History needs DATABASE_URL, which may just have been saved.
  if (process.env.DATABASE_URL) {
    void import("@/lib/ingest").then((m) => m.startHistory()).catch(() => {});
  }
  let host = "";
  try {
    host = new URL(String(have("BUZZ_RELAY_URL"))).host;
  } catch {}
  return Response.json(
    { ok: true, host },
    { headers: { "cache-control": "no-store" } },
  );
}
