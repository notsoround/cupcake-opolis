import { afterEach, describe, expect, it, vi } from "vitest";
import { runSource, TtlCache } from "./gather.js";
import { SourceDisabledError } from "./sources/types.js";

const fetchImpl = async () => new Response("{}");

afterEach(() => {
  vi.useRealTimers();
});

describe("runSource", () => {
  it("times out a hung source, aborts it, and reports it unavailable", async () => {
    vi.useFakeTimers();
    let aborted = false;
    const pending = runSource({
      name: "food",
      fetchImpl,
      timeoutMs: 1500,
      nowMs: 0,
      run: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        }),
    });
    await vi.advanceTimersByTimeAsync(1500);
    await expect(pending).resolves.toEqual({
      status: "unavailable",
      reason: "food timed out after 1500ms",
    });
    expect(aborted).toBe(true);
  });

  it("reports disabled sources separately from failures", async () => {
    const outcome = await runSource({
      name: "plaid",
      fetchImpl,
      timeoutMs: 100,
      nowMs: 0,
      run: async () => {
        throw new SourceDisabledError("PLAID_* not set");
      },
    });
    expect(outcome).toEqual({ status: "disabled", reason: "PLAID_* not set" });
  });

  it("serves successful results from the short-term cache until they expire", async () => {
    const cache = new TtlCache();
    const run = vi.fn(async () => 42);
    const params = { name: "food", fetchImpl, timeoutMs: 100, cache, cacheTtlMs: 60_000, run };
    expect(await runSource({ ...params, nowMs: 0 })).toEqual({
      status: "ok",
      value: 42,
      cached: false,
    });
    expect(await runSource({ ...params, nowMs: 59_999 })).toEqual({
      status: "ok",
      value: 42,
      cached: true,
    });
    expect(await runSource({ ...params, nowMs: 60_000 })).toMatchObject({ cached: false });
    expect(run).toHaveBeenCalledTimes(2);
  });
});
