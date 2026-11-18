import { expect, it } from "vitest";
import type { Item } from "./alerts";
import { clearedStats, diffLog, howCleared, medianByRule } from "./cleared-log";

const item = (key: string): Item => ({
  rule: "merge",
  key,
  title: key,
  detail: "",
  path: "/pipeline",
});

it("logs an appearing item once, then its clearing", () => {
  expect(diffLog([], [item("merge:a#1")], {}).appeared).toHaveLength(1);
  const open = [{ key: "merge:a#1", appearedAt: 1, acked: false }];
  expect(diffLog(open, [item("merge:a#1")], {})).toEqual({
    appeared: [],
    cleared: [],
    acked: [],
  });
  expect(diffLog(open, [], {}).cleared).toEqual(["merge:a#1"]);
});

it("notes an ack, even on the pass the item clears", () => {
  const open = [{ key: "merge:a#1", appearedAt: 1, acked: false }];
  const mutes = { "merge:a#1": { until: null } };
  expect(diffLog(open, [item("merge:a#1")], mutes).acked).toEqual([
    "merge:a#1",
  ]);
  expect(diffLog(open, [], mutes)).toMatchObject({
    cleared: ["merge:a#1"],
    acked: ["merge:a#1"],
  });
  // A snooze isn't an ack.
  expect(
    diffLog(open, [item("merge:a#1")], { "merge:a#1": { until: 99 } }).acked,
  ).toEqual([]);
});

it("clears nothing for a rule whose source didn't answer", () => {
  const open = [
    { key: "merge:a#1", appearedAt: 1, acked: false },
    { key: "failing:Gale", appearedAt: 1, acked: false },
  ];
  expect(diffLog(open, [], {}, ["merge"]).cleared).toEqual(["failing:Gale"]);
});

it("counts the week's cleared items and their average", () => {
  const row = (appearedAt: number, clearedAt: number) => ({
    key: "k",
    rule: "merge",
    title: "t",
    appearedAt,
    clearedAt,
    acked: false,
  });
  const rows = [row(0, 1000), row(0, 3000), row(0, 10)];
  expect(clearedStats(rows, 500)).toEqual({ count: 2, avgMs: 2000 });
  expect(clearedStats(rows, 5000)).toEqual({ count: 0, avgMs: null });
  expect(medianByRule(rows)).toEqual({ merge: 1000 });
});

it("names how an item cleared", () => {
  expect(howCleared("merge", false)).toBe("Merged");
  expect(howCleared("failing", true)).toBe("Recovered");
  expect(howCleared("blocked", true)).toBe("Approved by you");
});
