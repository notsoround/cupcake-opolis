/**
 * HTTP handler for Vapi server-URL deliveries.
 *
 *  - `assistant-request` (inbound call, phone number without a fixed assistant): routes
 *    by caller number exactly like the n8n "Cupcake Inbound Router" (owner -> private
 *    Cupcake with live context, coach -> coach assistant, anyone else -> public
 *    assistant) and returns `{ assistantId, assistantOverrides }`.
 *  - `tool-calls` for `get_call_context`: the same context, refreshed mid-call.
 *  - every other message type is informational and acknowledged with `{}`.
 *
 * Unknown callers never receive private context. Requests are verified before parsing.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { buildCallContext, gatherContext, toAssistantOverrides } from "./assemble.js";
import { isNight } from "./clock.js";
import { normalizeUsNumber, type CallContextSettings } from "./config.js";
import { TtlCache } from "./gather.js";
import type { PersonaSections } from "./persona.js";
import { isRecord, type FetchLike } from "./sources/types.js";
import { verifyVapiRequest } from "./verify.js";

export const CALL_CONTEXT_TOOL_NAME = "get_call_context";
const MAX_BODY_BYTES = 512 * 1024;
const BODY_TIMEOUT_MS = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type HandlerLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

export type CallContextDeps = {
  settings: CallContextSettings;
  sections: PersonaSections;
  fetchImpl?: FetchLike;
  now?: () => number;
  logger?: HandlerLogger;
  cache?: TtlCache;
};

type Identity = "owner" | "coach" | "public";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => reject(new Error("body read timeout")), BODY_TIMEOUT_MS);
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        clearTimeout(timer);
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/** Caller identity from the call object, mirroring the n8n approved-phone-numbers policy. */
export function resolveCallerIdentity(
  message: Record<string, unknown>,
  settings: CallContextSettings,
): Identity {
  const call = isRecord(message.call) ? message.call : undefined;
  if (
    !call ||
    call.type !== "inboundPhoneCall" ||
    typeof call.id !== "string" ||
    !UUID.test(call.id)
  ) {
    return "public";
  }
  if (settings.phoneNumberId && call.phoneNumberId !== settings.phoneNumberId) {
    return "public";
  }
  const customer = isRecord(call.customer) ? call.customer : {};
  const number = normalizeUsNumber(customer.number);
  if (!number) {
    return "public";
  }
  const outerCustomer = isRecord(message.customer) ? message.customer : undefined;
  if (outerCustomer?.number !== undefined && normalizeUsNumber(outerCustomer.number) !== number) {
    return "public";
  }
  const phoneNumber = isRecord(message.phoneNumber) ? message.phoneNumber : undefined;
  if (
    settings.phoneNumberId &&
    phoneNumber?.id !== undefined &&
    phoneNumber.id !== settings.phoneNumberId
  ) {
    return "public";
  }
  if (settings.ownerNumbers.includes(number)) {
    return "owner";
  }
  if (settings.coachNumbers.includes(number)) {
    return "coach";
  }
  return "public";
}

function publicResponse(settings: CallContextSettings): Record<string, unknown> {
  return settings.publicAssistantId
    ? { assistantId: settings.publicAssistantId }
    : { error: "Sorry, this line isn't taking calls right now." };
}

export function createCallContextHandler(deps: CallContextDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const cache = deps.cache ?? new TtlCache();
  const log = deps.logger ?? { info: () => {}, warn: () => {} };
  const { settings, sections } = deps;

  async function assistantRequest(message: Record<string, unknown>) {
    const identity = resolveCallerIdentity(message, settings);
    if (identity === "public") {
      log.info("vapi-call-context: assistant-request routed to public assistant");
      return publicResponse(settings);
    }
    if (identity === "coach") {
      // Not ported yet (coach): port the coach overrides from the n8n Inbound Router. Until then the
      // saved coach assistant answers with its own persisted configuration.
      return settings.coachAssistantId
        ? { assistantId: settings.coachAssistantId }
        : publicResponse(settings);
    }
    if (!settings.ownerAssistantId) {
      log.warn("vapi-call-context: CUPCAKE_VAPI_ASSISTANT_ID not set; refusing owner call");
      return publicResponse(settings);
    }
    const nowMs = now();
    const night = isNight(nowMs, settings.timeZone);
    const calm = night && Boolean(settings.nightAssistantId);
    const callId =
      isRecord(message.call) && typeof message.call.id === "string" ? message.call.id : undefined;
    try {
      const gathered = await gatherContext({
        settings,
        trigger: { kind: "inbound", night },
        fetchImpl,
        nowMs,
        cache,
        excludeCallId: callId,
        calm,
      });
      const ctx = buildCallContext({
        settings,
        sections,
        trigger: { kind: "inbound", night },
        gathered,
        nowMs,
        calm,
      });
      log.info(
        `vapi-call-context: owner assistant-request register=${ctx.register} sources=${JSON.stringify(ctx.sourceStatus)} alarms=${ctx.variableValues.alarms}`,
      );
      return {
        assistantId: calm ? settings.nightAssistantId : settings.ownerAssistantId,
        assistantOverrides: toAssistantOverrides(ctx, settings),
      };
    } catch (error) {
      // Never drop the call: the saved assistant still answers with its own persona.
      log.warn(
        `vapi-call-context: context assembly failed, falling back to saved assistant: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { assistantId: settings.ownerAssistantId };
    }
  }

  async function toolCalls(message: Record<string, unknown>) {
    const list = Array.isArray(message.toolCallList) ? message.toolCallList.filter(isRecord) : [];
    const call = isRecord(message.call) ? message.call : {};
    const customer = isRecord(call.customer) ? call.customer : {};
    const number = normalizeUsNumber(customer.number);
    const isOwner = number !== undefined && settings.ownerNumbers.includes(number);
    const results = [];
    for (const toolCall of list) {
      const fn = isRecord(toolCall.function) ? toolCall.function : {};
      const name = typeof fn.name === "string" ? fn.name : "";
      const toolCallId = typeof toolCall.id === "string" ? toolCall.id : "";
      if (name !== CALL_CONTEXT_TOOL_NAME) {
        results.push({ toolCallId, name, error: `unknown tool ${name}` });
        continue;
      }
      if (!isOwner) {
        results.push({ toolCallId, name, result: JSON.stringify({ available: false }) });
        continue;
      }
      const nowMs = now();
      const gathered = await gatherContext({
        settings,
        trigger: { kind: "inbound" },
        fetchImpl,
        nowMs,
        cache,
        excludeCallId: typeof call.id === "string" ? call.id : undefined,
      });
      const ctx = buildCallContext({
        settings,
        sections,
        trigger: { kind: "inbound" },
        gathered,
        nowMs,
      });
      const {
        welcome: _welcome,
        call_kind: _kind,
        owner_name: _owner,
        ...data
      } = ctx.variableValues;
      results.push({
        toolCallId,
        name,
        result: JSON.stringify({
          ...data,
          alarms: ctx.alarms.flags.map((f) => f.message),
          sources: ctx.sourceStatus,
        }),
      });
    }
    return { results };
  }

  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      res.end("Method Not Allowed");
      return true;
    }
    let raw: string;
    try {
      raw = await readBody(req);
    } catch {
      sendJson(res, 413, { error: "invalid body" });
      return true;
    }
    const verified = verifyVapiRequest({
      headers: req.headers,
      rawBody: raw,
      settings,
      nowMs: now(),
    });
    if (!verified.ok) {
      log.warn(`vapi-call-context: rejected request (${verified.reason})`);
      sendJson(res, verified.status, { error: "unauthorized" });
      return true;
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: "invalid json" });
      return true;
    }
    const message = isRecord(body) && isRecord(body.message) ? body.message : undefined;
    if (!message) {
      sendJson(res, 400, { error: "missing message" });
      return true;
    }
    if (message.type === "assistant-request") {
      sendJson(res, 200, await assistantRequest(message));
    } else if (message.type === "tool-calls") {
      sendJson(res, 200, await toolCalls(message));
    } else {
      sendJson(res, 200, {});
    }
    return true;
  };
}
