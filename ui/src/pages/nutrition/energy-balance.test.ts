import { describe, expect, it } from "vitest";
import {
  bucketMeals,
  calendarRange,
  estimateEnergyBalance,
  formatElapsed,
  lastMealBefore,
  localDayBounds,
  shiftCalendarAnchor,
} from "./energy-balance.ts";

const at = (hour: number, minute = 0, day = 15) => new Date(2026, 9, day, hour, minute).getTime();

describe("estimateEnergyBalance", () => {
  it("prorates TDEE by the elapsed share of the local day", () => {
    const result = estimateEnergyBalance({ meals: [], now: at(12), tdee: 2200 });
    expect(result.elapsedFraction).toBeCloseTo(0.5, 5);
    expect(result.burnedSoFar).toBeCloseTo(1100, 5);
    expect(result.balance).toBeCloseTo(-1100, 5);
  });

  it("counts only meals eaten between midnight and now", () => {
    const meals = [
      { calories: 400, eatenAt: at(23, 30, 14) }, // yesterday
      { calories: 500, eatenAt: at(8) },
      { calories: 300, eatenAt: at(11, 59) },
      { calories: 900, eatenAt: at(19) }, // later today (pre-logged)
    ];
    const result = estimateEnergyBalance({ meals, now: at(18), tdee: 2400 });
    expect(result.consumedSoFar).toBe(800);
    expect(result.burnedSoFar).toBeCloseTo(1800, 5);
    expect(result.balance).toBeCloseTo(-1000, 5);
  });

  it("reports a surplus once intake outpaces prorated burn", () => {
    const result = estimateEnergyBalance({
      meals: [{ calories: 1200, eatenAt: at(7) }],
      now: at(9),
      tdee: 2400,
    });
    // 9:00 is 9/24 of the day: 2400 × 0.375 = 900 kcal burned.
    expect(result.balance).toBeCloseTo(1200 - 900, 5);
  });

  it("treats invalid TDEE and negative calories as zero", () => {
    const result = estimateEnergyBalance({
      meals: [{ calories: -50, eatenAt: at(1) }],
      now: at(6),
      tdee: Number.NaN,
    });
    expect(result.burnedSoFar).toBe(0);
    expect(result.consumedSoFar).toBe(0);
  });

  it("uses the real local day length for the bounds", () => {
    const { dayStart, dayEnd } = localDayBounds(at(12));
    expect(dayStart).toBe(at(0));
    expect(dayEnd).toBe(at(0, 0, 16));
  });
});

describe("Today helpers", () => {
  it("finds the latest meal at or before now", () => {
    const meals = [
      { id: "a", eatenAt: at(8) },
      { id: "b", eatenAt: at(12) },
      { id: "c", eatenAt: at(20) },
    ];
    expect(lastMealBefore(meals, at(13))?.id).toBe("b");
    expect(lastMealBefore(meals, at(7))).toBeNull();
  });

  it("formats elapsed time compactly", () => {
    expect(formatElapsed(30_000)).toBeNull();
    expect(formatElapsed(45 * 60_000)).toBe("45m");
    expect(formatElapsed(125 * 60_000)).toBe("2h 05m");
    expect(formatElapsed(27 * 3_600_000)).toBe("1d 3h");
  });
});

describe("calendar buckets", () => {
  it("covers Monday-based weeks, months, and years", () => {
    // 2026-10-15 is a Thursday.
    expect(calendarRange("week", at(12))).toEqual({ start: at(0, 0, 12), end: at(0, 0, 19) });
    expect(calendarRange("month", at(12)).start).toBe(new Date(2026, 9, 1).getTime());
    expect(calendarRange("year", at(12))).toEqual({
      start: new Date(2026, 0, 1).getTime(),
      end: new Date(2027, 0, 1).getTime(),
    });
  });

  it("sums meals per bucket", () => {
    const meals = [
      { calories: 500, eatenAt: at(8, 0, 12) },
      { calories: 700, eatenAt: at(19, 0, 12) },
      { calories: 300, eatenAt: at(9, 0, 15) },
    ];
    const week = bucketMeals(meals, "week", at(12));
    expect(week).toHaveLength(7);
    expect(week[0]).toMatchObject({ calories: 1200, meals: 2 });
    expect(week[3]).toMatchObject({ calories: 300, meals: 1 });
    expect(bucketMeals(meals, "year", at(12))).toHaveLength(12);
    expect(bucketMeals(meals, "day", at(12, 0, 12))).toEqual([
      { start: at(0, 0, 12), end: at(0, 0, 13), calories: 1200, meals: 2 },
    ]);
  });

  it("steps anchors by view", () => {
    expect(shiftCalendarAnchor("day", at(12), 1)).toBe(at(12, 0, 16));
    expect(new Date(shiftCalendarAnchor("month", at(12), -1)).getMonth()).toBe(8);
    expect(new Date(shiftCalendarAnchor("year", at(12), 1)).getFullYear()).toBe(2027);
  });
});
