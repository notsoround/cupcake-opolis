/**
 * Standalone server for hosts that run this without the OpenClaw Gateway (the droplet's
 * `cupcake-gateway` container is not running today). Binds loopback only; nginx
 * terminates TLS and proxies the public Vapi server URL here.
 *
 *   node --import ./scripts/tsx.mjs extensions/vapi-call-context/src/standalone.ts
 */
import { createServer } from "node:http";
import { resolveCallContextSettings } from "./config.js";
import { createCallContextHandler } from "./handler.js";
import { loadPersonaSections } from "./persona.js";

const settings = resolveCallContextSettings();
const sections = loadPersonaSections(settings.persona);
const host = process.env.CUPCAKE_VAPI_LISTEN_HOST?.trim() || "127.0.0.1";
const port = Number(process.env.CUPCAKE_VAPI_LISTEN_PORT ?? "8791");
const path = process.env.CUPCAKE_VAPI_ROUTE_PATH?.trim() || "/vapi/call-context";

if (!settings.webhookSecret && !settings.webhookHmacSecret) {
  process.stderr.write(
    "vapi-call-context: no webhook secret configured; every request will be refused\n",
  );
}

const handler = createCallContextHandler({
  settings,
  sections,
  logger: {
    info: (m) => process.stdout.write(`${m}\n`),
    warn: (m) => process.stderr.write(`${m}\n`),
  },
});

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  if (url.pathname !== path) {
    res.writeHead(404);
    res.end();
    return;
  }
  handler(req, res).catch(() => {
    if (!res.headersSent) {
      res.writeHead(500);
    }
    res.end();
  });
}).listen(port, host, () => {
  process.stdout.write(`vapi-call-context listening on http://${host}:${port}${path}\n`);
});
