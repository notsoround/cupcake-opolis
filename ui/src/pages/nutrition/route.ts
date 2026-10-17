import { definePage } from "@openclaw/uirouter";
import { routePageSpec } from "../../app-route-paths.ts";

// Today home screen: meals, calories, live energy balance, 6pm sugar, calendar.
export const page = definePage({
  ...routePageSpec("nutrition"),
  component: () => import("./nutrition-page.ts").then((module) => module.nutritionPageComponent),
});

export const receiptsPage = definePage({
  ...routePageSpec("receipts"),
  component: () => import("./receipts-page.ts").then((module) => module.receiptsPageComponent),
});
