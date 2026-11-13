import type { Metadata } from "next";
import { AgentsView } from "@/components/agents-view";
import { type Runtimes, runtimeFor } from "@/lib/agents";
import { loadHive } from "@/lib/hive";
import { loadStatusFeed } from "@/lib/status-feed";

export const metadata: Metadata = { title: "Agents · Hive" };

export default async function AgentsPage() {
  const [{ hive }, { feed, stale }] = await Promise.all([
    loadHive(),
    loadStatusFeed(),
  ]);
  // The layout already shows the relay's Alert.
  if (!hive) return null;
  // One card per rostered agent; a silent one gets the Quiet badge.
  // The cards don't show messages, so don't send them to the browser.
  const live = hive.agents.map((a) => ({ ...a, messages: [] }));
  const runtimes: Runtimes = {};
  for (const a of live) {
    const r = feed && runtimeFor(a, feed.runtime);
    if (r) runtimes[a.name] = r;
  }
  return (
    <AgentsView
      agents={live}
      now={Math.floor(Date.now() / 1000)}
      runtimes={runtimes}
      feed={feed && { publishedAt: feed.publishedAt, stale }}
    />
  );
}
