import "server-only";

import { fetchWithTimeout, HttpError } from "@rtorcato/js-common/fetch";
import { connection } from "next/server";
import { cache } from "react";
import { isJobsStale, type JobsFeed, jobsFromJson } from "./jobs-parse";
import { type MediaEnv, r2Client, r2Url, readMediaEnv } from "./media";
import { sampleJobs, sampleMode } from "./sample-data";

// The jobs feed (#108): `hive/jobs.json` in the media bucket, written by a
// script on the operator's Mac next to `status.json`, read with the same
// read-only R2 token. Phase 1 is read-only; nothing here writes.

export const JOBS_KEY = "hive/jobs.json";

export type JobsResult = { feed: JobsFeed | null; stale: boolean };

let last: JobsFeed | null = null;

/** Missing file or R2 env → not connected; failed fetch → last copy, stale. */
export const loadJobs = cache(async (): Promise<JobsResult> => {
  await connection();
  if (sampleMode()) return { feed: sampleJobs(), stale: false };
  let env: MediaEnv;
  try {
    env = readMediaEnv();
  } catch {
    return { feed: null, stale: false };
  }
  try {
    const { url, headers } = await r2Client(env).sign(r2Url(env, JOBS_KEY));
    last = jobsFromJson(
      await fetchWithTimeout(url, { headers, cache: "no-store" }, 5_000),
    );
    return {
      feed: last,
      stale: last ? isJobsStale(last, Date.now() / 1000) : false,
    };
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      last = null;
      return { feed: null, stale: false };
    }
    return { feed: last, stale: last !== null };
  }
});
