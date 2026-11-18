// Health rules (DESIGN.md → Health, #44). Pure, so the page and Needs you
// share them and tests need no database. Times are unix seconds.

export const HEALTH_RANGES = { "1h": 1, "24h": 24, "7d": 168 } as const;
export type HealthRange = keyof typeof HEALTH_RANGES;
export const DEFAULT_HEALTH_RANGE: HealthRange = "24h";

/**
 * Where error rates come from: the owner signer's per-turn reports (NIP-AM
 * stopReason) or OpenTelemetry's api_request and api_error log events. With
 * OTel the rate is per API request, never per turn.
 */
export type HealthSource = "signer" | "otel";
export const SOURCE_KINDS: Record<HealthSource, string[]> = {
  signer: ["turn"],
  otel: ["request", "error"],
};

/** Stored events counted per agent, 15-minute slot, kind and reason. */
export type HealthBucket = {
  agent: string;
  /** Slot start. */
  slot: number;
  kind: string;
  reason: string | null;
  count: number;
  /** The newest event in the bucket. */
  last: number;
};

export const SLOT_S = 900;
/** Failing: more than 25% errors over the last 15 minutes (the alert rule). */
export const FAIL_RATE = 0.25;
const FAIL_WINDOW_S = 15 * 60;
// ponytail: a floor so one failed request in a quiet quarter hour isn't
// "failing". Make it a setting if the alert rules (#45) need another.
const FAIL_MIN = 3;
/** Silent: no turn for this long while holding a claim. */
export const SILENT_AFTER_S = 4 * 3600;
const ONLINE_WITHIN_S = 15 * 60;
const IDLE_AFTER_S = 3600;

export type Counts = {
  /** Turns (signer) or API requests, failed ones included (OTel). */
  attempts: number;
  errors: number;
  /** Signer only; always 0 with OTel. */
  cancelled: number;
  maxTokens: number;
};

const zero = (): Counts => ({
  attempts: 0,
  errors: 0,
  cancelled: 0,
  maxTokens: 0,
});

function add(c: Counts, b: HealthBucket) {
  c.attempts += b.count;
  if (b.kind === "error" || b.reason === "error") c.errors += b.count;
  if (b.reason === "cancelled") c.cancelled += b.count;
  if (b.reason === "max_tokens") c.maxTokens += b.count;
}

function entry<K>(m: Map<K, Counts>, k: K): Counts {
  let c = m.get(k);
  if (!c) {
    c = zero();
    m.set(k, c);
  }
  return c;
}

/** Counts per agent over buckets from `from` on. */
export function tally(
  buckets: HealthBucket[],
  from: number,
): Map<string, Counts> {
  const out = new Map<string, Counts>();
  for (const b of buckets) {
    if (b.slot + SLOT_S > from) add(entry(out, b.agent), b);
  }
  return out;
}

export const rate = (c: Counts | undefined, n: keyof Counts = "errors") =>
  c?.attempts ? c[n] / c.attempts : null;

const isFailing = (c: Counts | undefined) =>
  c !== undefined &&
  c.attempts >= FAIL_MIN &&
  c.errors / c.attempts > FAIL_RATE;

/**
 * Since when the agent has been failing: the start of the run of 15-minute
 * slots with errors that reaches the newest one.
 */
function failingSince(buckets: HealthBucket[], agent: string): number | null {
  const slots = new Map<number, Counts>();
  for (const b of buckets) {
    if (b.agent === agent) add(entry(slots, b.slot), b);
  }
  let since: number | null = null;
  for (const s of [...slots.keys()].sort((a, b) => b - a)) {
    if (!slots.get(s)?.errors) break;
    since = s;
  }
  return since;
}

export type FailingAgent = {
  agent: string;
  /** The last hour. */
  hour: Counts;
  since: number;
};

/** Agents over the failing threshold right now, worst first. */
export function failingAgents(
  buckets: HealthBucket[],
  now: number,
): FailingAgent[] {
  const window = tally(buckets, now - FAIL_WINDOW_S);
  const hour = tally(buckets, now - 3600);
  return [...window]
    .filter(([, c]) => isFailing(c))
    .map(([agent]) => ({
      agent,
      hour: hour.get(agent) ?? zero(),
      since: failingSince(buckets, agent) ?? now - FAIL_WINDOW_S,
    }))
    .sort((a, b) => (rate(b.hour) ?? 0) - (rate(a.hour) ?? 0));
}

export type HealthStatus = "failing" | "silent" | "healthy" | "idle";
const ORDER: HealthStatus[] = ["failing", "silent", "healthy", "idle"];

export type HealthInput = {
  agents: {
    name: string;
    lastSeenAt: number | null;
    /** From the status feed, when it reports the agent. */
    runtime?: {
      state: "running" | "stopped" | "unknown";
      lastTurn: number | null;
    };
  }[];
  /** Open claims with a known agent, e.g. "example-cli#124". */
  claims: { agent: string; key: string; claimedAt: number }[];
  /** Empty without a cost source. */
  buckets: HealthBucket[];
  now: number;
  /** The table's range in hours. */
  rangeH: number;
};

export type AgentHealth = {
  name: string;
  status: HealthStatus;
  online: boolean;
  range: Counts;
  hour: Counts;
  /** Finished and error attempts per hour, the last 24 hours, oldest first. */
  hourly: { ok: number; errors: number }[];
  /** The newest sign of a turn: the feed, a stored event or a message. */
  lastTurn: number | null;
  /** The oldest open claim, and how many more. */
  claim: { key: string; claimedAt: number; more: number } | null;
  /** Seconds silent while holding a claim, or null when not silent. */
  silentFor: number | null;
  failingSince: number | null;
};

/** The newest sign of a turn: the feed, a stored event or a message. */
const lastTurnOf = (a: HealthInput["agents"][number], mine: HealthBucket[]) =>
  Math.max(
    a.runtime?.lastTurn ?? 0,
    a.lastSeenAt ?? 0,
    ...mine.map((b) => b.last),
  ) || null;

/** The agent's open claims, oldest first. */
const claimsOf = (claims: HealthInput["claims"], agent: string) =>
  claims
    .filter((c) => c.agent === agent)
    .sort((x, y) => x.claimedAt - y.claimedAt);

// Claiming is itself a turn, so silence counts from the later of the two.
const quietStart = (lastTurn: number | null, claims: HealthInput["claims"]) =>
  Math.max(lastTurn ?? 0, claims.at(-1)?.claimedAt ?? 0);

/** An agent holding a claim, and since when it has done nothing. */
export type QuietClaim = {
  agent: string;
  /** Unix seconds of its last turn or newest claim, whichever is later. */
  since: number;
  /** The oldest open claim, e.g. "example-cli#124", and how many more. */
  key: string;
  more: number;
};

/**
 * Every agent holding a claim, with when it went quiet, quietest first. The
 * same silence as Health's, so Needs you and the Silent alert agree with it.
 */
export function quietClaims(
  input: Pick<HealthInput, "agents" | "claims" | "buckets">,
): QuietClaim[] {
  return input.agents
    .flatMap((a): QuietClaim[] => {
      const claims = claimsOf(input.claims, a.name);
      if (!claims.length) return [];
      const mine = input.buckets.filter((b) => b.agent === a.name);
      return [
        {
          agent: a.name,
          since: quietStart(lastTurnOf(a, mine), claims),
          key: claims[0].key,
          more: claims.length - 1,
        },
      ];
    })
    .sort((x, y) => x.since - y.since);
}

/** Every agent's health, sorted failing, silent, healthy, idle. */
export function buildHealth(input: HealthInput): AgentHealth[] {
  const { now, buckets } = input;
  const range = tally(buckets, now - input.rangeH * 3600);
  const hour = tally(buckets, now - 3600);
  const failing = new Map(failingAgents(buckets, now).map((f) => [f.agent, f]));
  const firstHour = Math.floor(now / 3600) * 3600 - 23 * 3600;
  const out = input.agents.map((a): AgentHealth => {
    const mine = buckets.filter((b) => b.agent === a.name);
    const hourly = Array.from({ length: 24 }, () => ({ ok: 0, errors: 0 }));
    for (const b of mine) {
      const i = Math.floor((b.slot - firstHour) / 3600);
      if (i < 0 || i > 23) continue;
      const c = zero();
      add(c, b);
      hourly[i].ok += c.attempts - c.errors;
      hourly[i].errors += c.errors;
    }
    const lastTurn = lastTurnOf(a, mine);
    const claims = claimsOf(input.claims, a.name);
    const claim = claims[0]
      ? {
          key: claims[0].key,
          claimedAt: claims[0].claimedAt,
          more: claims.length - 1,
        }
      : null;
    const quietFor = now - (lastTurn ?? 0);
    const silentFor = claim ? now - quietStart(lastTurn, claims) : 0;
    const f = failing.get(a.name);
    const h = hour.get(a.name) ?? zero();
    const status: HealthStatus = f
      ? "failing"
      : silentFor > SILENT_AFTER_S
        ? "silent"
        : !claim && !h.attempts && quietFor > IDLE_AFTER_S
          ? "idle"
          : "healthy";
    return {
      name: a.name,
      status,
      online:
        a.runtime && a.runtime.state !== "unknown"
          ? a.runtime.state === "running"
          : quietFor <= ONLINE_WITHIN_S,
      range: range.get(a.name) ?? zero(),
      hour: h,
      hourly,
      lastTurn,
      claim,
      silentFor: silentFor > SILENT_AFTER_S ? silentFor : null,
      failingSince: f?.since ?? null,
    };
  });
  return out.sort(
    (a, b) =>
      ORDER.indexOf(a.status) - ORDER.indexOf(b.status) ||
      (rate(b.hour) ?? 0) - (rate(a.hour) ?? 0) ||
      (b.silentFor ?? 0) - (a.silentFor ?? 0) ||
      b.hour.attempts - a.hour.attempts ||
      a.name.localeCompare(b.name),
  );
}
