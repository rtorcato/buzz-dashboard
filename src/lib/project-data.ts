import "server-only";

import { cache } from "react";
import { readServerEnv } from "./env";
import { historyEnabled } from "./history";
import { loadHive } from "./hive";
import {
  parseProjectParam,
  resolveScope,
  type Scope,
  type ScopeProject,
} from "./project-scope";
import {
  getProject,
  listChannelAssignments,
  listProjects,
  type ProjectView,
} from "./project-store";
import { hiveOf } from "./projects";

// The registry as the views read it (#167): the project list in the shape
// filters and the switcher use, and the scope a request's ?project= names.

/** A registry project flattened for filters; names come from the relay read. */
export function toScopeProject(
  p: ProjectView,
  agents: { name: string; pubkeys: string[] }[],
  channelNames: Record<string, string>,
): ScopeProject {
  const byKey = new Map(
    agents.flatMap((a) => a.pubkeys.map((k) => [k, a.name])),
  );
  return {
    slug: p.slug,
    name: p.name,
    shortLabel: p.shortLabel,
    releaseModel: p.releaseModel,
    defaultBranch: p.defaultBranch,
    devBranch: p.devBranch,
    repos: p.repos.map((r) => r.repo.toLowerCase()),
    channels: p.channels.map((c) => c.channelId),
    channelNames: p.channels.map((c) => channelNames[c.channelId] ?? ""),
    agents: [
      ...new Set(
        p.agents.flatMap((a) => {
          const name = byKey.get(a.pubkey);
          return name ? [name] : [];
        }),
      ),
    ].sort((a, b) => a.localeCompare(b)),
  };
}

/** The hive's projects, or [] without the history store, a relay or any project. */
export const loadScopeProjects = cache(async (): Promise<ScopeProject[]> => {
  if (!historyEnabled()) return [];
  try {
    const hive = hiveOf(readServerEnv().buzzRelayUrl);
    if (!hive) return [];
    const [projects, { hive: relay }] = await Promise.all([
      listProjects(hive),
      loadHive(),
    ]);
    return projects.map((p) =>
      toScopeProject(p, relay?.agents ?? [], relay?.channels ?? {}),
    );
  } catch (err) {
    // Like the cost chip: a database outage shows on its own view, not on
    // every page.
    console.error("Projects:", err);
    return [];
  }
});

export type RequestScope = {
  projects: ScopeProject[];
  /** Null when no project is picked, or none picked exists. */
  scope: Scope | null;
  /** Slugs in the URL that name no project. */
  unknown: string[];
};

/** The scope a page's `?project=` names, with the projects it was read from. */
export async function loadRequestScope(
  params: Record<string, string | string[] | undefined>,
): Promise<RequestScope> {
  const projects = await loadScopeProjects();
  return {
    projects,
    ...resolveScope(projects, parseProjectParam(params.project)),
  };
}

/** The ids of the channels the owner marked hive-wide (releases, security). */
export const loadHiveWideChannels = cache(async (): Promise<string[]> => {
  if (!historyEnabled()) return [];
  try {
    const hive = hiveOf(readServerEnv().buzzRelayUrl);
    if (!hive) return [];
    const all = await listChannelAssignments(hive);
    return all.filter((a) => a.scope === "hive_wide").map((a) => a.channelId);
  } catch (err) {
    console.error("Projects, hive-wide channels:", err);
    return [];
  }
});

/** One project by slug, archived or not; null when none has it or no registry. */
export async function loadProject(slug: string): Promise<ProjectView | null> {
  if (!historyEnabled()) return null;
  const hive = hiveOf(readServerEnv().buzzRelayUrl);
  return hive ? getProject(hive, slug) : null;
}
