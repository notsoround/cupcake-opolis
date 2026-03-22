/**
 * Cupcake Observability — Metrics Collector
 * ────────────────────────────────────────────────────────────────────────────
 * Collects, aggregates, and exposes structured metrics from the activity log.
 *
 * Tracks:
 *   - Messages per channel per day
 *   - Model usage breakdown (which model handled what %)
 *   - Tool call frequency (top tools)
 *   - Error rate and error types
 *   - Average response time
 *   - Estimated token cost per day
 *
 * Env vars:
 *   CUPCAKE_METRICS_ENABLED=true
 *   CUPCAKE_METRICS_FILE=~/.openclaw/logs/metrics.jsonl
 *   CUPCAKE_WEEKLY_DIGEST_TELEGRAM_ID=<chat_id>
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { ActivityEvent } from "../logging/activity-log.js";

const log = createSubsystemLogger("cupcake/metrics");

// ─── Types ────────────────────────────────────────────────────────────────────

export type DailyMetrics = {
  date: string;          // YYYY-MM-DD
  totalMessages: number;
  messagesIn: number;
  messagesOut: number;
  byChannel: Record<string, number>;
  byModel: Record<string, number>;
  byTool: Record<string, number>;
  errors: number;
  errorTypes: Record<string, number>;
  avgResponseMs: number;
  p95ResponseMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUsd: number;
  sessions: number;
  heartbeats: number;
};

// ─── Model cost table (USD per 1M tokens) ────────────────────────────────────

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6": { input: 15.0, output: 75.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 0.25, output: 1.25 },
  "grok-4-1-fast": { input: 1.5, output: 6.0 },
  "grok-3-mini": { input: 0.2, output: 0.4 },
  "qwen3:72b": { input: 0, output: 0 },
  "qwen3:32b": { input: 0, output: 0 },
  default: { input: 5.0, output: 20.0 },
};

function estimateCost(modelId: string, input: number, output: number): number {
  const key = Object.keys(MODEL_COSTS).find(k => (modelId ?? "").toLowerCase().includes(k)) ?? "default";
  const c = MODEL_COSTS[key]!;
  return (input / 1_000_000) * c.input + (output / 1_000_000) * c.output;
}

// ─── Config ───────────────────────────────────────────────────────────────────

function resolveActivityLogPath(): string {
  const stateDir = process.env.OPENCLAW_STATE_DIR ?? process.env.OPENCLAW_HOME ?? path.join(os.homedir(), ".openclaw");
  const override = process.env.CUPCAKE_ACTIVITY_LOG_FILE?.trim();
  if (override) return override.startsWith("~") ? path.join(os.homedir(), override.slice(1)) : override;
  return path.join(stateDir, "logs", "activity.jsonl");
}

function resolveMetricsPath(): string {
  const stateDir = process.env.OPENCLAW_STATE_DIR ?? process.env.OPENCLAW_HOME ?? path.join(os.homedir(), ".openclaw");
  const override = process.env.CUPCAKE_METRICS_FILE?.trim();
  if (override) return override.startsWith("~") ? path.join(os.homedir(), override.slice(1)) : override;
  return path.join(stateDir, "logs", "metrics.jsonl");
}

// ─── Activity log reader ──────────────────────────────────────────────────────

async function readActivityEvents(sinceDate?: string): Promise<ActivityEvent[]> {
  const logPath = resolveActivityLogPath();
  try {
    const raw = await fs.readFile(logPath, "utf-8");
    return raw.split("\n")
      .filter(Boolean)
      .map(l => { try { return JSON.parse(l) as ActivityEvent; } catch { return null; } })
      .filter((e): e is ActivityEvent => e !== null)
      .filter(e => !sinceDate || e.ts >= sinceDate);
  } catch {
    return [];
  }
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

export async function computeDailyMetrics(date: string): Promise<DailyMetrics> {
  const events = await readActivityEvents(date);
  const dayEvents = events.filter(e => e.ts.startsWith(date));

  const metrics: DailyMetrics = {
    date,
    totalMessages: 0,
    messagesIn: 0,
    messagesOut: 0,
    byChannel: {},
    byModel: {},
    byTool: {},
    errors: 0,
    errorTypes: {},
    avgResponseMs: 0,
    p95ResponseMs: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    estimatedCostUsd: 0,
    sessions: 0,
    heartbeats: 0,
  };

  const responseTimes: number[] = [];
  const sessions = new Set<string>();

  for (const ev of dayEvents) {
    if (ev.channel) {
      metrics.byChannel[ev.channel] = (metrics.byChannel[ev.channel] ?? 0) + 1;
    }
    if (ev.session_id) sessions.add(ev.session_id);

    switch (ev.event) {
      case "message_in":
        metrics.messagesIn++;
        metrics.totalMessages++;
        break;
      case "message_out":
        metrics.messagesOut++;
        metrics.totalMessages++;
        if (ev.model) {
          metrics.byModel[ev.model] = (metrics.byModel[ev.model] ?? 0) + 1;
        }
        break;
      case "model_response":
        if (ev.model) {
          metrics.byModel[ev.model] = (metrics.byModel[ev.model] ?? 0) + 1;
        }
        if (ev.usage) {
          metrics.totalInputTokens += ev.usage.input_tokens ?? 0;
          metrics.totalOutputTokens += ev.usage.output_tokens ?? 0;
          metrics.estimatedCostUsd += estimateCost(
            ev.model ?? "",
            ev.usage.input_tokens ?? 0,
            ev.usage.output_tokens ?? 0
          );
        }
        if (ev.duration_ms) responseTimes.push(ev.duration_ms);
        break;
      case "tool_call":
        if (ev.tool) {
          metrics.byTool[ev.tool] = (metrics.byTool[ev.tool] ?? 0) + 1;
        }
        break;
      case "error":
        metrics.errors++;
        const errType = ev.error?.slice(0, 50) ?? "unknown";
        metrics.errorTypes[errType] = (metrics.errorTypes[errType] ?? 0) + 1;
        break;
      case "heartbeat":
        metrics.heartbeats++;
        break;
    }
  }

  metrics.sessions = sessions.size;

  if (responseTimes.length > 0) {
    metrics.avgResponseMs = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    const sorted = [...responseTimes].sort((a, b) => a - b);
    metrics.p95ResponseMs = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  }

  return metrics;
}

// ─── Multi-day aggregation ────────────────────────────────────────────────────

export async function computeWeeklyMetrics(): Promise<{
  days: DailyMetrics[];
  summary: {
    totalMessages: number;
    totalCostUsd: number;
    topChannels: [string, number][];
    topModels: [string, number][];
    topTools: [string, number][];
    totalErrors: number;
    avgResponseMs: number;
  };
}> {
  const days: DailyMetrics[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    days.push(await computeDailyMetrics(d));
  }

  const totalMessages = days.reduce((s, d) => s + d.totalMessages, 0);
  const totalCostUsd = days.reduce((s, d) => s + d.estimatedCostUsd, 0);
  const totalErrors = days.reduce((s, d) => s + d.errors, 0);

  const channelTotals: Record<string, number> = {};
  const modelTotals: Record<string, number> = {};
  const toolTotals: Record<string, number> = {};
  const respTimes: number[] = [];

  for (const d of days) {
    for (const [k, v] of Object.entries(d.byChannel)) channelTotals[k] = (channelTotals[k] ?? 0) + v;
    for (const [k, v] of Object.entries(d.byModel)) modelTotals[k] = (modelTotals[k] ?? 0) + v;
    for (const [k, v] of Object.entries(d.byTool)) toolTotals[k] = (toolTotals[k] ?? 0) + v;
    if (d.avgResponseMs > 0) respTimes.push(d.avgResponseMs);
  }

  const top = (obj: Record<string, number>, n = 5): [string, number][] =>
    Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);

  return {
    days,
    summary: {
      totalMessages,
      totalCostUsd,
      topChannels: top(channelTotals),
      topModels: top(modelTotals),
      topTools: top(toolTotals),
      totalErrors,
      avgResponseMs: respTimes.length ? respTimes.reduce((a, b) => a + b, 0) / respTimes.length : 0,
    },
  };
}

// ─── Formatted report ─────────────────────────────────────────────────────────

export async function formatWeeklyDigest(): Promise<string> {
  const { days, summary } = await computeWeeklyMetrics();
  const startDate = days[0]?.date ?? "unknown";
  const endDate = days[days.length - 1]?.date ?? "unknown";

  const modelPercents = summary.topModels.map(([model, count]) => {
    const pct = summary.totalMessages > 0 ? ((count / summary.totalMessages) * 100).toFixed(1) : "0";
    const shortName = model.split("/").pop() ?? model;
    return `  ${shortName}: ${count} calls (${pct}%)`;
  });

  const lines = [
    `🎀 *Cupcake Weekly Report* (${startDate} → ${endDate})`,
    "",
    `📨 Messages: *${summary.totalMessages}* total`,
    `💰 Estimated cost: *$${summary.totalCostUsd.toFixed(4)}*`,
    `⚡ Avg response: *${Math.round(summary.avgResponseMs)}ms*`,
    `🔴 Errors: *${summary.totalErrors}*`,
    "",
    "📊 *Top channels:*",
    ...summary.topChannels.map(([ch, n]) => `  ${ch}: ${n}`),
    "",
    "🤖 *Model usage:*",
    ...modelPercents,
    "",
    "🔧 *Top tools:*",
    ...summary.topTools.map(([tool, n]) => `  ${tool}: ${n}`),
    "",
    "📅 *Daily breakdown:*",
    ...days.map(d => `  ${d.date}: ${d.totalMessages} msg, $${d.estimatedCostUsd.toFixed(4)}, ${d.errors} err`),
  ];

  return lines.join("\n");
}

// ─── Metrics persistence ──────────────────────────────────────────────────────

export async function persistDailyMetrics(metrics: DailyMetrics): Promise<void> {
  const metricsPath = resolveMetricsPath();
  await fs.mkdir(path.dirname(metricsPath), { recursive: true });
  await fs.appendFile(metricsPath, JSON.stringify({ ...metrics, ts: new Date().toISOString() }) + "\n");
  log.debug("Persisted daily metrics", { date: metrics.date });
}

// ─── Metrics endpoint (simple HTTP) ──────────────────────────────────────────

export async function startMetricsServer(port = 9090): Promise<void> {
  const { createServer } = await import("node:http");

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (url.pathname === "/metrics") {
      const today = new Date().toISOString().slice(0, 10);
      const metrics = await computeDailyMetrics(today);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(metrics, null, 2));
      return;
    }

    if (url.pathname === "/metrics/weekly") {
      const weekly = await computeWeeklyMetrics();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(weekly, null, 2));
      return;
    }

    if (url.pathname === "/metrics/digest") {
      const digest = await formatWeeklyDigest();
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(digest);
      return;
    }

    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "cupcake-metrics" }));
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(port, "127.0.0.1", () => {
    log.info(`Metrics server listening on http://127.0.0.1:${port}`);
  });
}
