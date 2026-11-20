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
  it("rejects a tag signed for another key, bad JSON and bad shapes", () => {
    const other = hex(schnorr.getPublicKey(schnorr.utils.randomSecretKey()));
    expect(checkOwnerTag(tagFor(other), dash).ok).toBe(false);
    expect(checkOwnerTag("nope", dash).ok).toBe(false);
    expect(checkOwnerTag('["auth","x"]', dash).ok).toBe(false);
    expect(checkOwnerTag('["auth","zz","","sig"]', dash).ok).toBe(false);
  });
});
