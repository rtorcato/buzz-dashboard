import { saveConfig } from "@/lib/config-store";
import {
  splitList,
  testDatabase,
  testGithub,
  testMedia,
} from "@/lib/setup-sources";
import { setupGuard } from "../guard";

// Step 4 (#73): tests one optional source and saves it only when the test
// passes. Values come in as strings keyed by the env var they stand in for.
const MEDIA_KEYS = [
  "MEDIA_BASE_URL",
  "R2_ACCOUNT_ID",
  "R2_BUCKET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
] as const;

export async function POST(request: Request) {
  const denied = await setupGuard();
  if (denied) return denied;
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "expected JSON" }, { status: 415 });
  }
  const body = (await request.json().catch(() => null)) as {
    source?: unknown;
    values?: Record<string, unknown>;
  } | null;
  const str = (k: string) => {
    const v = body?.values?.[k];
    return typeof v === "string" ? v.trim() : "";
  };
  let result: Awaited<ReturnType<typeof testGithub>>;
  let save: Record<string, string> = {};
  switch (body?.source) {
    case "github": {
      result = await testGithub({
        token: str("GITHUB_TOKEN"),
        owners: str("GITHUB_OWNERS"),
      });
      save = {
        GITHUB_TOKEN: str("GITHUB_TOKEN"),
        GITHUB_OWNERS: splitList(str("GITHUB_OWNERS")).join(","),
        GITHUB_TRUSTED_AUTHORS: splitList(str("GITHUB_TRUSTED_AUTHORS")).join(
          ",",
        ),
      };
      break;
    }
    case "media": {
      const v = Object.fromEntries(
        MEDIA_KEYS.map((k) => [k, str(k)]),
      ) as Record<(typeof MEDIA_KEYS)[number], string>;
      result = await testMedia(v);
      save = v;
      break;
    }
    case "database": {
      result = await testDatabase(str("DATABASE_URL"));
      save = { DATABASE_URL: str("DATABASE_URL") };
      break;
    }
    default:
      return Response.json({ error: "unknown source" }, { status: 400 });
  }
  if (result.ok) saveConfig(save);
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
