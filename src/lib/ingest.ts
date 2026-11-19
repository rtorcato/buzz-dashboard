import "server-only";

import { and, eq, max } from "drizzle-orm";
import { runAlerts } from "./alert-store";
import { loadSignerRecord } from "./cost-source";
import { readServerEnv } from "./env";
import { type GitHub, type GitHubItem, readGitHub } from "./github";
import {
  historyDb,
  insertAgentEvents,
  insertCostPoints,
  knownAgentEvents,
  knownSeries,
  migrateHistory,
  newestCostPoint,
  pruneHistory,
  retentionDays,
} from "./history";
import {
  events,
  type NewAgentEvent,
  type NewCostPoint,
  type NewHistoryEvent,
} from "./history-schema";
import { getHive, queryAll } from "./hive";
import type { NostrEvent } from "./relay";
import { sampleMode } from "./sample-data";
import {
  authTemplate,
  closeSigner,
  isTurnFor,
  openSigner,
  REQUEST_MS,
  SignerError,
  type SignerRecord,
  TURN_KIND,
  turnEvent,
  turnRows,
  withTimeout,
} from "./signer";

// The history ingester (#39): every minute it appends what the dashboard
// already reads (GitHub PRs and claims, Buzz channel messages) to the history
// store. Every row is keyed on its source id, so a restart or an overlapping
// read never double-counts.

const INTERVAL_MS = 60_000;
// Relay events can land a little after their created_at, so each read starts
// this far before the newest stored message.
const OVERLAP_S = 10 * 60;
const BATCH = 1000;

const toDate = (secs: number) => new Date(secs * 1000);

/** Label changes on one issue or PR (#54), keyed on item, label and time. */
function labelRows(item: GitHubItem): NewHistoryEvent[] {
  const key = `${item.repo}#${item.number}`;
  return item.labelEvents.map((e) => ({
    source: "github",
    sourceId: `${key}:label:${e.action}:${e.label}:${e.at}`,
    kind: "labelled",
    at: toDate(e.at),
    actor: e.actor,
    repo: item.repo,
    title: item.title,
    url: item.url,
    data: { number: item.number, label: e.label, action: e.action },
  }));
}

/**
 * PR opened / reviewed / merged / closed, issue claims, label changes and
 * releases, one row each.
 */
export function githubRows(github: GitHub): NewHistoryEvent[] {
  const rows: NewHistoryEvent[] = [];
  // A claimed open PR is also in `prs`; the source id dedupes its labels.
  const labelled = new Map<string, NewHistoryEvent>();
  for (const item of [...github.prs, ...github.claims]) {
    for (const row of labelRows(item)) labelled.set(row.sourceId, row);
  }
  rows.push(...labelled.values());
  for (const r of github.releases) {
    rows.push({
      source: "github",
      sourceId: `${r.repo}@${r.tag}:released`,
      kind: "released",
      at: toDate(r.publishedAt),
      actor: r.author,
      repo: r.repo,
      title: r.name,
      url: r.url,
      data: { tag: r.tag, prerelease: r.prerelease },
    });
  }
  for (const pr of github.prs) {
    const key = `${pr.repo}#${pr.number}`;
    const base = {
      source: "github",
      actor: pr.agent ?? pr.author,
      repo: pr.repo,
      title: pr.title,
      url: pr.url,
      data: { number: pr.number, labels: pr.labels, author: pr.author },
    };
    rows.push({
      ...base,
      sourceId: `${key}:opened`,
      kind: "pr_opened",
      at: toDate(pr.createdAt),
    });
    // The Pipeline flow (#47) splits a PR's time at its reviews.
    for (const r of pr.reviews) {
      rows.push({
        ...base,
        sourceId: `${key}:reviewed:${r.at}:${r.author}`,
        kind: "pr_reviewed",
        at: toDate(r.at),
        actor: r.author,
        data: { ...base.data, state: r.state, reviewer: r.author },
      });
    }
    if (pr.mergedAt) {
      rows.push({
        ...base,
        sourceId: `${key}:merged`,
        kind: "pr_merged",
        at: toDate(pr.mergedAt),
      });
    } else if (pr.closedAt) {
      rows.push({
        ...base,
        sourceId: `${key}:closed`,
        kind: "pr_closed",
        at: toDate(pr.closedAt),
      });
    }
  }
  for (const c of github.claims) {
    // A PR's claim is its opening, and an issue with no trusted "Claimed by"
    // comment has no claim time to record.
    if (c.isPr || !c.agent) continue;
    rows.push({
      source: "github",
      // An issue can be claimed again later, so the time is part of the key.
      sourceId: `${c.repo}#${c.number}:claimed:${c.claimedAt}`,
      kind: "claimed",
      at: toDate(c.claimedAt),
      actor: c.agent,
      repo: c.repo,
      title: c.title,
      url: c.url,
      data: { number: c.number, labels: c.labels, author: c.author },
    });
  }
  return rows;
}

/** Channel messages (kind 9). The actor is the hex pubkey; views name it. */
export function buzzRows(messages: NostrEvent[]): NewHistoryEvent[] {
  return messages
    .filter((e) => e.kind === 9)
    .map((e) => ({
      source: "buzz",
      sourceId: e.id,
      kind: "message",
      at: toDate(e.created_at),
      actor: e.pubkey,
      channel: e.tags.find((t) => t[0] === "h")?.[1] ?? null,
      body: e.content,
    }));
}

async function insert(rows: NewHistoryEvent[]) {
  for (let i = 0; i < rows.length; i += BATCH) {
    await historyDb()
      .insert(events)
      .values(rows.slice(i, i + BATCH))
      .onConflictDoNothing();
  }
}

async function ingestGitHub() {
  const result = await readGitHub();
  if (!result.github) throw new Error(`GitHub: ${result.error}`);
  await insert(githubRows(result.github));
}

async function ingestBuzz(now: Date) {
  const [row] = await historyDb()
    .select({ newest: max(events.at) })
    .from(events)
    .where(and(eq(events.source, "buzz"), eq(events.kind, "message")));
  const floor = Math.floor(now.getTime() / 1000) - retentionDays() * 86_400;
  const since = row?.newest
    ? Math.floor(row.newest.getTime() / 1000) - OVERLAP_S
    : floor;
  // ponytail: queryAll stops at 10 relay pages (10,000 messages), so a first
  // run on a busy relay keeps only the newest of them. Page further back if a
  // full 90-day backfill matters.
  await insert(
    buzzRows(
      await queryAll(readServerEnv(), {
        kinds: [9],
        since: Math.max(since, floor),
      }),
    ),
  );
}

/** One pass: both sources, then the retention prune. Throws on any failure. */
export async function ingestOnce(now = new Date()) {
  const results = await Promise.allSettled([ingestGitHub(), ingestBuzz(now)]);
  await pruneHistory(now);
  const failed = results.flatMap((r) =>
    r.status === "rejected" ? [String(r.reason?.message ?? r.reason)] : [],
  );
  if (failed.length) throw new Error(failed.join("; "));
}

/** Decrypts at most this many turns a pass; a backfill finishes over a few. */
const MAX_TURNS = 400;
/** Decrypt requests in flight at once. */
const PARALLEL = 20;
/** A report that keeps failing to decrypt is dropped after this many passes. */
const MAX_TRIES = 3;
// Report ids that stored nothing, so a pass doesn't re-decrypt them forever.
// ponytail: in memory, so a restart tries each once more.
const failures = new Map<string, number>();

/** Oldest first, so a capped pass leaves only newer turns for the next. */
export function pickFresh(
  turns: NostrEvent[],
  stored: Set<string>,
  tries: Map<string, number>,
  max = MAX_TURNS,
): NostrEvent[] {
  return turns
    .filter((e) => !stored.has(e.id) && (tries.get(e.id) ?? 0) < MAX_TRIES)
    .sort((a, b) => a.created_at - b.created_at)
    .slice(0, max);
}

/**
 * One owner-signer pass (#43): reads new turn reports from the Buzz relay as
 * the owner and stores them as cost points. Every round trip goes through the
 * owner's signer, so it skips turns it already stored before decrypting.
 * Returns how many turns it stored.
 */
export async function ingestTurns(record: SignerRecord): Promise<number> {
  const env = readServerEnv();
  const newest = await newestCostPoint();
  const since = Math.max(
    record.since,
    newest ? Math.floor(newest.getTime() / 1000) - OVERLAP_S : 0,
  );
  // Only hive agents' reports are decrypted: anyone who can publish to the
  // relay could otherwise make the owner's signer prompt a minute. A hive that
  // can't be read ends the pass rather than widening it.
  const names = new Map<string, string>();
  for (const a of (await getHive()).agents) {
    for (const pk of a.pubkeys) names.set(pk, a.name);
  }
  if (!names.size) return 0;
  const s = openSigner(Uint8Array.from(Buffer.from(record.clientKey, "hex")), {
    ...record.bunker,
    secret: null,
  });
  try {
    // ponytail: like ingestBuzz, at most 10 relay pages (10,000 turns) a
    // pass, the newest; a first backfill on a busy hive keeps only those.
    const found = await queryAll(
      env,
      {
        kinds: [TURN_KIND],
        "#p": [record.pubkey],
        authors: [...names.keys()],
        since,
      },
      REQUEST_MS * 2,
      (challenge) =>
        withTimeout(
          s.signer.signEvent(authTemplate(env.buzzRelayUrl, challenge)),
          REQUEST_MS,
        ),
    );
    const turns = found.filter(
      (e) => names.has(e.pubkey) && isTurnFor(e, record.pubkey),
    );
    const ids = turns.map((e) => e.id);
    // A turn with no usage stores no cost rows, only its Health row (#44).
    const [known, health] = await Promise.all([
      knownSeries(ids),
      knownAgentEvents(ids),
    ]);
    // Ids the relay no longer returns can't come back, so forget them.
    const live = new Set(ids);
    for (const id of failures.keys()) if (!live.has(id)) failures.delete(id);
    const fresh = pickFresh(turns, new Set([...known, ...health]), failures);
    if (!fresh.length) return 0;

    let stored = 0;
    for (let i = 0; i < fresh.length; i += PARALLEL) {
      const rows: NewCostPoint[] = [];
      const turnEvents: NewAgentEvent[] = [];
      const batch = fresh.slice(i, i + PARALLEL);
      const plain = await Promise.allSettled(
        batch.map((e) =>
          withTimeout(s.signer.nip44Decrypt(e.pubkey, e.content), REQUEST_MS),
        ),
      );
      batch.forEach((e, j) => {
        const p = plain[j];
        // A report that fails to decrypt or parse is skipped, as NIP-AM says,
        // and given up on once it keeps failing. A signer that didn't answer
        // in time says nothing about the report, so that isn't counted.
        if (p.status !== "fulfilled") {
          if (!(p.reason instanceof SignerError)) {
            failures.set(e.id, (failures.get(e.id) ?? 0) + 1);
          }
          return;
        }
        const agent = names.get(e.pubkey) ?? "";
        const r = turnRows(e, p.value, agent);
        const t = turnEvent(e, p.value, agent);
        if (r.length || t) stored++;
        else failures.set(e.id, MAX_TRIES);
        rows.push(...r);
        if (t) turnEvents.push(t);
      });
      await insertCostPoints(rows);
      await insertAgentEvents(turnEvents);
    }
    return stored;
  } finally {
    await closeSigner(s);
  }
}

// next dev re-imports modules on reload, so the guard lives on globalThis.
const state = globalThis as { __historyIngester?: true };

/**
 * Runs the migrations, then ingests every minute. Called once from
 * instrumentation.ts when DATABASE_URL is set. A database that is down at
 * start doesn't stop the live dashboard: the next pass retries.
 */
export async function startHistory() {
  if (state.__historyIngester) return;
  state.__historyIngester = true;
  let migrated = false;
  const migrateOnce = async () => {
    if (migrated) return;
    await migrateHistory();
    migrated = true;
    console.log("History store: migrations applied.");
  };
  try {
    await migrateOnce();
  } catch (err) {
    console.error(`History store: migration failed, retrying: ${message(err)}`);
  }
  // Sample mode is fake data, so it never reaches the store.
  if (sampleMode()) return;

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await migrateOnce();
      await ingestOnce();
    } catch (err) {
      console.error(`History ingest failed: ${message(err)}`);
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(tick, INTERVAL_MS).unref();

  // The owner signer runs on its own, since its round trips can take a while.
  let reading = false;
  const readTurns = async () => {
    if (reading || !migrated) return;
    reading = true;
    try {
      const record = await loadSignerRecord();
      if (record) await ingestTurns(record);
    } catch (err) {
      console.error(`Owner signer: ${message(err)}`);
    } finally {
      reading = false;
    }
  };
  setInterval(readTurns, INTERVAL_MS).unref();

  // Alerts (#45) on their own too, so a slow channel never holds up ingest.
  let alerting = false;
  const sendAlerts = async () => {
    if (alerting || !migrated) return;
    alerting = true;
    try {
      await runAlerts();
    } catch (err) {
      console.error(`Alerts: ${message(err)}`);
    } finally {
      alerting = false;
    }
  };
  setInterval(sendAlerts, INTERVAL_MS).unref();
}

const message = (err: unknown) =>
  err instanceof Error ? err.message : String(err);
