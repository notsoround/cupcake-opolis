/**
 * Cupcake Permission Scoping Enforcer
 * ────────────────────────────────────────────────────────────────────────────
 * Loads config/permissions.yml and enforces tool access controls before
 * each tool invocation.
 *
 * Three-level resolution (most specific wins):
 *   1. User override (by user_id)
 *   2. Channel override (by channel ID)
 *   3. Defaults
 *
 * Each level may: use a named role, specify per-tool overrides, or both.
 *
 * Env vars:
 *   CUPCAKE_PERMISSIONS_CONFIG=./config/permissions.yml  — config file path
 *   CUPCAKE_PERMISSIONS_ENABLED=true                     — master switch
 *   CUPCAKE_OWNER_USER_ID=<telegram_user_id>             — owner's ID
 *   CUPCAKE_PRIVATE_TELEGRAM_CHANNEL=<chat_id>           — private channel ID
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { emitActivity } from "../logging/activity-log.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("cupcake/permission-check");

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToolPermission = "allow" | "deny" | "ask";
export type ToolCategory =
  | "file_read"
  | "file_write"
  | "file_delete"
  | "shell_exec"
  | "http_fetch"
  | "code_exec"
  | "memory_read"
  | "memory_write"
  | "web_search"
  | "image_gen"
  | "task_delegate"
  | "bot_config"
  | "secrets_access"
  | "all";

export type RoleDefinition = {
  tools: Partial<Record<ToolCategory, ToolPermission>>;
};

export type ChannelConfig = {
  id: string;
  role?: string;
  overrides?: Partial<Record<ToolCategory, ToolPermission>>;
  note?: string;
};

export type UserConfig = {
  id: string;
  role?: string;
  overrides?: Partial<Record<ToolCategory, ToolPermission>>;
  note?: string;
};

export type BlocklistConfig = {
  shell_patterns?: string[];
  url_patterns?: string[];
};

export type AuditConfig = {
  log_all?: boolean;
  log_denials?: boolean;
  include_args_in_log?: boolean;
};

export type PermissionsConfig = {
  roles: Record<string, RoleDefinition>;
  users?: UserConfig[];
  channels?: ChannelConfig[];
  defaults?: {
    role?: string;
    overrides?: Partial<Record<ToolCategory, ToolPermission>>;
  };
  rate_limits?: Partial<Record<ToolCategory, number>>;
  blocklist?: BlocklistConfig;
  audit?: AuditConfig;
};

export type PermissionCheckContext = {
  userId?: string;
  channelId?: string;
  sessionId?: string;
  toolName: string;
  toolCategory: ToolCategory;
  toolArgs?: unknown;
};

export type PermissionResult =
  | { granted: true }
  | { granted: false; reason: string; action: "deny" | "ask" };

// ─── Config loader ────────────────────────────────────────────────────────────

let cachedConfig: PermissionsConfig | null = null;
let configLoadedAt = 0;
const CONFIG_TTL_MS = 30_000;

function resolveConfigPath(): string {
  const envPath = process.env.CUPCAKE_PERMISSIONS_CONFIG?.trim();
  if (envPath) {
    return envPath.startsWith("~") ? path.join(os.homedir(), envPath.slice(1)) : envPath;
  }
  return path.join(process.cwd(), "config", "permissions.yml");
}

async function loadConfig(): Promise<PermissionsConfig> {
  const now = Date.now();
  if (cachedConfig && now - configLoadedAt < CONFIG_TTL_MS) {
    return cachedConfig;
  }

  const configPath = resolveConfigPath();
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    // Inline minimal YAML parser for flat structure (avoids external dep)
    const config = parseSimpleYaml(raw);
    cachedConfig = config;
    configLoadedAt = now;
    log.debug("Loaded permissions config", { path: configPath });
    return config;
  } catch (err) {
    log.warn("Could not load permissions config — using safe defaults", {
      path: configPath,
      err: String(err),
    });
    return getDefaultConfig();
  }
}

function getDefaultConfig(): PermissionsConfig {
  return {
    roles: {
      owner: { tools: { all: "allow" } },
      restricted: {
        tools: {
          file_read: "deny",
          file_write: "deny",
          file_delete: "deny",
          shell_exec: "deny",
          http_fetch: "allow",
          code_exec: "deny",
          memory_read: "deny",
          memory_write: "deny",
          web_search: "allow",
          image_gen: "deny",
          task_delegate: "deny",
          bot_config: "deny",
          secrets_access: "deny",
        },
      },
    },
    defaults: { role: "restricted" },
    audit: { log_denials: true },
  };
}

/**
 * Minimal YAML parser that handles the permissions.yml structure.
 * Supports: string values, nested objects, arrays of objects, env var interpolation.
 * Not a full YAML parser — only parses the subset used in permissions.yml.
 */
function parseSimpleYaml(yaml: string): PermissionsConfig {
  // Interpolate ${ENV_VAR} references
  const interpolated = yaml.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] ?? "");

  // Use a line-by-line state machine for simple YAML parsing
  // This handles the specific structure of permissions.yml
  // For production use, replace with 'yaml' or 'js-yaml' npm package
  const lines = interpolated.split("\n");
  const result: Record<string, unknown> = {};

  // We'll do a pragmatic parse using indentation levels
  // Parse top-level keys and their nested content
  let currentTopKey = "";
  let currentBlock: string[] = [];

  function commitBlock() {
    if (!currentTopKey || currentBlock.length === 0) return;
    result[currentTopKey] = parseBlock(currentBlock);
  }

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const topKeyMatch = line.match(/^([a-z_]+):\s*$/);
    if (topKeyMatch?.[1]) {
      commitBlock();
      currentTopKey = topKeyMatch[1];
      currentBlock = [];
      continue;
    }

    const topValueMatch = line.match(/^([a-z_]+):\s+(.+)$/);
    if (topValueMatch?.[1] && topValueMatch[2] && !line.startsWith(" ")) {
      commitBlock();
      currentTopKey = "";
      currentBlock = [];
      result[topValueMatch[1]] = parseScalar(topValueMatch[2]);
      continue;
    }

    if (currentTopKey) {
      currentBlock.push(line);
    }
  }
  commitBlock();

  return result as unknown as PermissionsConfig;
}

function parseBlock(lines: string[]): unknown {
  if (lines.length === 0) return {};

  // Detect if it's an array (lines starting with "  - ")
  const isArray = lines.some((l) => /^ {2}-/.test(l));
  if (isArray) {
    return parseArray(lines);
  }
  return parseObject(lines);
}

function parseObject(lines: string[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  let currentKey = "";
  let currentBlock: string[] = [];

  function commitSub() {
    if (currentKey && currentBlock.length > 0) {
      obj[currentKey] = parseBlock(currentBlock.map((l) => l.slice(2)));
    } else if (currentKey && currentBlock.length === 0) {
      // already set
    }
    currentKey = "";
    currentBlock = [];
  }

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const keyOnlyMatch = line.match(/^ {2}([a-z_]+):\s*$/);
    if (keyOnlyMatch?.[1]) {
      commitSub();
      currentKey = keyOnlyMatch[1];
      obj[currentKey] = {};
      continue;
    }

    const keyValueMatch = line.match(/^ {2}([a-z_]+):\s+(.+)$/);
    if (keyValueMatch?.[1] && keyValueMatch[2]) {
      commitSub();
      obj[keyValueMatch[1]] = parseScalar(keyValueMatch[2]);
      currentKey = "";
      continue;
    }

    if (currentKey) {
      currentBlock.push(line);
    }
  }
  commitSub();

  return obj;
}

function parseArray(lines: string[]): unknown[] {
  const items: unknown[] = [];
  let currentItemLines: string[] = [];

  function commitItem() {
    if (currentItemLines.length > 0) {
      const cleanLines = currentItemLines.map((l) => l.replace(/^ {2}/, ""));
      items.push(parseObject(cleanLines));
      currentItemLines = [];
    }
  }

  for (const line of lines) {
    if (/^ {2}-\s*$/.test(line) || /^ {2}-\s+\w/.test(line)) {
      commitItem();
      const rest = line.replace(/^ {2}-\s*/, "");
      if (rest) currentItemLines.push("  " + rest);
    } else {
      currentItemLines.push(line);
    }
  }
  commitItem();

  return items;
}

function parseScalar(value: string): string | number | boolean {
  const v = value.trim().replace(/^["']|["']$/g, "");
  if (v === "true") return true;
  if (v === "false") return false;
  const num = Number(v);
  if (!isNaN(num) && v !== "") return num;
  return v;
}

// ─── Permission resolution ────────────────────────────────────────────────────

function resolvePermission(config: PermissionsConfig, ctx: PermissionCheckContext): ToolPermission {
  const toolCat = ctx.toolCategory;

  function getFromRole(roleName: string): ToolPermission | null {
    const role = config.roles?.[roleName];
    if (!role) return null;
    return role.tools[toolCat] ?? role.tools["all"] ?? null;
  }

  function mergePermission(
    base: ToolPermission | null,
    overrides?: Partial<Record<ToolCategory, ToolPermission>>,
  ): ToolPermission | null {
    if (!overrides) return base;
    return overrides[toolCat] ?? overrides["all"] ?? base;
  }

  // ─── 1. User-level lookup ─────────────────────────────────────────────────
  if (ctx.userId && config.users) {
    const userConfig = config.users.find((u) => u.id === ctx.userId || u.id === "*");
    if (userConfig) {
      const rolePerm = userConfig.role ? getFromRole(userConfig.role) : null;
      const perm = mergePermission(rolePerm, userConfig.overrides);
      if (perm !== null) return perm;
    }
  }

  // ─── 2. Channel-level lookup ──────────────────────────────────────────────
  if (ctx.channelId && config.channels) {
    // Exact match first
    let channelConfig = config.channels.find((c) => c.id === ctx.channelId);
    // Wildcard fallback
    if (!channelConfig) {
      channelConfig = config.channels.find((c) => c.id === "*");
    }

    if (channelConfig) {
      const rolePerm = channelConfig.role ? getFromRole(channelConfig.role) : null;
      const perm = mergePermission(rolePerm, channelConfig.overrides);
      if (perm !== null) return perm;
    }
  }

  // ─── 3. Defaults ──────────────────────────────────────────────────────────
  if (config.defaults) {
    const rolePerm = config.defaults.role ? getFromRole(config.defaults.role) : null;
    const perm = mergePermission(rolePerm, config.defaults.overrides);
    if (perm !== null) return perm;
  }

  // Fallback: deny unknown
  return "deny";
}

// ─── Blocklist checks ─────────────────────────────────────────────────────────

function checkBlocklist(config: PermissionsConfig, ctx: PermissionCheckContext): string | null {
  const blocklist = config.blocklist;
  if (!blocklist) return null;

  if (ctx.toolCategory === "shell_exec" && blocklist.shell_patterns && ctx.toolArgs) {
    const argsStr = JSON.stringify(ctx.toolArgs).toLowerCase();
    for (const pattern of blocklist.shell_patterns) {
      if (argsStr.includes(pattern.toLowerCase())) {
        return `Shell command matches blocked pattern: "${pattern}"`;
      }
    }
  }

  if (ctx.toolCategory === "http_fetch" && blocklist.url_patterns && ctx.toolArgs) {
    const argsStr = JSON.stringify(ctx.toolArgs).toLowerCase();
    for (const pattern of blocklist.url_patterns) {
      if (argsStr.includes(pattern.toLowerCase())) {
        return `URL matches blocked pattern: "${pattern}"`;
      }
    }
  }

  return null;
}

// ─── Rate limit tracking ──────────────────────────────────────────────────────

const rateLimitCounters = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(config: PermissionsConfig, ctx: PermissionCheckContext): string | null {
  const limits = config.rate_limits;
  if (!limits) return null;

  const limit = limits[ctx.toolCategory];
  if (!limit) return null;

  const key = `${ctx.sessionId ?? ctx.channelId ?? "global"}:${ctx.toolCategory}`;
  const now = Date.now();
  const windowMs = 60_000;

  const record = rateLimitCounters.get(key) ?? { count: 0, windowStart: now };
  if (now - record.windowStart > windowMs) {
    record.windowStart = now;
    record.count = 0;
  }

  record.count++;
  rateLimitCounters.set(key, record);

  if (record.count > limit) {
    return `Rate limit exceeded for ${ctx.toolCategory}: ${record.count}/${limit} per minute`;
  }

  return null;
}

// ─── Main check ───────────────────────────────────────────────────────────────

/**
 * Check if a tool invocation is permitted.
 * Call this before executing any tool.
 */
export async function checkPermission(ctx: PermissionCheckContext): Promise<PermissionResult> {
  if (process.env.CUPCAKE_PERMISSIONS_ENABLED === "false") {
    return { granted: true };
  }

  const config = await loadConfig();
  const audit = config.audit ?? { log_denials: true };

  // ─── Blocklist check (always before role check) ────────────────────────────
  const blockReason = checkBlocklist(config, ctx);
  if (blockReason) {
    if (audit.log_denials) {
      log.warn("Permission denied (blocklist)", {
        tool: ctx.toolName,
        category: ctx.toolCategory,
        userId: ctx.userId,
        channelId: ctx.channelId,
        reason: blockReason,
      });
      emitActivity({
        event: "error",
        session_id: ctx.sessionId,
        tool: ctx.toolName,
        error: `Permission denied: ${blockReason}`,
        meta: { category: ctx.toolCategory, userId: ctx.userId, channelId: ctx.channelId },
      });
    }
    return { granted: false, reason: blockReason, action: "deny" };
  }

  // ─── Rate limit check ──────────────────────────────────────────────────────
  const rateLimitReason = checkRateLimit(config, ctx);
  if (rateLimitReason) {
    if (audit.log_denials) {
      log.warn("Permission denied (rate limit)", { tool: ctx.toolName, reason: rateLimitReason });
    }
    return { granted: false, reason: rateLimitReason, action: "deny" };
  }

  // ─── Role-based permission ─────────────────────────────────────────────────
  const permission = resolvePermission(config, ctx);

  if (audit.log_all) {
    log.debug("Permission check", {
      tool: ctx.toolName,
      category: ctx.toolCategory,
      userId: ctx.userId,
      channelId: ctx.channelId,
      result: permission,
    });
  }

  if (permission === "deny") {
    const reason = `Tool "${ctx.toolName}" (${ctx.toolCategory}) is not permitted in this context`;
    if (audit.log_denials) {
      log.warn("Permission denied", {
        tool: ctx.toolName,
        category: ctx.toolCategory,
        userId: ctx.userId,
        channelId: ctx.channelId,
      });
      emitActivity({
        event: "error",
        session_id: ctx.sessionId,
        tool: ctx.toolName,
        error: `Permission denied: ${reason}`,
        meta: { category: ctx.toolCategory, userId: ctx.userId, channelId: ctx.channelId },
      });
    }
    return { granted: false, reason, action: "deny" };
  }

  if (permission === "ask") {
    return {
      granted: false,
      reason: `Tool "${ctx.toolName}" requires explicit confirmation before use`,
      action: "ask",
    };
  }

  return { granted: true };
}

/**
 * Map a tool name to a category.
 * Extend this as new tools are added.
 */
export function categorizeTooll(toolName: string): ToolCategory {
  const tool = toolName.toLowerCase();

  if (
    tool.includes("read_file") ||
    tool.includes("file_read") ||
    tool.includes("glob") ||
    tool.includes("grep")
  )
    return "file_read";
  if (tool.includes("write") || tool.includes("edit") || tool.includes("create"))
    return "file_write";
  if (tool.includes("delete") || tool.includes("remove") || tool.includes("rm"))
    return "file_delete";
  if (
    tool.includes("bash") ||
    tool.includes("shell") ||
    tool.includes("exec") ||
    tool.includes("run")
  )
    return "shell_exec";
  if (
    tool.includes("fetch") ||
    tool.includes("http") ||
    tool.includes("request") ||
    tool.includes("url")
  )
    return "http_fetch";
  if (tool.includes("python") || tool.includes("code_exec") || tool.includes("notebook"))
    return "code_exec";
  if (tool.includes("memory") && (tool.includes("get") || tool.includes("read")))
    return "memory_read";
  if (
    tool.includes("memory") &&
    (tool.includes("set") || tool.includes("write") || tool.includes("store"))
  )
    return "memory_write";
  if (tool.includes("search") || tool.includes("web_search")) return "web_search";
  if (tool.includes("image") || tool.includes("dalle") || tool.includes("gen_image"))
    return "image_gen";
  if (tool.includes("task") || tool.includes("delegate") || tool.includes("enqueue"))
    return "task_delegate";
  if (tool.includes("config") || tool.includes("settings") || tool.includes("bot_config"))
    return "bot_config";
  if (
    tool.includes("secret") ||
    tool.includes("token") ||
    tool.includes("key") ||
    tool.includes("credential")
  )
    return "secrets_access";

  return "all"; // unknown → catch-all
}

/**
 * Create a permission-checking wrapper for a tool executor.
 *
 * Usage:
 *   const safeExecute = withPermissionCheck(myToolExecutor, {
 *     userId: ctx.userId,
 *     channelId: ctx.channelId,
 *     sessionId: ctx.sessionId,
 *   });
 *   const result = await safeExecute("bash", { command: "ls -la" });
 */
export function withPermissionCheck(
  executor: (toolName: string, toolArgs: unknown) => Promise<unknown>,
  context: { userId?: string; channelId?: string; sessionId?: string },
) {
  return async function permissionGuardedExecutor(
    toolName: string,
    toolArgs: unknown,
  ): Promise<unknown> {
    const toolCategory = categorizeTooll(toolName);
    const result = await checkPermission({
      ...context,
      toolName,
      toolCategory,
      toolArgs,
    });

    if (!result.granted) {
      if (result.action === "ask") {
        throw new Error(`⚠️ Confirmation required: ${result.reason}`);
      }
      throw new Error(`🚫 Permission denied: ${result.reason}`);
    }

    return executor(toolName, toolArgs);
  };
}

/**
 * Get a summary of current permissions for a given context (for debugging).
 */
export async function getPermissionSummary(ctx: {
  userId?: string;
  channelId?: string;
}): Promise<Record<ToolCategory, ToolPermission>> {
  const config = await loadConfig();
  const categories: ToolCategory[] = [
    "file_read",
    "file_write",
    "file_delete",
    "shell_exec",
    "http_fetch",
    "code_exec",
    "memory_read",
    "memory_write",
    "web_search",
    "image_gen",
    "task_delegate",
    "bot_config",
    "secrets_access",
  ];

  const summary: Partial<Record<ToolCategory, ToolPermission>> = {};
  for (const cat of categories) {
    summary[cat] = resolvePermission(config, {
      ...ctx,
      toolName: cat,
      toolCategory: cat,
    });
  }

  return summary as Record<ToolCategory, ToolPermission>;
}

/**
 * Reload config from disk (for hot-reload after edits).
 */
export function invalidatePermissionsCache(): void {
  cachedConfig = null;
  configLoadedAt = 0;
  log.info("Permissions cache cleared");
}
