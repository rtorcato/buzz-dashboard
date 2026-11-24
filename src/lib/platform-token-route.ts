import "server-only";

import type { z } from "zod";
import { OwnerRequired, requireOwner } from "./auth";
import { registryHive } from "./registry-route";

// The shared front of the owner's platform-token routes (#199): history on, a
// relay configured, and the owner signed in. Tokens are hive-scoped, like the
// project registry.

export const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** The hive for an owner call, or the response saying why not. */
export async function ownerHive(): Promise<
  { hive: string } | { response: Response }
> {
  const h = registryHive();
  if ("response" in h) return h;
  try {
    await requireOwner();
  } catch (err) {
    if (err instanceof OwnerRequired) {
      return { response: json({ error: "owner sign-in required" }, 403) };
    }
    throw err;
  }
  return h;
}

/** The JSON body parsed with `schema`, or the 415/400 response. */
export async function ownerBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<{ data: z.infer<S> } | { response: Response }> {
  // A JSON body needs a CORS preflight cross-site, which nothing here answers.
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return { response: json({ error: "expected JSON" }, 415) };
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { response: json({ error: "body is not valid JSON" }, 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      response: json(
        {
          error: "invalid body",
          issues: parsed.error.issues.map(
            (i) => `${i.path.join(".") || "body"}: ${i.message}`,
          ),
        },
        400,
      ),
    };
  }
  return { data: parsed.data };
}
