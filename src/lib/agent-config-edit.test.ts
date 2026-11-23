import { describe, expect, it } from "vitest";
import { artifactD, artifactProblem, type ConfigEvent } from "./agent-config";
import {
  changedLabels,
  changeNote,
  GOOSE_TYPE,
  INSTRUCTIONS_TYPE,
  lineDiff,
  lineDiffBlock,
  linesChanged,
  nextInstructionsContent,
  nextSettingsContent,
  pruneEdits,
  refusalOf,
  refusalText,
  revertInstructionsContent,
  revertSettingsContent,
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

const CHOICES = { model: ["sonnet", "haiku", "opus"], effort: ["max"] };

describe("settingsDraftProblem", () => {
  it("takes values from the choices", () => {
    expect(
      settingsDraftProblem(
        GOOSE_TYPE,
        {
          model: "sonnet",
          provider: "anthropic",
          effort: "max",
          scope: "community",
        },
        {},
        CHOICES,
      ),
    ).toBeNull();
  });
  it("refuses any new model or effort without choices", () => {
    expect(settingsDraftProblem(GOOSE_TYPE, { model: "sonnet" })).toMatch(
      /Keep it or use the default/,
    );
  });
  it("refuses unknown keys, non-text and out-of-list values", () => {
    expect(settingsDraftProblem(GOOSE_TYPE, { timeout: "5" })).toMatch(
      /Unknown setting/,
    );
    expect(settingsDraftProblem(GOOSE_TYPE, { model: 5 })).toMatch(/not text/);
    expect(
      settingsDraftProblem(GOOSE_TYPE, { model: "gpt-9" }, {}, CHOICES),
    ).toMatch(/Model can't be "gpt-9"/);
    expect(settingsDraftProblem(GOOSE_TYPE, { scope: "hive" })).toMatch(
      /Session scope/,
    );
    expect(settingsDraftProblem(GOOSE_TYPE, { provider: " x" })).toMatch(
      /spaces/,
    );
  });
  it("checks Provider is an id", () => {
    expect(
      settingsDraftProblem(GOOSE_TYPE, { provider: "gcp_vertex_ai" }),
    ).toBeNull();
    expect(settingsDraftProblem(GOOSE_TYPE, { provider: "a/b" })).toMatch(
      /isn't a provider id/,
    );
    expect(
      settingsDraftProblem(GOOSE_TYPE, { provider: "x".repeat(65) }),
    ).toMatch(/isn't a provider id/);
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
    const r = nextSettingsContent(h, { model: "sonnet", effort: "" }, CHOICES);
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
    expect(nextSettingsContent(h, { model: "nope" }, CHOICES)).toHaveProperty(
      "problem",
    );
  });
});

describe("revisionTemplate", () => {
  it("builds a valid update naming the head as prev", async () => {
    const h = await head(SETTINGS_TYPE, SETTINGS, {
      extra: [["client", "x"]],
    });
    const r = nextSettingsContent(h, { model: "haiku" }, CHOICES) as {
      content: string;
    };
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

describe("edit state", () => {
  it("drops edits that match the head", () => {
    const base = { model: "opus", effort: "", scope: "thread" };
    expect(
      pruneEdits(base, { model: "opus", effort: "high", scope: "thread" }),
    ).toEqual({ effort: "high" });
    expect(pruneEdits(base, { effort: "" })).toEqual({});
  });
  it("names changed fields in card order", () => {
    expect(changedLabels({ effort: "high", model: "x" }, true)).toEqual([
      "Model",
      "Effort",
      "Instructions",
    ]);
    expect(changedLabels({}, false)).toEqual([]);
  });
  it("counts changed instruction lines", () => {
    expect(linesChanged("a\nb", "a\nc")).toBe("1 line changed");
    expect(linesChanged("a", "b\nc\nd")).toBe("3 lines changed");
  });
  it("keeps two lines of context and marks gaps", () => {
    const before = "1\n2\n3\n4\n5\n6\n7\n8";
    const after = "1\n2\n3\n4\n5\n6\n7\nX";
    expect(lineDiffBlock(before, after).map((l) => l.op + l.text)).toEqual([
      " 6",
      " 7",
      "-8",
      "+X",
    ]);
    const mid = lineDiffBlock(
      "a\nb\nc\nd\ne\nf\ng\nh",
      "A\nb\nc\nd\ne\nf\ng\nH",
    );
    expect(mid.some((l) => l.text === "…")).toBe(true);
  });
});

describe("revertSettingsContent", () => {
  it("brings back the old body as it was, unknown fields included", async () => {
    const old = await head(SETTINGS_TYPE, {
      ...SETTINGS,
      settings: { model: "claude-opus-5-5", scope: "channel" },
    });
    expect(revertSettingsContent(old)).toEqual({ content: old.content });
  });
  it("refuses an old revision the runtime would refuse now", async () => {
    const old = await head(SETTINGS_TYPE, {
      ...SETTINGS,
      settings: { timeout: "5" },
    });
    expect(revertSettingsContent(old)).toHaveProperty("problem");
  });
  it("builds a revert over the current head with that content", async () => {
    const old = await head(SETTINGS_TYPE, SETTINGS);
    const current = { ...old, id: "f".repeat(64) };
    const r = revertSettingsContent(old) as { content: string };
    const t = revisionTemplate(current, r.content, {
      note: "Revert to revision 14",
      now: 1,
    });
    expect(t.content).toBe(old.content);
    expect(t.tags.find((x) => x[0] === "prev")).toEqual([
      "prev",
      "f".repeat(64),
    ]);
  });
  it("keeps the head's plugin notes, like Desktop's revertTemplate", async () => {
    const old = await head(SETTINGS_TYPE, {
      ...SETTINGS,
      settings: { model: "sonnet" },
      pluginNotes: { "plugin.a": { data: 0, tag: "old" } },
    });
    const current = await head(SETTINGS_TYPE, SETTINGS);
    const r = revertSettingsContent(old, current) as { content: string };
    const body = JSON.parse(r.content);
    expect(body.settings).toEqual({ model: "sonnet" });
    expect(body.pluginNotes).toEqual(SETTINGS.pluginNotes);
    expect(body.futureField).toEqual({ keep: true });
  });
  it("keeps the target's notes over a deleted head", async () => {
    const old = await head(SETTINGS_TYPE, SETTINGS);
    const gone = await head(SETTINGS_TYPE, null, { op: "delete" });
    expect(revertSettingsContent(old, gone)).toEqual({ content: old.content });
  });
  it("refuses a deleted revision", async () => {
    const gone = await head(SETTINGS_TYPE, null, { op: "delete" });
    expect(revertSettingsContent(gone)).toHaveProperty("problem");
  });
  it("over a deleted head, the template is a restore", async () => {
    const old = await head(SETTINGS_TYPE, SETTINGS);
    const gone = await head(SETTINGS_TYPE, null, { op: "delete" });
    const r = revertSettingsContent(old, gone) as { content: string };
    const t = revisionTemplate(gone, r.content, { now: 1 });
    expect(t.tags.find((x) => x[0] === "op")).toEqual(["op", "restore"]);
  });
});

describe("revertInstructionsContent", () => {
  it("brings back the old text as it was", async () => {
    const old = await head(INSTRUCTIONS_TYPE, { version: 1, text: "Be kind." });
    expect(revertInstructionsContent(old)).toEqual({ content: old.content });
  });
  it("refuses a deleted or unreadable revision", async () => {
    const gone = await head(INSTRUCTIONS_TYPE, null, { op: "delete" });
    expect(revertInstructionsContent(gone)).toHaveProperty("problem");
    const bad = {
      ...gone,
      tags: gone.tags.map((t) => (t[0] === "op" ? ["op", "update"] : t)),
      content: "{",
    };
    expect(revertInstructionsContent(bad)).toHaveProperty("problem");
    const noText = { ...bad, content: JSON.stringify({ version: 1 }) };
    expect(revertInstructionsContent(noText)).toHaveProperty("problem");
  });
});
