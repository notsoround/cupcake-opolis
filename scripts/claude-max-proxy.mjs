#!/usr/bin/env node
/**
 * Cupcake claude-max-api-proxy
 * ────────────────────────────────────────────────────────────────────────────
 * A lightweight local HTTP proxy that translates Anthropic API requests to
 * Claude.ai web interface calls, letting you use your Claude Max subscription
 * ($100/mo or $200/mo) instead of paying per-token API fees.
 *
 * Architecture:
 *   OpenClaw (Cupcake) → http://localhost:7199 (this proxy) → claude.ai
 *
 * Setup:
 *   1. Get your Claude.ai session cookie:
 *      - Open claude.ai in Chrome/Firefox
 *      - DevTools → Application → Cookies → claude.ai
 *      - Copy the value of the `sessionKey` cookie
 *
 *   2. Set env vars in ~/.openclaw/.env:
 *        CUPCAKE_MAX_PROXY_ENABLED=true
 *        CUPCAKE_MAX_PROXY_SESSION_KEY=<your-sessionKey-cookie-value>
 *        CUPCAKE_MAX_PROXY_PORT=7199          # optional, default 7199
 *        CUPCAKE_MAX_PROXY_ORG_ID=            # optional, for Team/Enterprise
 *
 *   3. Register the proxy as an Anthropic provider in ~/.openclaw/openclaw.json:
 *        {
 *          "agents": {
 *            "providers": [
 *              {
 *                "id": "claude-max",
 *                "name": "Claude Max (via local proxy)",
 *                "api": "anthropic-messages",
 *                "baseURL": "http://localhost:7199",
 *                "apiKey": "dummy-not-used",
 *                "models": [
 *                  {
 *                    "id": "claude-opus-4-6",
 *                    "name": "Claude Opus 4.6 (Max)"
 *                  },
 *                  {
 *                    "id": "claude-sonnet-4-6",
 *                    "name": "Claude Sonnet 4.6 (Max)"
 *                  }
 *                ]
 *              }
 *            ]
 *          }
 *        }
 *
 *   4. Start the proxy (runs in foreground; use pm2/systemd for persistent):
 *        node scripts/claude-max-proxy.mjs
 *
 *   5. Set the primary model in ~/.openclaw/openclaw.json:
 *        { "agents": { "model": "claude-max/claude-opus-4-6" } }
 *
 * NOTE: This uses Claude.ai's unofficial internal API. It may break if
 * Anthropic changes their web interface. Use responsibly and per the ToS.
 * For production, prefer the official Anthropic API with API credits.
 *
 * Alternative: Use the ANTHROPIC_BASE_URL env var to point to any
 * OpenAI-compatible proxy (e.g., LiteLLM, OpenRouter, Vertex AI proxy).
 */

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// ─── Config ───────────────────────────────────────────────────────────────────

async function loadEnv() {
  const envPaths = [
    path.join(os.homedir(), ".openclaw", ".env"),
    path.join(process.cwd(), ".env"),
  ];
  const env = {};
  for (const envPath of envPaths) {
    try {
      const content = await fs.readFile(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const idx = trimmed.indexOf("=");
        if (idx === -1) continue;
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
        env[key] = val;
      }
    } catch { /* optional */ }
  }
  return { ...process.env, ...env };
}

// ─── Proxy request handler ────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function makeClaudeRequest(sessionKey, orgId, endpoint, body, method = "POST") {
  const baseURL = "https://api.claude.ai";
  const orgPath = orgId ? `/api/organizations/${orgId}` : "/api";
  const url = new URL(`${orgPath}${endpoint}`, baseURL);

  const headers = {
    "cookie": `sessionKey=${sessionKey}`,
    "content-type": "application/json",
    "accept": "application/json, text/event-stream",
    "origin": "https://claude.ai",
    "referer": "https://claude.ai/",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "anthropic-client-sha": "unknown",
    "anthropic-client-version": "unknown",
  };

  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers,
    };

    const req = https.request(options, resolve);
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Translate Anthropic API /v1/messages request → Claude.ai conversation
 * and stream back a compatible response.
 *
 * NOTE: This is a simplified translation layer. For full feature parity
 * (tool calls, vision, etc.) a more complete implementation is needed.
 * This covers the core text generation use case.
 */
async function handleMessagesRequest(req, res, env, bodyStr) {
  const sessionKey = env.CUPCAKE_MAX_PROXY_SESSION_KEY;
  const orgId = env.CUPCAKE_MAX_PROXY_ORG_ID || "";

  if (!sessionKey) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({
      error: {
        type: "authentication_error",
        message: "CUPCAKE_MAX_PROXY_SESSION_KEY not set. See scripts/claude-max-proxy.mjs for setup.",
      },
    }));
    return;
  }

  let requestBody;
  try {
    requestBody = JSON.parse(bodyStr);
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { type: "invalid_request_error", message: "Invalid JSON body" } }));
    return;
  }

  // Extract the last user message for the prompt
  const messages = requestBody.messages ?? [];
  const systemPrompt = requestBody.system ?? "";
  const model = requestBody.model ?? "claude-opus-4-6";
  const stream = requestBody.stream ?? false;

  // Build a conversation-style payload for Claude.ai
  // Claude.ai uses a different conversation format — we send as a new convo
  const conversationPayload = {
    model,
    prompt: [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    max_tokens: requestBody.max_tokens ?? 4096,
    temperature: requestBody.temperature ?? 1.0,
  };

  try {
    // Create a new conversation
    const createRes = await makeClaudeRequest(
      sessionKey,
      orgId,
      "/conversations",
      JSON.stringify({ name: `cupcake-proxy-${Date.now()}` })
    );

    let createBody = "";
    for await (const chunk of createRes) {
      createBody += chunk.toString();
    }

    const conversation = JSON.parse(createBody);
    const conversationId = conversation.uuid;

    if (!conversationId) {
      throw new Error(`Could not create conversation. Response: ${createBody.slice(0, 200)}`);
    }

    // Send the message
    const msgPayload = JSON.stringify({
      prompt: messages.at(-1)?.content ?? "",
      model,
      timezone: "America/Chicago",
      attachments: [],
      files: [],
      ...(systemPrompt ? { system_prompt: systemPrompt } : {}),
      rendering_mode: "raw",
    });

    const msgRes = await makeClaudeRequest(
      sessionKey,
      orgId,
      `/conversations/${conversationId}/completion`,
      msgPayload
    );

    // Stream or buffer the response
    if (stream) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "connection": "keep-alive",
      });

      let fullText = "";
      let inputTokens = 0;
      let outputTokens = 0;

      // Send stream start event
      res.write(`data: ${JSON.stringify({
        type: "message_start",
        message: { id: `msg_${Date.now()}`, type: "message", role: "assistant", content: [], model, stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } }
      })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`);

      for await (const chunk of msgRes) {
        const text = chunk.toString();
        // Claude.ai streams Server-Sent Events
        for (const line of text.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6).trim();
          if (!dataStr || dataStr === "[DONE]") continue;
          try {
            const data = JSON.parse(dataStr);
            if (data.type === "content_block_delta" && data.delta?.text) {
              fullText += data.delta.text;
              res.write(`data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: data.delta.text } })}\n\n`);
            } else if (data.completion) {
              // Older format
              fullText += data.completion;
              res.write(`data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: data.completion } })}\n\n`);
            }
          } catch { /* skip malformed events */ }
        }
      }

      // Estimate tokens (rough: 4 chars ≈ 1 token)
      inputTokens = Math.ceil(messages.reduce((n, m) => n + String(m.content).length, 0) / 4);
      outputTokens = Math.ceil(fullText.length / 4);

      res.write(`data: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: outputTokens } })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "message_stop" })}\n\n`);
      res.end();
    } else {
      // Non-streaming: buffer full response
      let rawResponse = "";
      for await (const chunk of msgRes) {
        rawResponse += chunk.toString();
      }

      // Extract text from SSE stream
      let fullText = "";
      for (const line of rawResponse.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const dataStr = line.slice(6).trim();
        if (!dataStr || dataStr === "[DONE]") continue;
        try {
          const data = JSON.parse(dataStr);
          if (data.type === "content_block_delta" && data.delta?.text) {
            fullText += data.delta.text;
          } else if (data.completion) {
            fullText += data.completion;
          }
        } catch { /* skip */ }
      }

      const inputTokens = Math.ceil(messages.reduce((n, m) => n + String(m.content).length, 0) / 4);
      const outputTokens = Math.ceil(fullText.length / 4);

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: `msg_proxy_${Date.now()}`,
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: fullText }],
        model,
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      }));
    }
  } catch (err) {
    console.error("[claude-max-proxy] Error:", err.message);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({
      error: { type: "api_error", message: `Proxy error: ${err.message}` },
    }));
  }
}

// ─── Server ───────────────────────────────────────────────────────────────────

async function main() {
  const env = await loadEnv();
  const port = parseInt(env.CUPCAKE_MAX_PROXY_PORT ?? "7199", 10);

  if (env.CUPCAKE_MAX_PROXY_ENABLED !== "true" && env.CUPCAKE_MAX_PROXY_ENABLED !== "1") {
    console.log("[claude-max-proxy] CUPCAKE_MAX_PROXY_ENABLED is not set to 'true'. Exiting.");
    console.log("  Set CUPCAKE_MAX_PROXY_ENABLED=true in ~/.openclaw/.env to enable.");
    process.exit(0);
  }

  if (!env.CUPCAKE_MAX_PROXY_SESSION_KEY) {
    console.warn("[claude-max-proxy] WARNING: CUPCAKE_MAX_PROXY_SESSION_KEY not set.");
    console.warn("  Get it from claude.ai cookies (DevTools → Application → Cookies → sessionKey)");
    console.warn("  Starting anyway — requests will return 401 until you set it.");
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const body = await readBody(req);
    const bodyStr = body.toString("utf-8");

    // CORS headers for local dev
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type, authorization, x-api-key");
    res.setHeader("access-control-allow-methods", "POST, GET, OPTIONS");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    console.log(`[claude-max-proxy] ${req.method} ${url.pathname}`);

    if (url.pathname === "/v1/messages" && req.method === "POST") {
      await handleMessagesRequest(req, res, env, bodyStr);
      return;
    }

    if (url.pathname === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        data: [
          { id: "claude-opus-4-6", object: "model" },
          { id: "claude-sonnet-4-6", object: "model" },
          { id: "claude-haiku-4-5-20251001", object: "model" },
        ],
      }));
      return;
    }

    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", proxy: "claude-max-api-proxy", port }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║  Cupcake claude-max-api-proxy                               ║
║  Listening on http://127.0.0.1:${port}                       ║
╚══════════════════════════════════════════════════════════════╝

Routes Anthropic API calls → Claude.ai Max subscription session.

Config in ~/.openclaw/.env:
  CUPCAKE_MAX_PROXY_ENABLED=true        ✓ (running)
  CUPCAKE_MAX_PROXY_SESSION_KEY=...     ${env.CUPCAKE_MAX_PROXY_SESSION_KEY ? "✓ set" : "⚠ NOT SET"}
  CUPCAKE_MAX_PROXY_ORG_ID=...          ${env.CUPCAKE_MAX_PROXY_ORG_ID || "(not set, using personal)"}
  CUPCAKE_MAX_PROXY_PORT=${port}

OpenClaw provider config (in openclaw.json):
  baseURL: "http://127.0.0.1:${port}"

Health: curl http://127.0.0.1:${port}/health
`);
  });

  process.on("SIGINT", () => {
    console.log("\n[claude-max-proxy] Shutting down...");
    server.close(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error("[claude-max-proxy] Fatal:", err.message);
  process.exit(1);
});
