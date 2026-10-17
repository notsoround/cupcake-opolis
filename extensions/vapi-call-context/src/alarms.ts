/**
 * Threshold alarm checks. Pure: given whatever sources came back, emit flags. A missing
 * source never raises (or clears) an alarm; it is simply not evaluated, and the flag list
 * says which checks were skipped so the prompt never implies "all clear" on missing data.
 */
import type { AlarmThresholds } from "./config.js";
import type { FoodSummary } from "./sources/food.js";
import type { GlucoseReading } from "./sources/glucose.js";
import type { PurchaseSummary, ResolvedPurchase } from "./sources/purchases.js";

export type AlarmId =
  | "spend_single_high"
  | "repeat_merchant"
  | "food_spend_7d_high"
  | "calories_24h_high"
  | "sugar_24h_high"
  | "glucose_high"
  | "glucose_low";

export type AlarmFlag = { id: AlarmId; severity: "warn" | "urgent"; message: string };

export type AlarmReport = { flags: AlarmFlag[]; skipped: string[] };

export function checkAlarms(input: {
  thresholds: AlarmThresholds;
  purchase?: ResolvedPurchase;
  purchases?: PurchaseSummary;
  food?: FoodSummary;
  glucose?: GlucoseReading | null;
}): AlarmReport {
  const t = input.thresholds;
  const flags: AlarmFlag[] = [];
  const skipped: string[] = [];

  if (input.purchase) {
    if (input.purchase.amount >= t.spendSingleUsd) {
      flags.push({
        id: "spend_single_high",
        severity: "warn",
        message: `this charge ($${input.purchase.amount.toFixed(2)}) is at or over the $${t.spendSingleUsd} single-purchase line`,
      });
    }
    if (input.purchases?.repeatMerchants.includes(input.purchase.merchant)) {
      flags.push({
        id: "repeat_merchant",
        severity: "warn",
        message: `${input.purchase.merchant} shows up 2+ times in his recent bank data`,
      });
    }
  }

  if (input.purchases) {
    if (input.purchases.foodSpend7dUsd >= t.foodSpend7dUsd) {
      flags.push({
        id: "food_spend_7d_high",
        severity: "warn",
        message: `food & drink spend over 7 days is $${input.purchases.foodSpend7dUsd.toFixed(2)} (line: $${t.foodSpend7dUsd})`,
      });
    }
  } else {
    skipped.push("spending");
  }

  if (input.food) {
    if (input.food.last24h.calories >= t.calories24h) {
      flags.push({
        id: "calories_24h_high",
        severity: "warn",
        message: `${input.food.last24h.calories} logged calories in 24 hours (line: ${t.calories24h})`,
      });
    }
    if (input.food.last24h.sugarG >= t.sugar24hGrams) {
      flags.push({
        id: "sugar_24h_high",
        severity: "warn",
        message: `${input.food.last24h.sugarG} g logged sugar in 24 hours (line: ${t.sugar24hGrams} g)`,
      });
    }
  } else {
    skipped.push("food");
  }

  if (input.glucose) {
    if (input.glucose.mgDl >= t.glucoseHighMgDl) {
      flags.push({
        id: "glucose_high",
        severity: "warn",
        message: `latest glucose ${input.glucose.mgDl} mg/dL (high line ${t.glucoseHighMgDl})`,
      });
    }
    if (input.glucose.mgDl <= t.glucoseLowMgDl) {
      flags.push({
        id: "glucose_low",
        severity: "urgent",
        message: `latest glucose ${input.glucose.mgDl} mg/dL (low line ${t.glucoseLowMgDl})`,
      });
    }
  } else if (input.glucose === undefined) {
    skipped.push("glucose");
  }

  return { flags, skipped };
}
