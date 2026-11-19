import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { readServerEnv } = await import("./env");

describe("readServerEnv", () => {
  it("returns the credentials when all are set", () => {
    expect(
      readServerEnv({
        GITHUB_TOKEN: "gh",
        BUZZ_RELAY_URL: "wss://relay.example",
        BUZZ_PRIVATE_KEY: "key",
      }),
    ).toEqual({
      githubToken: "gh",
      buzzRelayUrl: "wss://relay.example",
      buzzPrivateKey: "key",
      buzzAuthTag: undefined,
      buzzOwnerPubkey: undefined,
      buzzOwnerPubkeys: [],
    });
  });

  it("takes the owner from BUZZ_OWNER_PUBKEY, else from BUZZ_AUTH_TAG", () => {
    const base = {
      BUZZ_RELAY_URL: "wss://relay.example",
      BUZZ_PRIVATE_KEY: "k",
    };
    const tag = JSON.stringify(["auth", "AB", "", "sig"]);
    expect(readServerEnv({ ...base, BUZZ_AUTH_TAG: tag }).buzzOwnerPubkey).toBe(
      "ab",
    );
    expect(
      readServerEnv({ ...base, BUZZ_AUTH_TAG: tag, BUZZ_OWNER_PUBKEY: "CD" })
        .buzzOwnerPubkey,
    ).toBe("cd");
    for (const bad of ["not json", '["p","AB"]', '["auth","AB",1,"sig"]']) {
      expect(() => readServerEnv({ ...base, BUZZ_AUTH_TAG: bad })).toThrow();
    }
  });

  it("reads BUZZ_OWNER_PUBKEY as a comma list, the first one attesting", () => {
    const env = readServerEnv({
      BUZZ_RELAY_URL: "wss://relay.example",
      BUZZ_PRIVATE_KEY: "k",
      BUZZ_OWNER_PUBKEY: "AA, bb",
    });
    expect(env.buzzOwnerPubkey).toBe("aa");
    expect(env.buzzOwnerPubkeys).toEqual(["aa", "bb"]);
  });

  it("treats GITHUB_TOKEN as optional", () => {
    expect(
      readServerEnv({
        GITHUB_TOKEN: "",
        BUZZ_RELAY_URL: "wss://relay.example",
        BUZZ_PRIVATE_KEY: "key",
      }).githubToken,
    ).toBeUndefined();
  });

  it("names every missing variable", () => {
    expect(() => readServerEnv({ GITHUB_TOKEN: "gh" })).toThrow(
      "Missing required values in .env:\nBUZZ_RELAY_URL\nBUZZ_PRIVATE_KEY",
    );
  });
});
