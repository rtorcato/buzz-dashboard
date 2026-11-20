import type { Metadata } from "next";
import { AgentsView } from "@/components/agents-view";
import { type Runtimes, runtimeFor } from "@/lib/agents";
import { loadChannelMap } from "@/lib/channel-map";
import { unreadableByAgent } from "@/lib/channels";
import { loadHive } from "@/lib/hive";
import { loadRequestScope } from "@/lib/project-data";
import { agentInScope } from "@/lib/project-scope";
import { loadStatusFeed } from "@/lib/status-feed";

export const metadata: Metadata = { title: "Agents · Hive" };

export default async function AgentsPage({
  searchParams,
}: PageProps<"/agents">) {
  const [{ hive }, { feed, stale }, { map }, { scope, projects }] =
    await Promise.all([
      loadHive(),
      loadStatusFeed(),
      loadChannelMap(),
      searchParams.then(loadRequestScope),
    ]);
  // The layout already shows the relay's Alert.
  if (!hive) return null;
  // One card per rostered agent; a silent one gets the Quiet badge.
  // The cards don't show messages, so don't send them to the browser.
  const live = hive.agents
    // A picked project (#167) shows the agents assigned to it.
    .filter((a) => !scope || agentInScope(scope, a.name))
    .map((a) => ({ ...a, messages: [] }));
  // "Also in buzz-dashboard, repo-tooling": the project's agents' other homes.
  const alsoIn: Record<string, string[]> = scope
    ? Object.fromEntries(
        live.flatMap((a) => {
          const other = projects
            .filter(
              (p) => !scope.slugs.includes(p.slug) && p.agents.includes(a.name),
            )
            .map((p) => p.name);
          return other.length ? [[a.name, other]] : [];
        }),
      )
    : {};
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
      alsoIn={alsoIn}
      feed={feed && { publishedAt: feed.publishedAt, stale }}
      elsewhere={map ? unreadableByAgent(map.rows) : {}}
    />
  );
}
