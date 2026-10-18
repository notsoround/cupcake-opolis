/**
 * Owner-reported personal wins & losses for the Today screen, read through the
 * cupcake-nutrition plugin's read-only `nutrition.outcomes.list` Gateway method
 * (cupcake library `outcome_list`, table `personal_outcomes`).
 *
 * There is no sample fallback: when the method is missing or fails, the card
 * says so instead of showing made-up scores.
 */
import type { ApplicationGatewaySnapshot } from "../../app/gateway.ts";
import { canCallGatewayMethod } from "../../lib/gateway-methods.ts";

export const NUTRITION_OUTCOMES_METHOD = "nutrition.outcomes.list";

export type PersonalOutcome = {
  id: string;
  date: string;
  title: string;
  outcome: "win" | "loss" | "unscored";
  note: string;
};

export type OutcomeCounts = { wins: number; losses: number; unscored: number; total: number };

export type OutcomesResult =
  | { status: "ok"; entries: PersonalOutcome[]; counts: OutcomeCounts; stale: boolean }
  | { status: "unavailable"; reason: "offline" | "no-backend" | "error"; detail?: string };

type GatewayView = Pick<ApplicationGatewaySnapshot, "client" | "hello" | "phase">;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

export function parseOutcomesPayload(payload: unknown): OutcomesResult {
  if (!isRecord(payload) || !Array.isArray(payload.entries)) {
    return { status: "unavailable", reason: "error", detail: "unexpected response" };
  }
  const entries = payload.entries.flatMap((value): PersonalOutcome[] => {
    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      typeof value.date !== "string" ||
      typeof value.title !== "string" ||
      (value.outcome !== "win" && value.outcome !== "loss" && value.outcome !== "unscored")
    ) {
      return [];
    }
    return [
      {
        id: value.id,
        date: value.date,
        title: value.title,
        outcome: value.outcome,
        note: typeof value.note === "string" ? value.note : "",
      },
    ];
  });
  const c = isRecord(payload.counts) ? payload.counts : {};
  return {
    status: "ok",
    entries,
    counts: {
      wins: count(c.wins),
      losses: count(c.losses),
      unscored: count(c.unscored),
      total: count(c.total),
    },
    stale: payload.stale === true,
  };
}

export async function loadOutcomes(
  snapshot: GatewayView | null | undefined,
  range: { start: number; end: number },
): Promise<OutcomesResult> {
  const client = snapshot?.client;
  if (!client || snapshot.phase !== "connected" || !snapshot.hello) {
    return { status: "unavailable", reason: "offline" };
  }
  if (!canCallGatewayMethod(snapshot, NUTRITION_OUTCOMES_METHOD, "operator.read")) {
    return { status: "unavailable", reason: "no-backend" };
  }
  try {
    return parseOutcomesPayload(
      await client.request(NUTRITION_OUTCOMES_METHOD, { start: range.start, end: range.end }),
    );
  } catch (error) {
    return {
      status: "unavailable",
      reason: "error",
      detail: error instanceof Error && error.message ? error.message : "unavailable",
    };
  }
}

/** Personal win rate, ignoring unscored entries; null when nothing is scored. */
export function winRate(counts: OutcomeCounts): number | null {
  const scored = counts.wins + counts.losses;
  return scored > 0 ? Math.round((counts.wins / scored) * 100) : null;
}
