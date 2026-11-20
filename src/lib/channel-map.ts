import "server-only";

import { schnorr } from "@noble/curves/secp256k1.js";
import { connection } from "next/server";
import { cache } from "react";
import { buildChannelMap, type ChannelMap } from "./channels";
import { readServerEnv } from "./env";
import { historyEnabled } from "./history";
import { type Hive, loadHive, queryAll } from "./hive";
import { listChannelAssignments, listProjects } from "./project-store";
import { hiveOf } from "./projects";
import { sampleChannelMap, sampleMode } from "./sample-data";

/** The dashboard identity's hex pubkey, from its private key. */
export const dashboardPubkey = (privateKey: string) =>
  Buffer.from(schnorr.getPublicKey(Buffer.from(privateKey, "hex"))).toString(
    "hex",
  );

/** Newest message time per channel name, from what the hive read returned. */
export function lastMessageByName(hive: Hive): Record<string, number> {
  const out: Record<string, number> = {};
  const see = (channel: string | null, at: number) => {
    if (channel && (out[channel] ?? 0) < at) out[channel] = at;
  };
  for (const f of hive.feed) see(f.channel, f.at);
  for (const a of hive.agents) for (const m of a.messages) see(m.channel, m.at);
  return out;
}

export type ChannelMapResult =
  | { map: ChannelMap }
  | { map: null; error: string };

// One read per request, shared by the Channels view and the Agents view.
export const loadChannelMap = cache(async (): Promise<ChannelMapResult> => {
  await connection();
  if (sampleMode()) return { map: sampleChannelMap() };
  try {
    const { hive } = await loadHive();
    if (!hive) return { map: null, error: "The relay didn't answer." };
    const env = readServerEnv();
    const events = [
      ...(await queryAll(env, { kinds: [39000] })),
      ...(await queryAll(env, { kinds: [39002] })),
    ];
    // The registry is optional: without the history store the map still shows
    // channels, members and readability, just no project column.
    let assignments = null;
    let projects: Awaited<ReturnType<typeof listProjects>> = [];
    const key = hiveOf(env.buzzRelayUrl);
    if (historyEnabled() && key) {
      try {
        [assignments, projects] = await Promise.all([
          listChannelAssignments(key),
          listProjects(key, { archived: true }),
        ]);
      } catch (err) {
        console.error("Channels, registry:", err);
      }
    }
    return {
      map: buildChannelMap({
        events,
        dashboard: dashboardPubkey(env.buzzPrivateKey),
        assignments,
        projects,
        agents: hive.agents,
        lastMessageByName: lastMessageByName(hive),
      }),
    };
  } catch (err) {
    return {
      map: null,
      error: err instanceof Error ? err.message : "error",
    };
  }
});
