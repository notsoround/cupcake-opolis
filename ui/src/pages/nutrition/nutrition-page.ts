import "./nutrition.css";
import { html } from "lit";
import { t } from "../../i18n/index.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";
import { nutritionAdapter } from "./nutrition-source.ts";
import { renderSampleDataNotice } from "./sample-data-notice.ts";

// Placeholder destination for the phone tab bar; the Today screen lands next.
class NutritionPage extends OpenClawLightDomElement {
  override render() {
    return html`<div class="cupcake-page">
      ${renderSampleDataNotice(nutritionAdapter().kind)}
      <h2 class="cupcake-section-title">${t("cupcake.today.title")}</h2>
    </div>`;
  }
}

if (!customElements.get("openclaw-nutrition-page")) {
  customElements.define("openclaw-nutrition-page", NutritionPage);
}

export const nutritionPageComponent = {
  header: true,
  render: () => html`<openclaw-nutrition-page></openclaw-nutrition-page>`,
};
