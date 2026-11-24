import "server-only";

import { and, eq, sql } from "drizzle-orm";
import type { TokenMatch } from "./event-ingest";
import { historyDb } from "./history";
import { events, ingestTokens, type NewHistoryEvent } from "./history-schema";
import {
  bearerToken,
  EVENT_TOKEN_PREFIX,
  maskToken,
  newIngestToken,
  sha256,
} from "./ingest-token";

// Per-platform event ingest tokens (#199), in the ingest_tokens table from
// Devastator's schema v2. Each platform has its own token, so one can be
// rotated or revoked without touching the others. Only the sha256 is stored.

export type PlatformToken = {
  platform: string;
  masked: string;
  linkHosts: string[];
  createdAt: string;
  /**
   * The platform's newest ingested event, across rotations; null for "No
   * events yet". Only the list reads it; a rotate or link edit returns null.
   */
  lastEventAt: string | null;
};

const toPlatformToken = (
  r: Pick<
    typeof ingestTokens.$inferSelect,
    "platform" | "last4" | "linkHosts" | "createdAt"
  >,
  lastEventAt: Date | null = null,
): PlatformToken => ({
  platform: r.platform,
  masked: maskToken(r, EVENT_TOKEN_PREFIX),
  linkHosts: r.linkHosts,
  createdAt: r.createdAt.toISOString(),
  lastEventAt: lastEventAt?.toISOString() ?? null,
});

// Every post checks its token. Like the OTLP receivers (#66), the hive's whole
// token set (a handful of rows) is kept in memory for a few seconds, so a
// flood of bad tokens is answered from memory and can't drain the
// 5-connection pool. Every write below clears it, and `generation` stops a
// read that started before a write from storing the old set. ponytail: per
// process; another instance sees a rotation up to TTL_MS late.
const TTL_MS = 10_000;
let cache: {
  at: number;
  hive: string;
  byHash: Map<string, TokenMatch>;
} | null = null;
let generation = 0;

function clearCache() {
  cache = null;
  generation++;
}

async function tokensByHash(
  hive: string,
  now: number,
): Promise<Map<string, TokenMatch>> {
  if (cache && cache.hive === hive && now - cache.at < TTL_MS) {
    return cache.byHash;
  }
  const started = generation;
  const rows = await historyDb()
    .select()
    .from(ingestTokens)
    .where(eq(ingestTokens.hive, hive));
  const byHash = new Map(
    rows.map((r) => [
      r.hash,
      { platform: r.platform, linkHosts: r.linkHosts, last4: r.last4 },
    ]),
  );
  if (started === generation) cache = { at: now, hive, byHash };
  return byHash;
}

/**
 * The platform behind `authorization`'s bearer token, or null. The lookup is
 * by sha256 of a 192-bit random token, so comparing hashes in a Map leaks
 * nothing useful (Devastator's note on the issue).
 */
export async function matchEventToken(
  authorization: string | null,
  hive: string,
  now = Date.now(),
): Promise<TokenMatch | null> {
  const token = bearerToken(authorization);
  if (!token?.startsWith(EVENT_TOKEN_PREFIX)) return null;
  return (await tokensByHash(hive, now)).get(sha256(token)) ?? null;
}

type ListRow = {
  platform: string;
  last4: string;
  link_hosts: string[];
  created_at: Date | string;
  last_event_at: Date | string | null;
};

const asDate = (v: Date | string) => (v instanceof Date ? v : new Date(v));

/**
 * The hive's platform tokens, A to Z, each with its "Last event". Devastator's
 * query shape on #199: one probe of events_ingest_platform_at_idx per token
 * row, which the partial index serves only with `source = 'ingest'` written
 * out.
 */
export async function listPlatformTokens(
  hive: string,
): Promise<PlatformToken[]> {
  const { rows } = await historyDb().execute<ListRow>(sql`
    SELECT t.platform, t.last4, t.link_hosts, t.created_at, le.at AS last_event_at
    FROM ${ingestTokens} t
    LEFT JOIN LATERAL (
      SELECT e.at FROM ${events} e
      WHERE e.source = 'ingest' AND e.platform = t.platform AND e.hive = t.hive
      ORDER BY e.at DESC NULLS LAST
      LIMIT 1
    ) le ON true
    WHERE t.hive = ${hive}
    ORDER BY t.platform`);
  return rows.map((r) =>
    toPlatformToken(
      {
        platform: r.platform,
        last4: r.last4,
        linkHosts: r.link_hosts,
        createdAt: asDate(r.created_at),
      },
      r.last_event_at === null ? null : asDate(r.last_event_at),
    ),
  );
}

/**
 * Creates the platform's token, or rotates it: the old one stops working at
 * once. A rotation keeps the stored link hosts; `linkHosts` only seeds a new
 * platform. The full token is in the result and never again.
 */
export async function rotatePlatformToken(
  hive: string,
  platform: string,
  linkHosts: string[],
) {
  const { token, record } = newIngestToken(new Date(), EVENT_TOKEN_PREFIX);
  const createdAt = new Date(record.createdAt);
  const [row] = await historyDb()
    .insert(ingestTokens)
    .values({
      hive,
      platform,
      hash: record.hash,
      last4: record.last4,
      linkHosts,
      createdAt,
    })
    .onConflictDoUpdate({
      target: [ingestTokens.hive, ingestTokens.platform],
      set: { hash: record.hash, last4: record.last4, createdAt },
    })
    .returning();
  clearCache();
  return { token, ...toPlatformToken(row) };
}

/** Deletes the platform's token; false when there was none. */
export async function revokePlatformToken(hive: string, platform: string) {
  const rows = await historyDb()
    .delete(ingestTokens)
    .where(
      and(eq(ingestTokens.hive, hive), eq(ingestTokens.platform, platform)),
    )
    .returning({ platform: ingestTokens.platform });
  clearCache();
  return rows.length > 0;
}

/** Replaces the platform's link allowlist; null when it has no token. */
export async function setLinkHosts(
  hive: string,
  platform: string,
  linkHosts: string[],
): Promise<PlatformToken | null> {
  const [row] = await historyDb()
    .update(ingestTokens)
    .set({ linkHosts })
    .where(
      and(eq(ingestTokens.hive, hive), eq(ingestTokens.platform, platform)),
    )
    .returning();
  clearCache();
  return row ? toPlatformToken(row) : null;
}

/** Stores one ingested event; false when its id was already stored. */
export async function insertIngestedEvent(
  row: NewHistoryEvent,
): Promise<boolean> {
  const rows = await historyDb()
    .insert(events)
    .values(row)
    .onConflictDoNothing()
    .returning({ sourceId: events.sourceId });
  return rows.length > 0;
}
