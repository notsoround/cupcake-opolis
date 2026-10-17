/**
 * Vapi webhook verification.
 *
 * Vapi authenticates server-URL deliveries with a Custom Credential attached to a saved
 * assistant, phone number, tool, or the org Server Configuration:
 *   - Bearer Token credential -> `Authorization: Bearer <token>` (or any header name;
 *     the legacy form is `X-Vapi-Secret: <token>` with the Bearer prefix disabled)
 *   - HMAC credential          -> signature header over the raw body (optional timestamp)
 * Vapi does NOT attach org credentials when the server URL arrives inside an API request
 * (transient assistant or assistantOverrides), so this service must only be configured as
 * a saved server URL. See https://docs.vapi.ai/server-url/server-authentication.
 *
 * Fails closed: with no secret configured every request is refused.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { CallContextSettings } from "./config.js";

export type VerifyResult = { ok: true } | { ok: false; status: 401 | 503; reason: string };

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.length > 0 ? first : undefined;
}

/** Constant-time comparison that does not leak length (both sides hashed first). */
export function safeEqual(left: string, right: string): boolean {
  const a = createHash("sha256").update(left, "utf8").digest();
  const b = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(a, b);
}

function verifySharedSecret(headers: IncomingHttpHeaders, secret: string): boolean {
  const legacy = header(headers, "x-vapi-secret");
  if (legacy !== undefined && safeEqual(legacy, secret)) {
    return true;
  }
  const authorization = header(headers, "authorization");
  if (authorization?.startsWith("Bearer ")) {
    return safeEqual(authorization.slice("Bearer ".length).trim(), secret);
  }
  return false;
}

function verifyHmac(params: {
  headers: IncomingHttpHeaders;
  rawBody: string;
  secret: string;
  signatureHeader: string;
  timestampHeader?: string;
  maxSkewSeconds: number;
  nowMs: number;
}): boolean {
  const provided = header(params.headers, params.signatureHeader)
    ?.replace(/^sha256=/i, "")
    .trim()
    .toLowerCase();
  if (!provided || !/^[0-9a-f]{64}$/.test(provided)) {
    return false;
  }
  let signed = params.rawBody;
  if (params.timestampHeader) {
    const timestamp = header(params.headers, params.timestampHeader);
    const seconds = Number(timestamp);
    if (!timestamp || !Number.isFinite(seconds)) {
      return false;
    }
    // Accept seconds or milliseconds epoch.
    const ms = seconds > 1e12 ? seconds : seconds * 1000;
    if (Math.abs(params.nowMs - ms) > params.maxSkewSeconds * 1000) {
      return false;
    }
    signed = `${timestamp}.${params.rawBody}`;
  }
  const expected = createHmac("sha256", params.secret).update(signed, "utf8").digest("hex");
  return safeEqual(provided, expected);
}

export function verifyVapiRequest(params: {
  headers: IncomingHttpHeaders;
  rawBody: string;
  settings: Pick<
    CallContextSettings,
    | "webhookSecret"
    | "webhookHmacSecret"
    | "hmacSignatureHeader"
    | "hmacTimestampHeader"
    | "hmacMaxSkewSeconds"
  >;
  nowMs?: number;
}): VerifyResult {
  const { settings } = params;
  if (!settings.webhookSecret && !settings.webhookHmacSecret) {
    return {
      ok: false,
      status: 503,
      reason: "webhook secret not configured (set CUPCAKE_VAPI_WEBHOOK_SECRET)",
    };
  }
  if (settings.webhookSecret && !verifySharedSecret(params.headers, settings.webhookSecret)) {
    return { ok: false, status: 401, reason: "invalid or missing Vapi secret" };
  }
  if (
    settings.webhookHmacSecret &&
    !verifyHmac({
      headers: params.headers,
      rawBody: params.rawBody,
      secret: settings.webhookHmacSecret,
      signatureHeader: settings.hmacSignatureHeader,
      timestampHeader: settings.hmacTimestampHeader,
      maxSkewSeconds: settings.hmacMaxSkewSeconds,
      nowMs: params.nowMs ?? Date.now(),
    })
  ) {
    return { ok: false, status: 401, reason: "invalid or missing Vapi signature" };
  }
  return { ok: true };
}
