import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AppEffects } from "@/components/app-effects";
import { AppSidebar } from "@/components/app-sidebar";
import { HeaderActions } from "@/components/header-actions";
import { NeedsYouCard } from "@/components/needs-you-card";
import { SourceDown } from "@/components/states";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { loadMutes } from "@/lib/alert-store";
import { authMode, getOwner } from "@/lib/auth";
import { costConnected } from "@/lib/cost-source";
import { clearedSince, costSince, historyEnabled } from "@/lib/history";
import { countsByView, getNeedsYou } from "@/lib/needs-you";
import { npubEncode } from "@/lib/npub";

export default async function ViewsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [needsYou, costToday, jar, owner, mutes, cleared] = await Promise.all([
    getNeedsYou(),
    readCostToday(),
    cookies(),
    getOwner(),
    readMutes(),
    readCleared(),
  ]);
  const mode = authMode();
  const now = Date.now();
  const counts = countsByView(needsYou.rows);

  return (
    <TooltipProvider>
      {/* The sidebar's own cookie remembers expanded or collapsed. */}
      <SidebarProvider
        defaultOpen={jar.get("sidebar_state")?.value !== "false"}
      >
        <AppSidebar
          counts={counts}
          history={historyEnabled()}
          signIn={
            mode && {
              mode,
              owner:
                owner?.via === "nostr"
                  ? { via: "nostr", npub: npubEncode(owner.pubkey) }
                  : owner,
            }
          }
        />
        <SidebarInset className="min-w-0">
          <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
            <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 sm:px-6">
              <SidebarTrigger className="-ml-2 size-9 md:size-8" />
              <HeaderActions
                updatedAt={needsYou.updatedAt}
                costToday={costToday}
              />
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1400px] flex-1 space-y-6 px-4 py-6 sm:px-6">
            <NeedsYouCard
              data={needsYou}
              now={now}
              cleared={cleared}
              snooze={
                mutes && {
                  mutes,
                  canEdit: owner !== null,
                  signIn: mode !== null,
                }
              }
            />
            {needsYou.failures.map((f) => (
              <SourceDown key={f.source} source={f.source}>
                {f.detail}
              </SourceDown>
            ))}
            {children}
          </main>
        </SidebarInset>
        <AppEffects needsYou={needsYou.rows.reduce((n, r) => n + r.count, 0)} />
      </SidebarProvider>
    </TooltipProvider>
  );
}

// The cost chip's amount (#42): null, so no chip, without a cost source.
async function readCostToday(): Promise<number | null> {
  if (!(await costConnected())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  try {
    return await costSince(today);
  } catch (err) {
    console.error("Cost chip:", err);
    return null;
  }
}

// Snoozed and acked Needs you items (#46): null, so no snooze, without the
// history store or while it's down.
async function readMutes() {
  if (!historyEnabled()) return null;
  try {
    return await loadMutes();
  } catch (err) {
    console.error("Needs you, snooze:", err);
    return null;
  }
}

// The cleared-items log (#88): the last 30 days, null so no footer without the
// history store or while it's down.
async function readCleared() {
  if (!historyEnabled()) return null;
  try {
    return await clearedSince(new Date(Date.now() - 30 * 86_400_000));
  } catch (err) {
    console.error("Needs you, cleared log:", err);
    return null;
  }
}
