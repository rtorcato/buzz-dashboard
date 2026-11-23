// Agent config on the relay (#194): find an agent's config channel and read
// its current settings and instructions, as Buzz Desktop 1.0.6 does (NIP-AP,
// NIP-AR, NIP-CL). This runs in the owner's browser: every read is signed by
// the owner's sign-in, and the server's own read identity never joins a config
// channel. Nothing here signs; the caller passes a `query` that does.

export const ARTIFACT_KIND = 45010;
export const CHANNEL_METADATA_KIND = 39000;
export const SETTINGS_TYPE = "buzz.agent.settings";
export const INSTRUCTIONS_TYPE = "buzz.agent.instructions";
export type ArtifactType = typeof SETTINGS_TYPE | typeof INSTRUCTIONS_TYPE;

/** Discovery page size; an owner has one config channel per agent. */
export const DISCOVERY_LIMIT = 100;
/** Desktop's current-heads page: a full page decides nothing. */
export const CURRENT_LIMIT = 16;

const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type ConfigEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
};

/** One filter, in the shapes the relay's artifact and NIP-CL reads take. */
export type ConfigFilter = Record<string, unknown>;

/** Which relay endpoint a read goes to: events, or just their count. */
export type ConfigPath = "query" | "count";

/** Signs and sends one filter; resolves with the relay's JSON answer. */
export type ConfigQuery = (
  path: ConfigPath,
  filter: ConfigFilter,
) => Promise<unknown>;

const tagValues = (e: ConfigEvent, name: string) =>
  e.tags.flatMap(([k, v]) => (k === name && typeof v === "string" ? [v] : []));

/** The single value of a tag that appears once, else undefined. */
export function tagOf(e: ConfigEvent, name: string): string | undefined {
  const found = e.tags.filter((t) => t[0] === name);
  return found.length === 1 && found[0].length === 2 ? found[0][1] : undefined;
}

/** RFC 4122 UUIDv5 of `name` in `namespace` (Desktop's `uuidv5`). */
export async function uuidv5(namespace: string, name: string): Promise<string> {
  if (!UUID.test(namespace)) throw new Error("Invalid UUID namespace");
  const ns = Uint8Array.from(
    namespace.replace(/-/g, "").match(/../g) ?? [],
    (h) => Number.parseInt(h, 16),
  );
  const input = new Uint8Array([...ns, ...new TextEncoder().encode(name)]);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", input));
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = [...hash.slice(0, 16)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** An artifact's fixed `d`: UUIDv5 of its type in the channel's namespace. */
export const artifactD = (type: ArtifactType, channel: string) =>
  uuidv5(channel, type);

/** Config channels whose creator is `owner` and that carry `agent`'s label. */
export const discoveryFilter = (
  relaySelf: string,
  owner: string,
  agent: string,
): ConfigFilter => ({
  kinds: [CHANNEL_METADATA_KIND],
  authors: [relaySelf],
  "#P": [owner],
  // The family label never joins this `#t`: values in one filter OR.
  "#t": [agent],
  limit: DISCOVERY_LIMIT,
});

export const currentFilter = (channel: string): ConfigFilter => ({
  kinds: [ARTIFACT_KIND],
  "#h": [channel],
  artifact: "current",
  limit: CURRENT_LIMIT,
});

/** Every revision of one artifact, newest first; also the count's filter. */
export const historyFilter = (
  channel: string,
  d: string,
  page?: { limit: number; offset: number },
): ConfigFilter => ({
  kinds: [ARTIFACT_KIND],
  "#h": [channel],
  "#d": [d],
  artifact: "history",
  ...(page ?? {}),
});

/** Relay-written channel identity on kind 39000 (Desktop `channelIdentity`):
 * the first `t` is the type, later ones are labels, `P` the creator. */
function channelIdentity(e: ConfigEvent) {
  const [type, ...labels] = tagValues(e, "t");
  const created = tagOf(e, "created_at");
  return {
    id: tagOf(e, "d"),
    type,
    labels,
    creator: tagOf(e, "P"),
    createdAt:
      created !== undefined && /^(?:0|[1-9]\d{0,15})$/.test(created)
        ? Number(created)
        : undefined,
    archived: e.tags.some(([k, v]) => k === "archived" && v === "true"),
  };
}

export type ConfigChannel = { id: string; archived: boolean };

/**
 * The agent's selected config channel among discovery results, or null.
 * Only relay-signed `system` channels labelled `agent-config` and the agent's
 * pubkey, created by the owner, count. The oldest wins (NIP-CL "Choosing one
 * channel"): lowest `created_at`, then lowest id; no creation time ranks last.
 */
export function pickConfigChannel(
  events: ConfigEvent[],
  {
    relaySelf,
    owner,
    agent,
  }: { relaySelf: string; owner: string; agent: string },
): ConfigChannel | null {
  const found = events
    .filter((e) => e.kind === CHANNEL_METADATA_KIND && e.pubkey === relaySelf)
    .map(channelIdentity)
    .filter(
      (c) =>
        typeof c.id === "string" &&
        UUID.test(c.id) &&
        c.type === "system" &&
        c.creator === owner &&
        c.labels.includes("agent-config") &&
        c.labels.includes(agent),
    )
    .sort((a, b) => {
      if (a.createdAt !== b.createdAt) {
        if (a.createdAt === undefined) return 1;
        if (b.createdAt === undefined) return -1;
        return a.createdAt - b.createdAt;
      }
      return (a.id as string) < (b.id as string) ? -1 : 1;
    });
  const [oldest] = found;
  return oldest ? { id: oldest.id as string, archived: oldest.archived } : null;
}

/** Why a revision isn't a valid head for its channel and type, or null
 * (Desktop `artifactProblem`, for the two agent types). */
export function artifactProblem(
  e: ConfigEvent,
  expected: { channel: string; type: ArtifactType; d: string },
): string | null {
  if (e.kind !== ARTIFACT_KIND) return "Not an artifact";
  if (tagOf(e, "ar") !== "1") return "Unsupported artifact envelope";
  if (tagOf(e, "d") !== expected.d) return "Artifact identity mismatch";
  if (tagOf(e, "h") !== expected.channel) return "Artifact home mismatch";
  if (tagOf(e, "type") !== expected.type) return "Artifact type mismatch";
  const op = tagOf(e, "op");
  if (op === "delete") return e.content === "" ? null : "Malformed deletion";
  if (!["create", "update", "restore", "move"].includes(op ?? ""))
    return "Unknown artifact operation";
  let body: unknown;
  try {
    body = JSON.parse(e.content);
  } catch {
    return "Artifact content is not JSON";
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return "Artifact content is not an object";
  const value = body as Record<string, unknown>;
  if (value.version !== 1) return "Unknown artifact version";
  if (expected.type === INSTRUCTIONS_TYPE)
    return typeof value.text === "string" ? null : "Instructions text missing";
  return value.settings &&
    typeof value.settings === "object" &&
    !Array.isArray(value.settings)
    ? null
    : "Settings missing";
}

/** The settings a goose agent syncs (Desktop 1.0.6 `goose/settings.ts`). */
export type AgentSettingsValues = {
  agentType: string | null;
  model: string | null;
  provider: string | null;
  effort: string | null;
  scope: string | null;
};

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export function readSettings(e: ConfigEvent): AgentSettingsValues {
  const body = JSON.parse(e.content) as {
    agentType?: unknown;
    settings: Record<string, unknown>;
  };
  return {
    agentType: str(body.agentType),
    model: str(body.settings.model),
    provider: str(body.settings.provider),
    effort: str(body.settings.effort),
    scope: str(body.settings.scope),
  };
}

export const readInstructions = (e: ConfigEvent) =>
  (JSON.parse(e.content) as { text: string }).text;

const isEvent = (v: unknown): v is ConfigEvent => {
  const e = v as ConfigEvent;
  return (
    !!e &&
    typeof e === "object" &&
    typeof e.id === "string" &&
    HEX64.test(e.pubkey ?? "") &&
    Number.isInteger(e.created_at) &&
    Number.isInteger(e.kind) &&
    Array.isArray(e.tags) &&
    e.tags.every(
      (t) => Array.isArray(t) && t.every((x) => typeof x === "string"),
    ) &&
    typeof e.content === "string"
  );
};

/** The well-formed events in a relay answer; throws if it isn't a list. */
export const configEvents = (answer: unknown): ConfigEvent[] => {
  if (!Array.isArray(answer)) throw new ConfigReadError("unreadable");
  return answer.filter(isEvent);
};

export type ConfigReadReason =
  /** No config channel: the agent isn't on relay config yet. */
  | "no-channel"
  /** The channel is archived: Desktop won't start from it. */
  | "archived"
  /** The relay's answer couldn't decide the heads. */
  | "unreadable";

export class ConfigReadError extends Error {
  constructor(readonly reason: ConfigReadReason) {
    super(reason);
  }
}

export type Head<T> =
  | { state: "ok"; event: ConfigEvent; value: T }
  | { state: "deleted"; event: ConfigEvent }
  | { state: "invalid"; event: ConfigEvent; problem: string }
  | { state: "missing" };

export type AgentConfig = {
  channel: string;
  settings: Head<AgentSettingsValues>;
  instructions: Head<string>;
  /** How many settings revisions the relay holds; null if it didn't say. */
  revision: number | null;
  /** The newest head's `created_at`, unix seconds; null with no heads. */
  updatedAt: number | null;
};

function head<T>(
  heads: Map<string, ConfigEvent>,
  expected: { channel: string; type: ArtifactType; d: string },
  read: (e: ConfigEvent) => T,
): Head<T> {
  const event = heads.get(expected.d);
  if (!event) return { state: "missing" };
  if (tagOf(event, "op") === "delete") return { state: "deleted", event };
  const problem = artifactProblem(event, expected);
  if (problem) return { state: "invalid", event, problem };
  return { state: "ok", event, value: read(event) };
}

/**
 * Reads `agent`'s config: discovery, then the channel's current heads, then
 * the settings revision count. Three signed reads. Throws ConfigReadError
 * with a reason the card can show, or the query's own error.
 */
export async function readAgentConfig(
  query: ConfigQuery,
  ids: { relaySelf: string; owner: string; agent: string },
): Promise<AgentConfig> {
  if (![ids.relaySelf, ids.owner, ids.agent].every((k) => HEX64.test(k)))
    throw new ConfigReadError("unreadable");
  const channel = pickConfigChannel(
    configEvents(
      await query(
        "query",
        discoveryFilter(ids.relaySelf, ids.owner, ids.agent),
      ),
    ),
    ids,
  );
  if (!channel) throw new ConfigReadError("no-channel");
  if (channel.archived) throw new ConfigReadError("archived");

  const [settingsD, instructionsD] = await Promise.all([
    artifactD(SETTINGS_TYPE, channel.id),
    artifactD(INSTRUCTIONS_TYPE, channel.id),
  ]);
  const current = configEvents(await query("query", currentFilter(channel.id)));
  // A full page may be truncated, and two heads for one `d` decide nothing.
  if (current.length >= CURRENT_LIMIT) throw new ConfigReadError("unreadable");
  const heads = new Map<string, ConfigEvent>();
  for (const e of current) {
    const d = tagOf(e, "d");
    if (!d || heads.has(d)) throw new ConfigReadError("unreadable");
    heads.set(d, e);
  }
  const settings = head(
    heads,
    { channel: channel.id, type: SETTINGS_TYPE, d: settingsD },
    readSettings,
  );
  const instructions = head(
    heads,
    { channel: channel.id, type: INSTRUCTIONS_TYPE, d: instructionsD },
    readInstructions,
  );

  let revision: number | null = null;
  if (settings.state !== "missing") {
    const counted = (await query(
      "count",
      historyFilter(channel.id, settingsD),
    ).catch(() => null)) as { count?: unknown } | null;
    const n = counted?.count;
    revision =
      typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  const times = [settings, instructions].flatMap((h) =>
    h.state === "missing" ? [] : [h.event.created_at],
  );
  return {
    channel: channel.id,
    settings,
    instructions,
    revision,
    updatedAt: times.length ? Math.max(...times) : null,
  };
}

/** "just now", "5m ago", "3h ago", "2d ago". */
export const agoText = (s: number) => {
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

/** The card's source line: "From the relay config · revision 14 · 2d ago". */
export function configSource(config: AgentConfig, now: number): string {
  const parts = ["From the relay config"];
  if (config.revision !== null) parts.push(`revision ${config.revision}`);
  if (config.updatedAt !== null)
    parts.push(agoText(Math.max(0, now - config.updatedAt)));
  return parts.join(" · ");
}

/** Why the settings head can't be shown, in words for the card, or null. */
export function settingsProblem(config: AgentConfig): string | null {
  const s = config.settings;
  if (s.state === "deleted")
    return "The settings were deleted. Restore them from History in Buzz Desktop.";
  if (s.state === "invalid") return `Settings can't be used: ${s.problem}.`;
  if (s.state === "missing") return "No settings revision yet.";
  return null;
}

/** The card's words for a read that failed. */
export function readFailure(err: unknown): string {
  if (err instanceof ConfigReadError) {
    return {
      "no-channel": "This agent has no relay config channel yet.",
      archived: "This agent's config channel is archived.",
      unreadable: "Couldn't read the relay config.",
    }[err.reason];
  }
  return err instanceof Error && err.message
    ? err.message
    : "Couldn't read the relay config.";
}
