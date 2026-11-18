import { z } from "zod";

// Alerts (#45): where they go and what they fire on. Owner-only state in the
// history store. Every alert is a Needs you item the owner hasn't cleared yet,
// so the rules read the same rows the card shows.

export const CHANNEL_TYPES = ["ntfy", "slack", "webhook", "buzz"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const RULE_IDS = [
  "failing",
  "silent",
  "release",
  "blocked",
  "merge",
  "budget",
] as const;
export type RuleId = (typeof RULE_IDS)[number];

type RuleMeta = {
  name: string;
  /** The rule's knob, if it has one: hours to wait, or dollars a day. */
  knob: "hours" | "usd" | null;
  /** The knob's default. */
  value: number;
  when: (value: number) => string;
  /** Minutes between repeats while the item stays, or null for once. */
  repeatMin: number | null;
  repeat: string;
  /**
   * False until Needs you reads the item, so the rule can't fire yet.
   * ponytail: flip each one as its row lands (ai-blocked issues, release
   * approvals, silent claims, cost over budget).
   */
  watched: boolean;
};

// DESIGN.md → Settings tabs and Alerts, "Default rules".
export const RULES: Record<RuleId, RuleMeta> = {
  failing: {
    name: "Agent failing turns",
    knob: null,
    value: 0,
    when: () => "Over 25% errors for 15 min",
    repeatMin: 60,
    repeat: "Hourly until stopped",
    watched: true,
  },
  silent: {
    name: "Silent while holding a claim",
    knob: "hours",
    value: 4,
    when: (h) => `No turn for ${h}h`,
    repeatMin: null,
    repeat: "Once",
    watched: false,
  },
  release: {
    name: "Release waiting for approval",
    knob: "hours",
    value: 1,
    when: (h) => `After ${h}h`,
    repeatMin: 240,
    repeat: "Every 4h until stopped",
    watched: false,
  },
  blocked: {
    name: "Issue blocked",
    knob: null,
    value: 0,
    when: () => "Right away",
    repeatMin: null,
    repeat: "Once",
    watched: false,
  },
  merge: {
    name: "PR ready to merge",
    knob: "hours",
    value: 2,
    when: (h) => `After ${h}h`,
    repeatMin: null,
    repeat: "Once",
    watched: true,
  },
  budget: {
    name: "Agent over budget",
    knob: "usd",
    value: 40,
    when: (usd) => `An agent goes over $${usd} today`,
    repeatMin: 24 * 60,
    repeat: "Once a day",
    watched: false,
  },
};

/** A Buzz DM channel has no URL: it always goes to the owner (#83). */
export const BUZZ_TARGET = "buzz-dm";

export const ChannelSchema = z.object({
  id: z.string(),
  type: z.enum(CHANNEL_TYPES),
  /** The URL. A secret: encrypted at rest, only ever shown elided. */
  target: z.string(),
  on: z.boolean(),
});
export type Channel = z.infer<typeof ChannelSchema>;

export const RuleSchema = z.object({
  on: z.boolean(),
  /** Channel ids. */
  channels: z.array(z.string()),
  value: z.number().nonnegative().max(100_000),
});
export type Rule = z.infer<typeof RuleSchema>;

export const AlertConfigSchema = z.object({
  channels: z.array(ChannelSchema),
  rules: z.partialRecord(z.enum(RULE_IDS), RuleSchema),
  /** Quiet hours, 10 PM to 8 AM server time (TZ): only failing agents get through. */
  quiet: z.boolean(),
});
export type AlertConfig = z.infer<typeof AlertConfigSchema>;

export const EMPTY_CONFIG: AlertConfig = {
  channels: [],
  rules: {},
  quiet: false,
};

/** A rule's settings, or its default: on, to every channel. */
export function ruleOf(config: AlertConfig, id: RuleId): Rule {
  return (
    config.rules[id] ?? {
      on: true,
      channels: config.channels.map((c) => c.id),
      value: RULES[id].value,
    }
  );
}

/**
 * A channel URL that is safe to fetch: http(s), no user:password (fetch
 * refuses those) and not absurdly long. Null when it isn't.
 */
export function channelUrl(raw: string): URL | null {
  if (raw.length > 2000) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/** The host and the first two characters of each path segment. */
export function elide(raw: string): string {
  const url = channelUrl(raw);
  if (!url) return "invalid URL";
  const path = url.pathname
    .split("/")
    .filter(Boolean)
    .map((s) => (s.length > 2 ? `${s.slice(0, 2)}…` : s));
  return [`${url.protocol}//${url.host}`, ...path].join("/");
}

/**
 * The channel URL as the Alerts tab shows it. Read-only views are public, so
 * a signed-out viewer gets no part of it: not the host, not a path prefix (#85).
 */
export const shownTarget = (raw: string, signedIn: boolean) =>
  raw === BUZZ_TARGET
    ? "A direct message to the owner"
    : signedIn
      ? elide(raw)
      : "Hidden until you sign in";

/** Quiet hours run 10 PM to 8 AM on the server clock. */
export const isQuietHour = (d: Date) => d.getHours() >= 22 || d.getHours() < 8;

/** Something Needs you shows that a rule may alert on. */
export type Item = {
  rule: RuleId;
  /** Stable while the item stays, e.g. "failing:Gale". */
  key: string;
  title: string;
  detail: string;
  /** The dashboard view it links to, e.g. "/health". */
  path: string;
};

/** Per item key: when it first showed (ms) and when it last went out, if ever. */
export type AlertState = Record<string, { first: number; sent: number | null }>;

export const AlertStateSchema = z.record(
  z.string(),
  z.object({ first: z.number(), sent: z.number().nullable() }),
);

/**
 * Snooze and ack (#46), per item key: alerts stop until `until` (ms), or
 * until the item clears when it's null. A new item, e.g. one more merge-ready
 * PR, has its own key, so it still alerts: that is "it gets worse".
 */
export type Mutes = Record<string, { until: number | null }>;

export const MutesSchema = z.record(
  z.string(),
  z.object({ until: z.number().nullable() }),
);

/** The longest snooze the menu offers is "until tomorrow". */
export const MAX_SNOOZE_MS = 48 * 3_600_000;

export const isMuted = (mutes: Mutes, key: string, now: number) => {
  const m = mutes[key];
  return m !== undefined && (m.until === null || m.until > now);
};

/**
 * The mutes still in force: the snooze hasn't run out and the item is still
 * in `keys`. Null `keys` (a source didn't answer) keeps every unexpired one,
 * so an outage doesn't wipe the acks.
 */
export function liveMutes(
  mutes: Mutes,
  keys: string[] | null,
  now: number,
): Mutes {
  const current = keys && new Set(keys);
  const live: Mutes = {};
  for (const [key, m] of Object.entries(mutes)) {
    if (isMuted(mutes, key, now) && (!current || current.has(key))) {
      live[key] = m;
    }
  }
  return live;
}

/**
 * A Needs you row's snooze: set only when every item in it is muted. It runs
 * until the first of them comes back; null `until` means all are acked.
 */
export function rowMute(
  keys: string[],
  mutes: Mutes,
  now: number,
): { until: number | null } | null {
  if (!keys.length || !keys.every((k) => isMuted(mutes, k, now))) return null;
  const untils = keys.flatMap((k) => mutes[k].until ?? []);
  return { until: untils.length ? Math.min(...untils) : null };
}

/**
 * The items due to go out now, and the state with every current item in it.
 * An item that cleared drops out, so it starts over if it comes back. The
 * caller marks `sent` on the items it delivered.
 */
export function dueAlerts(
  config: AlertConfig,
  prev: AlertState,
  items: Item[],
  now: number,
  mutes: Mutes = {},
): { due: { item: Item; channels: Channel[] }[]; state: AlertState } {
  const state: AlertState = {};
  const due: { item: Item; channels: Channel[] }[] = [];
  const quiet = config.quiet && isQuietHour(new Date(now));
  for (const item of items) {
    const s = prev[item.key] ?? { first: now, sent: null };
    state[item.key] = s;
    const meta = RULES[item.rule];
    const rule = ruleOf(config, item.rule);
    if (!rule.on || isMuted(mutes, item.key, now)) continue;
    const waitMs = meta.knob === "hours" ? rule.value * 3_600_000 : 0;
    if (now - s.first < waitMs) continue;
    if (s.sent !== null) {
      if (meta.repeatMin === null) continue;
      if (now - s.sent < meta.repeatMin * 60_000) continue;
    }
    if (quiet && item.rule !== "failing") continue;
    const channels = config.channels.filter(
      (c) => c.on && rule.channels.includes(c.id),
    );
    if (channels.length) due.push({ item, channels });
  }
  return { due, state };
}

/** The request that delivers `alert` to a channel of `type` at `url`. */
export function alertRequest(
  type: ChannelType,
  url: URL,
  alert: {
    rule: RuleId | "test";
    title: string;
    detail: string;
    link: string | null;
  },
): { url: string; body: string } {
  if (type === "ntfy") {
    // JSON publishing goes to the server root with the topic in the body, so
    // non-ASCII titles don't have to fit in a header.
    const parts = url.pathname.split("/").filter(Boolean);
    const topic = parts.pop() ?? "";
    const root = new URL(url.origin);
    root.pathname = parts.length ? `/${parts.join("/")}/` : "/";
    return {
      url: root.toString(),
      body: JSON.stringify({
        topic,
        title: alert.title,
        message: alert.detail,
        tags: ["bell"],
        ...(alert.link && { click: alert.link }),
      }),
    };
  }
  if (type === "slack") {
    const text = [
      `*${alert.title}*`,
      alert.detail,
      alert.link && `<${alert.link}|Open the dashboard>`,
    ]
      .filter(Boolean)
      .join("\n");
    return { url: url.toString(), body: JSON.stringify({ text }) };
  }
  return {
    url: url.toString(),
    body: JSON.stringify({
      alert: alert.rule,
      title: alert.title,
      detail: alert.detail,
      url: alert.link,
    }),
  };
}
