/**
 * Cupcake Runtime Governance Guard
 * ────────────────────────────────────────────────────────────────────────────
 * Enforces spending caps, rate limits, and loop detection to prevent runaway
 * costs, flooding, or stuck tool chains.
 *
 * Three protection layers:
 *   1. Spending caps    — per-session and per-day USD estimates
 *   2. Volume limits    — max messages per minute per channel
 *   3. Loop detection   — same tool called 5+ times with identical args
 *
 * All thresholds configurable via .env.
 *
 * Env vars:
 *   CUPCAKE_SPENDING_CAP_SESSION_USD=1.00   — max spend per session (default: $1)
 *   CUPCAKE_SPENDING_CAP_DAILY_USD=10.00    — max spend per day (default: $10)
 *   CUPCAKE_RATE_LIMIT_MSG_PER_MIN=20       — max messages/minute/channel (default: 20)
 *   CUPCAKE_LOOP_DETECTION_THRESHOLD=5      — identical tool calls before break (default: 5)
 *   CUPCAKE_GOVERNANCE_ALERT_TELEGRAM_ID=   — where to send alerts
 *   CUPCAKE_GOVERNANCE_ENABLED=true         — master enable switch (default: true)
 */

import { createSubsystemLogger } from "../logging/subsystem.js";
import { emitActivity } from "../logging/activity-log.js";

const log = createSubsystemLogger("cupcake/runtime-guard");

// ─── Cost estimates per 1M tokens (USD) ──────────────────────────────────────
// Approximate as of 2026; update if pricing changes

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 0.25, output: 1.25 },
  "grok-4-1-fast": { input: 1.5, output: 6 },
  "grok-3-mini": { input: 0.2, output: 0.4 },
  "qwen3:72b": { input: 0, output: 0 },  // local = free
  default: { input: 5, output: 20 },
};

function estimateCostUsd(modelId: string, inputTokens: number, outputTokens: number): number {
  const lower = modelId.toLowerCase();
  const costKey = Object.keys(MODEL_COSTS).find(k => lower.includes(k)) ?? "default";
  const costs = MODEL_COSTS[costKey]!;
  return (inputTokens / 1_000_000) * costs.input + (outputTokens / 1_000_000) * costs.output;
}

// ─── State ────────────────────────────────────────────────────────────────────

type SpendRecord = {
  sessionSpendUsd: number;
  dailySpendUsd: number;
  dayKey: string; // YYYY-MM-DD
};

type RateLimitRecord = {
  windowStart: number;
  count: number;
};

type ToolCallRecord = {
  toolName: string;
  argsHash: string;
  count: number;
};

const spendBySession = new Map<string, SpendRecord>();
let globalDailySpend = 0;
let globalDayKey = new Date().toISOString().slice(0, 10);

const rateLimitByChannel = new Map<string, RateLimitRecord>();
const toolCallHistory = new Map<string, ToolCallRecord>(); // key: sessionId

// ─── Config ───────────────────────────────────────────────────────────────────

function getConfig() {
  const isEnabled = process.env.CUPCAKE_GOVERNANCE_ENABLED !== "false";
  return {
    enabled: isEnabled,
    spendCapSessionUsd: parseFloat(process.env.CUPCAKE_SPENDING_CAP_SESSION_USD ?? "1.00"),
    spendCapDailyUsd: parseFloat(process.env.CUPCAKE_SPENDING_CAP_DAILY_USD ?? "10.00"),
    rateLimitMsgPerMin: parseInt(process.env.CUPCAKE_RATE_LIMIT_MSG_PER_MIN ?? "20", 10),
    loopThreshold: parseInt(process.env.CUPCAKE_LOOP_DETECTION_THRESHOLD ?? "5", 10),
    alertTelegramId: process.env.CUPCAKE_GOVERNANCE_ALERT_TELEGRAM_ID ?? process.env.CUPCAKE_HEARTBEAT_TELEGRAM_ID,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

function resetDailyIfNeeded(): void {
  const today = todayKey();
  if (today !== globalDayKey) {
    globalDayKey = today;
    globalDailySpend = 0;
    spendBySession.clear();
    log.info("Daily spend counter reset", { date: today });
  }
}

// ─── Governance results ───────────────────────────────────────────────────────

export type GovernanceViolation = {
  kind: "spending_cap" | "rate_limit" | "loop_detected";
  message: string;
  details: Record<string, unknown>;
};

export type GovernanceResult =
  | { allowed: true }
  | { allowed: false; violation: GovernanceViolation };

// ─── Layer 1: Spending caps ───────────────────────────────────────────────────

export function recordTokenUsage(opts: {
  sessionId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
}): void {
  const { sessionId, modelId, inputTokens, outputTokens } = opts;
  const costUsd = estimateCostUsd(modelId, inputTokens, outputTokens);

  resetDailyIfNeeded();

  const existing = spendBySession.get(sessionId) ?? {
    sessionSpendUsd: 0,
    dailySpendUsd: 0,
    dayKey: todayKey(),
  };

  existing.sessionSpendUsd += costUsd;
  globalDailySpend += costUsd;

  spendBySession.set(sessionId, existing);

  emitActivity({
    event: "model_response",
    session_id: sessionId,
    model: modelId,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    meta: { estimatedCostUsd: costUsd, sessionTotalUsd: existing.sessionSpendUsd, dailyTotalUsd: globalDailySpend },
  });
}

export function checkSpendingCap(sessionId: string): GovernanceResult {
  const config = getConfig();
  if (!config.enabled) return { allowed: true };

  resetDailyIfNeeded();

  const record = spendBySession.get(sessionId);
  const sessionSpend = record?.sessionSpendUsd ?? 0;

  if (sessionSpend >= config.spendCapSessionUsd) {
    const msg = `Session spending cap hit: $${sessionSpend.toFixed(4)} >= $${config.spendCapSessionUsd} limit`;
    log.warn(msg, { sessionId, sessionSpend, cap: config.spendCapSessionUsd });
    return {
      allowed: false,
      violation: { kind: "spending_cap", message: msg, details: { sessionSpend, cap: config.spendCapSessionUsd, type: "session" } },
    };
  }

  if (globalDailySpend >= config.spendCapDailyUsd) {
    const msg = `Daily spending cap hit: $${globalDailySpend.toFixed(4)} >= $${config.spendCapDailyUsd} limit`;
    log.warn(msg, { dailySpend: globalDailySpend, cap: config.spendCapDailyUsd });
    return {
      allowed: false,
      violation: { kind: "spending_cap", message: msg, details: { dailySpend: globalDailySpend, cap: config.spendCapDailyUsd, type: "daily" } },
    };
  }

  return { allowed: true };
}

export function getSpendSummary(): { sessions: Record<string, number>; dailyTotal: number; cap: { session: number; daily: number } } {
  const config = getConfig();
  const sessions: Record<string, number> = {};
  for (const [id, rec] of spendBySession) {
    sessions[id] = rec.sessionSpendUsd;
  }
  return {
    sessions,
    dailyTotal: globalDailySpend,
    cap: { session: config.spendCapSessionUsd, daily: config.spendCapDailyUsd },
  };
}

// ─── Layer 2: Rate limiting ───────────────────────────────────────────────────

export function checkRateLimit(channel: string): GovernanceResult {
  const config = getConfig();
  if (!config.enabled) return { allowed: true };

  const now = Date.now();
  const windowMs = 60_000; // 1 minute

  const record = rateLimitByChannel.get(channel) ?? { windowStart: now, count: 0 };

  if (now - record.windowStart > windowMs) {
    record.windowStart = now;
    record.count = 0;
  }

  record.count++;
  rateLimitByChannel.set(channel, record);

  if (record.count > config.rateLimitMsgPerMin) {
    const msg = `Rate limit exceeded on ${channel}: ${record.count} messages/min (limit: ${config.rateLimitMsgPerMin})`;
    log.warn(msg, { channel, count: record.count, limit: config.rateLimitMsgPerMin });
    return {
      allowed: false,
      violation: { kind: "rate_limit", message: msg, details: { channel, count: record.count, limit: config.rateLimitMsgPerMin } },
    };
  }

  return { allowed: true };
}

// ─── Layer 3: Loop detection ──────────────────────────────────────────────────

export function checkToolLoop(opts: {
  sessionId: string;
  toolName: string;
  toolArgs: unknown;
}): GovernanceResult {
  const config = getConfig();
  if (!config.enabled) return { allowed: true };

  const { sessionId, toolName, toolArgs } = opts;
  const argsHash = simpleHash(JSON.stringify(toolArgs));
  const key = sessionId;
  const existing = toolCallHistory.get(key);

  if (existing && existing.toolName === toolName && existing.argsHash === argsHash) {
    existing.count++;
    toolCallHistory.set(key, existing);

    if (existing.count >= config.loopThreshold) {
      const msg = `Loop detected: "${toolName}" called ${existing.count} times with identical args in session ${sessionId}`;
      log.error(msg, { toolName, count: existing.count, threshold: config.loopThreshold });
      emitActivity({
        event: "error",
        session_id: sessionId,
        error: msg,
        tool: toolName,
        meta: { loopCount: existing.count, argsHash },
      });
      return {
        allowed: false,
        violation: {
          kind: "loop_detected",
          message: msg,
          details: { toolName, count: existing.count, threshold: config.loopThreshold, argsHash },
        },
      };
    }
  } else {
    toolCallHistory.set(key, { toolName, argsHash, count: 1 });
  }

  return { allowed: true };
}

export function resetLoopCounter(sessionId: string): void {
  toolCallHistory.delete(sessionId);
}

// ─── Unified check ────────────────────────────────────────────────────────────

export function checkAll(opts: {
  sessionId: string;
  channel: string;
  toolName?: string;
  toolArgs?: unknown;
}): GovernanceResult {
  const { sessionId, channel, toolName, toolArgs } = opts;

  const rateLimitResult = checkRateLimit(channel);
  if (!rateLimitResult.allowed) return rateLimitResult;

  const spendResult = checkSpendingCap(sessionId);
  if (!spendResult.allowed) return spendResult;

  if (toolName !== undefined) {
    const loopResult = checkToolLoop({ sessionId, toolName, toolArgs });
    if (!loopResult.allowed) return loopResult;
  }

  return { allowed: true };
}

// ─── Governance report ────────────────────────────────────────────────────────

export function getGovernanceReport(): string {
  const spend = getSpendSummary();
  const config = getConfig();

  const lines = [
    "## Runtime Governance Report",
    `- Governance enabled: ${config.enabled}`,
    `- Daily spend: $${spend.dailyTotal.toFixed(4)} / $${spend.cap.daily} cap`,
    `- Session cap: $${spend.cap.session}`,
    `- Rate limit: ${config.rateLimitMsgPerMin} msg/min per channel`,
    `- Loop threshold: ${config.loopThreshold} identical calls`,
    "",
    "### Active sessions:",
  ];

  for (const [id, amount] of Object.entries(spend.sessions)) {
    lines.push(`  ${id.slice(0, 12)}: $${amount.toFixed(4)}`);
  }

  if (Object.keys(spend.sessions).length === 0) {
    lines.push("  (no active sessions)");
  }

  return lines.join("\n");
}
