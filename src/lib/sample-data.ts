import { createHash } from "node:crypto";
import type { Hive } from "./hive";
import type { MediaEnv, MediaFile } from "./media";
import type { NeedsYouRow } from "./needs-you";
import type { Runtime, StatusFeed } from "./status-feed";

// Sample data for the docs screenshots (scripts/capture-screens.mjs). Every
// name, key, channel and repo here is made up. It loads only with
// BUZZ_SAMPLE_DATA=1 under `next dev`, never in a production build.
export const sampleMode = () =>
  process.env.BUZZ_SAMPLE_DATA === "1" && process.env.NODE_ENV !== "production";

const nowS = () => Math.floor(Date.now() / 1000);
const fakeKey = (name: string) =>
  createHash("sha256").update(`sample-${name}`).digest("hex");

// name, role, home channel, seconds since last message, messages (newest
// first), 7-day message counts.
const AGENTS: [string, string, string, number, string[], number[]][] = [
  [
    "Atlas",
    "Lead: routes issues and keeps the queue moving",
    "general",
    4 * 60,
    [
      "Routed example-app#42 to Fern, docs PR to Briar",
      "Morning roll call: 4 PRs in review, 1 blocked",
      "Fern takes example-app#42, Briar the quick start",
    ],
    [14, 22, 18, 25, 19, 27, 21],
  ],
  [
    "Briar",
    "Writer: READMEs, docs and release notes",
    "docs",
    9 * 60,
    ["Docs PR up: quick start now uses the published image"],
    [6, 9, 4, 11, 8, 7, 9],
  ],
  [
    "Cobalt",
    "Code reviewer",
    "reviews",
    22 * 60,
    ["Review passed on example-lib#118, handing to security"],
    [10, 12, 15, 9, 14, 13, 11],
  ],
  [
    "Dune",
    "Researcher: spikes before code",
    "research",
    70 * 60,
    ["Findings posted: lockfile drift comes from the CI cache"],
    [3, 5, 2, 6, 4, 3, 4],
  ],
  [
    "Ember",
    "Security reviewer",
    "security",
    3 * 3600,
    ["Audit done for v2.4.0, no blockers"],
    [7, 4, 6, 5, 8, 6, 2],
  ],
  [
    "Fern",
    "Coder: TypeScript and React",
    "example-app",
    2 * 60,
    [
      "PR up for example-app#42: empty state for the search page",
      "Typecheck, lint and tests pass; checking it in a browser",
      "Picked up example-app#42",
      "Reading the search page and its empty state",
    ],
    [12, 18, 16, 20, 15, 22, 17],
  ],
];

export function sampleHive(): Hive {
  const t = nowS();
  const agents = AGENTS.map(([name, role, channel, ago, texts, daily]) => ({
    name,
    role,
    picture: null,
    pubkeys: [fakeKey(name)],
    lastSeenAt: t - ago,
    workingOn: texts[0],
    homeChannel: channel,
    messagesToday: daily[6],
    daily,
    messages: texts.map((text, i) => ({
      id: `${name}-${i}`,
      at: t - ago - i * 1900,
      channel,
      text,
    })),
    formerNames: [],
  }));
  return { agents, feed: [], hourly: Array(24).fill(0), channels: {} };
}

/** 30 days of messages per day, oldest first, for the agent page. */
export const sampleActivity = () =>
  Array.from({ length: 30 }, (_, i) => 6 + ((i * 7) % 13) + (i > 22 ? 6 : 0));

export function sampleFeed(): StatusFeed {
  const t = nowS();
  const runtime: Record<string, Runtime> = {};
  for (const [name, , , ago] of AGENTS) {
    runtime[fakeKey(name)] = {
      state: name === "Dune" ? "stopped" : "running",
      since: t - 5 * 3600,
      lastTurn: t - ago,
      model: "claude-sonnet-5-5",
    };
  }
  return {
    publishedAt: t - 90,
    runtime,
    // A 5h pause, so the Needs-you card shows its reset countdown.
    usage: {
      fiveH: 92,
      sevenD: 61,
      paused: true,
      fiveHResetsAt: t + 100 * 60,
      sevenDResetsAt: t + 3 * 86400,
      fiveHPauseAt: 90,
      sevenDPauseAt: 95,
    },
  };
}

export const sampleMergeRow = (): NeedsYouRow => ({
  kind: "merge",
  title: "3 PRs ready to merge",
  detail: "example-app#44, example-lib#119, example-docs#31",
  count: 3,
  since: new Date((nowS() - 2 * 3600) * 1000).toISOString(),
  // Same shape as mergeKey() in needs-you.ts (a server-only module, so not
  // imported here), so the snooze menu shows in the sample.
  keys: [
    "merge:example/example-app#44",
    "merge:example/example-lib#119",
    "merge:example/example-docs#31",
  ],
});

// The capture script answers requests to this host with its own screenshots.
export const SAMPLE_MEDIA_ENV: MediaEnv = {
  baseUrl: "https://media.example.com",
  accountId: "sample",
  bucket: "sample",
  accessKeyId: "sample",
  secretAccessKey: "sample",
};

const MEDIA: [string, string, number][] = [
  ["example-app", "empty-states.png", 0],
  ["example-app", "search-mobile.png", 0],
  ["example-app", "board-dark.png", 0],
  ["example-app", "releases-v2.png", 1],
  ["example-app", "timeline.png", 1],
  ["example-docs", "tokens.png", 0],
  ["example-docs", "social-card.png", 0],
  ["example-docs", "gallery.png", 1],
  ["example-lib", "agents-light.png", 0],
  ["example-lib", "hero-v2.png", 0],
];

export function sampleMedia(): MediaFile[] {
  return MEDIA.map(([repo, name, daysAgo], i) => {
    const modified = Date.now() - daysAgo * 86_400_000 - i * 1_500_000;
    const date = new Date(modified).toISOString().slice(0, 10);
    return {
      key: `${repo}/${date}/${name}`,
      repo,
      date,
      name,
      size: 120_000 + i * 37_111,
      modified,
    };
  });
}
