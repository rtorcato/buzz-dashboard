import { createHash } from "node:crypto";
import { z } from "zod";
import { CHANNEL_SCOPES, RELEASE_MODELS } from "./history-schema";
import { type NostrEvent, verifyEvent } from "./relay";

// The project registry (#166): the pure parts, so they test without a
// database. project-store.ts does the reads and writes.
//
// Every edit is signed by the owner: the browser signs one NIP-98 HTTP-auth
// event (kind 27235) per save, sent as `Authorization: Nostr <base64 event>`
// and never published to the relay. Its `payload` tag is the SHA-256 of the
// request body, which holds the patch and the revision it was made against.

export const HTTP_AUTH_KIND = 27235;
/** How far a signed edit's created_at may be from the server clock. */
const MAX_SKEW_S = 60;

/** The hive key: the relay URL as hiveStatements stores it, or null. */
export function hiveOf(relayUrl: string | undefined): string | null {
  try {
    const url = new URL(relayUrl ?? "");
    return url.protocol === "wss:" || url.protocol === "ws:" ? url.href : null;
  } catch {
    return null;
  }
}

const EventSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{64}$/),
  pubkey: z.string().regex(/^[0-9a-f]{64}$/),
  created_at: z.number().int(),
  kind: z.number().int(),
  tags: z.array(z.array(z.string())),
  content: z.string(),
  sig: z.string().regex(/^[0-9a-f]{128}$/),
});

const tag = (tags: string[][], name: string) =>
  tags.find((t) => t[0] === name)?.[1];

export const bodyHash = (body: string) =>
  createHash("sha256").update(body, "utf8").digest("hex");

/**
 * Checks the signed event in an `Authorization: Nostr …` header for one write:
 * kind, freshness, the exact URL and method, the body hash, the signature, and
 * that the signer is an owner. Returns the event, or why it was refused.
 */
export function verifySignedEdit(
  header: string | null,
  {
    url,
    method,
    body,
    owners,
    now,
  }: {
    /** The full URL the event must name: the public origin plus the path. */
    url: string;
    method: string;
    body: string;
    owners: string[];
    now: number;
  },
): { event: NostrEvent } | { error: string } {
  const m = /^Nostr ([A-Za-z0-9+/=_-]+)$/.exec(header?.trim() ?? "");
  if (!m) return { error: "missing signature" };
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(m[1], "base64").toString("utf8"));
  } catch {
    return { error: "malformed event" };
  }
  const parsed = EventSchema.safeParse(raw);
  if (!parsed.success) return { error: "malformed event" };
  const e = parsed.data;
  if (e.kind !== HTTP_AUTH_KIND) return { error: "wrong kind" };
  if (Math.abs(now - e.created_at) > MAX_SKEW_S) return { error: "expired" };
  if (tag(e.tags, "u") !== url) return { error: "wrong url" };
  if (tag(e.tags, "method") !== method) return { error: "wrong method" };
  if (tag(e.tags, "payload") !== bodyHash(body)) {
    return { error: "body doesn’t match the signature" };
  }
  if (!verifyEvent(e)) return { error: "bad signature" };
  if (!owners.includes(e.pubkey)) return { error: "not the owner" };
  return { event: e };
}

const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const Repo = z
  .string()
  .transform((r) => r.trim().toLowerCase())
  .pipe(z.string().regex(/^[a-z0-9._-]+\/[a-z0-9._-]+$/));
const Pubkey = z.string().regex(/^[0-9a-f]{64}$/);
const Branch = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[^\s~^:?*[\\]+$/);
const Note = z.string().trim().max(500).optional();

const ProjectFields = z.object({
  name: z.string().trim().min(1).max(100),
  short_label: z
    .string()
    .regex(/^[A-Z0-9]{1,3}$/)
    .nullable(),
  release_model: z.enum(RELEASE_MODELS),
  default_branch: Branch,
  dev_branch: Branch.nullable(),
  sort_order: z.number().int().min(-1_000_000).max(1_000_000),
  archived: z.boolean(),
});

const Links = z
  .object({
    repos: z
      .object({
        add: z
          .array(z.object({ repo: Repo, primary: z.boolean().optional() }))
          .max(50)
          .default([]),
        remove: z.array(Repo).max(50).default([]),
      })
      .optional(),
    agents: z
      .object({
        add: z
          .array(
            z.object({
              pubkey: Pubkey,
              role: z.string().trim().max(50).nullable().optional(),
            }),
          )
          .max(100)
          .default([]),
        remove: z.array(Pubkey).max(100).default([]),
      })
      .optional(),
  })
  .strict();

/** The body of a signed project edit. */
export const ProjectPatchSchema = z
  .object({
    base_revision: z.number().int().min(0),
    note: Note,
    set: ProjectFields.partial().strict().default({}),
  })
  .extend(Links.shape)
  .strict();
export type ProjectPatch = z.infer<typeof ProjectPatchSchema>;

/** The body of a signed project create. */
export const NewProjectSchema = z
  .object({
    slug: Slug,
    note: Note,
    set: ProjectFields.omit({ archived: true })
      .partial()
      .required({ name: true })
      .strict(),
  })
  .extend(Links.shape)
  .strict();
export type NewProject = z.infer<typeof NewProjectSchema>;

/** The body of a signed channel assignment; scope null unassigns it. */
export const ChannelAssignmentSchema = z
  .object({
    base_revision: z.number().int().min(0),
    note: Note,
    scope: z.enum(CHANNEL_SCOPES).nullable(),
    project: Slug.optional(),
    is_home: z.boolean().default(false),
    label: z.string().trim().max(100).nullable().default(null),
  })
  .strict()
  .refine((a) => (a.scope === "project") === (a.project !== undefined), {
    message: "a project assignment names the project, and only it does",
  })
  .refine((a) => !a.is_home || a.scope === "project", {
    message: "only a project channel can be its home",
  });
export type ChannelAssignment = z.infer<typeof ChannelAssignmentSchema>;

export class RegistryError extends Error {
  constructor(
    message: string,
    /** 400 bad input, 404 missing, 409 conflict. */
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
  }
}

/** Shown for a stale base revision, as DESIGN.md words it. */
export const STALE_EDIT = "Someone else changed this since you opened it.";

export const isChannelId = (id: string) => /^[A-Za-z0-9._:-]{1,128}$/.test(id);

/** A repo's name as a project slug: lowercase, dashes, at most 63 long. */
export function slugFor(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/, "");
  return s || "project";
}

export type SeedProject = {
  slug: string;
  name: string;
  repo: string;
  /** The channel whose name is the repo's name, if any. */
  homeChannel: string | null;
  agents: string[];
};

/**
 * What the first seed writes for a hive (#166): one project per repo under
 * GITHUB_OWNERS with stored activity, its home channel when a channel has the
 * repo's name, and that channel's members who are agents. Pure, so the store
 * only has to insert it.
 */
export function seedPlan({
  repos,
  owners,
  channels,
  members,
  agentPubkeys,
}: {
  /** Repos with stored events, "owner/name" in any case. */
  repos: string[];
  /** GITHUB_OWNERS. */
  owners: string[];
  /** Relay channel id to name. */
  channels: Record<string, string>;
  /** Relay channel id to member pubkeys. */
  members: Record<string, string[]>;
  /** Pubkeys of the hive's agents; other members (the owner) aren't linked. */
  agentPubkeys: Set<string>;
}): SeedProject[] {
  const ownerSet = new Set(owners.map((o) => o.toLowerCase()));
  const wanted = [...new Set(repos.map((r) => r.trim().toLowerCase()))]
    .filter((r) => /^[a-z0-9._-]+\/[a-z0-9._-]+$/.test(r))
    .filter((r) => ownerSet.has(r.split("/")[0]))
    .sort();
  // The first channel with each name, by id, so a re-run picks the same one.
  const byName = new Map<string, string>();
  for (const [id, name] of Object.entries(channels).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const key = name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, id);
  }
  const usedSlugs = new Set<string>();
  const usedChannels = new Set<string>();
  return wanted.map((repo) => {
    const [owner, name] = repo.split("/");
    let slug = slugFor(name);
    if (usedSlugs.has(slug)) slug = slugFor(`${name}-${owner}`);
    for (let i = 2; usedSlugs.has(slug); i++) slug = slugFor(`${name}-${i}`);
    usedSlugs.add(slug);
    let home = byName.get(name) ?? null;
    if (home && usedChannels.has(home)) home = null;
    if (home) usedChannels.add(home);
    const agents = home
      ? [...new Set(members[home] ?? [])].filter((p) => agentPubkeys.has(p))
      : [];
    return { slug, name, repo, homeChannel: home, agents: agents.sort() };
  });
}

/** Channel id to member pubkeys, from the relay's NIP-29 member lists. */
export function membersFrom(events: NostrEvent[]): Record<string, string[]> {
  const newest = new Map<string, NostrEvent>();
  for (const e of events) {
    if (e.kind !== 39002) continue;
    const id = tag(e.tags, "d");
    if (!id) continue;
    const old = newest.get(id);
    if (!old || old.created_at < e.created_at) newest.set(id, e);
  }
  return Object.fromEntries(
    [...newest].map(([id, e]) => [
      id,
      e.tags
        .filter((t) => t[0] === "p" && /^[0-9a-f]{64}$/.test(t[1] ?? ""))
        .map((t) => t[1]),
    ]),
  );
}
