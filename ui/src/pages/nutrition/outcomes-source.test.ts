import { describe, expect, it, vi } from "vitest";
import { loadOutcomes, parseOutcomesPayload, winRate } from "./outcomes-source.ts";

describe("outcomes source", () => {
  it("parses entries and counts, dropping malformed rows", () => {
    const result = parseOutcomesPayload({
      entries: [
        { id: "a", date: "2026-10-17", title: "Bought it anyway", outcome: "loss", note: "x" },
        { id: "b", date: "2026-10-11", title: "Walk", outcome: "win" },
        { id: "c", date: "2026-10-11", title: "Bad", outcome: "maybe" },
      ],
      counts: { wins: 1, losses: 1, unscored: 0, total: 2 },
      stale: true,
    });
    expect(result).toEqual({
      status: "ok",
      entries: [
        { id: "a", date: "2026-10-17", title: "Bought it anyway", outcome: "loss", note: "x" },
        { id: "b", date: "2026-10-11", title: "Walk", outcome: "win", note: "" },
      ],
      counts: { wins: 1, losses: 1, unscored: 0, total: 2 },
      stale: true,
    });
  });

  it("never invents scores when offline, missing the plugin, or failing", async () => {
    await expect(loadOutcomes(null, { start: 0, end: 1 })).resolves.toEqual({
      status: "unavailable",
      reason: "offline",
    });
    const request = vi.fn(async () => {
      throw new Error("cupcake library responded HTTP 503");
    });
    const snapshot = {
      client: { request },
      phase: "connected",
      hello: {
        features: { methods: ["nutrition.outcomes.list"] },
        auth: { role: "operator", scopes: ["operator.read"] },
      },
    } as never;
    const failed = await loadOutcomes(snapshot, { start: 0, end: 1 });
    expect(request).toHaveBeenCalledWith("nutrition.outcomes.list", { start: 0, end: 1 });
    expect(failed).toMatchObject({ status: "unavailable", reason: "error" });
    expect(parseOutcomesPayload({ nope: true }).status).toBe("unavailable");
  });

  it("computes the win rate over scored entries only", () => {
    expect(winRate({ wins: 8, losses: 4, unscored: 3, total: 15 })).toBe(67);
    expect(winRate({ wins: 0, losses: 0, unscored: 2, total: 2 })).toBeNull();
  });
});
