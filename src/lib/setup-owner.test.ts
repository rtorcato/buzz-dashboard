import { createHash } from "node:crypto";
import { schnorr } from "@noble/curves/secp256k1.js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { checkOwnerTag } = await import("./setup-owner");

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const ownerKey = schnorr.utils.randomSecretKey();
const owner = hex(schnorr.getPublicKey(ownerKey));
const dash = hex(schnorr.getPublicKey(schnorr.utils.randomSecretKey()));
const tagFor = (agent: string) => {
  const hash = createHash("sha256")
    .update(`nostr:agent-auth:${agent}:`)
    .digest();
  return JSON.stringify(["auth", owner, "", hex(schnorr.sign(hash, ownerKey))]);
};

describe("checkOwnerTag", () => {
  it("accepts a tag that vouches for the dashboard key", () => {
    const tag = tagFor(dash);
    expect(checkOwnerTag(tag, dash)).toEqual({ ok: true, owner, tag });
  });
  it("says other-key for a well-formed proof signed for another key", () => {
    const other = hex(schnorr.getPublicKey(schnorr.utils.randomSecretKey()));
    expect(checkOwnerTag(tagFor(other), dash)).toEqual({
      ok: false,
      kind: "other-key",
    });
  });
  it("says not-a-proof for text and flags a pasted public key", () => {
    expect(checkOwnerTag("nope", dash)).toEqual({
      ok: false,
      kind: "not-a-proof",
      looksLikeKey: false,
    });
    expect(checkOwnerTag(dash, dash)).toMatchObject({
      kind: "not-a-proof",
      looksLikeKey: true,
    });
  });
  it("says rejected for unreadable shapes and bad owner keys", () => {
    expect(checkOwnerTag('["auth","x"]', dash)).toEqual({
      ok: false,
      kind: "rejected",
    });
    expect(checkOwnerTag('["auth","zz","","sig"]', dash)).toEqual({
      ok: false,
      kind: "rejected",
    });
  });
});
