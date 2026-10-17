/**
 * Operator CLI for the outbound helper. Dry run by default: prints the exact Vapi
 * `POST /call` body (phone number masked) without contacting Vapi's /call create API.
 *
 *   node --import ./scripts/tsx.mjs extensions/vapi-call-context/src/cli.ts \
 *     --trigger purchase --amount 12.94 --merchant "Uber Eats" --category fast-food
 *
 * Add `--send` (and set CUPCAKE_VAPI_OUTBOUND_ENABLED=1) to actually place the call.
 */
import { parseArgs } from "node:util";
import { resolveCallContextSettings } from "./config.js";
import { placeOutboundCall, redactOutboundBody, type OutboundTrigger } from "./outbound.js";
import { loadPersonaSections } from "./persona.js";

function triggerFromArgs(values: Record<string, string | boolean | undefined>): OutboundTrigger {
  const str = (key: string) => {
    const value = values[key];
    return typeof value === "string" ? value : undefined;
  };
  const num = (key: string) => {
    const raw = str(key);
    const parsed = raw === undefined ? Number.NaN : Number(raw);
    if (!Number.isFinite(parsed)) {
      throw new Error(`--${key} must be a number`);
    }
    return parsed;
  };
  switch (str("trigger")) {
    case "purchase":
      return {
        kind: "purchase",
        event: {
          amount: num("amount"),
          notifiedMerchant: str("merchant"),
          category: str("category"),
        },
      };
    case "glucose":
      return {
        kind: "glucose",
        event: { mgDl: num("glucose"), trend: str("trend") ?? "unknown", status: str("status") },
      };
    case "location":
      return {
        kind: "location",
        event: {
          place: str("place") ?? "",
          lastSpendUsd: str("last-spend") === undefined ? undefined : num("last-spend"),
        },
      };
    default:
      throw new Error("--trigger must be purchase, glucose, or location");
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      trigger: { type: "string" },
      amount: { type: "string" },
      merchant: { type: "string" },
      category: { type: "string" },
      glucose: { type: "string" },
      trend: { type: "string" },
      status: { type: "string" },
      place: { type: "string" },
      "last-spend": { type: "string" },
      send: { type: "boolean", default: false },
    },
  });
  const settings = resolveCallContextSettings();
  const result = await placeOutboundCall({
    settings,
    sections: loadPersonaSections(settings.persona),
    trigger: triggerFromArgs(values),
    send: values.send === true,
  });
  const printable = result.body ? { ...result, body: redactOutboundBody(result.body) } : result;
  process.stdout.write(`${JSON.stringify(printable, null, 2)}\n`);
  return result.placed || !values.send ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  },
);
