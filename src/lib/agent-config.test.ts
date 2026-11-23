import { describe, expect, it } from "vitest";
import {
  ARTIFACT_KIND,
  artifactD,
  type ConfigEvent,
  type ConfigFilter,
  ConfigReadError,
  configSource,
  INSTRUCTIONS_TYPE,
  pickConfigChannel,
  readAgentConfig,
  readFailure,
  SETTINGS_TYPE,
  settingsProblem,
  uuidv5,
} from "./agent-config";

const SELF = "f".repeat(64);
const OWNER = "b".repeat(64);
const AGENT = "a".repeat(64);
const IDS = { relaySelf: SELF, owner: OWNER, agent: AGENT };
const CH = "11111111-2222-4333-8444-555555555555";
const OLDER = "00000000-2222-4333-8444-555555555555";

let n = 0;
const ev = (over: Partial<ConfigEvent>): ConfigEvent => ({
  id: (n++).toString(16).padStart(64, "0"),
  pubkey: SELF,
  created_at: 1_800_000_000,
  kind: 39000,
  tags: [],
  content: "",
  sig: "0".repeat(128),
  ...over,
});

const channel = (
  id: string,
  {
    type = "system",
    labels = ["agent-config", AGENT],
    creator = OWNER,
    createdAt = "1700000000" as string | null,
    pubkey = SELF,
    archived = false,
  } = {},
) =>
  ev({
    pubkey,
    tags: [
      ["d", id],
      ["t", type],
      ...labels.map((l) => ["t", l]),
      ["P", creator],
      ...(createdAt ? [["created_at", createdAt]] : []),
      ...(archived ? [["archived", "true"]] : []),
    ],
  });

const revision = async (
  type: typeof SETTINGS_TYPE | typeof INSTRUCTIONS_TYPE,
  content: unknown,
  { op = "update", at = 1_800_000_000, ch = CH } = {},
) =>
  ev({
    kind: ARTIFACT_KIND,
    pubkey: OWNER,
    created_at: at,
    content: typeof content === "string" ? content : JSON.stringify(content),
    tags: [
      ["ar", "1"],
      ["d", await artifactD(type, ch)],
      ["h", ch],
      ["type", type],
      ["title", type],
      ["op", op],
      ["prev", "e".repeat(64)],
    ],
  });

const SETTINGS = {
  version: 1,
  agentType: "goose",
  settings: {
    model: "opus",
    provider: "anthropic",
    effort: "high",
    scope: "thread",
  },
};

/** A fake signed query: answers by the filter's shape. */
function relay(answers: {
  channels?: ConfigEvent[];
  heads?: ConfigEvent[];
  count?: unknown;
}) {
  const calls: [string, ConfigFilter][] = [];
  const query = async (path: string, f: ConfigFilter) => {
    calls.push([path, f]);
    if (path === "count") return { count: answers.count };
    if ((f.kinds as number[])[0] === 39000) return answers.channels ?? [];
    return answers.heads ?? [];
  };
  return { query, calls };
}

describe("uuidv5", () => {
  it("matches the RFC 4122 test vector", async () => {
    expect(
      await uuidv5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "www.example.com"),
    ).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
  });
});

describe("pickConfigChannel", () => {
  it("takes the oldest relay-signed system channel for this agent", () => {
    const picked = pickConfigChannel(
      [channel(CH), channel(OLDER, { createdAt: "1600000000" })],
      IDS,
    );
    expect(picked).toEqual({ id: OLDER, archived: false });
  });
  it("breaks a tie on the lower id, and ranks no creation time last", () => {
    expect(pickConfigChannel([channel(CH), channel(OLDER)], IDS)?.id).toBe(
      OLDER,
    );
    expect(
      pickConfigChannel([channel(OLDER, { createdAt: null }), channel(CH)], IDS)
        ?.id,
    ).toBe(CH);
  });
  it("ignores channels that aren't the agent's config", () => {
    const wrong = [
      channel(OLDER, { pubkey: OWNER }), // not relay-signed
      channel(OLDER, { type: "stream" }),
      channel(OLDER, { creator: AGENT }),
      channel(OLDER, { labels: [AGENT] }),
      channel(OLDER, { labels: ["agent-config", "c".repeat(64)] }),
    ];
    for (const e of wrong) expect(pickConfigChannel([e], IDS)).toBeNull();
  });
  it("reports an archived pick", () => {
    expect(pickConfigChannel([channel(CH, { archived: true })], IDS)).toEqual({
      id: CH,
      archived: true,
    });
  });
});

describe("readAgentConfig", () => {
  it("reads both heads and the settings revision count", async () => {
    const { query, calls } = relay({
      channels: [channel(CH)],
      heads: [
        await revision(SETTINGS_TYPE, SETTINGS, { at: 1_800_000_100 }),
        await revision(INSTRUCTIONS_TYPE, { version: 1, text: "Be kind." }),
      ],
      count: 14,
    });
    const c = await readAgentConfig(query, IDS);
    expect(c.channel).toBe(CH);
    expect(c.settings).toMatchObject({
      state: "ok",
      value: {
        agentType: "goose",
        model: "opus",
        provider: "anthropic",
        effort: "high",
        scope: "thread",
      },
    });
    expect(c.instructions).toMatchObject({ state: "ok", value: "Be kind." });
    expect(c.revision).toBe(14);
    expect(c.updatedAt).toBe(1_800_000_100);
    // Discovery names the owner and the agent's label; the heads name the
    // channel, as NIP-CL requires for a system channel.
    expect(calls[0][1]).toMatchObject({
      kinds: [39000],
      authors: [SELF],
      "#P": [OWNER],
      "#t": [AGENT],
    });
    expect(calls[1][1]).toMatchObject({ "#h": [CH], artifact: "current" });
    expect(calls[2]).toEqual([
      "count",
      expect.objectContaining({ artifact: "history", "#h": [CH] }),
    ]);
  });
  it("marks a deleted or invalid head instead of showing it", async () => {
    const deleted = await readAgentConfig(
      relay({
        channels: [channel(CH)],
        heads: [await revision(SETTINGS_TYPE, "", { op: "delete" })],
      }).query,
      IDS,
    );
    expect(deleted.settings.state).toBe("deleted");
    expect(settingsProblem(deleted)).toMatch(/deleted/);
    const invalid = await readAgentConfig(
      relay({
        channels: [channel(CH)],
        heads: [await revision(SETTINGS_TYPE, { version: 2, settings: {} })],
      }).query,
      IDS,
    );
    expect(invalid.settings).toMatchObject({
      state: "invalid",
      problem: "Unknown artifact version",
    });
    expect(invalid.instructions.state).toBe("missing");
  });
  it("refuses a head from another channel", async () => {
    const c = await readAgentConfig(
      relay({
        channels: [channel(CH)],
        heads: [await revision(SETTINGS_TYPE, SETTINGS, { ch: OLDER })],
      }).query,
      IDS,
    );
    // Its `d` is another channel's, so this channel has no settings head.
    expect(c.settings.state).toBe("missing");
  });
  it("throws with a reason the card can show", async () => {
    await expect(readAgentConfig(relay({}).query, IDS)).rejects.toMatchObject({
      reason: "no-channel",
    });
    await expect(
      readAgentConfig(
        relay({ channels: [channel(CH, { archived: true })] }).query,
        IDS,
      ),
    ).rejects.toMatchObject({ reason: "archived" });
    const twice = await revision(SETTINGS_TYPE, SETTINGS);
    await expect(
      readAgentConfig(
        relay({ channels: [channel(CH)], heads: [twice, { ...twice }] }).query,
        IDS,
      ),
    ).rejects.toMatchObject({ reason: "unreadable" });
    await expect(
      readAgentConfig(relay({}).query, { ...IDS, agent: "nope" }),
    ).rejects.toBeInstanceOf(ConfigReadError);
  });
  it("leaves the revision out when the count fails", async () => {
    const { query } = relay({
      channels: [channel(CH)],
      heads: [await revision(SETTINGS_TYPE, SETTINGS)],
      count: "lots",
    });
    expect((await readAgentConfig(query, IDS)).revision).toBeNull();
  });
});

describe("card text", () => {
  const config = {
    channel: CH,
    settings: { state: "missing" as const },
    instructions: { state: "missing" as const },
    revision: 14,
    updatedAt: 1_800_000_000,
  };
  it("writes the source line", () => {
    expect(configSource(config, 1_800_000_000 + 2 * 86_400)).toBe(
      "From the relay config · revision 14 · 2d ago",
    );
    expect(configSource({ ...config, revision: null }, 1_800_000_030)).toBe(
      "From the relay config · just now",
    );
  });
  it("words each failure", () => {
    expect(readFailure(new ConfigReadError("no-channel"))).toMatch(
      /no relay config channel/,
    );
    expect(readFailure(new Error("The extension didn't sign it."))).toBe(
      "The extension didn't sign it.",
    );
  });
});
