/**
 * Upstream readers. Every call is a fixed URL, fixed method, fixed auth header and a
 * read-only action; responses are parsed defensively and never echoed raw.
 *
 * - Cupcake private library (`cupcake-library.service` on the hales droplet, behind
 *   https://automate.hales.ai/cupcake-library): `food_history` (saved food-photo
 *   log, table `food_meals`), `receipt_list` (scanned receipts), `glucose_manual_list`
 *   (owner-reported glucose) and `food_settings_get` (calorie target / expenditure).
 * - Cupcake brain webhook (n8n `cupcake-brain`): `recent_bank_events` (bank purchase
 *   alerts with swipe-time timestamps) and `lookup_spending` (posted Plaid history).
 *   These are the same read capabilities the cupcake-brain connector's
 *   `recent_bank_events` / `lookup_spending` tools call.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class SourceUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SourceUnavailableError";
  }
}

export type WireMeal = {
  id: string;
  name: string;
  calories: number;
  eatenAt: number;
  sugarGrams?: number;
  proteinGrams?: number;
  carbsGrams?: number;
  fatGrams?: number;
  /** Some item in the meal had no resolved nutrition; calories are a floor. */
  partial: boolean;
  source: "photo-log";
};

export type WireReceipt = {
  id: string;
  merchant: string;
  purchasedAt: number;
  /** "exact" = provider timestamp; "date" = only the posting date is known (placed at noon). */
  timeBasis: "exact" | "date";
  kind: "grocery" | "prepared";
  currency: string;
  total: number;
  category?: string;
  items: { name: string; price: number; calories?: number }[];
  source: "bank-alert" | "bank-posted" | "scanned";
};

export type WireGlucose = { value: number; unit: "mg/dL"; takenAt: number };

export type WireTargets = { calorieTarget: number | null; tdee: number | null };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
}

function str(value: unknown, limit = 200): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : undefined;
}

/** A calendar date with no time of day, placed at local noon (America/Chicago, ±1h DST). */
export function dateAtNoon(date: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return undefined;
  }
  const ms = Date.parse(`${date}T12:00:00-05:00`);
  return Number.isFinite(ms) ? ms : undefined;
}

export type Upstream = {
  url: string;
  headerName: string;
  key?: string;
  label: string;
};

export async function postJson(
  fetchImpl: FetchLike,
  upstream: Upstream,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  if (!upstream.key) {
    throw new SourceUnavailableError(`${upstream.label} key is not configured`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(upstream.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        [upstream.headerName]: upstream.key,
      },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new SourceUnavailableError(`${upstream.label} responded HTTP ${response.status}`);
    }
    const value = (await response.json()) as unknown;
    if (!isRecord(value) || value.ok === false) {
      throw new SourceUnavailableError(`${upstream.label} returned an unexpected response`);
    }
    return value;
  } catch (error) {
    if (error instanceof SourceUnavailableError) {
      throw error;
    }
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new SourceUnavailableError(
      aborted ? `${upstream.label} timed out` : `${upstream.label} is unreachable`,
      { cause: error },
    );
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- library

export function parseLibraryMeal(value: unknown): WireMeal | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = str(value.id, 100);
  const eatenAt = typeof value.consumedAt === "string" ? Date.parse(value.consumedAt) : Number.NaN;
  if (!id || !Number.isFinite(eatenAt)) {
    return undefined;
  }
  const total = isRecord(value.total) ? value.total : {};
  const optional = (key: string) => {
    const n = finiteNumber(total[key]);
    return n === undefined ? undefined : Math.max(0, Math.round(n));
  };
  const meal: WireMeal = {
    id: `photo-${id}`,
    name: str(value.description, 160) ?? "Food photo",
    calories: Math.max(0, Math.round(finiteNumber(total.calories) ?? 0)),
    eatenAt,
    partial: value.totalIsPartial === true || finiteNumber(total.calories) === undefined,
    source: "photo-log",
  };
  const sugar = optional("sugar_g");
  const protein = optional("protein_g");
  const carbs = optional("carbs_g");
  const fat = optional("fat_g");
  if (sugar !== undefined) {
    meal.sugarGrams = sugar;
  }
  if (protein !== undefined) {
    meal.proteinGrams = protein;
  }
  if (carbs !== undefined) {
    meal.carbsGrams = carbs;
  }
  if (fat !== undefined) {
    meal.fatGrams = fat;
  }
  return meal;
}

const HISTORY_MAX_PAGES = 10;

/** Saved food-photo meals eaten at or after `since`, newest first. */
export async function fetchLibraryMeals(
  fetchImpl: FetchLike,
  library: Upstream,
  since: number,
  timeoutMs: number,
): Promise<WireMeal[]> {
  const meals: WireMeal[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < HISTORY_MAX_PAGES; page += 1) {
    const body = await postJson(
      fetchImpl,
      library,
      { action: "food_history", limit: 200, ...(cursor ? { cursor } : {}) },
      timeoutMs,
    );
    if (!Array.isArray(body.meals)) {
      throw new SourceUnavailableError("cupcake library food_history returned an unexpected shape");
    }
    const pageMeals = body.meals.map(parseLibraryMeal).filter((m): m is WireMeal => Boolean(m));
    meals.push(...pageMeals);
    const oldest = pageMeals.at(-1);
    cursor = typeof body.nextCursor === "string" ? body.nextCursor : undefined;
    if (body.hasMore !== true || !cursor || !oldest || oldest.eatenAt < since) {
      break;
    }
  }
  return meals.filter((meal) => meal.eatenAt >= since);
}

export function parseScannedReceipt(value: unknown): WireReceipt | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = str(value.id, 100);
  const total = finiteNumber(value.grandTotal) ?? finiteNumber(value.total);
  const purchasedAt =
    (typeof value.date === "string" ? dateAtNoon(value.date) : undefined) ??
    (typeof value.createdAt === "string" ? Date.parse(value.createdAt) : Number.NaN);
  if (!id || total === undefined || !Number.isFinite(purchasedAt)) {
    return undefined;
  }
  const items = Array.isArray(value.lineItems)
    ? value.lineItems.filter(isRecord).flatMap((item) => {
        const price = finiteNumber(item.amount);
        const name = str(item.description, 120);
        return name && price !== undefined ? [{ name, price }] : [];
      })
    : [];
  return {
    id: `scanned-${id}`,
    merchant: str(value.merchant, 120) ?? "Receipt",
    purchasedAt,
    timeBasis: typeof value.date === "string" ? "date" : "exact",
    kind: "grocery",
    currency: str(value.currency, 8) ?? "USD",
    total: Math.round(total * 100) / 100,
    items,
    source: "scanned",
  };
}

export async function fetchScannedReceipts(
  fetchImpl: FetchLike,
  library: Upstream,
  timeoutMs: number,
): Promise<WireReceipt[]> {
  const body = await postJson(fetchImpl, library, { action: "receipt_list" }, timeoutMs);
  if (!Array.isArray(body.receipts)) {
    throw new SourceUnavailableError("cupcake library receipt_list returned an unexpected shape");
  }
  return body.receipts
    .filter((r) => isRecord(r) && r.status !== "failed")
    .map(parseScannedReceipt)
    .filter((r): r is WireReceipt => Boolean(r));
}

export async function fetchGlucose(
  fetchImpl: FetchLike,
  library: Upstream,
  start: number,
  end: number,
  timeoutMs: number,
): Promise<WireGlucose[]> {
  const body = await postJson(
    fetchImpl,
    library,
    { action: "glucose_manual_list", start: new Date(start).toISOString(), limit: 50 },
    timeoutMs,
  );
  const entries = Array.isArray(body.entries) ? body.entries : [];
  return entries.filter(isRecord).flatMap((entry) => {
    const takenAt =
      typeof entry.observedAt === "string" ? Date.parse(entry.observedAt) : Number.NaN;
    const value = finiteNumber(entry.glucoseMgDl);
    return Number.isFinite(takenAt) && value !== undefined && takenAt >= start && takenAt < end
      ? [{ value: Math.round(value), unit: "mg/dL" as const, takenAt }]
      : [];
  });
}

export async function fetchTargets(
  fetchImpl: FetchLike,
  library: Upstream,
  timeoutMs: number,
): Promise<WireTargets> {
  const body = await postJson(fetchImpl, library, { action: "food_settings_get" }, timeoutMs);
  const settings = isRecord(body.settings) ? body.settings : {};
  const positive = (value: unknown) => {
    const n = finiteNumber(value);
    return n !== undefined && n > 0 ? Math.round(n) : null;
  };
  return {
    calorieTarget: positive(settings.calorieTarget),
    tdee: positive(settings.expenditureEstimate),
  };
}

// ---------------------------------------------------------------- bank

const PREPARED = /fast[- ]?food|restaurant|coffee|caf[eé]|bakery|candy|confection|dessert/i;
const FOOD = /food|grocer|restaurant|coffee|caf[eé]|bakery|candy|confection|dessert/i;

export function parseBankRow(value: unknown, source: "bank-alert" | "bank-posted") {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = str(value.id, 120);
  const amount = finiteNumber(value.amount_usd);
  const exact =
    (typeof value.time === "string" ? Date.parse(value.time) : Number.NaN) ||
    (typeof value.observedAt === "string" ? Date.parse(value.observedAt) : Number.NaN);
  const byDate = typeof value.date === "string" ? dateAtNoon(value.date) : undefined;
  // Posted Plaid rows: the posting date is the purchase day; observedAt is when Plaid saw it.
  const purchasedAt = source === "bank-alert" && Number.isFinite(exact) ? exact : byDate;
  const category = str(value.category, 60) ?? "";
  if (!id || amount === undefined || amount <= 0 || purchasedAt === undefined) {
    return undefined;
  }
  if (!FOOD.test(category)) {
    return undefined;
  }
  const merchant = str(value.merchant, 120) ?? "Unknown merchant";
  const receipt: WireReceipt = {
    id: `${source}-${id}`,
    merchant,
    purchasedAt,
    timeBasis: source === "bank-alert" && Number.isFinite(exact) ? "exact" : "date",
    kind: PREPARED.test(category) || PREPARED.test(merchant) ? "prepared" : "grocery",
    currency: str(value.currency, 8) ?? "USD",
    total: Math.round(amount * 100) / 100,
    category: category.toLowerCase(),
    items: [],
    source,
  };
  return receipt;
}

const BANK_MAX_PAGES = 8;

async function pagedBrain(
  fetchImpl: FetchLike,
  brain: Upstream,
  body: Record<string, unknown>,
  source: "bank-alert" | "bank-posted",
  timeoutMs: number,
): Promise<WireReceipt[]> {
  const out: WireReceipt[] = [];
  let offset = 0;
  for (let page = 0; page < BANK_MAX_PAGES; page += 1) {
    const value = await postJson(fetchImpl, brain, { ...body, limit: 25, offset }, timeoutMs);
    if (!Array.isArray(value.rows)) {
      throw new SourceUnavailableError("cupcake brain returned an unexpected shape");
    }
    for (const row of value.rows) {
      const parsed = parseBankRow(row, source);
      if (parsed) {
        out.push(parsed);
      }
    }
    const next = finiteNumber(value.nextOffset);
    if (next === undefined || next <= offset || value.rows.length === 0) {
      break;
    }
    offset = next;
  }
  return out;
}

export const ALERT_WINDOW_MS = 168 * 3_600_000;

/** Bank purchase alerts (swipe-time) in the trailing `hours` (max 168). */
export function fetchBankAlerts(
  fetchImpl: FetchLike,
  brain: Upstream,
  hours: number,
  timeoutMs: number,
): Promise<WireReceipt[]> {
  return pagedBrain(
    fetchImpl,
    brain,
    { capability: "recent_bank_events", hours: Math.min(168, Math.max(1, Math.ceil(hours))) },
    "bank-alert",
    timeoutMs,
  );
}

/** Posted (Plaid) food & drink history for the trailing `days` (max 90). */
export function fetchPostedPurchases(
  fetchImpl: FetchLike,
  brain: Upstream,
  days: number,
  timeoutMs: number,
): Promise<WireReceipt[]> {
  return pagedBrain(
    fetchImpl,
    brain,
    { capability: "lookup_spending", days: Math.min(90, Math.max(1, Math.ceil(days))) },
    "bank-posted",
    timeoutMs,
  );
}
