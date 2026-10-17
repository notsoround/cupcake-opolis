import { describe, expect, it } from "vitest";
import { checkAlarms } from "./alarms.js";
import { resolveCallContextSettings } from "./config.js";
import type { FoodSummary } from "./sources/food.js";

const thresholds = resolveCallContextSettings({}).thresholds;
const totals = (calories: number, sugarG: number) => ({
  calories,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
  sugarG,
  mealCount: 1,
  partialMealCount: 0,
});
const food = (calories: number, sugarG: number): FoodSummary => ({
  last24h: totals(calories, sugarG),
  last7d: totals(calories, sugarG),
  coverageNote: "",
});

describe("checkAlarms", () => {
  it("raises configured spend, food and glucose flags at the threshold", () => {
    const report = checkAlarms({
      thresholds,
      purchase: {
        amount: 25,
        merchant: "Uber Eats",
        merchantKnown: true,
        merchantSource: "bank notification (confirmed)",
        confidence: "HIGH",
        category: "fast-food",
        nearMatches: "none",
      },
      purchases: {
        recentContext: "",
        foodContext: "",
        spend7dUsd: 300,
        foodSpend7dUsd: 150,
        repeatMerchants: ["Uber Eats"],
        transactions: [],
      },
      food: food(3000, 75),
      glucose: { mgDl: 65, trend: "falling", observedAt: "", basis: "owner-reported" },
    });
    expect(report.flags.map((f) => f.id).toSorted()).toEqual([
      "calories_24h_high",
      "food_spend_7d_high",
      "glucose_low",
      "repeat_merchant",
      "spend_single_high",
      "sugar_24h_high",
    ]);
    expect(report.flags.find((f) => f.id === "glucose_low")?.severity).toBe("urgent");
    expect(report.skipped).toEqual([]);
  });

  it("does not raise flags below thresholds and records skipped sources", () => {
    const report = checkAlarms({ thresholds, food: food(1200, 20) });
    expect(report.flags).toEqual([]);
    expect(report.skipped).toEqual(["spending", "glucose"]);
  });

  it("honors custom thresholds from env", () => {
    const custom = resolveCallContextSettings({
      CUPCAKE_VAPI_ALARM_GLUCOSE_HIGH_MGDL: "140",
    }).thresholds;
    const report = checkAlarms({
      thresholds: custom,
      glucose: { mgDl: 142, trend: "rising", observedAt: "", basis: "owner-reported" },
    });
    expect(report.flags.map((f) => f.id)).toEqual(["glucose_high"]);
  });
});
