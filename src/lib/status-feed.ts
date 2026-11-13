import "server-only";

import { fetchWithTimeout, HttpError } from "@rtorcato/js-common/fetch";
import { connection } from "next/server";
import { cache } from "react";

import { type MediaEnv, r2Client, r2Url, readMediaEnv } from "./media";
import { sampleFeed, sampleMode } from "./sample-data";

// The status feed (DESIGN.md → "Status feed"): `hive/status.json` in the media
// bucket, written every 5 minutes by a script on the operator's Mac. Read with
// the same read-only R2 token as the Media tab.

export type Runtime = {
  /** "unknown" for runtimes with no on/off state (Goose agents run per turn). */
  state: "running" | "stopped" | "unknown";
  /** Unix seconds the agent entered `state`. */
  since: number;
  /** Unix seconds of the last turn, or null if none. */
  lastTurn: number | null;
  /** e.g. "claude-sonnet-5-5", or null if not reported. */
  model: string | null;
};

export type Usage = {
  /** Integer percentages. */
  fiveH: number;
  sevenD: number;
  paused: boolean;
  /** Unix seconds, or null if not reported. */
  fiveHResetsAt: number | null;
  sevenDResetsAt: number | null;
  /** The % each window pauses the hive at, or null if not reported. */
  fiveHPauseAt: number | null;
  sevenDPauseAt: number | null;
};

export type StatusFeed = {
  /** Unix seconds. */
  publishedAt: number;
  /** Keyed by hex pubkey. */
  runtime: Record<string, Runtime>;
  /** Null when the feed leaves it out: "Usage not reported". */
  usage: Usage | null;
};

export type FeedResult = { feed: StatusFeed | null; stale: boolean };

export const FEED_KEY = "hive/status.json";
export const FEED_STALE_AFTER_S = 10 * 60;

const secs = (v: unknown) =>
  typeof v === "string" ? Math.floor(Date.parse(v) / 1000) : Number.NaN;

const orNull = (n: number) => (Number.isNaN(n) ? null : n);

const pct = (v: unknown) =>
  typeof v === "number" && v >= 0 && v <= 100 ? v : null;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The feed, or null for an unknown version or a malformed file. */
export function parseStatusFeed(json: unknown): StatusFeed | null {
  if (!isObject(json) || json.version !== 1) return null;
  const publishedAt = secs(json.published_at);
  if (Number.isNaN(publishedAt)) return null;
  const runtime: Record<string, Runtime> = {};
  for (const [pubkey, r] of Object.entries(
    isObject(json.runtime) ? json.runtime : {},
  )) {
    if (
      !isObject(r) ||
      !["running", "stopped", "unknown"].includes(r.state as string)
    ) {
      continue;
    }
    const since = secs(r.since);
    if (Number.isNaN(since)) continue;
    runtime[pubkey] = {
      state: r.state as Runtime["state"],
      since,
      lastTurn: orNull(secs(r.last_turn)),
      model: typeof r.model === "string" ? r.model : null,
    };
  }
  return { publishedAt, runtime, usage: parseUsage(json.usage) };
}

function parseUsage(u: unknown): Usage | null {
  if (
    !isObject(u) ||
    typeof u.five_h !== "number" ||
    typeof u.seven_d !== "number"
  ) {
    return null;
  }
  return {
    fiveH: u.five_h,
    sevenD: u.seven_d,
    paused: u.paused === true,
    fiveHResetsAt: orNull(secs(u.five_h_resets_at)),
    sevenDResetsAt: orNull(secs(u.seven_d_resets_at)),
    fiveHPauseAt: pct(u.five_h_pause_at),
    sevenDPauseAt: pct(u.seven_d_pause_at),
  };
}

export const isStale = (feed: StatusFeed, now: number) =>
  now - feed.publishedAt > FEED_STALE_AFTER_S;

// Last good feed, so a failed fetch still shows data, marked stale.
let last: StatusFeed | null = null;

/** Missing file or R2 env → not reported; failed fetch → stale. */
export const loadStatusFeed = cache(async (): Promise<FeedResult> => {
  await connection();
  if (sampleMode()) return { feed: sampleFeed(), stale: false };
  let env: MediaEnv;
  try {
    env = readMediaEnv();
  } catch {
    return { feed: null, stale: false };
  }
  try {
    // S3 API, not the public URL, so an edge-cached copy can't be served.
    const { url, headers } = await r2Client(env).sign(r2Url(env, FEED_KEY));
    last = parseStatusFeed(
      await fetchWithTimeout(url, { headers, cache: "no-store" }, 5_000),
    );
    const now = Date.now() / 1000;
    return { feed: last, stale: last ? isStale(last, now) : false };
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      last = null;
      return { feed: null, stale: false };
    }
    return { feed: last, stale: last !== null };
  }
});
