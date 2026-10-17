/**
 * Vapi call-context plugin. Registers the Vapi server URL route on the Gateway; the route
 * uses plugin-owned auth because Vapi authenticates with its own credential
 * (X-Vapi-Secret / Bearer / HMAC), verified in src/verify.ts before the body is parsed.
 */
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { resolveCallContextSettings } from "./src/config.js";
import { createCallContextHandler } from "./src/handler.js";
import { loadPersonaSections } from "./src/persona.js";

export const DEFAULT_ROUTE_PATH = "/plugins/vapi-call-context";

export default definePluginEntry({
  id: "vapi-call-context",
  name: "Vapi Call Context",
  description: "Cupcake Vapi call-start context and outbound call helper",
  register(api) {
    const routePath = api.pluginConfig?.routePath;
    const path =
      typeof routePath === "string" && routePath.startsWith("/") ? routePath : DEFAULT_ROUTE_PATH;
    const settings = resolveCallContextSettings();
    const sections = loadPersonaSections(settings.persona);
    if (!settings.webhookSecret && !settings.webhookHmacSecret) {
      api.logger.warn(
        "vapi-call-context: CUPCAKE_VAPI_WEBHOOK_SECRET is not set; the route refuses every request",
      );
    }
    api.registerHttpRoute({
      path,
      auth: "plugin",
      match: "exact",
      handler: createCallContextHandler({
        settings,
        sections,
        logger: { info: (m) => api.logger.info(m), warn: (m) => api.logger.warn(m) },
      }),
    });
  },
});
