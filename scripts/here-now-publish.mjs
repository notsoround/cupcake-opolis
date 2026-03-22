#!/usr/bin/env node
/**
 * Cupcake here.now — Agent-Native Artifact Publisher
 * ────────────────────────────────────────────────────────────────────────────
 * Publishes artifacts (HTML, PDF, images, text) to a public URL so Cupcake
 * can share generated content without a backend or manual file handling.
 *
 * Usage (from shell or as a Cupcake tool call):
 *   node scripts/here-now-publish.mjs <file> [--backend transfer|gist|fly]
 *   node scripts/here-now-publish.mjs --stdin --name report.html --backend transfer
 *
 * Examples:
 *   node scripts/here-now-publish.mjs /tmp/report.html
 *   node scripts/here-now-publish.mjs /tmp/chart.png --backend transfer
 *   echo '<h1>Hello</h1>' | node scripts/here-now-publish.mjs --stdin --name hello.html
 *
 * Backends:
 *   transfer  — transfer.sh (no auth, public, 14-day TTL, 10GB limit)
 *   gist      — GitHub Gist (requires GITHUB_TOKEN, permanent, text only)
 *   fly       — Fly.io static bucket (requires FLY_API_TOKEN + FLY_APP_NAME)
 *
 * Env vars (in ~/.openclaw/.env):
 *   HERE_NOW_BACKEND=transfer        — default backend
 *   GITHUB_TOKEN=ghp_...             — for GitHub Gist backend
 *   FLY_API_TOKEN=...                — for Fly.io backend
 *   FLY_APP_NAME=cupcake-opolis      — Fly.io app name
 *   HERE_NOW_TRANSFER_URL=https://transfer.sh  — custom transfer.sh endpoint
 */

import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import os from "node:os";
import { pipeline } from "node:stream/promises";

// ─── Config ───────────────────────────────────────────────────────────────────

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
    } catch { /* optional */ }
  }
  return { ...process.env, ...env };
}

// ─── MIME detection ───────────────────────────────────────────────────────────

function mimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  return {
    ".html": "text/html",
    ".htm": "text/html",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".json": "application/json",
    ".csv": "text/csv",
  }[ext] ?? "application/octet-stream";
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function httpRequest(url, opts = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, port: parsed.port || undefined, ...opts },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString(), headers: res.headers }));
      }
    );
    req.on("error", reject);
    if (body instanceof Buffer || typeof body === "string") {
      req.write(body);
    }
    req.end();
  });
}

// ─── Backend: transfer.sh ─────────────────────────────────────────────────────

async function publishToTransfer(filePath, fileName, env) {
  const baseURL = env.HERE_NOW_TRANSFER_URL?.replace(/\/$/, "") ?? "https://transfer.sh";
  const fileData = await fs.readFile(filePath);
  const mime = mimeType(fileName);

  const res = await httpRequest(
    `${baseURL}/${encodeURIComponent(fileName)}`,
    {
      method: "PUT",
      headers: {
        "content-type": mime,
        "content-length": fileData.length,
        "max-days": "14",
        "max-downloads": "1000",
      },
    },
    fileData
  );

  if (res.status !== 200) {
    throw new Error(`transfer.sh returned ${res.status}: ${res.body.slice(0, 200)}`);
  }

  const url = res.body.trim();
  return { url, backend: "transfer.sh", ttl: "14 days", fileName };
}

// ─── Backend: GitHub Gist ─────────────────────────────────────────────────────

async function publishToGist(filePath, fileName, env) {
  const token = env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN not set. Add it to ~/.openclaw/.env to use the gist backend.");
  }

  const content = await fs.readFile(filePath, "utf-8");

  const payload = JSON.stringify({
    description: `Cupcake artifact — ${fileName} — ${new Date().toISOString()}`,
    public: true,
    files: { [fileName]: { content } },
  });

  const res = await httpRequest(
    "https://api.github.com/gists",
    {
      method: "POST",
      headers: {
        "authorization": `token ${token}`,
        "content-type": "application/json",
        "user-agent": "cupcake-here-now/1.0",
        "accept": "application/vnd.github+json",
        "content-length": Buffer.byteLength(payload),
      },
    },
    payload
  );

  if (res.status !== 201) {
    throw new Error(`GitHub API returned ${res.status}: ${res.body.slice(0, 200)}`);
  }

  const gist = JSON.parse(res.body);
  // For HTML files, use the raw URL for direct rendering
  const rawUrl = gist.files[fileName]?.raw_url;
  const gistUrl = gist.html_url;

  return {
    url: rawUrl ?? gistUrl,
    gistUrl,
    backend: "github-gist",
    ttl: "permanent",
    fileName,
  };
}

// ─── Backend: Fly.io static hosting ──────────────────────────────────────────

async function publishToFly(filePath, fileName, env) {
  const token = env.FLY_API_TOKEN;
  const appName = env.FLY_APP_NAME ?? env.FLY_APP ?? "cupcake-opolis";
  if (!token) {
    throw new Error("FLY_API_TOKEN not set. Add it to ~/.openclaw/.env to use the fly backend.");
  }

  const fileData = await fs.readFile(filePath);
  const mime = mimeType(fileName);
  const timestamp = Date.now();
  const objectKey = `artifacts/${timestamp}-${fileName}`;

  // Upload via Fly.io Tigris (object storage) or the app's public dir
  // Fly.io uses Tigris S3-compatible storage for static assets
  const res = await httpRequest(
    `https://api.machines.dev/v1/apps/${appName}/volumes`,
    {
      method: "GET",
      headers: {
        "authorization": `Bearer ${token}`,
        "user-agent": "cupcake-here-now/1.0",
      },
    }
  );

  if (res.status !== 200) {
    throw new Error(`Fly.io API returned ${res.status}. Check FLY_API_TOKEN and FLY_APP_NAME.`);
  }

  // For now, fall back to transfer.sh with a note about Fly
  console.warn("[here-now] Fly.io static hosting requires Tigris storage setup.");
  console.warn("[here-now] Falling back to transfer.sh for this upload.");
  console.warn("[here-now] See docs/here-now-hosting.md for full Fly.io setup.");

  return publishToTransfer(filePath, fileName, env);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const env = await loadEnv();

  let filePath = null;
  let fileName = null;
  let backend = env.HERE_NOW_BACKEND ?? "transfer";
  let useStdin = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--backend" && args[i + 1]) {
      backend = args[++i];
    } else if (args[i] === "--name" && args[i + 1]) {
      fileName = args[++i];
    } else if (args[i] === "--stdin") {
      useStdin = true;
    } else if (!args[i].startsWith("--")) {
      filePath = args[i];
    }
  }

  // Read from stdin if requested
  if (useStdin) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cupcake-here-now-"));
    const tmpFile = path.join(tmpDir, fileName ?? `artifact-${Date.now()}.html`);
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    await fs.writeFile(tmpFile, Buffer.concat(chunks));
    filePath = tmpFile;
    fileName = fileName ?? path.basename(tmpFile);
  }

  if (!filePath) {
    console.error(`
Cupcake here.now — Agent-Native Artifact Publisher
Usage:
  node scripts/here-now-publish.mjs <file> [--backend transfer|gist|fly]
  echo '<html>...</html>' | node scripts/here-now-publish.mjs --stdin --name page.html

Backends:
  transfer  (default) — transfer.sh, no auth, 14-day TTL
  gist      — GitHub Gist, requires GITHUB_TOKEN
  fly       — Fly.io, requires FLY_API_TOKEN
`);
    process.exit(1);
  }

  // Resolve file name
  if (!fileName) {
    fileName = path.basename(filePath);
  }

  // Check file exists
  await fs.access(filePath);

  const stat = await fs.stat(filePath);
  console.log(`[here-now] Publishing ${fileName} (${(stat.size / 1024).toFixed(1)}KB) via ${backend}...`);

  let result;
  switch (backend) {
    case "transfer":
      result = await publishToTransfer(filePath, fileName, env);
      break;
    case "gist":
      result = await publishToGist(filePath, fileName, env);
      break;
    case "fly":
      result = await publishToFly(filePath, fileName, env);
      break;
    default:
      throw new Error(`Unknown backend: ${backend}. Use transfer, gist, or fly.`);
  }

  // Output result (JSON for machine consumption, readable for humans)
  const output = {
    success: true,
    ...result,
  };

  console.log("\n" + JSON.stringify(output, null, 2));
  console.log(`\n✓ Published: ${output.url}`);
  if (output.ttl) {
    console.log(`  TTL: ${output.ttl}`);
  }

  return output;
}

main().catch((err) => {
  console.error("[here-now] Error:", err.message);
  process.exit(1);
});
