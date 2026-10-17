import { getSafeLocalStorage } from "../../local-storage.ts";
import { createSampleNutritionAdapter, type NutritionAdapter } from "./nutrition-adapter.ts";

let adapter: NutritionAdapter | null = null;

/**
 * The adapter every Cupcake nutrition surface reads from.
 *
 * TODO(cupcake-nutrition-backend): return a Gateway-backed `kind: "live"`
 * adapter here once nutritionApi.ts / nutritionModel.ts (or equivalent Gateway
 * methods) exist in this repository. Until then the UI is driven by sample data
 * and labels itself as such.
 */
export function nutritionAdapter(): NutritionAdapter {
  adapter ??= createSampleNutritionAdapter({ storage: getSafeLocalStorage() });
  return adapter;
}

/** Test seam: replace the adapter (pass null to restore the default). */
export function setNutritionAdapterForTesting(next: NutritionAdapter | null): void {
  adapter = next;
}
