import "server-only";

import { connection } from "next/server";
import { cache } from "react";
import { envList, graphql, secs } from "./github";

// The Releases reader (#71, DESIGN.md → Releases): per watched repo, the
// latest tag, what merged on the default branch since it, release runs waiting
// on an environment approval, red CI on the default branch and the last npm
// publish. Read on the server with the same read-only GITHUB_TOKEN as
// github.ts; the token only ever goes to api.github.com.

/** Conventional-commit types that cut a release. */
export const RELEASING_TYPES = new Set(["feat", "fix", "perf"]);

export type Bump = "major" | "minor" | "patch";

export type Commit = {
  oid: string;
  short: string;
  /** The subject without its type prefix and PR suffix. */
  subject: string;
  /** "feat", "fix", …, or null for a non-conventional subject. */
  type: string | null;
  breaking: boolean;
  /** The PR number from a squash subject's "(#123)", or null. */
  pr: number | null;
  /** Filled in by the page from the PR's `@Name` header, when it has one. */
  agent?: string | null;
  /** Unix seconds. */
  at: number;
};

export type WaitingRun = {
  id: number;
  number: number;
  /** The workflow file, e.g. "release.yml". */
  workflow: string;
  url: string;
  /** Unix seconds. */
  createdAt: number;
};

export type RedCi = {
  /** The failing check, e.g. "test (ubuntu, node 22)". */
  check: string;
  url: string | null;
  /** Unix seconds the check failed. */
  since: number;
};

export type Npm = { version: string; publishedAt: number | null };

export type RepoRelease = {
  /** "owner/name". */
  repo: string;
  url: string;
  branch: string;
  tag: { name: string; at: number } | null;
  /** Commits on the default branch since the tag, newest first. */
  commits: Commit[];
  /** True when the history read stopped before reaching the tag. */
  moreCommits: boolean;
  head: { short: string; subject: string } | null;
  waiting: WaitingRun[];
  redCi: RedCi | null;
  /** The root package.json name, or null when private or absent. */
  packageName: string | null;
  /** The npm latest, or null when the package isn't on npm. */
  npm: Npm | null;
};

export type Releases = {
  repos: RepoRelease[];
  /** Repos whose release runs couldn't be read (e.g. no Actions: read). */
  runsUnread: string[];
};

// ---------------------------------------------------------------- parsing

const CC_RE = /^(\w+)(?:\([^)]*\))?(!)?:\s*(.*)$/;
const PR_RE = /\s*\(#(\d+)\)\s*$/;

/** A commit message's first line, split into its conventional parts. */
export function parseCommit(
  message: string,
): Pick<Commit, "subject" | "type" | "breaking" | "pr"> {
  const [first = "", ...rest] = message.split("\n");
  const pr = PR_RE.exec(first);
  const line = pr ? first.slice(0, pr.index) : first;
  const m = CC_RE.exec(line.trim());
  const footer = /^BREAKING[ -]CHANGE:/m.test(rest.join("\n"));
  return {
    subject: (m ? m[3] : line).trim(),
    type: m ? m[1].toLowerCase() : null,
    breaking: Boolean(m?.[2]) || footer,
    pr: pr ? Number(pr[1]) : null,
  };
}

export const isReleasing = (c: Pick<Commit, "type" | "breaking">) =>
  c.breaking || (c.type !== null && RELEASING_TYPES.has(c.type));

/** The semantic-release style bump the commits ask for, or null for none. */
export function bumpOf(commits: Pick<Commit, "type" | "breaking">[]) {
  if (commits.some((c) => c.breaking)) return "major" as const;
  if (commits.some((c) => c.type === "feat")) return "minor" as const;
  if (commits.some((c) => c.type === "fix" || c.type === "perf"))
    return "patch" as const;
  return null;
}

const SEMVER_RE = /(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;

/** The version in a tag: "v2.3.1" → "2.3.1", "@acme/lib@1.0.0" → "1.0.0". */
export function tagVersion(tag: string): string | null {
  return SEMVER_RE.exec(tag)?.[0] ?? null;
}

/** The tag the bump would give, keeping the tag's prefix ("v", "@acme/lib@"). */
export function nextTag(tag: string, bump: Bump): string | null {
  const m = SEMVER_RE.exec(tag);
  if (!m) return null;
  let [major, minor, patch] = [m[1], m[2], m[3]].map(Number);
  const pre = m[0].includes("-");
  if (bump === "major") [major, minor, patch] = [major + 1, 0, 0];
  else if (bump === "minor") [minor, patch] = [minor + 1, 0];
  // A prerelease's patch bump finishes that version, as semver does.
  else if (!pre) patch += 1;
  return `${tag.slice(0, m.index)}${major}.${minor}.${patch}`;
}

/** Per type, how many commits, in the order the chips show them. */
export function typeCounts(commits: Commit[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const c of commits) {
    const key = `${c.type ?? "other"}${c.breaking ? "!" : ""}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const rank = (k: string) =>
    k.endsWith("!")
      ? 0
      : ["feat", "fix", "perf"].includes(k)
        ? ["feat", "fix", "perf"].indexOf(k) + 1
        : 9;
  return [...counts].sort(
    ([a], [b]) => rank(a) - rank(b) || a.localeCompare(b),
  );
}

// ------------------------------------------------------------ derived state

export const releasing = (r: RepoRelease) => r.commits.filter(isReleasing);

export type RunState =
  | { kind: "waiting"; since: number }
  | { kind: "red" }
  | { kind: "not-started" }
  | { kind: "published"; at: number | null }
  | { kind: "none" };

/** The Release run column. */
export function runState(r: RepoRelease): RunState {
  if (r.waiting.length) {
    return {
      kind: "waiting",
      since: Math.min(...r.waiting.map((w) => w.createdAt)),
    };
  }
  if (r.redCi) return { kind: "red" };
  if (releasing(r).length) return { kind: "not-started" };
  const v = r.tag && tagVersion(r.tag.name);
  if (r.npm && v && r.npm.version === v) {
    return { kind: "published", at: r.npm.publishedAt };
  }
  return { kind: "none" };
}

/** Waiting, then red CI, then most releasing commits, then other commits. */
export function sortRepos(repos: RepoRelease[]): RepoRelease[] {
  const rank = (r: RepoRelease) =>
    r.waiting.length
      ? 0
      : r.redCi
        ? 1
        : releasing(r).length
          ? 2
          : r.commits.length
            ? 3
            : 4;
  return repos.toSorted(
    (a, b) =>
      rank(a) - rank(b) ||
      (rank(a) === 2 ? releasing(b).length - releasing(a).length : 0) ||
      a.repo.localeCompare(b.repo),
  );
}

// ----------------------------------------------------------------- reading

type RawCommitTarget = { oid: string; committedDate: string };
type RawTag = {
  name: string;
  target:
    | ({ __typename: "Commit" } & RawCommitTarget)
    | { __typename: "Tag"; target: Partial<RawCommitTarget> | null }
    | { __typename: string };
};
type RawListRepo = {
  nameWithOwner: string;
  url: string;
  isFork: boolean;
  tags: { nodes: (RawTag | null)[] };
  workflow: { id: string } | null;
} | null;

type RawContext =
  | {
      __typename: "CheckRun";
      name: string;
      conclusion: string | null;
      detailsUrl: string | null;
      completedAt: string | null;
    }
  | {
      __typename: "StatusContext";
      context: string;
      state: string;
      targetUrl: string | null;
      createdAt: string;
    }
  | null;

export type RawDetail = {
  pkg: { text?: string } | null;
  defaultBranchRef: {
    name: string;
    target: {
      history?: {
        nodes: ({
          oid: string;
          abbreviatedOid: string;
          message: string;
          committedDate: string;
        } | null)[];
      };
      statusCheckRollup?: {
        state: string;
        contexts: { nodes: RawContext[] };
      } | null;
    } | null;
  } | null;
} | null;

// ponytail: the 100 most recently pushed repos per owner, newest tag by commit
// date. A monorepo's newest tag is one package's, so "since the tag" is a
// guess there; per-package tags can come later.
export const LIST_QUERY = `query($owner: String!) { repositoryOwner(login: $owner) {
  repositories(first: 100, isArchived: false, orderBy: { field: PUSHED_AT, direction: DESC }) { nodes {
    nameWithOwner url isFork
    tags: refs(refPrefix: "refs/tags/", first: 1, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
      nodes { name target { __typename ... on Commit { oid committedDate }
        ... on Tag { target { ... on Commit { oid committedDate } } } } } }
    workflow: object(expression: "HEAD:.github/workflows/release.yml") { id } } } } }`;

/** Commits read per repo. Squash merges make one per PR, so this is plenty. */
export const HISTORY = 50;

const DETAIL_FRAGMENT = `fragment D on Repository {
  pkg: object(expression: "HEAD:package.json") { ... on Blob { text } }
  defaultBranchRef { name target { ... on Commit {
    history(first: ${HISTORY}) { nodes { oid abbreviatedOid message committedDate } }
    statusCheckRollup { state contexts(first: 50) { nodes { __typename
      ... on CheckRun { name conclusion detailsUrl completedAt }
      ... on StatusContext { context state targetUrl createdAt } } } } } } } }`;

/** One request for several repos; names travel as variables. */
export function detailQuery(count: number): string {
  const vars = Array.from(
    { length: count },
    (_, i) => `$o${i}: String!, $n${i}: String!`,
  ).join(", ");
  const fields = Array.from(
    { length: count },
    (_, i) => `r${i}: repository(owner: $o${i}, name: $n${i}) { ...D }`,
  ).join("\n");
  return `query(${vars}) { ${fields} }\n${DETAIL_FRAGMENT}`;
}

/** The tag's commit, through an annotated tag object when there is one. */
function tagCommit(tag: RawTag): RawCommitTarget | null {
  const t = tag.target as {
    __typename: string;
    oid?: string;
    committedDate?: string;
    target?: Partial<RawCommitTarget> | null;
  };
  const c = t.__typename === "Tag" ? t.target : t;
  return c?.oid && c.committedDate
    ? { oid: c.oid, committedDate: c.committedDate }
    : null;
}

const githubUrl = (u: string | null | undefined) =>
  u?.startsWith("https://github.com/") ? u : null;

const FAILED = new Set(["FAILURE", "ERROR", "TIMED_OUT", "STARTUP_FAILURE"]);

/** The first failed check on a red head commit, or null when it isn't red. */
export function redCiOf(
  rollup: NonNullable<
    NonNullable<NonNullable<RawDetail>["defaultBranchRef"]>["target"]
  >["statusCheckRollup"],
): RedCi | null {
  if (!rollup || !FAILED.has(rollup.state)) return null;
  for (const c of rollup.contexts.nodes) {
    if (c?.__typename === "CheckRun" && FAILED.has(c.conclusion ?? "")) {
      return {
        check: c.name,
        url: githubUrl(c.detailsUrl),
        since: c.completedAt ? secs(c.completedAt) : 0,
      };
    }
    if (c?.__typename === "StatusContext" && FAILED.has(c.state)) {
      return {
        check: c.context,
        url: githubUrl(c.targetUrl),
        since: secs(c.createdAt),
      };
    }
  }
  return { check: "checks", url: null, since: 0 };
}

const NPM_NAME = /^(@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/;

/** A publishable package name from package.json text, or null. */
export function packageNameOf(text: string | undefined): string | null {
  if (!text) return null;
  try {
    const pkg = JSON.parse(text) as { name?: unknown; private?: unknown };
    return typeof pkg.name === "string" &&
      pkg.private !== true &&
      NPM_NAME.test(pkg.name)
      ? pkg.name
      : null;
  } catch {
    return null;
  }
}

/** One repo from its list node and detail read. Runs and npm come after. */
export function toRepo(
  list: NonNullable<RawListRepo>,
  detail: RawDetail,
): RepoRelease {
  const rawTag = list.tags.nodes[0] ?? null;
  const tc = rawTag ? tagCommit(rawTag) : null;
  const target = detail?.defaultBranchRef?.target ?? null;
  const history = (target?.history?.nodes ?? []).filter((n) => n !== null);
  const commits: Commit[] = [];
  let reached = !tc;
  if (tc) {
    for (const n of history) {
      if (n.oid === tc.oid) {
        reached = true;
        break;
      }
      commits.push({
        oid: n.oid,
        short: n.abbreviatedOid,
        ...parseCommit(n.message),
        at: secs(n.committedDate),
      });
    }
  }
  const head = history[0];
  return {
    repo: list.nameWithOwner,
    url: list.url,
    branch: detail?.defaultBranchRef?.name ?? "main",
    tag: rawTag
      ? { name: rawTag.name, at: tc ? secs(tc.committedDate) : 0 }
      : null,
    commits,
    moreCommits: !reached,
    head: head
      ? {
          short: head.abbreviatedOid,
          subject: head.message.split("\n")[0],
        }
      : null,
    waiting: [],
    redCi: redCiOf(target?.statusCheckRollup ?? null),
    packageName: packageNameOf(detail?.pkg?.text),
    npm: null,
  };
}

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

/** Release runs waiting on an environment approval, oldest first. */
async function waitingRuns(token: string, repo: string) {
  if (!REPO_RE.test(repo)) return [];
  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/runs?status=waiting&per_page=20`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "buzz-dashboard",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as {
    workflow_runs?: {
      id: number;
      run_number: number;
      path: string;
      html_url: string;
      created_at: string;
    }[];
  };
  return (json.workflow_runs ?? [])
    .map(
      (r): WaitingRun => ({
        id: r.id,
        number: r.run_number,
        workflow: r.path.split("/").pop() ?? r.path,
        url: githubUrl(r.html_url) ?? `https://github.com/${repo}/actions`,
        createdAt: secs(r.created_at),
      }),
    )
    .sort((a, b) => a.createdAt - b.createdAt);
}

const NPM_TTL_MS = 10 * 60_000;
const npmCache = new Map<string, { at: number; npm: Npm | null }>();

/** The npm latest of a package, or null when it isn't published. */
async function readNpm(name: string): Promise<Npm | null> {
  const hit = npmCache.get(name);
  if (hit && Date.now() - hit.at < NPM_TTL_MS) return hit.npm;
  // A fixed host; the name is validated and encoded, and no token goes here.
  const res = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(name)}`,
    { cache: "no-store", signal: AbortSignal.timeout(10_000) },
  );
  if (res.status === 404) {
    npmCache.set(name, { at: Date.now(), npm: null });
    return null;
  }
  if (!res.ok) throw new Error(`npm ${name}: HTTP ${res.status}`);
  const doc = (await res.json()) as {
    "dist-tags"?: { latest?: string };
    time?: Record<string, string>;
  };
  const version = doc["dist-tags"]?.latest;
  const at = version ? doc.time?.[version] : undefined;
  const npm = version ? { version, publishedAt: at ? secs(at) : null } : null;
  npmCache.set(name, { at: Date.now(), npm });
  return npm;
}

/** Runs `fn` over `items`, `limit` at a time. */
async function pool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) await fn(item);
    }),
  );
}

// Repos per detail request: 5 took about 2s, well under GitHub's 10s limit.
const PER_REQUEST = 5;

export async function getReleases(token: string): Promise<Releases> {
  const owners = envList("GITHUB_OWNERS");
  if (!owners.length) throw new Error("GITHUB_OWNERS is not set");
  const watched: NonNullable<RawListRepo>[] = [];
  for (const owner of owners) {
    const data = await graphql<{
      repositoryOwner: { repositories: { nodes: RawListRepo[] } } | null;
    }>(token, LIST_QUERY, { owner });
    for (const r of data.repositoryOwner?.repositories.nodes ?? []) {
      // A watched repo has a tag or a release workflow (DESIGN.md).
      if (r && !r.isFork && (r.tags.nodes.length || r.workflow))
        watched.push(r);
    }
  }
  const repos: RepoRelease[] = [];
  for (let i = 0; i < watched.length; i += PER_REQUEST) {
    const chunk = watched.slice(i, i + PER_REQUEST);
    const vars: Record<string, string> = {};
    chunk.forEach((r, j) => {
      const [o, n] = r.nameWithOwner.split("/");
      vars[`o${j}`] = o;
      vars[`n${j}`] = n;
    });
    const data = await graphql<Record<string, RawDetail>>(
      token,
      detailQuery(chunk.length),
      vars,
    );
    chunk.forEach((r, j) => {
      repos.push(toRepo(r, data[`r${j}`] ?? null));
    });
  }
  const runsUnread: string[] = [];
  const withWorkflow = new Set(
    watched.filter((r) => r.workflow).map((r) => r.nameWithOwner),
  );
  // Extras: a failed read leaves that repo's runs or npm empty, not the view.
  await pool(repos, 4, async (r) => {
    if (withWorkflow.has(r.repo)) {
      try {
        r.waiting = await waitingRuns(token, r.repo);
      } catch (err) {
        console.error(`GitHub release runs for ${r.repo}:`, err);
        runsUnread.push(r.repo);
      }
    }
    if (r.packageName) {
      try {
        r.npm = await readNpm(r.packageName);
      } catch (err) {
        console.error("npm:", err);
      }
    }
  });
  return { repos: sortRepos(repos), runsUnread: runsUnread.sort() };
}

export type ReleasesResult =
  | { releases: Releases; fetchedAt: string }
  | { releases: null; error: string };

type Fetched = { releases: Releases; fetchedAt: string };

// The same cadence as github.ts: serve the last read, refresh it behind the
// request after 2 minutes, and never serve one older than 5.
const TTL_MS = 2 * 60_000;
const STALE_MS = 5 * 60_000;
let last: Fetched | undefined;
let inflight: Promise<Fetched> | undefined;

function refresh(token: string): Promise<Fetched> {
  inflight ??= getReleases(token)
    .then((releases) => {
      last = { releases, fetchedAt: new Date().toISOString() };
      return last;
    })
    .finally(() => {
      inflight = undefined;
    });
  return inflight;
}

export async function readReleases(): Promise<ReleasesResult> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { releases: null, error: "GITHUB_TOKEN is not set" };
  const age = last ? Date.now() - Date.parse(last.fetchedAt) : Infinity;
  if (last && age < STALE_MS) {
    if (age >= TTL_MS) refresh(token).catch(() => {});
    return last;
  }
  try {
    return await refresh(token);
  } catch (err) {
    return {
      releases: null,
      error: err instanceof Error ? err.message : "error",
    };
  }
}

export const loadReleases = cache(async (): Promise<ReleasesResult> => {
  await connection();
  return readReleases();
});
