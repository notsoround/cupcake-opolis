import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApplicationGatewaySnapshot } from "../../app/gateway.ts";
import {
  nutritionAdapter,
  setNutritionAdapterForTesting,
  watchNutritionAdapter,
} from "./nutrition-source.ts";

type View = Pick<ApplicationGatewaySnapshot, "client" | "hello" | "phase">;

function view(methods: string[] | null, phase: View["phase"] = "connected"): View {
  return {
    client: { request: vi.fn(async () => ({ meals: [] })) } as unknown as View["client"],
    phase,
    hello: (methods
      ? { features: { methods }, auth: { role: "operator", scopes: ["operator.read"] } }
      : null) as View["hello"],
  };
}

describe("nutrition adapter resolution", () => {
  afterEach(() => setNutritionAdapterForTesting(null));

  it("uses the live Gateway methods when cupcake-nutrition is advertised", () => {
    expect(nutritionAdapter(view(["nutrition.meals.list"])).kind).toBe("live");
  });

  it("labels sample data only when the Gateway lacks the plugin", () => {
    expect(nutritionAdapter(view(["health"])).kind).toBe("sample");
  });

  it("shows an empty offline view before the Gateway connects", () => {
    expect(nutritionAdapter(view(null, "connecting")).kind).toBe("offline");
  });

  it("re-resolves when the Gateway connects", () => {
    let listener: ((snapshot: ApplicationGatewaySnapshot) => void) | null = null;
    const gateway = {
      snapshot: view(null, "connecting") as ApplicationGatewaySnapshot,
      subscribe: (next: (snapshot: ApplicationGatewaySnapshot) => void) => {
        listener = next;
        return () => {};
      },
    };
    const onChange = vi.fn();
    watchNutritionAdapter(gateway, onChange);
    (listener as unknown as (s: ApplicationGatewaySnapshot) => void)(
      view(["nutrition.meals.list"]) as ApplicationGatewaySnapshot,
    );
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ kind: "live" }));
  });
});
