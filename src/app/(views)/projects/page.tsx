import { cn } from "cn";
import { GitBranch, Layers, Tag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/agents-view";
import { ProjectTile } from "@/components/project-chip";
import { EmptyState } from "@/components/states";
import { Card } from "@/components/ui/card";
import { loadGitHub } from "@/lib/github";
import { historyEnabled } from "@/lib/history";
import { loadHive } from "@/lib/hive";
import { getNeedsYou } from "@/lib/needs-you";
import { loadScopeProjects } from "@/lib/project-data";
import {
  isApp,
  needsYouCount,
  releaseModelLabel,
  type ScopeProject,
} from "@/lib/project-scope";
import { one, ownKey } from "@/lib/query";

export const metadata: Metadata = { title: "Projects · Hive" };

const SHOWN_AGENTS = 4;
const SHOWS = {
  all: "All",
  needs: "Needs you",
  apps: "Apps",
  libraries: "Libraries",
} as const;

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// DESIGN.md → Projects (#167): one card per project, needs-you first. Each
// card opens the project's page.
export default async function ProjectsPage({
  searchParams,
}: PageProps<"/projects">) {
  // The registry lives in the history store (#166).
  if (!historyEnabled()) notFound();
  const show = ownKey<keyof typeof SHOWS>(
    SHOWS,
    one((await searchParams).show),
    "all",
  );
  const [projects, needsYou, { hive }, { github }] = await Promise.all([
    loadScopeProjects(),
    getNeedsYou(),
    loadHive(),
    loadGitHub(),
  ]);
  const counts = new Map(
    projects.map((p) => [p.slug, needsYouCount(needsYou.rows, p)]),
  );
  const openPrs = (p: ScopeProject) =>
    github
      ? github.prs.filter(
          (pr) =>
            pr.closedAt === null && p.repos.includes(pr.repo.toLowerCase()),
        ).length
      : null;
  const needing = projects.filter((p) => (counts.get(p.slug) ?? 0) > 0);
  const ordered = [
    ...needing.toSorted(
      (a, b) => (counts.get(b.slug) ?? 0) - (counts.get(a.slug) ?? 0),
    ),
    ...projects.filter((p) => !(counts.get(p.slug) ?? 0)),
  ];
  const shown = ordered.filter((p) =>
    show === "needs"
      ? (counts.get(p.slug) ?? 0) > 0
      : show === "apps"
        ? isApp(p)
        : show === "libraries"
          ? !isApp(p)
          : true,
  );
  const tabs = (
    [
      ["all", "All"],
      ["needs", `Needs you ${needing.length}`],
      ["apps", "Apps"],
      ["libraries", "Libraries"],
    ] as const
  ).map(([key, label]) => ({
    key,
    label,
    href: key === "all" ? "/projects" : `/projects?show=${key}`,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Projects</h2>
          <p className="text-sm text-muted-foreground">
            {plural(projects.length, "project")} · a repo, its channels, agents
            and release model
          </p>
        </div>
        <nav
          aria-label="Show"
          className="inline-flex h-9 w-fit items-center rounded-lg bg-muted p-[3px] text-muted-foreground"
        >
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              aria-current={show === t.key ? "page" : undefined}
              className={cn(
                "inline-flex h-full items-center rounded-md px-3 text-sm font-medium text-foreground/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                show === t.key &&
                  "bg-background text-foreground shadow-sm dark:border dark:border-input dark:bg-input/30",
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={Layers} title="No projects here">
          {projects.length === 0
            ? "The registry fills in once the ingester has seen a repo's activity."
            : "No project matches this filter."}
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {shown.map((p) => {
            const n = counts.get(p.slug) ?? 0;
            const prs = openPrs(p);
            const team = p.agents.flatMap((name) => {
              const a = hive?.agents.find((x) => x.name === name);
              return a ? [a] : [];
            });
            return (
              <li key={p.slug}>
                <Link
                  href={`/projects/${p.slug}`}
                  className="group block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Card
                    className={cn(
                      "h-full gap-3 p-4 transition duration-150 group-hover:border-foreground/20",
                      n > 0 && "border-destructive/40",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <ProjectTile project={p} className="size-8 text-[10px]" />
                      <span className="min-w-0 flex-1 truncate font-mono font-semibold">
                        {p.name}
                      </span>
                      {n > 0 && (
                        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-semibold text-destructive-foreground tabular-nums">
                          {n}
                          <span className="sr-only"> need you</span>
                        </span>
                      )}
                    </div>
                    <span className="inline-flex h-6 w-fit items-center gap-1.5 rounded-full bg-primary/10 px-2.5 text-xs font-medium text-primary">
                      {isApp(p) ? (
                        <GitBranch className="size-3" aria-hidden />
                      ) : (
                        <Tag className="size-3" aria-hidden />
                      )}
                      {releaseModelLabel(p)}
                    </span>
                    <p className="truncate text-sm text-muted-foreground">
                      {[
                        p.channelNames[0] ? `#${p.channelNames[0]}` : null,
                        prs === null ? null : plural(prs, "open PR"),
                      ]
                        .filter(Boolean)
                        .join(" · ") || "No channel yet"}
                    </p>
                    {team.length > 0 && (
                      <span className="flex -space-x-2" aria-hidden>
                        {team.slice(0, SHOWN_AGENTS).map((a) => (
                          <Avatar
                            key={a.name}
                            agent={{ ...a, messages: [] }}
                            className="size-7 text-[10px] ring-2 ring-card"
                          />
                        ))}
                        {team.length > SHOWN_AGENTS && (
                          <span className="flex size-7 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground ring-2 ring-card">
                            +{team.length - SHOWN_AGENTS}
                          </span>
                        )}
                      </span>
                    )}
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
