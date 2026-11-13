import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AgentDetail } from "@/components/agent-detail";
import { byDay, findAgent, runtimeFor } from "@/lib/agents";
import { getOwner } from "@/lib/auth";
import { envList } from "@/lib/github";
import { getActivity, loadHive } from "@/lib/hive";
import { loadStatusFeed } from "@/lib/status-feed";

type Props = { params: Promise<{ name: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { name } = await params;
  const { hive } = await loadHive();
  const found = hive && findAgent(hive.agents, decodeURIComponent(name));
  return {
    title: `${found && "agent" in found ? found.agent.name : "Agent"} · Hive`,
  };
}

export default async function AgentPage({ params }: Props) {
  const { name } = await params;
  const [{ hive }, { feed, stale }, owner] = await Promise.all([
    loadHive(),
    loadStatusFeed(),
    getOwner(),
  ]);
  // The layout already shows the relay's Alert.
  if (!hive) return null;
  const found = findAgent(hive.agents, decodeURIComponent(name));
  if (!found) notFound();
  if ("redirect" in found) redirect(`/agents/${found.redirect}`);
  // The 14d and 30d views need their own query; without it Activity keeps 7d.
  const activity = await getActivity(found.agent.pubkeys).catch(() => null);
  const now = Math.floor(Date.now() / 1000);
  return (
    <AgentDetail
      // The messages travel once, already grouped.
      agent={{ ...found.agent, messages: [] }}
      now={now}
      groups={byDay(found.agent, now)}
      activity={activity}
      runtime={feed ? runtimeFor(found.agent, feed.runtime) : undefined}
      feed={feed && { publishedAt: feed.publishedAt, stale }}
      owners={envList("GITHUB_OWNERS")}
      // Agent settings are admins-only; the owner is the first admin until
      // roles land (DESIGN.md → Sign-in and roles).
      admin={owner !== null}
    />
  );
}
