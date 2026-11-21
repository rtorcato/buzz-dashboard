import { describe, expect, it, vi } from "vitest";
import {
  resolveTimeZone,
  startOfDay,
  startOfHour,
  systemTimeZone,
  zoneParts,
} from "./time-zone";

vi.mock("server-only", () => ({}));
const { bucketsFor, weekHourGrid } = await import("./overview");

const utc = (...a: [number, number, number, number?, number?]) =>
  Date.UTC(a[0], a[1], a[2], a[3] ?? 0, a[4] ?? 0) / 1000;

describe("time zone (#153)", () => {
  it("keeps a known zone and falls back to the server's", () => {
    expect(resolveTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(resolveTimeZone("UTC")).toBe("UTC");
    expect(resolveTimeZone("Not/AZone")).toBe(systemTimeZone());
    expect(resolveTimeZone(undefined)).toBe(systemTimeZone());
  });

  it("reads the wall clock in a zone", () => {
    // 2026-11-20 02:30 UTC is Thursday 21:30 in New York.
    const p = zoneParts(utc(2026, 10, 20, 2, 30), "America/New_York");
    expect(p).toMatchObject({ day: 19, hour: 21, minute: 30, weekday: 4 });
  });

  it("finds local midnight, across a DST change", () => {
    const at = utc(2026, 10, 20, 2, 30);
    expect(startOfDay(at, "UTC")).toBe(utc(2026, 10, 20));
    expect(startOfDay(at, "America/New_York")).toBe(utc(2026, 10, 19, 5));
    // New York left DST on 2026-11-01: midnight was 04:00 UTC before it.
    expect(startOfDay(at, "America/New_York", 20)).toBe(utc(2026, 9, 30, 4));
    // Half-hour zone.
    expect(startOfDay(at, "Asia/Kolkata")).toBe(utc(2026, 10, 19, 18, 30));
    expect(startOfHour(utc(2026, 10, 20, 2, 10), "Asia/Kolkata")).toBe(
      utc(2026, 10, 20, 1, 30),
    );
  });

  it("buckets days and the heatmap in the viewer's zone", () => {
    const now = new Date(utc(2026, 10, 20, 2, 30) * 1000);
    const utcDays = bucketsFor("7d", now, "UTC").starts;
    const nyDays = bucketsFor("7d", now, "America/New_York").starts;
    expect(utcDays[6]).toBe(utc(2026, 10, 20));
    expect(nyDays[6]).toBe(utc(2026, 10, 19, 5));
    expect(nyDays[0]).toBe(utc(2026, 10, 13, 5));
    const at = utc(2026, 10, 20, 2, 30);
    expect(weekHourGrid([at], 1, "UTC")[5][2]).toBe(1);
    expect(weekHourGrid([at], 1, "America/New_York")[4][21]).toBe(1);
  });
});
