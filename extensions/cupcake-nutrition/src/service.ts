/**
 * Read-only nutrition service behind the `nutrition.*` Gateway methods. Results are
 * cached briefly per upstream query; when an upstream fails after a success, the last
 * good value is served and marked `stale` rather than inventing data.
 */
import type { NutritionSettings } from "./config.js";
import {
  ALERT_WINDOW_MS,
  fetchBankAlerts,
  fetchGlucose,
  fetchLibraryMeals,
  fetchOutcomes,
  fetchPostedPurchases,
  fetchScannedReceipts,
  fetchTargets,
  SourceUnavailableError,
  type FetchLike,
  type Upstream,
  type WireGlucose,
  type WireMeal,
  type WireOutcome,
  type WireOutcomeCounts,
  type WireReceipt,
  type WireTargets,
} from "./sources.js";

const DAY_MS = 86_400_000;
const MAX_RANGE_MS = 400 * DAY_MS;

export const MEALS_COVERAGE =
  "Saved food photos only. Meals not photographed or logged elsewhere are missing; unknown eaten times are excluded.";
export const RECEIPTS_COVERAGE =
  "Food & drink bank purchase alerts (last 7 days, swipe time), posted Plaid history before that (posting date only), and scanned receipts. Purchases carry no calories.";

export const OUTCOMES_COVERAGE =
  "Wins and losses you explicitly asked Cupcake to record (phone, voice or chat). Owner-reported, not independently verified; silence never adds a loss.";

/** America/Chicago calendar day (YYYY-MM-DD) containing `ms`. */
export function chicagoDate(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export type TimeRange = { start: number; end: number };

export class InvalidParamsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidParamsError";
  }
}

export function parseRange(params: unknown): TimeRange {
  const p = (params ?? {}) as Record<string, unknown>;
  const start = p.start;
  const end = p.end;
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start > MAX_RANGE_MS
  ) {
    throw new InvalidParamsError(
      "start and end must be epoch milliseconds, end > start, ≤ 400 days",
    );
  }
  return { start, end };
}

type CacheEntry<T> = { at: number; value: T };

export type NutritionServiceOptions = {
  settings: NutritionSettings;
  fetchImpl?: FetchLike;
  now?: () => number;
};

export type SourceNote = { stale?: boolean; error?: string };

export function createNutritionService(options: NutritionServiceOptions) {
  const { settings } = options;
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const now = options.now ?? (() => Date.now());
  const library: Upstream = {
    url: settings.library.url,
    headerName: "X-Cupcake-Key",
    key: settings.library.key,
    label: "cupcake library",
  };
  const brain: Upstream = {
    url: settings.brain.url,
    headerName: "X-Cupcake-Brain-Key",
    key: settings.brain.key,
    label: "cupcake brain",
  };
  const cache = new Map<string, CacheEntry<unknown>>();
  const inflight = new Map<string, Promise<unknown>>();

  /** Fresh cached value, a deduplicated in-flight load, or last good value on failure. */
  async function cached<T>(
    key: string,
    load: () => Promise<T>,
  ): Promise<{ value: T } & SourceNote> {
    const hit = cache.get(key) as CacheEntry<T> | undefined;
    if (hit && now() - hit.at < settings.cacheTtlMs) {
      return { value: hit.value };
    }
    let pending = inflight.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = load();
      inflight.set(key, pending);
    }
    try {
      const value = await pending;
      cache.set(key, { at: now(), value });
      if (cache.size > 64) {
        cache.delete(cache.keys().next().value as string);
      }
      return { value };
    } catch (error) {
      if (hit) {
        return { value: hit.value, stale: true, error: describe(error) };
      }
      throw error;
    } finally {
      inflight.delete(key);
    }
  }

  // Meals: one cached history read covering the oldest requested start (bucketed per hour).
  async function allMealsSince(since: number) {
    const bucket = Math.floor(since / 3_600_000) * 3_600_000;
    return cached(`meals:${bucket}`, () =>
      fetchLibraryMeals(fetchImpl, library, bucket, settings.timeoutMs),
    );
  }

  return {
    async listMeals(
      range: TimeRange,
    ): Promise<{ meals: WireMeal[]; coverageNote: string } & SourceNote> {
      const { value, ...note } = await allMealsSince(range.start);
      const meals = value
        .filter((meal) => meal.eatenAt >= range.start && meal.eatenAt < range.end)
        .toSorted((a, b) => a.eatenAt - b.eatenAt);
      return { meals, coverageNote: MEALS_COVERAGE, ...note };
    },

    async listReceipts(range: TimeRange): Promise<{
      receipts: WireReceipt[];
      coverageNote: string;
      sources: Record<string, SourceNote | "ok">;
    }> {
      const current = now();
      const alertFloor = current - ALERT_WINDOW_MS;
      const sources: Record<string, SourceNote | "ok"> = {};
      const receipts: WireReceipt[] = [];
      const jobs: Promise<void>[] = [];
      const run = (name: string, job: () => Promise<{ value: WireReceipt[] } & SourceNote>) =>
        jobs.push(
          job().then(
            ({ value, ...note }) => {
              receipts.push(...value);
              sources[name] = note.stale ? note : "ok";
            },
            (error: unknown) => {
              sources[name] = { error: describe(error) };
            },
          ),
        );
      if (range.end > alertFloor) {
        const hours = Math.ceil((current - Math.max(range.start, alertFloor)) / 3_600_000);
        const bucket = Math.min(168, Math.max(24, hours <= 24 ? 24 : 168));
        run("bankAlerts", () =>
          cached(`alerts:${bucket}`, () =>
            fetchBankAlerts(fetchImpl, brain, bucket, settings.timeoutMs),
          ),
        );
      }
      if (range.start < alertFloor) {
        const days = Math.min(90, Math.ceil((current - range.start) / DAY_MS));
        const bucket = days <= 30 ? 30 : 90;
        run("bankPosted", () =>
          cached(`posted:${bucket}`, () =>
            fetchPostedPurchases(fetchImpl, brain, bucket, settings.timeoutMs),
          ).then(({ value, ...note }) => ({
            // Alerts own the last 7 days; posted rows before that avoid double listing.
            value: value.filter((r) => r.purchasedAt < alertFloor),
            ...note,
          })),
        );
      }
      run("scanned", () =>
        cached("scanned", () => fetchScannedReceipts(fetchImpl, library, settings.timeoutMs)),
      );
      await Promise.all(jobs);
      if (Object.values(sources).every((s) => s !== "ok" && !s.stale)) {
        throw new SourceUnavailableError(
          `no purchase source reachable (${Object.values(sources)
            .map((s) => (s === "ok" ? "ok" : s.error))
            .join("; ")})`,
        );
      }
      return {
        receipts: receipts
          .filter((r) => r.purchasedAt >= range.start && r.purchasedAt < range.end)
          .toSorted((a, b) => b.purchasedAt - a.purchasedAt),
        coverageNote: RECEIPTS_COVERAGE,
        sources,
      };
    },

    /** The owner-reported reading closest to `at` inside [start, end), or null. */
    async closestGlucose(
      range: TimeRange,
      at: number,
    ): Promise<{ reading: WireGlucose | null } & SourceNote> {
      const { value, ...note } = await cached(`glucose:${range.start}:${range.end}`, () =>
        fetchGlucose(fetchImpl, library, range.start, range.end, settings.timeoutMs),
      );
      const reading =
        value.toSorted((a, b) => Math.abs(a.takenAt - at) - Math.abs(b.takenAt - at))[0] ?? null;
      return { reading, ...note };
    },

    /** Owner-reported wins / losses on the Chicago calendar days intersecting [start, end). */
    async listOutcomes(
      range: TimeRange,
    ): Promise<
      { entries: WireOutcome[]; counts: WireOutcomeCounts; coverageNote: string } & SourceNote
    > {
      const startDate = chicagoDate(range.start);
      const endDate = chicagoDate(range.end - 1);
      const { value, ...note } = await cached(`outcomes:${startDate}:${endDate}`, () =>
        fetchOutcomes(fetchImpl, library, startDate, endDate, settings.timeoutMs),
      );
      return { ...value, coverageNote: OUTCOMES_COVERAGE, ...note };
    },

    async getTargets(): Promise<WireTargets & SourceNote> {
      const { value, ...note } = await cached("targets", () =>
        fetchTargets(fetchImpl, library, settings.timeoutMs),
      );
      return { ...value, ...note };
    },
  };
}

export type NutritionService = ReturnType<typeof createNutritionService>;

function describe(error: unknown): string {
  return error instanceof SourceUnavailableError ? error.message : "upstream failed";
}
