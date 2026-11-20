import type { Metadata } from "next";
import { ChannelsView } from "@/components/channels-view";
import { loadChannelMap } from "@/lib/channel-map";

export const metadata: Metadata = { title: "Channels · Hive" };

// DESIGN.md → Channels (#168). Read-only: the map of every channel, the
// project it belongs to and whether this dashboard can read it.
export default async function ChannelsPage() {
  const result = await loadChannelMap();
  // The layout already shows the relay's Alert when the hive read fails.
  if (!result.map) return null;
  return <ChannelsView map={result.map} now={Math.floor(Date.now() / 1000)} />;
}
