import {
  getLocalStorage,
  isLocalStorageAvailable,
  removeLocalStorage,
  setLocalStorage,
} from "@rtorcato/browser-common/localstorage";
import { useSyncExternalStore } from "react";
import { z } from "zod";

// DESIGN.md → Settings: browser preferences only. One versioned localStorage
// key, nothing sent anywhere. Bump the key's version to drop old shapes.
export const SETTINGS_KEY = "hive.settings.v1";

export const VIEWS = [
  "agents",
  "pipeline",
  "releases",
  "timeline",
  "media",
] as const;
export const QUIET_AFTER_MINUTES = [30, 60, 120, 240, 480] as const;
/** "30m", "2h". */
export const quietLabel = (minutes: number) =>
  minutes < 60 ? `${minutes}m` : `${minutes / 60}h`;
export const REFRESH_MS = {
  off: 0,
  "30s": 30_000,
  "1m": 60_000,
  "5m": 300_000,
};

const shape = {
  density: z.enum(["comfortable", "compact"]),
  motion: z.enum(["system", "reduced", "full"]),
  timestamps: z.enum(["relative", "absolute"]),
  // "auto" follows the browser locale.
  clock: z.enum(["auto", "12h", "24h"]),
  timeZone: z.enum(["local", "utc"]),
  refresh: z.enum(["off", "30s", "1m", "5m"]),
  quietAfterMinutes: z
    .number()
    .refine((n) => QUIET_AFTER_MINUTES.some((m) => m === n)),
  openOn: z.enum(VIEWS),
  agentFilter: z.enum(["all", "active", "quiet", "stopped"]),
  agentSort: z.enum(["attention", "recent", "name"]),
  pinned: z.array(z.string()),
  hidden: z.array(z.string()),
  notify: z.boolean(),
  tabCount: z.boolean(),
};

export type Settings = {
  [K in keyof typeof shape]: z.infer<(typeof shape)[K]>;
};

export const DEFAULTS: Settings = {
  density: "comfortable",
  motion: "system",
  timestamps: "relative",
  clock: "auto",
  timeZone: "local",
  refresh: "1m",
  quietAfterMinutes: 120,
  openOn: "agents",
  agentFilter: "all",
  agentSort: "attention",
  pinned: [],
  hidden: [],
  notify: false,
  tabCount: true,
};

/** Reads stored JSON; any missing or invalid field falls back to its default. */
export function parseSettings(raw: string | null): Settings {
  let stored: Record<string, unknown> = {};
  try {
    const value: unknown = raw ? JSON.parse(raw) : {};
    if (value && typeof value === "object") stored = value as typeof stored;
  } catch {}
  const out: Record<string, unknown> = { ...DEFAULTS };
  for (const key of Object.keys(shape) as (keyof Settings)[]) {
    const parsed = shape[key].safeParse(stored[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as Settings;
}

const listeners = new Set<() => void>();
let lastRaw: string | null | undefined;
let cached = DEFAULTS;

function read(): string | null {
  // Blocked storage reads as null, same as a missing key. Keep the in-memory value instead.
  if (!isLocalStorageAvailable()) return lastRaw ?? null;
  // The library parses the stored JSON; serialise it again so parseSettings gets the raw text.
  const stored = getLocalStorage(SETTINGS_KEY);
  return stored === null ? null : JSON.stringify(stored);
}

export { getSnapshot as getSettings };

function getSnapshot(): Settings {
  const raw = read();
  if (raw !== lastRaw) {
    lastRaw = raw;
    cached = parseSettings(raw);
  }
  return cached;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Other tabs change the same key.
  const onStorage = (e: StorageEvent) => {
    if (e.key === SETTINGS_KEY || e.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function write(next: Settings | null) {
  try {
    // The library skips blocked storage without throwing, so check it here.
    if (!isLocalStorageAvailable()) throw new Error("storage blocked");
    if (next === null) removeLocalStorage(SETTINGS_KEY);
    else setLocalStorage(SETTINGS_KEY, next);
  } catch {
    // Storage blocked or full: the preference lasts until the page reloads.
    const raw = next === null ? null : JSON.stringify(next);
    lastRaw = raw;
    cached = parseSettings(raw);
  }
  for (const l of listeners) l();
}

export function updateSettings(patch: Partial<Settings>) {
  write({ ...getSnapshot(), ...patch });
}

export function resetSettings() {
  write(null);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULTS);
}
