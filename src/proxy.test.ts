import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({}));

const { proxy } = await import("./proxy");
const { newSession, PROXY_SECRET_HEADER, readsNeedSignIn, SESSION_COOKIE } =
  await import("./lib/auth");

const req = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://hive.local${path}`, { headers });
const owner = {
  "x-user": "sam",
  [PROXY_SECRET_HEADER]: "s3cret",
};
// next() responses carry this header; redirects and 401s don't.
const passed = (res: Response) => res.headers.get("x-middleware-next") === "1";

afterEach(() => vi.unstubAllEnvs());

function gate(mode: "proxy" | "nostr" | "") {
  vi.stubEnv("REQUIRE_SIGN_IN_FOR_READS", "1");
  vi.stubEnv("BUZZ_PRIVATE_KEY", "test-key");
  vi.stubEnv("AUTH_MODE", mode);
  vi.stubEnv("AUTH_PROXY_HEADER", "x-user");
  vi.stubEnv("AUTH_PROXY_SECRET", "s3cret");
  vi.stubEnv("AUTH_PUBLIC_URL", "http://hive.local");
}

describe("readsNeedSignIn", () => {
  it("is off unless the flag is set", () => {
    expect(readsNeedSignIn({})).toBe(false);
    expect(readsNeedSignIn({ REQUIRE_SIGN_IN_FOR_READS: "0" })).toBe(false);
    expect(readsNeedSignIn({ REQUIRE_SIGN_IN_FOR_READS: "true" })).toBe(true);
  });
});

describe("proxy", () => {
  it("lets everything through with the flag off", () => {
    expect(passed(proxy(req("/agents")))).toBe(true);
    expect(passed(proxy(req("/api/avatar/x")))).toBe(true);
  });

  it("sends signed-out pages to sign-in and refuses API reads", async () => {
    gate("proxy");
    const page = proxy(req("/agents?x=1"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe(
      "http://hive.local/sign-in?next=%2Fagents%3Fx%3D1",
    );
    const api = proxy(req("/api/alerts"));
    expect(api.status).toBe(401);
    expect(await api.json()).toEqual({ error: "sign-in required" });
  });

  it("keeps sign-in, health and ingest reachable", () => {
    gate("proxy");
    for (const p of [
      "/sign-in",
      "/api/auth/challenge",
      "/api/health",
      "/otlp/v1/logs",
    ]) {
      expect(passed(proxy(req(p))), p).toBe(true);
    }
    expect(passed(proxy(req("/sign-in-x")))).toBe(false);
    expect(passed(proxy(req("/api/healthz")))).toBe(false);
  });

  it("lets the owner in through the proxy", () => {
    gate("proxy");
    expect(passed(proxy(req("/agents", owner)))).toBe(true);
    expect(passed(proxy(req("/agents", { "x-user": "sam" })))).toBe(false);
  });

  it("lets a Nostr owner in by session cookie", () => {
    gate("nostr");
    const key = "ab".repeat(32);
    vi.stubEnv("BUZZ_RELAY_URL", "wss://relay.example");
    vi.stubEnv("BUZZ_OWNER_PUBKEY", key);
    const now = Math.floor(Date.now() / 1000);
    const cookie = (pk: string) => ({
      cookie: `${SESSION_COOKIE}=${newSession(pk, now).value}`,
    });
    expect(passed(proxy(req("/agents", cookie(key))))).toBe(true);
    expect(passed(proxy(req("/agents", cookie("cd".repeat(32)))))).toBe(false);
  });

  it("fails closed when sign-in isn't configured", () => {
    gate("");
    expect(passed(proxy(req("/agents", owner)))).toBe(false);
  });
});
