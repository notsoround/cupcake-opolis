#!/usr/bin/env node
/**
 * Cupcake Heartbeat Installer
 * ────────────────────────────────────────────────────────────────────────────
 * Registers the nightly Cupcake heartbeat cron job into OpenClaw's cron store.
 *
 * Usage:
 *   node scripts/cupcake-heartbeat-install.mjs [--remove]
 *
 * Environment variables (set in ~/.openclaw/.env):
 *   CUPCAKE_HEARTBEAT_ENABLED=true         — toggle on/off (default: true)
 *   CUPCAKE_HEARTBEAT_CRON="0 2 * * *"    — cron schedule, UTC (default: 2am daily)
 *   CUPCAKE_HEARTBEAT_TZ="America/Chicago" — timezone for cron (default: UTC)
 *   CUPCAKE_HEARTBEAT_TELEGRAM_ID=         — Telegram chat_id to send daily digest
 *   CUPCAKE_HEARTBEAT_CHANNEL=telegram     — channel to deliver summary on
 *
 * What it does (nightly at 2am by default):
 *   1. Pings the bot health check (checks model availability)
 *   2. Logs a "heartbeat" event to the JSONL activity log
 *   3. Generates a daily usage summary (message counts, errors, channels)
 *   4. Sends the summary to the configured Telegram channel (if set)
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const HEARTBEAT_JOB_ID = "cupcake-nightly-heartbeat";

// ─── Load environment ─────────────────────────────────────────────────────────

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
    } catch {
      // env file optional
    }
  }
  return { ...process.env, ...env };
}

// ─── Cron store helpers ───────────────────────────────────────────────────────

function resolveCronStorePath(env) {
  const stateDir = env.OPENCLAW_STATE_DIR
    ?? env.OPENCLAW_HOME
    ?? path.join(os.homedir(), ".openclaw");
  return path.join(stateDir, "cron", "jobs.json");
}

async function loadCronStore(storePath) {
  try {
    const raw = await fs.readFile(storePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { version: 1, jobs: [] };
  }
}

async function saveCronStore(storePath, store) {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, JSON.stringify(store, null, 2) + "\n", "utf-8");
}

// ─── Build the heartbeat job ──────────────────────────────────────────────────

function buildHeartbeatJob(env) {
  const cronExpr = env.CUPCAKE_HEARTBEAT_CRON ?? "0 2 * * *";
  const tz = env.CUPCAKE_HEARTBEAT_TZ ?? "UTC";
  const channel = env.CUPCAKE_HEARTBEAT_CHANNEL ?? "telegram";
  const telegramId = env.CUPCAKE_HEARTBEAT_TELEGRAM_ID ?? null;
  const enabled = (env.CUPCAKE_HEARTBEAT_ENABLED ?? "true") !== "false";

  const now = Date.now();

  // Build the heartbeat prompt
  const deliverPart = telegramId
    ? `Deliver this summary to Telegram (chat_id: ${telegramId}). Keep it concise — a short paragraph or a few bullet points is ideal.`
    : `If any Telegram channel is configured, send a brief summary there. Otherwise, just log it.`;

  const message = `[HEARTBEAT] Daily Cupcake health check — ${new Date().toISOString().slice(0, 10)}

Please perform the following:

1. **Health check**: Confirm you're online and responding. Note which model you're currently using (primary/fallback/local).

2. **Activity summary**: Read the JSONL activity log at ~/.openclaw/logs/activity.jsonl and summarize the last 24 hours:
   - Total messages in/out
   - Active channels
   - Any errors (list them briefly)
   - Models used

3. **Log heartbeat**: Emit a heartbeat event to the activity log by running:
   \`\`\`bash
   python3 -c "
   import json, datetime, pathlib
   log = pathlib.Path.home() / '.openclaw/logs/activity.jsonl'
   log.parent.mkdir(parents=True, exist_ok=True)
   event = {'ts': datetime.datetime.utcnow().isoformat() + 'Z', 'event': 'heartbeat', 'actor': 'cupcake-heartbeat', 'content': 'nightly health check ok'}
   with log.open('a') as f: f.write(json.dumps(event) + '\\n')
   print('Heartbeat logged.')
   "
   \`\`\`

4. **Uptime**: Report how long the gateway has been running (check process uptime if possible).

${deliverPart}

Format: short, friendly, Cupcake-voice. Pink bows, zero mercy.`;

  const job = {
    id: HEARTBEAT_JOB_ID,
    name: "Cupcake Nightly Heartbeat",
    description: "Nightly health ping, activity summary, and optional Telegram digest",
    enabled,
    deleteAfterRun: false,
    createdAtMs: now,
    updatedAtMs: now,
    schedule: {
      kind: "cron",
      expr: cronExpr,
      tz,
    },
    sessionTarget: "main",
    wakeMode: "now",
    payload: {
      kind: "agentTurn",
      message,
      timeoutSeconds: 120,
      deliver: telegramId !== null,
      ...(channel ? { channel } : {}),
      ...(telegramId ? { to: telegramId } : {}),
      bestEffortDeliver: true,
    },
    state: {},
  };

  return job;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const remove = args.includes("--remove");

  const env = await loadEnv();
  const storePath = resolveCronStorePath(env);

  console.log(`Cron store: ${storePath}`);

  const store = await loadCronStore(storePath);
  const existingIdx = store.jobs.findIndex((j) => j.id === HEARTBEAT_JOB_ID);

  if (remove) {
    if (existingIdx === -1) {
      console.log("Heartbeat job not found — nothing to remove.");
    } else {
      store.jobs.splice(existingIdx, 1);
      await saveCronStore(storePath, store);
      console.log("✓ Cupcake heartbeat job removed.");
    }
    return;
  }

  const job = buildHeartbeatJob(env);

  if (existingIdx !== -1) {
    // Update existing job
    job.createdAtMs = store.jobs[existingIdx].createdAtMs;
    job.state = store.jobs[existingIdx].state ?? {};
    store.jobs[existingIdx] = job;
    console.log("✓ Cupcake heartbeat job updated.");
  } else {
    store.jobs.push(job);
    console.log("✓ Cupcake heartbeat job registered.");
  }

  await saveCronStore(storePath, store);

  console.log(`
Heartbeat schedule: ${job.schedule.expr} (${job.schedule.tz})
Telegram target:    ${process.env.CUPCAKE_HEARTBEAT_TELEGRAM_ID ?? "(not set — no delivery)"}
Enabled:            ${job.enabled}

To change the schedule, set CUPCAKE_HEARTBEAT_CRON in ~/.openclaw/.env
then re-run this script.

To disable: CUPCAKE_HEARTBEAT_ENABLED=false node scripts/cupcake-heartbeat-install.mjs
To remove:  node scripts/cupcake-heartbeat-install.mjs --remove
`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
