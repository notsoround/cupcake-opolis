/**
 * Live metabolic balance series for the Today curve. Pure, no I/O.
 *
 * One line, cumulative from local midnight:
 *   net(t) = eaten(t) + bought(t) − living(t) − steps(t) − exercise(t)
 *
 *   eaten     meals at their eatenAt (rises instantly)
 *   bought    ready-to-eat purchases (`Receipt.kind === "prepared"`) at
 *             purchase time; grocery receipts are pantry stock and excluded
 *   living    TDEE prorated across the real local day (accrues continuously)
 *   steps     only steps beyond STEPS_INCLUDED_IN_TDEE, because a typical
 *             day's walking is already inside TDEE
 *   exercise  logged net burn, spread over the minutes it took
 *
 * Positive net is a surplus, negative a deficit.
 */
import { localDayBounds } from "./energy-balance.ts";
import { DEFAULT_BODY_WEIGHT_KG } from "./exercise-estimate.ts";
import type { ExerciseEntry, MealEntry, Receipt, StepBucket } from "./nutrition-adapter.ts";

/** Steps per day assumed to be part of TDEE already. */
export const STEPS_INCLUDED_IN_TDEE = 5000;
/** Grid resolution: 10-minute samples, 144 per day. */
export const SERIES_INTERVALS_PER_DAY = 144;

/** Net kcal per step above resting, roughly 0.4 kcal per kg per 1,000 steps. */
export function kcalPerStep(weightKg: number): number {
  return (0.4 * weightKg) / 1000;
}

export type BalanceEventKind = "meal" | "purchase" | "exercise";

export type BalanceEvent = {
  id: string;
  kind: BalanceEventKind;
  at: number;
  /** Signed effect on net: positive for intake, negative for burn. */
  kcal: number;
  label: string;
};

export type SeriesSample = { t: number; net: number };

export type MetabolicSeries = {
  dayStart: number;
  dayEnd: number;
  now: number;
  tdee: number;
  /** Grid samples from midnight up to now, ending with an exact `now` sample. */
  samples: SeriesSample[];
  events: BalanceEvent[];
  eaten: number;
  bought: number;
  living: number;
  steps: number;
  stepBurn: number;
  exercise: number;
  net: number;
  /** Net at local midnight if only living burn accrues from now on. */
  projectedEndOfDay: number;
};

export type MetabolicSeriesInput = {
  now: number;
  tdee: number;
  weightKg?: number;
  meals: readonly MealEntry[];
  receipts: readonly Receipt[];
  exercises: readonly ExerciseEntry[];
  steps: readonly StepBucket[];
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function receiptCalories(receipt: Receipt): number {
  return receipt.items.reduce(
    (sum, item) => sum + (Number.isFinite(item.calories) ? Math.max(0, item.calories ?? 0) : 0),
    0,
  );
}

export function buildMetabolicSeries(input: MetabolicSeriesInput): MetabolicSeries {
  const { now } = input;
  const { dayStart, dayEnd } = localDayBounds(now);
  const dayLength = dayEnd - dayStart;
  const tdee = Number.isFinite(input.tdee) && input.tdee > 0 ? input.tdee : 0;
  const weightKg =
    input.weightKg && Number.isFinite(input.weightKg) && input.weightKg > 20
      ? input.weightKg
      : DEFAULT_BODY_WEIGHT_KG;
  const perStep = kcalPerStep(weightKg);
  const inToday = (time: number) => time >= dayStart && time <= now;

  const meals = input.meals.filter(
    (meal) => inToday(meal.eatenAt) && Number.isFinite(meal.calories),
  );
  const purchases = input.receipts
    .filter((receipt) => receipt.kind === "prepared" && inToday(receipt.purchasedAt))
    .map((receipt) => ({ receipt, kcal: receiptCalories(receipt) }))
    .filter((entry) => entry.kcal > 0);
  const exercises = input.exercises.filter(
    (entry) => inToday(entry.performedAt) && Number.isFinite(entry.kcal),
  );
  const stepBuckets = input.steps.filter(
    (bucket) => bucket.start >= dayStart && bucket.start < now && bucket.steps > 0,
  );

  const eatenAt = (t: number) =>
    meals.reduce((sum, meal) => (meal.eatenAt <= t ? sum + Math.max(0, meal.calories) : sum), 0);
  const boughtAt = (t: number) =>
    purchases.reduce((sum, entry) => (entry.receipt.purchasedAt <= t ? sum + entry.kcal : sum), 0);
  const livingAt = (t: number) => tdee * clamp01((t - dayStart) / dayLength);
  const stepsAt = (t: number) =>
    stepBuckets.reduce((sum, bucket) => {
      // A bucket's steps were recorded uniformly over [start, min(end, now)].
      const end = Math.max(bucket.start + 1, Math.min(bucket.end, now));
      return sum + bucket.steps * clamp01((t - bucket.start) / (end - bucket.start));
    }, 0);
  const stepBurnAt = (t: number) => Math.max(0, stepsAt(t) - STEPS_INCLUDED_IN_TDEE) * perStep;
  const exerciseAt = (t: number) =>
    exercises.reduce((sum, entry) => {
      const kcal = Math.max(0, entry.kcal);
      const span = Math.max(0, entry.minutes) * 60_000;
      const share =
        span > 0
          ? clamp01((t - (entry.performedAt - span)) / span)
          : t >= entry.performedAt
            ? 1
            : 0;
      return sum + kcal * share;
    }, 0);
  const netAt = (t: number) =>
    eatenAt(t) + boughtAt(t) - livingAt(t) - stepBurnAt(t) - exerciseAt(t);

  const samples: SeriesSample[] = [];
  const interval = dayLength / SERIES_INTERVALS_PER_DAY;
  for (let index = 0; index <= SERIES_INTERVALS_PER_DAY; index += 1) {
    const t = dayStart + index * interval;
    if (t >= now) {
      break;
    }
    samples.push({ t, net: netAt(t) });
  }
  const clampedNow = Math.min(now, dayEnd);
  samples.push({ t: clampedNow, net: netAt(clampedNow) });

  const events: BalanceEvent[] = [
    ...meals.map((meal) => ({
      id: meal.id,
      kind: "meal" as const,
      at: meal.eatenAt,
      kcal: Math.max(0, meal.calories),
      label: meal.name,
    })),
    ...purchases.map(({ receipt, kcal }) => ({
      id: receipt.id,
      kind: "purchase" as const,
      at: receipt.purchasedAt,
      kcal,
      label: receipt.merchant,
    })),
    ...exercises.map((entry) => ({
      id: entry.id,
      kind: "exercise" as const,
      at: entry.performedAt,
      kcal: -Math.max(0, entry.kcal),
      label: entry.description,
    })),
  ].toSorted((a, b) => a.at - b.at);

  const net = netAt(clampedNow);
  return {
    dayStart,
    dayEnd,
    now: clampedNow,
    tdee,
    samples,
    events,
    eaten: eatenAt(clampedNow),
    bought: boughtAt(clampedNow),
    living: livingAt(clampedNow),
    steps: Math.round(stepsAt(clampedNow)),
    stepBurn: stepBurnAt(clampedNow),
    exercise: exerciseAt(clampedNow),
    net,
    projectedEndOfDay: net - tdee * clamp01((dayEnd - clampedNow) / dayLength),
  };
}

/** Net at time `t`, linearly interpolated between samples (for markers). */
export function sampleNetAt(samples: readonly SeriesSample[], t: number): number {
  if (samples.length === 0) {
    return 0;
  }
  const first = samples[0]!;
  if (t <= first.t) {
    return first.net;
  }
  for (let index = 1; index < samples.length; index += 1) {
    const next = samples[index]!;
    if (t <= next.t) {
      const previous = samples[index - 1]!;
      const span = next.t - previous.t;
      return span > 0
        ? previous.net + ((next.net - previous.net) * (t - previous.t)) / span
        : next.net;
    }
  }
  return samples.at(-1)!.net;
}

export type Point = { x: number; y: number };

const fmt = (value: number) => (Math.round(value * 100) / 100).toString();

/**
 * Smooth SVG path through `points` using monotone cubic (Fritsch–Carlson)
 * tangents: bezier-smooth, but never overshoots between samples, so a meal
 * reads as a rise and never as a dip before it.
 */
export function monotonePath(points: readonly Point[]): string {
  if (points.length === 0) {
    return "";
  }
  const first = points[0]!;
  if (points.length === 1) {
    return `M${fmt(first.x)},${fmt(first.y)}`;
  }
  const count = points.length;
  const slopes: number[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    const a = points[index]!;
    const b = points[index + 1]!;
    const dx = b.x - a.x;
    slopes.push(dx === 0 ? 0 : (b.y - a.y) / dx);
  }
  const tangents: number[] = [slopes[0]!];
  for (let index = 1; index < count - 1; index += 1) {
    const left = slopes[index - 1]!;
    const right = slopes[index]!;
    // Harmonic mean of neighbouring slopes; flat at local extrema.
    tangents.push(left * right <= 0 ? 0 : (2 * left * right) / (left + right));
  }
  tangents.push(slopes[count - 2]!);
  let path = `M${fmt(first.x)},${fmt(first.y)}`;
  for (let index = 0; index < count - 1; index += 1) {
    const a = points[index]!;
    const b = points[index + 1]!;
    const third = (b.x - a.x) / 3;
    path += `C${fmt(a.x + third)},${fmt(a.y + tangents[index]! * third)} ${fmt(b.x - third)},${fmt(
      b.y - tangents[index + 1]! * third,
    )} ${fmt(b.x)},${fmt(b.y)}`;
  }
  return path;
}
