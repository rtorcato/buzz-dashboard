import { describe, expect, it } from "vitest";
import {
  ADMIN_KIND,
  adminEventProblem,
  type ChannelState,
  changeCount,
  createTemplate,
  eventCount,
  nameProblem,
  planEdit,
  templatesFor,
} from "./channel-admin";

const hex = (c: string) => c.repeat(64);
const A = hex("a");
const B = hex("b");
const OWNER = hex("0");
const ID = "11111111-2222-3333-4444-555555555555";

const before: ChannelState = {
  name: "repo-tooling",
  about: "",
  members: [OWNER, A],
  archived: false,
  project: { scope: null },
};

describe("planEdit", () => {
  it("is empty when nothing changed", () => {
    expect(planEdit(before, { ...before })).toEqual([]);
  });
  it("orders details, members, archive, then the project", () => {
    const steps = planEdit(before, {
      name: "#tooling ",
      about: "Shared lint ",
      members: [OWNER, B],
      archived: true,
      project: { scope: "project", slug: "repo-tooling" },
    });
    expect(steps).toEqual([
      { type: "edit", name: "tooling", about: "Shared lint" },
      { type: "add", pubkeys: [B] },
      { type: "remove", pubkeys: [A] },
      { type: "archive", archived: true },
      { type: "project", choice: { scope: "project", slug: "repo-tooling" } },
    ]);
    expect(changeCount(steps)).toBe(6);
    expect(steps.reduce((n, s) => n + eventCount(s), 0)).toBe(4);
  });
  it("sees a move between projects but not a same-project no-op", () => {
    const inApp = {
      ...before,
      project: { scope: "project", slug: "app" },
    } as const;
    expect(
      planEdit(inApp, { ...inApp, project: { scope: "project", slug: "app" } }),
    ).toEqual([]);
    expect(
      planEdit(inApp, { ...inApp, project: { scope: "hive_wide" } }),
    ).toHaveLength(1);
  });
});

describe("templates", () => {
  it("builds the NIP-29 events the Buzz CLI sends", () => {
    expect(
      createTemplate(ID, { name: "#x", about: "d", visibility: "private" }, 1),
    ).toEqual({
      kind: 9007,
      created_at: 1,
      tags: [
        ["h", ID],
        ["name", "x"],
        ["visibility", "private"],
        ["channel_type", "stream"],
        ["about", "d"],
      ],
      content: "",
    });
    expect(
      templatesFor(ID, { type: "archive", archived: true }, 1)[0].tags,
    ).toEqual([
      ["h", ID],
      ["archived", "true"],
    ]);
    const adds = templatesFor(ID, { type: "add", pubkeys: [A, B] }, 1);
    expect(adds.map((t) => [t.kind, t.tags])).toEqual([
      [
        9000,
        [
          ["h", ID],
          ["p", A],
          ["role", "member"],
        ],
      ],
      [
        9000,
        [
          ["h", ID],
          ["p", B],
          ["role", "member"],
        ],
      ],
    ]);
    expect(templatesFor(ID, { type: "remove", pubkeys: [A] }, 1)[0].kind).toBe(
      9001,
    );
    expect(
      templatesFor(ID, { type: "project", choice: { scope: null } }, 1),
    ).toEqual([]);
  });
  it("keeps every template inside the server's allowlist", () => {
    const all = [
      createTemplate(ID, { name: "x", about: "", visibility: "open" }, 1),
      ...templatesFor(ID, { type: "edit", name: "y", about: "" }, 1),
      ...templatesFor(ID, { type: "archive", archived: false }, 1),
      ...templatesFor(ID, { type: "add", pubkeys: [A] }, 1),
      ...templatesFor(ID, { type: "remove", pubkeys: [A] }, 1),
    ];
    for (const t of all) expect(adminEventProblem(t, [OWNER])).toBeNull();
  });
});

describe("names", () => {
  it("refuses empty, long and control-character names", () => {
    expect(nameProblem(" # ")).toMatch(/name/);
    expect(nameProblem("x".repeat(81))).toMatch(/80/);
    expect(nameProblem("a\nb")).toMatch(/line breaks/);
    expect(nameProblem("ok-name")).toBeNull();
  });
});

describe("adminEventProblem", () => {
  const ev = (kind: number, tags: string[][], content = "") => ({
    kind,
    tags,
    content,
  });
  it("refuses any other kind, including channel delete", () => {
    expect(adminEventProblem(ev(9008, [["h", ID]]), [])).toMatch(/kind/);
    expect(adminEventProblem(ev(9, [["h", ID]]), [])).toMatch(/kind/);
  });
  it("refuses extra, repeated, long or missing tags and content", () => {
    expect(
      adminEventProblem(
        ev(ADMIN_KIND.removeMember, [
          ["h", ID],
          ["p", A],
          ["x", "1"],
        ]),
        [],
      ),
    ).toMatch(/unexpected/);
    expect(
      adminEventProblem(
        ev(ADMIN_KIND.addMember, [
          ["h", ID],
          ["p", A],
          ["p", B],
        ]),
        [],
      ),
    ).toMatch(/twice/);
    expect(
      adminEventProblem(
        ev(ADMIN_KIND.addMember, [
          ["h", ID],
          ["p", A, "admin"],
        ]),
        [],
      ),
    ).toMatch(/one value/);
    expect(
      adminEventProblem(ev(ADMIN_KIND.addMember, [["h", ID]]), []),
    ).toMatch(/missing/);
    expect(
      adminEventProblem(
        ev(
          ADMIN_KIND.edit,
          [
            ["h", ID],
            ["about", "x"],
          ],
          "hi",
        ),
        [],
      ),
    ).toMatch(/content/);
  });
  it("only adds plain members", () => {
    expect(
      adminEventProblem(
        ev(ADMIN_KIND.addMember, [
          ["h", ID],
          ["p", A],
          ["role", "admin"],
        ]),
        [],
      ),
    ).toMatch(/member role/);
  });
  it("never removes an owner", () => {
    expect(
      adminEventProblem(
        ev(ADMIN_KIND.removeMember, [
          ["h", ID],
          ["p", OWNER],
        ]),
        [OWNER],
      ),
    ).toMatch(/owner/);
  });
  it("checks the values", () => {
    expect(adminEventProblem(ev(ADMIN_KIND.edit, [["h", ID]]), [])).toMatch(
      /changes something/,
    );
    expect(
      adminEventProblem(
        ev(ADMIN_KIND.edit, [
          ["h", ID],
          ["archived", "yes"],
        ]),
        [],
      ),
    ).toMatch(/archived/);
    expect(
      adminEventProblem(
        ev(ADMIN_KIND.edit, [
          ["h", "bad id!"],
          ["name", "x"],
        ]),
        [],
      ),
    ).toMatch(/channel id/);
    expect(
      adminEventProblem(
        ev(ADMIN_KIND.create, [
          ["h", ID],
          ["name", "x"],
          ["visibility", "public"],
          ["channel_type", "stream"],
        ]),
        [],
      ),
    ).toMatch(/visibility/);
    expect(
      adminEventProblem(
        ev(ADMIN_KIND.create, [
          ["h", ID],
          ["name", "x"],
          ["visibility", "open"],
          ["channel_type", "forum"],
        ]),
        [],
      ),
    ).toMatch(/channel_type/);
  });
});
