import { resolveCallContextSettings, type CallContextSettings } from "./config.js";
import type { FetchLike } from "./sources/types.js";

/** Synthetic values only: 555-01xx numbers are reserved fictional numbers. */
export const OWNER_NUMBER = "+13125550142";
export const COACH_NUMBER = "+13125550143";
export const STRANGER_NUMBER = "+13125550199";
export const CALL_ID = "0b4f2c9e-1d2a-4b7c-8e9f-0a1b2c3d4e5f";
export const SECRET = "test-webhook-secret-not-real";

export function testSettings(env: Record<string, string> = {}): CallContextSettings {
  return resolveCallContextSettings({
    CUPCAKE_VAPI_WEBHOOK_SECRET: SECRET,
    CUPCAKE_VAPI_API_KEY: "test-vapi-key",
    CUPCAKE_VAPI_ASSISTANT_ID: "assistant-owner",
    CUPCAKE_VAPI_PUBLIC_ASSISTANT_ID: "assistant-public",
    CUPCAKE_VAPI_COACH_ASSISTANT_ID: "assistant-coach",
    CUPCAKE_VAPI_PHONE_NUMBER_ID: "phone-number-1",
    CUPCAKE_VAPI_OWNER_NUMBERS: OWNER_NUMBER,
    CUPCAKE_VAPI_COACH_NUMBERS: COACH_NUMBER,
    CUPCAKE_VAPI_OUTBOUND_NUMBER: OWNER_NUMBER,
    CUPCAKE_LIBRARY_KEY: "test-library-key",
    PLAID_CLIENT_ID: "test-client",
    PLAID_SECRET: "test-plaid-secret",
    PLAID_ACCESS_TOKEN: "test-access-token",
    CUPCAKE_VAPI_CACHE_TTL_MS: "0",
    ...env,
  });
}

/** 2026-10-17T19:00:00Z = 2:00 PM America/Chicago (daytime, outside quiet hours). */
export const NOW_MS = Date.parse("2026-10-17T19:00:00Z");

const hoursAgo = (h: number) => new Date(NOW_MS - h * 3_600_000).toISOString();

export const FOOD_HISTORY = {
  meals: [
    {
      consumedAt: hoursAgo(2),
      total: { calories: 800, protein_g: 30, carbs_g: 90, fat_g: 35, sugar_g: 40 },
    },
    {
      consumedAt: hoursAgo(20),
      total: { calories: 600, protein_g: 40, carbs_g: 50, fat_g: 20, sugar_g: 10 },
      totalIsPartial: true,
    },
    {
      consumedAt: hoursAgo(60),
      total: { calories: 1000, protein_g: 50, carbs_g: 100, fat_g: 40, sugar_g: 25 },
    },
    {
      consumedAt: hoursAgo(24 * 9),
      total: { calories: 5000, protein_g: 1, carbs_g: 1, fat_g: 1, sugar_g: 1 },
    },
  ],
  hasMore: false,
  nextCursor: null,
};

export const PLAID_TRANSACTIONS = {
  transactions: [
    {
      amount: 12.94,
      date: "2026-10-17",
      merchant_name: "Uber Eats",
      personal_finance_category: { primary: "FOOD_AND_DRINK" },
    },
    {
      amount: 9.5,
      date: "2026-10-15",
      merchant_name: "Uber Eats",
      personal_finance_category: { primary: "FOOD_AND_DRINK" },
    },
    {
      amount: 42,
      date: "2026-10-14",
      merchant_name: "Hosting Co",
      personal_finance_category: { primary: "GENERAL_SERVICES" },
    },
    {
      amount: -500,
      date: "2026-10-13",
      name: "Payroll",
      personal_finance_category: { primary: "INCOME" },
    },
  ],
};

export const VAPI_CALLS = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    createdAt: hoursAgo(5),
    endedAt: hoursAgo(4.9),
    status: "ended",
    endedReason: "customer-ended-call",
    customer: { number: OWNER_NUMBER },
    analysis: { summary: "He admitted to the cookies and promised a walk after dinner." },
  },
];

export type RouteMap = {
  library?: (body: Record<string, unknown>) => unknown;
  plaid?: () => unknown;
  vapiList?: () => unknown;
  vapiCreate?: (body: unknown) => unknown;
};

/** Fetch stub routing by URL; a route that is absent rejects like a dead upstream. */
export function stubFetch(routes: RouteMap, calls: string[] = []): FetchLike {
  return async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url}`);
    const json = (value: unknown) =>
      new Response(JSON.stringify(value), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (url.includes("cupcake-library") && routes.library) {
      return json(routes.library(JSON.parse(String(init?.body ?? "{}"))));
    }
    if (url.includes("plaid.com") && routes.plaid) {
      return json(routes.plaid());
    }
    if (url.includes("/call") && method === "GET" && routes.vapiList) {
      return json(routes.vapiList());
    }
    if (url.includes("/call") && method === "POST" && routes.vapiCreate) {
      return json(routes.vapiCreate(JSON.parse(String(init?.body ?? "{}"))));
    }
    throw new Error(`upstream down: ${method} ${url}`);
  };
}

export const ALL_ROUTES: RouteMap = {
  library: (body) =>
    body.action === "food_history"
      ? FOOD_HISTORY
      : { entries: [{ observedAt: hoursAgo(1), glucoseMgDl: 142, trend: "rising" }] },
  plaid: () => PLAID_TRANSACTIONS,
  vapiList: () => VAPI_CALLS,
};
