import { cn } from "cn";
import {
  ArrowRight,
  CircleCheck,
  CircleX,
  Clock,
  Coins,
  ExternalLink,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Hash,
  ListChecks,
  type LucideIcon,
  MessageSquare,
  OctagonAlert,
  Tag,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Avatar } from "@/components/agents-view";
import { ProjectTile } from "@/components/project-chip";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatAge } from "@/lib/age";
import { agentStatus } from "@/lib/agents";
import { formatUsd } from "@/lib/cost";
import { buzzWebUrl } from "@/lib/env";
import { loadGitHub } from "@/lib/github";
import { costByChannel, historyEnabled, listEvents } from "@/lib/history";
import { loadHive } from "@/lib/hive";
import { loadProject, loadScopeProjects } from "@/lib/project-data";
import {
  openAsks,
  type PrStage,
  parsePrTab,
  projectKpis,
  projectPrs,
  prStage,
  prsFor,
  type StageTone,
} from "@/lib/project-page";
import {
  eventScope,
  releaseModelLabel,
  scopeOfProject,
} from "@/lib/project-scope";
import { one } from "@/lib/query";
import {
  bumpOf,
  loadReleases,
  nextTag,
  type RepoRelease,
  releasing,
  runState,
  tagVersion,
} from "@/lib/releases";
import { type Names, toRow } from "@/lib/timeline";

type Props = PageProps<"/projects/[slug]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const project = await loadProject(slug).catch(() => null);
  return { title: `${project?.name ?? "Project"} · Hive` };
}

const DAY_MS = 86_400_000;
const PR_ROWS = 10;
const ACTIVITY_ROWS = 8;
const dur = (s: number) => formatAge(s * 1000);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export default async function ProjectPage({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const project = await loadProject(slug).catch((err) => {
    console.error("Project page:", err);
    return null;
  });
  if (!project) notFound();
  const projects = await loadScopeProjects();
  const flat = projects.find((p) => p.slug === slug);
  // An archived project has a page but isn't in the switcher's list.
  const scope = flat
    ? scopeOfProject(flat)
    : {
        slugs: [slug],
        names: [project.name],
        repos: project.repos.map((r) => r.repo.toLowerCase()),
        channels: project.channels.map((c) => c.channelId),
        agents: [],
      };

  const nowMs = Date.now();
  const now = Math.floor(nowMs / 1000);
  const tab = parsePrTab(one(query.prs));
  const [{ hive }, { github }, releases, activity, cost] = await Promise.all([
    loadHive(),
    loadGitHub(),
    process.env.GITHUB_TOKEN ? loadReleases() : null,
    historyEnabled()
      ? listEvents({
          since: new Date(nowMs - 14 * DAY_MS),
          project: eventScope(scope),
          limit: ACTIVITY_ROWS,
        }).catch((err) => {
          console.error("Project page, activity:", err);
          return null;
        })
      : null,
    // Spend tagged with the project's channels (#167), 7 days.
    scope.channels.length
      ? costByChannel(new Date(nowMs - 7 * DAY_MS), scope.channels).then(
          (rows) => rows.reduce((n, r) => n + r.cost, 0),
          () => null,
        )
      : null,
  ]);

  const channelNames = project.channels.map((c) => ({
    id: c.channelId,
    name: hive?.channels[c.channelId] ?? c.label ?? null,
    home: c.home,
  }));
  const repoRows = (releases?.releases?.repos ?? []).filter((r) =>
    scope.repos.includes(r.repo.toLowerCase()),
  );
  const primary = project.repos.find((r) => r.primary) ?? project.repos[0];
  const head = repoRows.find(
    (r) => r.repo.toLowerCase() === primary?.repo.toLowerCase(),
  );
  const kpis = github ? projectKpis(github, scope, now) : null;
  const asks = github ? openAsks(github, scope) : [];
  const prs = github ? projectPrs(github, scope) : [];
  const shownPrs = prsFor(prs, tab);
  const buzzUrl = buzzWebUrl();

  return (
    <div className="space-y-6">
      <Hero
        name={project.name}
        shortLabel={project.shortLabel}
        model={releaseModelLabel(project)}
        repos={project.repos.map((r) => r.repo)}
        channels={channelNames}
        release={head}
        now={now}
        buzzUrl={buzzUrl}
      />

      {kpis ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Tile
            label="Open PRs"
            icon={GitPullRequest}
            value={kpis.openPrs}
            sub={`${kpis.mergeReady} merge-ready`}
          />
          <Tile
            label="Merged · 7d"
            icon={GitMerge}
            value={kpis.merged7d}
            sub={
              kpis.medianOpenToMerged === null
                ? "nothing merged this week"
                : `median ${dur(kpis.medianOpenToMerged)} open → merged`
            }
          />
          <Tile
            label="Claimed issues"
            icon={ListChecks}
            value={kpis.claimed}
            sub={`${kpis.blocked} blocked`}
            alert={kpis.blocked > 0}
          />
          <Tile
            label="Est. cost · 7d"
            icon={Coins}
            value={cost === null ? "–" : formatUsd(cost)}
            sub={
              scope.channels.length === 0
                ? "no channel in this project"
                : cost === null
                  ? "not connected"
                  : channelNames
                      .filter((c) => c.name)
                      .map((c) => `#${c.name}`)
                      .join(", ") || "its channels"
            }
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          GitHub isn&apos;t connected, so this project&apos;s PRs, issues and
          asks can&apos;t be read.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Section
          title="Open asks"
          aside="from GitHub"
          empty={asks.length === 0 && "Nothing is waiting on you here."}
        >
          <ul className="divide-y">
            {asks.map((a) => (
              <li
                key={a.ref}
                className="flex items-center gap-3 px-4 py-3 sm:px-6"
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-full border",
                    a.kind === "blocked"
                      ? "border-destructive/20 bg-destructive/10 text-destructive"
                      : a.kind === "merge"
                        ? "border-border bg-muted text-foreground"
                        : "border-primary/25 bg-primary/10 text-primary",
                  )}
                >
                  {a.kind === "blocked" ? (
                    <OctagonAlert className="size-4" aria-hidden />
                  ) : a.kind === "merge" ? (
                    <GitMerge className="size-4" aria-hidden />
                  ) : (
                    <MessageSquare className="size-4" aria-hidden />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium max-sm:line-clamp-2">{a.title}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {a.ref} · {a.detail}
                    {a.agent && <> · {a.agent}</>} ·{" "}
                    <span className="tabular-nums">
                      {formatAge(nowMs - a.since * 1000)}
                    </span>
                  </p>
                </div>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 text-sm font-medium hover:underline"
                >
                  Open
                  <ExternalLink className="size-3.5" aria-hidden />
                  <span className="sr-only"> {a.ref} on GitHub</span>
                </a>
              </li>
            ))}
          </ul>
        </Section>

        <ReleaseCard
          model={project.releaseModel}
          modelLabel={releaseModelLabel(project)}
          repos={repoRows}
          connected={Boolean(releases?.releases)}
          now={now}
        />
      </div>

      <Section
        title="Pull requests"
        aside={
          primary && (
            <a
              href={`https://github.com/${primary.repo}/pulls`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-foreground"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              All on GitHub
            </a>
          )
        }
        tabs={
          <nav
            aria-label="Pull requests"
            className="inline-flex h-9 w-fit items-center rounded-lg bg-muted p-[3px] text-muted-foreground"
          >
            {(
              [
                ["open", `Open ${prsFor(prs, "open").length}`],
                ["merged", `Merged ${prsFor(prs, "merged").length}`],
              ] as const
            ).map(([key, label]) => (
              <Link
                key={key}
                href={
                  key === "open"
                    ? `/projects/${slug}`
                    : `/projects/${slug}?prs=merged`
                }
                scroll={false}
                aria-current={tab === key ? "page" : undefined}
                className={cn(
                  "inline-flex h-full items-center rounded-md px-3 text-sm font-medium text-foreground/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                  tab === key &&
                    "bg-background text-foreground shadow-sm dark:border dark:border-input dark:bg-input/30",
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
        }
        empty={
          shownPrs.length === 0 &&
          (github
            ? tab === "open"
              ? "No open PRs."
              : "Nothing merged in the last 30 days."
            : "GitHub isn't connected.")
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-2 font-medium sm:pl-6">PR</th>
                <th className="px-2 py-2 font-medium max-md:hidden">Agent</th>
                <th className="px-2 py-2 font-medium">Stage</th>
                <th className="px-4 py-2 text-right font-medium sm:pr-6">
                  Age
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {shownPrs.slice(0, PR_ROWS).map((p) => (
                <tr key={`${p.repo}#${p.number}`}>
                  <td className="max-w-0 px-4 py-3 sm:pl-6">
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex gap-1.5 hover:underline"
                    >
                      <span className="shrink-0 font-mono text-primary">
                        #{p.number}
                      </span>
                      <span className="truncate max-sm:whitespace-normal">
                        {p.title}
                      </span>
                    </a>
                  </td>
                  <td className="px-2 py-3 max-md:hidden">
                    {p.agent ?? (
                      <span className="text-muted-foreground">–</span>
                    )}
                  </td>
                  <td className="px-2 py-3">
                    <StageChip stage={prStage(p)} />
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground tabular-nums sm:pr-6">
                    {formatAge(
                      nowMs -
                        (tab === "merged" && p.mergedAt
                          ? p.mergedAt
                          : p.createdAt) *
                          1000,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Section
          title="Activity"
          aside={
            <Link
              href={`/timeline?project=${slug}`}
              className="inline-flex items-center gap-1.5 hover:text-foreground"
            >
              Timeline
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          }
          empty={
            activity === null
              ? "History isn't available, so there is no activity to show."
              : activity.length === 0 && "No stored events in the last 14 days."
          }
        >
          <ul className="divide-y">
            {(activity ?? []).map((e) => {
              const byKey = new Map(
                (hive?.agents ?? []).flatMap((a) =>
                  a.pubkeys.map((k) => [k, a.name] as const),
                ),
              );
              const names: Names = {
                actor: (raw) => byKey.get(raw) ?? raw.replace(/^@/, ""),
                channel: (id) => hive?.channels[id] ?? null,
              };
              const row = toRow(e, names);
              return (
                <li
                  key={row.id}
                  className="flex items-start gap-3 px-4 py-3 sm:px-6"
                >
                  <p className="min-w-0 flex-1 text-sm">
                    <span className="font-medium">{row.actor}</span>{" "}
                    <span className="text-muted-foreground">{row.verb}</span>{" "}
                    {row.target && (
                      <span className="font-mono text-[13px]">
                        {row.target}
                      </span>
                    )}
                    {row.snippet && (
                      <span className="block truncate text-muted-foreground">
                        {row.snippet}
                      </span>
                    )}
                  </p>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatAge(nowMs - row.at * 1000)}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>

        <Section
          title="Agents"
          aside={`${project.agents.length} assigned`}
          empty={project.agents.length === 0 && "No agent is assigned yet."}
        >
          <ul className="divide-y">
            {project.agents.map((pa) => {
              const agent = hive?.agents.find((a) =>
                a.pubkeys.includes(pa.pubkey),
              );
              if (!agent) return null;
              const status = agentStatus(agent, now);
              return (
                <li
                  key={pa.pubkey}
                  className="flex items-center gap-3 px-4 py-3 sm:px-6"
                >
                  <Avatar
                    agent={{ ...agent, messages: [] }}
                    className="size-9 text-xs"
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/agents/${agent.name.toLowerCase().replace(/\s+/g, "-")}`}
                      className="block truncate font-medium hover:underline"
                    >
                      {agent.name}
                    </Link>
                    <p className="truncate text-sm text-muted-foreground">
                      {pa.role ?? agent.role}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs font-medium",
                      status === "active"
                        ? "border-success/25 bg-success/10 text-success"
                        : status === "quiet"
                          ? "border-warning/25 bg-warning/10 text-warning"
                          : "border-transparent bg-muted text-muted-foreground",
                    )}
                  >
                    {status === "active" ? (
                      <span
                        className="size-1.5 rounded-full bg-success"
                        aria-hidden
                      />
                    ) : (
                      <Clock className="size-3" aria-hidden />
                    )}
                    {status === "active"
                      ? "Active"
                      : status === "quiet"
                        ? "Quiet"
                        : status === "stopped"
                          ? "Stopped"
                          : "Idle"}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      </div>
    </div>
  );
}

function Hero({
  name,
  shortLabel,
  model,
  repos,
  channels,
  release,
  now,
  buzzUrl,
}: {
  name: string;
  shortLabel: string | null;
  model: string;
  repos: string[];
  channels: { id: string; name: string | null; home: boolean }[];
  release: RepoRelease | undefined;
  now: number;
  buzzUrl: string | null;
}) {
  const named = channels.flatMap((c) => (c.name ? [c.name] : []));
  const unread = channels.length - named.length;
  return (
    <Card className="flex-row flex-wrap items-center gap-x-5 gap-y-4 px-4 py-5 sm:px-6">
      <ProjectTile
        project={{ name, shortLabel }}
        className="size-16 rounded-2xl text-lg max-sm:size-14"
      />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="font-mono text-2xl font-bold tracking-tight">
            {name}
          </h2>
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 text-xs font-medium text-primary">
            <Tag className="size-3" aria-hidden />
            {model}
          </span>
        </div>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {repos.map((r) => (
            <a
              key={r}
              href={`https://github.com/${r}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-mono hover:text-foreground"
            >
              <GitBranch className="size-3.5" aria-hidden />
              {r}
            </a>
          ))}
          {(named.length > 0 || unread > 0) && (
            <span className="inline-flex items-center gap-1.5">
              <Hash className="size-3.5" aria-hidden />
              {named.join(", ")}
              {unread > 0 &&
                `${named.length ? " + " : ""}${plural(unread, "channel")} the dashboard can't read`}
            </span>
          )}
          {release?.tag && (
            <span className="inline-flex items-center gap-1.5">
              <Tag className="size-3.5" aria-hidden />
              {release.tag.name} · {dur(now - release.tag.at)} ago
            </span>
          )}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {buzzUrl && (
          <a
            href={buzzUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants(), "h-9 gap-1.5")}
          >
            <ExternalLink aria-hidden />
            Open in Buzz
          </a>
        )}
        {repos[0] && (
          <a
            href={`https://github.com/${repos[0]}`}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "h-9 gap-1.5",
            )}
          >
            <ExternalLink aria-hidden />
            Repo
          </a>
        )}
      </div>
    </Card>
  );
}

function Tile({
  label,
  icon: Icon,
  value,
  sub,
  alert = false,
}: {
  label: string;
  icon: LucideIcon;
  value: ReactNode;
  sub: string;
  alert?: boolean;
}) {
  return (
    <Card className="gap-0 p-5">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4" aria-hidden />
        <span>{label}</span>
      </div>
      <div
        className={cn(
          "mt-2 text-3xl font-semibold tracking-tight tabular-nums",
          alert && "text-destructive",
        )}
      >
        {value}
      </div>
      <p className="mt-1 truncate text-xs text-muted-foreground">{sub}</p>
    </Card>
  );
}

function Section({
  title,
  aside,
  tabs,
  empty,
  children,
}: {
  title: string;
  aside?: ReactNode;
  tabs?: ReactNode;
  /** Shown instead of the body when set to a string. */
  empty?: string | false | null;
  children: ReactNode;
}) {
  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6">
        <h3 className="font-semibold">{title}</h3>
        {tabs}
        {aside && (
          <span className="ml-auto text-sm text-muted-foreground">{aside}</span>
        )}
      </div>
      {empty ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground sm:px-6">
          {empty}
        </p>
      ) : (
        children
      )}
    </Card>
  );
}

const STAGE_TONE: Record<StageTone, string> = {
  merge: "border-border bg-muted text-foreground",
  release: "border-warning/30 bg-warning/10 text-warning",
  database: "border-primary/25 bg-primary/10 text-primary",
  blocked: "border-destructive/25 bg-destructive/10 text-destructive",
  review: "border-border bg-chip text-muted-foreground",
  muted: "border-transparent bg-muted text-muted-foreground",
};

function StageChip({ stage }: { stage: PrStage }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        STAGE_TONE[stage.tone],
      )}
    >
      {stage.label}
    </span>
  );
}

const NOTE: Record<string, string> = {
  changesets: "a merge never publishes",
  milestone: "a closed milestone publishes",
  app_dev: "dev promotes to main",
  none: "nothing to release",
  unknown: "model not set",
};

// The release card: what the reader can see of each repo's release state. The
// audit and QA verdicts live in the #releases channel, which the dashboard
// doesn't parse, so they aren't gates here.
function ReleaseCard({
  model,
  modelLabel,
  repos,
  connected,
  now,
}: {
  model: string;
  modelLabel: string;
  repos: RepoRelease[];
  connected: boolean;
  now: number;
}) {
  return (
    <Section
      title="Release"
      aside={`${modelLabel.split(" · ")[0]} · ${NOTE[model] ?? ""}`}
      empty={
        !connected
          ? "GitHub isn't connected, so releases can't be read."
          : repos.length === 0 &&
            "None of this project's repos is read for releases."
      }
    >
      <div className="divide-y">
        {repos.map((r) => {
          const bump = bumpOf(r.commits);
          const next = r.tag && bump ? nextTag(r.tag.name, bump) : null;
          const state = runState(r);
          const rel = releasing(r).length;
          const from = r.tag ? tagVersion(r.tag.name) : null;
          const to = next ? tagVersion(next) : null;
          return (
            <div key={r.repo} className="space-y-3 px-4 py-4 sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-sm">
                  {from
                    ? `${from}${to && to !== from ? ` → ${to}` : ""}`
                    : r.repo}
                </p>
                {state.kind === "waiting" && (
                  <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-2 text-xs font-medium text-warning">
                    <Clock className="size-3" aria-hidden />
                    Waiting on you
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {plural(rel, "releasing commit")} on {r.branch}
                {bump && ` · ${bump}`}
              </p>
              <ul className="divide-y text-sm">
                <Gate ok={!r.redCi} good="Green" bad="Red" label="CI on main" />
                <Gate
                  ok={state.kind !== "waiting"}
                  good={
                    state.kind === "published" ? "Published" : "Nothing waiting"
                  }
                  bad={`Waiting ${state.kind === "waiting" ? formatAge((now - state.since) * 1000) : ""}`}
                  neutral={state.kind !== "waiting"}
                  label="Your approval"
                />
              </ul>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function Gate({
  ok,
  good,
  bad,
  label,
  neutral = false,
}: {
  ok: boolean;
  good: string;
  bad: string;
  label: string;
  /** A passing gate that isn't a green tick, e.g. nothing to approve. */
  neutral?: boolean;
}) {
  return (
    <li className="flex items-center gap-3 py-2">
      {ok ? (
        <CircleCheck
          className={cn(
            "size-4",
            neutral ? "text-muted-foreground" : "text-success",
          )}
          aria-hidden
        />
      ) : label === "Your approval" ? (
        <Clock className="size-4 text-warning" aria-hidden />
      ) : (
        <CircleX className="size-4 text-destructive" aria-hidden />
      )}
      <span
        className={cn(
          ok
            ? neutral
              ? "text-muted-foreground"
              : "text-success"
            : label === "Your approval"
              ? "text-warning"
              : "text-destructive",
        )}
      >
        {ok ? good : bad}
      </span>
      <span className="ml-auto">{label}</span>
    </li>
  );
}
