import { z } from "zod";
import {
  AlertInputError,
  addChannel,
  muteItems,
  removeChannel,
  saveRule,
  sendTest,
  setChannelOn,
  setQuiet,
} from "@/lib/alert-store";
import { CHANNEL_TYPES, RULE_IDS, RuleSchema } from "@/lib/alerts";
import { OwnerRequired, requireOwner } from "@/lib/auth";
import { historyEnabled } from "@/lib/history";

// Changes the alert channels and rules (#45), sends a test, and snoozes or
// acks Needs you items (#46). Owner only.
// A channel's URL comes in once and never goes back out.

const BodySchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add"),
    type: z.enum(CHANNEL_TYPES),
    // A Buzz DM channel has no target; the server fills it in.
    target: z.string().max(2000).default(""),
  }),
  z.object({ op: z.literal("toggle"), id: z.string(), on: z.boolean() }),
  z.object({ op: z.literal("remove"), id: z.string() }),
  z.object({ op: z.literal("test"), id: z.string() }),
  z.object({
    op: z.literal("rule"),
    rule: z.enum(RULE_IDS),
    value: RuleSchema,
  }),
  z.object({ op: z.literal("quiet"), on: z.boolean() }),
  z.object({
    op: z.literal("mute"),
    keys: z.array(z.string().max(300)).min(1).max(100),
    until: z.number().int().nullable(),
  }),
]);

export async function POST(request: Request) {
  if (!historyEnabled()) return new Response(null, { status: 404 });
  // As on login: a JSON body needs a CORS preflight cross-site, which this
  // route never answers, so another site can't change alerts.
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "expected JSON" }, { status: 415 });
  }
  try {
    await requireOwner();
  } catch (err) {
    if (err instanceof OwnerRequired) {
      return Response.json(
        { error: "owner sign-in required" },
        { status: 403 },
      );
    }
    throw err;
  }
  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const b = body.data;
  try {
    if (b.op === "add") await addChannel(b.type, b.target);
    else if (b.op === "toggle") await setChannelOn(b.id, b.on);
    else if (b.op === "remove") await removeChannel(b.id);
    else if (b.op === "rule") await saveRule(b.rule, b.value);
    else if (b.op === "quiet") await setQuiet(b.on);
    else if (b.op === "mute") await muteItems(b.keys, b.until);
    else await sendTest(b.id);
  } catch (err) {
    if (err instanceof AlertInputError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    if (b.op === "test") {
      // The channel's own answer, never its URL.
      console.error("Alert test:", err);
      return Response.json(
        { error: "The channel didn’t take it. Check the URL and try again." },
        { status: 502 },
      );
    }
    throw err;
  }
  return new Response(null, { status: 204 });
}
