import { afterEach, describe, expect, it } from "vitest";
import { createSampleNutritionAdapter } from "./nutrition-adapter.ts";
import { parseNutritionTarget } from "./nutrition-settings-page.ts";
import { setNutritionAdapterForTesting } from "./nutrition-source.ts";

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

async function mount() {
  const element = document.createElement("openclaw-nutrition-settings-page") as HTMLElement & {
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

async function settle(element: HTMLElement & { updateComplete: Promise<boolean> }) {
  for (let index = 0; index < 3; index += 1) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    await element.updateComplete;
  }
}

describe("Settings → Nutrition", () => {
  afterEach(() => {
    document.body.replaceChildren();
    setNutritionAdapterForTesting(null);
  });

  it("parses whole numbers within the accepted range", () => {
    expect(parseNutritionTarget("tdee", "2450")).toBe(2450);
    expect(parseNutritionTarget("tdee", " 2450.6 ")).toBe(2451);
    expect(parseNutritionTarget("tdee", "799")).toBeNull();
    expect(parseNutritionTarget("tdee", "")).toBeNull();
    expect(parseNutritionTarget("calorieTarget", "500")).toBe(500);
    expect(parseNutritionTarget("calorieTarget", "abc")).toBeNull();
  });

  it("edits TDEE and calorie target through the nutrition adapter", async () => {
    const adapter = createSampleNutritionAdapter({ storage: memoryStorage() });
    setNutritionAdapterForTesting(adapter);
    const element = await mount();
    expect(element.querySelector(".cupcake-sample-badge")).not.toBeNull();
    const tdee = element.querySelector<HTMLInputElement>("input[name=tdee]");
    const target = element.querySelector<HTMLInputElement>("input[name=calorieTarget]");
    expect(tdee?.value).toBe("2200");
    expect(target?.value).toBe("1800");

    tdee!.value = "2500";
    tdee!.dispatchEvent(new Event("change"));
    await settle(element);
    expect(await adapter.getTargets()).toEqual({ tdee: 2500, calorieTarget: 1800 });
    expect(element.querySelector("#cupcake-settings-tdee-status")?.textContent).toContain("Saved");

    target!.value = "100";
    target!.dispatchEvent(new Event("change"));
    await settle(element);
    expect(await adapter.getTargets()).toEqual({ tdee: 2500, calorieTarget: 1800 });
    expect(target?.getAttribute("aria-invalid")).toBe("true");
  });
});
