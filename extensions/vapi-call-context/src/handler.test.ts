import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createCallContextHandler } from "./handler.js";
import { DEFAULT_PERSONA_SECTIONS } from "./persona.js";
import {
  ALL_ROUTES,
  CALL_ID,
  NOW_MS,
  OWNER_NUMBER,
  SECRET,
  STRANGER_NUMBER,
  COACH_NUMBER,
  stubFetch,
  testSettings,
} from "./test-fixtures.js";

type Captured = { status: number; body: unknown };

async function invoke(
  payload: unknown,
  opts: {
    headers?: Record<string, string>;
    env?: Record<string, string>;
    nowMs?: number;
    calls?: string[];
  } = {},
): Promise<Captured> {
  const handler = createCallContextHandler({
    settings: testSettings(opts.env),
    sections: DEFAULT_PERSONA_SECTIONS,
    fetchImpl: stubFetch(ALL_ROUTES, opts.calls),
    now: () => opts.nowMs ?? NOW_MS,
  });
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(payload))]), {
    method: "POST",
    headers: opts.headers ?? { "x-vapi-secret": SECRET, "content-type": "application/json" },
  }) as unknown as IncomingMessage;
  const captured: Captured = { status: 0, body: undefined };
  const res = {
    statusCode: 200,
    headersSent: false,
    setHeader() {},
    writeHead(status: number) {
      captured.status = status;
      return this;
    },
    end(chunk?: string) {
      if (captured.status === 0) {
        captured.status = this.statusCode;
      }
      captured.body = chunk ? (JSON.parse(chunk) as unknown) : undefined;
    },
  } as unknown as ServerResponse;
  await handler(req, res);
  return captured;
}

const assistantRequest = (number: string, extra: Record<string, unknown> = {}) => ({
  message: {
    type: "assistant-request",
    call: {
      id: CALL_ID,
      type: "inboundPhoneCall",
      phoneNumberId: "phone-number-1",
      customer: { number },
      ...extra,
    },
  },
});

describe("Vapi call-context handler", () => {
  it("rejects unverified requests before doing any work", async () => {
    const calls: string[] = [];
    const result = await invoke(assistantRequest(OWNER_NUMBER), {
      headers: { "x-vapi-secret": "wrong" },
      calls,
    });
    expect(result.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("answers the owner's assistant-request with a fully rendered private context", async () => {
    const calls: string[] = [];
    const result = await invoke(assistantRequest(OWNER_NUMBER), { calls });
    expect(result.status).toBe(200);
    const body = result.body as {
      assistantId: string;
      assistantOverrides: {
        firstMessage: string;
        variableValues: Record<string, string>;
        model: { messages: { content: string }[] };
      };
    };
    expect(body.assistantId).toBe("assistant-owner");
    expect(body.assistantOverrides.firstMessage).toBe("Hey Matt. I’m here. What do you need?");
    expect(body.assistantOverrides.variableValues.welcome).toBe(
      body.assistantOverrides.firstMessage,
    );
    const prompt = body.assistantOverrides.model.messages[0]?.content ?? "";
    expect(prompt).toContain("Food logged, last 24 hours");
    expect(prompt).not.toMatch(/\{\{|\$json/);
    // Sources were fetched concurrently and none of them hit Vapi's create endpoint.
    expect(calls.some((c) => c.startsWith("POST https://api.vapi.ai"))).toBe(false);
  });

  it("never gives private context to unknown or spoofed callers", async () => {
    for (const payload of [
      assistantRequest(STRANGER_NUMBER),
      assistantRequest(OWNER_NUMBER, { phoneNumberId: "someone-elses-number" }),
      assistantRequest(OWNER_NUMBER, { type: "webCall" }),
      {
        message: {
          ...assistantRequest(OWNER_NUMBER).message,
          customer: { number: STRANGER_NUMBER },
        },
      },
    ]) {
      const result = await invoke(payload);
      expect(result.body).toEqual({ assistantId: "assistant-public" });
    }
  });

  it("routes the coach to the coach assistant without owner overrides", async () => {
    expect((await invoke(assistantRequest(COACH_NUMBER))).body).toEqual({
      assistantId: "assistant-coach",
    });
  });

  it("uses the dedicated night assistant and calm register at 3am when configured", async () => {
    const result = await invoke(assistantRequest(OWNER_NUMBER), {
      env: { CUPCAKE_VAPI_NIGHT_ASSISTANT_ID: "assistant-night" },
      nowMs: Date.parse("2026-10-17T08:00:00Z"), // 3:00 AM Chicago
    });
    const body = result.body as {
      assistantId: string;
      assistantOverrides: { firstMessage: string };
    };
    expect(body.assistantId).toBe("assistant-night");
    expect(body.assistantOverrides.firstMessage).toContain("I'm right here.");
  });

  it("serves get_call_context tool calls for the owner only", async () => {
    const toolCall = (number: string) => ({
      message: {
        type: "tool-calls",
        call: { id: CALL_ID, customer: { number } },
        toolCallList: [
          { id: "tc1", type: "function", function: { name: "get_call_context", arguments: {} } },
        ],
      },
    });
    const owner = (await invoke(toolCall(OWNER_NUMBER))).body as {
      results: { toolCallId: string; result: string }[];
    };
    expect(owner.results[0]?.toolCallId).toBe("tc1");
    expect(JSON.parse(owner.results[0]?.result ?? "{}")).toMatchObject({ spend_7d: "$64.44" });
    const stranger = (await invoke(toolCall(STRANGER_NUMBER))).body as {
      results: { result: string }[];
    };
    expect(JSON.parse(stranger.results[0]?.result ?? "{}")).toEqual({ available: false });
  });

  it("acknowledges informational events", async () => {
    expect((await invoke({ message: { type: "status-update", status: "ended" } })).body).toEqual(
      {},
    );
  });
});
