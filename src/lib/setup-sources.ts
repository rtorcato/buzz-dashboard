import "server-only";

import { AwsClient } from "aws4fetch";
import { Client } from "pg";

// Tests for the optional sources step (#73 part 3c). Each takes the values the
// owner typed and says in plain words whether they work. Nothing is saved
// here: the route saves a source only after its test passes.

export type SourceResult =
  | { ok: true; detail: string }
  | { ok: false; error: string };

const fail = (error: string): SourceResult => ({ ok: false, error });
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export const splitList = (raw: string) => raw.split(/[\s,]+/).filter(Boolean);

export async function testGithub(
  v: { token: string; owners: string },
  doFetch: typeof fetch = fetch,
): Promise<SourceResult> {
  const owners = splitList(v.owners);
  if (!v.token.trim()) return fail("Paste a token first.");
  if (!owners.length) return fail("Add at least one user or org to read.");
  const bad = owners.find((o) => !OWNER_RE.test(o));
  if (bad) return fail(`“${bad}” isn’t a valid GitHub user or org name.`);
  const get = (path: string) =>
    doFetch(`https://api.github.com${path}`, {
      headers: {
        authorization: `Bearer ${v.token.trim()}`,
        accept: "application/vnd.github+json",
        "user-agent": "hive-dashboard-setup",
      },
      signal: AbortSignal.timeout(10_000),
    });
  try {
    let repos = 0;
    let more = false;
    let left = "";
    for (const o of owners) {
      const res = await get(`/users/${o}/repos?per_page=100`);
      if (res.status === 401) return fail("GitHub rejected that token.");
      if (res.status === 404) return fail(`GitHub has no user or org “${o}”.`);
      if (!res.ok) return fail(`GitHub answered ${res.status} for “${o}”.`);
      const rows = (await res.json()) as unknown[];
      repos += rows.length;
      if (rows.length >= 100) more = true;
      const rem = res.headers.get("x-ratelimit-remaining");
      const lim = res.headers.get("x-ratelimit-limit");
      if (rem && lim) left = `${rem} of ${lim} calls left`;
    }
    return {
      ok: true,
      detail: `${owners.join(", ")} · ${repos}${more ? "+" : ""} repos${left ? ` · ${left}` : ""}`,
    };
  } catch {
    return fail("Couldn’t reach GitHub. Check the server’s network.");
  }
}

export async function testMedia(v: {
  MEDIA_BASE_URL: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}): Promise<SourceResult> {
  try {
    if (new URL(v.MEDIA_BASE_URL).protocol !== "https:")
      return fail("The public base URL must start with https://.");
  } catch {
    return fail("The public base URL isn’t a valid URL.");
  }
  if (!/^[a-f0-9]{32}$/i.test(v.R2_ACCOUNT_ID.trim()))
    return fail("The account ID is 32 hex characters, from the R2 overview.");
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(v.R2_BUCKET.trim()))
    return fail("That isn’t a valid bucket name.");
  if (!v.R2_ACCESS_KEY_ID.trim() || !v.R2_SECRET_ACCESS_KEY.trim())
    return fail("Add the read-only access key ID and secret.");
  const aws = new AwsClient({
    accessKeyId: v.R2_ACCESS_KEY_ID.trim(),
    secretAccessKey: v.R2_SECRET_ACCESS_KEY.trim(),
    service: "s3",
    region: "auto",
  });
  try {
    const res = await aws
      .fetch(
        `https://${v.R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com/${v.R2_BUCKET.trim()}?list-type=2&max-keys=1`,
        { signal: AbortSignal.timeout(10_000) },
      )
      .catch(() => null);
    if (!res) return fail("Couldn’t reach R2. Check the account ID.");
    if (res.status === 403)
      return fail("R2 rejected the key. Check the ID, secret and bucket.");
    if (res.status === 404) return fail("R2 has no bucket with that name.");
    if (!res.ok) return fail(`R2 answered ${res.status}.`);
    return { ok: true, detail: `Bucket ${v.R2_BUCKET.trim()} is readable` };
  } catch {
    return fail("Couldn’t reach R2.");
  }
}

export async function testDatabase(url: string): Promise<SourceResult> {
  if (!/^postgres(ql)?:\/\//i.test(url.trim()))
    return fail(
      "The connection string must start with postgres:// or postgresql://.",
    );
  const client = new Client({
    connectionString: url.trim(),
    connectionTimeoutMillis: 8_000,
  });
  // A dropped connection emits 'error'; without a listener it would crash.
  client.on("error", () => {});
  try {
    await client.connect();
    const r = await client.query("select current_database() as db");
    return {
      ok: true,
      detail: `Connected to ${r.rows[0]?.db ?? "the database"}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    return fail(
      /password|authentication/i.test(msg)
        ? "The database rejected that user or password."
        : "Couldn’t connect. Check the host, port and that it accepts this server.",
    );
  } finally {
    await client.end().catch(() => {});
  }
}
