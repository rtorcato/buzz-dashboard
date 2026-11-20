import { schnorr } from "@noble/curves/secp256k1.js";
import { readSavedConfig } from "@/lib/config-store";
import { setupGuard } from "../guard";

// Step 5 (#73): what Finish is about to close. Secrets show only whether they
// are set, and where from. Never their value.
export async function GET() {
  const denied = await setupGuard();
  if (denied) return denied;
  const saved = readSavedConfig();
  const from = (k: string) =>
    process.env[k] ? "env" : saved[k] ? "saved" : null;
  const pub = (hex?: string) => {
    try {
      return hex
        ? Buffer.from(schnorr.getPublicKey(Buffer.from(hex, "hex"))).toString(
            "hex",
          )
        : null;
    } catch {
      return null;
    }
  };
  const merged = (k: string) => process.env[k] || saved[k] || "";
  return Response.json(
    {
      key: pub(merged("BUZZ_PRIVATE_KEY")),
      owner: merged("BUZZ_OWNER_PUBKEY").split(/[\s,]+/)[0] || null,
      relay: merged("BUZZ_RELAY_URL") || null,
      github: from("GITHUB_TOKEN")
        ? { owners: merged("GITHUB_OWNERS"), source: from("GITHUB_TOKEN") }
        : null,
      media: from("R2_SECRET_ACCESS_KEY")
        ? { source: from("R2_SECRET_ACCESS_KEY") }
        : null,
      database: from("DATABASE_URL") ? { source: from("DATABASE_URL") } : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
