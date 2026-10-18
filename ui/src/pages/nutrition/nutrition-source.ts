import type { ApplicationGatewaySnapshot } from "../../app/gateway.ts";
import { canCallGatewayMethod, isGatewayMethodAdvertised } from "../../lib/gateway-methods.ts";
import { getSafeLocalStorage } from "../../local-storage.ts";
import { createSampleNutritionAdapter, type NutritionAdapter } from "./nutrition-adapter.ts";
import {
  createLiveNutritionAdapter,
  createOfflineNutritionAdapter,
  NUTRITION_MEALS_METHOD,
} from "./nutrition-live-adapter.ts";

type GatewayView = Pick<ApplicationGatewaySnapshot, "client" | "hello" | "phase">;
type Client = NonNullable<ApplicationGatewaySnapshot["client"]>;

let testOverride: NutritionAdapter | null = null;
let local: NutritionAdapter | null = null;
let offline: NutritionAdapter | null = null;
let current: NutritionAdapter | null = null;
/** One live adapter per Gateway client, so a reconnect never reuses another connection. */
const liveByClient = new WeakMap<Client, NutritionAdapter>();

function localStore(): NutritionAdapter {
  local ??= createSampleNutritionAdapter({ storage: getSafeLocalStorage() });
  return local;
}

function resolve(snapshot: GatewayView | null | undefined): NutritionAdapter {
  const client = snapshot?.client;
  if (!client || snapshot.phase !== "connected" || !snapshot.hello) {
    // Keep showing the live view through a brief reconnect; never start on samples.
    if (current?.kind === "live") {
      return current;
    }
    offline ??= createOfflineNutritionAdapter(localStore());
    return offline;
  }
  if (canCallGatewayMethod(snapshot, NUTRITION_MEALS_METHOD, "operator.read")) {
    let live = liveByClient.get(client);
    if (!live) {
      live = createLiveNutritionAdapter({
        request: (method, params) => client.request(method, params),
        local: localStore(),
      });
      liveByClient.set(client, live);
    }
    return live;
  }
  if (isGatewayMethodAdvertised(snapshot, NUTRITION_MEALS_METHOD) === false) {
    // This Gateway has no cupcake-nutrition plugin: labeled sample data.
    return localStore();
  }
  offline ??= createOfflineNutritionAdapter(localStore());
  return offline;
}

/**
 * The adapter every Cupcake nutrition surface reads from. Pass the current Gateway
 * snapshot to (re)resolve it: live Gateway methods when the cupcake-nutrition plugin
 * is advertised, labeled sample data when the Gateway lacks it, and an empty
 * "offline" view while disconnected. Without an argument, returns the last
 * resolved adapter (for widgets that only touch browser-local entries).
 */
export function nutritionAdapter(snapshot?: GatewayView | null): NutritionAdapter {
  if (testOverride) {
    return testOverride;
  }
  if (snapshot !== undefined) {
    current = resolve(snapshot);
  }
  current ??= resolve(null);
  return current;
}

/** Test seam: replace the adapter (pass null to restore the default). */
export function setNutritionAdapterForTesting(next: NutritionAdapter | null): void {
  testOverride = next;
  if (!next) {
    current = null;
  }
}

type GatewayHost = {
  snapshot: ApplicationGatewaySnapshot;
  subscribe: (listener: (snapshot: ApplicationGatewaySnapshot) => void) => () => void;
};

/**
 * Resolve the adapter for this Gateway now and whenever its connection changes;
 * `onChange` runs only when the resolved adapter itself changes (connect, plugin
 * advertised, reconnect to a new client). Returns the unsubscribe function.
 */
export function watchNutritionAdapter(
  gateway: GatewayHost | null | undefined,
  onChange: (adapter: NutritionAdapter) => void,
): () => void {
  let last = nutritionAdapter(gateway ? gateway.snapshot : undefined);
  if (!gateway) {
    return () => {};
  }
  return gateway.subscribe((snapshot) => {
    const next = nutritionAdapter(snapshot);
    if (next !== last) {
      last = next;
      onChange(next);
    }
  });
}
