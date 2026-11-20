"use client";

import { cn } from "cn";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Layers,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ProjectTile } from "@/components/project-chip";
import { useProjectFilter } from "@/components/project-context";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { NeedsYouRow } from "@/lib/needs-you-rows";
import {
  needsYouCount,
  releaseModelLabel,
  type ScopeProject,
} from "@/lib/project-scope";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Projects that need the owner first, most first; the rest in the owner's order. */
export function sortForSwitcher(
  projects: ScopeProject[],
  counts: Record<string, number>,
): { needs: ScopeProject[]; rest: ScopeProject[] } {
  const needs = projects
    .filter((p) => (counts[p.slug] ?? 0) > 0)
    .toSorted((a, b) => (counts[b.slug] ?? 0) - (counts[a.slug] ?? 0));
  return { needs, rest: projects.filter((p) => !(counts[p.slug] ?? 0)) };
}

const matches = (p: ScopeProject, q: string) =>
  [p.name, p.slug, ...p.repos, ...p.channelNames].some((t) =>
    t.toLowerCase().includes(q),
  );

const subline = (p: ScopeProject) =>
  [
    p.channelNames[0] ? `#${p.channelNames[0]}` : null,
    releaseModelLabel(p),
    plural(p.agents.length, "agent"),
  ]
    .filter(Boolean)
    .join(" · ");

// DESIGN.md → Projects (#167): the header's project switcher, left of search.
// Picking a project filters the current view; the arrow opens its page.
export function ProjectSwitcher({ rows }: { rows: NeedsYouRow[] }) {
  const router = useRouter();
  const { projects, scope, fromPath, clearHref, hrefFor } = useProjectFilter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // "P" opens it, unless a field has the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "p" || e.metaKey || e.ctrlKey || e.altKey)
        return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable='true']"))
        return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const counts = useMemo(
    () =>
      Object.fromEntries(projects.map((p) => [p.slug, needsYouCount(rows, p)])),
    [projects, rows],
  );
  const q = query.trim().toLowerCase();
  const visible = projects.filter((p) => !q || matches(p, q));
  const { needs, rest } = sortForSwitcher(visible, counts);
  const current = scope && projects.find((p) => p.slug === scope.slugs[0]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const go = (href: string) => {
    close();
    router.push(href, { scroll: false });
  };

  return (
    <>
      <div
        className={cn(
          "flex h-9 shrink-0 items-center rounded-[10px] border bg-chip text-sm",
          scope && "border-primary/40",
        )}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={
            scope
              ? `Project: ${scope.names.join(", ")}. Change`
              : "Project: all. Change"
          }
          className="flex h-full min-w-0 items-center gap-2 rounded-[10px] pr-2 pl-1.5 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {current ? (
            <ProjectTile
              project={current}
              className="size-6 rounded-md text-[10px]"
            />
          ) : (
            <span className="flex size-6 items-center justify-center rounded-md border bg-chip">
              <Layers className="size-3.5" aria-hidden />
            </span>
          )}
          <span
            className={cn(
              "max-w-32 truncate sm:max-w-40",
              scope ? "font-mono font-medium" : "text-muted-foreground",
            )}
          >
            {scope
              ? scope.names.length > 1
                ? `${scope.names[0]} + ${scope.names.length - 1}`
                : scope.names[0]
              : "All projects"}
          </span>
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
        </button>
        {scope && (
          <Link
            href={clearHref}
            aria-label="Clear the project filter"
            className="mr-1 flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-chip hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 max-md:hidden"
          >
            <X className="size-3.5" aria-hidden />
          </Link>
        )}
      </div>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent
          showCloseButton={false}
          className="top-auto bottom-0 left-0 max-h-[85dvh] max-w-full translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-b-none p-0 md:top-16 md:bottom-auto md:left-1/2 md:max-w-lg md:-translate-x-1/2 md:rounded-b-xl"
        >
          <DialogTitle className="sr-only">Project</DialogTitle>
          <DialogDescription className="sr-only">
            Pick a project to filter this view, or open its page with the arrow.
          </DialogDescription>
          <div className="flex items-center gap-2 border-b px-3">
            <Search
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <input
              autoFocus
              aria-label="Find a project"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a project…"
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="rounded border px-1.5 font-mono text-[11px] text-muted-foreground max-md:hidden">
              P
            </kbd>
          </div>
          <div className="max-h-[calc(85dvh-3rem)] overflow-y-auto p-1.5 md:max-h-[70dvh]">
            {!q && (
              <button
                type="button"
                onClick={() => go(fromPath ? "/projects" : clearHref)}
                className="flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2.5 text-left outline-none hover:bg-chip focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border bg-chip">
                  <Layers className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">All projects</span>
                  <span className="block text-sm text-muted-foreground">
                    Every repo and channel
                  </span>
                </span>
                {!scope && <Check className="size-4" aria-hidden />}
              </button>
            )}
            {visible.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No project matches “{query}”.
              </p>
            )}
            <Group
              label="Needs you"
              projects={needs}
              counts={counts}
              selected={scope?.slugs ?? []}
              onPick={(p) => go(hrefFor(p.slug))}
              onOpen={close}
            />
            <Group
              label="Projects"
              projects={rest}
              counts={counts}
              selected={scope?.slugs ?? []}
              onPick={(p) => go(hrefFor(p.slug))}
              onOpen={close}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Group({
  label,
  projects,
  counts,
  selected,
  onPick,
  onOpen,
}: {
  label: string;
  projects: ScopeProject[];
  counts: Record<string, number>;
  selected: string[];
  onPick: (p: ScopeProject) => void;
  onOpen: () => void;
}) {
  if (projects.length === 0) return null;
  return (
    <section aria-label={label}>
      <h3 className="px-2.5 pt-3 pb-1 text-xs font-medium text-muted-foreground">
        {label}
      </h3>
      <ul>
        {projects.map((p) => {
          const n = counts[p.slug] ?? 0;
          const on = selected.includes(p.slug);
          return (
            <li
              key={p.slug}
              className={cn(
                "flex items-center rounded-[10px]",
                on && "bg-chip",
              )}
            >
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onPick(p)}
                className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-[10px] px-2.5 py-2 text-left outline-none hover:bg-chip focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <ProjectTile project={p} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono font-medium">
                    {p.name}
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {subline(p)}
                  </span>
                </span>
                {n > 0 && (
                  <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-semibold text-destructive-foreground tabular-nums">
                    {n}
                    <span className="sr-only"> need you</span>
                  </span>
                )}
                {on && <Check className="size-4" aria-hidden />}
              </button>
              <Link
                href={`/projects/${p.slug}`}
                onClick={onOpen}
                aria-label={`Open the ${p.name} page`}
                className="mr-1 flex size-10 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground outline-none hover:bg-chip hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
