#!/usr/bin/env node
/**
 * Cupcake Metrics Cron Installer
 * ────────────────────────────────────────────────────────────────────────────
 * Registers a weekly cron job that:
 *   1. Fetches the weekly metrics digest from the local metrics server
 *   2. Sends it to a Telegram chat
 *
 * Usage:
 *   node scripts/cupcake-metrics-cron.mjs              — test digest now
 *   node scripts/cupcake-metrics-cron.mjs --install-cron — register weekly cron
 *
 * Env vars:
 *   CUPCAKE_WEEKLY_DIGEST_TELEGRAM_ID=<chat_id>  — destination chat
 *   CUPCAKE_METRICS_PORT=9090                     — metrics server port
 *   CUPCAKE_WEEKLY_DIGEST_CRON="0 8 * * 1"       — when to run (default: Mon 8am)
 *   TELEGRAM_BOT_TOKEN or OPENCLAW_TELEGRAM_TOKEN — bot token
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";

// ─── Config ───────────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fetchMetricsDigest(port) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/metrics/digest`, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 200) resolve(data);
        else reject(new Error(`Metrics server returned ${res.statusCode}`));
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error("Metrics request timed out"));
    });
  });
}

async function sendTelegram(env, message) {
  const botToken = env.TELEGRAM_BOT_TOKEN ?? env.OPENCLAW_TELEGRAM_TOKEN;
  const chatId = env.CUPCAKE_WEEKLY_DIGEST_TELEGRAM_ID ?? env.CUPCAKE_HEARTBEAT_TELEGRAM_ID;

  if (!botToken || !chatId) {
    console.log("[metrics-cron] No Telegram config — printing to stdout instead:");
    console.log(message);
    return;
  }

  const https = await import("node:https");
  const body = JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" });

  await new Promise((resolve, reject) => {
    const req = https.default.request(
      {
        hostname: "api.telegram.org",
        path: `/bot${botToken}/sendMessage`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log("[metrics-cron] Digest sent to Telegram ✓");
            resolve();
          } else {
            reject(new Error(`Telegram API returned ${res.statusCode}: ${data}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── Cron installer ───────────────────────────────────────────────────────────

async function installCron(env) {
  const cronExpr = env.CUPCAKE_WEEKLY_DIGEST_CRON ?? "0 8 * * 1";
  const tz = env.CUPCAKE_HEARTBEAT_TZ ?? "America/Chicago";

  const storePath = path.join(
    env.OPENCLAW_STATE_DIR ?? env.OPENCLAW_HOME ?? path.join(os.homedir(), ".openclaw"),
    "cron", "jobs.json"
  );

  let store = { version: 1, jobs: [] };
  try {
    store = JSON.parse(await fs.readFile(storePath, "utf-8"));
  } catch {}

  const existingIdx = store.jobs.findIndex((j) => j.id === "cupcake-metrics-digest");
  const job = {
    id: "cupcake-metrics-digest",
    name: "Cupcake Weekly Metrics Digest",
    description: "Sends a weekly observability report to Telegram",
    enabled: true,
    deleteAfterRun: false,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    schedule: { kind: "cron", expr: cronExpr, tz },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: {
      kind: "agentTurn",
      message: `Fetch the Cupcake weekly metrics digest from http://127.0.0.1:${env.CUPCAKE_METRICS_PORT ?? "9090"}/metrics/digest and send it to Telegram chat ${env.CUPCAKE_WEEKLY_DIGEST_TELEGRAM_ID ?? env.CUPCAKE_HEARTBEAT_TELEGRAM_ID ?? "<TELEGRAM_CHAT_ID>"}. If the metrics server is not reachable, report that in the message.`,
      timeoutSeconds: 60,
      deliver: true,
      bestEffortDeliver: true,
    },
    state: {},
  };

  if (existingIdx !== -1) {
    store.jobs[existingIdx] = { ...job, createdAtMs: store.jobs[existingIdx].createdAtMs };
    console.log("[metrics-cron] Weekly digest cron job updated ✓");
  } else {
    store.jobs.push(job);
    console.log("[metrics-cron] Weekly digest cron job installed ✓");
  }

  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, JSON.stringify(store, null, 2) + "\n");

  console.log(`
Weekly digest schedule: ${cronExpr} (${tz})
Destination: Telegram chat ${env.CUPCAKE_WEEKLY_DIGEST_TELEGRAM_ID ?? env.CUPCAKE_HEARTBEAT_TELEGRAM_ID ?? "NOT SET — set CUPCAKE_WEEKLY_DIGEST_TELEGRAM_ID"}
`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const env = await loadEnv();

  if (args.includes("--install-cron")) {
    await installCron(env);
    return;
  }

  // Run immediately: fetch + send
  const port = parseInt(env.CUPCAKE_METRICS_PORT ?? "9090", 10);

  console.log(`[metrics-cron] Fetching digest from http://127.0.0.1:${port}/metrics/digest...`);
  const digest = await fetchMetricsDigest(port);
  await sendTelegram(env, digest);
}

main().catch((err) => {
  console.error("[metrics-cron] Fatal:", err.message);
  process.exit(1);
});
