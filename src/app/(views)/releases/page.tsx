import { cn } from "cn";
import {
  ArrowRight,
  CircleX,
  Clock,
  ExternalLink,
  GitBranch,
  GitCompare,
  type LucideIcon,
  Package,
  PackageCheck,
  PlugZap,
  Rocket,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  type CommitRow,
  ReleasesTable,
  type RepoRow,
  type RunCell,
  TypeChip,
} from "@/components/releases-table";
import { SourceDown } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatAge } from "@/lib/age";
import { loadGitHub } from "@/lib/github";
import { loadRequestScope } from "@/lib/project-data";
import { repoInScope } from "@/lib/project-scope";
import {
  bumpOf,
  type Commit,
  loadReleases,
  nextTag,
  type RepoRelease,
  releasing,
  runState,
  tagVersion,
  typeCounts,
} from "@/lib/releases";

export const metadata: Metadata = { title: "Releases · Hive" };

// DESIGN.md → Releases (#71). Read-only: approving a release opens GitHub.

const SHOWN_COMMITS = 4;
// The agent lookup rides on the GitHub read the shell already started; it
// never holds the page for a cold read.
const AGENT_WAIT_MS = 2_000;

const short = (repo: string) => repo.split("/").pop() ?? repo;
const shortDate = (s: number) =>
  new Date(s * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
const weekday = (s: number) =>
  new Date(s * 1000).toLocaleDateString("en-US", { weekday: "short" });
const age = (now: number, s: number) => formatAge((now - s) * 1000);
const typeLabel = (c: Commit) => `${c.type ?? "other"}${c.breaking ? "!" : ""}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default async function ReleasesPage({
  searchParams,
}: PageProps<"/releases">) {
  if (!process.env.GITHUB_TOKEN) return <NotConnected />;
  const { scope } = await loadRequestScope(await searchParams);
  const [result, github] = await Promise.all([
    loadReleases(),
    Promise.race([
      loadGitHub(),
      new Promise<null>((r) => setTimeout(r, AGENT_WAIT_MS, null)),
    ]),
  ]);
  if (!result.releases) {
    return (
      <SourceDown source="GitHub">
        {result.error}, so releases can&apos;t load.
      </SourceDown>
    );
  }
  // A picked project (#167) keeps its repos' rows, runs and red CI.
  const repos = scope
    ? result.releases.repos.filter((r) => repoInScope(scope, r.repo))
    : result.releases.repos;
  const runsUnread = scope
    ? result.releases.runsUnread.filter((r) => repoInScope(scope, r))
    : result.releases.runsUnread;
  const now = Math.floor(Date.now() / 1000);
  // "owner/repo#N" → the PR's agent, from the 30-day PR read.
  const agents = new Map(
    (github?.github?.prs ?? []).flatMap((p) =>
      p.agent ? [[`${p.repo}#${p.number}`, p.agent] as const] : [],
    ),
  );
  const rows = repos.map((r) => toRow(r, now, agents));

  const waiting = repos
    .flatMap((r) => r.waiting.map((w) => ({ r, w })))
    .sort((a, b) => a.w.createdAt - b.w.createdAt);
  const red = repos.filter((r) => r.redCi);
  const unreleased = repos.filter((r) => releasing(r).length);
  const unreleasedCommits = unreleased.reduce(
    (n, r) => n + releasing(r).length,
    0,
  );
  const lastPublish = repos
    .filter((r) => r.npm?.publishedAt)
    .sort((a, b) => (b.npm?.publishedAt ?? 0) - (a.npm?.publishedAt ?? 0))[0];
  const oldest = waiting[0];
  const firstRed = red[0];

  return (
    <div className="space-y-6">
      <h2 className="sr-only">Releases</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Waiting for approval"
          icon={Rocket}
          value={waiting.length}
          sub={
            oldest
              ? `${short(oldest.r.repo)} ${versionOf(oldest.r) ?? ""} · ${age(now, oldest.w.createdAt)}`
              : "Nothing waiting"
          }
          mono
        />
        <Stat
          label="Unreleased changes"
          icon={GitCompare}
          value={plural(unreleased.length, "repo")}
          sub={`${plural(unreleasedCommits, "releasing commit")} on main`}
        />
        <Stat
          label="Red CI on main"
          icon={CircleX}
          value={red.length}
          alert={red.length > 0}
          sub={
            firstRed?.redCi
              ? `${short(firstRed.repo)} · failing ${age(now, firstRed.redCi.since)}`
              : "Every main is green"
          }
          mono={Boolean(firstRed)}
        />
        <Stat
          label="Last publish"
          icon={PackageCheck}
          value={
            lastPublish?.npm ? (
              <span className="font-mono">{lastPublish.npm.version}</span>
            ) : (
              "–"
            )
          }
          sub={
            lastPublish?.npm?.publishedAt
              ? `${short(lastPublish.repo)} · ${age(now, lastPublish.npm.publishedAt)} ago`
              : "Nothing on npm"
          }
        />
      </div>

      {waiting.length > 0 && (
        <Card className="gap-0 py-0">
          <CardHead
            icon={Rocket}
            title="Waiting for your approval"
            count={waiting.length}
            tone="warning"
            aside="Oldest first"
          />
          <ul className="divide-y border-t">
            {waiting.map(({ r, w }) => {
              const rel = releasing(r);
              const newest = rel[0];
              const from = r.tag ? tagVersion(r.tag.name) : null;
              const to = versionOf(r);
              return (
                <Row
                  key={w.id}
                  icon={Rocket}
                  tone="warning"
                  action={{ label: "Review on GitHub", href: w.url }}
                  title={
                    <>
                      <span className="font-mono text-sm">{short(r.repo)}</span>
                      {to && (
                        <Badge variant="outline" className="font-mono">
                          {from && from !== to ? (
                            <>
                              v{from}
                              <ArrowRight
                                className="text-muted-foreground"
                                aria-hidden
                              />
                            </>
                          ) : null}
                          v{to}
                        </Badge>
                      )}
                      <Badge className="border-warning/30 bg-warning/10 text-warning">
                        <Clock aria-hidden />
                        waiting {age(now, w.createdAt)}
                      </Badge>
                    </>
                  }
                >
                  {plural(rel.length, "releasing commit")}
                  {newest && (
                    <>
                      {" · newest "}
                      <TypeChip type={typeLabel(newest)} /> {newest.subject}
                    </>
                  )}
                  {" · "}
                  <span className="font-mono">{w.workflow}</span> run #
                  {w.number}
                </Row>
              );
            })}
          </ul>
        </Card>
      )}

      {red.length > 0 && (
        <Card className="gap-0 py-0">
          <CardHead
            icon={CircleX}
            title="Red CI on main"
            count={red.length}
            tone="destructive"
          />
          <ul className="divide-y border-t">
            {red.map((r) => (
              <Row
                key={r.repo}
                icon={CircleX}
                tone="destructive"
                action={
                  r.redCi?.url
                    ? { label: "View run", href: r.redCi.url }
                    : undefined
                }
                title={
                  <>
                    <span className="font-mono text-sm">{short(r.repo)}</span>
                    <Badge variant="destructive">
                      <Clock aria-hidden />
                      failing {r.redCi?.since ? age(now, r.redCi.since) : ""}
                    </Badge>
                  </>
                }
              >
                {r.redCi?.check}
                {r.head && (
                  <>
                    {" · "}
                    <span className="font-mono">{r.head.short}</span>{" "}
                    {r.head.subject}
                  </>
                )}
                {releasing(r).length > 0 && " · blocks the next release"}
              </Row>
            ))}
          </ul>
        </Card>
      )}

      <Card className="gap-0 pb-0">
        <ReleasesTable rows={rows} />
      </Card>

      {runsUnread.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Release runs couldn&apos;t be read for{" "}
          {runsUnread.map(short).join(", ")}. The GitHub token needs Actions:
          read on those repos.
        </p>
      )}
    </div>
  );
}

/** The version the next release would carry, without its tag prefix. */
function versionOf(r: RepoRelease): string | null {
  if (!r.tag) return null;
  const bump = bumpOf(r.commits);
  const tag = bump ? nextTag(r.tag.name, bump) : r.tag.name;
  return tag ? tagVersion(tag) : null;
}

function toRow(
  r: RepoRelease,
  now: number,
  agents: Map<string, string>,
): RepoRow {
  const bump = bumpOf(r.commits);
  const rel = releasing(r).length;
  const state = runState(r);
  const run: RunCell =
    state.kind === "waiting"
      ? { kind: "waiting", age: age(now, state.since) }
      : state.kind === "published"
        ? {
            kind: "published",
            date: state.at ? shortDate(state.at) : null,
          }
        : state;
  const rest = r.commits.slice(SHOWN_COMMITS);
  const restCounts = typeCounts(rest)
    .map(([t, n]) => `${n} ${t}`)
    .join(", ");
  const commits: CommitRow[] = r.commits.slice(0, SHOWN_COMMITS).map((c) => ({
    oid: c.oid,
    type: typeLabel(c),
    subject: c.subject,
    pr: c.pr,
    prUrl: c.pr !== null ? `${r.url}/pull/${c.pr}` : null,
    agent: c.pr !== null ? (agents.get(`${r.repo}#${c.pr}`) ?? null) : null,
    age: age(now, c.at),
  }));
  return {
    repo: r.repo,
    short: short(r.repo),
    tag: r.tag?.name ?? null,
    tagDate: r.tag?.at ? shortDate(r.tag.at) : null,
    count: r.commits.length,
    more: r.moreCommits,
    chips: typeCounts(r.commits),
    next: !r.tag
      ? { kind: "none" }
      : r.commits.length === 0
        ? { kind: "none" }
        : bump
          ? { kind: "bump", bump, tag: nextTag(r.tag.name, bump) }
          : { kind: "no-release" },
    npm: r.npm
      ? {
          version: r.npm.version,
          date: r.npm.publishedAt ? shortDate(r.npm.publishedAt) : null,
        }
      : null,
    pending: Boolean(r.npm) && rel > 0,
    run,
    commits,
    moreLine:
      rest.length || r.moreCommits
        ? `+ ${rest.length}${r.moreCommits ? "+" : ""} more${restCounts ? ` · ${restCounts}` : ""}`
        : null,
    sinceLine: r.tag
      ? `Merged since ${r.tag.name} on ${weekday(r.tag.at)}`
      : null,
    compareUrl:
      r.tag && r.commits.length
        ? `${r.url}/compare/${encodeURIComponent(r.tag.name)}...${encodeURIComponent(r.branch)}`
        : null,
  };
}

function Stat({
  label,
  icon: Icon,
  value,
  sub,
  alert = false,
  mono = false,
}: {
  label: string;
  icon: LucideIcon;
  value: ReactNode;
  sub: string;
  alert?: boolean;
  mono?: boolean;
}) {
  return (
    <Card className="gap-0 p-5">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{label}</span>
        <Icon className="size-4" aria-hidden />
      </div>
      <div
        className={cn(
          "mt-2 text-3xl font-semibold tracking-tight tabular-nums",
          alert && "text-destructive",
        )}
      >
        {value}
      </div>
      <p
        className={cn(
          "mt-1 truncate text-xs text-muted-foreground",
          mono && "font-mono",
        )}
      >
        {sub}
      </p>
    </Card>
  );
}

const TONE = {
  warning: {
    pill: "border-warning/30 bg-warning/10 text-warning",
    tile: "bg-warning/10 text-warning",
  },
  destructive: {
    pill: "border-destructive/30 bg-destructive/10 text-destructive",
    tile: "bg-destructive/10 text-destructive",
  },
};

function CardHead({
  icon: Icon,
  title,
  count,
  tone,
  aside,
}: {
  icon: LucideIcon;
  title: string;
  count: number;
  tone: keyof typeof TONE;
  aside?: string;
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-4 sm:px-6">
      <Icon className="size-4 text-muted-foreground" aria-hidden />
      <h3 className="font-medium">{title}</h3>
      <span
        className={cn(
          "inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1.5 text-xs font-medium tabular-nums",
          TONE[tone].pill,
        )}
      >
        {count}
      </span>
      {aside && (
        <span className="ml-auto text-sm text-muted-foreground max-md:hidden">
          {aside}
        </span>
      )}
    </div>
  );
}

function Row({
  icon: Icon,
  tone,
  title,
  action,
  children,
}: {
  icon: LucideIcon;
  tone: keyof typeof TONE;
  title: ReactNode;
  action?: { label: string; href: string };
  children: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap sm:px-6">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-md",
          TONE[tone].tile,
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">{title}</div>
        <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
          {children}
        </p>
      </div>
      {action && (
        <a
          href={action.href}
          target="_blank"
          rel="noreferrer"
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "max-sm:w-full",
          )}
        >
          {action.label}
          <ExternalLink aria-hidden />
        </a>
      )}
    </li>
  );
}

function NotConnected() {
  const boxes: [LucideIcon, string, string][] = [
    [
      GitBranch,
      "Tags, unreleased commits and release runs",
      "Read from GitHub for each watched repo.",
    ],
    [Package, "Last publish", "The latest npm version of each repo’s package."],
  ];
  return (
    <div className="space-y-6">
      <h2 className="sr-only">Releases</h2>
      <Card className="gap-4 px-4 sm:px-6">
        <div className="grid gap-3 sm:grid-cols-2">
          {boxes.map(([Icon, title, body]) => (
            <div
              key={title}
              className="space-y-1 rounded-lg border border-dashed p-4"
            >
              <p className="flex items-center gap-2 text-sm font-medium">
                <Icon className="size-4 text-muted-foreground" aria-hidden />
                {title}
              </p>
              <p className="text-xs text-muted-foreground">{body}</p>
              <p className="font-mono text-xs text-muted-foreground">
                not connected
              </p>
            </div>
          ))}
        </div>
        <Link
          href="/settings?tab=sources"
          className={cn(buttonVariants({ variant: "outline" }), "w-fit")}
        >
          <PlugZap aria-hidden />
          Connect a source
        </Link>
      </Card>
    </div>
  );
}
