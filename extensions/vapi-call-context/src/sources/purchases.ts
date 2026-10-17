/**
 * Purchase source: Plaid `/transactions/get` (the same call the n8n "Plaid Lookup" node
 * makes; credentials live in /opt/cupcake/plaid.env on the droplet and are passed in via
 * env / LoadCredential). Plaid is enrichment only: the triggering bank notification is the
 * ground truth for the current purchase and is never overridden by an amount guess.
 */
import {
  finiteNumber,
  isRecord,
  readJsonResponse,
  SourceDisabledError,
  type SourceContext,
} from "./types.js";

export type Transaction = {
  amount: number;
  date: string;
  name: string;
  category: string;
};

export type PurchaseEvent = {
  amount: number;
  /** Merchant named by the bank's swipe-time alert; treated as fact when present. */
  notifiedMerchant?: string;
  category?: string;
  alertKind?: string;
};

export type ResolvedPurchase = {
  amount: number;
  merchant: string;
  merchantKnown: boolean;
  merchantSource: string;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  category: string;
  nearMatches: string;
};

export type PurchaseSummary = {
  recentContext: string;
  foodContext: string;
  spend7dUsd: number;
  foodSpend7dUsd: number;
  repeatMerchants: string[];
  transactions: Transaction[];
};

const DAY_MS = 86_400_000;

/** His own tooling and subscriptions: never treated as an impulse candidate. */
const RECURRING =
  /google workspace|grok|netflix|spotify|xai|subscription|hulu|patreon|openai|anthropic/i;

function parseTransaction(value: unknown): Transaction | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const amount = finiteNumber(value.amount);
  if (amount === undefined || typeof value.date !== "string") {
    return undefined;
  }
  const pfc = isRecord(value.personal_finance_category) ? value.personal_finance_category : {};
  const name =
    (typeof value.merchant_name === "string" && value.merchant_name) ||
    (typeof value.name === "string" && value.name) ||
    "unknown";
  return {
    amount,
    date: value.date,
    name,
    category: typeof pfc.primary === "string" ? pfc.primary.toLowerCase().replace(/_/g, " ") : "",
  };
}

function groupByMerchant(txns: readonly Transaction[]): string {
  const groups = new Map<string, { count: number; total: number; last: string }>();
  for (const t of txns) {
    const group = groups.get(t.name) ?? { count: 0, total: 0, last: t.date };
    group.count += 1;
    group.total += t.amount;
    if (t.date > group.last) {
      group.last = t.date;
    }
    groups.set(t.name, group);
  }
  return [...groups.entries()]
    .toSorted((a, b) => b[1].count - a[1].count)
    .map(
      ([name, g]) =>
        `${g.count >= 2 ? "REPEAT " : ""}${name} x${g.count} ($${g.total.toFixed(2)} total, last ${g.last})`,
    )
    .join(" | ");
}

export function summarizePurchases(
  transactions: readonly Transaction[],
  nowMs: number,
): PurchaseSummary {
  const outflows = transactions.filter((t) => t.amount > 0);
  const food = outflows.filter((t) => t.category.includes("food"));
  const cutoff = nowMs - 7 * DAY_MS;
  const inWeek = (t: Transaction) => Date.parse(t.date) >= cutoff;
  const counts = new Map<string, number>();
  for (const t of outflows.slice(0, 20)) {
    counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
  }
  return {
    recentContext: groupByMerchant(outflows.slice(0, 20)) || "no recent bank data",
    foodContext: groupByMerchant(food) || "none in the last 2 weeks",
    spend7dUsd: round2(outflows.filter(inWeek).reduce((sum, t) => sum + t.amount, 0)),
    foodSpend7dUsd: round2(food.filter(inWeek).reduce((sum, t) => sum + t.amount, 0)),
    repeatMerchants: [...counts.entries()].filter(([, c]) => c >= 2).map(([name]) => name),
    transactions: outflows,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Merchant resolution, ported from n8n "Build Call Context" (2026-08-23 fix): bank alert
 * merchant first (fact), then an exact Plaid amount match, then a hedged near guess.
 */
export function resolvePurchase(
  event: PurchaseEvent,
  transactions: readonly Transaction[],
  nowMs: number,
): ResolvedPurchase {
  const amount = event.amount;
  const notified = event.notifiedMerchant?.trim() ?? "";
  const outflows = transactions.filter((t) => t.amount > 0);
  const exact = outflows.find((t) => Math.abs(t.amount - amount) < 0.005);
  const tolerance = Math.max(1, amount * 0.15);
  const scored = outflows
    .filter((t) => !RECURRING.test(t.name) && t.category !== "general services")
    .map((t) => {
      const daysAgo = (nowMs - Date.parse(t.date)) / DAY_MS;
      const diff = Math.abs(t.amount - amount);
      return { t, daysAgo, diff, score: diff / tolerance + daysAgo * 0.4 };
    })
    .filter((x) => x.diff <= tolerance)
    .toSorted((a, b) => a.score - b.score);
  const near =
    scored
      .slice(0, 5)
      .map((x) => `${x.t.name} ($${x.t.amount.toFixed(2)}, ${Math.round(x.daysAgo)}d ago)`)
      .join(", ") || "none";
  if (notified) {
    return {
      amount,
      merchant: notified,
      merchantKnown: true,
      merchantSource: "bank notification (confirmed)",
      confidence: "HIGH",
      category: event.category || exact?.category || "unknown",
      nearMatches: near,
    };
  }
  if (exact) {
    return {
      amount,
      merchant: exact.name,
      merchantKnown: true,
      merchantSource: "plaid exact-amount match",
      confidence: "HIGH",
      category: event.category || exact.category || "unknown",
      nearMatches: near,
    };
  }
  const best = scored[0];
  if (best) {
    return {
      amount,
      merchant: best.t.name,
      merchantKnown: false,
      merchantSource: "plaid amount guess (unconfirmed)",
      confidence: best.daysAgo <= 1 ? "MEDIUM" : "LOW",
      category: event.category || best.t.category || "unknown",
      nearMatches: near,
    };
  }
  return {
    amount,
    merchant: "unknown",
    merchantKnown: false,
    merchantSource: "none",
    confidence: "NONE",
    category: event.category || "unknown",
    nearMatches: near,
  };
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export async function fetchPlaidTransactions(
  ctx: SourceContext,
  plaid: { clientId?: string; secret?: string; accessToken?: string; env: string },
): Promise<Transaction[]> {
  if (!plaid.clientId || !plaid.secret || !plaid.accessToken) {
    throw new SourceDisabledError("PLAID_CLIENT_ID / PLAID_SECRET / PLAID_ACCESS_TOKEN not set");
  }
  if (!/^(production|development|sandbox)$/.test(plaid.env)) {
    throw new SourceDisabledError(`unsupported PLAID_ENV ${JSON.stringify(plaid.env)}`);
  }
  const response = await ctx.fetchImpl(`https://${plaid.env}.plaid.com/transactions/get`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: plaid.clientId,
      secret: plaid.secret,
      access_token: plaid.accessToken,
      start_date: isoDate(ctx.nowMs - 14 * DAY_MS),
      end_date: isoDate(ctx.nowMs),
      options: { count: 100 },
    }),
    signal: ctx.signal,
  });
  const body = await readJsonResponse(response, "plaid transactions/get");
  if (!isRecord(body) || !Array.isArray(body.transactions)) {
    throw new Error("plaid transactions/get returned an unexpected shape");
  }
  return body.transactions
    .map(parseTransaction)
    .filter((t): t is Transaction => Boolean(t))
    .toSorted((a, b) => b.date.localeCompare(a.date));
}
