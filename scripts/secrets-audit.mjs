#!/usr/bin/env node
/**
 * Cupcake Secrets Audit
 * ────────────────────────────────────────────────────────────────────────────
 * Scans the codebase for potentially hardcoded secrets, API keys, tokens, and
 * credentials. Warns about anything that should be in .env instead.
 *
 * Usage:
 *   node scripts/secrets-audit.mjs [--strict] [--fix] [--json]
 *
 * Options:
 *   --strict  Fail with exit code 1 if any secrets found (CI mode)
 *   --json    Output results as JSON
 *   --path    Scan a specific directory (default: current directory)
 *
 * Config (in secrets-audit.config.json or inline):
 *   allowlist: array of regex strings to exclude from warnings
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";
import readline from "node:readline";

// ─── Secret patterns ──────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  // API Keys
  { name: "Anthropic API Key",      pattern: /sk-ant-[a-zA-Z0-9\-_]{20,}/, severity: "critical" },
  { name: "OpenAI API Key",          pattern: /sk-[a-zA-Z0-9]{20,}(?!-ant-)/, severity: "critical" },
  { name: "OpenAI Project Key",      pattern: /sk-proj-[a-zA-Z0-9\-_]{20,}/, severity: "critical" },
  { name: "Deepgram API Key",        pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, severity: "high", context: "deepgram" },
  { name: "GitHub Token (classic)",  pattern: /ghp_[a-zA-Z0-9]{36}/, severity: "critical" },
  { name: "GitHub Token (fine)",     pattern: /github_pat_[a-zA-Z0-9_]{82}/, severity: "critical" },
  { name: "Fly.io Token",            pattern: /FlyV1\s+[a-zA-Z0-9+/=]{40,}/, severity: "critical" },
  { name: "Telegram Bot Token",      pattern: /\d{8,12}:[a-zA-Z0-9_\-]{35}/, severity: "critical" },
  { name: "Stripe Secret Key",       pattern: /sk_live_[a-zA-Z0-9]{24,}/, severity: "critical" },
  { name: "Stripe Test Key",         pattern: /sk_test_[a-zA-Z0-9]{24,}/, severity: "high" },
  { name: "AWS Access Key",          pattern: /AKIA[0-9A-Z]{16}/, severity: "critical" },
  { name: "AWS Secret Key",          pattern: /[a-zA-Z0-9/+]{40}/, severity: "low", context: "aws_secret" },
  { name: "Generic Bearer Token",    pattern: /Bearer\s+[a-zA-Z0-9\-._~+/]+=*\s*["'`]/, severity: "high" },
  { name: "Generic API Key (long)",  pattern: /api[_-]?key\s*[:=]\s*["'`][a-zA-Z0-9\-_]{32,}["'`]/i, severity: "high" },
  { name: "Generic Secret",          pattern: /secret\s*[:=]\s*["'`][a-zA-Z0-9\-_!@#$%]{16,}["'`]/i, severity: "medium" },
  { name: "Generic Password",        pattern: /password\s*[:=]\s*["'`][^"'`\s]{8,}["'`]/i, severity: "medium" },
  { name: "Private Key Block",       pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/, severity: "critical" },
  { name: "JWT Token (full)",        pattern: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/, severity: "high" },
  // Hales AI specific
  { name: "Vapi.ai Key",             pattern: /vapi[_-]?(?:key|token|api)\s*[:=]\s*["'`][a-zA-Z0-9\-_]{16,}["'`]/i, severity: "high" },
  { name: "OpenRouter Key",          pattern: /sk-or-[a-zA-Z0-9\-_]{20,}/, severity: "critical" },
  { name: "Claude Max Session",      pattern: /sk-ant-sid\d+-[a-zA-Z0-9\-_]{20,}/, severity: "critical" },
];

// ─── Config ───────────────────────────────────────────────────────────────────

// Paths to always skip
const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", ".next", "build", "coverage",
  ".cache", "vendor", ".pnpm-store", "tmp",
]);

const SKIP_FILES = new Set([
  ".gitignore", "pnpm-lock.yaml", "package-lock.json", "yarn.lock",
  "secrets-audit.mjs",        // this file itself
  "secrets-audit.config.json",
]);

// File extensions to scan (text only)
const SCAN_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx",
  ".json", ".json5", ".yaml", ".yml", ".toml", ".env",
  ".md", ".txt", ".sh", ".zsh", ".bash",
  ".html", ".css", ".vue", ".svelte",
]);

// Content patterns that indicate a line is intentionally a placeholder
const PLACEHOLDER_PATTERNS = [
  /change-me/i, /your[_-]?key/i, /your[_-]?token/i, /replace[_-]?me/i,
  /placeholder/i, /example/i, /dummy/i, /fake/i, /test[_-]?key/i,
  /xxx+/i, /\.\.\./i, /<[a-z_]+>/i, /sk-\.\.\./i, /sk-ant-\.\.\./i,
];

function isPlaceholder(value) {
  return PLACEHOLDER_PATTERNS.some(p => p.test(value));
}

// ─── Scanner ──────────────────────────────────────────────────────────────────

async function* walkFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          yield* walkFiles(path.join(dir, entry.name));
        }
      } else if (entry.isFile()) {
        if (!SKIP_FILES.has(entry.name)) {
          const ext = path.extname(entry.name).toLowerCase();
          if (SCAN_EXTENSIONS.has(ext) || entry.name.startsWith(".env")) {
            yield path.join(dir, entry.name);
          }
        }
      }
    }
  } catch { /* permission denied etc. */ }
}

async function scanFile(filePath, allowlist = []) {
  const findings = [];
  const rl = readline.createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  let lineNo = 0;
  for await (const line of rl) {
    lineNo++;
    for (const { name, pattern, severity } of SECRET_PATTERNS) {
      const match = pattern.exec(line);
      if (!match) continue;

      const matched = match[0];

      // Skip placeholders
      if (isPlaceholder(matched) || isPlaceholder(line)) continue;

      // Skip comments in most file types
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*")) continue;

      // Skip allowlisted patterns
      if (allowlist.some(a => new RegExp(a).test(line))) continue;

      // Skip .env.example and similar example files
      const basename = path.basename(filePath);
      if (basename.includes("example") || basename.includes("sample")) continue;

      // Skip test files (they often have fake keys)
      if (filePath.includes(".test.") || filePath.includes(".spec.") || filePath.includes("/test/")) continue;

      findings.push({
        file: filePath,
        line: lineNo,
        type: name,
        severity,
        snippet: line.slice(0, 120).replace(matched, "[REDACTED]"),
      });
    }
  }

  return findings;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITY_COLORS = { critical: "\x1b[31m", high: "\x1b[33m", medium: "\x1b[36m", low: "\x1b[37m" };
const RESET = "\x1b[0m";

async function main() {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const jsonOutput = args.includes("--json");
  const pathIdx = args.indexOf("--path");
  const scanDir = pathIdx !== -1 ? args[pathIdx + 1] : process.cwd();

  // Load allowlist
  let allowlist = [];
  try {
    const cfg = JSON.parse(await fs.readFile(path.join(scanDir, "secrets-audit.config.json"), "utf-8"));
    allowlist = cfg.allowlist ?? [];
  } catch { /* no config */ }

  if (!jsonOutput) {
    console.log("\nCupcake Secrets Audit");
    console.log("━━━━━━━━━━━━━━━━━━━━━");
    console.log(`Scanning: ${scanDir}\n`);
  }

  const allFindings = [];
  let filesScanned = 0;

  for await (const filePath of walkFiles(scanDir)) {
    filesScanned++;
    const findings = await scanFile(filePath, allowlist);
    allFindings.push(...findings);
  }

  // Sort by severity
  allFindings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  if (jsonOutput) {
    console.log(JSON.stringify({ filesScanned, findings: allFindings }, null, 2));
    process.exit(strict && allFindings.length > 0 ? 1 : 0);
  }

  if (allFindings.length === 0) {
    console.log(`✓ No secrets found in ${filesScanned} files. Clean! 🎀\n`);
    return;
  }

  // Group by severity
  const bySeverity = {};
  for (const f of allFindings) {
    (bySeverity[f.severity] ??= []).push(f);
  }

  for (const severity of ["critical", "high", "medium", "low"]) {
    const group = bySeverity[severity];
    if (!group) continue;

    const color = SEVERITY_COLORS[severity];
    console.log(`${color}[${severity.toUpperCase()}] ${group.length} finding(s)${RESET}`);

    for (const f of group) {
      const relPath = path.relative(scanDir, f.file);
      console.log(`  ${relPath}:${f.line} — ${f.type}`);
      console.log(`    ${f.snippet.trim()}`);
    }
    console.log();
  }

  console.log(`Found ${allFindings.length} potential secret(s) in ${filesScanned} files.`);
  console.log("\nRecommendations:");
  console.log("  1. Move secrets to ~/.openclaw/.env");
  console.log("  2. Reference via process.env.KEY_NAME in code");
  console.log("  3. Add false positives to secrets-audit.config.json allowlist");
  console.log("  4. Run: git-filter-repo or BFG to purge from git history if committed");
  console.log();

  if (strict && allFindings.length > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Secrets audit error:", err.message);
  process.exit(1);
});
