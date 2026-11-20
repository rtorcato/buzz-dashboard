import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { testGithub, testMedia, testDatabase, splitList } = await import(
  "./setup-sources"
);

const res = (
  status: number,
  body: unknown = [],
  h: Record<string, string> = {},
) =>
  (async () =>
    new Response(JSON.stringify(body), { status, headers: h })) as never;

describe("testGithub", () => {
  it("passes and reports repos and calls left", async () => {
    const r = await testGithub(
      { token: "t", owners: "acme" },
      res(200, [{}, {}], {
        "x-ratelimit-remaining": "4998",
        "x-ratelimit-limit": "5000",
      }),
    );
    expect(r).toEqual({
      ok: true,
      detail: "acme · 2 repos · 4998 of 5000 calls left",
    });
  });
  it("names a rejected token and an unknown owner", async () => {
    expect((await testGithub({ token: "t", owners: "a" }, res(401))).ok).toBe(
      false,
    );
    const r = await testGithub({ token: "t", owners: "nope" }, res(404));
    expect(r).toMatchObject({
      ok: false,
      error: expect.stringContaining("nope"),
    });
  });
  it("rejects bad input before any request", async () => {
    const f = vi.fn();
    expect((await testGithub({ token: "", owners: "a" }, f as never)).ok).toBe(
      false,
    );
    expect(
      (await testGithub({ token: "t", owners: "a/../b" }, f as never)).ok,
    ).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("testMedia and testDatabase", () => {
  it("refuses http and malformed ids without connecting", async () => {
    const base = {
      MEDIA_BASE_URL: "http://m",
      R2_ACCOUNT_ID: "a".repeat(32),
      R2_BUCKET: "bucket",
      R2_ACCESS_KEY_ID: "k",
      R2_SECRET_ACCESS_KEY: "s",
    };
    expect((await testMedia(base)).ok).toBe(false);
    expect(
      (
        await testMedia({
          ...base,
          MEDIA_BASE_URL: "https://m",
          R2_ACCOUNT_ID: "x",
        })
      ).ok,
    ).toBe(false);
  });
  it("refuses a non-postgres connection string", async () => {
    expect((await testDatabase("mysql://x")).ok).toBe(false);
  });
  it("splits lists on commas and spaces", () => {
    expect(splitList("a, b  c,,")).toEqual(["a", "b", "c"]);
  });
});
