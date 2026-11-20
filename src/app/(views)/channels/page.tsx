import type { Metadata } from "next";
import type { AdminContext } from "@/components/channel-admin";
import { ChannelsView } from "@/components/channels-view";
import { getOwner, ownerPubkeys } from "@/lib/auth";
import { relayHttpBase } from "@/lib/buzz-dm";
import { dashboardPubkey, loadChannelMap } from "@/lib/channel-map";
import { buzzWebUrl, readServerEnv } from "@/lib/env";
import { envList } from "@/lib/github";
import { loadHive } from "@/lib/hive";
import { npubEncode } from "@/lib/npub";
import { sampleChannelAdmin, sampleMode } from "@/lib/sample-data";

export const metadata: Metadata = { title: "Channels · Hive" };

/**
 * The owner's channel admin controls (#169), or null for anyone else. Only
 * public keys and URLs: every change is signed in the owner's browser.
 */
async function adminContext(): Promise<AdminContext | null> {
  if (sampleMode()) return sampleChannelAdmin();
  const owner = await getOwner();
  if (!owner) return null;
  try {
    const env = readServerEnv();
    const relay = relayHttpBase(env.buzzRelayUrl);
    if (!relay) return null;
    const { hive } = await loadHive();
    return {
      relayEventsUrl: `${relay}/events`,
      dashboard: dashboardPubkey(env.buzzPrivateKey),
      owners: ownerPubkeys(),
      ownerNpub: owner.via === "nostr" ? npubEncode(owner.pubkey) : null,
      agents: (hive?.agents ?? []).flatMap((a) =>
        a.pubkeys[0] ? [{ pubkey: a.pubkeys[0], name: a.name }] : [],
      ),
      githubOwner: envList("GITHUB_OWNERS")[0] ?? null,
      buzzUrl: buzzWebUrl(),
    };
  } catch {
    return null;
  }
}

// DESIGN.md → Channels (#168, #169). The map of every channel, the project it
// belongs to and whether this dashboard can read it; the owner can change
// them, signing each relay change in the browser.
export default async function ChannelsPage() {
  const [result, admin] = await Promise.all([loadChannelMap(), adminContext()]);
  // The layout already shows the relay's Alert when the hive read fails.
  if (!result.map) return null;
  return (
    <ChannelsView
      map={result.map}
      now={Math.floor(Date.now() / 1000)}
      admin={admin}
    />
  );
}
