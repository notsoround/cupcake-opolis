/**
 * Gateway-backed nutrition adapter. Reads Matt's real data through the read-only
 * `nutrition.*` methods of the cupcake-nutrition plugin; browser-local entries
 * (quick-logged meals, exercise, target edits) come from `local`.
 *
 * Upstream failures never fall back to fabricated data: the call resolves empty
 * (or with local targets) and `problem` names what could not be reached.
 */
import type {
  GlucoseReading,
  MealEntry,
  NutritionAdapter,
  NutritionTargets,
  Receipt,
  TimeRange,
} from "./nutrition-adapter.ts";

export const NUTRITION_MEALS_METHOD = "nutrition.meals.list";

export type NutritionRequest = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function toMeal(value: unknown): MealEntry | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") {
    return null;
  }
  if (!finite(value.calories) || !finite(value.eatenAt)) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    calories: Math.max(0, value.calories),
    eatenAt: value.eatenAt,
    ...(finite(value.sugarGrams) ? { sugarGrams: value.sugarGrams } : {}),
    ...(value.partial === true ? { partial: true } : {}),
    ...(value.source === "bank-estimate"
      ? {
          source: "bank-estimate" as const,
          ...(typeof value.note === "string" && value.note ? { note: value.note } : {}),
        }
      : { source: "photo-log" as const }),
  };
}

const RECEIPT_SOURCES = new Set(["bank-alert", "bank-posted", "scanned"]);

function toReceipt(value: unknown): Receipt | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.merchant !== "string") {
    return null;
  }
  if (!finite(value.purchasedAt) || !finite(value.total)) {
    return null;
  }
  const items = Array.isArray(value.items)
    ? value.items.filter(isRecord).flatMap((item) =>
        typeof item.name === "string" && finite(item.price)
          ? [
              {
                name: item.name,
                price: item.price,
                ...(finite(item.calories) ? { calories: item.calories } : {}),
              },
            ]
          : [],
      )
    : [];
  return {
    id: value.id,
    merchant: value.merchant,
    purchasedAt: value.purchasedAt,
    kind: value.kind === "prepared" ? "prepared" : "grocery",
    currency:
      typeof value.currency === "string" && /^[A-Z]{3}$/.test(value.currency)
        ? value.currency
        : "USD",
    total: value.total,
    items,
    ...(typeof value.source === "string" && RECEIPT_SOURCES.has(value.source)
      ? { source: value.source as Receipt["source"] }
      : {}),
    ...(value.timeBasis === "date" || value.timeBasis === "exact"
      ? { timeBasis: value.timeBasis }
      : {}),
  };
}

function toGlucose(value: unknown): GlucoseReading | null {
  return isRecord(value) && finite(value.value) && finite(value.takenAt)
    ? { value: value.value, unit: "mg/dL", takenAt: value.takenAt }
    : null;
}

function message(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "unavailable";
}

export function createLiveNutritionAdapter(options: {
  request: NutritionRequest;
  /** Browser-local store for quick logs, exercise and target edits. */
  local: NutritionAdapter;
}): NutritionAdapter {
  const { request, local } = options;
  const problems = new Map<string, string>();

  async function read<T>(
    area: string,
    method: string,
    params: Record<string, unknown>,
    parse: (payload: Record<string, unknown>) => T,
    fallback: T,
  ): Promise<T> {
    try {
      const payload = await request(method, params);
      if (!isRecord(payload)) {
        throw new Error("unexpected response");
      }
      if (typeof payload.error === "string" && payload.stale === true) {
        problems.set(area, `${area}: showing the last good copy (${payload.error})`);
      } else {
        problems.delete(area);
      }
      return parse(payload);
    } catch (error) {
      problems.set(area, `${area}: ${message(error)}`);
      return fallback;
    }
  }

  const range = (r: TimeRange) => ({ start: r.start, end: r.end });

  return {
    kind: "live",
    get problem() {
      return problems.size > 0 ? [...problems.values()].join(" · ") : null;
    },
    async listMeals(r) {
      const [remote, mine] = await Promise.all([
        read(
          "meals",
          NUTRITION_MEALS_METHOD,
          range(r),
          (payload) =>
            (Array.isArray(payload.meals) ? payload.meals : [])
              .map(toMeal)
              .filter((meal): meal is MealEntry => meal !== null),
          [] as MealEntry[],
        ),
        local.listMeals(r),
      ]);
      return [...remote, ...mine.filter((meal) => meal.source === "quick-log")]
        .filter((meal) => meal.eatenAt >= r.start && meal.eatenAt < r.end)
        .toSorted((a, b) => a.eatenAt - b.eatenAt);
    },
    logMeal: (input) => local.logMeal(input),
    async getTargets() {
      const mine = await local.getTargets();
      const remote = await read(
        "targets",
        "nutrition.targets.get",
        {},
        (payload) => ({
          calorieTarget:
            finite(payload.calorieTarget) && payload.calorieTarget > 0
              ? payload.calorieTarget
              : null,
          tdee: finite(payload.tdee) && payload.tdee > 0 ? payload.tdee : null,
        }),
        { calorieTarget: null, tdee: null } as {
          calorieTarget: number | null;
          tdee: number | null;
        },
      );
      // Owner-saved library settings win; otherwise this browser's targets or defaults.
      return {
        calorieTarget: remote.calorieTarget ?? mine.calorieTarget,
        tdee: remote.tdee ?? mine.tdee,
      } satisfies NutritionTargets;
    },
    setTargets: (patch) => local.setTargets(patch),
    async getSixPmGlucose(day) {
      const start = new Date(day);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const sixPm = new Date(start);
      sixPm.setHours(18, 0, 0, 0);
      return read(
        "glucose",
        "nutrition.glucose.closest",
        { start: start.getTime(), end: end.getTime(), at: sixPm.getTime() },
        (payload) => toGlucose(payload.reading),
        null,
      );
    },
    listReceipts: (r) =>
      read(
        "purchases",
        "nutrition.receipts.list",
        range(r),
        (payload) =>
          (Array.isArray(payload.receipts) ? payload.receipts : [])
            .map(toReceipt)
            .filter((receipt): receipt is Receipt => receipt !== null)
            .toSorted((a, b) => b.purchasedAt - a.purchasedAt),
        [] as Receipt[],
      ),
    listExercises: (r) => local.listExercises(r),
    logExercise: (input) => local.logExercise(input),
    deleteExercise: (id) => local.deleteExercise(id),
    // No real step feed exists yet (cupcake-steps-source); report none rather than invent steps.
    listSteps: async () => [],
  };
}

/** Gateway not connected yet: show nothing rather than fabricated numbers. */
export function createOfflineNutritionAdapter(local: NutritionAdapter): NutritionAdapter {
  return {
    kind: "offline",
    problem: null,
    listMeals: async (r) =>
      (await local.listMeals(r)).filter((meal) => meal.source === "quick-log"),
    logMeal: (input) => local.logMeal(input),
    getTargets: () => local.getTargets(),
    setTargets: (patch) => local.setTargets(patch),
    getSixPmGlucose: async () => null,
    listReceipts: async () => [],
    listExercises: (r) => local.listExercises(r),
    logExercise: (input) => local.logExercise(input),
    deleteExercise: (id) => local.deleteExercise(id),
    listSteps: async () => [],
  };
}
