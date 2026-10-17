// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Locks the Cupcake pink accent (calm + hot, dark + light) to WCAG 2.1 AA.
const baseCss = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "base.css"),
  "utf8",
);

function block(selector: string): Map<string, string> {
  const start = baseCss.indexOf(`${selector} {`);
  if (start < 0) {
    throw new Error(`missing ${selector}`);
  }
  const body = baseCss.slice(start, baseCss.indexOf("\n}", start));
  const tokens = new Map<string, string>();
  for (const match of body.matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gmu)) {
    tokens.set(match[1], match[2].trim());
  }
  return tokens;
}

function luminance(hex: string): number {
  const match = hex.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu);
  if (!match) {
    throw new Error(`not a hex color: ${hex}`);
  }
  const [r, g, b] = match.slice(1).map((part) => {
    const channel = Number.parseInt(part, 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const root = block(":root");
const light = block(':root:where([data-theme-mode="light"])');
const claw = block(':root[data-theme="dark"]');
const hotDark = new Map([
  ...root,
  ...claw,
  ...block(':root[data-theme="dark"][data-accent-heat="hot"]'),
]);
const calmDark = new Map([...root, ...claw]);
const calmLight = new Map([...root, ...light]);
const hotLight = new Map([
  ...root,
  ...light,
  ...block(':root[data-theme="light"][data-accent-heat="hot"]'),
]);

const cases = [
  ["calm dark", calmDark, ["--bg", "--card", "--bg-hover"]],
  ["hot dark", hotDark, ["--bg", "--card", "--bg-hover"]],
  ["calm light", calmLight, ["--bg", "--card"]],
  ["hot light", hotLight, ["--bg", "--card"]],
] as const;

describe("Cupcake pink accent contrast", () => {
  it.each(cases)("%s keeps accent text, ink, and fills at AA", (_name, tokens, surfaces) => {
    const get = (name: string) => {
      const value = tokens.get(name);
      if (!value) {
        throw new Error(`missing ${name}`);
      }
      return value;
    };
    for (const surface of surfaces) {
      expect(contrast(get("--accent"), get(surface))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(get("--accent-hover"), get(surface))).toBeGreaterThanOrEqual(4.5);
      // Focus ring is a UI component indicator (WCAG 1.4.11).
      expect(contrast(get("--ring"), get(surface))).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(get("--accent-foreground"), get("--accent"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(get("--primary-foreground"), get("--primary"))).toBeGreaterThanOrEqual(4.5);
    const hover = get("--primary-hover");
    if (hover.startsWith("#")) {
      expect(contrast(get("--primary-foreground"), hover)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("publishes the pink scale primitives", () => {
    expect(root.get("--cupcake-pink-calm")).toBe("#ff8fab");
    expect(root.get("--cupcake-pink")).toBe("#ff6b9d");
    expect(root.get("--cupcake-pink-hot")).toBe("#ff2d6f");
    expect(calmDark.get("--accent")).toBe("#ff6b9d");
  });
});
