"use client";

import { ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";
import { NeedsYouCard } from "@/components/needs-you-card";
import { ProjectChip } from "@/components/project-chip";
import { useProjectFilter } from "@/components/project-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Mutes } from "@/lib/alerts";
import type { LogRow } from "@/lib/cleared-log";
import type { NeedsYou } from "@/lib/needs-you";
import { needsYouSlotMode, oldestFirst } from "@/lib/needs-you-rows";
import { chipLabel, scopeNeedsYou } from "@/lib/project-scope";

export type BannerAgent = { name: string; picture: string | null };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * DESIGN.md → Obsidian redesign → Overview: Needs you shows only on Overview
 * (#190). There it starts as a one-row banner with the same items, and
 * "Review all" expands the full card in place; with nothing waiting it's the
 * card's "All clear" line. Every other view shows only the project chip. With
 * a project picked (#167) the rows, the banner and its avatars are that
 * project's, under a chip that clears the filter.
 */
export function NeedsYouSlot({
  data,
  now,
  cleared,
  snooze,
  agents,
}: {
  data: NeedsYou;
  now: number;
  cleared: LogRow[] | null;
  snooze: { mutes: Mutes; canEdit: boolean; signIn: boolean } | null;
  /** Every agent the relay lists, for the banner's avatar stack. */
  agents: BannerAgent[];
}) {
  const pathname = usePathname();
  const { scope } = useProjectFilter();
  const [open, setOpen] = useState(false);
  const id = useId();
  const rows = oldestFirst(scopeNeedsYou(data.rows, scope));
  const titles = rows.map((r) => r.title);
  const mode = needsYouSlotMode(pathname, titles.length);
  const text = rows.map((r) => `${r.title} ${r.detail}`).join(" ");
  const named = agents.filter((a) =>
    new RegExp(`\\b${escapeRe(a.name)}\\b`).test(text),
  );
  const card = (
    <NeedsYouCard data={data} now={now} cleared={cleared} snooze={snooze} />
  );

  // Off Overview only the chip, unwrapped, so a page with no filter gets no
  // empty block (and no extra gap) above its content.
  if (mode === "none") return <ProjectChip />;

  return (
    <div className="space-y-3">
      <ProjectChip />
      {mode === "card" ? (
        card
      ) : (
        <div className="space-y-3">
          <Card className="flex-row items-center gap-3 px-4 py-3 sm:px-5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-warning/12 text-warning">
              <TriangleAlert className="size-4.5" aria-hidden />
            </span>
            <p className="min-w-0 flex-1 truncate text-sm">
              <span className="font-semibold">
                {titles.length}{" "}
                {titles.length === 1 ? "thing needs" : "things need"} you
                {scope ? ` in ${chipLabel(scope)}` : ""}
              </span>
              <span className="text-muted-foreground max-sm:hidden">
                {" · "}
                {titles.join(" · ")}
              </span>
            </p>
            {named.length > 0 && (
              <span className="flex -space-x-2 max-sm:hidden" aria-hidden>
                {named.slice(0, 4).map((a) => (
                  <MiniAvatar key={a.name} agent={a} />
                ))}
              </span>
            )}
            <Button
              variant="ghost"
              className="h-9 shrink-0"
              aria-expanded={open}
              aria-controls={id}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? "Collapse" : "Review all"}
              {open ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
            </Button>
          </Card>
          <div id={id} hidden={!open}>
            {open && card}
          </div>
        </div>
      )}
    </div>
  );
}

function MiniAvatar({ agent: a }: { agent: BannerAgent }) {
  const [failed, setFailed] = useState(false);
  const ring = "size-7 rounded-full ring-2 ring-card";
  if (a.picture && !failed) {
    return (
      // biome-ignore lint/performance/noImgElement: a remote profile picture at 28px, as on the Agents cards.
      <img
        src={a.picture}
        alt=""
        className={`${ring} bg-muted object-cover`}
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      className={`${ring} flex items-center justify-center bg-chip text-[10px] font-medium text-muted-foreground`}
    >
      {a.name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .slice(0, 2)}
    </span>
  );
}
