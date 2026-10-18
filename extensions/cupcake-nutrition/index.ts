/**
 * Cupcake nutrition plugin: read-only `nutrition.*` Gateway methods for the Control UI
 * Today screen. Data comes from Matt's real stores (see src/sources.ts); secrets come
 * from the Gateway environment only (see src/config.ts).
 */
import { ErrorCodes, errorShape } from "openclaw/plugin-sdk/gateway-runtime";
import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { resolveNutritionSettings } from "./src/config.js";
import {
  createNutritionService,
  InvalidParamsError,
  parseRange,
  type NutritionService,
} from "./src/service.js";

export const NUTRITION_METHODS = [
  "nutrition.meals.list",
  "nutrition.receipts.list",
  "nutrition.glucose.closest",
  "nutrition.targets.get",
  "nutrition.outcomes.list",
] as const;

export function registerNutritionMethods(api: OpenClawPluginApi, service: NutritionService): void {
  const register = (
    name: (typeof NUTRITION_METHODS)[number],
    run: (params: unknown) => Promise<unknown>,
  ) => {
    api.registerGatewayMethod(
      name,
      async ({ params, respond }) => {
        try {
          respond(true, await run(params ?? {}));
        } catch (error) {
          const invalid = error instanceof InvalidParamsError;
          if (!invalid) {
            api.logger.warn(
              `cupcake-nutrition: ${name} failed: ${(error as Error)?.message ?? "error"}`,
            );
          }
          respond(
            false,
            undefined,
            errorShape(
              invalid ? ErrorCodes.INVALID_REQUEST : ErrorCodes.UNAVAILABLE,
              error instanceof Error ? error.message : "nutrition source unavailable",
            ),
          );
        }
      },
      { scope: "operator.read" },
    );
  };
  register("nutrition.meals.list", (params) => service.listMeals(parseRange(params)));
  register("nutrition.receipts.list", (params) => service.listReceipts(parseRange(params)));
  register("nutrition.glucose.closest", (params) => {
    const range = parseRange(params);
    const at = (params as { at?: unknown }).at;
    if (typeof at !== "number" || !Number.isFinite(at)) {
      throw new InvalidParamsError("at must be epoch milliseconds");
    }
    return service.closestGlucose(range, at);
  });
  register("nutrition.targets.get", () => service.getTargets());
  register("nutrition.outcomes.list", (params) => service.listOutcomes(parseRange(params)));
}

export default definePluginEntry({
  id: "cupcake-nutrition",
  name: "Cupcake Nutrition",
  description: "Read-only nutrition methods for the Cupcake Today screen",
  register(api) {
    const settings = resolveNutritionSettings();
    if (!settings.library.key) {
      api.logger.warn(
        "cupcake-nutrition: CUPCAKE_OWNER_KEY / CUPCAKE_LIBRARY_KEY not set; meals are unavailable",
      );
    }
    if (!settings.brain.key) {
      api.logger.warn(
        "cupcake-nutrition: CUPCAKE_BRAIN_KEY not set; bank purchases are unavailable",
      );
    }
    registerNutritionMethods(api, createNutritionService({ settings }));
  },
});
