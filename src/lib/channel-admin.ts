// Channel admin (#169): the owner creates, renames, archives and staffs
// channels from the dashboard. Every relay change is a NIP-29 moderation
// event the owner's browser extension signs; the server only checks it and
// passes it on, so it never holds a key that could make these changes.
//
// Pure and free of Node imports: the browser builds the events with it and
// the server checks them with the same rules.

/** The NIP-29 moderation kinds the dashboard sends, and nothing else. */
export const ADMIN_KIND = {
  addMember: 9000,
  removeMember: 9001,
  edit: 9002,
  create: 9007,
} as const;

export type EventTemplate = {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
};

export const NAME_MAX = 80;
export const ABOUT_MAX = 500;

// No control characters, so a name can't break a line or hide text. A
// description may hold line breaks (LF) and nothing else below space.
const hasControl = (text: string, allowNewline = false) =>
  [...text].some((ch) => {
    const c = ch.charCodeAt(0);
    return (c < 0x20 || c === 0x7f) && !(allowNewline && c === 0x0a);
  });
const HEX64 = /^[0-9a-f]{64}$/;
export const CHANNEL_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** The name as typed, without a leading # and surrounding space. */
export const cleanName = (name: string) => name.trim().replace(/^#+\s*/, "");

/** Why a channel name can't be used, or null when it can. */
export function nameProblem(name: string): string | null {
  const n = cleanName(name);
  if (!n) return "Give the channel a name.";
  if (n.length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters.`;
  if (hasControl(n)) return "The name can't hold line breaks or tabs.";
  return null;
}

/** Why a description can't be used, or null when it can. */
export function aboutProblem(about: string): string | null {
  if (about.length > ABOUT_MAX) {
    return `Keep the description under ${ABOUT_MAX} characters.`;
  }
  if (hasControl(about, true)) {
    return "The description can't hold tabs or control characters.";
  }
  return null;
}

export type Visibility = "private" | "open";

export const createTemplate = (
  id: string,
  {
    name,
    about,
    visibility,
  }: { name: string; about: string; visibility: Visibility },
  now: number,
): EventTemplate => ({
  kind: ADMIN_KIND.create,
  created_at: now,
  tags: [
    ["h", id],
    ["name", cleanName(name)],
    ["visibility", visibility],
    ["channel_type", "stream"],
    ...(about.trim() ? [["about", about.trim()]] : []),
  ],
  content: "",
});

export const editTemplate = (
  id: string,
  fields: { name?: string; about?: string; archived?: boolean },
  now: number,
): EventTemplate => ({
  kind: ADMIN_KIND.edit,
  created_at: now,
  tags: [
    ["h", id],
    ...(fields.name !== undefined ? [["name", cleanName(fields.name)]] : []),
    ...(fields.about !== undefined ? [["about", fields.about.trim()]] : []),
    ...(fields.archived !== undefined
      ? [["archived", String(fields.archived)]]
      : []),
  ],
  content: "",
});

export const addMemberTemplate = (
  id: string,
  pubkey: string,
  now: number,
): EventTemplate => ({
  kind: ADMIN_KIND.addMember,
  created_at: now,
  tags: [
    ["h", id],
    ["p", pubkey],
    ["role", "member"],
  ],
  content: "",
});

export const removeMemberTemplate = (
  id: string,
  pubkey: string,
  now: number,
): EventTemplate => ({
  kind: ADMIN_KIND.removeMember,
  created_at: now,
  tags: [
    ["h", id],
    ["p", pubkey],
  ],
  content: "",
});

// ---------------------------------------------------------------------------
// The edit sheet: what changed, as the steps the signing dialog shows.

export type ProjectChoice =
  | { scope: null }
  | { scope: "hive_wide" }
  | { scope: "project"; slug: string };

export type ChannelState = {
  name: string;
  about: string;
  members: string[];
  archived: boolean;
  project: ProjectChoice;
};

/** One line in the signing dialog. `relay` steps are signed events. */
export type Step =
  | { type: "edit"; name?: string; about?: string }
  | { type: "add"; pubkeys: string[] }
  | { type: "remove"; pubkeys: string[] }
  | { type: "archive"; archived: boolean }
  | { type: "project"; choice: ProjectChoice };

const sameChoice = (a: ProjectChoice, b: ProjectChoice) =>
  a.scope === b.scope &&
  (a.scope !== "project" || (b.scope === "project" && a.slug === b.slug));

/**
 * The steps from `before` to `after`, in the order they're sent: details,
 * members, archive last (an archived channel may refuse edits), and the
 * dashboard-only project assignment after every relay change has landed.
 */
export function planEdit(before: ChannelState, after: ChannelState): Step[] {
  const steps: Step[] = [];
  const name = cleanName(after.name);
  const about = after.about.trim();
  const edit: { name?: string; about?: string } = {};
  if (name !== before.name) edit.name = name;
  if (about !== before.about.trim()) edit.about = about;
  if (edit.name !== undefined || edit.about !== undefined) {
    steps.push({ type: "edit", ...edit });
  }
  const had = new Set(before.members);
  const has = new Set(after.members);
  const add = after.members.filter((p) => !had.has(p));
  const remove = before.members.filter((p) => !has.has(p));
  if (add.length) steps.push({ type: "add", pubkeys: add });
  if (remove.length) steps.push({ type: "remove", pubkeys: remove });
  if (after.archived !== before.archived) {
    steps.push({ type: "archive", archived: after.archived });
  }
  if (!sameChoice(before.project, after.project)) {
    steps.push({ type: "project", choice: after.project });
  }
  return steps;
}

/** How many relay events a step is: one per member added or removed. */
export function eventCount(step: Step): number {
  switch (step.type) {
    case "add":
    case "remove":
      return step.pubkeys.length;
    case "project":
      return 0;
    default:
      return 1;
  }
}

/** What the sheet's footer counts: a member, a field or a toggle each. */
export function changeCount(steps: Step[]): number {
  return steps.reduce(
    (n, s) =>
      n +
      (s.type === "edit"
        ? Number(s.name !== undefined) + Number(s.about !== undefined)
        : s.type === "add" || s.type === "remove"
          ? s.pubkeys.length
          : 1),
    0,
  );
}

/** The relay events for one step, in sending order. */
export function templatesFor(
  id: string,
  step: Step,
  now: number,
): EventTemplate[] {
  switch (step.type) {
    case "edit":
      return [editTemplate(id, { name: step.name, about: step.about }, now)];
    case "archive":
      return [editTemplate(id, { archived: step.archived }, now)];
    case "add":
      return step.pubkeys.map((p) => addMemberTemplate(id, p, now));
    case "remove":
      return step.pubkeys.map((p) => removeMemberTemplate(id, p, now));
    case "project":
      return [];
  }
}

// ---------------------------------------------------------------------------
// The server's check: only these shapes are passed on to the relay.

type Rule = {
  required: string[];
  optional: string[];
  valid: (tags: Map<string, string>) => string | null;
};

const RULES: Record<number, Rule> = {
  [ADMIN_KIND.create]: {
    required: ["h", "name", "visibility", "channel_type"],
    optional: ["about"],
    valid: (t) =>
      nameProblem(t.get("name") ?? "") ??
      aboutProblem(t.get("about") ?? "") ??
      (["private", "open"].includes(t.get("visibility") ?? "")
        ? null
        : "visibility must be private or open") ??
      (t.get("channel_type") === "stream"
        ? null
        : "channel_type must be stream"),
  },
  [ADMIN_KIND.edit]: {
    required: ["h"],
    optional: ["name", "about", "archived"],
    valid: (t) =>
      !t.has("name") && !t.has("about") && !t.has("archived")
        ? "an edit changes something"
        : ((t.has("name") ? nameProblem(t.get("name") ?? "") : null) ??
          aboutProblem(t.get("about") ?? "") ??
          (!t.has("archived") ||
          ["true", "false"].includes(t.get("archived") ?? "")
            ? null
            : "archived must be true or false")),
  },
  [ADMIN_KIND.addMember]: {
    required: ["h", "p"],
    optional: ["role"],
    valid: (t) =>
      HEX64.test(t.get("p") ?? "")
        ? !t.has("role") || t.get("role") === "member"
          ? null
          : "members join with the member role"
        : "p must be a hex pubkey",
  },
  [ADMIN_KIND.removeMember]: {
    required: ["h", "p"],
    optional: [],
    valid: (t) =>
      HEX64.test(t.get("p") ?? "") ? null : "p must be a hex pubkey",
  },
};

/**
 * Why an event isn't one the dashboard sends, or null when it is: one of the
 * four kinds, exactly its tags (each once, as a name and one value), no
 * content, and never removing an owner key from a channel.
 */
export function adminEventProblem(
  e: { kind: number; tags: string[][]; content: string },
  owners: string[],
): string | null {
  const rule = RULES[e.kind];
  if (!rule) return "not a channel admin kind";
  if (e.content !== "") return "content must be empty";
  const tags = new Map<string, string>();
  for (const t of e.tags) {
    if (t.length !== 2 || typeof t[0] !== "string" || typeof t[1] !== "string")
      return "every tag is a name and one value";
    if (tags.has(t[0])) return `the ${t[0]} tag appears twice`;
    if (![...rule.required, ...rule.optional].includes(t[0]))
      return `unexpected ${t[0]} tag`;
    tags.set(t[0], t[1]);
  }
  for (const name of rule.required) {
    if (!tags.has(name)) return `missing the ${name} tag`;
  }
  if (!CHANNEL_ID.test(tags.get("h") ?? "")) return "h must be a channel id";
  if (
    e.kind === ADMIN_KIND.removeMember &&
    owners.includes(tags.get("p") ?? "")
  )
    return "the owner can't be removed from a channel";
  return rule.valid(tags);
}
