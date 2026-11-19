import "server-only";

import { ingestTokenRecord, signerRecord } from "./cost-source";
import {
  type FailingAgent,
  failingAgents,
  type HealthBucket,
  type HealthSource,
  SLOT_S,
  SOURCE_KINDS,
} from "./health";
import { healthBuckets, historyEnabled } from "./history";

/** Health's error-rate source: the connected cost source, or null with none. */
export async function healthSource(): Promise<HealthSource | null> {
  if (!historyEnabled()) return null;
  if (await signerRecord()) return "signer";
  return (await ingestTokenRecord()) ? "otel" : null;
}

/**
 * The agents failing right now, for Needs you; null without a source. Outside
 * a request (the alerts pass) the caller passes the source in.
 */
export async function loadFailing(
  now: number,
  given?: HealthSource | null,
): Promise<{ source: HealthSource; failing: FailingAgent[] } | null> {
  const source = given === undefined ? await healthSource() : given;
  if (!source) return null;
  // The last hour, plus the slot it starts in.
  const buckets = await healthBuckets(
    new Date((now - 3600 - SLOT_S) * 1000),
    SOURCE_KINDS[source],
  );
  return { source, failing: failingAgents(buckets, now) };
}

/**
 * The buckets of the last `hours`, for silence: [] without a source. Outside a
 * request the caller passes the source in.
 */
export async function recentBuckets(
  now: number,
  hours: number,
  given?: HealthSource | null,
): Promise<HealthBucket[]> {
  const source = given === undefined ? await healthSource() : given;
  if (!source) return [];
  return healthBuckets(
    new Date((now - hours * 3600 - SLOT_S) * 1000),
    SOURCE_KINDS[source],
  );
}
