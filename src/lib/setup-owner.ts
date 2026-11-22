import "server-only";

import { isAttested } from "./hive";

// The owner step's paste path (#73, reworked in #175): a pasted ownership
// proof (a NIP-OA tag from Buzz desktop) must be well formed, and its
// signature must vouch for this dashboard's key. A failure carries a `kind`
// so the wizard can show the matching message from DESIGN.md.
export type OwnerTag =
  | { ok: true; owner: string; tag: string }
  | {
      ok: false;
      // "not-a-proof": pasted text that isn't a proof at all.
      // "other-key": a well-formed proof that doesn't vouch for this key.
      // "rejected": anything else (unreadable shape, bad owner key).
      kind: "not-a-proof" | "other-key" | "rejected";
      // Only set for "not-a-proof": the paste looks like a public key.
      looksLikeKey?: boolean;
    };

const KEY_LIKE = /^(npub1[02-9ac-hj-np-z]{58}|[0-9a-fA-F]{64})$/;

export function checkOwnerTag(raw: string, dashboardPubkey: string): OwnerTag {
  let tag: unknown;
  try {
    tag = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      kind: "not-a-proof",
      looksLikeKey: KEY_LIKE.test(raw.trim()),
    };
  }
  if (
    !Array.isArray(tag) ||
    tag[0] !== "auth" ||
    tag.length !== 4 ||
    !tag.every((t) => typeof t === "string")
  ) {
    return { ok: false, kind: "rejected" };
  }
  const owner = String(tag[1]).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(owner)) return { ok: false, kind: "rejected" };
  const event = {
    pubkey: dashboardPubkey,
    tags: [tag as string[]],
  } as Parameters<typeof isAttested>[0];
  if (!isAttested(event, owner)) return { ok: false, kind: "other-key" };
  return { ok: true, owner, tag: JSON.stringify(tag) };
}
