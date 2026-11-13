import { describe, expect, it } from "vitest";
import { desktopSteps, stepsText } from "./agent-settings";

describe("desktopSteps", () => {
  it("names the agent and the new value", () => {
    expect(desktopSteps("Bumble", "Model", "sonnet", false)).toEqual([
      "Open Buzz Desktop → Agents → Bumble → Edit",
      "Set Model to sonnet",
      "Save. Bumble picks it up on its next turn.",
    ]);
  });

  it("asks to start a stopped agent", () => {
    expect(desktopSteps("Bumble", "Effort", "high", true)[2]).toBe(
      "Save, then Start Bumble so it loads the new value.",
    );
  });

  it("numbers the steps for the clipboard", () => {
    expect(stepsText(["a", "b"])).toBe("1. a\n2. b");
  });
});
