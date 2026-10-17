import { describe, expect, it } from "vitest";
import {
  assertFullyRendered,
  renderTemplate,
  sanitizePromptValue,
  UnrenderedPlaceholderError,
} from "./template.js";

describe("renderTemplate", () => {
  it("renders every placeholder and fails on a missing value instead of blanking it", () => {
    expect(renderTemplate("{{a}} and {{ b }}", { a: "x", b: "y" })).toBe("x and y");
    expect(() => renderTemplate("Amount: {{amount}}", {})).toThrow(UnrenderedPlaceholderError);
  });

  it("rejects the n8n expressions that Vapi Liquid silently blanked", () => {
    // Verbatim shape from the live Mpesa / Location system prompts.
    for (const leaked of [
      "CATEGORY: {{ $json.matched_category || 'unknown' }}",
      "Amount: ${{ $json.amount }} | Merchant: {{ $json.merchant_guess }}",
      "{% if x %}",
      "money ${amount}",
    ]) {
      expect(() => assertFullyRendered(leaked)).toThrow(UnrenderedPlaceholderError);
    }
  });
});

describe("sanitizePromptValue", () => {
  it("strips template syntax and flattens control characters from untrusted data", () => {
    const value = sanitizePromptValue("Van {{ system }} Leeuwen\n{% raw %} $json.x");
    expect(value).toBe("Van system Leeuwen % raw % json.x");
    expect(() => assertFullyRendered(value)).not.toThrow();
  });
});
