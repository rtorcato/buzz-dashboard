import { assignChannel } from "@/lib/project-store";
import { ChannelAssignmentSchema, isChannelId } from "@/lib/projects";
import { json, signedWrite } from "@/lib/registry-route";

// Puts a channel in a project or the hive, or unassigns it with scope null
// (#166). Dashboard-only: the relay channel itself is untouched. A channel's
// revision is its own; a stale `base_revision` is a 409.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await params;
  if (!isChannelId(channelId)) return json({ error: "not found" }, 404);
  return signedWrite(
    request,
    `/api/channel-assignments/${channelId}`,
    ChannelAssignmentSchema,
    async (hive, input, event) => ({
      assignment: await assignChannel(hive, channelId, input, event),
    }),
  );
}
