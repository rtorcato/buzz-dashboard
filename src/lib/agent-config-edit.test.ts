import { describe, expect, it } from "vitest";
import { artifactD, artifactProblem, type ConfigEvent } from "./agent-config";
import {
  changeNote,
  GOOSE_TYPE,
  INSTRUCTIONS_TYPE,
  lineDiff,
  nextInstructionsContent,
  nextSettingsContent,
  refusalOf,
  refusalText,
  revisionTemplate,
  SETTINGS_TYPE,
  settingsDraftProblem,
  settingsLines,
} from "./agent-config-edit";

const CH = "11111111-2222-4333-8444-555555555555";
const HEAD_ID = "e".repeat(64);

async function head(
  type: typeof SETTINGS_TYPE | typeof INSTRUCTIONS_TYPE,
  body: unknown,
  { op = "update", extra = [] as string[][] } = {},
): Promise<ConfigEvent> {
  return {
    id: HEAD_ID,
    pubkey: "b".repeat(64),
    created_at: 1_800_000_000,
    kind: 45010,
    content: op === "delete" ? "" : JSON.stringify(body),
    sig: "0".repeat(128),
    tags: [
      ["ar", "1"],
      ["d", await artifactD(type, CH)],
      ["h", CH],
      ["type", type],
      ["title", "Bumble settings"],
      ["op", op],
      ["prev", "c".repeat(64)],
      ["preset", "old"],
      ["note", "plugin.a", "stale"],
      ["summary", "an older note"],
      ...extra,
    ],
  };
}

const SETTINGS = {
  version: 1,
  agentType: GOOSE_TYPE,
  settings: { model: "opus", effort: "high", scope: "thread" },
  preset: "recommended",
  pluginNotes: { "plugin.a": { data: 1, tag: "fresh" } },
  futureField: { keep: true },
};

describe("settingsDraftProblem", () => {
  it("takes known values", () => {
    expect(
      settingsDraftProblem(GOOSE_TYPE, {
        model: "sonnet",
        provider: "anthropic",
        effort: "max",
        scope: "community",
      }),
    ).toBeNull();
  });
  it("refuses unknown keys, non-text and out-of-list values", () => {
    expect(settingsDraftProblem(GOOSE_TYPE, { timeout: "5" })).toMatch(
      /Unknown setting/,
    );
    expect(settingsDraftProblem(GOOSE_TYPE, { model: 5 })).toMatch(/not text/);
    expect(settingsDraftProblem(GOOSE_TYPE, { model: "gpt-9" })).toMatch(
      /Model can't be "gpt-9"/,
    );
    expect(settingsDraftProblem(GOOSE_TYPE, { scope: "hive" })).toMatch(
      /Session scope/,
    );
    expect(settingsDraftProblem(GOOSE_TYPE, { provider: " x" })).toMatch(
      /spaces/,
    );
  });
  it("keeps a head value that isn't on the list, if unchanged", () => {
    const kept = { model: "claude-opus-5-5" };
    expect(settingsDraftProblem(GOOSE_TYPE, kept, kept)).toBeNull();
  });
  it("only edits goose agents", () => {
    expect(
      settingsDraftProblem("buzz.claude-code/claude-code", { model: "opus" }),
    ).toMatch(/goose/);
    expect(settingsDraftProblem(null, {})).toMatch(/goose/);
  });
});

describe("nextSettingsContent", () => {
  it("applies the draft and keeps every other field", async () => {
    const h = await head(SETTINGS_TYPE, SETTINGS);
    const r = nextSettingsContent(h, { model: "sonnet", effort: "" });
    expect("content" in r).toBe(true);
    const body = JSON.parse((r as { content: string }).content);
    expect(body.settings).toEqual({ model: "sonnet", scope: "thread" });
    expect(body.preset).toBe("recommended");
    expect(body.pluginNotes).toEqual(SETTINGS.pluginNotes);
    expect(body.futureField).toEqual({ keep: true });
    expect(body.agentType).toBe(GOOSE_TYPE);
  });
  it("refuses an invalid draft before signing", async () => {
    const h = await head(SETTINGS_TYPE, SETTINGS);
    expect(nextSettingsContent(h, { model: "nope" })).toHaveProperty("problem");
  });
});

describe("revisionTemplate", () => {
  it("builds a valid update naming the head as prev", async () => {
    const h = await head(SETTINGS_TYPE, SETTINGS, {
      extra: [["client", "x"]],
    });
    const r = nextSettingsContent(h, { model: "haiku" }) as { content: string };
    const t = revisionTemplate(h, r.content, {
      note: " Bumble: model to haiku ",
      now: 1,
    });
    const tag = (n: string) => t.tags.filter((x) => x[0] === n);
    expect(tag("op")).toEqual([["op", "update"]]);
    expect(tag("prev")).toEqual([["prev", HEAD_ID]]);
    // Fresh marks from the content; the head's stale ones are dropped.
    expect(tag("preset")).toEqual([["preset", "recommended"]]);
    expect(tag("note")).toEqual([["note", "plugin.a", "fresh"]]);
    expect(tag("summary")).toEqual([["summary", "Bumble: model to haiku"]]);
    // Unknown tags survive.
    expect(tag("client")).toEqual([["client", "x"]]);
    const d = await artifactD(SETTINGS_TYPE, CH);
    expect(
      artifactProblem(
        { ...h, ...t, id: "f".repeat(64) },
        {
          channel: CH,
          type: SETTINGS_TYPE,
          d,
        },
      ),
    ).toBeNull();
  });
  it("restores over a deleted head", async () => {
    const h = await head(INSTRUCTIONS_TYPE, null, { op: "delete" });
    const t = revisionTemplate(h, JSON.stringify({ version: 1, text: "hi" }));
    expect(t.tags).toContainEqual(["op", "restore"]);
    expect(t.tags).not.toContainEqual(["summary", "an older note"]);
  });
  it("keeps instructions fields", async () => {
    const h = await head(INSTRUCTIONS_TYPE, { version: 1, text: "a", x: 1 });
    expect(nextInstructionsContent(h, "b")).toEqual({
      content: JSON.stringify({ version: 1, text: "b", x: 1 }),
    });
    expect(nextInstructionsContent(h, "a\u0000")).toHaveProperty("problem");
  });
});

describe("review helpers", () => {
  it("prefills the change note", () => {
    expect(
      changeNote(
        "Bumble",
        { model: "opus" },
        { model: "sonnet", effort: "high" },
        true,
      ),
    ).toBe("Bumble: model to sonnet, effort to high, instructions");
    expect(changeNote("Bumble", { model: "opus" }, {}, false)).toBe(
      "Bumble: model to default",
    );
  });
  it("diffs lines", () => {
    expect(lineDiff("a\nb\nc", "a\nx\nc")).toEqual([
      { op: " ", text: "a" },
      { op: "-", text: "b" },
      { op: "+", text: "x" },
      { op: " ", text: "c" },
    ]);
    expect(settingsLines(JSON.stringify(SETTINGS))).toBe(
      "effort: high\nmodel: opus\nscope: thread",
    );
  });
  it("words relay refusals", () => {
    expect(refusalOf("conflict: prev is not the head")).toBe("conflict");
    expect(refusalOf("restricted: not a member")).toBe("permission");
    expect(refusalText("Bumble", "conflict: stale")).toBe(
      "Not saved. Someone else changed Bumble's config since you opened it. Reload to see their change. Your edits are kept.",
    );
  });
});
