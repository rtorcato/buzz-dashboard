import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const s = await import("./setup");

const four = {
  BUZZ_RELAY_URL: "wss://r",
  BUZZ_PRIVATE_KEY: "k",
  BUZZ_AUTH_TAG: "t",
  BUZZ_OWNER_PUBKEY: "o",
};

describe("setup gate", () => {
  it("is open until the env sets all four relay settings or Finish saves it", () => {
    expect(s.setupOpen({}, {})).toBe(true);
    expect(s.setupOpen({ ...four, BUZZ_AUTH_TAG: "" }, {})).toBe(true);
    expect(s.setupOpen(four, {})).toBe(false);
    expect(s.setupOpen({ BUZZ_RELAY_URL: "wss://r" }, four)).toBe(true);
    expect(s.setupOpen({}, { ...four, SETUP_DONE: "1" })).toBe(false);
  });

  it("takes the token once, then a session until expiry", () => {
    const token = s.newSetupToken(1000);
    expect(token).toMatch(/^([0-9A-F]{4}-){3}[0-9A-F]{4}$/);
    const ok = s.unlock(token.toLowerCase(), 1001);
    expect(ok).toEqual({ ok: true, expires: 1000 + s.SETUP_TTL_S });
    expect(s.unlock(token, 1002).ok).toBe(false); // used up
    const cookie = s.setupSession(1000 + s.SETUP_TTL_S);
    expect(s.setupSessionLeft(cookie, 1100)).toBe(s.SETUP_TTL_S - 100);
    expect(s.setupSessionLeft(cookie, 1000 + s.SETUP_TTL_S)).toBe(0);
    expect(s.setupSessionLeft(`${cookie}x`, 1100)).toBe(0);
  });

  it("kills the token after 5 wrong tries, and when it expires", () => {
    const token = s.newSetupToken(0);
    for (let i = 4; i >= 0; i--) {
      expect(s.unlock("AAAA", 1)).toEqual({
        ok: false,
        triesLeft: i,
        dead: i === 0,
      });
    }
    expect(s.unlock(token, 2).ok).toBe(false);
    const t2 = s.newSetupToken(0);
    expect(s.unlock(t2, s.SETUP_TTL_S).ok).toBe(false);
  });

  it("does not trust a session before the token was used", () => {
    s.newSetupToken(0);
    expect(s.setupSessionLeft(s.setupSession(s.SETUP_TTL_S), 1)).toBe(0);
  });
});
