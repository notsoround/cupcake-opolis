/**
 * Nutrition data seam for the Cupcake Today / Nutrition / Receipts surfaces.
 *
 * TODO(cupcake-nutrition-backend): this repo has no nutrition backend yet.
 * The Codex food-log work (nutritionApi.ts / nutritionModel.ts on the
 * unpublished `codex/cupcake-auto-food-log` branch) was never pushed, so the
 * UI talks to this typed interface and ships with `createSampleNutritionAdapter`
 * only. A real implementation should satisfy `NutritionAdapter` (kind: "live")
 * by calling Gateway methods; see the PR description for proposed shapes:
 *   nutrition.meals.list    { start, end }            -> { meals: MealEntry[] }
 *   nutrition.meals.log     QuickLogInput             -> { meal: MealEntry }
 *   nutrition.targets.get / nutrition.targets.set     -> NutritionTargets
 *   nutrition.glucose.daily { day: "YYYY-MM-DD", at: "18:00" } -> GlucoseReading | null
 *   nutrition.receipts.list { start, end }            -> { receipts: Receipt[] }
 * Everything the sample adapter returns is fabricated and labeled "Sample data"
 * in the UI (`adapter.kind === "sample"`).
 */

export type MealEntry = {
  id: string;
  name: string;
  /** Kilocalories. */
  calories: number;
  /** Epoch milliseconds when the meal was eaten (not when it was logged). */
  eatenAt: number;
  sugarGrams?: number;
  source: "sample" | "quick-log" | "receipt" | "chat";
};

export type QuickLogInput = { name: string; calories: number; eatenAt?: number };

export type GlucoseReading = { value: number; unit: "mg/dL"; takenAt: number };

export type NutritionTargets = {
  /** Daily calorie intake target, kcal. */
  calorieTarget: number;
  /** Total daily energy expenditure estimate, kcal/day. */
  tdee: number;
};

export type ReceiptItem = { name: string; price: number; calories?: number };

export type Receipt = {
  id: string;
  merchant: string;
  purchasedAt: number;
  currency: string;
  total: number;
  items: ReceiptItem[];
};

export type TimeRange = { start: number; end: number };

export interface NutritionAdapter {
  /** "sample" adapters must be labeled as sample data wherever they render. */
  readonly kind: "sample" | "live";
  listMeals(range: TimeRange): Promise<MealEntry[]>;
  logMeal(input: QuickLogInput): Promise<MealEntry>;
  getTargets(): Promise<NutritionTargets>;
  setTargets(patch: Partial<NutritionTargets>): Promise<NutritionTargets>;
  /** The reading closest to 6:00 pm local on `day`, or null when none exists yet. */
  getSixPmGlucose(day: Date): Promise<GlucoseReading | null>;
  listReceipts(range: TimeRange): Promise<Receipt[]>;
}

export const DEFAULT_TDEE_KCAL = 2200;
export const DEFAULT_CALORIE_TARGET_KCAL = 1800;

const SAMPLE_STORAGE_KEY = "openclaw.control.cupcake.sampleNutrition.v1";

type SampleState = { meals: MealEntry[]; targets?: Partial<NutritionTargets> };

/** Deterministic 0..1 noise so sample days look stable across reloads. */
function seeded(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function dayKey(time: number): number {
  const date = new Date(time);
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

function startOfLocalDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

const SAMPLE_MEALS = [
  { name: "Greek yogurt & berries", hour: 8, minute: 10, calories: 320, sugar: 18 },
  { name: "Chicken salad bowl", hour: 12, minute: 40, calories: 560, sugar: 7 },
  { name: "Apple & almonds", hour: 15, minute: 30, calories: 240, sugar: 16 },
  { name: "Salmon, rice & greens", hour: 19, minute: 0, calories: 690, sugar: 5 },
] as const;

/** Fabricated meals for one local day, only those eaten before `now`. */
export function sampleMealsForDay(dayStart: number, now: number): MealEntry[] {
  const key = dayKey(dayStart);
  return SAMPLE_MEALS.flatMap((meal, index) => {
    const jitter = seeded(key * 7 + index);
    if (index === 2 && jitter < 0.3) {
      return []; // Some days skip the snack.
    }
    const date = new Date(dayStart);
    date.setHours(meal.hour, meal.minute + Math.round(jitter * 40) - 20, 0, 0);
    const eatenAt = date.getTime();
    if (eatenAt > now) {
      return [];
    }
    return [
      {
        id: `sample-${key}-${index}`,
        name: meal.name,
        calories: Math.round(meal.calories * (0.85 + jitter * 0.3)),
        sugarGrams: meal.sugar,
        eatenAt,
        source: "sample" as const,
      },
    ];
  });
}

function readState(storage: Storage | null): SampleState {
  try {
    const raw = storage?.getItem(SAMPLE_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<SampleState>) : {};
    const meals = Array.isArray(parsed.meals)
      ? parsed.meals.filter(
          (meal): meal is MealEntry =>
            typeof meal?.id === "string" &&
            typeof meal.name === "string" &&
            Number.isFinite(meal.calories) &&
            Number.isFinite(meal.eatenAt),
        )
      : [];
    return { meals, targets: parsed.targets };
  } catch {
    return { meals: [] };
  }
}

function writeState(storage: Storage | null, state: SampleState): void {
  try {
    storage?.setItem(SAMPLE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Sample persistence is best effort.
  }
}

function positiveOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

/**
 * SAMPLE DATA ONLY. Generates plausible meals, a 6pm glucose value, and
 * receipts locally; quick-logged meals and targets persist in localStorage.
 */
export function createSampleNutritionAdapter(
  options: { storage?: Storage | null; now?: () => number } = {},
): NutritionAdapter {
  const storage = options.storage ?? null;
  const now = options.now ?? (() => Date.now());
  return {
    kind: "sample",
    async listMeals(range) {
      const current = now();
      const generated: MealEntry[] = [];
      for (
        let day = startOfLocalDay(range.start);
        day < range.end && day <= current;
        day = startOfLocalDay(day + 36 * 3_600_000)
      ) {
        generated.push(...sampleMealsForDay(day, current));
      }
      return [...generated, ...readState(storage).meals]
        .filter((meal) => meal.eatenAt >= range.start && meal.eatenAt < range.end)
        .toSorted((a, b) => a.eatenAt - b.eatenAt);
    },
    async logMeal(input) {
      const state = readState(storage);
      const meal: MealEntry = {
        id: `quick-${now()}-${state.meals.length}`,
        name: input.name.trim(),
        calories: Math.max(0, Math.round(input.calories)),
        eatenAt: input.eatenAt ?? now(),
        source: "quick-log",
      };
      writeState(storage, { ...state, meals: [...state.meals, meal] });
      return meal;
    },
    async getTargets() {
      const targets = readState(storage).targets;
      return {
        calorieTarget: positiveOr(targets?.calorieTarget, DEFAULT_CALORIE_TARGET_KCAL),
        tdee: positiveOr(targets?.tdee, DEFAULT_TDEE_KCAL),
      };
    },
    async setTargets(patch) {
      const state = readState(storage);
      const next: NutritionTargets = {
        calorieTarget: positiveOr(
          patch.calorieTarget ?? state.targets?.calorieTarget,
          DEFAULT_CALORIE_TARGET_KCAL,
        ),
        tdee: positiveOr(patch.tdee ?? state.targets?.tdee, DEFAULT_TDEE_KCAL),
      };
      writeState(storage, { ...state, targets: next });
      return next;
    },
    async getSixPmGlucose(day) {
      const sixPm = new Date(day);
      sixPm.setHours(18, 0, 0, 0);
      if (sixPm.getTime() > now()) {
        return null;
      }
      const value = 92 + Math.round(seeded(dayKey(sixPm.getTime())) * 38);
      return { value, unit: "mg/dL", takenAt: sixPm.getTime() + 4 * 60_000 };
    },
    async listReceipts(range) {
      const current = now();
      const receipts: Receipt[] = [];
      const merchants = ["Whole Foods Market", "Trader Joe's", "Sweetgreen", "H-E-B"];
      for (let index = 0; index < 6; index += 1) {
        const purchasedAt = startOfLocalDay(current) - index * 2 * 86_400_000 + 17 * 3_600_000;
        if (purchasedAt < range.start || purchasedAt >= range.end || purchasedAt > current) {
          continue;
        }
        const noise = seeded(dayKey(purchasedAt) + index);
        const items: ReceiptItem[] = [
          { name: "Greek yogurt", price: 5.49, calories: 600 },
          { name: "Blueberries", price: 4.99, calories: 340 },
          { name: "Salmon fillet", price: 12.99, calories: 830 },
          { name: "Mixed greens", price: 3.99, calories: 90 },
        ].slice(0, 2 + Math.floor(noise * 3));
        receipts.push({
          id: `sample-receipt-${index}`,
          merchant: merchants[index % merchants.length] ?? "Grocery store",
          purchasedAt,
          currency: "USD",
          total: Math.round(items.reduce((sum, item) => sum + item.price, 0) * 100) / 100,
          items,
        });
      }
      return receipts;
    },
  };
}
