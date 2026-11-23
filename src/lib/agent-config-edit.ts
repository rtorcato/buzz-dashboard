// Owner-only edit and save of agent config (#195). Builds the next NIP-AR
// revision from the current head, the way Buzz Desktop 1.0.6 does
// (`artifactTemplate`, `settingsProblem`, NIP-AP "Editing"): it keeps every
// field and tag it doesn't know, validates strictly before anything is
// signed, and names the current head as `prev` so a stale edit is refused.

import {
  ARTIFACT_KIND,
  type ArtifactType,
  type ConfigEvent,
  INSTRUCTIONS_TYPE,
  SETTINGS_TYPE,
  tagOf,
} from "./agent-config";

/** The goose runtime's plugin type, as settings name it in `agentType`. */
export const GOOSE_TYPE = "buzz.goose/goose";

/** The settings Desktop syncs for goose (`goose/settings.ts`). */
export const GOOSE_SCHEMA = {
  model: "string",
  provider: "string",
  effort: "string",
  scope: ["thread", "channel", "community"],
} as const;

/**
 * The values the dashboard lets you pick for model and effort. goose takes
 * the model IDs and thinking levels its provider offers, and the dashboard
 * can't read that list (#192): a value goose doesn't offer fails the
 * agent's next turn. So the page passes only values this hive already runs
 * (the status feed's models, the head's own value). Blank, the runtime
 * default, is always allowed.
 */
export type Choices = { model: readonly string[]; effort: readonly string[] };
export const NO_CHOICES: Choices = { model: [], effort: [] };
export const SCOPE_VALUES = GOOSE_SCHEMA.scope;

export const SETTINGS_MAX_BYTES = 65_535;
export const INSTRUCTIONS_MAX_BYTES = 131_072;
/** Bytes for a change note, kept as a `summary` tag. */
export const NOTE_MAX_BYTES = 280;

const bytes = (s: string) => new TextEncoder().encode(s).length;

export type SettingKey = keyof typeof GOOSE_SCHEMA;
/** A field's new value: text, or "" to leave it out (the runtime default). */
export type SettingsDraft = Partial<Record<SettingKey, string>>;

/** Whether the dashboard can edit settings of this `agentType`. */
export const editableType = (agentType: string | null) =>
  agentType === GOOSE_TYPE;

/**
 * Why `settings` can't be signed for `agentType`, or null. Strict, like
 * Desktop's check that blocks the agent's next start: an unknown key, a
 * non-text value or an out-of-set value fails. Model and effort must come
 * from the lists unless they equal `kept` (the head's value).
 */
export function settingsDraftProblem(
  agentType: string | null,
  settings: Record<string, unknown>,
  kept: Record<string, unknown> = {},
  choices: Choices = NO_CHOICES,
): string | null {
  if (!editableType(agentType)) {
    return "The dashboard can only edit goose agents for now.";
  }
  for (const [name, value] of Object.entries(settings)) {
    if (!Object.hasOwn(GOOSE_SCHEMA, name)) return `Unknown setting "${name}".`;
    if (typeof value !== "string") return `Setting "${name}" is not text.`;
    if (value !== value.trim() || !value || /[\p{Cc}]/u.test(value)) {
      return `Setting "${name}" has spaces or control characters.`;
    }
    if (value === kept[name]) continue;
    const allowed: Record<string, readonly string[]> = {
      model: choices.model,
      effort: choices.effort,
      scope: SCOPE_VALUES,
    };
    if (allowed[name] && !allowed[name].includes(value)) {
      return allowed[name].length
        ? `${label(name)} can't be "${value}". Pick one of ${allowed[name].join(", ")}, or the default.`
        : `${label(name)} can't be "${value}". Keep it or use the default.`;
    }
    // A goose provider id: "anthropic", "openai", "gcp_vertex_ai", …
    if (name === "provider" && !/^[a-z0-9][a-z0-9_.-]{0,63}$/i.test(value)) {
      return `Provider "${value.slice(0, 64)}" isn't a provider id.`;
    }
  }
  return null;
}

export const label = (k: string) =>
  ({
    model: "Model",
    provider: "Provider",
    effort: "Effort",
    scope: "Session scope",
  })[k] ?? k;

type SettingsBody = {
  version: 1;
  agentType?: string;
  settings: Record<string, unknown>;
  [field: string]: unknown;
};

/**
 * The next settings content: the head's body with `draft` applied. Every
 * other field (`preset`, `pluginNotes`, anything newer) is kept as it was.
 * An empty value removes the key so the runtime default applies.
 */
export function nextSettingsContent(
  head: ConfigEvent,
  draft: SettingsDraft,
  choices: Choices = NO_CHOICES,
): { content: string } | { problem: string } {
  let body: SettingsBody;
  try {
    body = JSON.parse(head.content) as SettingsBody;
  } catch {
    return { problem: "The current settings aren't readable." };
  }
  const kept = { ...body.settings };
  const settings: Record<string, unknown> = { ...body.settings };
  for (const [k, v] of Object.entries(draft)) {
    if (v === undefined) continue;
    if (v === "") delete settings[k];
    else settings[k] = v;
  }
  const problem = settingsDraftProblem(
    body.agentType ?? null,
    settings,
    kept,
    choices,
  );
  if (problem) return { problem };
  const content = JSON.stringify({ ...body, settings });
  if (bytes(content) > SETTINGS_MAX_BYTES) {
    return { problem: "The settings are too large to save." };
  }
  return { content };
}

/** The next instructions content, keeping any other fields of the head. */
export function nextInstructionsContent(
  head: ConfigEvent,
  text: string,
): { content: string } | { problem: string } {
  if (text.includes("\u0000")) {
    return { problem: "The instructions contain a null character." };
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(head.content) as Record<string, unknown>;
  } catch {
    return { problem: "The current instructions aren't readable." };
  }
  const content = JSON.stringify({ ...body, version: 1, text });
  if (bytes(content) > INSTRUCTIONS_MAX_BYTES) {
    return { problem: "The instructions are too long to save." };
  }
  return { content };
}

// Tags the template writes itself; the rest of the head's tags are kept.
const OWN_TAGS = new Set([
  "ar",
  "d",
  "h",
  "type",
  "title",
  "op",
  "prev",
  "summary",
]);

/** A settings body's `preset` and plugin note tags (Desktop `settingsMarks`). */
function settingsMarks(content: string): string[][] {
  try {
    const body = JSON.parse(content) as {
      preset?: unknown;
      pluginNotes?: Record<string, { tag?: unknown }>;
    };
    const marks: string[][] = [];
    if (typeof body.preset === "string" && body.preset) {
      marks.push(["preset", body.preset]);
    }
    const notes = body.pluginNotes;
    if (notes && typeof notes === "object" && !Array.isArray(notes)) {
      for (const [id, note] of Object.entries(notes)) {
        if (typeof note?.tag === "string" && note.tag) {
          marks.push(["note", id, note.tag]);
        }
      }
    }
    return marks;
  } catch {
    return [];
  }
}

export type RevisionTemplate = {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
};

/**
 * The unsigned revision that replaces `head`. `op` is `update`, or
 * `restore` over a deleted head. `prev` is the head, so the relay refuses
 * it if someone saved in between. The head's unknown tags are kept;
 * settings get fresh `preset` and note tags from their content.
 */
export function revisionTemplate(
  head: ConfigEvent,
  content: string,
  {
    note,
    now = Math.floor(Date.now() / 1000),
  }: { note?: string; now?: number } = {},
): RevisionTemplate {
  const type = tagOf(head, "type") as ArtifactType;
  const settings = type === SETTINGS_TYPE;
  const kept = head.tags.filter(
    ([name]) =>
      !OWN_TAGS.has(name) &&
      !(settings && (name === "preset" || name === "note")),
  );
  const summary = note?.trim();
  return {
    kind: ARTIFACT_KIND,
    created_at: now,
    content,
    tags: [
      ["ar", "1"],
      ["d", tagOf(head, "d") ?? ""],
      ["h", tagOf(head, "h") ?? ""],
      ["type", type],
      ["title", tagOf(head, "title") ?? type],
      ["op", tagOf(head, "op") === "delete" ? "restore" : "update"],
      ["prev", head.id],
      ...(settings ? settingsMarks(content) : []),
      ...kept.map((t) => [...t]),
      ...(summary ? [["summary", truncateBytes(summary, NOTE_MAX_BYTES)]] : []),
    ],
  };
}

function truncateBytes(s: string, max: number): string {
  let out = "";
  for (const ch of s) {
    if (bytes(out + ch) > max) break;
    out += ch;
  }
  return out;
}

/** The prefilled change note: "Bumble: model to opus, effort high". */
export function changeNote(
  name: string,
  before: SettingsDraft,
  after: SettingsDraft,
  instructionsChanged: boolean,
): string {
  const parts: string[] = [];
  for (const k of Object.keys(GOOSE_SCHEMA) as SettingKey[]) {
    const a = before[k] ?? "";
    const b = after[k] ?? "";
    if (a === b) continue;
    parts.push(
      b
        ? `${label(k).toLowerCase()} to ${b}`
        : `${label(k).toLowerCase()} to default`,
    );
  }
  if (instructionsChanged) parts.push("instructions");
  return parts.length ? `${name}: ${parts.join(", ")}` : "";
}

export type DiffLine = { op: " " | "-" | "+"; text: string };

/** A line diff (LCS), for the Review and save blocks. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const w = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * w + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * w + j + 1] + 1
          : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: " ", text: a[i] });
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
      out.push({ op: "-", text: a[i++] });
    } else {
      out.push({ op: "+", text: b[j++] });
    }
  }
  while (i < a.length) out.push({ op: "-", text: a[i++] });
  while (j < b.length) out.push({ op: "+", text: b[j++] });
  return out;
}

export type LineDiff = DiffLine;

/**
 * The diff as the Review and save block shows it: changed lines with
 * `context` unchanged lines around them, and a "…" line for each gap.
 */
export function lineDiffBlock(
  before: string,
  after: string,
  context = 2,
): DiffLine[] {
  const all = lineDiff(before, after);
  const keep = all.map(() => false);
  all.forEach((l, k) => {
    if (l.op === " ") return;
    for (
      let j = Math.max(0, k - context);
      j <= Math.min(all.length - 1, k + context);
      j++
    )
      keep[j] = true;
  });
  const out: DiffLine[] = [];
  let gap = false;
  all.forEach((l, k) => {
    if (keep[k]) {
      if (gap && out.length) out.push({ op: " ", text: "…" });
      gap = false;
      out.push(l);
    } else gap = true;
  });
  return out;
}

/** Settings as `key: value` lines, for the diff. */
export const settingsLines = (content: string) => {
  try {
    const s = (JSON.parse(content) as SettingsBody).settings ?? {};
    return Object.keys(s)
      .sort()
      .map((k) => `${k}: ${String(s[k])}`)
      .join("\n");
  } catch {
    return "";
  }
};

export type SaveRefusal = "conflict" | "permission" | "invalid" | "other";

/** A relay refusal by its machine-readable prefix (Desktop `refusal`). */
export function refusalOf(message: string): SaveRefusal {
  const prefix = /^([a-z-]+):/.exec(message)?.[1];
  if (prefix === "conflict") return "conflict";
  if (
    prefix === "restricted" ||
    prefix === "auth-required" ||
    prefix === "blocked"
  )
    return "permission";
  if (prefix === "invalid") return "invalid";
  return "other";
}

/** The Review and save Alert's words for a refused save. */
export function refusalText(name: string, message: string): string {
  switch (refusalOf(message)) {
    case "conflict":
      return `Not saved. Someone else changed ${name}'s config since you opened it. Reload to see their change. Your edits are kept.`;
    case "permission":
      return `Not saved. The relay didn't let this key change ${name}'s config. Only the owner's key can change agents on this hive.`;
    case "invalid":
      return `Not saved. The relay refused the revision: ${message.slice(0, 200)}`;
    default:
      return `Not saved. ${message.slice(0, 200) || "The relay didn't accept it."} Your edits are kept.`;
  }
}

/**
 * Settings content that brings back `target` (an older revision) over the
 * current head, like Desktop's `revertTemplate`: the old body as it was.
 * Still checked, so a revision the runtime would now refuse isn't signed.
 */
export function revertSettingsContent(
  target: ConfigEvent,
): { content: string } | { problem: string } {
  let body: SettingsBody;
  try {
    body = JSON.parse(target.content) as SettingsBody;
  } catch {
    return { problem: "That revision's settings aren't readable." };
  }
  if (!body || typeof body.settings !== "object" || !body.settings) {
    return { problem: "That revision has no settings." };
  }
  const problem = settingsDraftProblem(
    body.agentType ?? null,
    body.settings,
    body.settings,
  );
  return problem ? { problem } : { content: target.content };
}

/** The edits that differ from `base`; an edit back to the base drops out. */
export function pruneEdits(
  base: SettingsDraft,
  edits: SettingsDraft,
): SettingsDraft {
  const out: SettingsDraft = {};
  for (const k of Object.keys(GOOSE_SCHEMA) as SettingKey[]) {
    const v = edits[k];
    if (v !== undefined && v !== (base[k] ?? "")) out[k] = v;
  }
  return out;
}

/** The changed fields' labels, in card order: "Model, Effort, Instructions". */
export function changedLabels(
  edits: SettingsDraft,
  instructionsChanged: boolean,
): string[] {
  const order: SettingKey[] = ["model", "provider", "effort", "scope"];
  return [
    ...order.filter((k) => edits[k] !== undefined).map(label),
    ...(instructionsChanged ? ["Instructions"] : []),
  ];
}

/** "1 line changed", "3 lines changed": the instructions preview's note. */
export function linesChanged(before: string, after: string): string {
  const diff = lineDiff(before, after);
  const removed = diff.filter((l) => l.op === "-").length;
  const added = diff.filter((l) => l.op === "+").length;
  const n = Math.max(removed, added);
  return `${n} line${n === 1 ? "" : "s"} changed`;
}

export { INSTRUCTIONS_TYPE, SETTINGS_TYPE };
