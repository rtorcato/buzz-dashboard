import "server-only";

import { checkEnv } from "@rtorcato/js-common/env";
import { z } from "zod";

// Credentials are read on the server only. The `server-only` import makes the
// build fail if a client component ever pulls this module in.
export type ServerEnv = {
  // Optional: only the GitHub-backed views need it, and they show their
  // "source down" state when it is missing.
  githubToken?: string;
  buzzRelayUrl: string;
  buzzPrivateKey: string;
  // NIP-OA owner attestation. The relay only lets a non-member identity
  // authenticate when its AUTH event carries this tag.
  buzzAuthTag?: string;
  // Only profiles this owner attested count as agents. Defaults to the owner
  // named in BUZZ_AUTH_TAG. The first key of BUZZ_OWNER_PUBKEY.
  buzzOwnerPubkey?: string;
  // Every BUZZ_OWNER_PUBKEY key (a comma list), each allowed to sign in (#40).
  buzzOwnerPubkeys: string[];
};

// Empty strings count as unset, as they always have here.
const EnvSchema = z.object({
  GITHUB_TOKEN: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  BUZZ_RELAY_URL: z.string().min(1),
  BUZZ_PRIVATE_KEY: z.string().min(1),
  // Checked here so a bad tag fails at startup, not on the first query.
  BUZZ_AUTH_TAG: z
    .string()
    .optional()
    .transform((v) => v || undefined)
    .refine((v) => v === undefined || isAuthTag(v), {
      message:
        'must be a JSON tag like ["auth","<owner hex>","<conditions>","<sig>"]',
    }),
  BUZZ_OWNER_PUBKEY: z
    .string()
    .optional()
    .transform((v) => v || undefined),
});

export function readServerEnv(
  source: Record<string, string | undefined> = process.env,
): ServerEnv {
  const env = checkEnv(EnvSchema, source);
  const owners = (env.BUZZ_OWNER_PUBKEY || tagOwner(env.BUZZ_AUTH_TAG) || "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((k) => k.toLowerCase());
  return {
    githubToken: env.GITHUB_TOKEN,
    buzzRelayUrl: env.BUZZ_RELAY_URL,
    buzzPrivateKey: env.BUZZ_PRIVATE_KEY,
    buzzAuthTag: env.BUZZ_AUTH_TAG,
    buzzOwnerPubkey: owners[0],
    buzzOwnerPubkeys: owners,
  };
}

function isAuthTag(raw: string): boolean {
  try {
    const tag: unknown = JSON.parse(raw);
    return (
      Array.isArray(tag) &&
      tag[0] === "auth" &&
      tag.length === 4 &&
      tag.every((t) => typeof t === "string")
    );
  } catch {
    return false;
  }
}

function tagOwner(authTag?: string): string | undefined {
  try {
    const owner = JSON.parse(authTag ?? "")[1];
    return typeof owner === "string" ? owner : undefined;
  } catch {
    return undefined;
  }
}
