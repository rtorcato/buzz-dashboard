"use client";

import { ChevronRight, History } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatAge } from "@/lib/age";
import {
  clearedStats,
  howCleared,
  type LogRow,
  medianByRule,
} from "@/lib/cleared-log";
import { formatWhen } from "@/lib/format-time";
import { useSettings } from "@/lib/settings";

const DAY = 86_400_000;
const RULE_LABEL: Record<string, string> = {
  failing: "Failing agents",
  merge: "Merge-ready PRs",
};

// The Needs you footer stats and History (#88, DESIGN.md → Needs you: snooze
// and ack). `rows` are the items cleared in the last 30 days, newest first.
export function NeedsYouHistory({
  rows,
  now,
}: {
  rows: LogRow[];
  now: number;
}) {
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<7 | 30>(7);
  const week = clearedStats(rows, now - 7 * DAY);
  const shown = rows.filter((r) => r.clearedAt >= now - days * DAY);
  const medians = medianByRule(shown);

  return (
    <div className="border-t text-sm">
      <div className="flex items-center gap-3 px-4 py-2.5 text-muted-foreground sm:px-6">
        <History className="size-3.5 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1">
          This week:{" "}
          <strong className="font-semibold text-foreground tabular-nums">
            {week.count}
          </strong>{" "}
          cleared
          {week.avgMs !== null && (
            <>
              {" · avg "}
              <strong className="font-semibold text-foreground tabular-nums">
                {formatAge(week.avgMs)}
              </strong>{" "}
              to clear
            </>
          )}
        </p>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          History
          <ChevronRight
            className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`}
            aria-hidden
          />
        </button>
      </div>
      {open && (
        <div className="space-y-3 border-t px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-foreground">
              Cleared this {days === 7 ? "week" : "month"}
              <span className="ml-2 font-normal text-muted-foreground">
                newest first · from the database
              </span>
            </p>
            <fieldset className="m-0 flex gap-1 border-0 p-0">
              <legend className="sr-only">Range</legend>
              {([7, 30] as const).map((d) => (
                <Button
                  key={d}
                  type="button"
                  size="sm"
                  variant={days === d ? "secondary" : "ghost"}
                  aria-pressed={days === d}
                  onClick={() => setDays(d)}
                >
                  {d}d
                </Button>
              ))}
            </fieldset>
          </div>
          {shown.length === 0 ? (
            <p className="text-muted-foreground">
              Nothing has cleared in this range yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">Item</th>
                    <th className="hidden px-3 py-1.5 font-medium sm:table-cell">
                      Appeared
                    </th>
                    <th className="px-3 py-1.5 font-medium">Cleared</th>
                    <th className="px-3 py-1.5 font-medium">Time to clear</th>
                    <th className="hidden py-1.5 pl-3 font-medium sm:table-cell">
                      How
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {shown.map((r) => (
                    <tr key={`${r.key}:${r.appearedAt}`}>
                      <td className="max-w-64 py-2 pr-3">
                        <p className="truncate font-medium">{r.title}</p>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {r.key}
                        </p>
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-2 text-muted-foreground sm:table-cell">
                        {formatWhen(r.appearedAt, now, settings)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {formatWhen(r.clearedAt, now, settings)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {formatAge(r.clearedAt - r.appearedAt)}
                      </td>
                      <td className="hidden whitespace-nowrap py-2 pl-3 sm:table-cell">
                        {howCleared(r.rule, r.acked)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
            <p>
              {Object.entries(medians)
                .map(
                  ([rule, ms]) =>
                    `${RULE_LABEL[rule] ?? rule}: median ${formatAge(ms)}`,
                )
                .join(" · ")}
            </p>
            <Link
              href="/timeline"
              className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
            >
              Open in Timeline
              <ChevronRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
