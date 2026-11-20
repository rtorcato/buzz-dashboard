import type { Agent } from "./hive";
import type { Runtime } from "./status-feed";

// Agents tab rules (DESIGN.md → Views → Agents). Times are unix seconds.
const ACTIVE_WITHIN_S = 15 * 60;
const QUIET_AFTER_S = 2 * 3600;

export type AgentStatus = "stopped" | "active" | "idle" | "quiet" | "elsewhere";

/** Unreadable channel names by agent name: where an agent may be working unseen. */
export type Elsewhere = Record<string, string[]>;

/** Runtime per agent name; a name with no entry is not reported. */
export type Runtimes = Record<string, Runtime>;

/** The agent's entry across its identities: a running one, else the newest. */
export function runtimeFor(
  agent: Agent,
  feed: Record<string, Runtime>,
): Runtime | undefined {
  return agent.pubkeys
    .map((k) => feed[k])
    .filter((r) => r !== undefined)
    .sort(
      (a, b) =>
        Number(b.state === "running") - Number(a.state === "running") ||
        b.since - a.since,
    )[0];
}

// One badge, ranked Stopped > Quiet > Active > Idle (DESIGN.md → Runtime status).
// ponytail: quiet is time-only, and every stopped agent counts as parked. The
// "Stalled" state (stopped while holding claims) needs ai-wip data, which
// arrives with the GitHub reader.
export function agentStatus(
  agent: Agent,
  now: number,
  runtime?: Runtime,
  quietAfterS = QUIET_AFTER_S,
  unreadable: string[] = [],
): AgentStatus {
  if (runtime?.state === "stopped") return "stopped";
  const since = now - (agent.lastSeenAt ?? 0);
  if (since <= ACTIVE_WITHIN_S) return "active";
  if (since <= quietAfterS) return "idle";
  // No readable message for a while. If the runtime says the agent is working
  // and it belongs to a channel the dashboard can't read, say so rather than
  // call it Quiet (#168). Without runtime evidence it stays Quiet.
  const working =
    runtime?.state === "running" ||
    (runtime?.lastTurn != null && now - runtime.lastTurn <= quietAfterS);
  return unreadable.length > 0 && working ? "elsewhere" : "quiet";
}

/** URL segment for an agent: "Optimus Prime" → "optimus-prime". */
export const agentSlug = (name: string) =>
  name.trim().toLowerCase().replace(/\s+/g, "-");

/**
 * The view-transition-name shared by an Agents card and the agent page, so the
 * avatar and name morph into the hero (DESIGN.md → Motion). Names must be CSS
 * idents, so anything outside [a-z0-9-] becomes "_".
 */
export const morphName = (part: "avatar" | "name", slug: string) =>
  `agent-${part}-${slug.replace(/[^a-z0-9-]/g, "_")}`;

/** The agent at `/agents/<slug>`, a redirect for a former name, or null (404). */
export function findAgent(
  agents: Agent[],
  slug: string,
): { agent: Agent } | { redirect: string } | null {
  const agent = agents.find((a) => agentSlug(a.name) === slug);
  if (agent) return { agent };
  const renamed = agents.find((a) =>
    a.formerNames.some((n) => agentSlug(n) === slug),
  );
  return renamed ? { redirect: agentSlug(renamed.name) } : null;
}

export const SORTS = {
  attention: "needs attention",
  recent: "last seen",
  name: "name",
} as const;
export type Sort = keyof typeof SORTS;

const seen = (a: Agent) => a.lastSeenAt ?? 0;

export function sortAgents(
  agents: Agent[],
  sort: Sort,
  now: number,
  runtimes: Runtimes = {},
  quietAfterS = QUIET_AFTER_S,
  elsewhere: Elsewhere = {},
): Agent[] {
  if (sort === "name") {
    return agents.toSorted((a, b) => a.name.localeCompare(b.name));
  }
  if (sort === "recent") return agents.toSorted((a, b) => seen(b) - seen(a));
  // Needs attention: quiet agents first, longest quiet first, then the rest
  // most recent first, and parked (stopped) agents last.
  const rank = (a: Agent) =>
    ({ quiet: 0, elsewhere: 1, active: 1, idle: 1, stopped: 2 })[
      agentStatus(a, now, runtimes[a.name], quietAfterS, elsewhere[a.name])
    ];
  return agents.toSorted((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return ra === 0 ? seen(a) - seen(b) : seen(b) - seen(a);
  });
}

export function agentStats(
  agents: Agent[],
  now: number,
  runtimes: Runtimes = {},
  quietAfterS = QUIET_AFTER_S,
  elsewhere: Elsewhere = {},
) {
  const status = (a: Agent) =>
    agentStatus(a, now, runtimes[a.name], quietAfterS, elsewhere[a.name]);
  const quiet = sortAgents(
    agents,
    "attention",
    now,
    runtimes,
    quietAfterS,
    elsewhere,
  ).filter((a) => status(a) === "quiet");
  const today = agents.reduce((n, a) => n + a.messagesToday, 0);
  // The six full days before today.
  const before =
    agents.reduce(
      (n, a) => n + a.daily.slice(0, -1).reduce((s, d) => s + d, 0),
      0,
    ) / 6;
  return {
    running: agents.filter((a) => runtimes[a.name]?.state === "running").length,
    stopped: agents
      .filter((a) => runtimes[a.name]?.state === "stopped")
      .map((a) => a.name),
    active: agents.filter((a) => status(a) === "active").length,
    quiet: quiet.map((a) => a.name),
    today,
    // Percent vs the 7-day average, or null with no history to compare.
    vsAverage: before ? Math.round((today / before - 1) * 100) : null,
  };
}

export type DayGroup = {
  label: string;
  items: { id: string; time: string; channel: string | null; text: string }[];
};

// Day labels and times use the server's timezone, like the hive's day buckets.
export function byDay(a: Agent, now: number): DayGroup[] {
  const key = (s: number) => new Date(s * 1000).toDateString();
  const today = key(now);
  const yesterday = key(now - 86_400);
  const groups: DayGroup[] = [];
  for (const m of a.messages) {
    const k = key(m.at);
    const label =
      k === today
        ? "Today"
        : k === yesterday
          ? "Yesterday"
          : new Date(m.at * 1000).toLocaleDateString("en-US", {
              weekday: "short",
              day: "numeric",
              month: "short",
            });
    if (groups.at(-1)?.label !== label) groups.push({ label, items: [] });
    groups[groups.length - 1].items.push({
      id: m.id,
      time: new Date(m.at * 1000).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      }),
      channel: m.channel,
      text: m.text,
    });
  }
  return groups;
}
