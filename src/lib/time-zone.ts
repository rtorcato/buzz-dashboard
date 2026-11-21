// Settings → Time → Time zone lives in the browser, so the Overview's day and
// hour buckets would otherwise follow the server clock (#153). The browser
// sends its zone in this cookie: an IANA name, or "UTC" when the setting is UTC.
export const TIME_ZONE_COOKIE = "hive_tz";

/** This runtime's IANA zone: the server's on the server, the browser's in it. */
export const systemTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The zone Settings → Time zone picks in this browser. */
export const viewerTimeZone = (setting: "local" | "utc") =>
  setting === "utc" ? "UTC" : systemTimeZone();

/** A known IANA zone name as sent, else the server's own zone. */
export function resolveTimeZone(raw: string | undefined | null): string {
  if (raw && raw.length <= 64) {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: raw,
      }).resolvedOptions().timeZone;
    } catch {}
  }
  return systemTimeZone();
}

export type ZoneParts = {
  year: number;
  /** 1–12. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday. */
  weekday: number;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const formats = new Map<string, Intl.DateTimeFormat>();

/** The wall clock in `timeZone` at unix seconds `at`. */
export function zoneParts(at: number, timeZone: string): ZoneParts {
  let f = formats.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
    });
    formats.set(timeZone, f);
  }
  const p: Record<string, string> = {};
  for (const { type, value } of f.formatToParts(at * 1000)) p[type] = value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    second: Number(p.second),
    weekday: WEEKDAYS.indexOf(p.weekday),
  };
}

// Seconds `timeZone` is ahead of UTC at unix seconds `at`.
function offsetAt(at: number, timeZone: string): number {
  const p = zoneParts(at, timeZone);
  const wall =
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000;
  return wall - Math.floor(at);
}

/**
 * Unix seconds of local midnight in `timeZone`, `daysBack` days before the day
 * holding `at`.
 */
export function startOfDay(at: number, timeZone: string, daysBack = 0): number {
  const p = zoneParts(at, timeZone);
  const wall = Date.UTC(p.year, p.month - 1, p.day - daysBack) / 1000;
  // Two passes settle the offset across a DST change.
  let guess = wall - offsetAt(wall, timeZone);
  guess = wall - offsetAt(guess, timeZone);
  return guess;
}

/** Unix seconds of the start of the hour holding `at`, in `timeZone`. */
export function startOfHour(at: number, timeZone: string): number {
  const p = zoneParts(at, timeZone);
  return Math.floor(at) - p.minute * 60 - p.second;
}
