/**
 * Settings for the Cupcake nutrition methods. Everything comes from the Gateway
 * process environment (`~/.openclaw/.env`, systemd `Environment=` or
 * `LoadCredential=` files); nothing secret lives in plugin config or the repo.
 */
import fs from "node:fs";
import path from "node:path";

export type Env = Readonly<Record<string, string | undefined>>;

export const DEFAULT_LIBRARY_URL = "https://automate.hales.ai/cupcake-library";
export const DEFAULT_BRAIN_URL = "https://automate.hales.ai/webhook/cupcake-brain";

export type NutritionSettings = {
  /** Cupcake private library (food-photo log, scanned receipts, glucose, targets). */
  library: { url: string; key?: string };
  /** Cupcake brain webhook (bank purchase alerts and Plaid history, normalized). */
  brain: { url: string; key?: string };
  timeoutMs: number;
  cacheTtlMs: number;
};

function text(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function num(env: Env, name: string, fallback: number, min: number, max: number): number {
  const value = Number(text(env, name) ?? fallback);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/**
 * Resolve a secret from, in order: each env name, the file named by `<NAME>_FILE`,
 * or `$CREDENTIALS_DIRECTORY/<credentialName>` (systemd `LoadCredential=`).
 */
export function readSecret(
  env: Env,
  names: readonly string[],
  credentialName: string,
): string | undefined {
  for (const name of names) {
    const direct = text(env, name);
    if (direct) {
      return direct;
    }
  }
  const credentialsDir = text(env, "CREDENTIALS_DIRECTORY");
  const files = [
    ...names.map((name) => text(env, `${name}_FILE`)),
    credentialsDir ? path.join(credentialsDir, credentialName) : undefined,
  ];
  for (const file of files) {
    if (!file) {
      continue;
    }
    try {
      const value = fs.readFileSync(file, "utf8").trim();
      if (value) {
        return value;
      }
    } catch {
      // Try the next location.
    }
  }
  return undefined;
}

function httpsOrLoopback(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }
  try {
    const url = new URL(value);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    return url.protocol === "https:" || (url.protocol === "http:" && loopback) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function resolveNutritionSettings(env: Env = process.env): NutritionSettings {
  return {
    library: {
      url: httpsOrLoopback(text(env, "CUPCAKE_LIBRARY_URL"), DEFAULT_LIBRARY_URL),
      // CUPCAKE_OWNER_KEY is the name the cupcake-brain connector already uses on brain-01.
      key: readSecret(env, ["CUPCAKE_LIBRARY_KEY", "CUPCAKE_OWNER_KEY"], "cupcake-library-key"),
    },
    brain: {
      url: httpsOrLoopback(text(env, "CUPCAKE_BRAIN_URL"), DEFAULT_BRAIN_URL),
      key: readSecret(env, ["CUPCAKE_BRAIN_KEY"], "cupcake-brain-key"),
    },
    timeoutMs: num(env, "CUPCAKE_NUTRITION_TIMEOUT_MS", 8000, 1000, 30_000),
    cacheTtlMs: num(env, "CUPCAKE_NUTRITION_CACHE_TTL_MS", 60_000, 0, 600_000),
  };
}
