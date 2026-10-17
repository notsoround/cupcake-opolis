/**
 * Parallel, time-boxed source fetching with graceful degradation.
 *
 * Vapi gives an `assistant-request` 7.5 s end to end, so every source gets its own
 * timeout and abort signal, all of them run concurrently, and any failure degrades to a
 * recorded `unavailable` status instead of failing the call. Successful results are kept
 * in a short in-process TTL cache so back-to-back calls (a ring, a retry, a tool refresh)
 * do not refetch.
 */
import { SourceDisabledError, type FetchLike } from "./sources/types.js";

export type SourceOutcome<T> =
  | { status: "ok"; value: T; cached: boolean }
  | { status: "unavailable"; reason: string }
  | { status: "disabled"; reason: string };

export type SourceRunner<T> = (ctx: {
  fetchImpl: FetchLike;
  signal: AbortSignal;
  nowMs: number;
}) => Promise<T>;

type CacheEntry = { value: unknown; expiresAt: number };

/** Small TTL cache owned by one handler instance; entries expire on read. */
export class TtlCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(private readonly maxEntries = 64) {}

  get(key: string, nowMs: number): { hit: true; value: unknown } | { hit: false } {
    const entry = this.entries.get(key);
    if (!entry) {
      return { hit: false };
    }
    if (entry.expiresAt <= nowMs) {
      this.entries.delete(key);
      return { hit: false };
    }
    return { hit: true, value: entry.value };
  }

  set(key: string, value: unknown, ttlMs: number, nowMs: number): void {
    if (ttlMs <= 0) {
      return;
    }
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }
    this.entries.set(key, { value, expiresAt: nowMs + ttlMs });
  }
}

export async function runSource<T>(params: {
  name: string;
  cacheKey?: string;
  run: SourceRunner<T>;
  fetchImpl: FetchLike;
  timeoutMs: number;
  nowMs: number;
  cache?: TtlCache;
  cacheTtlMs?: number;
}): Promise<SourceOutcome<T>> {
  const key = params.cacheKey ?? params.name;
  const cached = params.cache?.get(key, params.nowMs);
  if (cached?.hit) {
    // SAFETY: cache keys are namespaced per source, so a hit was stored by this runner's T.
    return { status: "ok", value: cached.value as T, cached: true };
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      // Settle the race first so the timeout, not the abort fallout, is the reported reason.
      reject(new Error(`${params.name} timed out after ${params.timeoutMs}ms`));
      controller.abort();
    }, params.timeoutMs);
  });
  try {
    const value = await Promise.race([
      params.run({ fetchImpl: params.fetchImpl, signal: controller.signal, nowMs: params.nowMs }),
      timeout,
    ]);
    params.cache?.set(key, value, params.cacheTtlMs ?? 0, params.nowMs);
    return { status: "ok", value, cached: false };
  } catch (error) {
    if (error instanceof SourceDisabledError) {
      return { status: "disabled", reason: error.message };
    }
    return {
      status: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export function outcomeValue<T>(outcome: SourceOutcome<T>): T | undefined {
  return outcome.status === "ok" ? outcome.value : undefined;
}
