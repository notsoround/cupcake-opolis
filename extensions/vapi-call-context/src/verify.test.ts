import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyVapiRequest } from "./verify.js";

const base = {
  webhookSecret: "s3cret",
  webhookHmacSecret: undefined,
  hmacSignatureHeader: "x-vapi-signature",
  hmacTimestampHeader: undefined,
  hmacMaxSkewSeconds: 300,
};

describe("verifyVapiRequest", () => {
  it("fails closed when no secret is configured", () => {
    const result = verifyVapiRequest({
      headers: { "x-vapi-secret": "anything" },
      rawBody: "{}",
      settings: { ...base, webhookSecret: undefined },
    });
    expect(result).toMatchObject({ ok: false, status: 503 });
  });

  it("accepts the legacy X-Vapi-Secret header and a Bearer credential", () => {
    expect(
      verifyVapiRequest({ headers: { "x-vapi-secret": "s3cret" }, rawBody: "{}", settings: base })
        .ok,
    ).toBe(true);
    expect(
      verifyVapiRequest({
        headers: { authorization: "Bearer s3cret" },
        rawBody: "{}",
        settings: base,
      }).ok,
    ).toBe(true);
  });

  it("rejects a wrong or missing secret", () => {
    expect(
      verifyVapiRequest({ headers: { "x-vapi-secret": "nope" }, rawBody: "{}", settings: base }),
    ).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(verifyVapiRequest({ headers: {}, rawBody: "{}", settings: base }).ok).toBe(false);
  });

  it("verifies an HMAC signature over timestamp.body and enforces skew", () => {
    const settings = {
      ...base,
      webhookSecret: undefined,
      webhookHmacSecret: "hmac-key",
      hmacTimestampHeader: "x-vapi-timestamp",
    };
    const nowMs = 1_800_000_000_000;
    const ts = String(nowMs / 1000);
    const body = '{"message":{"type":"assistant-request"}}';
    const sig = createHmac("sha256", "hmac-key").update(`${ts}.${body}`).digest("hex");
    const headers = { "x-vapi-signature": `sha256=${sig}`, "x-vapi-timestamp": ts };
    expect(verifyVapiRequest({ headers, rawBody: body, settings, nowMs }).ok).toBe(true);
    expect(verifyVapiRequest({ headers, rawBody: `${body} `, settings, nowMs }).ok).toBe(false);
    expect(verifyVapiRequest({ headers, rawBody: body, settings, nowMs: nowMs + 301_000 }).ok).toBe(
      false,
    );
  });
});
