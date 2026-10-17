import { definePage } from "@openclaw/uirouter";
import { html } from "lit";
import { routePageSpec } from "../../app-route-paths.ts";

// Today home screen: meals, calories, live energy balance, 6pm sugar, calendar.
export const page = definePage({
  ...routePageSpec("nutrition"),
  component: () => import("./nutrition-page.ts").then((module) => module.nutritionPageComponent),
});

// Settings → Nutrition: TDEE and calorie target used by Today.
export const settingsPage = definePage({
  ...routePageSpec("nutrition-settings"),
  component: () =>
    import("./nutrition-settings-page.ts").then(() => ({
      header: true,
      render: () => html`<openclaw-nutrition-settings-page></openclaw-nutrition-settings-page>`,
    })),
});

export const receiptsPage = definePage({
  ...routePageSpec("receipts"),
  component: () => import("./receipts-page.ts").then((module) => module.receiptsPageComponent),
});
