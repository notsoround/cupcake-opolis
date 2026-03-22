/**
 * Cupcake Thread Router
 * ──────────────────────────────────────────────────────────────────────────
 * Maps Telegram chats (group_id, thread_id, user_id) to named context
 * namespaces so different threads maintain separate memory/history and
 * don't bleed into each other.
 *
 * Config file: ~/.openclaw/thread-routing.json (or CUPCAKE_THREAD_CONFIG env)
 *
 * Example config:
 * {
 *   "routes": [
 *     { "match": { "chat_id": -1001234567890, "thread_id": 12 }, "context": "crm", "label": "CRM Tasks" },
 *     { "match": { "chat_id": -1001234567890, "thread_id": 34 }, "context": "kb",  "label": "Knowledge Base" },
 *     { "match": { "chat_id": -1001234567890 },                  "context": "general", "label": "General" }
 *   ],
 *   "default_context": "main"
 * }
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("cupcake/thread-router");

// ─── Types ────────────────────────────────────────────────────────────────────

export type ThreadMatchRule = {
  /** Telegram numeric chat_id (-100xxx for groups/channels) */
  chat_id?: number;
  /** Telegram message_thread_id (topic threads in forum groups) */
  thread_id?: number;
  /** Telegram user_id for DMs */
  user_id?: number;
};

export type ThreadRoute = {
  match: ThreadMatchRule;
  /** Context namespace — used as the session/memory key */
  context: string;
  /** Human-readable label for this thread */
  label?: string;
  /** Optional: override the system prompt for this context */
  system_prompt_file?: string;
  /** Optional: restrict to specific users in this thread */
  allowed_users?: number[];
};

export type ThreadRoutingConfig = {
  routes: ThreadRoute[];
  /** Fallback context when no route matches */
  default_context: string;
};

export type ResolvedThread = {
  context: string;
  label: string;
  route?: ThreadRoute;
  is_default: boolean;
};

// ─── Config loading ───────────────────────────────────────────────────────────

let cachedConfig: ThreadRoutingConfig | null = null;
let configMtime = 0;

async function resolveConfigPath(): Promise<string> {
  const envPath = process.env.CUPCAKE_THREAD_CONFIG?.trim();
  if (envPath) {
    return envPath.startsWith("~")
      ? path.join(os.homedir(), envPath.slice(1))
      : envPath;
  }
  const stateDir =
    process.env.OPENCLAW_STATE_DIR ??
    process.env.OPENCLAW_HOME ??
    path.join(os.homedir(), ".openclaw");
  return path.join(stateDir, "thread-routing.json");
}

export async function loadThreadRoutingConfig(): Promise<ThreadRoutingConfig> {
  const configPath = await resolveConfigPath();

  try {
    const stat = await fs.stat(configPath);
    if (cachedConfig && stat.mtimeMs <= configMtime) {
      return cachedConfig;
    }

    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as ThreadRoutingConfig;
    cachedConfig = {
      routes: parsed.routes ?? [],
      default_context: parsed.default_context ?? "main",
    };
    configMtime = stat.mtimeMs;
    log.info("Thread routing config loaded", { path: configPath, routes: cachedConfig.routes.length });
    return cachedConfig;
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") {
      // Return default config — all traffic goes to "main" context
      return { routes: [], default_context: "main" };
    }
    log.warn("Failed to load thread routing config, using defaults", { error: String(err) });
    return { routes: [], default_context: "main" };
  }
}

/** Reload config from disk (call when file changes) */
export function invalidateThreadRoutingCache(): void {
  cachedConfig = null;
  configMtime = 0;
}

// ─── Route resolution ─────────────────────────────────────────────────────────

export type IncomingThreadContext = {
  chat_id?: number;
  thread_id?: number;
  user_id?: number;
};

/**
 * Resolve which context namespace this message belongs to.
 * Matching priority: most-specific (chat_id + thread_id + user_id) wins.
 */
export async function resolveThreadContext(
  ctx: IncomingThreadContext
): Promise<ResolvedThread> {
  const config = await loadThreadRoutingConfig();

  // Score each route: more matching fields = higher priority
  let bestRoute: ThreadRoute | null = null;
  let bestScore = -1;

  for (const route of config.routes) {
    const m = route.match;
    let score = 0;
    let matches = true;

    if (m.chat_id !== undefined) {
      if (ctx.chat_id !== m.chat_id) { matches = false; }
      else { score += 100; }
    }
    if (m.thread_id !== undefined) {
      if (ctx.thread_id !== m.thread_id) { matches = false; }
      else { score += 10; }
    }
    if (m.user_id !== undefined) {
      if (ctx.user_id !== m.user_id) { matches = false; }
      else { score += 1; }
    }

    if (matches && score > bestScore) {
      bestScore = score;
      bestRoute = route;
    }
  }

  if (bestRoute) {
    return {
      context: bestRoute.context,
      label: bestRoute.label ?? bestRoute.context,
      route: bestRoute,
      is_default: false,
    };
  }

  return {
    context: config.default_context,
    label: config.default_context,
    is_default: true,
  };
}

/**
 * Build a session key that includes the context namespace.
 * OpenClaw uses session keys to isolate memory — prefixing with context
 * ensures separate conversation history per thread.
 */
export function buildContextualSessionKey(
  baseSessionKey: string,
  context: string
): string {
  if (context === "main") return baseSessionKey;
  return `${context}::${baseSessionKey}`;
}

/**
 * Check if a user is allowed in the resolved thread context.
 */
export function isUserAllowedInContext(
  userId: number | undefined,
  resolvedThread: ResolvedThread
): boolean {
  const allowedUsers = resolvedThread.route?.allowed_users;
  if (!allowedUsers || allowedUsers.length === 0) return true;
  if (userId === undefined) return false;
  return allowedUsers.includes(userId);
}

// ─── Config template writer ───────────────────────────────────────────────────

/**
 * Write a starter config file if none exists.
 * Call during bot initialization.
 */
export async function ensureThreadRoutingConfig(): Promise<void> {
  const configPath = await resolveConfigPath();
  try {
    await fs.access(configPath);
    return; // Already exists
  } catch {
    // Create starter config
    const starter: ThreadRoutingConfig = {
      routes: [
        // Example routes — edit with your actual Telegram chat IDs
        // {
        //   "match": { "chat_id": -1001234567890, "thread_id": 100 },
        //   "context": "crm",
        //   "label": "CRM Tasks"
        // },
        // {
        //   "match": { "chat_id": -1001234567890, "thread_id": 200 },
        //   "context": "kb",
        //   "label": "Knowledge Base"
        // },
        // {
        //   "match": { "chat_id": -1001234567890 },
        //   "context": "general",
        //   "label": "General"
        // }
      ],
      default_context: "main",
    };

    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(starter, null, 2) + "\n");
    log.info("Created starter thread-routing.json", { path: configPath });
  }
}
