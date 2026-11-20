import "server-only";

import { buildHive } from "./hive";
import { type NostrEvent, queryRelay } from "./relay";

// Step 3 of the setup wizard (#73): three checks against the relay, in order.
// A failed check skips the ones after it. The relay's own words are returned
// so the wizard can show them.

export type CheckState = "ok" | "failed" | "skipped";
export type RelayCheck = {
  id: "reach" | "login" | "agents";
  state: CheckState;
  title: string;
  /** Muted right-hand detail, or the plain-words fix when failed. */
  detail?: string;
  /** The relay's own reply, shown in mono. */
  relaySaid?: string;
};
export type RelayCheckResult = {
  ok: boolean;
  checks: RelayCheck[];
  agents: string[];
  channels: number;
};

export function validRelayUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "wss:" || u.protocol === "ws:";
  } catch {
    return false;
  }
}

const skipped = (checks: RelayCheck[]): RelayCheck[] => {
  const all: RelayCheck[] = [
    { id: "reach", state: "skipped", title: "Reached the relay" },
    { id: "login", state: "skipped", title: "Logged in" },
    { id: "agents", state: "skipped", title: "Found agents" },
  ];
  return all.map((c) => checks.find((k) => k.id === c.id) ?? c);
};

export async function checkRelay(
  input: { url: string; privateKey: string; authTag: string; owner: string },
  query: typeof queryRelay = queryRelay,
  now = Date.now,
): Promise<RelayCheckResult> {
  const fail = (check: RelayCheck): RelayCheckResult => ({
    ok: false,
    checks: skipped([check]),
    agents: [],
    channels: 0,
  });
  if (!validRelayUrl(input.url)) {
    return fail({
      id: "reach",
      state: "failed",
      title: "That isn’t a relay address",
      detail: "Use a wss:// address, for example wss://relay.example.com.",
    });
  }
  const started = now();
  let events: NostrEvent[];
  try {
    events = await query(
      {
        buzzRelayUrl: input.url,
        buzzPrivateKey: input.privateKey,
        buzzAuthTag: input.authTag,
      },
      [{ kinds: [0] }, { kinds: [39000] }],
      10_000,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const refused = /refused auth: ?(.*)$/.exec(message);
    if (refused) {
      return fail({
        id: "login",
        state: "failed",
        title: "The relay refused the login",
        detail:
          "The account that signed the attestation isn’t a member of this community. Sign with a member account, or add the dashboard’s key as a member in Buzz.",
        relaySaid: refused[1] || undefined,
      });
    }
    if (/closed the (query|connection)/.test(message)) {
      return fail({
        id: "login",
        state: "failed",
        title: "The relay closed the connection",
        detail: "It hung up before answering the dashboard’s login.",
        relaySaid: message.replace(/^Buzz relay /, ""),
      });
    }
    return fail({
      id: "reach",
      state: "failed",
      title: "Couldn’t reach the relay",
      detail: "Check the address and that the relay is online.",
    });
  }
  const ms = now() - started;
  const hive = buildHive(events, new Date(now()), input.owner);
  const agents = hive.agents.map((a) => a.name);
  const channels = Object.keys(hive.channels).length;
  return {
    ok: true,
    agents,
    channels,
    checks: [
      {
        id: "reach",
        state: "ok",
        title: "Reached the relay",
        detail: `${ms} ms`,
      },
      { id: "login", state: "ok", title: "Logged in", detail: "NIP-42" },
      {
        id: "agents",
        state: "ok",
        title: `Found ${agents.length} agent${agents.length === 1 ? "" : "s"}`,
        detail: `in ${channels} channel${channels === 1 ? "" : "s"}`,
      },
    ],
  };
}
