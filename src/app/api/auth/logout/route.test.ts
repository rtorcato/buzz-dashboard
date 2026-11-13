import { describe, expect, it, vi } from "vitest";

const del = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ delete: del }) }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ SESSION_COOKIE: "hive_session" }));

const { POST } = await import("./route");

describe("POST /api/auth/logout", () => {
  it("refuses a cross-site form post", async () => {
    const res = await POST(new Request("http://x/", { method: "POST" }));
    expect(res.status).toBe(415);
    expect(del).not.toHaveBeenCalled();
  });

  it("signs out on a JSON request", async () => {
    const res = await POST(
      new Request("http://x/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(204);
    expect(del).toHaveBeenCalled();
  });
});
