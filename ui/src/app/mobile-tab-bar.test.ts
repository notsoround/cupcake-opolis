import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { activeMobileTab, renderMobileTabBar } from "./mobile-tab-bar.ts";

describe("mobile tab bar", () => {
  it("maps routes onto the four primary tabs, everything else onto More", () => {
    expect(activeMobileTab("chat")).toBe("chat");
    expect(activeMobileTab("new-session")).toBe("chat");
    expect(activeMobileTab("nutrition")).toBe("nutrition");
    expect(activeMobileTab("receipts")).toBe("receipts");
    expect(activeMobileTab("settings")).toBe("settings");
    expect(activeMobileTab("appearance")).toBe("settings");
    expect(activeMobileTab("usage")).toBeNull();
  });

  it("navigates in-app and opens the drawer from More", () => {
    const container = document.createElement("div");
    const onNavigate = vi.fn();
    const onOpenMore = vi.fn();
    render(
      renderMobileTabBar({
        activeRoute: "nutrition",
        basePath: "/ui",
        navDrawerOpen: false,
        onNavigate,
        onOpenMore,
      }),
      container,
    );
    const tabs = [...container.querySelectorAll<HTMLElement>("[data-mobile-tab]")];
    expect(tabs.map((tab) => tab.dataset.mobileTab)).toEqual([
      "chat",
      "nutrition",
      "receipts",
      "settings",
      "more",
    ]);
    const nutrition = container.querySelector<HTMLAnchorElement>('[data-mobile-tab="nutrition"]');
    // Today owns the mount root; Chat keeps its own route.
    expect(nutrition?.getAttribute("href")).toBe("/ui/");
    expect(
      container.querySelector<HTMLAnchorElement>('[data-mobile-tab="chat"]')?.getAttribute("href"),
    ).toBe("/ui/chat");
    expect(nutrition?.getAttribute("aria-current")).toBe("page");
    container.querySelector<HTMLElement>('[data-mobile-tab="receipts"]')?.click();
    expect(onNavigate).toHaveBeenCalledWith("receipts");
    const more = container.querySelector<HTMLElement>('[data-mobile-tab="more"]');
    more?.click();
    expect(onOpenMore).toHaveBeenCalledWith(more);
  });
});
