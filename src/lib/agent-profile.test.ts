import { describe, expect, it } from "vitest";
import { desktopPath, profileSteps, profileText } from "./agent-profile";

describe("profileSteps", () => {
  it("names the avatar action", () => {
    expect(profileSteps("Avatar", "").map((s) => s.join(""))).toEqual([
      "Click the avatar and pick a new image",
      "Save. The new picture shows here.",
    ]);
  });

  it("fills in the new display name", () => {
    expect(
      profileSteps("Display name", " Bumblebee ").map((s) => s.join("")),
    ).toEqual([
      "Set Display name to Bumblebee",
      "Save. The new name shows here.",
    ]);
  });

  it("drops the value clause while the input is empty", () => {
    expect(profileSteps("About", "")[0]).toEqual(["Set About"]);
  });
});

describe("profileText", () => {
  it("numbers the path and steps with › between names", () => {
    expect(desktopPath("Bumble")).toEqual([
      "Buzz Desktop",
      "Agents",
      "Bumble",
      "Edit",
    ]);
    expect(profileText("Bumble", profileSteps("Avatar", ""))).toBe(
      "1. Buzz Desktop › Agents › Bumble › Edit\n2. Click the avatar and pick a new image\n3. Save. The new picture shows here.",
    );
  });
});
