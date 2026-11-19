"use client";

import { ExternalLink, RefreshCw, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { CostChip } from "@/components/cost-chip";
import { Button, buttonVariants } from "@/components/ui/button";
import { STALE_AFTER_MS } from "@/lib/age";
import { formatWhen } from "@/lib/format-time";
import { REFRESH_MS, useSettings } from "@/lib/settings";

// DESIGN.md → Obsidian redesign → Shell changes: the right side of the header,
// in order: Live chip, Refresh, cost chip, Open in Buzz.
export function HeaderActions({
  updatedAt,
  costToday,
  buzzUrl,
}: {
  updatedAt: string | null;
  /** Estimated dollars today, or null with no cost source (#42). */
  costToday: number | null;
  /** Where Open in Buzz goes, or null when BUZZ_WEB_URL is unset. */
  buzzUrl: string | null;
}) {
  const router = useRouter();
  const settings = useSettings();
  const refreshEvery = REFRESH_MS[settings.refresh];
  const [refreshing, startRefresh] = useTransition();
  const [now, setNow] = useState(() => Date.now());

  const refresh = () => startRefresh(() => router.refresh());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    // Off still lets you refresh by hand.
    const poll = refreshEvery
      ? setInterval(() => router.refresh(), refreshEvery)
      : undefined;
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [router, refreshEvery]);

  const age = updatedAt ? now - Date.parse(updatedAt) : 0;
  const stale = age > STALE_AFTER_MS;

  return (
    <div className="ml-auto flex items-center gap-2 whitespace-nowrap text-sm text-muted-foreground">
      <LiveChip
        stale={stale}
        label={
          updatedAt ? formatWhen(now - age, now, settings) : "Not connected"
        }
        connected={updatedAt !== null}
      />
      <Button
        variant="ghost"
        size="icon"
        className="size-9"
        aria-label="Refresh"
        onClick={refresh}
        disabled={refreshing}
      >
        <RefreshCw
          className={refreshing ? "animate-spin" : undefined}
          aria-hidden
        />
      </Button>
      {costToday !== null && (
        <>
          <span className="h-5 w-px bg-border max-sm:hidden" aria-hidden />
          <CostChip value={costToday} />
        </>
      )}
      {buzzUrl && (
        // Solid violet, no glow. Phones keep the icon and the aria-label.
        <a
          href={buzzUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open in Buzz"
          className={buttonVariants({
            className: "h-9 gap-1.5 px-3 max-sm:w-9 max-sm:px-0",
          })}
        >
          <ExternalLink aria-hidden />
          <span className="max-sm:hidden">Open in Buzz</span>
        </a>
      )}
    </div>
  );
}

// "synced 4s ago": a green dot while fresh, then warning with a
// triangle-alert after 5 minutes without a successful refresh.
function LiveChip({
  stale,
  label,
  connected,
}: {
  stale: boolean;
  label: string;
  connected: boolean;
}) {
  return (
    <span className="flex h-9 items-center gap-2 rounded-full border bg-chip px-3 text-xs">
      {!connected ? (
        <span
          className="size-2 rounded-full bg-muted-foreground/60"
          aria-hidden
        />
      ) : stale ? (
        <TriangleAlert className="size-3.5 text-warning" aria-hidden />
      ) : (
        <span className="relative flex size-2" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex size-2 rounded-full bg-success" />
        </span>
      )}
      <span
        className={stale ? "text-warning tabular-nums" : "tabular-nums"}
        suppressHydrationWarning
      >
        {connected && <span className="max-sm:hidden">synced </span>}
        {label}
      </span>
    </span>
  );
}
