import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const owner = vi.hoisted(() => ({ who: null as null | { via: string } }));
vi.mock("next/headers", () => ({}));
vi.mock("../../../lib/auth", async (orig) => ({
  ...(await orig<typeof import("../../../lib/auth")>()),
  getOwner: async () => owner.who,
}));
const data = {
  connected: false,
  rows: [],
  headsUp: [],
  failures: [],
  updatedAt: null,
};
vi.mock("../../../lib/needs-you", () => ({ getNeedsYou: async () => data }));

const { GET } = await import("./route");

const call = (authorization?: string) =>
  GET(
    new Request("http://hive.local/api/needs-you", {
      headers: authorization ? { authorization } : {},
    }),
  );

afterEach(() => {
  vi.unstubAllEnvs();
  owner.who = null;
});

describe.each([
  ["off", ""],
  ["on", "1"],
])("GET /api/needs-you with sign-in for reads %s", (_, flag) => {
  const reads = flag === "1";

  it("takes the right token", async () => {
    vi.stubEnv("REQUIRE_SIGN_IN_FOR_READS", flag);
    vi.stubEnv("NEEDS_YOU_READ_TOKEN", "tok-123");
    const res = await call("Bearer tok-123");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(data);
  });

  it("refuses a wrong token and never echoes it", async () => {
    vi.stubEnv("REQUIRE_SIGN_IN_FOR_READS", flag);
    vi.stubEnv("NEEDS_YOU_READ_TOKEN", "tok-123");
    const res = await call("Bearer tok-999");
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).not.toContain("tok-999");
    expect(text).not.toContain("tok-123");
  });

  it("follows the normal read rules with no token", async () => {
    vi.stubEnv("REQUIRE_SIGN_IN_FOR_READS", flag);
    vi.stubEnv("NEEDS_YOU_READ_TOKEN", "tok-123");
    expect((await call()).status).toBe(reads ? 401 : 200);
    owner.who = { via: "proxy" };
    expect((await call()).status).toBe(200);
  });

  it("ignores a bearer when no token is configured", async () => {
    vi.stubEnv("REQUIRE_SIGN_IN_FOR_READS", flag);
    expect((await call("Bearer anything")).status).toBe(reads ? 401 : 200);
  });
});
