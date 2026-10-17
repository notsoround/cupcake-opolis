import { describe, expect, it } from "vitest";
import { placeOutboundCall, redactOutboundBody } from "./outbound.js";
import { DEFAULT_PERSONA_SECTIONS } from "./persona.js";
import { ALL_ROUTES, NOW_MS, OWNER_NUMBER, stubFetch, testSettings } from "./test-fixtures.js";

const trigger = {
  kind: "purchase" as const,
  event: { amount: 12.94, notifiedMerchant: "Uber Eats", category: "fast-food" },
};

describe("placeOutboundCall", () => {
  it("dry run builds the POST /call body with rendered overrides and never posts", async () => {
    const calls: string[] = [];
    const result = await placeOutboundCall({
      settings: testSettings(),
      sections: DEFAULT_PERSONA_SECTIONS,
      trigger,
      send: false,
      fetchImpl: stubFetch({ ...ALL_ROUTES, vapiList: () => [] }, calls),
      now: () => NOW_MS,
    });
    expect(result.placed).toBe(false);
    expect(calls.filter((c) => c.startsWith("POST https://api.vapi.ai"))).toEqual([]);
    expect(result.body).toMatchObject({
      assistantId: "assistant-owner",
      phoneNumberId: "phone-number-1",
      customer: { number: OWNER_NUMBER },
      metadata: { trigger: "purchase", merchant: "Uber Eats", amount: "12.94" },
      assistantOverrides: {
        firstMessage: "Matt! Babe, no. $12.94 at Uber Eats. Tell me what you just bought.",
        firstMessageInterruptionsEnabled: false,
        variableValues: { merchant: "Uber Eats", amount: "12.94" },
      },
    });
    expect(redactOutboundBody(result.body!).customer.number).toBe("+•••••••••42");
  });

  it("refuses quiet hours and a recent ring", async () => {
    const quiet = await placeOutboundCall({
      settings: testSettings(),
      sections: DEFAULT_PERSONA_SECTIONS,
      trigger,
      send: true,
      fetchImpl: stubFetch(ALL_ROUTES),
      now: () => Date.parse("2026-10-17T07:00:00Z"), // 2:00 AM Chicago
    });
    expect(quiet).toMatchObject({ placed: false, reason: expect.stringContaining("quiet hours") });
    const rang = await placeOutboundCall({
      settings: testSettings(),
      sections: DEFAULT_PERSONA_SECTIONS,
      trigger,
      send: true,
      fetchImpl: stubFetch({
        vapiList: () => [
          {
            id: "x",
            createdAt: new Date(NOW_MS - 60_000).toISOString(),
            customer: { number: OWNER_NUMBER },
          },
        ],
      }),
      now: () => NOW_MS,
    });
    expect(rang).toMatchObject({ placed: false, reason: expect.stringContaining("not stacking") });
  });

  it("posts only when both --send and CUPCAKE_VAPI_OUTBOUND_ENABLED=1 are set", async () => {
    const calls: string[] = [];
    const routes = { ...ALL_ROUTES, vapiList: () => [], vapiCreate: () => ({ id: "call-123" }) };
    const gated = await placeOutboundCall({
      settings: testSettings(),
      sections: DEFAULT_PERSONA_SECTIONS,
      trigger,
      send: true,
      fetchImpl: stubFetch(routes, calls),
      now: () => NOW_MS,
    });
    expect(gated).toMatchObject({
      placed: false,
      reason: expect.stringContaining("OUTBOUND_ENABLED"),
    });
    const placed = await placeOutboundCall({
      settings: testSettings({ CUPCAKE_VAPI_OUTBOUND_ENABLED: "1" }),
      sections: DEFAULT_PERSONA_SECTIONS,
      trigger,
      send: true,
      fetchImpl: stubFetch(routes, calls),
      now: () => NOW_MS,
    });
    expect(placed).toMatchObject({ placed: true, callId: "call-123" });
    expect(calls.filter((c) => c === "POST https://api.vapi.ai/call")).toHaveLength(1);
  });
});
