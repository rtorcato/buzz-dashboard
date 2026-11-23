import { describe, expect, it } from "vitest";
import {
  artifactD,
  type ConfigEvent,
  type ConfigFilter,
  INSTRUCTIONS_TYPE,
  SETTINGS_TYPE,
} from "./agent-config";
import { GOOSE_TYPE } from "./agent-config-edit";
import {
  countTrack,
  emptyTrack,
  entryTitle,
  HISTORY_PAGE,
  hasOlder,
  isLive,
  loadOlder,
  revertTarget,
  shortKey,
  stateAt,
  type Track,
  timeline,
} from "./agent-config-history";

const CH = "11111111-2222-4333-8444-555555555555";
const OWNER = "b".repeat(64);
const SD = await artifactD(SETTINGS_TYPE, CH);
const ID = await artifactD(INSTRUCTIONS_TYPE, CH);

let seq = 0;
const id = () => (++seq).toString(16).padStart(64, "0");

function rev(
  type: typeof SETTINGS_TYPE | typeof INSTRUCTIONS_TYPE,
  at: number,
  {
    prev,
    note,
    model = "opus",
    text = "Be kind.",
    op,
    pubkey = OWNER,
  }: {
    prev?: ConfigEvent;
    note?: string;
    model?: string;
    text?: string;
    op?: string;
    pubkey?: string;
  } = {},
): ConfigEvent {
  const settings = type === SETTINGS_TYPE;
  const theOp = op ?? (prev ? "update" : "create");
  return {
    id: id(),
    pubkey,
    created_at: at,
    kind: 45010,
    sig: "0".repeat(128),
    content:
      theOp === "delete"
        ? ""
        : JSON.stringify(
            settings
              ? { version: 1, agentType: GOOSE_TYPE, settings: { model } }
              : { version: 1, text },
          ),
    tags: [
      ["ar", "1"],
      ["d", settings ? SD : ID],
      ["h", CH],
      ["type", type],
      ["title", type],
      ["op", theOp],
      ...(prev ? [["prev", prev.id]] : []),
      ...(note ? [["summary", note]] : []),
    ],
  };
}

const track = (
  type: typeof SETTINGS_TYPE | typeof INSTRUCTIONS_TYPE,
  revisions: ConfigEvent[],
  extra: Partial<Track> = {},
): Track => ({
  ...emptyTrack(type, type === SETTINGS_TYPE ? SD : ID),
  revisions,
  next: HISTORY_PAGE,
  done: true,
  count: revisions.length,
  ...extra,
});

describe("loadOlder", () => {
  it("asks for one page by offset, naming the channel and artifact", async () => {
    const asked: ConfigFilter[] = [];
    const t = await loadOlder(
      async (path, f) => {
        expect(path).toBe("query");
        asked.push(f);
        return [];
      },
      CH,
      emptyTrack(SETTINGS_TYPE, SD),
    );
    expect(asked).toEqual([
      {
        kinds: [45010],
        "#h": [CH],
        "#d": [SD],
        artifact: "history",
        limit: 100,
        offset: 0,
      },
    ]);
    expect(t.done).toBe(true);
    expect(hasOlder(t)).toBe(false);
  });

  it("drops repeats and other artifacts' events, and pages on", async () => {
    const a = rev(SETTINGS_TYPE, 10);
    const other = rev(INSTRUCTIONS_TYPE, 11);
    const full = Array.from({ length: HISTORY_PAGE }, (_, k) =>
      k === 0 ? a : rev(SETTINGS_TYPE, 9),
    );
    const first = await loadOlder(
      async () => [...full.slice(0, HISTORY_PAGE - 1), other],
      CH,
      emptyTrack(SETTINGS_TYPE, SD),
    );
    expect(first.revisions).toHaveLength(HISTORY_PAGE - 1);
    expect(first.done).toBe(false);
    expect(first.next).toBe(HISTORY_PAGE);
    const second = await loadOlder(async () => [a], CH, first);
    expect(second.revisions).toHaveLength(HISTORY_PAGE - 1);
    expect(second.done).toBe(true);
  });

  it("keeps what loaded when a page fails", async () => {
    const before = track(SETTINGS_TYPE, [rev(SETTINGS_TYPE, 1)], {
      done: false,
    });
    const t = await loadOlder(
      async () => {
        throw new Error("offline");
      },
      CH,
      before,
    );
    expect(t.failed).toBe(true);
    expect(t.revisions).toEqual(before.revisions);
    expect(t.next).toBe(before.next);
  });
});

describe("countTrack", () => {
  it("reads the relay's count, or null", async () => {
    expect(await countTrack(async () => ({ count: 14 }), CH, SD)).toBe(14);
    expect(await countTrack(async () => ({ count: "14" }), CH, SD)).toBeNull();
    expect(
      await countTrack(
        async () => {
          throw new Error("no");
        },
        CH,
        SD,
      ),
    ).toBeNull();
  });
});

describe("timeline", () => {
  const s1 = rev(SETTINGS_TYPE, 100, { model: "sonnet" });
  const i1 = rev(INSTRUCTIONS_TYPE, 101, { text: "Hi." });
  const s2 = rev(SETTINGS_TYPE, 1000, {
    prev: s1,
    model: "opus",
    note: "Bumble: model to opus, instructions",
  });
  const i2 = rev(INSTRUCTIONS_TYPE, 1002, {
    prev: i1,
    text: "Hello.",
    note: "Bumble: model to opus, instructions",
  });
  const i3 = rev(INSTRUCTIONS_TYPE, 5000, { prev: i2, text: "Hey." });
  const S = track(SETTINGS_TYPE, [s2, s1]);
  const I = track(INSTRUCTIONS_TYPE, [i3, i2, i1]);

  it("lays both tracks out newest first, one row per save", () => {
    const e = timeline(S, I, CH);
    expect(
      e.map((x) => [x.settings?.event.id, x.instructions?.event.id]),
    ).toEqual([
      [undefined, i3.id],
      [s2.id, i2.id],
      [s1.id, i1.id],
    ]);
    expect(e[1].note).toBe("Bumble: model to opus, instructions");
    expect(e[1].settings?.n).toBe(2);
    expect(e[1].instructions?.n).toBe(2);
    expect(e[1].settings?.before?.id).toBe(s1.id);
    expect(entryTitle(e[0])).toBe("Instructions revision 3");
    expect(entryTitle(e[1])).toBe("Revision 2");
  });

  it("doesn't join revisions from different keys or notes", () => {
    const other = rev(SETTINGS_TYPE, 1001, {
      prev: s1,
      pubkey: "c".repeat(64),
    });
    const e = timeline(track(SETTINGS_TYPE, [other, s1]), I, CH);
    expect(e.find((x) => x.settings?.event.id === other.id)?.instructions).toBe(
      null,
    );
  });

  it("hides a summary carried over from the revision before", () => {
    const s3 = rev(SETTINGS_TYPE, 9000, {
      prev: s2,
      note: "Bumble: model to opus, instructions",
    });
    const e = timeline(track(SETTINGS_TYPE, [s3, s2, s1]), I, CH);
    expect(e[0].note).toBeNull();
  });

  it("numbers by the relay's count when only a page is loaded", () => {
    const e = timeline(
      track(SETTINGS_TYPE, [s2], { count: 40, done: false }),
      track(INSTRUCTIONS_TYPE, []),
      CH,
    );
    expect(e[0].settings?.n).toBe(40);
    expect(e[0].settings?.beforeMissing).toBe(true);
    const unknown = timeline(
      track(SETTINGS_TYPE, [s2], { count: null, done: false }),
      track(INSTRUCTIONS_TYPE, []),
      CH,
    );
    expect(entryTitle(unknown[0])).toBe("Revision");
  });

  it("marks the newest save Live when it holds a current head", () => {
    const e = timeline(S, I, CH);
    const heads = { settings: s2.id, instructions: i3.id };
    expect(isLive(e, e[0], heads)).toBe(true);
    expect(isLive(e, e[1], heads)).toBe(false);
  });

  it("flags a revision Buzz can't use", () => {
    const bad = { ...s1, content: "{}" };
    const e = timeline(
      track(SETTINGS_TYPE, [bad]),
      track(INSTRUCTIONS_TYPE, []),
      CH,
    );
    expect(e[0].settings?.problem).toBe("Unknown artifact version");
  });
});

describe("revert to a save", () => {
  const s1 = rev(SETTINGS_TYPE, 100, { model: "sonnet" });
  const i1 = rev(INSTRUCTIONS_TYPE, 101, { text: "Hi." });
  const s2 = rev(SETTINGS_TYPE, 1000, { prev: s1, model: "opus" });
  const i2 = rev(INSTRUCTIONS_TYPE, 5000, { prev: i1, text: "Hello." });
  const tracks = {
    settings: track(SETTINGS_TYPE, [s2, s1]),
    instructions: track(INSTRUCTIONS_TYPE, [i2, i1]),
  };
  const e = timeline(tracks.settings, tracks.instructions, CH);

  it("brings back both parts as they stood after that save", () => {
    // Rows: i2, s2, (s1 + i1).
    expect(stateAt(e, 1, tracks)).toEqual({ settings: s2, instructions: i1 });
    expect(revertTarget(e, 2, tracks)).toEqual({
      label: "revision 1",
      settings: s1,
      instructions: i1,
      skipped: [],
    });
  });

  it("leaves a part alone when its old revision isn't loaded", () => {
    const partial = {
      settings: track(SETTINGS_TYPE, [s2], { done: false, count: 2 }),
      instructions: tracks.instructions,
    };
    const rows = timeline(partial.settings, partial.instructions, CH);
    const last = rows.length - 1;
    const t = revertTarget(rows, last, partial);
    expect(t.settings).toBeNull();
    expect(t.instructions?.id).toBe(i1.id);
    expect(t.skipped).toEqual([SETTINGS_TYPE]);
  });

  it("says a part didn't exist yet with null, not a skip", () => {
    const late = rev(INSTRUCTIONS_TYPE, 9000, { text: "New." });
    const t2 = {
      settings: track(SETTINGS_TYPE, [s1]),
      instructions: track(INSTRUCTIONS_TYPE, [late]),
    };
    const rows = timeline(t2.settings, t2.instructions, CH);
    expect(revertTarget(rows, 1, t2)).toMatchObject({
      settings: s1,
      instructions: null,
      skipped: [],
    });
  });
});

describe("shortKey", () => {
  it("keeps the start and the end", () => {
    expect(shortKey("npub1q8wabcdefghijklmnop4kz2")).toBe("npub1q8wa…4kz2");
    expect(shortKey("npub1short")).toBe("npub1short");
  });
});
