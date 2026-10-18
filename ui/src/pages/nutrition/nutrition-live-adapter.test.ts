import { describe, expect, it, vi } from "vitest";
import { createSampleNutritionAdapter } from "./nutrition-adapter.ts";
import {
  createLiveNutritionAdapter,
  createOfflineNutritionAdapter,
} from "./nutrition-live-adapter.ts";

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

const day = new Date(2026, 9, 17).getTime();
const range = { start: day, end: day + 86_400_000 };
const candyAt = new Date(2026, 9, 17, 17, 41).getTime();

function liveWith(responses: Record<string, unknown>) {
  const local = createSampleNutritionAdapter({
    storage: memoryStorage(),
    now: () => day + 86_400_000,
  });
  const request = vi.fn(async (method: string) => {
    const value = responses[method];
    if (value instanceof Error) {
      throw value;
    }
    return value;
  });
  return { adapter: createLiveNutritionAdapter({ request, local }), local, request };
}

describe("live nutrition adapter", () => {
  it("returns real logged meals (never sample meals) plus this browser's quick logs", async () => {
    const { adapter, local } = liveWith({
      "nutrition.meals.list": {
        meals: [
          { id: "photo-1", name: "Bulk candy", calories: 1560, eatenAt: candyAt, sugarGrams: 200 },
          { id: "broken", name: "No time", calories: 10 },
        ],
      },
    });
    await local.logMeal({ name: "Apple", calories: 95, eatenAt: day + 9 * 3_600_000 });
    const meals = await adapter.listMeals(range);
    expect(meals.map((m) => [m.name, m.source])).toEqual([
      ["Apple", "quick-log"],
      ["Bulk candy", "photo-log"],
    ]);
    expect(adapter.kind).toBe("live");
    expect(adapter.problem).toBeNull();
  });

  it("names the failing source and shows nothing for it", async () => {
    const { adapter } = liveWith({
      "nutrition.meals.list": new Error("cupcake library timed out"),
    });
    await expect(adapter.listMeals(range)).resolves.toEqual([]);
    expect(adapter.problem).toContain("cupcake library timed out");
  });

  it("clears the problem after a later success", async () => {
    const responses: Record<string, unknown> = { "nutrition.meals.list": new Error("down") };
    const { adapter } = liveWith(responses);
    await adapter.listMeals(range);
    responses["nutrition.meals.list"] = { meals: [] };
    await adapter.listMeals(range);
    expect(adapter.problem).toBeNull();
  });

  it("maps purchases, keeps prepared kind, and reports no fabricated steps", async () => {
    const { adapter } = liveWith({
      "nutrition.receipts.list": {
        receipts: [
          {
            id: "bank-alert-1",
            merchant: "Taco Spot",
            purchasedAt: day + 3_600_000,
            kind: "prepared",
            currency: "USD",
            total: 12.5,
            items: [],
            source: "bank-alert",
            timeBasis: "exact",
          },
        ],
      },
    });
    const receipts = await adapter.listReceipts(range);
    expect(receipts).toMatchObject([
      { merchant: "Taco Spot", kind: "prepared", source: "bank-alert" },
    ]);
    await expect(adapter.listSteps(range)).resolves.toEqual([]);
  });

  it("prefers owner library targets and falls back to this browser per field", async () => {
    const { adapter, local } = liveWith({
      "nutrition.targets.get": { calorieTarget: null, tdee: 2500 },
    });
    await local.setTargets({ calorieTarget: 1700 });
    await expect(adapter.getTargets()).resolves.toEqual({ calorieTarget: 1700, tdee: 2500 });
  });

  it("asks for the reading closest to 6pm local", async () => {
    const { adapter, request } = liveWith({
      "nutrition.glucose.closest": { reading: { value: 132, unit: "mg/dL", takenAt: candyAt } },
    });
    await expect(adapter.getSixPmGlucose(new Date(day))).resolves.toEqual({
      value: 132,
      unit: "mg/dL",
      takenAt: candyAt,
    });
    expect(request).toHaveBeenCalledWith("nutrition.glucose.closest", {
      start: day,
      end: day + 86_400_000,
      at: new Date(2026, 9, 17, 18, 0).getTime(),
    });
  });
});

describe("offline nutrition adapter", () => {
  it("shows no fabricated data while disconnected", async () => {
    const local = createSampleNutritionAdapter({
      storage: memoryStorage(),
      now: () => day + 86_400_000,
    });
    const adapter = createOfflineNutritionAdapter(local);
    expect(adapter.kind).toBe("offline");
    await expect(adapter.listMeals(range)).resolves.toEqual([]);
    await expect(adapter.listReceipts(range)).resolves.toEqual([]);
    await expect(adapter.getSixPmGlucose(new Date(day))).resolves.toBeNull();
  });
});
