import { describe, expect, it } from "vitest";
import { matchItems, type PaletteItem } from "./palette";

const items: PaletteItem[] = [
  { group: "Views", label: "Pipeline", href: "/pipeline" },
  {
    group: "Agents",
    label: "Optimus Prime",
    hint: "Lead",
    href: "/agents/optimus-prime",
  },
  {
    group: "Needs you",
    label: "rtorcato/buzz-dashboard#12",
    hint: "Ready to merge",
    href: "/pipeline",
  },
];

describe("matchItems", () => {
  it("returns everything for an empty query", () => {
    expect(matchItems(items, "  ")).toHaveLength(3);
  });

  it("matches every word, in any order, across label and hint", () => {
    expect(matchItems(items, "lead prime").map((i) => i.label)).toEqual([
      "Optimus Prime",
    ]);
    expect(matchItems(items, "merge dashboard")).toHaveLength(1);
  });

  it("is case-insensitive and returns nothing on a miss", () => {
    expect(matchItems(items, "PIPE")).toHaveLength(1);
    expect(matchItems(items, "zzz")).toEqual([]);
  });
});
