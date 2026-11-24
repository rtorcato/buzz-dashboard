import { describe, expect, it } from "vitest";
import {
  buildIngestRow,
  defaultLinkHosts,
  hostError,
  LinkHostsSchema,
  linkAllowed,
  RotateBodySchema,
} from "./event-ingest";

// #199: the pure rules behind POST /api/events.

const token = {
  platform: "claude-code",
  linkHosts: ["github.com", "relay.example"],
  last4: "7k2q",
};
const now = new Date("2026-11-24T12:00:00Z");
const opts = { now, retentionDays: 90, uuid: () => "u-1" };
const body = {
  agentId: "ab".repeat(32),
  agent: "Shockwave",
  kind: "failed_turn",
  title: "Turn failed: max_tokens",
};

const build = (b: unknown) => buildIngestRow(b, token, opts);
const issues = (b: unknown) => {
  const r = build(b);
  return r.ok ? [] : (r.issues ?? [r.error]);
};

describe("buildIngestRow", () => {
  it("stamps source and platform from the token, never the body", () => {
    const r = build(body);
    expect(r).toEqual({
      ok: true,
      row: {
        source: "ingest",
        sourceId: "claude-code:u-1",
        platform: "claude-code",
        agentId: body.agentId,
        actor: "Shockwave",
        kind: "failed_turn",
        at: now,
        repo: null,
        title: body.title,
        body: null,
        url: null,
        data: { via: "ingest", token: "7k2q" },
      },
    });
  });

  it("refuses platform or source in the body", () => {
    expect(build({ ...body, platform: "buzz" }).ok).toBe(false);
    expect(build({ ...body, source: "github" }).ok).toBe(false);
  });

  it("namespaces the client id by platform, so retries are idempotent per platform", () => {
    const r = build({ ...body, id: "evt:abc.1" });
    expect(r.ok && r.row.sourceId).toBe("claude-code:evt:abc.1");
    expect(build({ ...body, id: "has space" }).ok).toBe(false);
    expect(build({ ...body, id: "x".repeat(129) }).ok).toBe(false);
  });

  it("takes an open but well-formed kind", () => {
    expect(build({ ...body, kind: "release_verdict" }).ok).toBe(true);
    expect(build({ ...body, kind: "anything_new_2" }).ok).toBe(true);
    for (const kind of ["Failed", "1st", "has-dash", "", "a".repeat(49)]) {
      expect(build({ ...body, kind }).ok, kind).toBe(false);
    }
  });

  it("bounds every text field as the check constraint does", () => {
    expect(issues({ ...body, agent: "" })).not.toEqual([]);
    expect(issues({ ...body, agent: "a".repeat(65) })).not.toEqual([]);
    expect(issues({ ...body, title: "t".repeat(201) })).not.toEqual([]);
    expect(issues({ ...body, detail: "d".repeat(4001) })).not.toEqual([]);
    expect(build({ ...body, detail: "d".repeat(4000) }).ok).toBe(true);
    // Code points, like Postgres's char_length: 64 emoji fit a 64-char name.
    expect(build({ ...body, agent: "🐝".repeat(64) }).ok).toBe(true);
    expect(issues({ ...body, agentId: "has space" })).not.toEqual([]);
  });

  it("lowercases repo and checks its shape", () => {
    const r = build({ ...body, repo: "Owner/Repo.js" });
    expect(r.ok && r.row.repo).toBe("owner/repo.js");
    expect(build({ ...body, repo: "no-slash" }).ok).toBe(false);
  });

  it("keeps occurredAt inside the retention window and near the clock", () => {
    const at = (iso: string) => build({ ...body, occurredAt: iso });
    const r = at("2026-11-24T11:00:00Z");
    expect(r.ok && r.row.at).toEqual(new Date("2026-11-24T11:00:00Z"));
    expect(at("2026-11-24T12:04:00Z").ok).toBe(true);
    expect(at("2026-11-24T12:06:00Z")).toMatchObject({ ok: false });
    expect(at("2026-08-01T00:00:00Z")).toMatchObject({ ok: false });
    expect(at("yesterday").ok).toBe(false);
  });

  it("accepts a link only on the platform's allowlist", () => {
    const link = (l: string) => build({ ...body, link: l });
    expect(link("https://github.com/o/r/pull/1").ok).toBe(true);
    expect(link("https://relay.example/x").ok).toBe(true);
    expect(link("https://gitlab.com/o/r").ok).toBe(false);
    expect(link("http://github.com/o/r").ok).toBe(false);
  });
});

describe("linkAllowed", () => {
  const hosts = ["github.com"];
  it("matches the exact host, not a suffix or lookalike", () => {
    expect(linkAllowed("https://GitHub.com/x", hosts)).toBe(true);
    expect(linkAllowed("https://evil-github.com/x", hosts)).toBe(false);
    expect(linkAllowed("https://github.com.evil.io/x", hosts)).toBe(false);
    expect(linkAllowed("https://api.github.com/x", hosts)).toBe(false);
  });
  it("refuses credentials, ports and non-URLs", () => {
    expect(linkAllowed("https://user@github.com/x", hosts)).toBe(false);
    expect(linkAllowed("https://github.com:8443/x", hosts)).toBe(false);
    expect(linkAllowed("javascript:alert(1)", hosts)).toBe(false);
    expect(linkAllowed("not a url", hosts)).toBe(false);
  });
});

describe("link hosts", () => {
  it("seeds GitHub and the relay host", () => {
    expect(defaultLinkHosts("wss://Relay.Example/")).toEqual([
      "github.com",
      "relay.example",
    ]);
    expect(defaultLinkHosts(undefined)).toEqual(["github.com"]);
  });
  it("normalises the owner's list and refuses bad hosts", () => {
    expect(LinkHostsSchema.parse([" GitHub.com", "github.com"])).toEqual([
      "github.com",
    ]);
    expect(LinkHostsSchema.safeParse(["https://x.com"]).success).toBe(false);
    expect(LinkHostsSchema.safeParse(["*.x.com"]).success).toBe(false);
    expect(
      LinkHostsSchema.safeParse(
        Array.from({ length: 33 }, (_, i) => `h${i}.com`),
      ).success,
    ).toBe(false);
  });
  it("checks the platform key", () => {
    expect(
      RotateBodySchema.safeParse({ platform: "claude-code" }).success,
    ).toBe(true);
    for (const platform of ["Claude", "-x", "a".repeat(33), "a b"]) {
      expect(RotateBodySchema.safeParse({ platform }).success, platform).toBe(
        false,
      );
    }
  });
});

describe("hostError", () => {
  it("passes a host and an empty draft", () => {
    expect(hostError("docs.example.org")).toBeNull();
    expect(hostError("  ")).toBeNull();
  });
  it("catches a pasted URL and names its host", () => {
    expect(hostError("https://docs.example.org/a")).toBe(
      "That’s a URL. Enter just the host, like docs.example.org.",
    );
    expect(hostError("gitlab.com/o/r")).toMatch(/like gitlab\.com\.$/);
  });
  it("refuses anything else that isn't a hostname", () => {
    expect(hostError("*.example.org")).toMatch(/^Not a hostname/);
    expect(hostError("has space.com")).toMatch(/^Not a hostname/);
  });
});
