import { describe, expect, it } from "vitest";
import { needsYouSlotMode } from "./needs-you-rows";

describe("needsYouSlotMode (#190)", () => {
  it("shows the banner on Overview when items wait", () => {
    expect(needsYouSlotMode("/", 3)).toBe("banner");
  });

  it("shows the card (All clear) on Overview with nothing waiting", () => {
    expect(needsYouSlotMode("/", 0)).toBe("card");
  });

  it("shows nothing on every other view", () => {
    for (const p of [
      "/agents",
      "/agents/optimus-prime",
      "/pipeline",
      "/health",
      "/cost",
      "/timeline",
      "/releases",
      "/settings",
    ]) {
      expect(needsYouSlotMode(p, 3)).toBe("none");
      expect(needsYouSlotMode(p, 0)).toBe("none");
    }
  });

  it("shows nothing before the pathname is known", () => {
    expect(needsYouSlotMode(null, 2)).toBe("none");
  });
});
