import "server-only";

import type { ServerEnv } from "./env";
import { isAttested, relayMediaSha } from "./hive";
import { queryRelay, signEvent } from "./relay";

// Relay-hosted agent avatars (#112). Reads have no sign-in, so this serves only
// the current picture of an owner-attested profile, never an arbitrary sha:
// the caller names a pubkey and the sha comes from that profile.

export type Avatar = { body: ArrayBuffer; type: string };

const TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
];
const MAX_BYTES = 5 * 1024 * 1024;

// Blossom get authorization (BUD-01, kind 24242), valid for a minute.
export function blossomAuth(privateKey: string, sha: string, now: number) {
  const event = signEvent(
    privateKey,
    24242,
    [
      ["t", "get"],
      ["x", sha],
      ["expiration", String(now + 60)],
    ],
    `Get ${sha}`,
    now,
  );
  return `Nostr ${Buffer.from(JSON.stringify(event)).toString("base64")}`;
}

/** The agent's avatar, or null when it has none we may serve. */
export async function fetchAvatar(
  env: ServerEnv,
  pubkey: string,
  fetchImpl: typeof fetch = fetch,
  now = Math.floor(Date.now() / 1000),
): Promise<Avatar | null> {
  const owner = env.buzzOwnerPubkey;
  if (!owner || !/^[0-9a-f]{64}$/.test(pubkey)) return null;

  const profiles = await queryRelay(env, [{ kinds: [0], authors: [pubkey] }]);
  const latest = profiles
    .filter((e) => e.pubkey === pubkey && e.kind === 0)
    .sort((a, b) => b.created_at - a.created_at)[0];
  if (!latest || !isAttested(latest, owner)) return null;

  let picture: unknown;
  try {
    picture = JSON.parse(latest.content).picture;
  } catch {
    return null;
  }
  const sha =
    typeof picture === "string" && relayMediaSha(picture, env.buzzRelayUrl);
  if (!sha) return null;

  const res = await fetchImpl(picture as string, {
    headers: { authorization: blossomAuth(env.buzzPrivateKey, sha, now) },
    redirect: "error",
  });
  if (!res.ok) throw new Error(`relay media answered ${res.status}`);
  const type = res.headers.get("content-type")?.split(";")[0].trim() ?? "";
  if (!TYPES.includes(type)) return null;
  const body = await res.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return null;
  return { body, type };
}
