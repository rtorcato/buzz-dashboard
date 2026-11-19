import { describe, expect, it } from "vitest";
import {
  DEFAULTS,
  getSettings,
  parseSettings,
  resetSettings,
  updateSettings,
} from "./settings";

describe("settings with blocked storage", () => {
  // The node test env has no `window`, so localStorage counts as blocked.
  it("keeps an update in memory instead of resetting to defaults on the next read", () => {
    updateSettings({ density: "compact" });
    expect(getSettings().density).toBe("compact");
    resetSettings();
    expect(getSettings()).toEqual(DEFAULTS);
  });
});

describe("parseSettings", () => {
  it("uses defaults for nothing, junk or a non-object", () => {
    expect(parseSettings(null)).toEqual(DEFAULTS);
    expect(parseSettings("{nope")).toEqual(DEFAULTS);
    expect(parseSettings("42")).toEqual(DEFAULTS);
  });

  it("keeps valid fields and defaults the invalid ones", () => {
    const s = parseSettings(
      JSON.stringify({
        density: "compact",
        refresh: "2h",
        quietAfterMinutes: 240,
        pinned: ["a"],
        hidden: [1],
      }),
    );
    expect(s.density).toBe("compact");
    expect(s.refresh).toBe(DEFAULTS.refresh);
    expect(s.quietAfterMinutes).toBe(240);
    expect(s.pinned).toEqual(["a"]);
    expect(s.hidden).toEqual([]);
  });

  it("starts with nothing pinned or hidden and no personal data", () => {
    expect(DEFAULTS.pinned).toEqual([]);
    expect(DEFAULTS.hidden).toEqual([]);
  });
});
