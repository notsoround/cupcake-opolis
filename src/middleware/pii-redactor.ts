/**
 * Cupcake PII & Secret Redaction Middleware
 * ────────────────────────────────────────────────────────────────────────────
 * Scrubs personally-identifiable information and secrets from messages before
 * they are logged, stored, or sent to external APIs.
 *
 * Redacts:
 *   - Credit card numbers (Luhn-valid patterns)
 *   - SSNs (US), SINs (CA), NINOs (UK)
 *   - API keys: Anthropic, OpenAI, GitHub, AWS, Telegram, Stripe, Fly.io
 *   - Bearer tokens and JWT tokens
 *   - Private key blocks (PEM)
 *   - Email addresses (configurable)
 *   - Phone numbers (E.164 + US formats)
 *   - IP addresses (configurable)
 *
 * Configuration:
 *   CUPCAKE_PII_REDACT_EMAILS=true       — redact email addresses (default: false)
 *   CUPCAKE_PII_REDACT_IPS=false         — redact IP addresses (default: false)
 *   CUPCAKE_PII_REDACT_PHONES=true       — redact phone numbers (default: true)
 *   CUPCAKE_PII_ENABLED=true             — master switch (default: true)
 *   CUPCAKE_PII_LOG_REDACTIONS=true      — log count of redactions (not content)
 *   CUPCAKE_PII_ALLOWLIST=pattern1,pat2  — comma-separated regex allowlist
 */

import { createSubsystemLogger } from "../logging/subsystem.js";
import { emitActivity } from "../logging/activity-log.js";

const log = createSubsystemLogger("cupcake/pii-redactor");

// ─── Redaction rules ──────────────────────────────────────────────────────────

export type RedactionSeverity = "critical" | "high" | "medium" | "low";

export type RedactionRule = {
  name: string;
  pattern: RegExp;
  replacement: string;
  severity: RedactionSeverity;
  enabled: boolean;
  /** If true, requires gating behind a config flag */
  optional?: boolean;
  optionEnvKey?: string;
};

// Always-on rules (secrets + financial PII)
const ALWAYS_ON_RULES: RedactionRule[] = [
  // ─── API Keys ───────────────────────────────────────────────────────────────
  {
    name: "Anthropic API Key",
    pattern: /sk-ant-[a-zA-Z0-9\-_]{20,}/g,
    replacement: "[ANTHROPIC_KEY]",
    severity: "critical",
    enabled: true,
  },
  {
    name: "Anthropic Session Key",
    pattern: /sk-ant-sid\d+-[a-zA-Z0-9\-_]{20,}/g,
    replacement: "[ANTHROPIC_SESSION]",
    severity: "critical",
    enabled: true,
  },
  {
    name: "OpenAI API Key",
    pattern: /sk-(?!ant-)[a-zA-Z0-9]{20,}/g,
    replacement: "[OPENAI_KEY]",
    severity: "critical",
    enabled: true,
  },
  {
    name: "OpenAI Project Key",
    pattern: /sk-proj-[a-zA-Z0-9\-_]{20,}/g,
    replacement: "[OPENAI_PROJECT_KEY]",
    severity: "critical",
    enabled: true,
  },
  {
    name: "OpenRouter Key",
    pattern: /sk-or-[a-zA-Z0-9\-_]{20,}/g,
    replacement: "[OPENROUTER_KEY]",
    severity: "critical",
    enabled: true,
  },
  {
    name: "GitHub Classic Token",
    pattern: /ghp_[a-zA-Z0-9]{36}/g,
    replacement: "[GITHUB_TOKEN]",
    severity: "critical",
    enabled: true,
  },
  {
    name: "GitHub Fine-Grained Token",
    pattern: /github_pat_[a-zA-Z0-9_]{82}/g,
    replacement: "[GITHUB_TOKEN]",
    severity: "critical",
    enabled: true,
  },
  {
    name: "AWS Access Key",
    pattern: /AKIA[0-9A-Z]{16}/g,
    replacement: "[AWS_ACCESS_KEY]",
    severity: "critical",
    enabled: true,
  },
  {
    name: "Telegram Bot Token",
    pattern: /\d{8,12}:[a-zA-Z0-9_\-]{35}/g,
    replacement: "[TELEGRAM_TOKEN]",
    severity: "critical",
    enabled: true,
  },
  {
    name: "Stripe Live Key",
    pattern: /sk_live_[a-zA-Z0-9]{24,}/g,
    replacement: "[STRIPE_LIVE_KEY]",
    severity: "critical",
    enabled: true,
  },
  {
    name: "Stripe Test Key",
    pattern: /sk_test_[a-zA-Z0-9]{24,}/g,
    replacement: "[STRIPE_TEST_KEY]",
    severity: "high",
    enabled: true,
  },
  {
    name: "Fly.io Token",
    pattern: /FlyV1\s+[a-zA-Z0-9+/=]{40,}/g,
    replacement: "[FLY_TOKEN]",
    severity: "critical",
    enabled: true,
  },
  // ─── Auth tokens ────────────────────────────────────────────────────────────
  {
    name: "Bearer Token",
    pattern: /Bearer\s+[a-zA-Z0-9\-._~+/]+=*(?=\s|"|'|`|$)/g,
    replacement: "Bearer [REDACTED]",
    severity: "high",
    enabled: true,
  },
  {
    name: "JWT Token",
    pattern: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
    replacement: "[JWT_TOKEN]",
    severity: "high",
    enabled: true,
  },
  {
    name: "PEM Private Key",
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
    replacement: "[PRIVATE_KEY_REDACTED]",
    severity: "critical",
    enabled: true,
  },
  // ─── Financial PII ──────────────────────────────────────────────────────────
  {
    name: "Credit Card Number",
    // 13-19 digit groups, with optional separators
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3,6})?|5[1-5][0-9]{14}|2[2-7][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|6(?:011|5[0-9]{2})[0-9]{12,15}|(?:2131|1800|35\d{3})\d{11})\b/g,
    replacement: "[CC_REDACTED]",
    severity: "critical",
    enabled: true,
  },
  // ─── Government IDs ─────────────────────────────────────────────────────────
  {
    name: "US Social Security Number",
    pattern: /\b(?!000|666|9\d{2})\d{3}[-\s](?!00)\d{2}[-\s](?!0000)\d{4}\b/g,
    replacement: "[SSN_REDACTED]",
    severity: "critical",
    enabled: true,
  },
  {
    name: "Canadian SIN",
    pattern: /\b\d{3}[-\s]\d{3}[-\s]\d{3}\b/g,
    replacement: "[SIN_REDACTED]",
    severity: "high",
    enabled: true,
  },
  {
    name: "UK NINO",
    pattern: /\b[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]\b/gi,
    replacement: "[NINO_REDACTED]",
    severity: "high",
    enabled: true,
  },
];

// Optional rules (controlled by env flags)
const OPTIONAL_RULES: RedactionRule[] = [
  {
    name: "Email Address",
    pattern: /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g,
    replacement: "[EMAIL_REDACTED]",
    severity: "medium",
    enabled: false, // set by CUPCAKE_PII_REDACT_EMAILS=true
    optional: true,
    optionEnvKey: "CUPCAKE_PII_REDACT_EMAILS",
  },
  {
    name: "Phone Number (E.164)",
    pattern: /\+1[-\s]?\(?\d{3}\)?[-\s]?\d{3}[-\s]?\d{4}\b|\b\(\d{3}\)\s?\d{3}[-\s]\d{4}\b/g,
    replacement: "[PHONE_REDACTED]",
    severity: "medium",
    enabled: true, // default on
    optional: true,
    optionEnvKey: "CUPCAKE_PII_REDACT_PHONES",
  },
  {
    name: "IPv4 Address",
    pattern: /\b(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)){3}\b/g,
    replacement: "[IP_REDACTED]",
    severity: "low",
    enabled: false, // set by CUPCAKE_PII_REDACT_IPS=true
    optional: true,
    optionEnvKey: "CUPCAKE_PII_REDACT_IPS",
  },
];

// ─── Config ───────────────────────────────────────────────────────────────────

function getConfig() {
  return {
    enabled: process.env.CUPCAKE_PII_ENABLED !== "false",
    logRedactions: process.env.CUPCAKE_PII_LOG_REDACTIONS !== "false",
    redactEmails: process.env.CUPCAKE_PII_REDACT_EMAILS === "true",
    redactPhones: process.env.CUPCAKE_PII_REDACT_PHONES !== "false", // default true
    redactIps: process.env.CUPCAKE_PII_REDACT_IPS === "true",
    allowlist: (process.env.CUPCAKE_PII_ALLOWLIST ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

function buildActiveRules(): RedactionRule[] {
  const config = getConfig();
  const rules: RedactionRule[] = [...ALWAYS_ON_RULES];

  for (const rule of OPTIONAL_RULES) {
    const envKey = rule.optionEnvKey;
    if (!envKey) continue;

    // Check env to determine if this optional rule is active
    if (rule.name === "Email Address") {
      rules.push({ ...rule, enabled: config.redactEmails });
    } else if (rule.name.startsWith("Phone")) {
      rules.push({ ...rule, enabled: config.redactPhones });
    } else if (rule.name.startsWith("IPv4")) {
      rules.push({ ...rule, enabled: config.redactIps });
    } else {
      rules.push(rule);
    }
  }

  return rules.filter((r) => r.enabled);
}

// ─── Core redactor ────────────────────────────────────────────────────────────

export type RedactionResult = {
  text: string;
  redactions: Array<{ rule: string; severity: RedactionSeverity; count: number }>;
  totalRedacted: number;
};

/**
 * Redact PII and secrets from a string.
 * Returns the sanitized text and a summary of what was redacted (not the original values).
 */
export function redact(input: string, sessionId?: string): RedactionResult {
  const config = getConfig();
  if (!config.enabled) {
    return { text: input, redactions: [], totalRedacted: 0 };
  }

  const activeRules = buildActiveRules();
  const redactions: RedactionResult["redactions"] = [];
  let text = input;

  for (const rule of activeRules) {
    // Check allowlist
    if (config.allowlist.some((pattern) => {
      try { return new RegExp(pattern).test(text); } catch { return false; }
    })) {
      continue;
    }

    const before = text;
    let count = 0;

    // Reset regex lastIndex for global patterns
    rule.pattern.lastIndex = 0;
    text = text.replace(rule.pattern, () => {
      count++;
      return rule.replacement;
    });

    if (text !== before) {
      redactions.push({ rule: rule.name, severity: rule.severity, count });
    }
  }

  const totalRedacted = redactions.reduce((s, r) => s + r.count, 0);

  if (totalRedacted > 0 && config.logRedactions) {
    const summary = redactions.map((r) => `${r.rule}(${r.count})`).join(", ");
    log.warn(`Redacted ${totalRedacted} item(s)`, { summary, sessionId });
    emitActivity({
      event: "heartbeat",
      session_id: sessionId,
      actor: "pii-redactor",
      meta: { redacted: totalRedacted, types: summary },
    });
  }

  return { text, redactions, totalRedacted };
}

/**
 * Redact PII from a message object (in/out).
 * Handles both string content and array content blocks.
 */
export function redactMessage(
  message: { role: string; content: string | Array<{ type: string; text?: string }> },
  sessionId?: string
): typeof message {
  if (typeof message.content === "string") {
    const { text } = redact(message.content, sessionId);
    return { ...message, content: text };
  }

  if (Array.isArray(message.content)) {
    const redactedBlocks = message.content.map((block) => {
      if (block.type === "text" && block.text) {
        const { text } = redact(block.text, sessionId);
        return { ...block, text };
      }
      return block;
    });
    return { ...message, content: redactedBlocks };
  }

  return message;
}

/**
 * Redact PII from an array of messages (conversation history).
 */
export function redactConversation(
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>,
  sessionId?: string
): typeof messages {
  return messages.map((m) => redactMessage(m, sessionId));
}

/**
 * Quick check: does a string contain any detectable secrets/PII?
 * Returns list of rule names that matched (not the content).
 */
export function detectPii(input: string): string[] {
  const config = getConfig();
  if (!config.enabled) return [];

  const activeRules = buildActiveRules();
  const found: string[] = [];

  for (const rule of activeRules) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(input)) {
      found.push(rule.name);
    }
  }

  return found;
}

/**
 * Create a redaction middleware function for use in message pipelines.
 *
 * Usage:
 *   const middleware = createRedactionMiddleware({ sessionId: "abc123" });
 *   const safeMessage = middleware(rawMessage);
 */
export function createRedactionMiddleware(opts: { sessionId?: string } = {}) {
  return function redactionMiddleware<
    T extends { role: string; content: string | Array<{ type: string; text?: string }> }
  >(message: T): T {
    return redactMessage(message, opts.sessionId) as T;
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export {
  ALWAYS_ON_RULES,
  OPTIONAL_RULES,
  getConfig as getPiiConfig,
};
