/**
 * Inline Vapi function tools for Cupcake's owner and coach calls.
 *
 * These mirror, byte for byte, the inline tools the n8n "Cupcake Inbound Router" sends in
 * its assistantOverrides (and that the saved "Cupcake — Accountability Voice" assistant
 * carries). Vapi replaces the saved assistant's `model` wholesale when an override supplies
 * `model`, so an override that only lists `toolIds` silently drops these tools. The schemas
 * live here; the brain URL and its shared key come from env / systemd credentials only.
 */
import type { CallContextSettings } from "./config.js";

/** The eleven read-only brain lookups (n8n "Cupcake Brain Connector"). */
export const BRAIN_TOOL_FUNCTIONS = Object.freeze([
  {
    name: "lookup_spending",
    parameters: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          maximum: 90,
          minimum: 1,
          description: "Lookback window in days (1-90, default 7)",
        },
        category: {
          type: "string",
          maxLength: 40,
          description: "Optional category substring",
        },
        merchant: {
          type: "string",
          maxLength: 40,
          description: "Optional merchant substring",
        },
      },
      additionalProperties: false,
    },
    description:
      'Look up Matt\'s real spending over a bounded window. Call this before answering totals, last week, last month, a merchant, a category, or "how have I been spending".',
  },
  {
    name: "recent_bank_events",
    parameters: {
      type: "object",
      properties: {
        hours: {
          type: "integer",
          maximum: 168,
          minimum: 1,
          description: "Lookback hours (1-168, default 24)",
        },
        limit: {
          type: "integer",
          maximum: 25,
          minimum: 1,
          description: "Max events (1-25, default 10)",
        },
      },
      additionalProperties: false,
    },
    description:
      "Recent bank / intervention events (charges that already fired a call or were observed in UCCU notifications). This is not settled bank history. Preserve partial coverage and uncertain legacy timestamps. No account numbers.",
  },
  {
    name: "glucose_status",
    parameters: {
      type: "object",
      properties: {
        hours: {
          type: "integer",
          maximum: 48,
          minimum: 1,
          description: "Lookback hours (1-48, default 2)",
        },
      },
      additionalProperties: false,
    },
    description:
      "Latest CGM / glucose readings in a bounded window. Call before answering any blood-sugar question.",
  },
  {
    name: "sleep_status",
    parameters: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          maximum: 14,
          minimum: 1,
          description: "Lookback days (1-14, default 2)",
        },
      },
      additionalProperties: false,
    },
    description: "Recent sleep / Activity-tab status. Call before answering whether he slept.",
  },
  {
    name: "location_status",
    parameters: {
      type: "object",
      properties: {
        hours: {
          type: "integer",
          maximum: 72,
          minimum: 1,
          description: "Lookback hours (1-72, default 24)",
        },
        limit: {
          type: "integer",
          maximum: 25,
          minimum: 1,
          description: "Max events (1-25, default 5)",
        },
      },
      additionalProperties: false,
    },
    description: "Where his phone has been (Tasker / location events). Bounded hours.",
  },
  {
    name: "commitment_status",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          maximum: 25,
          minimum: 1,
          description: "Max rows (1-25, default 5)",
        },
      },
      additionalProperties: false,
    },
    description: "Open and recently closed promises from the Commitments tab.",
  },
  {
    name: "report_status",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    description:
      "Whether the scheduled reports (briefing, spend tracker, watchdog) have been running. Names and success/fail only.",
  },
  {
    name: "system_health",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    description:
      "Whether critical automations are active. Returns counts and missing workflow names only — never hostnames or URLs.",
  },
  {
    name: "weight_status",
    parameters: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          maximum: 366,
          minimum: 1,
        },
        limit: {
          type: "integer",
          maximum: 200,
          minimum: 1,
        },
        cursor: {
          type: "string",
          maxLength: 1000,
        },
      },
      additionalProperties: false,
    },
    description:
      "Read individual Health Connect weigh-ins, original measurement time, and a separate labeled daily aggregate. Call before answering weight questions. Never substitute an average for the latest individual measurement. Preserve owner-correction labels; excluded originals are not current measurements.",
  },
  {
    name: "context_snapshot",
    parameters: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          maximum: 90,
          minimum: 1,
        },
      },
      additionalProperties: false,
    },
    description:
      "Fetch a compact current snapshot of weight, steps, posted spending and bank notifications. Preserve source dates, coverage, and unavailable status. Do not add notifications to posted totals or treat missing facts as zero.",
  },
  {
    name: "steps_status",
    parameters: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          maximum: 14,
          minimum: 1,
        },
      },
      additionalProperties: false,
    },
    description:
      "Read the latest uploaded step-count observation and its date, upload time, freshness and coverage. Use for steps/walking, never location_status. Snapshots can be rolling 24-hour totals, not today's final count. Never add successive cumulative snapshots. Distinguish owner reports from phone data.",
  },
] as const);

export const BRAIN_TOOL_NAMES: readonly string[] = BRAIN_TOOL_FUNCTIONS.map((fn) => fn.name);

const BRAIN_TOOL_MESSAGES = [
  {
    type: "request-response-delayed",
    content: "Hold on, pulling up your numbers.",
    timingMilliseconds: 2000,
  },
];
const BRAIN_TOOL_TIMEOUT_SECONDS = 30;

/** Owner-only action tool (n8n "vapi-cupcake-hook"); never offered to the coach. */
export const CUPCAKE_COMMAND_FUNCTION = Object.freeze({
  name: "cupcake_command",
  parameters: {
    type: "object",
    required: ["command"],
    properties: {
      command: {
        type: "string",
        description: "The command to execute",
      },
      context: {
        type: "string",
        description: "Additional context from voice conversation",
      },
    },
  },
  description:
    "Execute an explicit owner request. For a personal win or loss/setback, send Matt's short scoring request in command, preserving his words and requested date. The server verifies owner speech and returns a persisted saved:true receipt or an unconfirmed error; never claim a save without its receipt. Not a data lookup. Existing deploy, draw, code and other actions retain their approval requirements.",
} as const);

export type InlineTool = Record<string, unknown> & {
  type: "function";
  function: { name: string };
  server: { url: string };
};

/**
 * Build the inline tool list for one call. Returns [] when the brain key is not
 * configured, so a misconfigured host never advertises tools that would 401.
 */
export function buildInlineTools(
  settings: CallContextSettings,
  opts: { identity: "owner" | "coach" } = { identity: "owner" },
): InlineTool[] {
  const { url, key, commandUrl } = settings.brain;
  if (!url || !key) {
    return [];
  }
  const brain: InlineTool[] = BRAIN_TOOL_FUNCTIONS.map((fn) => ({
    type: "function",
    server: {
      url,
      headers: { "X-Cupcake-Brain-Key": key },
      timeoutSeconds: BRAIN_TOOL_TIMEOUT_SECONDS,
    },
    function: structuredClone(fn) as InlineTool["function"],
    messages: structuredClone(BRAIN_TOOL_MESSAGES),
  }));
  if (opts.identity !== "owner" || !commandUrl) {
    return brain;
  }
  return [
    {
      type: "function",
      server: { url: commandUrl },
      function: structuredClone(CUPCAKE_COMMAND_FUNCTION) as InlineTool["function"],
    },
    ...brain,
  ];
}
