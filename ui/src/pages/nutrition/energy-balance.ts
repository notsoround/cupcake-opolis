/**
 * Live energy-balance estimate for the Today screen. Pure, no I/O.
 *
 * Basis (shown to the user verbatim via cupcake.today.balanceBasis):
 *   burnedSoFar   = TDEE × (time elapsed since local midnight ÷ length of today)
 *   consumedSoFar = Σ calories of meals whose eatenAt is in [midnight, now]
 *   balance       = consumedSoFar − burnedSoFar   (negative = deficit)
 *
 * Expenditure is prorated linearly across the whole local day (BMR dominates
 * TDEE and runs through sleep), and meals count at the moment they were eaten,
 * not when they were logged. The day length comes from the actual local
 * midnights, so 23h/25h DST days stay exact. This replaces the
 * nutritionModel.ts estimated comparisons, which are not in this repository.
 */
import type { MealEntry } from "./nutrition-adapter.ts";

export type EnergyBalance = {
  dayStart: number;
  dayEnd: number;
  /** 0..1 share of the local day that has elapsed at `now`. */
  elapsedFraction: number;
  tdee: number;
  burnedSoFar: number;
  consumedSoFar: number;
  /** consumedSoFar − burnedSoFar. Negative values are a deficit. */
  balance: number;
};

export function localDayBounds(now: number): { dayStart: number; dayEnd: number } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { dayStart: start.getTime(), dayEnd: end.getTime() };
}

export function estimateEnergyBalance(params: {
  meals: readonly Pick<MealEntry, "calories" | "eatenAt">[];
  now: number;
  tdee: number;
}): EnergyBalance {
  const { dayStart, dayEnd } = localDayBounds(params.now);
  const elapsedFraction = Math.min(1, Math.max(0, (params.now - dayStart) / (dayEnd - dayStart)));
  const tdee = Number.isFinite(params.tdee) && params.tdee > 0 ? params.tdee : 0;
  const burnedSoFar = tdee * elapsedFraction;
  const consumedSoFar = params.meals.reduce(
    (sum, meal) =>
      meal.eatenAt >= dayStart && meal.eatenAt <= params.now && Number.isFinite(meal.calories)
        ? sum + Math.max(0, meal.calories)
        : sum,
    0,
  );
  return {
    dayStart,
    dayEnd,
    elapsedFraction,
    tdee,
    burnedSoFar,
    consumedSoFar,
    balance: consumedSoFar - burnedSoFar,
  };
}

/** Latest meal eaten at or before `now`. */
export function lastMealBefore<T extends Pick<MealEntry, "eatenAt">>(
  meals: readonly T[],
  now: number,
): T | null {
  let latest: T | null = null;
  for (const meal of meals) {
    if (meal.eatenAt <= now && (!latest || meal.eatenAt > latest.eatenAt)) {
      latest = meal;
    }
  }
  return latest;
}

/** Compact elapsed duration: "45m", "2h 05m", "1d 3h". Null below one minute. */
export function formatElapsed(ms: number): string | null {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) {
    return null;
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  }
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export type CalendarView = "day" | "week" | "month" | "year";

export type CalendarBucket = { start: number; end: number; calories: number; meals: number };

/** Range covered by a calendar view around `anchor` (weeks start Monday). */
export function calendarRange(view: CalendarView, anchor: number): { start: number; end: number } {
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  if (view === "day") {
    end.setDate(end.getDate() + 1);
  } else if (view === "week") {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 7);
  } else if (view === "month") {
    start.setDate(1);
    end.setTime(start.getTime());
    end.setMonth(end.getMonth() + 1);
  } else {
    start.setMonth(0, 1);
    end.setTime(start.getTime());
    end.setFullYear(end.getFullYear() + 1);
  }
  return { start: start.getTime(), end: end.getTime() };
}

/** Move the anchor one view-step backward (-1) or forward (+1). */
export function shiftCalendarAnchor(view: CalendarView, anchor: number, step: -1 | 1): number {
  const date = new Date(anchor);
  if (view === "day") {
    date.setDate(date.getDate() + step);
  } else if (view === "week") {
    date.setDate(date.getDate() + 7 * step);
  } else if (view === "month") {
    date.setDate(1);
    date.setMonth(date.getMonth() + step);
  } else {
    date.setMonth(0, 1);
    date.setFullYear(date.getFullYear() + step);
  }
  return date.getTime();
}

/**
 * Buckets for a view: day → one per meal hour slot is not useful, so day
 * returns a single bucket; week/month → one per day; year → one per month.
 */
export function bucketMeals(
  meals: readonly Pick<MealEntry, "calories" | "eatenAt">[],
  view: CalendarView,
  anchor: number,
): CalendarBucket[] {
  const range = calendarRange(view, anchor);
  const buckets: CalendarBucket[] = [];
  const cursor = new Date(range.start);
  while (cursor.getTime() < range.end) {
    const start = cursor.getTime();
    if (view === "year") {
      cursor.setMonth(cursor.getMonth() + 1);
    } else if (view === "day") {
      cursor.setTime(range.end);
    } else {
      cursor.setDate(cursor.getDate() + 1);
    }
    buckets.push({ start, end: cursor.getTime(), calories: 0, meals: 0 });
  }
  for (const meal of meals) {
    const bucket = buckets.find((entry) => meal.eatenAt >= entry.start && meal.eatenAt < entry.end);
    if (bucket) {
      bucket.calories += Math.max(0, meal.calories);
      bucket.meals += 1;
    }
  }
  return buckets;
}
