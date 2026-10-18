import { afterEach, describe, expect, it, vi } from "vitest";
import type { NutritionAdapter } from "./nutrition-adapter.ts";
import "./exercise-quick-log.ts";
import "./metabolic-curve.ts";
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

  it("renders the live metabolic balance curve with sample-labeled steps and purchases", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = new Date(2026, 9, 15, 12, 0).getTime();
    vi.setSystemTime(now);
    setNutritionAdapterForTesting(fakeAdapter("sample", now));
    const element = await mount();
    const curve = element.querySelector("openclaw-metabolic-curve");
    expect(curve).not.toBeNull();
    await (curve as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete;
    expect(curve?.textContent).toContain("Metabolic balance");
    expect(curve?.querySelector(".cupcake-curve__line")?.getAttribute("d")).toMatch(
      /^M[\d.]+,[\d.]+C/,
    );
    expect(curve?.querySelector(".cupcake-curve__now")).not.toBeNull();
    expect(curve?.querySelectorAll(".cupcake-curve__sample")).toHaveLength(2);
    // Living burn to midnight: 800 deficit now + 1200 more.
    expect(curve?.textContent).toContain("By midnight: 2,000 kcal deficit");
    const prism = curve?.querySelector<HTMLButtonElement>(".cupcake-curve__prism-toggle");
    expect(prism?.getAttribute("aria-pressed")).toBe("false");
    prism?.click();
    await (curve as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete;
    expect(prism?.getAttribute("aria-pressed")).toBe("true");
    expect(curve?.querySelector(".cupcake-curve__line")?.getAttribute("style")).toContain("url(#");
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
    expect(element.querySelector(".cupcake-live-badge")?.textContent).toContain("Live");
  });

  it("reports an unreachable live source instead of inventing data", async () => {
    const adapter = {
      ...fakeAdapter("live", Date.now()),
      problem: "meals: cupcake library timed out",
    };
    setNutritionAdapterForTesting(adapter);
    const element = await mount();
    const alert = element.querySelector(".cupcake-sample-notice--problem");
    expect(alert?.getAttribute("role")).toBe("alert");
    expect(alert?.textContent).toContain("cupcake library timed out");
  });

  it("restores the In your corner shortcuts, Food today and an honest Wins & losses card", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = new Date(2026, 9, 15, 12, 0).getTime();
    vi.setSystemTime(now);
    setNutritionAdapterForTesting(fakeAdapter("live", now));
    const element = await mount();
    const corner = element.querySelector(".cupcake-corner")?.textContent ?? "";
    for (const label of ["Record a note", "Quick tip", "Food photo", "Wins & losses"]) {
      expect(corner).toContain(label);
    }
    expect(element.textContent).toContain("Food today");
    expect(element.textContent).toContain("Oatmeal");
    // No Gateway in tests: the card says it is offline rather than showing scores.
    const wins = element.querySelector(".cupcake-wins");
    expect(wins?.textContent).toContain("Wins & losses");
    expect(wins?.querySelector(".cupcake-wins__scores")).toBeNull();
  });
});
