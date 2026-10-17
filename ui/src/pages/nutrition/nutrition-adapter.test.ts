import { describe, expect, it } from "vitest";
import { createSampleNutritionAdapter, DEFAULT_TDEE_KCAL } from "./nutrition-adapter.ts";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

describe("sample nutrition adapter", () => {
  const now = new Date(2026, 9, 15, 14, 0).getTime();
  const dayStart = new Date(2026, 9, 15).getTime();

  it("is labeled sample and never returns future meals", async () => {
    const adapter = createSampleNutritionAdapter({ storage: memoryStorage(), now: () => now });
    expect(adapter.kind).toBe("sample");
    const meals = await adapter.listMeals({ start: dayStart, end: dayStart + 86_400_000 });
    expect(meals.length).toBeGreaterThan(0);
    expect(meals.every((meal) => meal.eatenAt <= now)).toBe(true);
  });

  it("persists quick-logged meals and targets", async () => {
    const storage = memoryStorage();
    const adapter = createSampleNutritionAdapter({ storage, now: () => now });
    await adapter.logMeal({ name: " Latte ", calories: 190.4 });
    const meals = await adapter.listMeals({ start: dayStart, end: dayStart + 86_400_000 });
    expect(meals.at(-1)).toMatchObject({ name: "Latte", calories: 190, source: "quick-log" });
    expect((await adapter.getTargets()).tdee).toBe(DEFAULT_TDEE_KCAL);
    await adapter.setTargets({ tdee: 2500 });
    expect(await createSampleNutritionAdapter({ storage }).getTargets()).toMatchObject({
      tdee: 2500,
    });
  });

  it("has no 6pm reading before 6pm", async () => {
    const adapter = createSampleNutritionAdapter({ storage: memoryStorage(), now: () => now });
    expect(await adapter.getSixPmGlucose(new Date(now))).toBeNull();
    const evening = createSampleNutritionAdapter({
      storage: memoryStorage(),
      now: () => now + 5 * 3_600_000,
    });
    expect((await evening.getSixPmGlucose(new Date(now)))?.unit).toBe("mg/dL");
  });
});

describe("sample exercise and step data", () => {
  const now = new Date(2026, 9, 15, 14, 30).getTime();
  const dayStart = new Date(2026, 9, 15).getTime();
  const day = { start: dayStart, end: dayStart + 86_400_000 };

  it("persists, lists and undoes logged exercises next to meals", async () => {
    const storage = memoryStorage();
    const adapter = createSampleNutritionAdapter({ storage, now: () => now });
    const entry = await adapter.logExercise({
      description: "  30 push-ups  ",
      kcal: 9.6,
      minutes: 1,
      estimator: "local-met",
    });
    expect(entry).toMatchObject({ description: "30 push-ups", kcal: 10, performedAt: now });
    await adapter.logMeal({ name: "Toast", calories: 200 });
    const reopened = createSampleNutritionAdapter({ storage, now: () => now });
    expect(await reopened.listExercises(day)).toEqual([entry]);
    expect((await reopened.listMeals(day)).some((meal) => meal.name === "Toast")).toBe(true);
    expect(await reopened.deleteExercise(entry.id)).toBe(true);
    expect(await reopened.deleteExercise(entry.id)).toBe(false);
    expect(await reopened.listExercises(day)).toEqual([]);
    expect((await reopened.listMeals(day)).some((meal) => meal.name === "Toast")).toBe(true);
  });

  it("returns sample steps only up to now, prorating the current hour", async () => {
    const adapter = createSampleNutritionAdapter({ storage: memoryStorage(), now: () => now });
    const steps = await adapter.listSteps(day);
    expect(steps.length).toBeGreaterThan(5);
    expect(steps.every((bucket) => bucket.start < now)).toBe(true);
    const last = steps.at(-1);
    expect(last?.start).toBe(new Date(2026, 9, 15, 14).getTime());
  });

  it("marks today's café purchase as prepared food", async () => {
    const adapter = createSampleNutritionAdapter({ storage: memoryStorage(), now: () => now });
    const receipts = await adapter.listReceipts(day);
    expect(receipts.some((receipt) => receipt.kind === "prepared")).toBe(true);
  });
});
