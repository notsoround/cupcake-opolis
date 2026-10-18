import { describe, expect, it } from "vitest";
import { buildCallContext, gatherContext, toAssistantOverrides } from "./assemble.js";
import { DEFAULT_PERSONA_SECTIONS } from "./persona.js";
import { NOW_MS, testSettings } from "./test-fixtures.js";
import { BRAIN_TOOL_NAMES, buildInlineTools } from "./tools.js";

const KEY = "test-brain-key-not-real";
const EXPECTED_BRAIN = [
  "lookup_spending",
  "recent_bank_events",
  "glucose_status",
  "sleep_status",
  "location_status",
  "commitment_status",
  "report_status",
  "system_health",
  "weight_status",
  "context_snapshot",
  "steps_status",
];

const names = (tools: { function: { name: string } }[]) => tools.map((t) => t.function.name);

describe("inline brain tools", () => {
  it("lists the eleven n8n brain lookups in order", () => {
    expect(BRAIN_TOOL_NAMES).toEqual(EXPECTED_BRAIN);
  });

  it("advertises nothing without a brain key", () => {
    expect(buildInlineTools(testSettings())).toEqual([]);
  });

  it("owner gets cupcake_command plus the brain tools, each carrying the key header", () => {
    const tools = buildInlineTools(testSettings({ CUPCAKE_BRAIN_KEY: KEY }));
    expect(names(tools)).toEqual(["cupcake_command", ...EXPECTED_BRAIN]);
    for (const tool of tools.slice(1)) {
      expect(tool.server).toEqual({
        url: "https://automate.hales.ai/webhook/cupcake-brain",
        headers: { "X-Cupcake-Brain-Key": KEY },
        timeoutSeconds: 30,
      });
      expect(tool.messages).toHaveLength(1);
    }
    expect(tools[0].server).toEqual({ url: "https://automate.hales.ai/webhook/vapi-cupcake-hook" });
  });

  it("coach never gets cupcake_command", () => {
    const tools = buildInlineTools(testSettings({ CUPCAKE_BRAIN_KEY: KEY }), { identity: "coach" });
    expect(names(tools)).toEqual(EXPECTED_BRAIN);
  });

  it("owner overrides re-send the inline tools alongside toolIds; night sends none", async () => {
    for (const calm of [false, true]) {
      const settings = testSettings({
        CUPCAKE_BRAIN_KEY: KEY,
        CUPCAKE_VAPI_TOOL_IDS: "tool-a,tool-b",
      });
      const trigger = { kind: "inbound" as const, night: calm };
      const gathered = await gatherContext({
        settings,
        trigger,
        fetchImpl: async () => new Response("{}", { status: 503 }),
        nowMs: NOW_MS,
        calm,
      });
      const ctx = buildCallContext({
        settings,
        sections: DEFAULT_PERSONA_SECTIONS,
        trigger,
        gathered,
        nowMs: NOW_MS,
        calm,
      });
      const model = toAssistantOverrides(ctx, settings).model as {
        tools?: { function: { name: string } }[];
        toolIds?: string[];
      };
      if (calm) {
        expect(model.tools).toBeUndefined();
        expect(model.toolIds).toBeUndefined();
      } else {
        expect(names(model.tools ?? [])).toEqual(["cupcake_command", ...EXPECTED_BRAIN]);
        expect(model.toolIds).toEqual(["tool-a", "tool-b"]);
        expect(ctx.systemPrompt).toContain("weight_status");
      }
    }
  });
});
