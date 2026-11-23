// Agent config history with revert (#196). Reads every revision of an
// agent's settings and instructions from the relay, newest first, 100 at a
// time, the way Buzz Desktop 1.0.6 does (`agent-config-history.ts`
// `loadOlder`), and lays both tracks out as one list of saves. Reverting
// never deletes or rewrites anything: it publishes a new revision carrying
// the old snapshot, through Review and save. Display only: history never
// decides what the current head is; readAgentConfig does.

import {
  ARTIFACT_KIND,
  type ArtifactType,
  artifactProblem,
  type ConfigEvent,
  type ConfigQuery,
  configEvents,
  historyFilter,
  INSTRUCTIONS_TYPE,
  SETTINGS_TYPE,
  tagOf,
} from "./agent-config";

/** Revisions per page (Desktop `HISTORY_PAGE`). */
export const HISTORY_PAGE = 100;
/** The relay's offset ceiling (`buzz-core` artifact.rs `MAX_OFFSET`). */
export const HISTORY_MAX_OFFSET = 10_000;
/** Two revisions of one save sit this close together, in seconds. */
export const SAVE_WINDOW_S = 60;

/** One artifact's loaded revisions, in the relay's order, newest first. */
export type Track = {
  type: ArtifactType;
  d: string;
  revisions: ConfigEvent[];
  /** The next page's offset. */
  next: number;
  /** The relay returned a short page: nothing older is left. */
  done: boolean;
  /** The last page failed; what loaded is kept. */
  failed: boolean;
  /** Revisions the relay holds for this artifact, or null if it didn't say. */
  count: number | null;
};

export const emptyTrack = (type: ArtifactType, d: string): Track => ({
  type,
  d,
  revisions: [],
  next: 0,
  done: false,
  failed: false,
  count: null,
});

/** Whether a track can load another page. */
export const hasOlder = (t: Track) => !t.done && t.next <= HISTORY_MAX_OFFSET;

/**
 * The track with its next page. Every read names the channel in `#h`, since
 * the relay leaves system channels out of any read that doesn't (NIP-CL).
 * Revisions saved since the last page shift the offsets, so repeats are
 * dropped by id. Events that aren't this artifact's are dropped too. A
 * failed page keeps what was loaded.
 */
export async function loadOlder(
  query: ConfigQuery,
  channel: string,
  track: Track,
): Promise<Track> {
  if (!hasOlder(track)) return { ...track, failed: false };
  try {
    const page = configEvents(
      await query(
        "query",
        historyFilter(channel, track.d, {
          limit: HISTORY_PAGE,
          offset: track.next,
        }),
      ),
    );
    const seen = new Set(track.revisions.map((e) => e.id));
    const fresh = page.filter(
      (e) =>
        e.kind === ARTIFACT_KIND &&
        tagOf(e, "d") === track.d &&
        tagOf(e, "h") === channel &&
        !seen.has(e.id) &&
        !!seen.add(e.id),
    );
    return {
      ...track,
      revisions: [...track.revisions, ...fresh],
      next: track.next + HISTORY_PAGE,
      done: page.length < HISTORY_PAGE,
      failed: false,
    };
  } catch {
    return { ...track, failed: true };
  }
}

/** How many revisions the relay holds for a track; null if it won't say. */
export async function countTrack(
  query: ConfigQuery,
  channel: string,
  d: string,
): Promise<number | null> {
  const answer = (await query("count", historyFilter(channel, d)).catch(
    () => null,
  )) as { count?: unknown } | null;
  const n = answer?.count;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** One artifact's revision inside a save. */
export type Part = {
  event: ConfigEvent;
  /** Its revision number in its own track, 1 = the first; null if unknown. */
  n: number | null;
  /** The revision it replaced, if loaded; null for a create or unloaded. */
  before: ConfigEvent | null;
  /** Its predecessor exists but isn't loaded. */
  beforeMissing: boolean;
  /** Why the relay or Desktop wouldn't use it, or null. */
  problem: string | null;
};

/** One row of History: a save, holding one or both artifacts' revisions. */
export type Entry = {
  key: string;
  at: number;
  pubkey: string;
  /** The change note saved with it, or null. */
  note: string | null;
  settings: Part | null;
  instructions: Part | null;
};

const partOf = (track: Track, index: number, channel: string): Part => {
  const event = track.revisions[index];
  const prev = tagOf(event, "prev");
  const before = prev
    ? (track.revisions.find((e) => e.id === prev) ?? null)
    : null;
  const total =
    track.count ??
    (track.done && !track.failed ? track.revisions.length : null);
  return {
    event,
    n: total !== null && total - index >= 1 ? total - index : null,
    before,
    beforeMissing: !!prev && !before,
    problem: artifactProblem(event, {
      channel,
      type: track.type,
      d: track.d,
    }),
  };
};

/**
 * A revision's own change note. Desktop copies the head's unknown tags into
 * the next revision, so a `summary` equal to its predecessor's was carried
 * over, not written for this save, and doesn't show.
 */
function noteOf(part: Part): string | null {
  const note = tagOf(part.event, "summary")?.trim() || null;
  if (!note) return null;
  const before = part.before ? tagOf(part.before, "summary")?.trim() : null;
  return before === note ? null : note;
}

/**
 * Both tracks as one list of saves, newest first. A settings and an
 * instructions revision are one save when the same key signed both within
 * a minute with the same note, as the dashboard's Review and save does.
 */
export function timeline(
  settings: Track,
  instructions: Track,
  channel: string,
): Entry[] {
  const parts = [
    ...settings.revisions.map((_, i) => ({
      side: "settings" as const,
      part: partOf(settings, i, channel),
    })),
    ...instructions.revisions.map((_, i) => ({
      side: "instructions" as const,
      part: partOf(instructions, i, channel),
    })),
  ].sort(
    (a, b) =>
      b.part.event.created_at - a.part.event.created_at ||
      // Same second: the dashboard writes settings first, so in a newest
      // first list instructions come before it.
      (a.side === b.side ? 0 : a.side === "instructions" ? -1 : 1),
  );
  const out: Entry[] = [];
  for (const { side, part } of parts) {
    const note = noteOf(part);
    const last = out.at(-1);
    if (
      last &&
      last[side] === null &&
      last.pubkey === part.event.pubkey &&
      last.note === note &&
      Math.abs(last.at - part.event.created_at) <= SAVE_WINDOW_S
    ) {
      last[side] = part;
      continue;
    }
    out.push({
      key: part.event.id,
      at: part.event.created_at,
      pubkey: part.event.pubkey,
      note,
      settings: side === "settings" ? part : null,
      instructions: side === "instructions" ? part : null,
    });
  }
  return out;
}

/** The row's title: "Revision 14", or "Instructions revision 6". */
export function entryTitle(e: Entry): string {
  if (e.settings) {
    return e.settings.n === null ? "Revision" : `Revision ${e.settings.n}`;
  }
  const n = e.instructions?.n;
  return n === null || n === undefined
    ? "Instructions revision"
    : `Instructions revision ${n}`;
}

/** Whether `e` is the live config: the newest save, holding a current head. */
export const isLive = (
  entries: Entry[],
  e: Entry,
  heads: { settings: string | null; instructions: string | null },
) =>
  entries[0] === e &&
  (e.settings?.event.id === heads.settings ||
    e.instructions?.event.id === heads.instructions);

/**
 * The config as it stood right after `entries[index]`: for each artifact,
 * its newest revision at or before that save. Undefined when that revision
 * isn't loaded yet (the track has older pages), and null when the artifact
 * didn't exist then.
 */
export function stateAt(
  entries: Entry[],
  index: number,
  tracks: { settings: Track; instructions: Track },
): {
  settings: ConfigEvent | null | undefined;
  instructions: ConfigEvent | null | undefined;
} {
  const find = (side: "settings" | "instructions") => {
    for (let j = index; j < entries.length; j++) {
      const part = entries[j][side];
      if (part) return part.event;
    }
    return hasOlder(tracks[side]) || tracks[side].failed ? undefined : null;
  };
  return { settings: find("settings"), instructions: find("instructions") };
}

/** What a revert to `entries[index]` would bring back, or why it can't. */
export type RevertTarget = {
  /** The row's title, for the note: "Revert to revision 14". */
  label: string;
  settings: ConfigEvent | null;
  instructions: ConfigEvent | null;
  /** Artifacts left as they are because their old revision isn't loaded. */
  skipped: ArtifactType[];
};

export function revertTarget(
  entries: Entry[],
  index: number,
  tracks: { settings: Track; instructions: Track },
): RevertTarget {
  const at = stateAt(entries, index, tracks);
  const skipped: ArtifactType[] = [];
  if (at.settings === undefined) skipped.push(SETTINGS_TYPE);
  if (at.instructions === undefined) skipped.push(INSTRUCTIONS_TYPE);
  const title = entryTitle(entries[index]);
  return {
    label: title.charAt(0).toLowerCase() + title.slice(1),
    settings: at.settings ?? null,
    instructions: at.instructions ?? null,
    skipped,
  };
}

/** "npub1q8w…4kz2": a long key, shortened for a muted line. */
export const shortKey = (npub: string) =>
  npub.length > 16 ? `${npub.slice(0, 9)}…${npub.slice(-4)}` : npub;
