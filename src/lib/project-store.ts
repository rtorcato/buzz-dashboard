import "server-only";

import { schnorr } from "@noble/curves/secp256k1.js";
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { historyDb } from "./history";
import {
  channelAssignments,
  events,
  type Project,
  projectAgents,
  projectRepos,
  projects,
  registryRevisions,
} from "./history-schema";
import {
  type ChannelAssignment,
  type NewProject,
  type ProjectPatch,
  RegistryError,
  type SeedProject,
  STALE_EDIT,
} from "./projects";
import type { NostrEvent } from "./relay";

// The project registry's reads and writes (#166), in the history store. Every
// write takes the hive explicitly: unlike the older tables, these have no
// default to fall back on.

type Tx = Parameters<
  Parameters<ReturnType<typeof historyDb>["transaction"]>[0]
>[0];

export type ProjectView = {
  id: string;
  slug: string;
  name: string;
  shortLabel: string | null;
  releaseModel: Project["releaseModel"];
  defaultBranch: string;
  devBranch: string | null;
  sortOrder: number;
  revision: number;
  archivedAt: string | null;
  repos: { repo: string; primary: boolean }[];
  channels: {
    channelId: string;
    home: boolean;
    label: string | null;
    revision: number;
  }[];
  agents: { pubkey: string; role: string | null }[];
};

export type ChannelAssignmentView = {
  channelId: string;
  scope: "project" | "hive_wide";
  /** The project's slug for a project channel. */
  project: string | null;
  home: boolean;
  label: string | null;
  revision: number;
  assignedBy: string;
  assignedAt: string;
};

export type RevisionView = {
  eventId: string;
  project: string | null;
  channelId: string | null;
  revision: number;
  signer: string;
  note: string | null;
  change: Record<string, unknown>;
  at: string;
};

const view = (
  p: Project,
  repos: (typeof projectRepos.$inferSelect)[],
  channels: (typeof channelAssignments.$inferSelect)[],
  agents: (typeof projectAgents.$inferSelect)[],
): ProjectView => ({
  id: p.id,
  slug: p.slug,
  name: p.name,
  shortLabel: p.shortLabel,
  releaseModel: p.releaseModel,
  defaultBranch: p.defaultBranch,
  devBranch: p.devBranch,
  sortOrder: p.sortOrder,
  revision: p.revision,
  archivedAt: p.archivedAt?.toISOString() ?? null,
  repos: repos
    .filter((r) => r.projectId === p.id)
    .map((r) => ({ repo: r.repo, primary: r.isPrimary }))
    .sort(
      (a, b) =>
        Number(b.primary) - Number(a.primary) || a.repo.localeCompare(b.repo),
    ),
  channels: channels
    .filter((c) => c.projectId === p.id)
    .map((c) => ({
      channelId: c.channelId,
      home: c.isHome,
      label: c.label,
      revision: c.revision,
    }))
    .sort(
      (a, b) =>
        Number(b.home) - Number(a.home) ||
        a.channelId.localeCompare(b.channelId),
    ),
  agents: agents
    .filter((a) => a.projectId === p.id)
    .map((a) => ({ pubkey: a.agentPubkey, role: a.role }))
    .sort((a, b) => a.pubkey.localeCompare(b.pubkey)),
});

async function linksFor(hive: string, ids: string[]) {
  if (!ids.length) return { repos: [], channels: [], agents: [] };
  const db = historyDb();
  const [repos, channels, agents] = await Promise.all([
    db
      .select()
      .from(projectRepos)
      .where(
        and(eq(projectRepos.hive, hive), inArray(projectRepos.projectId, ids)),
      ),
    db
      .select()
      .from(channelAssignments)
      .where(
        and(
          eq(channelAssignments.hive, hive),
          inArray(channelAssignments.projectId, ids),
        ),
      ),
    db
      .select()
      .from(projectAgents)
      .where(
        and(
          eq(projectAgents.hive, hive),
          inArray(projectAgents.projectId, ids),
        ),
      ),
  ]);
  return { repos, channels, agents };
}

/** The hive's projects with their links, in the owner's order. */
export async function listProjects(
  hive: string,
  { archived = false } = {},
): Promise<ProjectView[]> {
  const rows = await historyDb()
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.hive, hive),
        archived ? undefined : sql`${projects.archivedAt} IS NULL`,
      ),
    )
    .orderBy(asc(projects.sortOrder), asc(projects.name));
  const l = await linksFor(
    hive,
    rows.map((p) => p.id),
  );
  return rows.map((p) => view(p, l.repos, l.channels, l.agents));
}

/**
 * One project with its repos, channel ids and agent pubkeys, archived or not:
 * what every view filters by (#166). Null if no project has the slug.
 */
export async function getProject(
  hive: string,
  slug: string,
): Promise<ProjectView | null> {
  const [p] = await historyDb()
    .select()
    .from(projects)
    .where(and(eq(projects.hive, hive), eq(projects.slug, slug)));
  if (!p) return null;
  const l = await linksFor(hive, [p.id]);
  return view(p, l.repos, l.channels, l.agents);
}

/** Every channel with an assignment; a channel with none is unassigned. */
export async function listChannelAssignments(
  hive: string,
): Promise<ChannelAssignmentView[]> {
  const rows = await historyDb()
    .select({ a: channelAssignments, slug: projects.slug })
    .from(channelAssignments)
    .leftJoin(projects, eq(projects.id, channelAssignments.projectId))
    .where(eq(channelAssignments.hive, hive))
    .orderBy(asc(channelAssignments.channelId));
  return rows.map(({ a, slug }) => ({
    channelId: a.channelId,
    scope: a.scope,
    project: slug ?? null,
    home: a.isHome,
    label: a.label,
    revision: a.revision,
    assignedBy: a.assignedBy,
    assignedAt: a.assignedAt.toISOString(),
  }));
}

/**
 * The newest logged revision of each channel's assignment (#169). An
 * unassigned channel has no row in channel_assignments, but its next signed
 * assignment still has to name the last revision the log holds.
 */
export async function channelRevisions(
  hive: string,
): Promise<Record<string, number>> {
  const rows = await historyDb()
    .select({
      channelId: registryRevisions.channelId,
      revision: sql<number>`max(${registryRevisions.revision})`,
    })
    .from(registryRevisions)
    .where(
      and(
        eq(registryRevisions.hive, hive),
        isNotNull(registryRevisions.channelId),
      ),
    )
    .groupBy(registryRevisions.channelId);
  return Object.fromEntries(
    rows.flatMap((r) =>
      r.channelId ? [[r.channelId, Number(r.revision)]] : [],
    ),
  );
}

/** The newest signed edits, for "who changed what"; one project's with a slug. */
export async function listRevisions(
  hive: string,
  { project, limit = 20 }: { project?: string; limit?: number } = {},
): Promise<RevisionView[]> {
  const rows = await historyDb()
    .select({ r: registryRevisions, slug: projects.slug })
    .from(registryRevisions)
    .leftJoin(projects, eq(projects.id, registryRevisions.projectId))
    .where(
      and(
        eq(registryRevisions.hive, hive),
        project ? eq(projects.slug, project) : undefined,
      ),
    )
    .orderBy(desc(registryRevisions.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map(({ r, slug }) => ({
    eventId: r.eventId,
    project: slug ?? null,
    channelId: r.channelId,
    revision: r.revision,
    signer: r.signerPubkey,
    note: r.note,
    change: r.change,
    at: r.createdAt.toISOString(),
  }));
}

/** Repos with stored events, for the seed. */
export async function activeRepos(): Promise<string[]> {
  const rows = await historyDb()
    .selectDistinct({ repo: sql<string>`lower(${events.repo})` })
    .from(events)
    .where(isNotNull(events.repo));
  return rows.map((r) => r.repo);
}

/** Whether the hive has any project yet, archived ones included. */
export async function hasProjects(hive: string): Promise<boolean> {
  const [row] = await historyDb()
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.hive, hive))
    .limit(1);
  return Boolean(row);
}

/**
 * Writes the first seed for a hive at revision 0, with no revision rows. Runs
 * only while the hive has no project, under a lock, and every insert skips a
 * row that exists, so a re-run never overwrites an owner's edit.
 */
export async function seedProjects(
  hive: string,
  plan: SeedProject[],
  /** The dashboard's private key; seeded channel rows carry its pubkey. */
  privateKey: string,
): Promise<number> {
  if (!plan.length) return 0;
  const seeder = Buffer.from(
    schnorr.getPublicKey(Buffer.from(privateKey, "hex")),
  ).toString("hex");
  return historyDb().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`registry-seed:${hive}`}))`,
    );
    const [any] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.hive, hive))
      .limit(1);
    if (any) return 0;
    let made = 0;
    for (const [i, s] of plan.entries()) {
      const [p] = await tx
        .insert(projects)
        .values({ hive, slug: s.slug, name: s.name, sortOrder: i })
        .onConflictDoNothing()
        .returning({ id: projects.id });
      if (!p) continue;
      made++;
      await tx
        .insert(projectRepos)
        .values({ hive, repo: s.repo, projectId: p.id, isPrimary: true })
        .onConflictDoNothing();
      if (s.homeChannel) {
        await tx
          .insert(channelAssignments)
          .values({
            hive,
            channelId: s.homeChannel,
            scope: "project",
            projectId: p.id,
            isHome: true,
            assignedBy: seeder,
          })
          .onConflictDoNothing();
      }
      if (s.agents.length) {
        await tx
          .insert(projectAgents)
          .values(
            s.agents.map((agentPubkey) => ({
              hive,
              projectId: p.id,
              agentPubkey,
            })),
          )
          .onConflictDoNothing();
      }
    }
    return made;
  });
}

type Links = Pick<ProjectPatch, "repos" | "agents">;

/** The project's links as they stand inside the transaction. */
async function currentLinks(tx: Tx, hive: string, projectId: string) {
  const [repos, agents] = await Promise.all([
    tx
      .select()
      .from(projectRepos)
      .where(
        and(eq(projectRepos.hive, hive), eq(projectRepos.projectId, projectId)),
      ),
    tx
      .select()
      .from(projectAgents)
      .where(
        and(
          eq(projectAgents.hive, hive),
          eq(projectAgents.projectId, projectId),
        ),
      ),
  ]);
  return {
    repos: repos
      .map((r) => ({ repo: r.repo, primary: r.isPrimary }))
      .sort((a, b) => a.repo.localeCompare(b.repo)),
    agents: agents
      .map((a) => ({ pubkey: a.agentPubkey, role: a.role }))
      .sort((a, b) => a.pubkey.localeCompare(b.pubkey)),
  };
}

/** Applies repo and agent adds and removes; a repo held elsewhere is a 409. */
async function writeLinks(
  tx: Tx,
  hive: string,
  projectId: string,
  links: Links,
) {
  const add = links.repos?.add ?? [];
  const remove = links.repos?.remove ?? [];
  if (add.filter((r) => r.primary).length > 1) {
    throw new RegistryError("only one repo can be the primary", 400);
  }
  if (remove.length) {
    await tx
      .delete(projectRepos)
      .where(
        and(
          eq(projectRepos.hive, hive),
          eq(projectRepos.projectId, projectId),
          inArray(projectRepos.repo, remove),
        ),
      );
  }
  if (add.length) {
    const held = await tx
      .select({ repo: projectRepos.repo, slug: projects.slug })
      .from(projectRepos)
      .innerJoin(projects, eq(projects.id, projectRepos.projectId))
      .where(
        and(
          eq(projectRepos.hive, hive),
          inArray(
            projectRepos.repo,
            add.map((r) => r.repo),
          ),
          ne(projectRepos.projectId, projectId),
        ),
      );
    if (held.length) {
      const [h] = held;
      throw new RegistryError(`${h.repo} is already in project ${h.slug}`, 409);
    }
    if (add.some((r) => r.primary)) {
      await tx
        .update(projectRepos)
        .set({ isPrimary: false })
        .where(
          and(
            eq(projectRepos.hive, hive),
            eq(projectRepos.projectId, projectId),
          ),
        );
    }
    for (const r of add) {
      // Updates only a row this project already holds: a repo another
      // project took since the check above returns nothing, so it's a 409.
      const done = await tx
        .insert(projectRepos)
        .values({
          hive,
          repo: r.repo,
          projectId,
          isPrimary: r.primary ?? false,
        })
        .onConflictDoUpdate({
          target: [projectRepos.hive, projectRepos.repo],
          set: {
            isPrimary: sql`coalesce(${r.primary ?? null}::boolean, ${projectRepos.isPrimary})`,
          },
          setWhere: eq(projectRepos.projectId, projectId),
        })
        .returning({ repo: projectRepos.repo });
      if (!done.length) {
        throw new RegistryError(`${r.repo} is already in another project`, 409);
      }
    }
  }
  const agentAdd = links.agents?.add ?? [];
  const agentRemove = links.agents?.remove ?? [];
  if (agentRemove.length) {
    await tx
      .delete(projectAgents)
      .where(
        and(
          eq(projectAgents.hive, hive),
          eq(projectAgents.projectId, projectId),
          inArray(projectAgents.agentPubkey, agentRemove),
        ),
      );
  }
  for (const a of agentAdd) {
    await tx
      .insert(projectAgents)
      .values({ hive, projectId, agentPubkey: a.pubkey, role: a.role ?? null })
      .onConflictDoUpdate({
        target: [
          projectAgents.hive,
          projectAgents.projectId,
          projectAgents.agentPubkey,
        ],
        set: { role: a.role ?? null },
      });
  }
}

const fieldsOf = (p: Project) => ({
  name: p.name,
  short_label: p.shortLabel,
  release_model: p.releaseModel,
  default_branch: p.defaultBranch,
  dev_branch: p.devBranch,
  sort_order: p.sortOrder,
  archived: p.archivedAt !== null,
});

/** The fields and links that differ, as {before, after}. */
function changed(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      b[k] = before[k] ?? null;
      a[k] = after[k] ?? null;
    }
  }
  return { before: b, after: a };
}

const isUnique = (err: unknown, constraint?: string): boolean => {
  const e = err as { code?: string; constraint?: string; cause?: unknown };
  if (e?.code === "23505") return !constraint || e.constraint === constraint;
  return e?.cause ? isUnique(e.cause, constraint) : false;
};

/** Turns a duplicate signed event into a 409 rather than a 500. */
async function guardReplay<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (isUnique(err, "registry_revisions_pkey")) {
      throw new RegistryError("This change was already saved.", 409);
    }
    if (isUnique(err, "projects_hive_slug_uq")) {
      throw new RegistryError("A project already has that slug.", 409);
    }
    if (isUnique(err)) throw new RegistryError(STALE_EDIT, 409);
    throw err;
  }
}

function checkBranches(f: {
  release_model: string;
  dev_branch: string | null;
}) {
  if (f.release_model === "app_dev" && !f.dev_branch) {
    throw new RegistryError(
      "an app with a dev branch needs the branch name",
      400,
    );
  }
}

/**
 * Applies one signed edit to a project: locks it, checks the base revision,
 * writes the fields and links, bumps the revision and logs the change, all in
 * one transaction.
 */
export function applyProjectEdit(
  hive: string,
  slug: string,
  patch: ProjectPatch,
  signed: NostrEvent,
): Promise<ProjectView> {
  return guardReplay(async () => {
    await historyDb().transaction(async (tx) => {
      const [p] = await tx
        .select()
        .from(projects)
        .where(and(eq(projects.hive, hive), eq(projects.slug, slug)))
        .for("update");
      if (!p) throw new RegistryError("No project has that slug.", 404);
      if (p.revision !== patch.base_revision) {
        throw new RegistryError(STALE_EDIT, 409);
      }
      const before = {
        ...fieldsOf(p),
        ...(await currentLinks(tx, hive, p.id)),
      };
      const next = { ...fieldsOf(p), ...patch.set };
      checkBranches(next);
      await writeLinks(tx, hive, p.id, patch);
      const now = new Date();
      await tx
        .update(projects)
        .set({
          name: next.name,
          shortLabel: next.short_label,
          releaseModel: next.release_model,
          defaultBranch: next.default_branch,
          devBranch: next.dev_branch,
          sortOrder: next.sort_order,
          archivedAt: next.archived ? (p.archivedAt ?? now) : null,
          revision: p.revision + 1,
          updatedAt: now,
        })
        .where(eq(projects.id, p.id));
      const after = { ...next, ...(await currentLinks(tx, hive, p.id)) };
      await tx.insert(registryRevisions).values({
        eventId: signed.id,
        hive,
        projectId: p.id,
        revision: p.revision + 1,
        signerPubkey: signed.pubkey,
        note: patch.note ?? null,
        change: changed(before, after),
        signedEvent: signed,
      });
    });
    const out = await getProject(hive, slug);
    if (!out) throw new RegistryError("No project has that slug.", 404);
    return out;
  });
}

/** Creates a project from a signed event, at revision 1 with its log row. */
export function createProject(
  hive: string,
  input: NewProject,
  signed: NostrEvent,
): Promise<ProjectView> {
  return guardReplay(async () => {
    await historyDb().transaction(async (tx) => {
      const fields = {
        short_label: null,
        release_model: "unknown" as const,
        default_branch: "main",
        dev_branch: null,
        sort_order: 0,
        ...input.set,
      };
      checkBranches(fields);
      const [p] = await tx
        .insert(projects)
        .values({
          hive,
          slug: input.slug,
          name: fields.name,
          shortLabel: fields.short_label,
          releaseModel: fields.release_model,
          defaultBranch: fields.default_branch,
          devBranch: fields.dev_branch,
          sortOrder: fields.sort_order,
          revision: 1,
        })
        .returning();
      await writeLinks(tx, hive, p.id, input);
      const after = { ...fieldsOf(p), ...(await currentLinks(tx, hive, p.id)) };
      await tx.insert(registryRevisions).values({
        eventId: signed.id,
        hive,
        projectId: p.id,
        revision: 1,
        signerPubkey: signed.pubkey,
        note: input.note ?? null,
        change: { before: null, after: { slug: p.slug, ...after } },
        signedEvent: signed,
      });
    });
    const out = await getProject(hive, input.slug);
    if (!out) throw new RegistryError("No project has that slug.", 404);
    return out;
  });
}

/**
 * Assigns a channel to a project or the hive, or unassigns it (scope null),
 * from a signed event. A channel's revision is its own, separate from the
 * project's; an unassigned channel's is its last logged one, so the log's
 * per-channel revisions stay unique.
 */
export function assignChannel(
  hive: string,
  channelId: string,
  input: ChannelAssignment,
  signed: NostrEvent,
): Promise<ChannelAssignmentView | null> {
  return guardReplay(async () => {
    await historyDb().transaction(async (tx) => {
      // The row may not exist yet, so lock the key rather than the row.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`channel:${hive}:${channelId}`}))`,
      );
      const [row] = await tx
        .select()
        .from(channelAssignments)
        .where(
          and(
            eq(channelAssignments.hive, hive),
            eq(channelAssignments.channelId, channelId),
          ),
        );
      const [logged] = await tx
        .select({
          revision: sql<number>`coalesce(max(${registryRevisions.revision}), 0)`,
        })
        .from(registryRevisions)
        .where(
          and(
            eq(registryRevisions.hive, hive),
            eq(registryRevisions.channelId, channelId),
          ),
        );
      const current = Math.max(
        row?.revision ?? 0,
        Number(logged?.revision ?? 0),
      );
      if (current !== input.base_revision)
        throw new RegistryError(STALE_EDIT, 409);
      const revision = current + 1;

      let projectId: string | null = null;
      if (input.scope === "project") {
        const [p] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.hive, hive),
              eq(projects.slug, input.project ?? ""),
            ),
          );
        if (!p) throw new RegistryError("No project has that slug.", 404);
        projectId = p.id;
      }
      const before = row
        ? {
            scope: row.scope,
            project_id: row.projectId,
            is_home: row.isHome,
            label: row.label,
          }
        : { scope: null };
      const after =
        input.scope === null
          ? { scope: null }
          : {
              scope: input.scope,
              project_id: projectId,
              is_home: input.is_home,
              label: input.label,
            };
      let replacedHome: string | null = null;
      if (input.scope === null) {
        if (row) {
          await tx
            .delete(channelAssignments)
            .where(
              and(
                eq(channelAssignments.hive, hive),
                eq(channelAssignments.channelId, channelId),
              ),
            );
        }
      } else {
        if (input.is_home && projectId) {
          // A project has one home: the old one stays in the project, not home.
          const old = await tx
            .update(channelAssignments)
            .set({ isHome: false })
            .where(
              and(
                eq(channelAssignments.projectId, projectId),
                eq(channelAssignments.isHome, true),
                ne(channelAssignments.channelId, channelId),
              ),
            )
            .returning({ channelId: channelAssignments.channelId });
          replacedHome = old[0]?.channelId ?? null;
        }
        const values = {
          scope: input.scope,
          projectId,
          isHome: input.is_home,
          label: input.label,
          assignedBy: signed.pubkey,
          assignedAt: new Date(),
          revision,
        };
        await tx
          .insert(channelAssignments)
          .values({ hive, channelId, ...values })
          .onConflictDoUpdate({
            target: [channelAssignments.hive, channelAssignments.channelId],
            set: values,
          });
      }
      await tx.insert(registryRevisions).values({
        eventId: signed.id,
        hive,
        projectId,
        channelId,
        revision,
        signerPubkey: signed.pubkey,
        note: input.note ?? null,
        change: replacedHome
          ? { before, after, replaced_home: replacedHome }
          : { before, after },
        signedEvent: signed,
      });
    });
    const all = await listChannelAssignments(hive);
    return all.find((a) => a.channelId === channelId) ?? null;
  });
}
