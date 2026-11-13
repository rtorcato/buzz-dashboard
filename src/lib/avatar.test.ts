import { createHash } from "node:crypto";
import { schnorr } from "@noble/curves/secp256k1.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NostrEvent } from "./relay";

vi.mock("server-only", () => ({}));
const queryRelay = vi.fn();
vi.mock("./relay", async (orig) => ({
  ...(await orig<typeof import("./relay")>()),
  queryRelay,
}));

const { blossomAuth, fetchAvatar } = await import("./avatar");
const { avatarSrc } = await import("./hive");

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const ownerKey = new Uint8Array(32).fill(1);
const owner = hex(schnorr.getPublicKey(ownerKey));
const agent = "ab".repeat(32);
const sha = "cd".repeat(32);
const relay = "wss://relay.example";
const media = `https://relay.example/media/${sha}.jpg`;
const env = {
  buzzRelayUrl: relay,
  buzzPrivateKey: "22".repeat(32),
  buzzOwnerPubkey: owner,
  buzzOwnerPubkeys: [owner],
};

const attest = (key = ownerKey) => [
  "auth",
  hex(schnorr.getPublicKey(key)),
  "",
  hex(
    schnorr.sign(
      createHash("sha256").update(`nostr:agent-auth:${agent}:`).digest(),
      key,
    ),
  ),
];
const profile = (picture: string, tags = [attest()]): NostrEvent => ({
  id: "1",
  pubkey: agent,
  created_at: 1,
  kind: 0,
  tags,
  content: JSON.stringify({ name: "Bee", picture }),
  sig: "",
});
const image = () =>
  vi.fn(
    async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/jpeg" },
      }),
  );

beforeEach(() => queryRelay.mockReset());

describe("avatarSrc", () => {
  it("proxies relay media only", () => {
    expect(avatarSrc(media, agent, relay)).toBe(`/api/avatar/${agent}`);
    const pub = "https://media.torcato.dev/avatars/bee.png";
    expect(avatarSrc(pub, agent, relay)).toBe(pub);
    expect(avatarSrc(`https://evil.example/media/${sha}`, agent, relay)).toBe(
      `https://evil.example/media/${sha}`,
    );
    expect(avatarSrc(null, agent, relay)).toBeNull();
  });
});

describe("fetchAvatar", () => {
  it("fetches an attested agent's picture with a signed Blossom get", async () => {
    queryRelay.mockResolvedValue([profile(media)]);
    const f = image();
    const avatar = await fetchAvatar(env, agent, f, 1000);
    expect(avatar?.type).toBe("image/jpeg");
    expect(avatar?.body.byteLength).toBe(3);
    expect(queryRelay).toHaveBeenCalledWith(env, [
      { kinds: [0], authors: [agent] },
    ]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(media);
    const auth = (init.headers as Record<string, string>).authorization;
    const event = JSON.parse(
      Buffer.from(auth.replace("Nostr ", ""), "base64").toString(),
    );
    expect(event.kind).toBe(24242);
    expect(event.tags).toContainEqual(["x", sha]);
    expect(event.tags).toContainEqual(["t", "get"]);
  });

  it("refuses a profile the owner didn't attest", async () => {
    queryRelay.mockResolvedValue([
      profile(media, [attest(new Uint8Array(32).fill(9))]),
    ]);
    const f = image();
    expect(await fetchAvatar(env, agent, f)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("refuses a picture that isn't relay media", async () => {
    for (const pic of [
      `https://evil.example/media/${sha}`,
      `https://relay.example/files/${sha}`,
      "data:image/png;base64,AA",
    ]) {
      queryRelay.mockResolvedValue([profile(pic)]);
      const f = image();
      expect(await fetchAvatar(env, agent, f)).toBeNull();
      expect(f).not.toHaveBeenCalled();
    }
  });

  it("never reaches the relay for a malformed pubkey", async () => {
    expect(await fetchAvatar(env, sha.slice(0, 10), image())).toBeNull();
    expect(queryRelay).not.toHaveBeenCalled();
  });

  it("refuses non-image content", async () => {
    queryRelay.mockResolvedValue([profile(media)]);
    const f = vi.fn(
      async () =>
        new Response("<svg onload=alert(1)>", {
          headers: { "content-type": "image/svg+xml" },
        }),
    );
    expect(await fetchAvatar(env, agent, f)).toBeNull();
  });

  it("throws when the relay refuses the media", async () => {
    queryRelay.mockResolvedValue([profile(media)]);
    const f = vi.fn(async () => new Response(null, { status: 403 }));
    await expect(fetchAvatar(env, agent, f)).rejects.toThrow("403");
  });
});

describe("blossomAuth", () => {
  it("signs a valid event", () => {
    const auth = blossomAuth(env.buzzPrivateKey, sha, 1000);
    const e = JSON.parse(
      Buffer.from(auth.slice("Nostr ".length), "base64").toString(),
    );
    expect(
      schnorr.verify(
        Buffer.from(e.sig, "hex"),
        Buffer.from(e.id, "hex"),
        Buffer.from(e.pubkey, "hex"),
      ),
    ).toBe(true);
    expect(e.tags).toContainEqual(["expiration", "1060"]);
  });
});
