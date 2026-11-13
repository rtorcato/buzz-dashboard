import { createHash } from "node:crypto";
import { schnorr } from "@noble/curves/secp256k1.js";
import { describe, expect, it, vi } from "vitest";
import type { NostrEvent } from "./relay";

vi.mock("server-only", () => ({}));
// `owner` is read when getHive runs, after the fixtures below exist.
vi.mock("./env", () => ({
  readServerEnv: () => ({ buzzOwnerPubkey: owner }),
}));
const queryRelay = vi.fn();
vi.mock("./relay", () => ({ queryRelay }));
vi.stubEnv(
  "AGENT_ALIASES",
  JSON.stringify({ Comb: "Shockwave", Woz: "Shockwave" }),
);

const {
  agentName,
  aliases,
  buildHive,
  dayStarts,
  firstLine,
  getActivity,
  getHive,
  isAttested,
  perDay,
} = await import("./hive");

const now = new Date(2026, 9, 7, 14, 30);
const at = (day: number, hour: number) =>
  new Date(2026, 9, day, hour).getTime() / 1000;

let seq = 0;
const ev = (
  kind: number,
  pubkey: string,
  created_at: number,
  content: string,
  tags: string[][] = [],
): NostrEvent => ({
  id: String(seq++),
  pubkey,
  created_at,
  kind,
  tags,
  content,
  sig: "",
});
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const ownerKey = new Uint8Array(32).fill(1);
const owner = hex(schnorr.getPublicKey(ownerKey));
// A NIP-OA attestation from `key` for `pubkey`.
const attest = (pubkey: string, key = ownerKey) => [
  [
    "auth",
    hex(schnorr.getPublicKey(key)),
    "",
    hex(
      schnorr.sign(
        createHash("sha256").update(`nostr:agent-auth:${pubkey}:`).digest(),
        key,
      ),
    ),
  ],
];
const profile = (pubkey: string, name: string, about = "", t = at(1, 0)) =>
  ev(
    0,
    pubkey,
    t,
    JSON.stringify({ display_name: name, about }),
    attest(pubkey),
  );
const msg = (pubkey: string, t: number, content: string, channel = "c1") =>
  ev(9, pubkey, t, content, [["h", channel]]);

const events = [
  profile("woz", "Shockwave", "Coding agent"),
  profile("comb1", "Comb", "Old coder"),
  profile("bumble-old", "Bumble", "coding agent"),
  profile("bumble", "Bumble", "coding agent"),
  ev(0, "human", at(1, 0), JSON.stringify({ display_name: "rtorcato" })),
  ev(39000, "relay", at(1, 0), "", [
    ["d", "c1"],
    ["name", "general"],
  ]),
  ev(39000, "relay", at(1, 0), "", [
    ["d", "c2"],
    ["name", "reviews"],
  ]),
  msg("comb1", at(5, 9), "old name, still Shockwave"),
  msg("woz", at(7, 13), "\n  PR up: #1  \nmore detail"),
  msg("woz", at(7, 12), "earlier today", "c2"),
  msg("bumble-old", at(6, 10), "yesterday from an old copy"),
  msg("bumble", at(7, 2), "early today"),
  msg("human", at(7, 14), "ship it"),
  msg("woz", at(0, 9), "older than the 7-day window"),
];

describe("aliases", () => {
  it("reads AGENT_ALIASES", () => {
    expect(agentName("Comb")).toBe("Shockwave");
    expect(agentName("Bumble")).toBe("Bumble");
  });
  it("is empty when unset or invalid", () => {
    expect(aliases("")).toEqual({});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(aliases("[1]")).toEqual({});
    expect(aliases('{"Fizz":1}')).toEqual({});
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
  it("only maps its own keys", () => {
    expect(agentName("constructor")).toBe("constructor");
  });
});

describe("buildHive", () => {
  const hive = buildHive(events, now, owner);
  const byName = Object.fromEntries(hive.agents.map((a) => [a.name, a]));

  it("dedupes copies and folds aliases into one agent per name", () => {
    expect(hive.agents.map((a) => a.name)).toEqual(["Shockwave", "Bumble"]);
    expect(byName.Shockwave.pubkeys.sort()).toEqual(["comb1", "woz"]);
    expect(byName.Bumble.pubkeys.sort()).toEqual(["bumble", "bumble-old"]);
  });

  it("keeps the current identity's profile, not the alias", () => {
    expect(byName.Shockwave.role).toBe("Coding agent");
    expect(byName.Shockwave.formerNames).toEqual(["Comb", "Woz"]);
    expect(byName.Bumble.formerNames).toEqual([]);
  });

  it("keeps the week's messages per agent, newest first", () => {
    expect(byName.Shockwave.messages.map((m) => [m.text, m.channel])).toEqual([
      ["PR up: #1", "general"],
      ["earlier today", "reviews"],
      ["old name, still Shockwave", "general"],
    ]);
  });

  it("summarises activity across every folded identity", () => {
    expect(byName.Shockwave).toMatchObject({
      lastSeenAt: at(7, 13),
      workingOn: "PR up: #1",
      messagesToday: 2,
      daily: [0, 0, 0, 0, 1, 0, 2],
    });
    expect(byName.Bumble.daily).toEqual([0, 0, 0, 0, 0, 1, 1]);
  });

  it("picks the channel an agent posts in most as home", () => {
    expect(byName.Shockwave.homeChannel).toBe("general");
  });

  it("builds today's feed newest first, humans included", () => {
    expect(hive.feed.map((f) => [f.author, f.isAgent, f.channel])).toEqual([
      ["rtorcato", false, "general"],
      ["Shockwave", true, "general"],
      ["Shockwave", true, "reviews"],
      ["Bumble", true, "general"],
    ]);
  });

  it("buckets today's messages by local hour", () => {
    expect(hive.hourly).toHaveLength(24);
    expect(hive.hourly[2]).toBe(1);
    expect(hive.hourly[12]).toBe(1);
    expect(hive.hourly.reduce((a, b) => a + b)).toBe(4);
  });

  it("drops picture URLs an img shouldn't load", () => {
    const [a] = buildHive(
      [
        ev(
          0,
          "x",
          1,
          JSON.stringify({ name: "X", picture: "javascript:alert(1)" }),
          attest("x"),
        ),
      ],
      now,
      owner,
    ).agents;
    expect(a.picture).toBeNull();
  });

  it("ignores profiles whose auth tag the owner didn't sign", () => {
    const forged = (pubkey: string, tags: string[][]) =>
      ev(0, pubkey, at(2, 0), JSON.stringify({ display_name: "Woz" }), tags);
    const stranger = new Uint8Array(32).fill(2);
    const { agents, feed } = buildHive(
      [
        ...events,
        // Dummy tag naming the owner.
        forged("f1", [["auth", owner, "", "00".repeat(64)]]),
        // Real attestation, but for a different pubkey.
        forged("f2", attest("woz")),
        // Validly signed, by someone who isn't the owner.
        forged("f3", attest("f3", stranger)),
        msg("f1", at(7, 14), "I'm Woz now"),
      ],
      now,
      owner,
    );
    const woz = agents.find((a) => a.name === "Shockwave");
    expect(woz?.pubkeys.sort()).toEqual(["comb1", "woz"]);
    expect(woz?.workingOn).toBe("PR up: #1");
    expect(feed.find((f) => f.text === "I'm Woz now")?.isAgent).toBe(false);
  });

  it("lists silent attested agents and drops archived ones (NIP-IA)", () => {
    const archive = (t: number, pubkeys: string[]) =>
      ev(13535, "relay", t, "", [["-"], ...pubkeys.map((p) => ["p", p])]);
    const { agents, feed } = buildHive(
      [
        ...events,
        profile("hound", "Hound", "Researcher"),
        profile("old-hound", "Hound (old)"),
        msg("old-hound", at(7, 11), "still posting"),
        // Only the newest snapshot counts.
        archive(at(1, 0), ["hound"]),
        archive(at(2, 0), ["old-hound", "bumble-old"]),
      ],
      now,
      owner,
    );
    const byName = Object.fromEntries(agents.map((a) => [a.name, a]));
    expect(byName.Hound).toMatchObject({ lastSeenAt: null, workingOn: null });
    expect(byName["Hound (old)"]).toBeUndefined();
    // An archived copy no longer folds into the current agent.
    expect(byName.Bumble.pubkeys).toEqual(["bumble"]);
    // History stays.
    expect(feed.some((f) => f.text === "still posting")).toBe(true);
  });
});

describe("isAttested", () => {
  const event = (tags: string[][]) => ev(0, "woz", 0, "", tags);

  it("accepts the owner's attestation", () => {
    expect(isAttested(event(attest("woz")), owner)).toBe(true);
  });

  it("rejects missing or malformed tags", () => {
    expect(isAttested(event([]), owner)).toBe(false);
    expect(isAttested(event([["auth", owner]]), owner)).toBe(false);
    expect(isAttested(event([["auth", owner, "", "zz"]]), owner)).toBe(false);
  });
});

describe("dayStarts", () => {
  it("returns 7 local midnights ending today", () => {
    const days = dayStarts(now);
    expect(days).toHaveLength(7);
    expect(days[6]).toBe(at(7, 0));
    expect(days[0]).toBe(at(1, 0));
  });

  it("takes a count for the 30-day Activity range", () => {
    const days = dayStarts(now, 30);
    expect(days).toHaveLength(30);
    expect(days[29]).toBe(at(7, 0));
    expect(days[0]).toBe(new Date(2026, 8, 8).getTime() / 1000);
  });
});

describe("perDay", () => {
  it("counts events into day buckets, the last one open-ended", () => {
    const days = [at(5, 0), at(6, 0), at(7, 0)];
    const events = [at(4, 23), at(5, 0), at(5, 23), at(6, 12), at(8, 1)].map(
      (created_at) => ({ created_at }),
    );
    expect(perDay(events, days)).toEqual([2, 1, 1]);
  });
});

describe("firstLine", () => {
  it("drops blank lines, emphasis, code ticks and heading marks", () => {
    expect(firstLine("\n## **Snoopy** EOD for `buzz-dashboard`\nmore")).toBe(
      "Snoopy EOD for buzz-dashboard",
    );
  });
});

describe("getActivity", () => {
  it("pages past the relay's 1000-event cap with `until`", async () => {
    const msg = (id: string, created_at: number) => ({
      ...ev(9, "pk", created_at, ""),
      id,
    });
    // A full page, newest first, ending at 6 Oct 10:00; then the rest.
    const page1 = Array.from({ length: 1000 }, (_, i) =>
      msg(`a${i}`, i === 999 ? at(6, 10) : at(7, 9)),
    );
    const page2 = [msg("a999", at(6, 10)), msg("b", at(1, 12))];
    queryRelay.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

    const daily = await getActivity(["pk"], now);
    expect(queryRelay).toHaveBeenCalledTimes(2);
    const [[, [first]], [, [second]]] = queryRelay.mock.calls;
    expect(first.until).toBeUndefined();
    expect(second).toMatchObject({ authors: ["pk"], until: at(6, 10) });
    expect(daily).toHaveLength(30);
    // The boundary event counts once.
    expect(daily.slice(-7)).toEqual([1, 0, 0, 0, 0, 1, 999]);
  });
});

describe("getHive", () => {
  it("pages the week's messages past the relay's 1000-event cap", async () => {
    queryRelay.mockReset();
    const msg = (id: string, created_at: number) => ({
      ...ev(9, "woz", created_at, "busy"),
      id,
    });
    // 1200 messages: a full page reaching back to 4 Oct, then the rest.
    const page1 = Array.from({ length: 1000 }, (_, i) =>
      msg(`a${i}`, i === 999 ? at(4, 10) : at(7, 9)),
    );
    const page2 = [
      msg("a999", at(4, 10)),
      ...Array.from({ length: 200 }, (_, i) => msg(`b${i}`, at(2, 12))),
    ];
    queryRelay.mockImplementation(
      async (_env, [filter]: { kinds: number[]; until?: number }[]) => {
        if (!filter.kinds.includes(9)) return [profile("woz", "Shockwave")];
        return filter.until === undefined ? page1 : page2;
      },
    );

    const hive = await getHive(now);
    const messageQueries = queryRelay.mock.calls
      .map(([, [filter]]) => filter)
      .filter((f) => f.kinds.includes(9));
    expect(messageQueries.map((f) => f.until)).toEqual([undefined, at(4, 10)]);
    const [woz] = hive.agents;
    // Every message counts once, the boundary one included.
    expect(woz.messages).toHaveLength(1200);
    expect(woz.daily).toEqual([0, 200, 0, 1, 0, 0, 999]);
  });
});
