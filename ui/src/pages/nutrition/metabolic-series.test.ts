import { describe, expect, it } from "vitest";
import {
  buildMetabolicSeries,
  kcalPerStep,
  monotonePath,
  sampleNetAt,
  SERIES_INTERVALS_PER_DAY,
  STEPS_INCLUDED_IN_TDEE,
} from "./metabolic-series.ts";
import type { ExerciseEntry, MealEntry, Receipt, StepBucket } from "./nutrition-adapter.ts";

const at = (hour: number, minute = 0, day = 15) => new Date(2026, 9, day, hour, minute).getTime();

const meal = (id: string, calories: number, eatenAt: number): MealEntry => ({
  id,
  name: id,
  calories,
  eatenAt,
  source: "quick-log",
});

const exercise = (
  id: string,
  kcal: number,
  minutes: number,
  performedAt: number,
): ExerciseEntry => ({
  id,
  description: id,
  kcal,
  minutes,
  performedAt,
  estimator: "local-met",
  source: "quick-log",
});

const receipt = (
  id: string,
  kind: Receipt["kind"],
  calories: number,
  purchasedAt: number,
): Receipt => ({
  id,
  merchant: id,
  purchasedAt,
  kind,
  currency: "USD",
  total: 5,
  items: [{ name: "item", price: 5, calories }],
});

const base = { tdee: 2400, meals: [], receipts: [], exercises: [], steps: [] };

describe("buildMetabolicSeries", () => {
  it("accrues living burn continuously from midnight", () => {
    const series = buildMetabolicSeries({ ...base, now: at(12) });
    expect(series.living).toBeCloseTo(1200, 5);
    expect(series.net).toBeCloseTo(-1200, 5);
    expect(series.projectedEndOfDay).toBeCloseTo(-2400, 5);
    // Monotone decline with no intake.
    for (let index = 1; index < series.samples.length; index += 1) {
      expect(series.samples[index]!.net).toBeLessThan(series.samples[index - 1]!.net);
    }
  });

  it("samples on a 10-minute grid up to now and ends exactly at now", () => {
    const now = at(9, 5);
    const series = buildMetabolicSeries({ ...base, now });
    expect(series.samples[0]!.t).toBe(at(0));
    expect(series.samples.at(-1)!.t).toBe(now);
    // 00:00..09:00 is 55 grid points, plus the exact 09:05 sample.
    expect(series.samples).toHaveLength(9 * (SERIES_INTERVALS_PER_DAY / 24) + 2);
  });

  it("rises on meals at the time they were eaten and ignores other days and the future", () => {
    const series = buildMetabolicSeries({
      ...base,
      now: at(13),
      meals: [
        meal("yesterday", 900, at(22, 0, 14)),
        meal("breakfast", 500, at(8)),
        meal("dinner", 700, at(19)),
      ],
    });
    expect(series.eaten).toBe(500);
    expect(
      sampleNetAt(series.samples, at(8, 10)) - sampleNetAt(series.samples, at(7, 50)),
    ).toBeGreaterThan(450);
    expect(series.events.map((event) => event.id)).toEqual(["breakfast"]);
  });

  it("counts prepared purchases as intake but not grocery stock", () => {
    const series = buildMetabolicSeries({
      ...base,
      now: at(12),
      receipts: [
        receipt("cafe", "prepared", 190, at(10)),
        receipt("grocer", "grocery", 2400, at(9)),
      ],
    });
    expect(series.bought).toBe(190);
    expect(series.events).toEqual([
      { id: "cafe", kind: "purchase", at: at(10), kcal: 190, label: "cafe" },
    ]);
  });

  it("drops with exercise spread over its duration", () => {
    const series = buildMetabolicSeries({
      ...base,
      tdee: 0,
      now: at(12),
      exercises: [exercise("run", 300, 30, at(11))],
    });
    expect(series.exercise).toBe(300);
    expect(series.net).toBe(-300);
    expect(sampleNetAt(series.samples, at(10, 30))).toBe(0);
    expect(sampleNetAt(series.samples, at(10, 40))).toBeCloseTo(-100, 5);
    expect(series.events[0]).toMatchObject({ kind: "exercise", kcal: -300 });
  });

  it("only burns steps beyond what TDEE already includes", () => {
    const steps: StepBucket[] = [
      { start: at(8), end: at(9), steps: 4000 },
      { start: at(12), end: at(13), steps: 3000 },
    ];
    const series = buildMetabolicSeries({ ...base, tdee: 0, now: at(12, 30), steps, weightKg: 80 });
    // 12:30 is halfway through the current bucket, recorded up to now: all 3000 counted.
    expect(series.steps).toBe(7000);
    expect(series.stepBurn).toBeCloseTo((7000 - STEPS_INCLUDED_IN_TDEE) * kcalPerStep(80), 5);
    expect(sampleNetAt(series.samples, at(10))).toBe(0);
  });

  it("treats an invalid TDEE as zero", () => {
    expect(buildMetabolicSeries({ ...base, tdee: Number.NaN, now: at(12) }).net).toBe(0);
  });
});

describe("monotonePath", () => {
  it("returns a move for one point and cubic segments for more", () => {
    expect(monotonePath([])).toBe("");
    expect(monotonePath([{ x: 1, y: 2 }])).toBe("M1,2");
    const path = monotonePath([
      { x: 0, y: 10 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]);
    expect(path.startsWith("M0,10C")).toBe(true);
    expect(path.match(/C/g)).toHaveLength(2);
  });

  it("does not overshoot a step (control points stay within neighbours)", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 100 },
      { x: 30, y: 100 },
    ];
    const numbers = monotonePath(points)
      .replace(/[MC]/g, " ")
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    const ys = numbers.filter((_, index) => index % 2 === 1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
  });
});
