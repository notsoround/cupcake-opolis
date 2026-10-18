/**
 * Settings for the Vapi call-context service. Everything comes from the process
 * environment (or systemd `LoadCredential=` files); nothing secret is ever read from
 * plugin config, workflow code, or this repository.
 */
import fs from "node:fs";
import path from "node:path";

export type Env = Readonly<Record<string, string | undefined>>;

export const DEFAULT_MODEL_PROVIDER = "xai";
export const DEFAULT_MODEL = "grok-4.20-0309-non-reasoning";
export const DEFAULT_LIBRARY_URL = "http://127.0.0.1:8768/cupcake-library";
export const DEFAULT_VAPI_BASE_URL = "https://api.vapi.ai";
export const DEFAULT_BRAIN_URL = "https://automate.hales.ai/webhook/cupcake-brain";
export const DEFAULT_COMMAND_URL = "https://automate.hales.ai/webhook/vapi-cupcake-hook";

/** Locked: every Cupcake voice path speaks with Vapi's in-house Clara v2. */
export const CUPCAKE_VOICE = Object.freeze({
  provider: "vapi",
  voiceId: "Clara",
  version: "2",
} as const);

export type AlarmThresholds = {
  /** A single purchase at or above this many dollars raises `spend_single_high`. */
  spendSingleUsd: number;
  /** Food & drink spending over the trailing 7 days at or above this raises `food_spend_7d_high`. */
  foodSpend7dUsd: number;
  /** Logged calories in the trailing 24 hours at or above this raises `calories_24h_high`. */
  calories24h: number;
  /** Logged sugar grams in the trailing 24 hours at or above this raises `sugar_24h_high`. */
  sugar24hGrams: number;
  /** Latest glucose (mg/dL) at or above this raises `glucose_high`. */
  glucoseHighMgDl: number;
  /** Latest glucose (mg/dL) at or below this raises `glucose_low`. */
  glucoseLowMgDl: number;
};

export type PersonaSettings = {
  ownerName: string;
  /** Optional; omitted from the prompt when unset. Personal data stays in env, not git. */
  ownerAge?: number;
  /** Who she tells him to call in an emergency besides 911/988. */
  supportContactName: string;
  /**
   * Optional JSON file with private, verbatim persona section overrides (for example
   * the canonical text from the private voice-vault repo). See README.
   */
  personaFile?: string;
};

export type CallContextSettings = {
  webhookSecret?: string;
  webhookHmacSecret?: string;
  hmacSignatureHeader: string;
  hmacTimestampHeader?: string;
  hmacMaxSkewSeconds: number;
  vapiApiKey?: string;
  vapiBaseUrl: string;
  ownerAssistantId?: string;
  publicAssistantId?: string;
  coachAssistantId?: string;
  nightAssistantId?: string;
  phoneNumberId?: string;
  ownerNumbers: readonly string[];
  coachNumbers: readonly string[];
  outboundNumber?: string;
  outboundEnabled: boolean;
  toolIds: readonly string[];
  model: { provider: string; model: string; maxTokens: number; temperature: number };
  timeZone: string;
  persona: PersonaSettings;
  library: { url: string; key?: string };
  /** Inline mid-call tools (see tools.ts). Tools are only advertised when `key` is set. */
  brain: { url?: string; key?: string; commandUrl?: string };
  plaid: { clientId?: string; secret?: string; accessToken?: string; env: string };
  sourceTimeoutMs: number;
  cacheTtlMs: number;
  thresholds: AlarmThresholds;
};

function text(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function num(env: Env, name: string, fallback: number): number {
  const raw = text(env, name);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

function list(env: Env, name: string): string[] {
  return (text(env, name) ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Resolve a secret from, in order: `NAME`, the file named by `NAME_FILE`, or
 * `$CREDENTIALS_DIRECTORY/<credentialName>` (systemd `LoadCredential=`).
 */
export function readSecret(env: Env, name: string, credentialName: string): string | undefined {
  const direct = text(env, name);
  if (direct) {
    return direct;
  }
  const credentialsDir = text(env, "CREDENTIALS_DIRECTORY");
  const file =
    text(env, `${name}_FILE`) ??
    (credentialsDir ? path.join(credentialsDir, credentialName) : undefined);
  if (!file) {
    return undefined;
  }
  try {
    const value = fs.readFileSync(file, "utf8").trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

/** Normalize a NANP phone number to E.164 (`+1XXXXXXXXXX`); anything else is rejected. */
export function normalizeUsNumber(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length > 40 ||
    !/^[+0-9 ().-]+$/.test(value) ||
    (value.match(/\+/g) ?? []).length > 1 ||
    (value.includes("+") && !value.trimStart().startsWith("+"))
  ) {
    return undefined;
  }
  let digits = value.replace(/[^0-9]/g, "");
  if (digits.length === 10 && !value.includes("+")) {
    digits = `1${digits}`;
  }
  return /^1[2-9][0-9]{2}[2-9][0-9]{6}$/.test(digits) ? `+${digits}` : undefined;
}

function numbers(env: Env, name: string): string[] {
  return list(env, name)
    .map((value) => normalizeUsNumber(value))
    .filter((value): value is string => Boolean(value));
}

export function resolveCallContextSettings(env: Env = process.env): CallContextSettings {
  const ownerAge = text(env, "CUPCAKE_VAPI_OWNER_AGE");
  return {
    webhookSecret: readSecret(env, "CUPCAKE_VAPI_WEBHOOK_SECRET", "vapi-webhook-secret"),
    webhookHmacSecret: readSecret(env, "CUPCAKE_VAPI_WEBHOOK_HMAC_SECRET", "vapi-webhook-hmac"),
    hmacSignatureHeader: (
      text(env, "CUPCAKE_VAPI_HMAC_HEADER") ?? "x-vapi-signature"
    ).toLowerCase(),
    hmacTimestampHeader: text(env, "CUPCAKE_VAPI_HMAC_TIMESTAMP_HEADER")?.toLowerCase(),
    hmacMaxSkewSeconds: num(env, "CUPCAKE_VAPI_HMAC_MAX_SKEW_SECONDS", 300),
    vapiApiKey: readSecret(env, "CUPCAKE_VAPI_API_KEY", "vapi-api-key"),
    vapiBaseUrl: text(env, "CUPCAKE_VAPI_BASE_URL") ?? DEFAULT_VAPI_BASE_URL,
    ownerAssistantId: text(env, "CUPCAKE_VAPI_ASSISTANT_ID"),
    publicAssistantId: text(env, "CUPCAKE_VAPI_PUBLIC_ASSISTANT_ID"),
    coachAssistantId: text(env, "CUPCAKE_VAPI_COACH_ASSISTANT_ID"),
    nightAssistantId: text(env, "CUPCAKE_VAPI_NIGHT_ASSISTANT_ID"),
    phoneNumberId: text(env, "CUPCAKE_VAPI_PHONE_NUMBER_ID"),
    ownerNumbers: numbers(env, "CUPCAKE_VAPI_OWNER_NUMBERS"),
    coachNumbers: numbers(env, "CUPCAKE_VAPI_COACH_NUMBERS"),
    outboundNumber: normalizeUsNumber(text(env, "CUPCAKE_VAPI_OUTBOUND_NUMBER")),
    outboundEnabled: text(env, "CUPCAKE_VAPI_OUTBOUND_ENABLED") === "1",
    toolIds: list(env, "CUPCAKE_VAPI_TOOL_IDS"),
    model: {
      provider: text(env, "CUPCAKE_VAPI_MODEL_PROVIDER") ?? DEFAULT_MODEL_PROVIDER,
      model: text(env, "CUPCAKE_VAPI_MODEL") ?? DEFAULT_MODEL,
      maxTokens: num(env, "CUPCAKE_VAPI_MAX_TOKENS", 300),
      temperature: num(env, "CUPCAKE_VAPI_TEMPERATURE", 0.9),
    },
    timeZone: text(env, "CUPCAKE_VAPI_TIMEZONE") ?? "America/Chicago",
    persona: {
      ownerName: text(env, "CUPCAKE_VAPI_OWNER_NAME") ?? "Matt",
      ownerAge: ownerAge === undefined ? undefined : num(env, "CUPCAKE_VAPI_OWNER_AGE", 0),
      supportContactName: text(env, "CUPCAKE_VAPI_SUPPORT_CONTACT_NAME") ?? "someone he trusts",
      personaFile: text(env, "CUPCAKE_VAPI_PERSONA_FILE"),
    },
    library: {
      url: text(env, "CUPCAKE_LIBRARY_URL") ?? DEFAULT_LIBRARY_URL,
      key: readSecret(env, "CUPCAKE_LIBRARY_KEY", "cupcake-library-key"),
    },
    brain: {
      url: text(env, "CUPCAKE_BRAIN_URL") ?? DEFAULT_BRAIN_URL,
      key: readSecret(env, "CUPCAKE_BRAIN_KEY", "cupcake-brain-key"),
      commandUrl: text(env, "CUPCAKE_VAPI_COMMAND_URL") ?? DEFAULT_COMMAND_URL,
    },
    plaid: {
      clientId: readSecret(env, "PLAID_CLIENT_ID", "plaid-client-id"),
      secret: readSecret(env, "PLAID_SECRET", "plaid-secret"),
      accessToken: readSecret(env, "PLAID_ACCESS_TOKEN", "plaid-access-token"),
      env: text(env, "PLAID_ENV") ?? "production",
    },
    sourceTimeoutMs: num(env, "CUPCAKE_VAPI_SOURCE_TIMEOUT_MS", 1500),
    cacheTtlMs: num(env, "CUPCAKE_VAPI_CACHE_TTL_MS", 60_000),
    thresholds: {
      spendSingleUsd: num(env, "CUPCAKE_VAPI_ALARM_SPEND_SINGLE_USD", 25),
      foodSpend7dUsd: num(env, "CUPCAKE_VAPI_ALARM_FOOD_SPEND_7D_USD", 150),
      calories24h: num(env, "CUPCAKE_VAPI_ALARM_CALORIES_24H", 3000),
      sugar24hGrams: num(env, "CUPCAKE_VAPI_ALARM_SUGAR_24H_G", 75),
      glucoseHighMgDl: num(env, "CUPCAKE_VAPI_ALARM_GLUCOSE_HIGH_MGDL", 180),
      glucoseLowMgDl: num(env, "CUPCAKE_VAPI_ALARM_GLUCOSE_LOW_MGDL", 70),
    },
  };
}
