"use client";

import { cn } from "cn";
import { X } from "lucide-react";
import Link from "next/link";
import { useProjectFilter } from "@/components/project-context";
import {
  chipLabel,
  projectInitials,
  type ScopeProject,
} from "@/lib/project-scope";

/** The 2 to 3 letter tile a project has in the switcher, index and hero. */
export function ProjectTile({
  project,
  className,
}: {
  project: Pick<ScopeProject, "name" | "shortLabel">;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-[10px] border bg-chip font-mono text-[11px] font-bold text-foreground",
        className,
      )}
    >
      {projectInitials(project)}
    </span>
  );
}

/**
 * The active project filter as a chip that clears with the x (#167). Nothing
 * with no project picked; a slug that names no project says so, once.
 */
export function ProjectChip({ className }: { className?: string }) {
  const { scope, unknown, fromPath, clearHref, projects } = useProjectFilter();
  if (fromPath) return null;
  if (!scope) {
    if (unknown.length === 0) return null;
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        No project called “{unknown[0]}”. Showing everything.{" "}
        <Link href={clearHref} className="underline underline-offset-3">
          Clear
        </Link>
      </p>
    );
  }
  const first = projects.find((p) => p.slug === scope.slugs[0]);
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="inline-flex h-9 items-center gap-2 rounded-full border border-primary/30 bg-primary/10 pr-1 pl-3 text-sm">
        <span className="text-muted-foreground">Project:</span>
        <span className="font-mono font-semibold">{chipLabel(scope)}</span>
        <Link
          href={clearHref}
          aria-label={`Clear the ${chipLabel(scope)} filter`}
          title={
            first ? `Show every project, not just ${first.name}` : undefined
          }
          className="flex size-7 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-chip hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <X className="size-3.5" aria-hidden />
        </Link>
      </span>
      {unknown.length > 0 && (
        <span className="text-sm text-muted-foreground">
          No project called “{unknown[0]}”.
        </span>
      )}
    </div>
  );
}
