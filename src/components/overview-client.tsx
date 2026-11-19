"use client";

import { cn } from "cn";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/agents-view";
import { FadeSparkline } from "@/components/overview-charts";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type AgentStatus, agentSlug, agentStatus } from "@/lib/agents";
import type { Agent } from "@/lib/hive";
import {
  DEFAULT_OVERVIEW_RANGE,
  greeting,
  type OverviewRange,
} from "@/lib/overview-range";
import { getSettings, useSettings } from "@/lib/settings";
import type { Runtime } from "@/lib/status-feed";

/** Settings → Open on: a view other than Overview sends / there. */
export function OpenOnRedirect() {
  const router = useRouter();
  useEffect(() => {
    // Read the store directly: the hook still holds the server default on the
    // first effect after hydration.
    const view = getSettings().openOn;
    if (view !== "overview") router.replace(`/${view}`);
  }, [router]);
  return null;
}

/** The range ToggleGroup, in the URL like Health's. */
export function OverviewRangeToggle({
  range,
  ranges,
}: {
  range: OverviewRange;
  ranges: OverviewRange[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <ToggleGroup
      variant="outline"
      aria-label="Range"
      spacing={0}
      value={[range]}
      onValueChange={(v) => {
        if (!v[0]) return;
        const next = new URLSearchParams(params);
        if (v[0] === DEFAULT_OVERVIEW_RANGE) next.delete("range");
        else next.set("range", v[0]);
        const q = next.toString();
        router.push(q ? `/?${q}` : "/", { scroll: false });
      }}
    >
      {ranges.map((r) => (
        <ToggleGroupItem key={r} value={r} className="h-9 px-3 max-md:h-11">
          {r}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/**
 * "Good afternoon": the time of day follows Settings → Time → Time zone, which
 * lives in this browser, so it is worked out here. Blank until mounted.
 */
export function Greeting() {
  const { timeZone } = useSettings();
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => {
    const now = new Date();
    setHour(timeZone === "utc" ? now.getUTCHours() : now.getHours());
  }, [timeZone]);
  return (
    <h1 className="min-h-[1.2em] text-[28px] leading-tight font-bold tracking-[-0.025em]">
      {hour === null ? " " : greeting(hour)}
    </h1>
  );
}

const FILTERS = ["all", "active", "quiet", "stopped"] as const;
type Filter = (typeof FILTERS)[number];
const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

const DOT: Record<AgentStatus, string> = {
  active: "bg-success",
  idle: "bg-muted-foreground",
  quiet: "bg-warning",
  stopped: "bg-muted-foreground/50",
};

/**
 * The Overview agents grid: compact cards with the Agents view's filter set
 * and definitions. Each links to its agent page.
 */
export function OverviewAgents({
  agents,
  now,
  runtimes,
  failing,
}: {
  agents: Agent[];
  now: number;
  runtimes: Record<string, Runtime>;
  /** Names Health marks Failing. */
  failing: string[];
}) {
  const settings = useSettings();
  const [filter, setFilter] = useState<Filter>("all");
  const quietAfterS = settings.quietAfterMinutes * 60;
  const status = (a: Agent) =>
    agentStatus(a, now, runtimes[a.name], quietAfterS);
  const count = (f: Filter) =>
    f === "all" ? agents.length : agents.filter((a) => status(a) === f).length;
  const shown = agents.filter((a) => filter === "all" || status(a) === filter);

  return (
    <section className="space-y-4" aria-labelledby="overview-agents">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="overview-agents" className="mr-auto text-lg font-semibold">
          Agents
        </h2>
        <ToggleGroup
          variant="outline"
          aria-label="Filter agents"
          spacing={0}
          value={[filter]}
          onValueChange={(v) => v[0] && setFilter(v[0] as Filter)}
        >
          {FILTERS.map((f) => (
            <ToggleGroupItem
              key={f}
              value={f}
              className="h-9 gap-1.5 px-3 max-md:h-11"
            >
              {capitalize(f)}
              <span className="text-xs text-muted-foreground tabular-nums">
                {count(f)}
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {filter === "all"
            ? "No agents yet."
            : `No ${filter} agents right now.`}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {shown.map((a) => {
            const s = status(a);
            const sick = failing.includes(a.name);
            return (
              <li key={a.name}>
                <Link
                  href={`/agents/${agentSlug(a.name)}`}
                  className="block h-full rounded-[1rem] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Card
                    className={cn(
                      "h-full gap-2 p-3.5 transition-colors hover:bg-chip",
                      sick && "bg-destructive/6 ring-destructive/60",
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="relative shrink-0">
                        <Avatar agent={a} className="size-10 text-xs" />
                        <span
                          className={cn(
                            "absolute right-0 bottom-0 size-2.5 rounded-full ring-2 ring-card",
                            DOT[s],
                          )}
                          aria-hidden
                        />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">
                          {a.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {a.role}
                        </span>
                      </span>
                    </div>
                    <p className="sr-only">
                      {capitalize(s)}
                      {sick ? ", failing turns" : ""}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {a.workingOn ?? "Nothing posted this week"}
                    </p>
                    <div className="mt-auto flex items-end justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        <span className="font-mono text-foreground tabular-nums">
                          {a.messagesToday}
                        </span>{" "}
                        today
                      </span>
                      <FadeSparkline
                        values={a.daily}
                        color="var(--series-1)"
                        fill={false}
                        className="h-6 w-16"
                      />
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
