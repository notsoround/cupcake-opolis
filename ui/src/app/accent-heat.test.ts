import { afterEach, describe, expect, it } from "vitest";
import {
  ACCENT_HEAT_STORAGE_KEY,
  applyAccentHeat,
  loadAccentHeat,
  normalizeAccentHeat,
  setAccentHeat,
  subscribeAccentHeat,
} from "./accent-heat.ts";

describe("accent heat", () => {
  afterEach(() => {
    localStorage.removeItem(ACCENT_HEAT_STORAGE_KEY);
    document.documentElement.removeAttribute("data-accent-heat");
  });

  it("defaults to calm and ignores unknown values", () => {
    expect(loadAccentHeat()).toBe("calm");
    localStorage.setItem(ACCENT_HEAT_STORAGE_KEY, "volcanic");
    expect(loadAccentHeat()).toBe("calm");
    expect(normalizeAccentHeat("hot")).toBe("hot");
  });

  it("persists the choice and mirrors it onto the root element", () => {
    const seen: string[] = [];
    const stop = subscribeAccentHeat((heat) => seen.push(heat));
    setAccentHeat("hot");
    expect(localStorage.getItem(ACCENT_HEAT_STORAGE_KEY)).toBe("hot");
    expect(document.documentElement.getAttribute("data-accent-heat")).toBe("hot");
    stop();
    setAccentHeat("calm");
    expect(seen).toEqual(["hot"]);
    expect(document.documentElement.getAttribute("data-accent-heat")).toBe("calm");
  });

  it("applies the stored value on boot", () => {
    localStorage.setItem(ACCENT_HEAT_STORAGE_KEY, "hot");
    applyAccentHeat();
    expect(document.documentElement.getAttribute("data-accent-heat")).toBe("hot");
  });
});
