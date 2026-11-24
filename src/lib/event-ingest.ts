import { z } from "zod";
import type { NewHistoryEvent } from "./history-schema";

// Event ingest (#199), the pure parts, so they test without a database and
// the Settings card can share the same rules in the browser.
// Agents and watchers on any platform POST events to /api/events with their
// platform's bearer token. The row lands in `events` with source "ingest", to
// Devastator's schema v2 on the issue; these rules mirror its check
// constraint, which stays the last line of defence.

/** A platform key: "buzz", "claude-code", "github-actions". */
export const PLATFORM_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** An open set: validated, never listed. */
export const KIND_RE = /^[a-z][a-z0-9_]{0,47}$/;
const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
/** Printable ASCII with no whitespace, as Postgres's [[:graph:]] in the check. */
const AGENT_ID_RE = /^[\x21-\x7e]{1,128}$/;
const REPO_RE = /^[a-z0-9._-]+\/[a-z0-9._-]+$/;
/** A link host: lowercase, dot-separated labels. */
export const HOST_RE =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
export const MAX_LINK_HOSTS = 32;

/** A request body is a few KB at most; this leaves room for a 4000-char detail. */
export const MAX_BODY_BYTES = 16_384;
/** How far ahead of the server clock occurredAt may be. */
const MAX_FUTURE_MS = 5 * 60_000;

// Code points, as Postgres's char_length counts them.
const chars = (min: number, max: number) =>
  z.string().refine((s) => {
    const n = [...s].length;
    return n >= min && n <= max;
  }, `must be ${min} to ${max} characters`);

/**
 * The request body. Strict: an unknown field is a 400, so a `platform` or
 * `source` in the body is refused rather than silently ignored. The platform
 * always comes from the token.
 */
export const IngestBodySchema = z.strictObject({
  /** Idempotency key; a retry with the same id is a no-op. */
  id: z.string().regex(ID_RE).optional(),
  agentId: z.string().regex(AGENT_ID_RE),
  /** Display name. */
  agent: chars(1, 64),
  kind: z.string().regex(KIND_RE),
  title: chars(1, 200),
  detail: chars(0, 4000).optional(),
  repo: z
    .string()
    .transform((s) => s.toLowerCase())
    .pipe(z.string().regex(REPO_RE))
    .optional(),
  link: z.string().max(2048).optional(),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
});
export type IngestBody = z.infer<typeof IngestBodySchema>;

/** What the matched token says about the sender. */
export type TokenMatch = {
  platform: string;
  linkHosts: string[];
  last4: string;
};

export type IngestResult =
  | { ok: true; row: NewHistoryEvent & { sourceId: string } }
  | { ok: false; error: string; issues?: string[] };

/**
 * True when `link` is an https URL whose host is on the platform's allowlist.
 * No credentials or port: a link is something the owner clicks.
 */
export function linkAllowed(link: string, hosts: string[]): boolean {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.port &&
    hosts.includes(url.hostname.toLowerCase())
  );
}

/** Validates one body against its token and builds the row to insert. */
export function buildIngestRow(
  body: unknown,
  token: TokenMatch,
  opts: { now: Date; retentionDays: number; uuid?: () => string },
): IngestResult {
  const parsed = IngestBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid event",
      issues: parsed.error.issues.map(
        (i) => `${i.path.join(".") || "body"}: ${i.message}`,
      ),
    };
  }
  const b = parsed.data;
  const now = opts.now.getTime();
  const at = b.occurredAt ? new Date(b.occurredAt) : opts.now;
  if (at.getTime() > now + MAX_FUTURE_MS) {
    return { ok: false, error: "occurredAt is in the future" };
  }
  if (at.getTime() < now - opts.retentionDays * 86_400_000) {
    return {
      ok: false,
      error: "occurredAt is older than the retention window",
    };
  }
  if (b.link !== undefined && !linkAllowed(b.link, token.linkHosts)) {
    return { ok: false, error: "link host is not allowed for this platform" };
  }
  return {
    ok: true,
    row: {
      source: "ingest",
      sourceId: `${token.platform}:${b.id ?? (opts.uuid ?? (() => crypto.randomUUID()))()}`,
      platform: token.platform,
      agentId: b.agentId,
      actor: b.agent,
      kind: b.kind,
      at,
      repo: b.repo ?? null,
      title: b.title,
      body: b.detail ?? null,
      url: b.link ?? null,
      data: { via: "ingest", token: token.last4 },
    },
  };
}

/** A platform's default link allowlist: GitHub and the relay's host. */
export function defaultLinkHosts(relayUrl: string | undefined): string[] {
  const hosts = ["github.com"];
  try {
    const host = new URL(relayUrl ?? "").hostname.toLowerCase();
    if (host && HOST_RE.test(host) && !hosts.includes(host)) hosts.push(host);
  } catch {
    // No relay configured: GitHub only.
  }
  return hosts;
}

/** Why `raw` isn't a host, or null when it is one. */
export function hostError(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v.includes("://") || v.includes("/")) {
    let host = "docs.example.org";
    try {
      host = new URL(v.includes("://") ? v : `https://${v}`).hostname || host;
    } catch {}
    return `That’s a URL. Enter just the host, like ${host}.`;
  }
  return HOST_RE.test(v)
    ? null
    : "Not a hostname. Use letters, digits, dots and dashes.";
}

/** The owner's link host list: lowercase, deduplicated, each a valid host. */
export const LinkHostsSchema = z
  .array(
    z
      .string()
      .trim()
      .transform((s) => s.toLowerCase())
      .pipe(z.string().regex(HOST_RE)),
  )
  .max(MAX_LINK_HOSTS)
  .transform((hosts) => [...new Set(hosts)]);

/** Body of the owner's create/rotate call. */
export const RotateBodySchema = z.strictObject({
  platform: z.string().regex(PLATFORM_RE),
  /** Only used when the platform is new; rotation keeps the stored list. */
  linkHosts: LinkHostsSchema.optional(),
});

/** Body of the owner's link-hosts edit. */
export const LinkHostsBodySchema = z.strictObject({
  linkHosts: LinkHostsSchema,
});
