"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import {
  parseProjectParam,
  resolveScope,
  type Scope,
  type ScopeProject,
  slugOfPath,
  withProject,
} from "@/lib/project-scope";

// The project filter in the browser (#167). The URL holds it (?project=slug,
// or /projects/slug on a project's own page); the layout hands every client
// component the project list through this context.

const ProjectsContext = createContext<ScopeProject[]>([]);

/** Gives the shell's client components the registry's projects. */
export function ProjectsProvider({
  projects,
  children,
}: {
  projects: ScopeProject[];
  children: ReactNode;
}) {
  return (
    <ProjectsContext.Provider value={projects}>
      {children}
    </ProjectsContext.Provider>
  );
}

export const useProjects = (): ScopeProject[] => useContext(ProjectsContext);

export type ProjectFilter = {
  projects: ScopeProject[];
  /** Null when nothing is picked, or what is picked doesn't exist. */
  scope: Scope | null;
  /** Slugs in the URL that name no project. */
  unknown: string[];
  /** True on a project's own page, where the path is the filter. */
  fromPath: boolean;
  /** The current page's URL with the filter taken off. */
  clearHref: string;
  /** `href` with the active filter carried onto it. */
  carry: (href: string) => string;
  /** The current page's URL filtered to one project. */
  hrefFor: (slug: string) => string;
};

/** The active filter, read from the URL. */
export function useProjectFilter(): ProjectFilter {
  const projects = useProjects();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  return useMemo(() => {
    const pathSlug = slugOfPath(pathname);
    const params = new URLSearchParams(search);
    const slugs = pathSlug
      ? [pathSlug]
      : parseProjectParam(params.get("project"));
    const { scope, unknown } = resolveScope(projects, slugs);
    const here = `${pathname}${search ? `?${search}` : ""}`;
    const fromPath = pathSlug !== null;
    return {
      projects,
      scope,
      unknown,
      fromPath,
      clearHref: fromPath ? "/projects" : withProject(here, []),
      carry: (href: string) =>
        scope && !fromPath ? withProject(href, scope.slugs) : href,
      hrefFor: (slug: string) =>
        pathname === "/projects" || fromPath
          ? `/projects/${slug}`
          : withProject(here, [slug]),
    };
  }, [projects, pathname, search]);
}
