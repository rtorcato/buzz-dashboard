import "server-only";

import { createHash } from "node:crypto";
import { schnorr } from "@noble/curves/secp256k1.js";
import { connection } from "next/server";
import { cache } from "react";
import { z } from "zod";
import { readServerEnv, type ServerEnv } from "./env";
import {
  type AuthSigner,
  type Filter,
  type NostrEvent,
  queryRelay,
} from "./relay";
import { sampleActivity, sampleHive, sampleMode } from "./sample-data";

export type Agent = {
  name: string;
  role: string;
  picture: string | null;
  /** Every identity folded into this agent: older copies and renamed ones. */
  pubkeys: string[];
  /** Unix seconds of the newest message, or null if silent all week. */
  lastSeenAt: number | null;
  /** First line of the newest message. */
  workingOn: string | null;
  /** Channel the agent posted in most over the last 7 days. */
  homeChannel: string | null;
  messagesToday: number;
  /** Messages per day, 7 entries, oldest first; the last one is today. */
  daily: number[];
  /** The last 7 days of messages, newest first. */
  messages: AgentMessage[];
  /** Names this agent had before a rename, e.g. "Fizz". */
  formerNames: string[];
};

export type AgentMessage = {
  id: string;
  at: number;
  channel: string | null;
  text: string;
};

export type FeedItem = {
  id: string;
  at: number;
  author: string;
  isAgent: boolean;
  channel: string | null;
  text: string;
};

export type Hive = {
  agents: Agent[];
  /** Today's channel messages, newest first. */
  feed: FeedItem[];
  /** Messages per local hour today, 24 entries. */
  hourly: number[];
  /** Channel name by id (the `h` tag), for history rows that store the id. */
  channels: Record<string, string>;
};

// Renamed agents, from AGENT_ALIASES: a JSON object of former → current
// display name, e.g. {"Fizz":"Prime"}. An old profile folds into the current
// name, and /agents/<old-name> redirects. Unset or invalid means no renames.
const AliasSchema = z.record(z.string(), z.string());
let aliasCache: {
  raw: string | undefined;
  map: Record<string, string>;
} | null = null;

export function aliases(
  raw = process.env.AGENT_ALIASES,
): Record<string, string> {
  if (aliasCache && aliasCache.raw === raw) return aliasCache.map;
  let map: Record<string, string> = {};
  if (raw) {
    try {
      map = AliasSchema.parse(JSON.parse(raw));
    } catch {
      console.error(
        "AGENT_ALIASES is not a JSON object of names; ignoring it.",
      );
    }
  }
  aliasCache = { raw, map };
  return map;
}

// Own keys only, so a profile named "constructor" stays a name.
const isAlias = (raw: string) => Object.hasOwn(aliases(), raw);

/** The current name for a possibly former one: "Fizz" → "Prime". */
export const agentName = (raw: string) => (isAlias(raw) ? aliases()[raw] : raw);

const DAY_COUNT = 7;

type Profile = {
  pubkey: string;
  name: string;
  /** The pre-rename name, when this identity is an alias. */
  formerName: string | null;
  role: string;
  picture: string | null;
  isAgent: boolean;
  createdAt: number;
};

const tag = (event: NostrEvent, name: string) =>
  event.tags.find((t) => t[0] === name)?.[1];

/** First non-blank line, without markdown emphasis, code ticks or heading marks. */
export const firstLine = (text: string) => {
  const line =
    text
      .split("\n")
      .find((l) => l.trim())
      ?.replace(/[*`]/g, "")
      .replace(/^#+\s*/, "")
      .trim() ?? "";
  return line.length > 140 ? `${line.slice(0, 139)}…` : line;
};

// Only URLs an <img> can safely load.
const safePicture = (url: unknown) =>
  typeof url === "string" && /^(https:\/\/|data:image\/)/.test(url)
    ? url
    : null;

/** The sha of a picture hosted on our relay's /media/, which needs auth. */
export function relayMediaSha(picture: string, relayUrl: string) {
  try {
    const url = new URL(picture);
    const relay = new URL(relayUrl);
    if (url.protocol !== "https:" || url.host !== relay.host) return null;
    return (
      /^\/media\/([0-9a-f]{64})(\.[a-z0-9]+)?$/.exec(url.pathname)?.[1] ?? null
    );
  } catch {
    return null;
  }
}

// A browser can't load relay media, so those go through /api/avatar (#112).
export const avatarSrc = (
  picture: string | null,
  pubkey: string,
  relayUrl: string,
) =>
  picture && relayMediaSha(picture, relayUrl)
    ? `/api/avatar/${pubkey}`
    : picture;

// NIP-OA: the owner signs sha256("nostr:agent-auth:<agent>:<conditions>").
// ponytail: checks who signed, not the conditions; profiles carry none today.
export function isAttested(event: NostrEvent, owner: string): boolean {
  const auth = event.tags.find((t) => t[0] === "auth");
  if (auth?.[1]?.toLowerCase() !== owner) return false;
  const [, , conditions = "", sig = ""] = auth;
  const hash = createHash("sha256")
    .update(`nostr:agent-auth:${event.pubkey}:${conditions}`)
    .digest();
  try {
    return schnorr.verify(
      Buffer.from(sig, "hex"),
      hash,
      Buffer.from(owner, "hex"),
    );
  } catch {
    return false;
  }
}

function parseProfile(event: NostrEvent, owner: string): Profile {
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(event.content);
  } catch {}
  const raw =
    String(meta.display_name || meta.name || "").trim() ||
    event.pubkey.slice(0, 8);
  return {
    pubkey: event.pubkey,
    name: agentName(raw),
    formerName: isAlias(raw) ? raw : null,
    role: String(meta.about ?? "").trim(),
    picture: safePicture(meta.picture),
    // Agents carry the owner's NIP-OA attestation; humans don't. A bare or
    // forged tag would let any member pass as an agent.
    isAgent: isAttested(event, owner),
    createdAt: event.created_at,
  };
}

/** Local midnight for each of the last `count` days, oldest first, in unix seconds. */
export function dayStarts(now: Date, count = DAY_COUNT): number[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (count - 1 - i));
    return d.getTime() / 1000;
  });
}

/** How many events fall in each day bucket from dayStarts; the last runs on. */
export const perDay = (events: { created_at: number }[], days: number[]) =>
  days.map(
    (start, i) =>
      events.filter(
        (e) =>
          e.created_at >= start && e.created_at < (days[i + 1] ?? Infinity),
      ).length,
  );

// "Today" is the server's local day, so set TZ on the container.
export function buildHive(
  events: NostrEvent[],
  now: Date,
  owner: string,
): Hive {
  const days = dayStarts(now);
  const today = days[DAY_COUNT - 1];

  const profiles = new Map<string, Profile>();
  const channels = new Map<string, string>();
  const messages: NostrEvent[] = [];
  for (const event of events) {
    if (event.kind === 0) {
      const old = profiles.get(event.pubkey);
      if (!old || old.createdAt < event.created_at) {
        profiles.set(event.pubkey, parseProfile(event, owner));
      }
    } else if (event.kind === 39000) {
      const id = tag(event, "d");
      const name = tag(event, "name");
      if (id && name) channels.set(id, name);
    } else if (event.kind === 9 && event.created_at >= days[0]) {
      messages.push(event);
    }
  }
  messages.sort((a, b) => b.created_at - a.created_at);
  const channelOf = (event: NostrEvent) => {
    const id = tag(event, "h");
    return id ? (channels.get(id) ?? null) : null;
  };

  const byPubkey = new Map<string, NostrEvent[]>();
  for (const m of messages) {
    const list = byPubkey.get(m.pubkey);
    if (list) list.push(m);
    else byPubkey.set(m.pubkey, [m]);
  }

  // Dedupe: one card per name, folding in stale copies and aliases.
  const groups = new Map<string, Profile[]>();
  for (const p of profiles.values()) {
    if (p.isAgent) groups.set(p.name, [...(groups.get(p.name) ?? []), p]);
  }

  const agents = [...groups].map(([name, group]): Agent => {
    const lastAt = (p: Profile) => byPubkey.get(p.pubkey)?.[0]?.created_at ?? 0;
    // Show the current identity: not a renamed one, then the most recently
    // active, then the most recently updated profile.
    const [main] = [...group].sort(
      (a, b) =>
        Number(a.formerName !== null) - Number(b.formerName !== null) ||
        lastAt(b) - lastAt(a) ||
        b.createdAt - a.createdAt,
    );
    const own = group
      .flatMap((p) => byPubkey.get(p.pubkey) ?? [])
      .sort((a, b) => b.created_at - a.created_at);

    const perChannel = new Map<string, number>();
    for (const m of own) {
      const channel = channelOf(m);
      if (channel) perChannel.set(channel, (perChannel.get(channel) ?? 0) + 1);
    }
    const daily = perDay(own, days);

    return {
      name,
      role: main.role,
      picture: main.picture,
      // The current identity first.
      pubkeys: [main, ...group.filter((p) => p !== main)].map((p) => p.pubkey),
      lastSeenAt: own[0]?.created_at ?? null,
      workingOn: own[0] ? firstLine(own[0].content) : null,
      homeChannel: [...perChannel].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      messagesToday: daily[DAY_COUNT - 1],
      daily,
      messages: own.map((m) => ({
        id: m.id,
        at: m.created_at,
        channel: channelOf(m),
        text: firstLine(m.content),
      })),
      // A rename keeps the pubkey, so the old name is often only in the aliases.
      formerNames: Object.entries(aliases())
        .filter(([, to]) => to === name)
        .map(([from]) => from),
    };
  });
  agents.sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0));

  const todays = messages.filter((m) => m.created_at >= today);
  const hourly = Array<number>(24).fill(0);
  for (const m of todays) hourly[new Date(m.created_at * 1000).getHours()]++;

  const feed = todays.map((m): FeedItem => {
    const p = profiles.get(m.pubkey);
    return {
      id: m.id,
      at: m.created_at,
      author: p?.name ?? m.pubkey.slice(0, 8),
      isAgent: p?.isAgent ?? false,
      channel: channelOf(m),
      text: firstLine(m.content),
    };
  });

  return { agents, feed, hourly, channels: Object.fromEntries(channels) };
}

// The relay returns at most 1000 events per filter, newest first, whatever the
// filter's `limit` (seen 2026-10-19), so a busy week or month is read in pages.
// ponytail: a cap change on the relay would need RELAY_CAP to follow it.
const RELAY_CAP = 1000;
const MAX_PAGES = 10;

/** Every event matching one filter, paging back with `until` past the cap. */
export async function queryAll(
  env: ServerEnv,
  filter: Filter,
  timeoutMs?: number,
  sign?: AuthSigner,
): Promise<NostrEvent[]> {
  const seen = new Map<string, NostrEvent>();
  let until: number | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await queryRelay(
      env,
      [{ ...filter, until }],
      timeoutMs,
      sign,
    );
    for (const e of batch) seen.set(e.id, e);
    if (batch.length < RELAY_CAP) break;
    // `until` is inclusive, so the oldest second is fetched again and deduped.
    until = Math.min(...batch.map((e) => e.created_at));
  }
  return [...seen.values()];
}

/** Agents and the week's activity, read from the Buzz relay. */
export async function getHive(now = new Date()): Promise<Hive> {
  const env = readServerEnv();
  const owner = env.buzzOwnerPubkey;
  if (!owner || !/^[0-9a-f]{64}$/.test(owner)) {
    throw new Error(
      "BUZZ_OWNER_PUBKEY must be the owner's 64-character hex key",
    );
  }
  const [meta, messages] = await Promise.all([
    queryRelay(env, [{ kinds: [0] }, { kinds: [39000] }]),
    queryAll(env, { kinds: [9], since: dayStarts(now)[0] }),
  ]);
  const hive = buildHive([...meta, ...messages], now, owner);
  for (const a of hive.agents) {
    a.picture = avatarSrc(a.picture, a.pubkeys[0], env.buzzRelayUrl);
  }
  return hive;
}

const ACTIVITY_DAYS = 30;

/**
 * Messages per day over the last 30 days for one agent's identities, oldest
 * first, for the agent page's Activity toggle. The hive query covers 7 days.
 */
export async function getActivity(
  pubkeys: string[],
  now = new Date(),
): Promise<number[]> {
  if (sampleMode()) return sampleActivity();
  const days = dayStarts(now, ACTIVITY_DAYS);
  const events = await queryAll(readServerEnv(), {
    kinds: [9],
    authors: pubkeys,
    since: days[0],
  });
  return perDay(events, days);
}

export type HiveResult =
  | { hive: Hive; fetchedAt: string }
  | { hive: null; error: string };

// One relay read per request, shared by the layout (freshness and the Alert
// list) and the views that render it.
export const loadHive = cache(async (): Promise<HiveResult> => {
  await connection();
  if (sampleMode()) {
    return { hive: sampleHive(), fetchedAt: new Date().toISOString() };
  }
  try {
    const hive = await getHive();
    return { hive, fetchedAt: new Date().toISOString() };
  } catch (err) {
    return { hive: null, error: err instanceof Error ? err.message : "error" };
  }
});
