import "server-only";

import {
  BadRequestError,
  HttpError,
  ServiceUnavailableError,
  TooManyRequestsError,
  toErrorResponse,
  UnauthorizedError,
} from "@rtorcato/api-common/errors";
import {
  createRateLimiter,
  memoryStore,
} from "@rtorcato/api-common/rate-limit";
import { ok } from "@rtorcato/api-common/response";
import { buildIngestRow, MAX_BODY_BYTES } from "./event-ingest";
import { historyEnabled, retentionDays } from "./history";
import { bearerToken } from "./ingest-token";
import { insertIngestedEvent, matchEventToken } from "./ingest-tokens";
import { registryHive } from "./registry-route";

// POST /api/events (#199): the generic way in for agent events from any
// platform. Order matters: no token is refused before the database is
// touched, the rate limit counts only requests with a valid token (so a
// stranger can't spend a platform's budget), and the body is read only after
// both, with a hard size cap.

/** Per platform token, to Devastator's retention sizing on the issue. */
export const RATE_LIMIT = { requests: 30, windowMs: 60_000 };
// ponytail: per process, like the token cache. Use api-common's redisStore if
// the dashboard ever runs more than one instance.
export const limiter = createRateLimiter({
  ...RATE_LIMIT,
  store: memoryStore(),
});

const headers = { "cache-control": "no-store" };

function fail(err: HttpError, extra?: Record<string, unknown>) {
  const retry: Record<string, string> =
    err instanceof TooManyRequestsError
      ? { "retry-after": String(RATE_LIMIT.windowMs / 1000) }
      : {};
  return Response.json(
    { ...toErrorResponse(err), ...extra },
    { status: err.status, headers: { ...headers, ...retry } },
  );
}

class PayloadTooLargeError extends HttpError {
  constructor() {
    super(413, `body is over ${MAX_BODY_BYTES} bytes`, "payload_too_large");
  }
}
class UnsupportedMediaTypeError extends HttpError {
  constructor() {
    super(415, "expected application/json", "unsupported_media_type");
  }
}

/** The body as text, or null once it passes `max` bytes. */
async function readCapped(request: Request, max: number) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function receiveEvent(
  request: Request,
  now = new Date(),
): Promise<Response> {
  if (!historyEnabled()) return new Response(null, { status: 404 });
  const h = registryHive();
  if ("response" in h) return h.response;

  const authorization = request.headers.get("authorization");
  if (!bearerToken(authorization)) return fail(new UnauthorizedError());
  let token: Awaited<ReturnType<typeof matchEventToken>>;
  try {
    token = await matchEventToken(authorization, h.hive, now.getTime());
  } catch (err) {
    console.error("Event ingest:", err);
    return fail(new ServiceUnavailableError());
  }
  if (!token) return fail(new UnauthorizedError());

  const { allowed } = await limiter.check(`${h.hive} ${token.platform}`);
  if (!allowed) return fail(new TooManyRequestsError());

  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return fail(new UnsupportedMediaTypeError());
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return fail(new PayloadTooLargeError());
  }
  const text = await readCapped(request, MAX_BODY_BYTES);
  if (text === null) return fail(new PayloadTooLargeError());
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(new BadRequestError("body is not valid JSON"));
  }

  const built = buildIngestRow(body, token, {
    now,
    retentionDays: retentionDays(),
  });
  if (!built.ok) {
    return fail(
      new BadRequestError(built.error, "invalid_event"),
      built.issues ? { issues: built.issues } : undefined,
    );
  }
  let stored: boolean;
  try {
    stored = await insertIngestedEvent(built.row);
  } catch (err) {
    console.error("Event ingest:", err);
    return fail(new ServiceUnavailableError());
  }
  return Response.json(ok({ id: built.row.sourceId, duplicate: !stored }), {
    status: stored ? 201 : 200,
    headers,
  });
}
