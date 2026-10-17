import { describe, expect, it } from "vitest";
import { aggregateFood } from "./food.js";
import { parseVapiCall, pickLastCallRecap } from "./last-call.js";
import { resolvePurchase, type Transaction } from "./purchases.js";

const NOW = Date.parse("2026-10-17T19:00:00Z");

describe("aggregateFood", () => {
  it("splits 24h and 7d windows and ignores future or unparseable meals", () => {
    const summary = aggregateFood(
      [
        { consumedAt: "2026-10-17T18:00:00Z", total: { calories: 500, sugar_g: 12.4 } },
        { consumedAt: "2026-10-12T18:00:00Z", total: { calories: "300" } },
        { consumedAt: "2026-10-18T18:00:00Z", total: { calories: 9999 } },
        { consumedAt: "not a date", total: { calories: 9999 } },
      ],
      NOW,
    );
    expect(summary.last24h).toMatchObject({ calories: 500, sugarG: 12, mealCount: 1 });
    expect(summary.last7d).toMatchObject({ calories: 800, mealCount: 2 });
  });
});

describe("pickLastCallRecap", () => {
  const owner = "+13125550142";
  const call = (id: string, createdAt: string, extra: Record<string, unknown>) =>
    parseVapiCall({ id, createdAt, status: "ended", customer: { number: owner }, ...extra });

  it("prefers analysis.summary and falls back to a trimmed transcript tail", () => {
    const transcript = `AI: hi. ${"User: blah. ".repeat(100)}User: fine, no more cookies.`;
    const calls = [
      call("a", "2026-10-17T10:00:00Z", { analysis: { summary: "Old call." } }),
      call("b", "2026-10-17T12:00:00Z", { artifact: { transcript } }),
    ].filter((c) => c !== undefined);
    const recap = pickLastCallRecap(calls, { ownerNumbers: [owner] });
    expect(recap?.callId).toBe("b");
    expect(recap?.recapSource).toBe("artifact.transcript");
    expect(recap?.recap.startsWith("…")).toBe(true);
    expect(recap?.recap.endsWith("fine, no more cookies.")).toBe(true);
    expect(recap?.recap.length).toBeLessThanOrEqual(501);
  });

  it("excludes the current call and other callers", () => {
    const calls = [
      call("current", "2026-10-17T18:59:00Z", { analysis: { summary: "now" } }),
      parseVapiCall({
        id: "stranger",
        createdAt: "2026-10-17T18:00:00Z",
        customer: { number: "+13125550199" },
        analysis: { summary: "not him" },
      }),
    ].filter((c) => c !== undefined);
    expect(
      pickLastCallRecap(calls, { ownerNumbers: [owner], excludeCallId: "current" }),
    ).toBeUndefined();
  });
});

describe("resolvePurchase", () => {
  const txns: Transaction[] = [
    { amount: 12.94, date: "2026-10-17", name: "Van Leeuwen", category: "food and drink" },
    { amount: 13.5, date: "2026-10-16", name: "Bakery", category: "food and drink" },
  ];

  it("treats the bank-alert merchant as fact even when Plaid has an exact match elsewhere", () => {
    const resolved = resolvePurchase({ amount: 12.94, notifiedMerchant: "Uber Eats" }, txns, NOW);
    expect(resolved).toMatchObject({
      merchant: "Uber Eats",
      merchantKnown: true,
      merchantSource: "bank notification (confirmed)",
      confidence: "HIGH",
    });
  });

  it("falls back to exact match, then a hedged guess, then nothing", () => {
    expect(resolvePurchase({ amount: 12.94 }, txns, NOW)).toMatchObject({
      merchant: "Van Leeuwen",
      merchantSource: "plaid exact-amount match",
    });
    expect(resolvePurchase({ amount: 13 }, txns, NOW)).toMatchObject({
      merchantKnown: false,
      merchantSource: "plaid amount guess (unconfirmed)",
    });
    expect(resolvePurchase({ amount: 400 }, txns, NOW)).toMatchObject({
      merchant: "unknown",
      confidence: "NONE",
    });
  });
});
