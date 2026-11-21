import "server-only";

import { randomUUID } from "node:crypto";
import {
  type AlertConfig,
  AlertConfigSchema,
  AlertStateSchema,
  alertRequest,
  BUZZ_TARGET,
  type Channel,
  type ChannelType,
  channelUrl,
  dueAlerts,
  EMPTY_CONFIG,
  type Item,
  liveMutes,
  MAX_SNOOZE_MS,
  type Mutes,
  MutesSchema,
  RULE_IDS,
  type Rule,
  type RuleId,
  ruleOf,
} from "./alerts";
import { decryptSecret, encryptSecret, publicOrigin } from "./auth";
import {
  dmText,
  loadDmSetup,
  openDm,
  RelayError,
  sendDmMessage,
} from "./buzz-dm";
import { diffLog } from "./cleared-log";
import { formatUsd } from "./cost";
import { loadIngestTokenRecord, loadSignerRecord } from "./cost-source";
import { readGitHub } from "./github";
import { loadFailing, recentBuckets } from "./health-data";
import {
  costByAgentSince,
  getSetting,
  historyEnabled,
  logAcked,
  logAppeared,
  logCleared,
  openLogRows,
  setSetting,
  updateSetting,
} from "./history";
import { readHive } from "./hive";
import {
  blockedItems,
  blockedKey,
  budgetKey,
  excludedLabels,
  failingKey,
  failingRow,
  githubReads,
  MERGE_READY,
  mergeKey,
  quietAgents,
  quietLine,
  releaseKey,
  silentKey,
} from "./needs-you";
import { readReleases } from "./releases";
import { readStatusFeed } from "./status-feed";

// Alerts (#45), server side: the stored config with its channel URLs
// encrypted, the sender, and the pass the ingester runs every minute.

const CONFIG_KEY = "alerts";
const STATE_KEY = "alert_state";
const MUTE_KEY = "alert_mute";
const SEND_MS = 10_000;

/** The config with channel URLs decrypted. Server only: never send it to the page. */
export async function loadAlerts(): Promise<AlertConfig> {
  if (!historyEnabled()) return EMPTY_CONFIG;
  const raw = await getSetting(CONFIG_KEY);
  if (raw === null) return EMPTY_CONFIG;
  // Throw rather than start empty: the next save would wipe the channels.
  const parsed = AlertConfigSchema.parse(raw);
  return {
    ...parsed,
    // Unreadable after a BUZZ_PRIVATE_KEY rotation: the owner adds it again.
    channels: parsed.channels.flatMap((c) => {
      const target = decryptSecret(c.target);
      return target ? [{ ...c, target }] : [];
    }),
  };
}

async function saveAlerts(config: AlertConfig) {
  await setSetting(CONFIG_KEY, {
    ...config,
    channels: config.channels.map((c) => ({
      ...c,
      target: encryptSecret(c.target),
    })),
  });
}

export class AlertInputError extends Error {}

/** Adds a channel, and adds it to every rule that's on. */
export async function addChannel(type: ChannelType, target: string) {
  const config = await loadAlerts();
  let address = BUZZ_TARGET;
  if (type === "buzz") {
    // Opt-in, and only with a posting key of its own (#83).
    const setup = loadDmSetup();
    if (!setup.ok) throw new AlertInputError(setup.reason);
    if (config.channels.some((c) => c.type === "buzz")) {
      throw new AlertInputError("Buzz DM is already set up");
    }
  } else {
    const url = channelUrl(target);
    if (!url) {
      throw new AlertInputError(
        "Use an http(s) URL without a user name or password",
      );
    }
    address = url.toString();
  }
  const channel: Channel = {
    id: randomUUID().slice(0, 8),
    type,
    target: address,
    on: true,
  };
  const rules: AlertConfig["rules"] = {};
  for (const id of RULE_IDS) {
    const rule = ruleOf(config, id);
    rules[id] = rule.on
      ? { ...rule, channels: [...rule.channels, channel.id] }
      : rule;
  }
  await saveAlerts({
    ...config,
    channels: [...config.channels, channel],
    rules,
  });
}

export async function setChannelOn(id: string, on: boolean) {
  const config = await loadAlerts();
  await saveAlerts({
    ...config,
    channels: config.channels.map((c) => (c.id === id ? { ...c, on } : c)),
  });
}

export async function removeChannel(id: string) {
  const config = await loadAlerts();
  const rules: AlertConfig["rules"] = {};
  for (const [rid, rule] of Object.entries(config.rules)) {
    rules[rid as RuleId] = {
      ...rule,
      channels: rule.channels.filter((c) => c !== id),
    };
  }
  await saveAlerts({
    ...config,
    channels: config.channels.filter((c) => c.id !== id),
    rules,
  });
}

export async function saveRule(id: RuleId, rule: Rule) {
  const config = await loadAlerts();
  const known = new Set(config.channels.map((c) => c.id));
  await saveAlerts({
    ...config,
    rules: {
      ...config.rules,
      [id]: { ...rule, channels: rule.channels.filter((c) => known.has(c)) },
    },
  });
}

export async function setQuiet(quiet: boolean) {
  await saveAlerts({ ...(await loadAlerts()), quiet });
}

/** Snoozed and acked alert items (#46); empty without the history store. */
export async function loadMutes(): Promise<Mutes> {
  if (!historyEnabled()) return {};
  return toMutes(await getSetting(MUTE_KEY));
}

function toMutes(raw: unknown): Mutes {
  const parsed = MutesSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

/** Stops alerts on `keys` until `until` (ms), or until each clears when null. */
export async function muteItems(
  keys: string[],
  until: number | null,
  now = Date.now(),
) {
  if (until !== null && (until <= now || until > now + MAX_SNOOZE_MS)) {
    throw new AlertInputError("Snooze for up to two days");
  }
  await updateSetting(MUTE_KEY, (raw) => {
    const mutes = toMutes(raw);
    for (const key of keys) mutes[key] = { until };
    return mutes;
  });
}

const DM_KEY = "alert_dm";
const DM_GONE = new Set([404, 410]);

/** Sends a DM to the owner, opening the conversation the first time (#83). */
async function deliverDm(text: string) {
  const setup = loadDmSetup();
  if (!setup.ok) throw new Error(setup.reason);
  const saved = await getSetting(DM_KEY);
  const known =
    typeof (saved as { dm?: unknown } | null)?.dm === "string"
      ? (saved as { dm: string }).dm
      : null;
  if (known) {
    try {
      return await sendDmMessage(setup, known, text);
    } catch (err) {
      // Only a 404 or 410 means the DM is gone (hidden or deleted). Anything
      // else (408, 429, a 5xx, a timeout, a network error) may be transient:
      // rethrow so the next run retries it rather than opening a duplicate
      // DM and overwriting the saved id (#143).
      if (!(err instanceof RelayError && DM_GONE.has(err.status))) throw err;
      console.error(`Alert: Buzz DM ${known} failed, reopening: ${err}`);
    }
  }
  const dm = await openDm(setup);
  await setSetting(DM_KEY, { dm });
  await sendDmMessage(setup, dm, text);
}

/** Posts one alert to one channel; throws when it doesn't land. */
export async function deliver(
  channel: Channel,
  alert: {
    rule: RuleId | "test";
    title: string;
    detail: string;
    path: string | null;
  },
) {
  const origin = publicOrigin();
  if (channel.type === "buzz") {
    const link = origin && alert.path ? `${origin}${alert.path}` : null;
    return deliverDm(dmText({ ...alert, link }));
  }
  const url = channelUrl(channel.target);
  if (!url) throw new Error("invalid URL");
  const req = alertRequest(channel.type, url, {
    ...alert,
    link: origin && alert.path ? `${origin}${alert.path}` : null,
  });
  // ponytail: no redirects and a short timeout, but any address the owner
  // types is reachable, since ntfy and webhooks often live on the LAN.
  const res = await fetch(req.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: req.body,
    redirect: "error",
    signal: AbortSignal.timeout(SEND_MS),
  });
  if (!res.ok) throw new Error(`${channel.type} answered ${res.status}`);
}

export async function sendTest(id: string) {
  const channel = (await loadAlerts()).channels.find((c) => c.id === id);
  if (!channel) throw new AlertInputError("No such channel");
  await deliver(channel, {
    rule: "test",
    title: "Test alert from your hive dashboard",
    detail: "If you can read this, alerts reach this channel.",
    path: "/settings?tab=alerts",
  });
}

/**
 * What Needs you shows right now that a rule can alert on. `complete` is
 * false when GitHub didn't answer, so some items may be missing.
 */
async function currentItems(
  now: number,
  config: AlertConfig,
): Promise<{ items: Item[]; complete: boolean; down: RuleId[] }> {
  const items: Item[] = [];
  let complete = true;
  const down: RuleId[] = [];
  const source = (await loadSignerRecord())
    ? "signer"
    : (await loadIngestTokenRecord())
      ? "otel"
      : null;
  if (source) {
    const health = await loadFailing(Math.floor(now / 1000), source);
    for (const f of health?.failing ?? []) {
      const row = failingRow(f, source);
      items.push({
        rule: "failing",
        key: failingKey(f.agent),
        title: row.title,
        detail: row.detail,
        path: "/health",
      });
    }
  }
  const budget = ruleOf(config, "budget");
  if (source && budget.on) {
    // Today on the server clock (TZ), as the cost chip counts it. The total
    // resets at midnight, so the item clears and a new day alerts again.
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    for (const { agent, usd } of await costByAgentSince(today)) {
      if (usd <= budget.value) continue;
      items.push({
        rule: "budget",
        key: budgetKey(agent),
        title: `${agent} is over $${budget.value} today`,
        detail: `${formatUsd(usd)} so far today · est.`,
        path: "/cost",
      });
    }
  }
  const reads = githubReads(
    excludedLabels(process.env.NEEDS_YOU_EXCLUDE_LABELS),
  );
  const silent = ruleOf(config, "silent");
  if (reads.length || silent.on) {
    const { github } = await readGitHub();
    if (!github) {
      complete = false;
      down.push(...reads, ...(silent.on ? (["silent"] as const) : []));
    }
    if (github && reads.includes("merge")) {
      for (const pr of github.prs) {
        if (pr.closedAt !== null || !pr.labels.includes(MERGE_READY)) continue;
        const key = `${pr.repo.split("/")[1]}#${pr.number}`;
        items.push({
          rule: "merge",
          key: mergeKey(pr),
          title: `${key} is ready to merge`,
          detail: pr.title,
          path: "/pipeline",
        });
      }
    }
    if (github && reads.includes("blocked")) {
      for (const item of blockedItems(github)) {
        const key = `${item.repo.split("/")[1]}#${item.number}`;
        items.push({
          rule: "blocked",
          key: blockedKey(item),
          title: `${key} is blocked`,
          detail: item.title,
          path: "/pipeline",
        });
      }
    }
    if (github && silent.on) {
      const hive = await readHive(now);
      if (!hive) {
        complete = false;
        down.push("silent");
      }
      const secs = Math.floor(now / 1000);
      const { feed } = hive ? await readStatusFeed() : { feed: null };
      // The rule's hours, plus a slot, so the last turn is in the buckets.
      const buckets = hive
        ? await recentBuckets(secs, silent.value + 1, source)
        : [];
      for (const q of hive ? quietAgents(hive, feed, github, buckets) : []) {
        // Only once it is due: an item that stayed would block the next one.
        if (secs - q.since < silent.value * 3600) continue;
        items.push({
          rule: "silent",
          key: silentKey(q.agent),
          title: `${q.agent} is silent while holding a claim`,
          detail: quietLine(q, secs),
          path: "/health",
          since: q.since * 1000,
        });
      }
    }
  }
  const { releases } = process.env.GITHUB_TOKEN
    ? await readReleases()
    : { releases: null };
  if (process.env.GITHUB_TOKEN && !releases) {
    complete = false;
    down.push("release");
  }
  for (const r of releases?.repos ?? []) {
    for (const run of r.waiting) {
      items.push({
        rule: "release",
        key: releaseKey(r.repo, run.id),
        title: `${r.repo.split("/")[1]} is waiting for release approval`,
        detail: `${run.workflow} run #${run.number}`,
        path: "/releases",
        // The rule's hours count from when the run started waiting, not
        // from when this pass first saw it (a restart would reset that).
        since: run.createdAt * 1000,
      });
    }
  }
  return { items, complete, down };
}

/** Logs which items appeared, got acked or cleared since the last pass (#88). */
async function recordCleared(
  items: Item[],
  down: RuleId[],
  mutes: Mutes,
  now: number,
) {
  try {
    const { appeared, cleared, acked } = diffLog(
      await openLogRows(),
      items,
      mutes,
      down,
    );
    await logAppeared(appeared, now);
    await logAcked(acked);
    await logCleared(cleared, now);
  } catch (err) {
    // The log is a nicety; it must never stop an alert going out.
    console.error(`Cleared log: ${err}`);
  }
}

/** One alerts pass: sends what is due and remembers what went out. */
export async function runAlerts(now = Date.now()) {
  // No database, no alerts and no log.
  if (!historyEnabled()) return;
  const config = await loadAlerts();
  const on = config.channels.some((c) => c.on);
  // The cleared log (#88) records every pass, channels or not.
  const { items, complete, down } = await currentItems(now, config);
  const before = await loadMutes();
  await recordCleared(items, down, before, now);
  // Acks still have to drop when their item clears, channels or not.
  if (!on && !Object.keys(before).length) return;
  // Prune under the key's lock, so a snooze saved meanwhile isn't overwritten.
  const mutes = await updateSetting(MUTE_KEY, (raw) =>
    liveMutes(toMutes(raw), complete ? items.map((i) => i.key) : null, now),
  );
  if (!on) return;
  const prev = AlertStateSchema.safeParse(await getSetting(STATE_KEY));
  const { due, state } = dueAlerts(
    config,
    prev.success ? prev.data : {},
    items,
    now,
    mutes,
  );
  for (const { item, channels } of due) {
    const sent = await Promise.allSettled(
      channels.map((c) => deliver(c, item)),
    );
    for (const r of sent) {
      if (r.status === "rejected") console.error(`Alert: ${r.reason}`);
    }
    // Retried next pass only if no channel took it.
    if (sent.some((r) => r.status === "fulfilled")) {
      state[item.key] = { ...state[item.key], sent: now };
    }
  }
  await setSetting(STATE_KEY, state);
}
