/**
 * Last-call recap from Vapi `GET /call` (https://docs.vapi.ai/api-reference/calls/list),
 * filtered by assistantId and a createdAt window, then by the owner's phone number.
 * Uses `analysis.summary`, falling back to the tail of `artifact.transcript`.
 */
import { normalizeUsNumber } from "../config.js";
import { sanitizePromptValue } from "../template.js";
import { isRecord, readJsonResponse, SourceDisabledError, type SourceContext } from "./types.js";

export type VapiCallRecord = {
  id: string;
  createdAt: string;
  endedAt?: string;
  status?: string;
  endedReason?: string;
  customerNumber?: string;
  summary?: string;
  transcript?: string;
};

export type LastCallRecap = {
  callId: string;
  at: string;
  endedReason?: string;
  recap: string;
  recapSource: "analysis.summary" | "artifact.transcript";
};

export function parseVapiCall(value: unknown): VapiCallRecord | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.createdAt !== "string") {
    return undefined;
  }
  const customer = isRecord(value.customer) ? value.customer : {};
  const analysis = isRecord(value.analysis) ? value.analysis : {};
  const artifact = isRecord(value.artifact) ? value.artifact : {};
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
  return {
    id: value.id,
    createdAt: value.createdAt,
    endedAt: str(value.endedAt),
    status: str(value.status),
    endedReason: str(value.endedReason),
    customerNumber: normalizeUsNumber(customer.number),
    summary: str(analysis.summary),
    transcript: str(artifact.transcript) ?? str(value.transcript),
  };
}

export function trimTranscript(transcript: string, maxChars = 500): string {
  const flat = sanitizePromptValue(transcript, 100_000);
  return flat.length <= maxChars ? flat : `…${flat.slice(flat.length - maxChars).trimStart()}`;
}

export function pickLastCallRecap(
  calls: readonly VapiCallRecord[],
  opts: { ownerNumbers: readonly string[]; excludeCallId?: string },
): LastCallRecap | undefined {
  const candidates = calls
    .filter((c) => c.id !== opts.excludeCallId)
    .filter((c) => c.status === undefined || c.status === "ended")
    .filter(
      (c) =>
        opts.ownerNumbers.length === 0 ||
        (c.customerNumber !== undefined && opts.ownerNumbers.includes(c.customerNumber)),
    )
    .filter((c) => c.summary || c.transcript)
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  const last = candidates[0];
  if (!last) {
    return undefined;
  }
  return {
    callId: last.id,
    at: last.endedAt ?? last.createdAt,
    endedReason: last.endedReason,
    recap: last.summary
      ? sanitizePromptValue(last.summary, 600)
      : trimTranscript(last.transcript ?? ""),
    recapSource: last.summary ? "analysis.summary" : "artifact.transcript",
  };
}

export async function fetchRecentCalls(
  ctx: SourceContext,
  vapi: { baseUrl: string; apiKey?: string; assistantId?: string },
  windowMs: number,
  limit = 25,
): Promise<VapiCallRecord[]> {
  if (!vapi.apiKey) {
    throw new SourceDisabledError("CUPCAKE_VAPI_API_KEY not configured");
  }
  const url = new URL("/call", vapi.baseUrl);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("createdAtGe", new Date(ctx.nowMs - windowMs).toISOString());
  if (vapi.assistantId) {
    url.searchParams.set("assistantId", vapi.assistantId);
  }
  const response = await ctx.fetchImpl(url.toString(), {
    method: "GET",
    headers: { authorization: `Bearer ${vapi.apiKey}` },
    signal: ctx.signal,
  });
  const body = await readJsonResponse(response, "vapi GET /call");
  const list = Array.isArray(body)
    ? body
    : isRecord(body) && Array.isArray(body.results)
      ? body.results
      : [];
  return list.map(parseVapiCall).filter((c): c is VapiCallRecord => Boolean(c));
}
