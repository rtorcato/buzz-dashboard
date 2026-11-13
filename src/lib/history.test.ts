import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { hiveStatements } = await import("./history");

describe("hiveStatements (#116)", () => {
  it("defaults and backfills every history table with the relay", () => {
    const sql = hiveStatements("wss://relay.example");
    expect(sql).toHaveLength(8);
    expect(sql[0]).toBe(
      `ALTER TABLE "events" ALTER COLUMN "hive" SET DEFAULT 'wss://relay.example/'`,
    );
    expect(sql[1]).toBe(
      `UPDATE "events" SET "hive" = 'wss://relay.example/' WHERE "hive" IS NULL`,
    );
    expect(sql.join("\n")).toContain(`"settings"`);
  });

  it("quotes the URL as a literal", () => {
    expect(hiveStatements("wss://relay.example/a'b")[0]).toContain(
      "'wss://relay.example/a''b'",
    );
  });

  it("does nothing without a websocket relay URL", () => {
    expect(hiveStatements(undefined)).toEqual([]);
    expect(hiveStatements("https://relay.example")).toEqual([]);
    expect(hiveStatements("not a url")).toEqual([]);
  });
});
