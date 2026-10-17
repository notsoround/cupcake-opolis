/**
 * Glucose source.
 *
 * REAL: owner-reported (fingerstick/manual) readings from the Cupcake private library
 * (`glucose_manual_list`, table `health_manual_observations`).
 *
 * Not ported yet (cgm): the Libre 3 CGM feed is still only read by the n8n "Libre3 Glucose Tracker"
 * workflow (LibreView LLU API -> Google Sheet). Until that feed is persisted somewhere
 * this service can read (library observation, or the brain `glucose_status` tool), CGM
 * readings are not part of call-start context.
 */
import {
  finiteNumber,
  isRecord,
  readJsonResponse,
  SourceDisabledError,
  type SourceContext,
} from "./types.js";

export type GlucoseReading = {
  mgDl: number;
  trend: string;
  observedAt: string;
  basis: "owner-reported";
};

const LOOKBACK_MS = 6 * 3_600_000;

export async function fetchLatestGlucose(
  ctx: SourceContext,
  library: { url: string; key?: string },
): Promise<GlucoseReading | null> {
  if (!library.key) {
    throw new SourceDisabledError("CUPCAKE_LIBRARY_KEY not configured");
  }
  const response = await ctx.fetchImpl(library.url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cupcake-key": library.key },
    body: JSON.stringify({
      action: "glucose_manual_list",
      start: new Date(ctx.nowMs - LOOKBACK_MS).toISOString(),
      limit: 5,
    }),
    signal: ctx.signal,
  });
  const body = await readJsonResponse(response, "cupcake-library glucose_manual_list");
  const entries = isRecord(body) && Array.isArray(body.entries) ? body.entries : [];
  const latest = entries
    .filter(isRecord)
    .filter((e) => typeof e.observedAt === "string" && finiteNumber(e.glucoseMgDl) !== undefined)
    .toSorted((a, b) => String(b.observedAt).localeCompare(String(a.observedAt)))[0];
  const mgDl = latest ? finiteNumber(latest.glucoseMgDl) : undefined;
  if (!latest || mgDl === undefined) {
    return null;
  }
  return {
    mgDl: Math.round(mgDl),
    trend: typeof latest.trend === "string" ? latest.trend : "unknown",
    observedAt: String(latest.observedAt),
    basis: "owner-reported",
  };
}
