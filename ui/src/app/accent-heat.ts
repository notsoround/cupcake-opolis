import { getSafeLocalStorage } from "../local-storage.ts";

/**
 * Cupcake accent heat: a browser-local presentation preference layered on the
 * existing theme presentation (bootstrap-theme.ts applies it alongside
 * data-theme / data-theme-mode). `calm` is the default pink set; `hot` swaps in
 * the magenta set via `:root[data-theme="dark"|"light"][data-accent-heat="hot"]`
 * in styles/base.css. Named palettes and explicit accent overrides are untouched.
 */
export type AccentHeat = "calm" | "hot";

export const ACCENT_HEAT_STORAGE_KEY = "openclaw.control.accentHeat.v1";
export const ACCENT_HEAT_ATTRIBUTE = "data-accent-heat";

const listeners = new Set<(heat: AccentHeat) => void>();

export function normalizeAccentHeat(value: unknown): AccentHeat {
  return value === "hot" ? "hot" : "calm";
}

export function loadAccentHeat(): AccentHeat {
  try {
    return normalizeAccentHeat(getSafeLocalStorage()?.getItem(ACCENT_HEAT_STORAGE_KEY));
  } catch {
    return "calm";
  }
}

export function applyAccentHeat(heat: AccentHeat = loadAccentHeat()): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.setAttribute(ACCENT_HEAT_ATTRIBUTE, heat);
}

export function setAccentHeat(heat: AccentHeat): void {
  const next = normalizeAccentHeat(heat);
  try {
    getSafeLocalStorage()?.setItem(ACCENT_HEAT_STORAGE_KEY, next);
  } catch {
    // Best effort: the attribute still applies for this tab.
  }
  applyAccentHeat(next);
  for (const listener of listeners) {
    listener(next);
  }
}

/** Subscribe to heat changes from this tab and from other tabs (storage event). */
export function subscribeAccentHeat(listener: (heat: AccentHeat) => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === ACCENT_HEAT_STORAGE_KEY) {
      const heat = loadAccentHeat();
      applyAccentHeat(heat);
      listener(heat);
    }
  };
  globalThis.addEventListener?.("storage", onStorage);
  return () => {
    listeners.delete(listener);
    globalThis.removeEventListener?.("storage", onStorage);
  };
}
