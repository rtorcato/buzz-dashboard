import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AppEffects } from "@/components/app-effects";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandPalette } from "@/components/command-palette";
import { HeaderActions } from "@/components/header-actions";
import { NeedsYouCard } from "@/components/needs-you-card";
import { type BannerAgent, NeedsYouSlot } from "@/components/needs-you-slot";
import { SourceDown } from "@/components/states";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { agentSlug } from "@/lib/agents";
import { loadMutes } from "@/lib/alert-store";
import { authMode, getOwner } from "@/lib/auth";
import { costConnected } from "@/lib/cost-source";
import { buzzWebUrl } from "@/lib/env";
import { clearedSince, costSince, historyEnabled } from "@/lib/history";
import { type Agent, loadHive } from "@/lib/hive";
import {
  countsByView,
  getNeedsYou,
  KIND_VIEW,
  type NeedsYouRow,
  oldestFirst,
} from "@/lib/needs-you";
import { npubEncode } from "@/lib/npub";
import type { PaletteItem } from "@/lib/palette";
import { failingViews, viewHref, visibleViews } from "@/lib/views";

export default async function ViewsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [needsYou, costToday, jar, owner, mutes, cleared, { hive }] =
    await Promise.all([
      getNeedsYou(),
      readCostToday(),
      cookies(),
      getOwner(),
      readMutes(),
      readCleared(),
      // Already read for Needs you, so the palette costs no extra relay read.
      loadHive(),
    ]);
  const mode = authMode();
  const now = Date.now();
  const counts = countsByView(needsYou.rows);
  const history = historyEnabled();

  return (
    <TooltipProvider>
      {/* The sidebar's own cookie remembers expanded or collapsed. */}
      <SidebarProvider
        defaultOpen={jar.get("sidebar_state")?.value !== "false"}
      >
        <AppSidebar
          counts={counts}
          failing={failingViews(needsYou.rows, KIND_VIEW)}
          history={history}
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
        <SidebarInset className="page-glow min-w-0">
          <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
            <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 sm:px-6">
              <SidebarTrigger className="-ml-2 size-9 md:size-8" />
              <span className="h-5 w-px bg-border" aria-hidden />
              <CommandPalette
                items={paletteItems(history, hive?.agents ?? [], needsYou.rows)}
              />
              <HeaderActions
                updatedAt={needsYou.updatedAt}
                costToday={costToday}
                buzzUrl={buzzWebUrl()}
              />
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1400px] flex-1 space-y-6 px-4 py-6 sm:px-6">
            <NeedsYouSlot
              titles={oldestFirst(needsYou.rows).map((r) => r.title)}
              agents={bannerAgents(hive?.agents ?? [], needsYou.rows)}
            >
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
            </NeedsYouSlot>
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

// The command palette searches what the layout already loaded: the views, the
// agents and the PRs and issues Needs you names. It only navigates.
function paletteItems(
  history: boolean,
  agents: Agent[],
  rows: NeedsYouRow[],
): PaletteItem[] {
  const views: PaletteItem[] = [
    ...visibleViews(history).map(({ view, label }) => ({
      group: "Views" as const,
      label,
      href: viewHref(view),
    })),
    { group: "Views", label: "Settings", href: "/settings" },
  ];
  const people: PaletteItem[] = agents
    .map((a) => ({
      group: "Agents" as const,
      label: a.name,
      hint: a.role || undefined,
      href: `/agents/${agentSlug(a.name)}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const prs: PaletteItem[] = rows.flatMap((r) =>
    (r.keys ?? []).flatMap((k) => {
      const ref = k.match(/^(?:merge|blocked):(.+#\d+)$/)?.[1];
      return ref
        ? [
            {
              group: "Needs you" as const,
              label: ref,
              hint: r.title,
              href: "/pipeline",
            },
          ]
        : [];
    }),
  );
  return [...views, ...people, ...prs];
}

// The Overview banner's avatar stack: the agents a Needs you row names.
function bannerAgents(agents: Agent[], rows: NeedsYouRow[]): BannerAgent[] {
  const text = rows.map((r) => `${r.title} ${r.detail}`).join(" ");
  return agents
    .filter((a) => new RegExp(`\\b${escapeRe(a.name)}\\b`).test(text))
    .map((a) => ({ name: a.name, picture: a.picture }));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
