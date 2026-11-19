// The Overview range and greeting, with no server imports so client
// components can use them. DESIGN.md → Obsidian redesign → Overview.

export const OVERVIEW_RANGES = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
} as const;
export type OverviewRange = keyof typeof OVERVIEW_RANGES;
export const DEFAULT_OVERVIEW_RANGE: OverviewRange = "7d";

/** Without the history store only 24h and 7d show: the live reads cover 7 days. */
export const rangesFor = (history: boolean): OverviewRange[] =>
  history ? ["24h", "7d", "30d", "90d"] : ["24h", "7d"];

export function parseRange(
  raw: string | null | undefined,
  history: boolean,
): OverviewRange {
  return rangesFor(history).find((r) => r === raw) ?? DEFAULT_OVERVIEW_RANGE;
}

/** The greeting for a local hour, 0 to 23. */
export function greeting(hour: number): string {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Tue" for a weekday, 0 = Sunday. */
export const dayName = (d: number) => DAYS[d];

/** "14:00", or "2 PM" with a 12-hour clock. */
export const hourLabel = (h: number, clock24: boolean) =>
  clock24
    ? `${String(h).padStart(2, "0")}:00`
    : `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
