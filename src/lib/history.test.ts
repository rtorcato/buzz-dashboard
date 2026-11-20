import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { hiveStatements, projectCondition } = await import("./history");
const { PgDialect } = await import("drizzle-orm/pg-core");
const render = (
  c: Parameters<InstanceType<typeof PgDialect>["sqlToQuery"]>[0],
) => new PgDialect().sqlToQuery(c);

describe("hiveStatements (#116)", () => {
  it("defaults and backfills every history table with the relay", () => {
    const sql = hiveStatements("wss://relay.example");
    expect(sql).toHaveLength(20);
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

describe("projectCondition (#167)", () => {
  it("matches lower(repo) and channel against arrays, the two indexes", () => {
    const q = render(
      projectCondition({ repos: ["o/a", "o/b"], channels: ["c1"] }),
    );
    expect(q.sql).toBe(
      '(lower("events"."repo") = ANY($1::text[]) or "events"."channel" = ANY($2::text[]))',
    );
    expect(q.params).toEqual([["o/a", "o/b"], ["c1"]]);
  });

  it("uses only the side a project has", () => {
    expect(render(projectCondition({ repos: ["o/a"], channels: [] })).sql).toBe(
      'lower("events"."repo") = ANY($1::text[])',
    );
    expect(render(projectCondition({ repos: [], channels: ["c1"] })).sql).toBe(
      '"events"."channel" = ANY($1::text[])',
    );
  });

  it("matches nothing for a project with neither", () => {
    expect(render(projectCondition({ repos: [], channels: [] })).sql).toBe(
      "false",
    );
  });
});
