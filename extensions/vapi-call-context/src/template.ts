/**
 * Server-side prompt rendering.
 *
 * The n8n call bodies embedded `{{ $json.amount }}`-style expressions inside plain
 * Code-node strings. n8n never evaluates expressions there, so Vapi received the raw
 * braces, treated them as Liquid, and rendered every one of them as an empty string:
 * "CATEGORY: " with nothing after it, "Amount: $ | Merchant:  ()". This module renders
 * every placeholder here, fails loudly on a missing value, and verifies that nothing
 * template-shaped survives into what Vapi receives.
 */

const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

/** Anything Vapi (Liquid) or n8n would try to interpret, or that betrays a missed render. */
const UNRENDERED_PATTERNS: readonly RegExp[] = [
  /\{\{/,
  /\}\}/,
  /\{%/,
  /%\}/,
  /\$json\b/,
  /\$\{/,
  /\$\(\s*['"]/,
];

export class UnrenderedPlaceholderError extends Error {
  constructor(
    message: string,
    readonly fragment: string,
  ) {
    super(message);
    this.name = "UnrenderedPlaceholderError";
  }
}

export type TemplateValues = Readonly<Record<string, string>>;

/** Render `{{name}}` placeholders. Missing keys throw instead of silently blanking. */
export function renderTemplate(template: string, values: TemplateValues): string {
  const rendered = template.replace(PLACEHOLDER, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) {
      throw new UnrenderedPlaceholderError(`missing template value "${key}"`, key);
    }
    return value;
  });
  assertFullyRendered(rendered);
  return rendered;
}

/** Throw when text still carries template syntax that Vapi would evaluate or blank. */
export function assertFullyRendered(text: string): void {
  for (const pattern of UNRENDERED_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      const start = Math.max(0, match.index - 30);
      throw new UnrenderedPlaceholderError(
        `unrendered template syntax ${JSON.stringify(match[0])} in rendered prompt`,
        text.slice(start, match.index + 30),
      );
    }
  }
}

// eslint-disable-next-line no-control-regex -- stripping control characters is the point.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g;

/**
 * Neutralize untrusted text (merchant names, transcripts, summaries) before it is
 * placed in a prompt. Brace and Liquid tag sequences are removed so data can never be
 * evaluated as a template by Vapi, and control characters / newlines are flattened.
 */
export function sanitizePromptValue(value: unknown, maxLength = 600): string {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  return text
    .replace(/[{}]/g, "")
    .replace(/\$json/gi, "json")
    .replace(CONTROL_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
