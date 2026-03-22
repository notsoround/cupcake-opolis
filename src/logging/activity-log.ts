/**
 * Cupcake Activity Logger — structured JSONL event stream
 *
 * Writes one JSON object per line to ~/.openclaw/logs/activity.jsonl
 * capturing every message, tool call, model response, and error.
 *
 * Env vars:
 *   CUPCAKE_ACTIVITY_LOG=1          — enable (default: enabled in production)
 *   CUPCAKE_ACTIVITY_LOG_FILE=<path> — override log file path
 *   CUPCAKE_ACTIVITY_LOG_MAX_CONTENT=2048 — max chars of content per entry (default: 2048)
 *
 * Tail the log:
 *   tail -f ~/.openclaw/logs/activity.jsonl | jq .
 *
 * Grep for errors:
 *   grep '"event":"error"' ~/.openclaw/logs/activity.jsonl | jq .
 *
 * Grep by session:
 *   grep '"session_id":"abc"' ~/.openclaw/logs/activity.jsonl | jq .
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActivityEventKind =
  | "message_in"    // user/system message received
  | "message_out"   // agent response sent
  | "tool_call"     // tool/skill invoked
  | "tool_result"   // tool returned a result
  | "model_request" // LLM API call started
  | "model_response"// LLM API call completed
  | "error"         // any error (channel, model, tool, etc.)
  | "heartbeat"     // nightly health ping
  | "session_start" // new session opened
  | "session_end";  // session closed

export type ActivityEvent = {
  /** ISO 8601 timestamp */
  ts: string;
  /** Cupcake activity event type */
  event: ActivityEventKind;
  /** Channel the message came from / went to (telegram, whatsapp, cli, web, phone, …) */
  channel?: string;
  /** Unique session identifier */
  session_id?: string;
  /** Model used for this event, e.g. "anthropic/claude-opus-4-6" */
  model?: string;
  /** Sender/actor identifier (user id, bot name, tool name) */
  actor?: string;
  /** Message or response content — truncated to CUPCAKE_ACTIVITY_LOG_MAX_CONTENT chars */
  content?: string;
  /** True if content was truncated */
  content_truncated?: boolean;
  /** Tool name when event is tool_call / tool_result */
  tool?: string;
  /** Token usage from model response */
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  /** Duration in milliseconds (model_response, tool_result) */
  duration_ms?: number;
  /** Error message if event === "error" */
  error?: string;
  /** Error stack trace (debug mode only) */
  error_stack?: string;
  /** Arbitrary extra metadata */
  meta?: Record<string, unknown>;
};

// ─── Config ───────────────────────────────────────────────────────────────────

type ActivityLogConfig = {
  enabled: boolean;
  filePath: string;
  maxContentChars: number;
};

function resolveConfig(env: NodeJS.ProcessEnv = process.env): ActivityLogConfig {
  // Default: enabled unless explicitly disabled or in test mode
  const isTest = env.VITEST === "true" || env.NODE_ENV === "test";
  const explicitFlag = env.CUPCAKE_ACTIVITY_LOG;
  const enabled = explicitFlag !== undefined
    ? explicitFlag === "1" || explicitFlag.toLowerCase() === "true"
    : !isTest;

  const stateDir = env.OPENCLAW_STATE_DIR
    ?? env.OPENCLAW_HOME
    ?? path.join(os.homedir(), ".openclaw");

  const fileOverride = env.CUPCAKE_ACTIVITY_LOG_FILE?.trim();
  const filePath = fileOverride
    ? fileOverride.startsWith("~")
      ? path.join(os.homedir(), fileOverride.slice(1))
      : fileOverride
    : path.join(stateDir, "logs", "activity.jsonl");

  const maxContentChars = parseInt(env.CUPCAKE_ACTIVITY_LOG_MAX_CONTENT ?? "2048", 10) || 2048;

  return { enabled, filePath, maxContentChars };
}

// ─── Writer (append-only, non-blocking queue) ─────────────────────────────────

type Writer = {
  write: (line: string) => void;
  filePath: string;
};

let writerInstance: Writer | null = null;
let configCache: ActivityLogConfig | null = null;

function getWriter(): Writer | null {
  const config = resolveConfig();
  if (!config.enabled) {
    return null;
  }

  // Recreate writer if path changed
  if (writerInstance && configCache?.filePath === config.filePath) {
    return writerInstance;
  }

  configCache = config;
  const filePath = config.filePath;
  const dir = path.dirname(filePath);

  const ready = fs.mkdir(dir, { recursive: true }).catch(() => undefined);
  let queue = Promise.resolve();

  writerInstance = {
    filePath,
    write: (line: string) => {
      queue = queue
        .then(() => ready)
        .then(() => fs.appendFile(filePath, line + "\n", "utf8"))
        .catch(() => undefined); // never block on log failures
    },
  };

  return writerInstance;
}

// ─── Core emit function ───────────────────────────────────────────────────────

function truncate(text: string | undefined, maxChars: number): { text?: string; truncated: boolean } {
  if (!text) return { truncated: false };
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

/**
 * Emit a structured activity event to the JSONL log.
 * Non-blocking — failures are silently swallowed to never impact bot operation.
 */
export function emitActivity(event: Omit<ActivityEvent, "ts">): void {
  try {
    const writer = getWriter();
    if (!writer) return;

    const config = configCache ?? resolveConfig();
    const { text: content, truncated: content_truncated } = truncate(
      event.content,
      config.maxContentChars
    );

    const record: ActivityEvent = {
      ts: new Date().toISOString(),
      ...event,
      ...(content !== undefined ? { content } : {}),
      ...(content_truncated ? { content_truncated: true } : {}),
    };

    writer.write(JSON.stringify(record));
  } catch {
    // Never let logging crash the bot
  }
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────

export function logMessageIn(opts: {
  channel?: string;
  session_id?: string;
  actor?: string;
  content?: string;
  meta?: Record<string, unknown>;
}): void {
  emitActivity({ event: "message_in", ...opts });
}

export function logMessageOut(opts: {
  channel?: string;
  session_id?: string;
  model?: string;
  content?: string;
  usage?: ActivityEvent["usage"];
  meta?: Record<string, unknown>;
}): void {
  emitActivity({ event: "message_out", ...opts });
}

export function logToolCall(opts: {
  channel?: string;
  session_id?: string;
  tool: string;
  content?: string;
  meta?: Record<string, unknown>;
}): void {
  emitActivity({ event: "tool_call", ...opts });
}

export function logToolResult(opts: {
  channel?: string;
  session_id?: string;
  tool: string;
  content?: string;
  duration_ms?: number;
  meta?: Record<string, unknown>;
}): void {
  emitActivity({ event: "tool_result", ...opts });
}

export function logModelRequest(opts: {
  channel?: string;
  session_id?: string;
  model?: string;
  meta?: Record<string, unknown>;
}): void {
  emitActivity({ event: "model_request", ...opts });
}

export function logModelResponse(opts: {
  channel?: string;
  session_id?: string;
  model?: string;
  content?: string;
  usage?: ActivityEvent["usage"];
  duration_ms?: number;
  meta?: Record<string, unknown>;
}): void {
  emitActivity({ event: "model_response", ...opts });
}

export function logError(opts: {
  channel?: string;
  session_id?: string;
  model?: string;
  error: string | Error;
  meta?: Record<string, unknown>;
}): void {
  const error = opts.error instanceof Error ? opts.error.message : opts.error;
  const error_stack = opts.error instanceof Error ? opts.error.stack : undefined;
  emitActivity({
    event: "error",
    channel: opts.channel,
    session_id: opts.session_id,
    model: opts.model,
    error,
    error_stack,
    meta: opts.meta,
  });
}

export function logHeartbeat(opts: {
  meta?: Record<string, unknown>;
} = {}): void {
  emitActivity({
    event: "heartbeat",
    actor: "cupcake-heartbeat",
    content: "nightly heartbeat ping",
    ...opts,
  });
}

export function logSessionStart(opts: {
  channel?: string;
  session_id?: string;
  meta?: Record<string, unknown>;
}): void {
  emitActivity({ event: "session_start", ...opts });
}

export function logSessionEnd(opts: {
  channel?: string;
  session_id?: string;
  meta?: Record<string, unknown>;
}): void {
  emitActivity({ event: "session_end", ...opts });
}

// ─── Log analysis helpers ─────────────────────────────────────────────────────

/**
 * Read and parse the activity log. Used by the log-analyzer skill.
 * Returns up to `limit` most-recent events (default 500).
 */
export async function readActivityLog(opts: {
  limit?: number;
  filterEvent?: ActivityEventKind;
  filterChannel?: string;
  filterSession?: string;
  sinceIso?: string;
} = {}): Promise<ActivityEvent[]> {
  const config = resolveConfig();
  const limit = opts.limit ?? 500;

  let raw: string;
  try {
    raw = await fs.readFile(config.filePath, "utf8");
  } catch {
    return [];
  }

  const sinceMs = opts.sinceIso ? new Date(opts.sinceIso).getTime() : 0;

  const lines = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as ActivityEvent;
      } catch {
        return null;
      }
    })
    .filter((ev): ev is ActivityEvent => ev !== null)
    .filter((ev) => {
      if (opts.filterEvent && ev.event !== opts.filterEvent) return false;
      if (opts.filterChannel && ev.channel !== opts.filterChannel) return false;
      if (opts.filterSession && ev.session_id !== opts.filterSession) return false;
      if (sinceMs && new Date(ev.ts).getTime() < sinceMs) return false;
      return true;
    });

  // Return the most-recent `limit` events
  return lines.slice(-limit);
}

/**
 * Generate a brief stats summary from the activity log (used in heartbeat/daily digest).
 */
export async function activityLogSummary(sinceIso?: string): Promise<{
  total: number;
  byEvent: Record<string, number>;
  byChannel: Record<string, number>;
  byModel: Record<string, number>;
  errors: number;
  filePath: string;
}> {
  const config = resolveConfig();
  const events = await readActivityLog({ limit: 100_000, sinceIso });

  const byEvent: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  const byModel: Record<string, number> = {};
  let errors = 0;

  for (const ev of events) {
    byEvent[ev.event] = (byEvent[ev.event] ?? 0) + 1;
    if (ev.channel) byChannel[ev.channel] = (byChannel[ev.channel] ?? 0) + 1;
    if (ev.model) byModel[ev.model] = (byModel[ev.model] ?? 0) + 1;
    if (ev.event === "error") errors++;
  }

  return { total: events.length, byEvent, byChannel, byModel, errors, filePath: config.filePath };
}
