import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { capturePluginRegistration } from "openclaw/plugin-sdk/plugin-test-runtime";
import { describe, expect, it } from "vitest";
import plugin, { DEFAULT_ROUTE_PATH } from "./index.js";

describe("vapi-call-context plugin", () => {
  it("registers one exact, plugin-authenticated Vapi route", () => {
    const routes: Parameters<OpenClawPluginApi["registerHttpRoute"]>[0][] = [];
    capturePluginRegistration({
      id: plugin.id,
      name: plugin.name,
      register(api) {
        plugin.register({
          ...api,
          registerHttpRoute(params) {
            routes.push(params);
          },
        });
      },
    });
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ path: DEFAULT_ROUTE_PATH, auth: "plugin", match: "exact" });
  });
});
