/**
 * Food ledger source: the Cupcake private library (`cupcake-library.service`,
 * 127.0.0.1:8768 on the droplet). `food_history` pages the logged meal receipts stored
 * in `library.sqlite3` (`food_meals`), newest `consumedAt` first. Coverage is the saved
 * food-photo log only; meals never photographed or logged elsewhere are missing, and
 * meals with unknown eaten times are excluded by the library itself.
 */
import {
  finiteNumber,
  isRecord,
  readJsonResponse,
  SourceDisabledError,
  type SourceContext,
} from "./types.js";

export type FoodTotals = {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  sugarG: number;
  mealCount: number;
  /** Meals whose total is partial (some item had no resolved nutrition). */
  partialMealCount: number;
};

export type FoodSummary = {
  last24h: FoodTotals;
  last7d: FoodTotals;
  coverageNote: string;
};

export type FoodMeal = {
  consumedAt: string;
  total: Record<string, unknown>;
  totalIsPartial?: boolean;
};

const DAY_MS = 86_400_000;
const MAX_PAGES = 5;

function emptyTotals(): FoodTotals {
  return {
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    sugarG: 0,
    mealCount: 0,
    partialMealCount: 0,
  };
}

function addMeal(totals: FoodTotals, meal: FoodMeal): void {
  totals.calories += finiteNumber(meal.total.calories) ?? 0;
  totals.proteinG += finiteNumber(meal.total.protein_g) ?? 0;
  totals.carbsG += finiteNumber(meal.total.carbs_g) ?? 0;
  totals.fatG += finiteNumber(meal.total.fat_g) ?? 0;
  totals.sugarG += finiteNumber(meal.total.sugar_g) ?? 0;
  totals.mealCount += 1;
  if (meal.totalIsPartial) {
    totals.partialMealCount += 1;
  }
}

function round(totals: FoodTotals): FoodTotals {
  return {
    ...totals,
    calories: Math.round(totals.calories),
    proteinG: Math.round(totals.proteinG),
    carbsG: Math.round(totals.carbsG),
    fatG: Math.round(totals.fatG),
    sugarG: Math.round(totals.sugarG),
  };
}

/** Pure aggregation over meal receipts; future-dated and unparseable meals are ignored. */
export function aggregateFood(meals: readonly FoodMeal[], nowMs: number): FoodSummary {
  const last24h = emptyTotals();
  const last7d = emptyTotals();
  for (const meal of meals) {
    const at = Date.parse(meal.consumedAt);
    if (!Number.isFinite(at) || at > nowMs) {
      continue;
    }
    if (at >= nowMs - 7 * DAY_MS) {
      addMeal(last7d, meal);
    }
    if (at >= nowMs - DAY_MS) {
      addMeal(last24h, meal);
    }
  }
  return {
    last24h: round(last24h),
    last7d: round(last7d),
    coverageNote: "logged food photos only; unlogged meals are missing",
  };
}

function parseMeal(value: unknown): FoodMeal | undefined {
  if (!isRecord(value) || typeof value.consumedAt !== "string") {
    return undefined;
  }
  return {
    consumedAt: value.consumedAt,
    total: isRecord(value.total) ? value.total : {},
    totalIsPartial: value.totalIsPartial === true,
  };
}

export async function fetchFoodSummary(
  ctx: SourceContext,
  library: { url: string; key?: string },
): Promise<FoodSummary> {
  if (!library.key) {
    throw new SourceDisabledError("CUPCAKE_LIBRARY_KEY not configured");
  }
  const cutoff = ctx.nowMs - 7 * DAY_MS;
  const meals: FoodMeal[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await ctx.fetchImpl(library.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cupcake-key": library.key },
      body: JSON.stringify({ action: "food_history", limit: 200, ...(cursor ? { cursor } : {}) }),
      signal: ctx.signal,
    });
    const body = await readJsonResponse(response, "cupcake-library food_history");
    if (!isRecord(body) || !Array.isArray(body.meals)) {
      throw new Error("cupcake-library food_history returned an unexpected shape");
    }
    const pageMeals = body.meals.map(parseMeal).filter((m): m is FoodMeal => Boolean(m));
    meals.push(...pageMeals);
    const oldest = pageMeals.at(-1);
    cursor = typeof body.nextCursor === "string" ? body.nextCursor : undefined;
    if (!body.hasMore || !cursor || !oldest || Date.parse(oldest.consumedAt) < cutoff) {
      break;
    }
  }
  return aggregateFood(meals, ctx.nowMs);
}
