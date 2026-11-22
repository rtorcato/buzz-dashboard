import { createHash } from "node:crypto";
import { schnorr } from "@noble/curves/secp256k1.js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  bodyHash,
  ChannelAssignmentSchema,
  HTTP_AUTH_KIND,
  hiveOf,
  membersFrom,
  NewProjectSchema,
  ProjectPatchSchema,
  seedPlan,
  slugFor,
  verifySignedEdit,
} = await import("./projects");

const NOW = 1_800_000_000;
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const secret = schnorr.utils.randomSecretKey();
const pubkey = hex(schnorr.getPublicKey(secret));
const URL_ = "https://hive.example/api/projects/db-common";
const BODY = JSON.stringify({ base_revision: 0, set: { name: "DB" } });

function sign(e: {
  kind?: number;
  at?: number;
  tags?: string[][];
  key?: Uint8Array;
}) {
  const key = e.key ?? secret;
  const event = {
    pubkey: hex(schnorr.getPublicKey(key)),
    created_at: e.at ?? NOW,
    kind: e.kind ?? HTTP_AUTH_KIND,
    tags: e.tags ?? [
      ["u", URL_],
      ["method", "POST"],
      ["payload", bodyHash(BODY)],
    ],
    content: "",
  };
  const id = createHash("sha256")
    .update(
      JSON.stringify([
        0,
        event.pubkey,
        event.created_at,
        event.kind,
        event.tags,
        event.content,
      ]),
    )
    .digest("hex");
  const sig = hex(schnorr.sign(Buffer.from(id, "hex"), key));
  return { ...event, id, sig };
}

const header = (e: unknown) =>
  `Nostr ${Buffer.from(JSON.stringify(e)).toString("base64")}`;

const check = (
  h: string | null,
  over: { body?: string; owners?: string[]; now?: number } = {},
) =>
  verifySignedEdit(h, {
    url: URL_,
    method: "POST",
    body: over.body ?? BODY,
    owners: over.owners ?? [pubkey],
    now: over.now ?? NOW,
  });

describe("verifySignedEdit (#166)", () => {
  it("accepts an owner's event for this URL, method and body", () => {
    const e = sign({});
    expect(check(header(e))).toEqual({ event: e });
  });

  it("refuses a missing or malformed header", () => {
    expect(check(null)).toEqual({ error: "missing signature" });
    expect(check("Bearer abc")).toEqual({ error: "missing signature" });
    expect(check("Nostr !!!")).toEqual({ error: "missing signature" });
    expect(check(`Nostr ${Buffer.from("{").toString("base64")}`)).toEqual({
      error: "malformed event",
    });
  });

  it("refuses another kind, an old event, URL or method", () => {
    expect(check(header(sign({ kind: 1 })))).toEqual({ error: "wrong kind" });
    expect(check(header(sign({ at: NOW - 61 })))).toEqual({ error: "expired" });
    expect(
      check(
        header(
          sign({
            tags: [
              ["u", "https://hive.example/api/projects/other"],
              ["method", "POST"],
              ["payload", bodyHash(BODY)],
            ],
          }),
        ),
      ),
    ).toEqual({ error: "wrong url" });
    expect(
      check(
        header(
          sign({
            tags: [
              ["u", URL_],
              ["method", "GET"],
              ["payload", bodyHash(BODY)],
            ],
          }),
        ),
      ),
    ).toEqual({ error: "wrong method" });
  });

  it("refuses a body that isn't the one signed", () => {
    expect(check(header(sign({})), { body: `${BODY} ` })).toEqual({
      error: "body doesn’t match the signature",
    });
  });

  it("refuses a forged signature and a key that isn't an owner", () => {
    const e = sign({});
    expect(check(header({ ...e, sig: "0".repeat(128) }))).toEqual({
      error: "bad signature",
    });
    expect(check(header(e), { owners: ["f".repeat(64)] })).toEqual({
      error: "not the owner",
    });
  });
});

describe("patch schemas", () => {
  it("lowercases repos and takes partial fields", () => {
    const p = ProjectPatchSchema.parse({
      base_revision: 2,
      set: { release_model: "app_dev", dev_branch: "dev" },
      repos: { add: [{ repo: "Acme/Widget", primary: true }] },
    });
    expect(p.repos?.add[0].repo).toBe("acme/widget");
    expect(p.set).toEqual({ release_model: "app_dev", dev_branch: "dev" });
  });

  it("refuses unknown keys, bad labels and models", () => {
    expect(
      ProjectPatchSchema.safeParse({ base_revision: 0, hive: "x" }).success,
    ).toBe(false);
    expect(
      ProjectPatchSchema.safeParse({
        base_revision: 0,
        set: { short_label: "abcd" },
      }).success,
    ).toBe(false);
    expect(
      ProjectPatchSchema.safeParse({
        base_revision: 0,
        set: { release_model: "nightly" },
      }).success,
    ).toBe(false);
  });

  it("needs a slug and a name to create", () => {
    expect(NewProjectSchema.safeParse({ slug: "db", set: {} }).success).toBe(
      false,
    );
    expect(
      NewProjectSchema.safeParse({ slug: "DB", set: { name: "DB" } }).success,
    ).toBe(false);
    expect(
      NewProjectSchema.safeParse({ slug: "db", set: { name: "DB" } }).success,
    ).toBe(true);
  });

  it("ties a channel's project to its scope", () => {
    const ok = (v: unknown) => ChannelAssignmentSchema.safeParse(v).success;
    expect(ok({ base_revision: 0, scope: "project", project: "db" })).toBe(
      true,
    );
    expect(ok({ base_revision: 0, scope: "project" })).toBe(false);
    expect(ok({ base_revision: 0, scope: "hive_wide", project: "db" })).toBe(
      false,
    );
    expect(ok({ base_revision: 0, scope: "hive_wide", is_home: true })).toBe(
      false,
    );
    expect(ok({ base_revision: 1, scope: null })).toBe(true);
  });
});

describe("hiveOf", () => {
  it("matches hiveStatements' form of the relay URL", () => {
    expect(hiveOf("wss://relay.example")).toBe("wss://relay.example/");
    expect(hiveOf("https://relay.example")).toBeNull();
    expect(hiveOf(undefined)).toBeNull();
  });
});

describe("seedPlan (#166)", () => {
  const A = "a".repeat(64);
  const B = "b".repeat(64);
  const OWNER = "c".repeat(64);
  const plan = (repos: string[], channels: Record<string, string> = {}) =>
    seedPlan({
      repos,
      owners: ["Acme"],
      channels,
      members: { c1: [A, B, OWNER] },
      agentPubkeys: new Set([A, B]),
    });

  it("makes one project per owned repo, A to Z", () => {
    expect(
      plan(["acme/zeta", "Acme/Alpha", "other/x", "acme/alpha"]).map(
        (p) => p.repo,
      ),
    ).toEqual(["acme/alpha", "acme/zeta"]);
  });

  it("links the channel named after the repo and its agent members", () => {
    const [p] = plan(["acme/db-common"], { c1: "db-common", c2: "general" });
    expect(p).toEqual({
      slug: "db-common",
      name: "db-common",
      repo: "acme/db-common",
      homeChannel: "c1",
      agents: [A, B],
    });
  });

  it("leaves the home empty without a matching channel", () => {
    expect(plan(["acme/api"], { c1: "general" })[0]).toMatchObject({
      homeChannel: null,
      agents: [],
    });
  });

  it("keeps slugs unique", () => {
    const p = seedPlan({
      repos: ["acme/x.y", "acme/x-y"],
      owners: ["acme"],
      channels: {},
      members: {},
      agentPubkeys: new Set(),
    });
    expect(new Set(p.map((s) => s.slug)).size).toBe(2);
  });

  it("slugs like the schema's CHECK", () => {
    expect(slugFor("Buzz.Dashboard")).toBe("buzz-dashboard");
    expect(slugFor("--")).toBe("project");
    expect(slugFor("a".repeat(80))).toHaveLength(63);
  });
});

describe("membersFrom", () => {
  it("reads the newest NIP-29 member list per channel", () => {
    const A = "a".repeat(64);
    const B = "b".repeat(64);
    const ev = (at: number, ps: string[]) => ({
      id: String(at),
      pubkey: "",
      sig: "",
      content: "",
      kind: 39002,
      created_at: at,
      tags: [["d", "c1"], ...ps.map((p) => ["p", p]), ["p", "nope"]],
    });
    expect(membersFrom([ev(2, [A, B]), ev(1, [A])])).toEqual({ c1: [A, B] });
  });
});
