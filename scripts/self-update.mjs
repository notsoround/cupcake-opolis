#!/usr/bin/env node
/**
 * Cupcake Self-Updater
 * ────────────────────────────────────────────────────────────────────────────
 * Checks for upstream OpenClaw changes, applies them safely, reinstalls deps
 * if package.json changed, and restarts the bot gracefully.
 *
 * Designed to run nightly via OpenClaw's cron system.
 * Register: node scripts/self-update.mjs --install-cron
 *
 * Usage:
 *   node scripts/self-update.mjs             — check + apply if available
 *   node scripts/self-update.mjs --check     — check only, no update
 *   node scripts/self-update.mjs --force     — update even if nothing changed
 *   node scripts/self-update.mjs --install-cron  — register nightly cron job
 *
 * Env vars (in ~/.openclaw/.env):
 *   CUPCAKE_AUTO_UPDATE=true              — enable auto-updates (default: false, must opt-in)
 *   CUPCAKE_UPDATE_UPSTREAM=upstream      — git remote name for upstream (default: upstream)
 *   CUPCAKE_UPDATE_BRANCH=main            — branch to sync from (default: main)
 *   CUPCAKE_UPDATE_STRATEGY=merge         — merge | rebase (default: merge)
 *   CUPCAKE_UPDATE_CRON="0 3 * * *"       — when to auto-update (default: 3am)
 *   CUPCAKE_HEARTBEAT_TELEGRAM_ID=...     — where to send update notifications
 *   CUPCAKE_PM2_APP_NAME=cupcake-opolis   — PM2 app name for restart
 */

import { execSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf-8", stdio: "pipe", ...opts }).trim();
}

function runSafe(cmd) {
  try { return { ok: true, output: run(cmd) }; }
  catch (e) { return { ok: false, output: e.stdout?.trim() ?? "", error: e.message }; }
}

async function loadEnv() {
  const envPaths = [
    path.join(os.homedir(), ".openclaw", ".env"),
    path.join(process.cwd(), ".env"),
  ];
  const env = {};
  for (const p of envPaths) {
    try {
      for (const line of (await fs.readFile(p, "utf-8")).split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const i = t.indexOf("=");
        if (i < 0) continue;
        env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      }
    } catch {}
  }
  return { ...process.env, ...env };
}

function log(msg, level = "info") {
  const prefix = { info: "ℹ", warn: "⚠", error: "✗", ok: "✓" }[level] ?? "·";
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${prefix} ${msg}`);
}

// ─── Git helpers ──────────────────────────────────────────────────────────────

function getCurrentCommit() { return run("git rev-parse HEAD"); }
function getBranchName() { return run("git rev-parse --abbrev-ref HEAD"); }

function fetchUpstream(remote) {
  const result = runSafe(`git fetch ${remote} --prune 2>&1`);
  return result;
}

function countCommitsBehind(remote, branch) {
  const result = runSafe(`git rev-list HEAD..${remote}/${branch} --count`);
  return result.ok ? parseInt(result.output, 10) : 0;
}

function getUpstreamChanges(remote, branch, count = 10) {
  const result = runSafe(`git log HEAD..${remote}/${branch} --oneline -${count}`);
  return result.ok ? result.output : "";
}

function hasPackageJsonChanged(remote, branch) {
  const result = runSafe(`git diff HEAD ${remote}/${branch} -- package.json`);
  return result.ok && result.output.length > 0;
}

// ─── Update strategies ────────────────────────────────────────────────────────

function mergeUpstream(remote, branch) {
  return runSafe(`git merge ${remote}/${branch} --no-edit -m "chore(upstream): auto-sync from ${remote}/${branch}"`);
}

function rebaseUpstream(remote, branch) {
  const result = runSafe(`git rebase ${remote}/${branch}`);
  if (!result.ok) {
    runSafe("git rebase --abort");
  }
  return result;
}

// ─── Bot restart ──────────────────────────────────────────────────────────────

async function restartBot(env) {
  const pm2AppName = env.CUPCAKE_PM2_APP_NAME ?? "cupcake-opolis";

  // Try PM2 first
  const pm2Result = runSafe(`pm2 reload ${pm2AppName} --update-env`);
  if (pm2Result.ok) {
    log(`Restarted via PM2: ${pm2AppName}`, "ok");
    return { method: "pm2", success: true };
  }

  // Try systemd
  const systemdResult = runSafe(`systemctl --user restart openclaw`);
  if (systemdResult.ok) {
    log("Restarted via systemd", "ok");
    return { method: "systemd", success: true };
  }

  // Graceful self-restart (SIGUSR2 for PM2 graceful reload, SIGTERM for clean shutdown)
  log("No process manager found — sending SIGTERM for clean exit (process will not auto-restart)", "warn");
  process.kill(process.pid, "SIGTERM");
  return { method: "sigterm", success: false };
}

// ─── Notification ─────────────────────────────────────────────────────────────

async function sendTelegramNotification(env, message) {
  const botToken = env.TELEGRAM_BOT_TOKEN ?? env.OPENCLAW_TELEGRAM_TOKEN;
  const chatId = env.CUPCAKE_HEARTBEAT_TELEGRAM_ID ?? env.CUPCAKE_UPDATE_TELEGRAM_ID;

  if (!botToken || !chatId) return;

  try {
    const https = await import("node:https");
    const body = JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" });

    await new Promise((resolve, reject) => {
      const req = https.default.request(
        { hostname: "api.telegram.org", path: `/bot${botToken}/sendMessage`, method: "POST",
          headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } },
        (res) => { res.on("data", () => {}); res.on("end", resolve); }
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  } catch (err) {
    log(`Telegram notification failed: ${err.message}`, "warn");
  }
}

// ─── Cron installer ───────────────────────────────────────────────────────────

async function installCron(env) {
  const cronExpr = env.CUPCAKE_UPDATE_CRON ?? "0 3 * * *";
  const tz = env.CUPCAKE_HEARTBEAT_TZ ?? "America/Chicago";
  const storePath = path.join(
    env.OPENCLAW_STATE_DIR ?? env.OPENCLAW_HOME ?? path.join(os.homedir(), ".openclaw"),
    "cron", "jobs.json"
  );

  let store = { version: 1, jobs: [] };
  try {
    store = JSON.parse(await fs.readFile(storePath, "utf-8"));
  } catch {}

  const existingIdx = store.jobs.findIndex(j => j.id === "cupcake-auto-update");
  const job = {
    id: "cupcake-auto-update",
    name: "Cupcake Auto-Update",
    description: "Nightly upstream sync and bot restart",
    enabled: (env.CUPCAKE_AUTO_UPDATE ?? "false") === "true",
    deleteAfterRun: false,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    schedule: { kind: "cron", expr: cronExpr, tz },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: {
      kind: "agentTurn",
      message: `Run: node ${path.resolve("scripts/self-update.mjs")} and report the result. If an update was applied, say so clearly.`,
      timeoutSeconds: 300,
      deliver: true,
      bestEffortDeliver: true,
    },
    state: {},
  };

  if (existingIdx !== -1) {
    store.jobs[existingIdx] = { ...job, createdAtMs: store.jobs[existingIdx].createdAtMs };
    log("Auto-update cron job updated", "ok");
  } else {
    store.jobs.push(job);
    log("Auto-update cron job installed", "ok");
  }

  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, JSON.stringify(store, null, 2) + "\n");

  console.log(`
Auto-update schedule: ${cronExpr} (${tz})
Enabled: ${job.enabled}

Note: CUPCAKE_AUTO_UPDATE=true must be set to enable auto-updates.
By default this is false (opt-in only) for safety.
`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const force = args.includes("--force");
  const installCronMode = args.includes("--install-cron");

  const env = await loadEnv();
  const repoDir = process.cwd();

  if (installCronMode) {
    await installCron(env);
    return;
  }

  if (!force && env.CUPCAKE_AUTO_UPDATE !== "true" && !args.includes("--run")) {
    log("CUPCAKE_AUTO_UPDATE is not set to 'true'. Running in check-only mode.");
    log("Set CUPCAKE_AUTO_UPDATE=true in ~/.openclaw/.env to enable auto-updates.");
    // Fall through to check mode
  }

  const remote = env.CUPCAKE_UPDATE_UPSTREAM ?? "upstream";
  const branch = env.CUPCAKE_UPDATE_BRANCH ?? "main";
  const strategy = env.CUPCAKE_UPDATE_STRATEGY ?? "merge";

  log(`Checking for upstream updates (${remote}/${branch})...`);

  // Verify we're in a git repo
  const gitCheck = runSafe("git rev-parse --git-dir");
  if (!gitCheck.ok) {
    log("Not a git repository. Cannot self-update.", "error");
    process.exit(1);
  }

  const beforeCommit = getCurrentCommit();

  // Fetch
  const fetchResult = fetchUpstream(remote);
  if (!fetchResult.ok) {
    log(`Fetch failed: ${fetchResult.error}`, "warn");
    log("Continuing with cached upstream data...");
  } else {
    log(`Fetched from ${remote}`, "ok");
  }

  const behindCount = countCommitsBehind(remote, branch);
  const changes = getUpstreamChanges(remote, branch);

  if (behindCount === 0 && !force) {
    log("Already up to date. No update needed.", "ok");
    return;
  }

  log(`${behindCount} commit(s) available from upstream:`);
  if (changes) {
    changes.split("\n").forEach(line => log(`  ${line}`));
  }

  if (checkOnly) {
    log("Check-only mode — skipping update.");
    return;
  }

  if (env.CUPCAKE_AUTO_UPDATE !== "true" && !force) {
    log("Set CUPCAKE_AUTO_UPDATE=true to apply updates automatically.", "warn");
    return;
  }

  // Check if package.json changed (need npm install)
  const pkgChanged = hasPackageJsonChanged(remote, branch);

  // Apply update
  log(`Applying update via ${strategy}...`);
  const updateResult = strategy === "rebase"
    ? rebaseUpstream(remote, branch)
    : mergeUpstream(remote, branch);

  if (!updateResult.ok) {
    const errorMsg = `Update failed (${strategy}): ${updateResult.error?.slice(0, 200)}`;
    log(errorMsg, "error");
    await sendTelegramNotification(env, `🚨 *Cupcake Auto-Update FAILED*\n\`\`\`\n${errorMsg}\n\`\`\``);
    process.exit(1);
  }

  const afterCommit = getCurrentCommit();
  log(`Updated: ${beforeCommit.slice(0, 8)} → ${afterCommit.slice(0, 8)}`, "ok");

  // Reinstall deps if package.json changed
  if (pkgChanged) {
    log("package.json changed — running pnpm install...");
    const installResult = runSafe("pnpm install --frozen-lockfile 2>&1 || npm install 2>&1");
    if (installResult.ok) {
      log("Dependencies updated", "ok");
    } else {
      log(`Dependency install failed: ${installResult.output.slice(0, 200)}`, "warn");
    }
  }

  // Log to activity log
  try {
    const logPath = path.join(
      env.OPENCLAW_STATE_DIR ?? path.join(os.homedir(), ".openclaw"),
      "logs", "activity.jsonl"
    );
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    const event = {
      ts: new Date().toISOString(),
      event: "heartbeat",
      actor: "self-updater",
      content: `Applied ${behindCount} upstream commit(s). ${beforeCommit.slice(0, 8)} → ${afterCommit.slice(0, 8)}`,
      meta: { beforeCommit, afterCommit, behindCount, pkgChanged },
    };
    await fs.appendFile(logPath, JSON.stringify(event) + "\n");
  } catch {}

  // Notify
  const notifyMsg = `🎀 *Cupcake Auto-Updated*\n\nApplied ${behindCount} commit(s)\n\`${beforeCommit.slice(0, 8)} → ${afterCommit.slice(0, 8)}\`\n\nChanges:\n\`\`\`\n${changes.slice(0, 500)}\n\`\`\``;
  await sendTelegramNotification(env, notifyMsg);

  // Restart
  log("Restarting bot...");
  await restartBot(env);
}

main().catch(err => {
  console.error("[self-update] Fatal:", err.message);
  process.exit(1);
});
