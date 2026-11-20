import "server-only";

import { isAttested } from "./hive";

// The owner step's paste path (#73): a pasted NIP-OA tag must be well formed,
// and its signature must vouch for this dashboard's key.
export type OwnerTag =
  | { ok: true; owner: string; tag: string }
  | { ok: false; error: string };

export function checkOwnerTag(raw: string, dashboardPubkey: string): OwnerTag {
  let tag: unknown;
  try {
    tag = JSON.parse(raw);
  } catch {
    return { ok: false, error: "That isn’t valid JSON." };
  }
  if (
    !Array.isArray(tag) ||
    tag[0] !== "auth" ||
    tag.length !== 4 ||
    !tag.every((t) => typeof t === "string")
  ) {
    return {
      ok: false,
      error:
        'Expected a tag like ["auth","<owner hex>","<conditions>","<sig>"].',
    };
  }
  const owner = String(tag[1]).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(owner)) {
    return { ok: false, error: "The owner key isn’t 64 hex characters." };
  }
  const event = {
    pubkey: dashboardPubkey,
    tags: [tag as string[]],
  } as Parameters<typeof isAttested>[0];
  if (!isAttested(event, owner)) {
    return {
      ok: false,
      error: "That attestation isn’t signed for this dashboard’s key.",
    };
  }
  return { ok: true, owner, tag: JSON.stringify(tag) };
}
