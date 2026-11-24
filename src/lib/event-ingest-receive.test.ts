import { beforeEach, describe, expect, it, vi } from "vitest";

// #199: POST /api/events end to end, over an in-memory stand-in for the two
// tables. Covers the issue's acceptance: 401, 415, 413/400, 429, rotation.

type TokenRow = {
  hive: string;
  platform: string;
  hash: string;
  last4: string;
  linkHosts: string[];
  createdAt: Date;
};
const tokens: TokenRow[] = [];
const stored = new Map<string, Record<string, unknown>>();
let tokenReads = 0;
let failInsert = false;

// Just enough of drizzle's builder for ingest-tokens.ts. Tests use one
// platform at a time, so delete and update apply to every token row.
const fakeDb = {
  // listPlatformTokens' lateral query: newest stored `at` per platform.
  execute: async () => ({
    rows: tokens.map((t) => {
      const ats = [...stored.values()]
        .filter((e) => e.platform === t.platform)
        .map((e) => e.at as Date)
        .sort((a, b) => b.getTime() - a.getTime());
      return {
        platform: t.platform,
        last4: t.last4,
        link_hosts: t.linkHosts,
        created_at: t.createdAt,
        last_event_at: ats[0] ?? null,
      };
    }),
  }),
  select: () => ({
    from: () => ({
      where: () => {
        tokenReads++;
        const rows = Promise.resolve([...tokens]);
        return Object.assign(rows, { orderBy: () => rows });
      },
    }),
  }),
  insert: () => ({
    values: (v: Record<string, unknown>) => ({
      onConflictDoUpdate: ({ set }: { set: Partial<TokenRow> }) => ({
        returning: async () => {
          const row = v as TokenRow;
          const i = tokens.findIndex(
            (t) => t.hive === row.hive && t.platform === row.platform,
          );
          if (i < 0) tokens.push({ ...row });
          else Object.assign(tokens[i], set);
          return [tokens[i < 0 ? tokens.length - 1 : i]];
        },
      }),
      onConflictDoNothing: () => ({
        returning: async () => {
          if (failInsert) throw new Error("db down");
          const key = `${v.source} ${v.sourceId}`;
          if (stored.has(key)) return [];
          stored.set(key, v);
          return [{ sourceId: v.sourceId }];
        },
      }),
    }),
  }),
  delete: () => ({
    where: () => ({
      returning: async () => tokens.splice(0).map((t) => t),
    }),
  }),
  update: () => ({
    set: (s: Partial<TokenRow>) => ({
      where: () => ({
        returning: async () => {
          for (const t of tokens) Object.assign(t, s);
          return [...tokens];
        },
      }),
    }),
  }),
};

vi.mock("server-only", () => ({}));
vi.mock("./history", () => ({
  historyEnabled: () => true,
  retentionDays: () => 90,
  historyDb: () => fakeDb,
}));
vi.mock("./registry-route", () => ({
  registryHive: () => ({ hive: "wss://relay.example/" }),
}));

const { receiveEvent, limiter, RATE_LIMIT } = await import(
  "./event-ingest-receive"
);
const {
  listPlatformTokens,
  rotatePlatformToken,
  revokePlatformToken,
  setLinkHosts,
} = await import("./ingest-tokens");

const HIVE = "wss://relay.example/";
const body = {
  id: "turn-1",
  agentId: "ab".repeat(32),
  agent: "Shockwave",
  kind: "failed_turn",
  title: "Turn failed",
};

function post(
  token: string | null,
  payload: unknown = body,
  headers: Record<string, string> = {},
) {
  return receiveEvent(
    new Request("https://dash.example/api/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    }),
  );
}

let token: string;
beforeEach(async () => {
  tokens.length = 0;
  stored.clear();
  failInsert = false;
  await limiter.reset();
  ({ token } = await rotatePlatformToken(HIVE, "claude-code", ["github.com"]));
});

describe("auth", () => {
  it("is 401 without a token, before touching the database", async () => {
    const reads = tokenReads;
    expect((await post(null)).status).toBe(401);
    expect(tokenReads).toBe(reads);
  });

  it("is 401 with a wrong token or the OTel prefix", async () => {
    expect((await post(`${token}x`)).status).toBe(401);
    expect((await post(`hive_otel_${token.slice(9)}`)).status).toBe(401);
  });

  it("rejects the old token after a rotation", async () => {
    expect((await post(token)).status).toBe(201);
    const { token: next } = await rotatePlatformToken(HIVE, "claude-code", []);
    expect(next).not.toBe(token);
    expect((await post(token, { ...body, id: "t2" })).status).toBe(401);
    expect((await post(next, { ...body, id: "t3" })).status).toBe(201);
  });

  it("rejects a revoked token", async () => {
    expect(await revokePlatformToken(HIVE, "claude-code")).toBe(true);
    expect((await post(token)).status).toBe(401);
  });

  it("answers bad-token floods from the cache", async () => {
    await post(token);
    const reads = tokenReads;
    for (let i = 0; i < 20; i++) await post(`hive_evt_bad${i}`);
    expect(tokenReads).toBe(reads);
  });
});

describe("body", () => {
  it("stores the event with the token's platform and reports retries as duplicates", async () => {
    const first = await post(token);
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({
      success: true,
      data: { id: "claude-code:turn-1", duplicate: false },
    });
    const again = await post(token);
    expect(again.status).toBe(200);
    expect((await again.json()).data.duplicate).toBe(true);
    const row = stored.get("ingest claude-code:turn-1");
    expect(row).toMatchObject({ platform: "claude-code", actor: "Shockwave" });
  });

  it("is 415 on non-JSON", async () => {
    const r = await post(token, "x", { "content-type": "text/plain" });
    expect(r.status).toBe(415);
  });

  it("is 413 on an oversized body", async () => {
    const big = { ...body, detail: "d".repeat(20_000) };
    expect((await post(token, big)).status).toBe(413);
  });

  it("is 400 on bad JSON or an invalid event, with the envelope", async () => {
    expect((await post(token, "{nope")).status).toBe(400);
    const r = await post(token, { ...body, kind: "Bad Kind" });
    expect(r.status).toBe(400);
    const json = await r.json();
    expect(json).toMatchObject({ code: "invalid_event" });
    expect(json.issues[0]).toMatch(/^kind:/);
  });

  it("checks links against the platform's own allowlist", async () => {
    const link = { ...body, link: "https://gitlab.com/o/r" };
    expect((await post(token, link)).status).toBe(400);
    await setLinkHosts(HIVE, "claude-code", ["gitlab.com"]);
    expect((await post(token, link)).status).toBe(201);
  });

  it("is 503 when the store fails, so the sender retries", async () => {
    failInsert = true;
    expect((await post(token)).status).toBe(503);
  });
});

describe("rate limit", () => {
  it("is 429 past the per-token limit, with Retry-After", async () => {
    for (let i = 0; i < RATE_LIMIT.requests; i++) {
      expect((await post(token, { ...body, id: `r${i}` })).status).toBe(201);
    }
    const r = await post(token, { ...body, id: "over" });
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("60");
  });

  it("doesn't let a bad token spend the platform's budget", async () => {
    for (let i = 0; i < RATE_LIMIT.requests + 5; i++) {
      await post("hive_evt_wrong");
    }
    expect((await post(token)).status).toBe(201);
  });
});

describe("token list", () => {
  it("shows a masked token and the newest event, kept across a rotation", async () => {
    let [row] = await listPlatformTokens(HIVE);
    expect(row).toMatchObject({ platform: "claude-code", lastEventAt: null });
    expect(row.masked).toMatch(/^hive_evt_•{14}.{4}$/);
    expect(row.masked).not.toContain(token.slice(9, -4));
    await post(token);
    await rotatePlatformToken(HIVE, "claude-code", []);
    [row] = await listPlatformTokens(HIVE);
    expect(row.lastEventAt).not.toBeNull();
    expect(row.linkHosts).toEqual(["github.com"]);
  });
});
