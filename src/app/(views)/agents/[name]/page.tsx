import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AgentDetail, type AgentPr } from "@/components/agent-detail";
import { byDay, findAgent, runtimeFor } from "@/lib/agents";
import { getOwner } from "@/lib/auth";
import { buzzWebUrl } from "@/lib/env";
import { envList, loadGitHub } from "@/lib/github";
import { SLOT_S, SOURCE_KINDS } from "@/lib/health";
import { healthSource } from "@/lib/health-data";
import { healthBuckets } from "@/lib/history";
import { dayStarts, getActivity, loadHive } from "@/lib/hive";
import { turnSeries } from "@/lib/overview";
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
  const [{ hive }, { feed, stale }, owner, { github }, source] =
    await Promise.all([
      loadHive(),
      loadStatusFeed(),
      getOwner(),
      loadGitHub(),
      healthSource().catch(() => null),
    ]);
  // The layout already shows the relay's Alert.
  if (!hive) return null;
  const found = findAgent(hive.agents, decodeURIComponent(name));
  if (!found) notFound();
  if ("redirect" in found) redirect(`/agents/${found.redirect}`);
  // The 14d and 30d views need their own query; without it Activity keeps 7d.
  const activity = await getActivity(found.agent.pubkeys).catch(() => null);
  const now = Math.floor(Date.now() / 1000);
  const agent = found.agent;
  const days = dayStarts(new Date(now * 1000), 30);
  const turns = source
    ? await healthBuckets(
        new Date((days[0] - SLOT_S) * 1000),
        SOURCE_KINDS[source],
      )
        .then((b) =>
          turnSeries(
            b.filter((x) => x.agent === agent.name),
            days,
          ),
        )
        .catch((err) => {
          console.error("Agent page, turns:", err);
          return null;
        })
    : null;
  // The same @Name attribution as Pipeline, newest first.
  const prs: AgentPr[] = (github?.prs ?? [])
    .filter((p) => p.isPr && p.agent === agent.name)
    .sort((x, y) => y.createdAt - x.createdAt)
    .map((p) => ({
      repo: p.repo,
      number: p.number,
      title: p.title,
      url: p.url,
      author: p.author,
      createdAt: p.createdAt,
      mergedAt: p.mergedAt,
      closedAt: p.closedAt,
      reviewers: [
        ...new Set(
          p.reviews.map((r) => r.author).filter((r) => r !== p.author),
        ),
      ],
    }));
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
      turns={turns}
      prs={github ? prs : null}
      buzzUrl={buzzWebUrl()}
    />
  );
}
