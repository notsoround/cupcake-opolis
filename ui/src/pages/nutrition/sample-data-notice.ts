import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { NutritionAdapter } from "./nutrition-adapter.ts";

/**
 * Honest data labeling for every nutrition surface: sample data says so, live data
 * names its coverage, an unreachable source is reported instead of papered over.
 */
export function renderSampleDataNotice(adapter: Pick<NutritionAdapter, "kind" | "problem">) {
  if (adapter.kind === "offline") {
    return html`<p class="cupcake-sample-notice" role="status">
      <span>${t("cupcake.offlineDataHint")}</span>
    </p>`;
  }
  if (adapter.kind === "live") {
    const problem = adapter.problem;
    return problem
      ? html`<p class="cupcake-sample-notice cupcake-sample-notice--problem" role="alert">
          <span class="cupcake-sample-badge">${t("cupcake.liveDataProblem")}</span>
          <span>${t("cupcake.liveDataProblemHint", { detail: problem })}</span>
        </p>`
      : html`<p class="cupcake-live-notice" role="note">
          <span class="cupcake-live-badge">${t("cupcake.liveData")}</span>
          <span>${t("cupcake.liveDataHint")}</span>
        </p>`;
  }
  if (adapter.kind !== "sample") {
    return nothing;
  }
  return html`<p class="cupcake-sample-notice" role="note">
    <span class="cupcake-sample-badge">${t("cupcake.sampleData")}</span>
    <span>${t("cupcake.sampleDataHint")}</span>
  </p>`;
}
