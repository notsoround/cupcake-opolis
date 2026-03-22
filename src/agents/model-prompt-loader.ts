/**
 * Cupcake Model Prompt Loader
 * ────────────────────────────────────────────────────────────────────────────
 * Loads the appropriate model-specific system prompt when the LLM switches.
 * Each model in the fallback chain (Claude → Grok → Qwen3) has a tuned prompt.
 *
 * Prompt files (in repo: prompts/, overridable via CUPCAKE_PROMPTS_DIR):
 *   claude-prompt.md  — Anthropic Claude (opus/sonnet/haiku)
 *   grok-prompt.md    — xAI Grok (fast/mini)
 *   qwen-prompt.md    — Qwen3 local (via Ollama)
 *   default-prompt.md — Fallback for any other model
 *
 * Usage:
 *   import { loadModelPrompt } from "./model-prompt-loader.js";
 *   const systemPrompt = await loadModelPrompt("anthropic/claude-opus-4-6");
 *
 * Env vars:
 *   CUPCAKE_PROMPTS_DIR=./prompts     — directory for prompt files
 *   CUPCAKE_PROMPT_CLAUDE=./prompts/claude-prompt.md   — override per-model
 *   CUPCAKE_PROMPT_GROK=./prompts/grok-prompt.md
 *   CUPCAKE_PROMPT_QWEN=./prompts/qwen-prompt.md
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("cupcake/model-prompt-loader");

// ─── Model family detection ───────────────────────────────────────────────────

export type ModelFamily = "claude" | "grok" | "qwen" | "openai" | "gemini" | "mistral" | "default";

export function detectModelFamily(modelId: string): ModelFamily {
  const lower = modelId.toLowerCase();

  if (lower.includes("claude") || lower.includes("anthropic")) return "claude";
  if (lower.includes("grok") || lower.includes("xai")) return "grok";
  if (lower.includes("qwen")) return "qwen";
  if (lower.includes("gpt") || lower.includes("openai") || lower.includes("o1") || lower.includes("o3")) return "openai";
  if (lower.includes("gemini") || lower.includes("google")) return "gemini";
  if (lower.includes("mistral") || lower.includes("mixtral")) return "mistral";

  return "default";
}

// ─── Prompt file resolution ───────────────────────────────────────────────────

function resolvePromptsDir(): string {
  const envDir = process.env.CUPCAKE_PROMPTS_DIR?.trim();
  if (envDir) {
    return envDir.startsWith("~")
      ? path.join(process.env.HOME ?? "~", envDir.slice(1))
      : envDir;
  }
  // Default: relative to CWD (repo root)
  return path.join(process.cwd(), "prompts");
}

function resolvePromptPath(family: ModelFamily): string {
  // Check env overrides first
  const envMap: Partial<Record<ModelFamily, string>> = {
    claude: process.env.CUPCAKE_PROMPT_CLAUDE,
    grok: process.env.CUPCAKE_PROMPT_GROK,
    qwen: process.env.CUPCAKE_PROMPT_QWEN,
    openai: process.env.CUPCAKE_PROMPT_OPENAI,
    gemini: process.env.CUPCAKE_PROMPT_GEMINI,
    mistral: process.env.CUPCAKE_PROMPT_MISTRAL,
  };

  const envOverride = envMap[family]?.trim();
  if (envOverride) return envOverride;

  const promptsDir = resolvePromptsDir();
  const fileMap: Record<ModelFamily, string> = {
    claude: "claude-prompt.md",
    grok: "grok-prompt.md",
    qwen: "qwen-prompt.md",
    openai: "default-prompt.md",
    gemini: "default-prompt.md",
    mistral: "default-prompt.md",
    default: "default-prompt.md",
  };

  return path.join(promptsDir, fileMap[family]);
}

// ─── Cache ────────────────────────────────────────────────────────────────────

type CachedPrompt = {
  content: string;
  loadedAtMs: number;
  mtime: number;
};

const cache = new Map<string, CachedPrompt>();
const CACHE_TTL_MS = 60_000; // re-read every 60 seconds (picks up edits)

async function readPromptFile(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(filePath);
    const cached = cache.get(filePath);
    if (cached && Date.now() - cached.loadedAtMs < CACHE_TTL_MS && cached.mtime === stat.mtimeMs) {
      return cached.content;
    }
    const content = await fs.readFile(filePath, "utf-8");
    cache.set(filePath, { content, loadedAtMs: Date.now(), mtime: stat.mtimeMs });
    return content;
  } catch {
    return null;
  }
}

// ─── Main loader ──────────────────────────────────────────────────────────────

const SOUL_FILE = "SOUL.md";
const AGENTS_FILE = "AGENTS.md";

/** Combine prompt files (model-specific + SOUL.md) into a final system prompt. */
async function buildSystemPrompt(modelPrompt: string): Promise<string> {
  const parts: string[] = [modelPrompt];

  // Append SOUL.md if present (core personality, always included)
  const soulPath = path.join(process.cwd(), SOUL_FILE);
  const soul = await readPromptFile(soulPath);
  if (soul) {
    parts.push("\n---\n## Core Soul (always applies)\n");
    parts.push(soul);
  }

  // Append AGENTS.md operating instructions if present
  const agentsPath = path.join(process.cwd(), AGENTS_FILE);
  const agents = await readPromptFile(agentsPath);
  if (agents) {
    parts.push("\n---\n## Operating Instructions\n");
    parts.push(agents);
  }

  return parts.join("\n");
}

/**
 * Load the appropriate system prompt for a given model ID.
 *
 * @param modelId - Model identifier (e.g., "anthropic/claude-opus-4-6", "xai/grok-4-1-fast")
 * @param opts.includeSoul - Whether to append SOUL.md (default: true)
 * @returns The system prompt string, or null if no prompt files found
 */
export async function loadModelPrompt(
  modelId: string,
  opts: { includeSoul?: boolean } = {}
): Promise<string | null> {
  const includeSoul = opts.includeSoul ?? true;
  const family = detectModelFamily(modelId);
  const promptPath = resolvePromptPath(family);

  let modelPrompt = await readPromptFile(promptPath);

  if (!modelPrompt) {
    // Try default fallback
    const defaultPath = path.join(resolvePromptsDir(), "default-prompt.md");
    modelPrompt = await readPromptFile(defaultPath);
  }

  if (!modelPrompt) {
    log.debug("No model prompt found", { modelId, family, promptPath });
    return null;
  }

  log.debug("Loaded model prompt", { modelId, family, promptPath, chars: modelPrompt.length });

  if (includeSoul) {
    return buildSystemPrompt(modelPrompt);
  }

  return modelPrompt;
}

/**
 * Reload all cached prompts (call after editing prompt files).
 */
export function invalidatePromptCache(): void {
  cache.clear();
  log.info("Prompt cache cleared");
}

/**
 * List all available prompt files.
 */
export async function listAvailablePrompts(): Promise<Record<string, string>> {
  const promptsDir = resolvePromptsDir();
  const result: Record<string, string> = {};

  try {
    const files = await fs.readdir(promptsDir);
    for (const file of files) {
      if (file.endsWith(".md")) {
        result[file] = path.join(promptsDir, file);
      }
    }
  } catch {
    // prompts dir doesn't exist
  }

  return result;
}
