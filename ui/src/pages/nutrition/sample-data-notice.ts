import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";

/** Every surface fed by a sample adapter must say so (see nutrition-adapter.ts). */
export function renderSampleDataNotice(kind: "sample" | "live") {
  if (kind !== "sample") {
    return nothing;
  }
  return html`<p class="cupcake-sample-notice" role="note">
    <span class="cupcake-sample-badge">${t("cupcake.sampleData")}</span>
    <span>${t("cupcake.sampleDataHint")}</span>
  </p>`;
}
