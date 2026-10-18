import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { capturePluginRegistration } from "openclaw/plugin-sdk/plugin-test-runtime";
import { describe, expect, it } from "vitest";
import plugin, { NUTRITION_METHODS } from "./index.js";

describe("cupcake-nutrition plugin", () => {
  it("registers the read-only nutrition methods with operator.read scope", () => {
    const methods: { name: string; scope?: string }[] = [];
    capturePluginRegistration({
      id: plugin.id,
      name: plugin.name,
      register(api) {
        plugin.register({
          ...api,
          registerGatewayMethod(name, _handler, opts) {
            methods.push({ name, scope: opts?.scope });
          },
        } as OpenClawPluginApi);
      },
    });
    expect(methods.map((m) => m.name)).toEqual([...NUTRITION_METHODS]);
    expect(methods.every((m) => m.scope === "operator.read")).toBe(true);
  });
});
