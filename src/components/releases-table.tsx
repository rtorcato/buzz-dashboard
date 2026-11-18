"use client";

import { cn } from "cn";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  CircleCheckBig,
  CircleDashed,
  CircleX,
  Clock,
  ExternalLink,
  Info,
} from "lucide-react";
import { Fragment, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

// DESIGN.md → Releases (#71): the Repos table. The page computes every label
// on the server; this only filters and expands.

/** A conventional-commit type chip; the type is always written out. */
export function TypeChip({ type, count }: { type: string; count?: number }) {
  const base = type.replace(/!$/, "");
  const tone = type.endsWith("!")
    ? "border-destructive/35 bg-destructive/8 text-destructive"
    : base === "feat"
      ? "border-info/35 bg-info/8 text-info"
      : base === "fix" || base === "perf"
        ? "border-success/35 bg-success/8 text-success"
        : "border-border bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-[5px] border px-1.5 font-mono text-[11.5px] leading-none",
        tone,
      )}
    >
      {type}
      {count !== undefined && ` ${count}`}
    </span>
  );
}

export type RunCell =
  | { kind: "waiting"; age: string }
  | { kind: "red" }
  | { kind: "not-started" }
  | { kind: "published"; date: string | null }
  | { kind: "none" };

export type CommitRow = {
  oid: string;
  type: string;
  subject: string;
  pr: number | null;
  prUrl: string | null;
  agent: string | null;
  age: string;
};

export type RepoRow = {
  repo: string;
  short: string;
  tag: string | null;
  tagDate: string | null;
  count: number;
  more: boolean;
  chips: [string, number][];
  next:
    | { kind: "bump"; bump: string; tag: string | null }
    | { kind: "no-release" }
    | { kind: "none" };
  npm: { version: string; date: string | null } | null;
  pending: boolean;
  run: RunCell;
  commits: CommitRow[];
  /** "+ 3 more · 2 fix, 1 chore", or null when every commit shows. */
  moreLine: string | null;
  /** "Merged since v3.1.0 on Mon", or null without a tag. */
  sinceLine: string | null;
  compareUrl: string | null;
};

type Filter = "all" | "unreleased" | "current";

export function RunBadge({ run }: { run: RunCell }) {
  switch (run.kind) {
    case "waiting":
      return (
        <Badge className="border-warning/30 bg-warning/10 text-warning">
          <Clock aria-hidden />
          Waiting for you · {run.age}
        </Badge>
      );
    case "red":
      return (
        <Badge variant="destructive">
          <CircleX aria-hidden />
          CI red on main
        </Badge>
      );
    case "not-started":
      return (
        <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground">
          <CircleDashed className="size-3.5" aria-hidden />
          Not started
        </span>
      );
    case "published":
      return (
        <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground">
          <CircleCheckBig className="size-3.5 text-success" aria-hidden />
          {run.date ? `Published ${run.date}` : "Published"}
        </span>
      );
    default:
      return <span className="text-muted-foreground">–</span>;
  }
}

function Unreleased({ r }: { r: RepoRow }) {
  if (!r.tag) return <span className="text-muted-foreground">no tag yet</span>;
  if (r.count === 0) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-success">
        <CircleCheckBig className="size-3.5" aria-hidden />
        Up to date
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="font-semibold tabular-nums">
        {r.count}
        {r.more && "+"}
      </span>
      {r.chips.map(([type, n]) => (
        <TypeChip key={type} type={type} count={n} />
      ))}
    </span>
  );
}

function Next({ next }: { next: RepoRow["next"] }) {
  if (next.kind === "none")
    return <span className="text-muted-foreground">–</span>;
  if (next.kind === "no-release")
    return <span className="text-muted-foreground">no release</span>;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {next.bump}
      {next.tag && (
        <>
          <ArrowRight className="size-3 text-muted-foreground" aria-hidden />
          <span className="font-mono text-[13px]">{next.tag}</span>
        </>
      )}
    </span>
  );
}

function CommitList({ r }: { r: RepoRow }) {
  return (
    <div className="space-y-1.5 py-3 pr-4 sm:pr-6">
      <ul className="space-y-1.5">
        {r.commits.map((c) => (
          <li key={c.oid} className="flex min-w-0 items-center gap-2 text-sm">
            <TypeChip type={c.type} />
            <span className="min-w-0 flex-1 truncate">{c.subject}</span>
            {c.pr !== null &&
              (c.prUrl ? (
                <a
                  href={c.prUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-muted-foreground hover:underline"
                >
                  #{c.pr}
                </a>
              ) : (
                <span className="font-mono text-xs text-muted-foreground">
                  #{c.pr}
                </span>
              ))}
            {c.agent && (
              <span className="text-xs text-muted-foreground max-sm:hidden">
                {c.agent}
              </span>
            )}
            <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
              {c.age}
            </span>
          </li>
        ))}
      </ul>
      {(r.moreLine || r.sinceLine || r.compareUrl) && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
          <span>{[r.moreLine, r.sinceLine].filter(Boolean).join(" · ")}</span>
          {r.compareUrl && (
            <a
              href={r.compareUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
            >
              Compare on GitHub
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

const OPEN_ROW =
  "bg-foreground/[0.03] shadow-[inset_3px_0_0_var(--color-foreground)]";

export function ReleasesTable({ rows }: { rows: RepoRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (repo: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(repo)) next.delete(repo);
      else next.add(repo);
      return next;
    });
  const shown = rows.filter((r) =>
    filter === "all"
      ? true
      : filter === "unreleased"
        ? r.count > 0
        : r.count === 0,
  );
  const expandable = (r: RepoRow) => r.commits.length > 0;

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-4 pb-4 sm:px-6">
        <h3 className="flex items-baseline gap-2 font-medium">
          Repos
          <span className="text-sm font-normal text-muted-foreground">
            {rows.length} watched · unreleased first
          </span>
        </h3>
        <ToggleGroup
          aria-label="Filter repos"
          className="max-md:hidden"
          variant="outline"
          size="sm"
          spacing={0}
          value={[filter]}
          onValueChange={(v: string[]) => v[0] && setFilter(v[0] as Filter)}
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="unreleased">Unreleased</ToggleGroupItem>
          <ToggleGroupItem value="current">Up to date</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {shown.length === 0 ? (
        <p className="border-t px-4 py-6 text-center text-muted-foreground sm:px-6">
          No repos match this filter.
        </p>
      ) : (
        <>
          {/* Desktop and tablet: the table. */}
          <div className="overflow-x-auto border-t max-md:hidden">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="px-4 py-2 font-medium sm:pl-6">Repo</th>
                  <th className="px-2 py-2 font-medium">Latest tag</th>
                  <th className="px-2 py-2 font-medium">Unreleased on main</th>
                  <th className="px-2 py-2 font-medium">Next</th>
                  <th className="px-2 py-2 font-medium">npm</th>
                  <th className="px-2 py-2 font-medium">Release run</th>
                  <th className="w-10 px-4 py-2 sm:pr-6">
                    <span className="sr-only">Commits</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {shown.map((r) => {
                  const isOpen = open.has(r.repo);
                  const Chevron = isOpen ? ChevronDown : ChevronRight;
                  return (
                    <Fragment key={r.repo}>
                      <tr
                        className={cn(
                          expandable(r) && "cursor-pointer hover:bg-muted/40",
                          isOpen && OPEN_ROW,
                        )}
                        onClick={
                          expandable(r) ? () => toggle(r.repo) : undefined
                        }
                      >
                        <td className="px-4 py-3 sm:pl-6">
                          {expandable(r) ? (
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggle(r.repo);
                              }}
                              className="rounded-sm font-mono text-[13px] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                            >
                              {r.short}
                            </button>
                          ) : (
                            <span className="font-mono text-[13px]">
                              {r.short}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-3">
                          {r.tag ? (
                            <>
                              <span className="block max-w-56 truncate font-mono text-[13px]">
                                {r.tag}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {r.tagDate}
                              </span>
                            </>
                          ) : (
                            <span className="text-muted-foreground">–</span>
                          )}
                        </td>
                        <td className="px-2 py-3">
                          <Unreleased r={r} />
                        </td>
                        <td className="px-2 py-3">
                          <Next next={r.next} />
                        </td>
                        <td className="px-2 py-3">
                          {r.npm ? (
                            <span className="flex flex-col items-start gap-0.5">
                              <span className="font-mono text-[13px]">
                                {r.npm.version}
                              </span>
                              {r.npm.date && (
                                <span className="text-xs text-muted-foreground">
                                  {r.npm.date}
                                </span>
                              )}
                              {r.pending && (
                                <Badge
                                  variant="outline"
                                  className="text-muted-foreground"
                                >
                                  Release pending
                                </Badge>
                              )}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              not on npm
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-3">
                          <RunBadge run={r.run} />
                        </td>
                        <td className="px-4 py-3 text-muted-foreground sm:pr-6">
                          {expandable(r) && (
                            <Chevron className="size-4" aria-hidden />
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className={OPEN_ROW}>
                          <td className="sm:pl-6" />
                          <td colSpan={6} className="px-2">
                            <CommitList r={r} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Phones: the table becomes a list. */}
          <ul className="divide-y border-t md:hidden">
            {shown.map((r) => {
              const isOpen = open.has(r.repo);
              const Chevron = isOpen ? ChevronDown : ChevronRight;
              const parts = [
                ...r.chips.map(([t, n]) => `${t} ${n}`),
                ...(r.next.kind === "bump"
                  ? [`${r.next.bump}${r.next.tag ? ` → ${r.next.tag}` : ""}`]
                  : []),
              ];
              const body = (
                <>
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13px] font-medium">
                        {r.short}
                      </span>
                      {r.tag && (
                        <span className="max-w-40 truncate font-mono text-xs text-muted-foreground">
                          {r.tag}
                        </span>
                      )}
                      <RunBadge run={r.run} />
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {r.count > 0 ? (
                        <>
                          <b className="font-semibold text-foreground">
                            {r.count}
                            {r.more && "+"}
                          </b>{" "}
                          unreleased · {parts.join(" · ")}
                        </>
                      ) : r.tag ? (
                        "Up to date"
                      ) : (
                        "no tag yet"
                      )}
                    </span>
                  </span>
                  {expandable(r) && (
                    <Chevron
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  )}
                </>
              );
              return (
                <li key={r.repo} className={cn(isOpen && OPEN_ROW)}>
                  {expandable(r) ? (
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => toggle(r.repo)}
                      className="flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="flex min-h-11 items-center gap-3 px-4 py-2.5">
                      {body}
                    </div>
                  )}
                  {isOpen && (
                    <div className="pl-4">
                      <CommitList r={r} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <p className="flex items-start gap-2 border-t px-4 py-3 text-xs text-muted-foreground sm:px-6">
        <Info className="mt-px size-3.5 shrink-0 text-info" aria-hidden />
        <span>
          “Next” reads the conventional-commit prefixes since the last tag (feat
          → minor, fix → patch, ! → major). It’s a guess; the release workflow
          decides.
        </span>
      </p>
    </>
  );
}
