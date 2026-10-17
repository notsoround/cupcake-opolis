import { afterEach, describe, expect, it, vi } from "vitest";
import type { NutritionAdapter } from "./nutrition-adapter.ts";
import "./nutrition-page.ts";
import { setNutritionAdapterForTesting } from "./nutrition-source.ts";

function fakeAdapter(kind: "sample" | "live", now: number): NutritionAdapter {
  return {
    kind,
    listMeals: async () => [
      { id: "b", name: "Oatmeal", calories: 400, eatenAt: now - 3 * 3_600_000, source: "chat" },
    ],
    logMeal: vi.fn(async (input) => ({
      id: "q",
      name: input.name,
      calories: input.calories,
      eatenAt: now,
      source: "quick-log" as const,
    })),
    getTargets: async () => ({ calorieTarget: 1800, tdee: 2400 }),
    setTargets: async (patch) => ({ calorieTarget: 1800, tdee: 2400, ...patch }),
    getSixPmGlucose: async () => ({ value: 104, unit: "mg/dL", takenAt: now }),
    listReceipts: async () => [],
    listExercises: async () => [],
    logExercise: vi.fn(async (input) => ({
      ...input,
      id: "x",
      performedAt: input.performedAt ?? now,
      source: "quick-log" as const,
    })),
    deleteExercise: async () => true,
    listSteps: async () => [],
  };
}

async function mount() {
  const element = document.createElement("openclaw-nutrition-page") as HTMLElement & {
    updateComplete: Promise<boolean>;
  };
  document.body.append(element);
  for (let index = 0; index < 5; index += 1) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    await element.updateComplete;
  }
  return element;
}

describe("Today screen", () => {
  afterEach(() => {
    document.body.replaceChildren();
    setNutritionAdapterForTesting(null);
    vi.useRealTimers();
  });

  it("labels sample data and renders last meal, balance basis, and 6pm sugar", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = new Date(2026, 9, 15, 12, 0).getTime();
    vi.setSystemTime(now);
    setNutritionAdapterForTesting(fakeAdapter("sample", now));
    const element = await mount();
    expect(element.querySelector(".cupcake-sample-badge")?.textContent).toContain("Sample data");
    const text = element.textContent ?? "";
    expect(text).toContain("3h 00m ago");
    expect(text).toContain("400 of 1,800 kcal");
    // Noon: 2400 × 50% = 1200 burned − 400 eaten = 800 deficit.
    expect(text).toContain("800 kcal deficit");
    expect(text).toContain("104");
    expect(element.querySelector(".cupcake-calendar")).not.toBeNull();
  });

  it("shows the TDEE basis read-only and links to Settings → Nutrition", async () => {
    setNutritionAdapterForTesting(fakeAdapter("sample", Date.now()));
    const element = await mount();
    expect(element.querySelector("input[name=tdee]")).toBeNull();
    expect(element.querySelector("input[name=calorieTarget]")).toBeNull();
    const basis = element.querySelector(".cupcake-targets-basis");
    expect(basis?.textContent).toContain("Based on TDEE 2,400 kcal/day and a 1,800 kcal target.");
    expect(
      basis?.querySelector<HTMLAnchorElement>(".cupcake-targets-basis__link")?.getAttribute("href"),
    ).toBe("/settings/nutrition");
  });

  it("drops the sample label for a live adapter", async () => {
    setNutritionAdapterForTesting(fakeAdapter("live", Date.now()));
    const element = await mount();
    expect(element.querySelector(".cupcake-sample-badge")).toBeNull();
  });
});
