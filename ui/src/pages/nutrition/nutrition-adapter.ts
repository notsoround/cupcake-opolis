/**
 * Nutrition data seam for the Cupcake Today / Nutrition / Receipts surfaces.
 *
 * The real backend is the `cupcake-nutrition` Gateway plugin
 * (extensions/cupcake-nutrition), whose read-only methods are consumed by
 * `createLiveNutritionAdapter` (nutrition-live-adapter.ts):
 *   nutrition.meals.list      { start, end }      -> { meals }     saved food-photo log
 *   nutrition.receipts.list   { start, end }      -> { receipts }  bank food purchases + scans
 *   nutrition.glucose.closest { start, end, at }  -> { reading }   owner-reported glucose
 *   nutrition.targets.get     {}                  -> { calorieTarget, tdee } (null = unset)
 * Quick-logged meals, exercise and target edits stay in this browser (the library
 * gates writes behind owner approval). Open item cupcake-steps-source: there is no step
 * source yet, so the live adapter reports no steps. Only `kind: "prepared"`
 * receipts with item calories add to calories eaten on the Today curve.
 * `createSampleNutritionAdapter` is used only when the Gateway does not advertise
 * the nutrition methods; everything it returns is fabricated and labeled
 * "Sample data" in the UI (`adapter.kind === "sample"`).
 */

export type MealEntry = {
  id: string;
  name: string;
  /** Kilocalories. */
  calories: number;
  /** Epoch milliseconds when the meal was eaten (not when it was logged). */
  eatenAt: number;
  sugarGrams?: number;
  /** Some item had no resolved nutrition, so `calories` is a floor. */
  partial?: boolean;
  source: "sample" | "quick-log" | "receipt" | "chat" | "photo-log" | "bank-estimate";
  /** Estimate note for a non-photo meal (e.g. the bank charge it was reconstructed from). */
  note?: string;
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
  /**
   * "prepared" = ready-to-eat (café, takeout): counts as eaten at purchase
   * time on the Today curve. "grocery" (default) is pantry stock and does not.
   */
  kind?: "grocery" | "prepared";
  currency: string;
  total: number;
  items: ReceiptItem[];
  /** Where a live receipt came from; absent for sample receipts. */
  source?: "bank-alert" | "bank-posted" | "scanned";
  /** "date" = only the posting date is known (placed at local noon). */
  timeBasis?: "exact" | "date";
};

export type TimeRange = { start: number; end: number };

export type ExerciseEntry = {
  id: string;
  /** What Matt said or typed, verbatim. */
  description: string;
  /** Net kilocalories above resting (the baseline TDEE burn covers resting). */
  kcal: number;
  /** Minutes of work; the burn is spread over [performedAt − minutes, performedAt]. */
  minutes: number;
  /** Epoch milliseconds when the exercise finished. */
  performedAt: number;
  estimator: "local-met" | "model";
  source: "quick-log";
};

export type ExerciseLogInput = Omit<ExerciseEntry, "id" | "source" | "performedAt"> & {
  performedAt?: number;
};

/** Step count recorded inside [start, end). */
export type StepBucket = { start: number; end: number; steps: number };

export interface NutritionAdapter {
  /**
   * "sample" adapters must be labeled as sample data wherever they render;
   * "offline" means the Gateway is not connected yet and nothing is shown.
   */
  readonly kind: "sample" | "live" | "offline";
  /** Live only: the latest upstream failure, shown instead of inventing data. */
  readonly problem?: string | null;
  listMeals(range: TimeRange): Promise<MealEntry[]>;
  logMeal(input: QuickLogInput): Promise<MealEntry>;
  getTargets(): Promise<NutritionTargets>;
  setTargets(patch: Partial<NutritionTargets>): Promise<NutritionTargets>;
  /** The reading closest to 6:00 pm local on `day`, or null when none exists yet. */
  getSixPmGlucose(day: Date): Promise<GlucoseReading | null>;
  listReceipts(range: TimeRange): Promise<Receipt[]>;
  listExercises(range: TimeRange): Promise<ExerciseEntry[]>;
  logExercise(input: ExerciseLogInput): Promise<ExerciseEntry>;
  /** Undo: resolves true when the entry existed and was removed. */
  deleteExercise(id: string): Promise<boolean>;
  listSteps(range: TimeRange): Promise<StepBucket[]>;
}

export const DEFAULT_TDEE_KCAL = 2200;
export const DEFAULT_CALORIE_TARGET_KCAL = 1800;

const SAMPLE_STORAGE_KEY = "openclaw.control.cupcake.sampleNutrition.v1";

type SampleState = {
  meals: MealEntry[];
  exercises?: ExerciseEntry[];
  targets?: Partial<NutritionTargets>;
};

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

/**
 * Fabricated hourly step counts for one local day, cut off at `now` (the
 * current hour is prorated). Roughly 6–9k steps across 07:00–22:00.
 */
export function sampleStepsForDay(dayStart: number, now: number): StepBucket[] {
  const key = dayKey(dayStart);
  const buckets: StepBucket[] = [];
  for (let hour = 7; hour < 22; hour += 1) {
    const start = new Date(dayStart);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(dayStart);
    end.setHours(hour + 1, 0, 0, 0);
    if (start.getTime() >= now) {
      break;
    }
    // Busier around the commute, lunch and an evening walk.
    const shape = hour === 8 || hour === 12 || hour === 18 ? 1100 : 380;
    const full = Math.round(shape * (0.6 + seeded(key * 31 + hour) * 0.8));
    const share = Math.min(1, (now - start.getTime()) / (end.getTime() - start.getTime()));
    buckets.push({ start: start.getTime(), end: end.getTime(), steps: Math.round(full * share) });
  }
  return buckets;
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
    const exercises = Array.isArray(parsed.exercises)
      ? parsed.exercises.filter(
          (entry): entry is ExerciseEntry =>
            typeof entry?.id === "string" &&
            typeof entry.description === "string" &&
            Number.isFinite(entry.kcal) &&
            Number.isFinite(entry.minutes) &&
            Number.isFinite(entry.performedAt),
        )
      : [];
    return { meals, exercises, targets: parsed.targets };
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
      // One ready-to-eat café purchase this morning, so the Today curve shows
      // how a purchase lands. Grocery receipts below are pantry stock.
      const today = startOfLocalDay(current);
      const cafeAt = today + 10 * 3_600_000 + Math.round(seeded(dayKey(today) * 3) * 40) * 60_000;
      if (cafeAt >= range.start && cafeAt < range.end && cafeAt <= current) {
        receipts.push({
          id: `sample-cafe-${dayKey(today)}`,
          merchant: "Blue Bottle Coffee",
          purchasedAt: cafeAt,
          kind: "prepared",
          currency: "USD",
          total: 6.25,
          items: [{ name: "Oat milk latte", price: 6.25, calories: 190 }],
        });
      }
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
          kind: merchants[index % merchants.length] === "Sweetgreen" ? "prepared" : "grocery",
          currency: "USD",
          total: Math.round(items.reduce((sum, item) => sum + item.price, 0) * 100) / 100,
          items,
        });
      }
      return receipts.toSorted((a, b) => b.purchasedAt - a.purchasedAt);
    },
    async listExercises(range) {
      return (readState(storage).exercises ?? [])
        .filter((entry) => entry.performedAt >= range.start && entry.performedAt < range.end)
        .toSorted((a, b) => a.performedAt - b.performedAt);
    },
    async logExercise(input) {
      const state = readState(storage);
      const exercises = state.exercises ?? [];
      const entry: ExerciseEntry = {
        id: `exercise-${now()}-${exercises.length}`,
        description: input.description.trim(),
        kcal: Math.max(0, Math.round(input.kcal)),
        minutes: Math.max(0, input.minutes),
        performedAt: input.performedAt ?? now(),
        estimator: input.estimator,
        source: "quick-log",
      };
      writeState(storage, { ...state, exercises: [...exercises, entry] });
      return entry;
    },
    async deleteExercise(id) {
      const state = readState(storage);
      const exercises = state.exercises ?? [];
      const next = exercises.filter((entry) => entry.id !== id);
      if (next.length === exercises.length) {
        return false;
      }
      writeState(storage, { ...state, exercises: next });
      return true;
    },
    async listSteps(range) {
      const current = now();
      const buckets: StepBucket[] = [];
      for (
        let day = startOfLocalDay(range.start);
        day < range.end && day <= current;
        day = startOfLocalDay(day + 36 * 3_600_000)
      ) {
        buckets.push(...sampleStepsForDay(day, current));
      }
      return buckets.filter((bucket) => bucket.start >= range.start && bucket.start < range.end);
    },
  };
}
