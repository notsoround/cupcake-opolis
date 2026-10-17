/**
 * Outbound trigger helper: place a Cupcake call via Vapi `POST /call` without n8n.
 *
 * The caller (purchase detection, glucose or location watcher) hands over the triggering
 * event; this assembles the same rendered context as the inbound path and sends it as
 * `assistantOverrides` on the saved assistant. The server URL is NOT supplied in the
 * request (Vapi withholds org credentials from request-supplied server URLs), so tools
 * keep authenticating through the saved assistant / saved tools.
 *
 * Guards ported from n8n "Quiet Hours Gate": no ring 23:00–06:30 local, and no ring if
 * any call reached him in the last 25 minutes. Sending is opt-in twice: `send: true`
 * AND CUPCAKE_VAPI_OUTBOUND_ENABLED=1.
 */
import {
  buildCallContext,
  gatherContext,
  toAssistantOverrides,
  type AssistantOverrides,
  type CallTrigger,
} from "./assemble.js";
import { isQuietHours } from "./clock.js";
import type { CallContextSettings } from "./config.js";
import type { TtlCache } from "./gather.js";
import type { PersonaSections } from "./persona.js";
import { fetchRecentCalls } from "./sources/last-call.js";
import { isRecord, type FetchLike } from "./sources/types.js";

export const DOUBLE_RING_MINUTES = 25;

export type OutboundTrigger = Exclude<CallTrigger, { kind: "inbound" }>;

export type OutboundCallBody = {
  assistantId: string;
  phoneNumberId: string;
  customer: { number: string };
  metadata: Record<string, string>;
  assistantOverrides: AssistantOverrides;
};

export type OutboundResult =
  | { placed: true; callId?: string; body: OutboundCallBody }
  | { placed: false; reason: string; body?: OutboundCallBody };

export async function placeOutboundCall(params: {
  settings: CallContextSettings;
  sections: PersonaSections;
  trigger: OutboundTrigger;
  send: boolean;
  fetchImpl?: FetchLike;
  now?: () => number;
  cache?: TtlCache;
  /** Skip quiet hours / double-ring (explicit operator choice, never a default). */
  ignoreGuards?: boolean;
}): Promise<OutboundResult> {
  const { settings } = params;
  const fetchImpl = params.fetchImpl ?? fetch;
  const nowMs = (params.now ?? Date.now)();
  if (!settings.ownerAssistantId || !settings.phoneNumberId || !settings.outboundNumber) {
    return {
      placed: false,
      reason:
        "CUPCAKE_VAPI_ASSISTANT_ID, CUPCAKE_VAPI_PHONE_NUMBER_ID and CUPCAKE_VAPI_OUTBOUND_NUMBER are required",
    };
  }

  if (!params.ignoreGuards) {
    if (isQuietHours(nowMs, settings.timeZone)) {
      // Not ported yet (deferred-queue): n8n queues quiet-hours purchases for a 07:45 flush in
      // workflow static data. Persist that queue in the caller before retiring n8n.
      return { placed: false, reason: "quiet hours 23:00-06:30 local; not ringing" };
    }
    try {
      const recent = await fetchRecentCalls(
        { fetchImpl, signal: AbortSignal.timeout(settings.sourceTimeoutMs), nowMs },
        { baseUrl: settings.vapiBaseUrl, apiKey: settings.vapiApiKey },
        DOUBLE_RING_MINUTES * 60_000,
        50,
      );
      const rings = recent.filter((c) => c.customerNumber === settings.outboundNumber).length;
      if (rings > 0) {
        return {
          placed: false,
          reason: `${rings} Vapi call(s) to him in the last ${DOUBLE_RING_MINUTES} min; not stacking another ring`,
        };
      }
    } catch {
      // Same as n8n: a Vapi blip degrades to "no recent rings known".
    }
  }

  const gathered = await gatherContext({
    settings,
    trigger: params.trigger,
    fetchImpl,
    nowMs,
    cache: params.cache,
  });
  const ctx = buildCallContext({
    settings,
    sections: params.sections,
    trigger: params.trigger,
    gathered,
    nowMs,
  });
  const metadata: Record<string, string> = {
    trigger: params.trigger.kind,
    domain: params.trigger.kind,
  };
  if (ctx.purchase) {
    metadata.merchant = ctx.purchase.merchant;
    metadata.merchant_known = String(ctx.purchase.merchantKnown);
    metadata.merchant_source = ctx.purchase.merchantSource;
    metadata.amount = ctx.purchase.amount.toFixed(2);
  }
  const body: OutboundCallBody = {
    assistantId: settings.ownerAssistantId,
    phoneNumberId: settings.phoneNumberId,
    customer: { number: settings.outboundNumber },
    metadata,
    assistantOverrides: toAssistantOverrides(ctx, settings, { outbound: true }),
  };

  if (!params.send) {
    return { placed: false, reason: "dry run (send not requested)", body };
  }
  if (!settings.outboundEnabled) {
    return { placed: false, reason: "CUPCAKE_VAPI_OUTBOUND_ENABLED is not 1", body };
  }
  if (!settings.vapiApiKey) {
    return { placed: false, reason: "CUPCAKE_VAPI_API_KEY not configured", body };
  }
  const response = await fetchImpl(new URL("/call", settings.vapiBaseUrl).toString(), {
    method: "POST",
    headers: {
      authorization: `Bearer ${settings.vapiApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    return { placed: false, reason: `Vapi POST /call responded HTTP ${response.status}`, body };
  }
  const created: unknown = await response.json().catch(() => ({}));
  return {
    placed: true,
    callId: isRecord(created) && typeof created.id === "string" ? created.id : undefined,
    body,
  };
}

/** Mask phone numbers for operator output (keeps the last two digits). */
export function redactOutboundBody(body: OutboundCallBody): OutboundCallBody {
  return {
    ...body,
    customer: { number: body.customer.number.replace(/\d(?=\d{2})/g, "•") },
  };
}
