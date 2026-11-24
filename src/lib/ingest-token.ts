import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// The OTel ingest token (#42). Agents send it as `Authorization: Bearer
// <token>` with every metrics report, so nobody else who can reach the
// dashboard can post cost numbers. The full token is shown once; only its
// hash is stored.

export const TOKEN_PREFIX = "hive_otel_";
/** The event ingest tokens (#199), one per platform. */
export const EVENT_TOKEN_PREFIX = "hive_evt_";

export const TokenRecordSchema = z.object({
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  last4: z.string(),
  createdAt: z.string(),
});
export type TokenRecord = z.infer<typeof TokenRecordSchema>;

export const sha256 = (s: string) =>
  createHash("sha256").update(s).digest("hex");

/** A fresh token and the record to store for it. */
export function newIngestToken(now = new Date(), prefix = TOKEN_PREFIX) {
  const token = prefix + randomBytes(24).toString("base64url");
  const record: TokenRecord = {
    hash: sha256(token),
    last4: token.slice(-4),
    createdAt: now.toISOString(),
  };
  return { token, record };
}

/** The token in an `Authorization: Bearer <token>` header, or null. */
export const bearerToken = (authorization: string | null) =>
  /^Bearer\s+(\S+)$/i.exec(authorization?.trim() ?? "")?.[1] ?? null;

/** True when `authorization` carries the token behind `record`. */
export function checkIngestToken(
  authorization: string | null,
  record: TokenRecord | null,
): boolean {
  const token = bearerToken(authorization);
  if (!token || !record) return false;
  const got = Buffer.from(sha256(token), "hex");
  const want = Buffer.from(record.hash, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** The masked form for the page: hive_otel_••••••••••••••7k2q. */
export const maskToken = (
  r: Pick<TokenRecord, "last4">,
  prefix = TOKEN_PREFIX,
) => `${prefix}${"•".repeat(14)}${r.last4}`;
