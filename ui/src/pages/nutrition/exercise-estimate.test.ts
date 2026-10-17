import { describe, expect, it } from "vitest";
import { DEFAULT_BODY_WEIGHT_KG, estimateExerciseBurn } from "./exercise-estimate.ts";

const net = (met: number, minutes: number, kg = DEFAULT_BODY_WEIGHT_KG) =>
  Math.round(((met - 1) * kg * minutes) / 60);

describe("estimateExerciseBurn", () => {
  it("splits Matt's example into three counted movements", () => {
    const result = estimateExerciseBurn("30 push-ups, 2 min plank, kettlebell rows 3x10 at 35lb");
    expect(result.items.map((item) => item.activity)).toEqual(["push-ups", "plank", "kettlebell"]);
    expect(result.unrecognized).toEqual([]);
    const [pushUps, plank, rows] = result.items;
    expect(pushUps).toMatchObject({ reps: 30, minutes: 1, kcal: net(8, 1), assumed: false });
    expect(plank).toMatchObject({ minutes: 2, kcal: net(3.8, 2) });
    expect(rows).toMatchObject({ sets: 3, reps: 30, loadKg: 15.9 });
    expect(rows?.minutes).toBe(1.5);
    expect(result.kcal).toBe(result.items.reduce((sum, item) => sum + item.kcal, 0));
    // About 30 kcal net: short sets are cheap; the curve should not flatter them.
    expect(result.kcal).toBeGreaterThanOrEqual(25);
    expect(result.kcal).toBeLessThan(60);
    expect(result.source).toBe("local-met");
  });

  it("counts only burn above resting (net MET)", () => {
    const result = estimateExerciseBurn("30 minute walk");
    expect(result.items[0]).toMatchObject({ activity: "walking", minutes: 30, kcal: net(3.5, 30) });
  });

  it("scales with body weight", () => {
    const light = estimateExerciseBurn("run 30 min", { weightKg: 60 }).kcal;
    const heavy = estimateExerciseBurn("run 30 min", { weightKg: 100 }).kcal;
    expect(heavy).toBeGreaterThan(light);
    expect(light).toBe(net(9.8, 30, 60));
  });

  it("reads hours, clock times, spelled numbers and distances", () => {
    expect(estimateExerciseBurn("cycling 1.5 hours").items[0]?.minutes).toBe(90);
    expect(estimateExerciseBurn("half an hour of yoga").items[0]?.minutes).toBe(30);
    expect(estimateExerciseBurn("an hour bike ride").items[0]?.minutes).toBe(60);
    expect(estimateExerciseBurn("plank 1:30").items[0]?.minutes).toBe(1.5);
    expect(estimateExerciseBurn("ran 3 miles").items[0]).toMatchObject({
      activity: "running",
      minutes: 30,
    });
    expect(estimateExerciseBurn("5k run").items[0]?.minutes).toBeCloseTo(31.1, 1);
    expect(estimateExerciseBurn("twenty squats").items[0]).toMatchObject({
      activity: "squats",
      reps: 20,
    });
    expect(estimateExerciseBurn("plank for 45 seconds").items[0]?.minutes).toBe(0.8);
  });

  it("converts step counts to walking time", () => {
    const result = estimateExerciseBurn("walked 4,000 steps");
    expect(result.items[0]).toMatchObject({ activity: "walking", minutes: 40, kcal: net(3.5, 40) });
    expect(estimateExerciseBurn("3k steps").items[0]?.minutes).toBe(30);
  });

  it("handles sets-of-reps phrasing and adds light rest between sets", () => {
    const grid = estimateExerciseBurn("squats 3x10").items[0];
    const words = estimateExerciseBurn("3 sets of 10 squats").items[0];
    expect(grid).toMatchObject({ sets: 3, reps: 30, minutes: 1.5 });
    expect(words).toEqual(grid);
    // 1.5 min at 5 MET plus 2 min of rest at 2 MET.
    expect(grid?.kcal).toBe(Math.round((4 * 80 * 1.5) / 60 + (1 * 80 * 2) / 60));
  });

  it("assumes a duration when only the activity is named and flags it", () => {
    const result = estimateExerciseBurn("went swimming");
    expect(result.items[0]).toMatchObject({ activity: "swimming", minutes: 15, assumed: true });
  });

  it("reports clauses it cannot recognize and counts nothing for them", () => {
    const result = estimateExerciseBurn("watched tv and 10 push-ups");
    expect(result.unrecognized).toEqual(["watched tv"]);
    expect(result.items).toHaveLength(1);
    expect(estimateExerciseBurn("").kcal).toBe(0);
    expect(estimateExerciseBurn("nothing much").items).toEqual([]);
  });

  it("falls back to the default weight for invalid input", () => {
    expect(estimateExerciseBurn("walk 30 min", { weightKg: Number.NaN }).kcal).toBe(net(3.5, 30));
  });
});
