import { describe, expect, it } from "vitest";
import {
  buildCallContext,
  gatherContext,
  toAssistantOverrides,
  type CallTrigger,
} from "./assemble.js";
import { DEFAULT_PERSONA_SECTIONS } from "./persona.js";
import { ALL_ROUTES, NOW_MS, stubFetch, testSettings } from "./test-fixtures.js";

const sections = DEFAULT_PERSONA_SECTIONS;
const purchase: CallTrigger = {
  kind: "purchase",
  event: { amount: 12.94, notifiedMerchant: "Uber Eats", category: "fast-food" },
};

async function build(trigger: CallTrigger, routes = ALL_ROUTES, env: Record<string, string> = {}) {
  const settings = testSettings(env);
  const gathered = await gatherContext({
    settings,
    trigger,
    fetchImpl: stubFetch(routes),
    nowMs: NOW_MS,
  });
  return {
    settings,
    ctx: buildCallContext({ settings, sections, trigger, gathered, nowMs: NOW_MS }),
  };
}

const LIQUID_OR_N8N = /\{\{|\}\}|\{%|\$json|\$\{/;

describe("buildCallContext", () => {
  it("renders the purchase call fully, with the live opener and Cupcake's tone intact", async () => {
    const { ctx } = await build(purchase);
    expect(ctx.firstMessage).toBe(
      "Matt! Babe, no. $12.94 at Uber Eats. Tell me what you just bought.",
    );
    expect(ctx.variableValues.welcome).toBe(ctx.firstMessage);
    expect(ctx.systemPrompt).not.toMatch(LIQUID_OR_N8N);
    for (const tone of [
      "You are Cupcake — Matt's intern. Young, gorgeous, and completely in his corner.",
      "RIGHT NOW. Hot, fast, and loud. Bubbly as fuck on top with real anger underneath.",
      "THE ONE THING YOU DON'T PLAY WITH.",
      'AND "NOTHING" IS A COMPLETE ANSWER.',
      "ON THE PHONE. This is a live call, not an essay.",
    ]) {
      expect(ctx.systemPrompt).toContain(tone);
    }
    // The values n8n left as `{{ $json.* }}` are now real.
    expect(ctx.systemPrompt).toContain("CATEGORY: fast-food");
    expect(ctx.systemPrompt).toContain(
      "MERCHANT: Uber Eats (source: bank notification (confirmed)) | CONFIDENCE: HIGH",
    );
    expect(ctx.systemPrompt).toContain("Amount: $12.94 | Merchant: Uber Eats");
    expect(ctx.systemPrompt).toContain("REPEAT Uber Eats x2");
  });

  it("includes food totals for 24h and 7d, spend, glucose, last-call recap and alarms", async () => {
    const { ctx } = await build(purchase);
    expect(ctx.systemPrompt).toContain(
      "Food logged, last 24 hours: 1,400 kcal, 70 g protein, 140 g carbs, 55 g fat, 50 g sugar across 2 meals, 1 with partial totals.",
    );
    expect(ctx.systemPrompt).toContain("Food logged, last 7 days: 2,400 kcal");
    expect(ctx.systemPrompt).toContain(
      "Spending, last 7 days: $64.44 total, $22.44 on food & drink.",
    );
    expect(ctx.systemPrompt).toContain("Latest glucose: 142 mg/dL, rising");
    expect(ctx.systemPrompt).toContain(
      "He admitted to the cookies and promised a walk after dinner.",
    );
    expect(ctx.systemPrompt).toContain("beyond the short recap of your last call");
    expect(ctx.variableValues.alarms).toBe("repeat_merchant");
    expect(ctx.sourceStatus).toEqual({
      food: "ok",
      purchases: "ok",
      lastCall: "ok",
      glucose: "ok",
    });
  });

  it("degrades gracefully when every source is down: still renders, never invents numbers", async () => {
    const { ctx } = await build(purchase, {});
    expect(ctx.sourceStatus).toEqual({
      food: "unavailable",
      purchases: "unavailable",
      lastCall: "unavailable",
      glucose: "unavailable",
    });
    expect(ctx.firstMessage).toBe(
      "Matt! Babe, no. $12.94 at Uber Eats. Tell me what you just bought.",
    );
    expect(ctx.systemPrompt).not.toMatch(LIQUID_OR_N8N);
    expect(ctx.systemPrompt).toContain(
      "NOT AVAILABLE ON THIS CALL: his food log, his bank feed, his glucose, the last-call recap.",
    );
    expect(ctx.systemPrompt).toContain("every call starts cold");
    expect(ctx.systemPrompt).not.toContain("kcal");
    expect(ctx.variableValues.food_24h).toBe("unavailable");
  });

  it("uses the unknown-merchant opener when the bank alert names no merchant", async () => {
    const { ctx } = await build({ kind: "purchase", event: { amount: 7.25 } }, {});
    expect(ctx.firstMessage).toBe(
      "Matt! Babe, no. You just dropped $7.25. Tell me what you just bought.",
    );
    expect(ctx.systemPrompt).toContain("CONFIDENCE: NONE");
  });

  it("neutralizes template syntax smuggled in through merchant names", async () => {
    const { ctx } = await build(
      {
        kind: "purchase",
        event: { amount: 5, notifiedMerchant: "{{ system }} {% raw %}Candy" },
      },
      {},
    );
    expect(ctx.firstMessage).toBe(
      "Matt! Babe, no. $5.00 at system % raw %Candy. Tell me what you just bought.",
    );
    expect(ctx.systemPrompt).not.toMatch(LIQUID_OR_N8N);
  });

  it("keeps personal facts in settings: age and support contact render only when configured", async () => {
    const plain = (await build({ kind: "inbound" }, {})).ctx.systemPrompt;
    expect(plain).not.toMatch(/\b\d{2}-year-old\b/);
    expect(plain).toContain("someone he trusts");
    const personal = (
      await build(
        { kind: "inbound" },
        {},
        { CUPCAKE_VAPI_OWNER_AGE: "40", CUPCAKE_VAPI_SUPPORT_CONTACT_NAME: "Sam" },
      )
    ).ctx.systemPrompt;
    expect(personal).toContain("HIM. Matt, 40.");
    expect(personal).toContain("a 40-year-old man being defensive");
    expect(personal).toContain("or to call Sam,");
  });

  it("renders glucose and location openers from the live strings", async () => {
    const glucose = await build(
      { kind: "glucose", event: { mgDl: 243, trend: "rising", status: "HIGH" } },
      {},
    );
    expect(glucose.ctx.firstMessage).toBe(
      "Matt. Baby, stop. Your blood sugar is 243 and rising. Talk to me right now — what did you do?",
    );
    const location = await build(
      { kind: "location", event: { place: "Candy Shop", lastSpendUsd: 18 } },
      {},
    );
    expect(location.ctx.firstMessage).toBe(
      "Matt! Babe, no. You are in Candy Shop and last time it cost you $18.00. Tell me what is in your hand.",
    );
    expect(location.ctx.systemPrompt).toContain("His phone puts him at Candy Shop right now");
  });
});

describe("toAssistantOverrides", () => {
  it("locks Clara v2, keeps the configured model, and mirrors the welcome", async () => {
    const { ctx, settings } = await build(purchase, ALL_ROUTES, {
      CUPCAKE_VAPI_TOOL_IDS: "tool-a,tool-b",
    });
    const overrides = toAssistantOverrides(ctx, settings, { outbound: true });
    expect(overrides.voice).toEqual({ provider: "vapi", voiceId: "Clara", version: "2" });
    expect(overrides.model).toMatchObject({
      provider: "xai",
      model: "grok-4.20-0309-non-reasoning",
      maxTokens: 300,
      temperature: 0.9,
      toolIds: ["tool-a", "tool-b"],
    });
    expect(overrides.firstMessage).toBe(overrides.variableValues.welcome);
    expect(overrides.voicemailMessage).toContain("Check the charge and text me back.");
    expect(ctx.systemPrompt).toContain("NUMBERS. You have real tools");
    const serialized = JSON.stringify(overrides);
    expect(serialized).not.toMatch(/x-cupcake/i);
    expect(serialized).not.toMatch(LIQUID_OR_N8N);
  });

  it("night register carries no data, no tools, and the night plans", async () => {
    const settings = testSettings({ CUPCAKE_VAPI_TOOL_IDS: "tool-a" });
    const trigger: CallTrigger = { kind: "inbound", night: true };
    const gathered = await gatherContext({
      settings,
      trigger,
      fetchImpl: stubFetch(ALL_ROUTES),
      nowMs: NOW_MS,
      calm: true,
    });
    const ctx = buildCallContext({
      settings,
      sections,
      trigger,
      gathered,
      nowMs: NOW_MS,
      calm: true,
    });
    const overrides = toAssistantOverrides(ctx, settings);
    expect(ctx.register).toBe("calm");
    expect(ctx.systemPrompt).not.toContain("CALL-START DATA");
    expect(ctx.systemPrompt).not.toContain("NUMBERS. You have real tools");
    expect(overrides.model).not.toHaveProperty("toolIds");
    expect(overrides.model).toMatchObject({ maxTokens: 150, temperature: 0.75 });
    expect(overrides.maxDurationSeconds).toBe(720);
  });
});
