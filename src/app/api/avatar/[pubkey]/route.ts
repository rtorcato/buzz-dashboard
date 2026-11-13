import { fetchAvatar } from "@/lib/avatar";
import { readServerEnv } from "@/lib/env";

// An agent's relay-hosted profile picture (#112). See lib/avatar.ts for why it
// takes a pubkey, not a media sha.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ pubkey: string }> },
) {
  const { pubkey } = await params;
  let avatar: Awaited<ReturnType<typeof fetchAvatar>>;
  try {
    avatar = await fetchAvatar(readServerEnv(), pubkey.toLowerCase());
  } catch {
    return new Response(null, { status: 502 });
  }
  if (!avatar) return new Response(null, { status: 404 });
  return new Response(avatar.body, {
    headers: {
      "content-type": avatar.type,
      // ponytail: browser cache only; add a server cache if relay load shows up.
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  });
}
