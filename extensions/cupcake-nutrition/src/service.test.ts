import { describe, expect, it, vi } from "vitest";
import type { NutritionSettings } from "./config.js";
import { resolveNutritionSettings } from "./config.js";
import { createNutritionService, InvalidParamsError, parseRange } from "./service.js";
import { parseBankRow, parseLibraryMeal } from "./sources.js";

const NOW = Date.parse("2026-10-18T05:30:00Z");

const settings: NutritionSettings = {
  library: { url: "https://library.test/cupcake-library", key: "library-key-for-tests-0000000000" },
  brain: {
    url: "https://brain.test/webhook/cupcake-brain",
    key: "brain-key-for-tests-000000000000",
  },
  timeoutMs: 1000,
  cacheTtlMs: 60_000,
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fakeUpstreams(overrides: Partial<Record<string, () => Response>> = {}) {
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] =
    [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
      string,
      unknown
    >;
    calls.push({ url, body, headers: init?.headers as Record<string, string> });
    const name = String(body.action ?? body.capability);
    const override = overrides[name];
    if (override) {
      return override();
    }
    switch (name) {
      case "food_history":
        return json({
          ok: true,
          hasMore: false,
          meals: [
            {
              id: "m2",
              description: "Bulk candy",
              consumedAt: "2026-10-17T22:41:56.838000+00:00",
              total: { calories: 1560, sugar_g: 200, protein_g: 10 },
              totalIsPartial: false,
            },
            {
              id: "m1",
              description: "Oatmeal",
              consumedAt: "2026-10-17T15:23:26+00:00",
              total: { calories: 300 },
            },
            { id: "bad", consumedAt: "not a date", total: {} },
          ],
        });
      case "recent_bank_events":
        return json({
          ok: true,
          nextOffset: null,
          rows: [
            {
              id: "a1",
              date: "2026-10-17",
              time: "2026-10-18T02:54:31.000Z",
              merchant: "Taco Spot",
              amount_usd: 12.5,
              currency: "USD",
              category: "fast-food",
            },
            {
              id: "a2",
              date: "2026-10-17",
              time: "2026-10-17T20:00:00Z",
              merchant: "Gas",
              amount_usd: 40,
              category: "transfer",
            },
          ],
        });
      case "lookup_spending":
        return json({
          ok: true,
          nextOffset: null,
          rows: [
            {
              id: "p1",
              date: "2026-09-30",
              merchant: "Grocer",
              amount_usd: 55,
              category: "FOOD AND DRINK",
            },
            {
              id: "p2",
              date: "2026-10-16",
              merchant: "Recent",
              amount_usd: 9,
              category: "FOOD AND DRINK",
            },
          ],
        });
      case "receipt_list":
        return json({
          ok: true,
          receipts: [
            {
              id: "r1",
              status: "extracted",
              merchant: "Market",
              date: "2026-10-16",
              total: 20.25,
              currency: null,
              lineItems: [{ description: "Apples", quantity: 1, amount: 4.5 }],
            },
          ],
        });
      case "glucose_manual_list":
        return json({
          ok: true,
          entries: [
            { observedAt: "2026-10-17T23:10:00Z", glucoseMgDl: 132 },
            { observedAt: "2026-10-17T14:00:00Z", glucoseMgDl: 98 },
          ],
        });
      case "food_settings_get":
        return json({ ok: true, settings: { calorieTarget: null, expenditureEstimate: 2400 } });
      case "outcome_list":
        return json({
          ok: true,
          entries: [
            {
              id: "o1",
              date: "2026-10-11",
              title: "Went for a walk",
              outcome: "win",
              note: "Walk.",
            },
            { id: "o2", date: "2026-10-17", title: "Bought it anyway", outcome: "loss", note: "" },
            { id: "bad", date: "17/10/2026", outcome: "win" },
          ],
          counts: { wins: 1, losses: 1, unscored: 0, total: 2 },
          nextCursor: null,
        });
      default:
        return json({ ok: false }, 400);
    }
  });
  return { fetchImpl, calls };
}

describe("cupcake-nutrition service", () => {
  it("lists real photo-log meals in range, sorted, with the owner key header", async () => {
    const { fetchImpl, calls } = fakeUpstreams();
    const service = createNutritionService({ settings, fetchImpl, now: () => NOW });
    const day = {
      start: Date.parse("2026-10-17T05:00:00Z"),
      end: Date.parse("2026-10-18T05:00:00Z"),
    };
    const result = await service.listMeals(day);
    expect(result.meals.map((m) => [m.name, m.calories, m.source])).toEqual([
      ["Oatmeal", 300, "photo-log"],
      ["Bulk candy", 1560, "photo-log"],
    ]);
    expect(result.meals[1]).toMatchObject({ sugarGrams: 200, partial: false });
    expect(calls[0]?.headers["X-Cupcake-Key"]).toBe(settings.library.key);
    // Cached: a second read in the TTL does not refetch.
    await service.listMeals(day);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("serves the last good meals marked stale when the library later fails", async () => {
    let fail = false;
    let clock = NOW;
    const ok = fakeUpstreams();
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) =>
      fail ? json({}, 502) : ok.fetchImpl(url, init),
    );
    const service = createNutritionService({ settings, fetchImpl, now: () => clock });
    const range = { start: NOW - 86_400_000, end: NOW };
    await service.listMeals(range);
    fail = true;
    clock += 120_000;
    const result = await service.listMeals(range);
    expect(result.stale).toBe(true);
    expect(result.meals).toHaveLength(2);
  });

  it("throws when the library has never answered", async () => {
    const fetchImpl = vi.fn(async () => json({}, 503));
    const service = createNutritionService({ settings, fetchImpl, now: () => NOW });
    await expect(service.listMeals({ start: NOW - 1000, end: NOW })).rejects.toThrow(/HTTP 503/);
  });

  it("refuses to call upstreams without a key", async () => {
    const fetchImpl = vi.fn();
    const service = createNutritionService({
      settings: { ...settings, library: { url: settings.library.url } },
      fetchImpl,
      now: () => NOW,
    });
    await expect(service.listMeals({ start: NOW - 1000, end: NOW })).rejects.toThrow(
      /not configured/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("merges food bank alerts, older posted purchases and scanned receipts", async () => {
    const { fetchImpl } = fakeUpstreams();
    const service = createNutritionService({ settings, fetchImpl, now: () => NOW });
    const result = await service.listReceipts({ start: NOW - 30 * 86_400_000, end: NOW + 1 });
    expect(result.receipts.map((r) => [r.source, r.merchant, r.kind])).toEqual([
      ["bank-alert", "Taco Spot", "prepared"],
      ["scanned", "Market", "grocery"],
      ["bank-posted", "Grocer", "grocery"],
    ]);
    expect(result.sources).toEqual({ bankAlerts: "ok", bankPosted: "ok", scanned: "ok" });
  });

  it("keeps today's receipts when only the library is down", async () => {
    const { fetchImpl } = fakeUpstreams({ receipt_list: () => json({}, 500) });
    const service = createNutritionService({ settings, fetchImpl, now: () => NOW });
    const result = await service.listReceipts({ start: NOW - 3_600_000 * 12, end: NOW });
    expect(result.receipts.map((r) => r.merchant)).toEqual(["Taco Spot"]);
    expect(result.sources.scanned).toMatchObject({ error: expect.stringMatching(/HTTP 500/) });
  });

  it("picks the glucose reading closest to the requested time", async () => {
    const { fetchImpl } = fakeUpstreams();
    const service = createNutritionService({ settings, fetchImpl, now: () => NOW });
    const at = Date.parse("2026-10-17T23:00:00Z");
    const result = await service.closestGlucose(
      { start: Date.parse("2026-10-17T05:00:00Z"), end: Date.parse("2026-10-18T05:00:00Z") },
      at,
    );
    expect(result.reading).toEqual({
      value: 132,
      unit: "mg/dL",
      takenAt: Date.parse("2026-10-17T23:10:00Z"),
    });
  });

  it("returns owner targets with null for unset values", async () => {
    const { fetchImpl } = fakeUpstreams();
    const service = createNutritionService({ settings, fetchImpl, now: () => NOW });
    await expect(service.getTargets()).resolves.toEqual({ calorieTarget: null, tdee: 2400 });
  });
});

describe("cupcake-nutrition outcomes", () => {
  it("reads owner-reported wins and losses for Chicago calendar days, newest first", async () => {
    const { fetchImpl, calls } = fakeUpstreams();
    const service = createNutritionService({ settings, fetchImpl, now: () => NOW });
    const result = await service.listOutcomes({
      start: Date.parse("2026-10-11T05:00:00Z"),
      end: Date.parse("2026-10-18T05:00:00Z"),
    });
    expect(calls[0]?.body).toMatchObject({
      action: "outcome_list",
      start: "2026-10-11",
      end: "2026-10-17",
    });
    expect(result.entries.map((e) => [e.date, e.outcome, e.title])).toEqual([
      ["2026-10-17", "loss", "Bought it anyway"],
      ["2026-10-11", "win", "Went for a walk"],
    ]);
    expect(result.counts).toEqual({ wins: 1, losses: 1, unscored: 0, total: 2 });
    expect(result.coverageNote).toMatch(/Owner-reported/);
  });

  it("fails rather than inventing outcomes when the library is down", async () => {
    const { fetchImpl } = fakeUpstreams({ outcome_list: () => json({}, 503) });
    const service = createNutritionService({ settings, fetchImpl, now: () => NOW });
    await expect(service.listOutcomes({ start: NOW - 86_400_000, end: NOW })).rejects.toThrow(
      /HTTP 503/,
    );
  });
});

describe("parsers and params", () => {
  it("validates ranges", () => {
    expect(parseRange({ start: 1, end: 2 })).toEqual({ start: 1, end: 2 });
    expect(() => parseRange({ start: 2, end: 1 })).toThrow(InvalidParamsError);
    expect(() => parseRange({ start: "1", end: 2 })).toThrow(InvalidParamsError);
  });

  it("marks meals without resolved calories as partial", () => {
    expect(
      parseLibraryMeal({ id: "x", consumedAt: "2026-10-17T10:00:00Z", total: {} }),
    ).toMatchObject({
      calories: 0,
      partial: true,
    });
  });

  it("ignores non-food and refund bank rows", () => {
    expect(
      parseBankRow(
        { id: "1", date: "2026-10-17", amount_usd: 5, category: "retail" },
        "bank-alert",
      ),
    ).toBeUndefined();
    expect(
      parseBankRow(
        { id: "2", date: "2026-10-17", amount_usd: -5, category: "grocery" },
        "bank-alert",
      ),
    ).toBeUndefined();
  });

  it("resolves keys from env names, _FILE and never from config", () => {
    const resolved = resolveNutritionSettings({
      CUPCAKE_OWNER_KEY: "owner",
      CUPCAKE_BRAIN_KEY: "brain",
    });
    expect(resolved.library).toMatchObject({
      key: "owner",
      url: "https://automate.hales.ai/cupcake-library",
    });
    expect(resolved.brain.key).toBe("brain");
    expect(
      resolveNutritionSettings({ CUPCAKE_LIBRARY_URL: "http://evil.example/x" }).library.url,
    ).toBe("https://automate.hales.ai/cupcake-library");
  });
});
