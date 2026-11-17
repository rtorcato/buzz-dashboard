import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { ensureDashboardKey, mergeConfig, readSavedConfig, saveConfig } =
  await import("./config-store");
const { readServerEnv } = await import("./env");

const tmp = () =>
  join(mkdtempSync(join(tmpdir(), "cfg-")), "sub", "config.json");

describe("config store", () => {
  it("saves 0600, merges patches, and reads missing files as empty", () => {
    const p = tmp();
    expect(readSavedConfig(p)).toEqual({});
    saveConfig({ A: "1" }, p);
    saveConfig({ B: "2" }, p);
    expect(readSavedConfig(p)).toEqual({ A: "1", B: "2" });
    expect(statSync(p).mode & 0o777).toBe(0o600);
  });

  it("lets env beat saved values, treating empty env as unset", () => {
    expect(
      mergeConfig({ A: "env", B: "" }, { A: "s", B: "s", C: "s" }),
    ).toEqual({ A: "env", B: "s", C: "s" });
  });

  it("generates the key once and returns only the pubkey", () => {
    const p = tmp();
    const pub = ensureDashboardKey(p);
    expect(pub).toMatch(/^[0-9a-f]{64}$/);
    expect(ensureDashboardKey(p)).toBe(pub);
    expect(pub).not.toBe(readSavedConfig(p).BUZZ_PRIVATE_KEY);
  });

  it("readServerEnv falls back to saved config, env wins", () => {
    const saved = { BUZZ_RELAY_URL: "wss://saved", BUZZ_PRIVATE_KEY: "k" };
    expect(readServerEnv({}, saved).buzzRelayUrl).toBe("wss://saved");
    expect(
      readServerEnv({ BUZZ_RELAY_URL: "wss://env" }, saved).buzzRelayUrl,
    ).toBe("wss://env");
  });
});
