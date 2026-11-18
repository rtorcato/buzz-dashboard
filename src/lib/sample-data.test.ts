import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleMergeRow, sampleMode } from "./sample-data";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sampleMode", () => {
  it("is off by default", () => {
    vi.stubEnv("BUZZ_SAMPLE_DATA", undefined);
    vi.stubEnv("NODE_ENV", "development");
    expect(sampleMode()).toBe(false);
  });

  it("is on with BUZZ_SAMPLE_DATA=1 outside production", () => {
    vi.stubEnv("BUZZ_SAMPLE_DATA", "1");
    vi.stubEnv("NODE_ENV", "development");
    expect(sampleMode()).toBe(true);
  });

  it("never loads in a production build", () => {
    vi.stubEnv("BUZZ_SAMPLE_DATA", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(sampleMode()).toBe(false);
  });
});

describe("sampleMergeRow", () => {
  it("carries one merge alert key per PR so the snooze menu renders", () => {
    const row = sampleMergeRow();
    expect(row.keys).toHaveLength(row.count);
    for (const k of row.keys ?? []) expect(k).toMatch(/^merge:[^#]+#\d+$/);
  });
});
