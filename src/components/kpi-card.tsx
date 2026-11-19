import { cn } from "cn";
import { type LucideIcon, TrendingDown, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { FadeSparkline } from "@/components/overview-charts";
import { Card } from "@/components/ui/card";

// DESIGN.md → Obsidian redesign → Overview → KPI row, reused by the agent
// page's 4 stat cards: a tinted icon tile, the value, a delta pill against
// the previous period and a 44px sparkline with the fade.

export type Kpi = {
  label: string;
  icon: LucideIcon;
  tone: "violet" | "cyan" | "green" | "pink";
  value: ReactNode;
  /** A muted line under the value, e.g. "47 this week". */
  sub?: string;
  /** Null when there is no series to draw. */
  spark: number[] | null;
  delta: number | null;
  /** Cost: a rise isn't good or bad, so the pill stays grey. */
  neutral?: boolean;
};

// Icon tiles are the colour at 12% with the icon in full: flat, no gradient.
const TONE: Record<Kpi["tone"], { tile: string; line: string }> = {
  violet: { tile: "bg-series-1/12 text-series-1", line: "var(--series-1)" },
  cyan: { tile: "bg-series-2/12 text-series-2", line: "var(--series-2)" },
  green: { tile: "bg-success/12 text-success", line: "var(--success)" },
  pink: { tile: "bg-series-3/12 text-series-3", line: "var(--series-3)" },
};

export function KpiCard({ kpi }: { kpi: Kpi }) {
  const Icon = kpi.icon;
  const tone = TONE[kpi.tone];
  const d = kpi.delta;
  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "flex size-8 items-center justify-center rounded-[10px]",
            tone.tile,
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="text-sm text-muted-foreground">{kpi.label}</span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="text-[30px] leading-none font-bold tracking-[-0.03em] tabular-nums">
          {kpi.value}
        </span>
        {d !== null && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
              kpi.neutral
                ? "bg-chip text-muted-foreground"
                : d >= 0
                  ? "bg-success/12 text-success"
                  : "bg-destructive/12 text-destructive",
            )}
          >
            {d >= 0 ? (
              <TrendingUp className="size-3" aria-hidden />
            ) : (
              <TrendingDown className="size-3" aria-hidden />
            )}
            {d >= 0 ? "+" : ""}
            {d}%<span className="sr-only"> against the previous period</span>
          </span>
        )}
      </div>
      {kpi.sub && (
        <p className="-mt-1 text-xs text-muted-foreground">{kpi.sub}</p>
      )}
      {kpi.spark ? (
        <FadeSparkline values={kpi.spark} color={tone.line} />
      ) : (
        <div className="h-11" aria-hidden />
      )}
    </Card>
  );
}
