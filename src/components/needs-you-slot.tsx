"use client";

import { ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";
import { usePathname } from "next/navigation";
import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export type BannerAgent = { name: string; picture: string | null };

/**
 * DESIGN.md → Obsidian redesign → Overview: on Overview the Needs you card
 * starts as a one-row banner with the same items. "Review all" expands the
 * full card (passed as `children`) in place. Every other view, and Overview
 * with nothing waiting, shows the card as it is.
 */
export function NeedsYouSlot({
  titles,
  agents,
  children,
}: {
  /** Row titles, oldest first, as the card orders them. */
  titles: string[];
  /** The agents the rows name, for the avatar stack. */
  agents: BannerAgent[];
  children: ReactNode;
}) {
  const onOverview = usePathname() === "/";
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!onOverview || titles.length === 0) return children;

  const n = titles.length;
  return (
    <div className="space-y-3">
      <Card className="flex-row items-center gap-3 px-4 py-3 sm:px-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-warning/12 text-warning">
          <TriangleAlert className="size-4.5" aria-hidden />
        </span>
        <p className="min-w-0 flex-1 truncate text-sm">
          <span className="font-semibold">
            {n} {n === 1 ? "thing needs" : "things need"} you
          </span>
          <span className="text-muted-foreground max-sm:hidden">
            {" · "}
            {titles.join(" · ")}
          </span>
        </p>
        {agents.length > 0 && (
          <span className="flex -space-x-2 max-sm:hidden" aria-hidden>
            {agents.slice(0, 4).map((a) => (
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
        {open && children}
      </div>
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
