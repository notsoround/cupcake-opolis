import "./nutrition.css";
import { html } from "lit";
import { state } from "lit/decorators.js";
import { t } from "../../i18n/index.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";
import type { Receipt } from "./nutrition-adapter.ts";
import { nutritionAdapter } from "./nutrition-source.ts";
import { renderSampleDataNotice } from "./sample-data-notice.ts";

const RECEIPT_WINDOW_MS = 30 * 86_400_000;

class ReceiptsPage extends OpenClawLightDomElement {
  @state() private receipts: Receipt[] | null = null;
  private generation = 0;

  override connectedCallback() {
    super.connectedCallback();
    const generation = ++this.generation;
    const now = Date.now();
    void nutritionAdapter()
      .listReceipts({ start: now - RECEIPT_WINDOW_MS, end: now + 1 })
      .then((receipts) => {
        if (generation === this.generation) {
          this.receipts = receipts;
        }
      });
  }

  override disconnectedCallback() {
    this.generation += 1;
    super.disconnectedCallback();
  }

  override render() {
    const receipts = this.receipts ?? [];
    return html`<div class="cupcake-page">
      ${renderSampleDataNotice(nutritionAdapter().kind)}
      ${
        this.receipts && receipts.length === 0
          ? html`<p class="cupcake-card__detail">${t("cupcake.receipts.empty")}</p>`
          : html`<ul class="cupcake-receipts">
              ${receipts.map((receipt) => {
                const money = new Intl.NumberFormat(undefined, {
                  style: "currency",
                  currency: receipt.currency,
                });
                return html`<li class="cupcake-card cupcake-receipt">
                  <div class="cupcake-receipt__header">
                    <h3 class="cupcake-receipt__merchant">${receipt.merchant}</h3>
                    <span class="cupcake-receipt__total">
                      ${t("cupcake.receipts.total", { amount: money.format(receipt.total) })}
                    </span>
                  </div>
                  <p class="cupcake-card__detail">
                    ${new Date(receipt.purchasedAt).toLocaleDateString([], {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                    · ${t("cupcake.receipts.items", { count: String(receipt.items.length) })}
                  </p>
                  <ul class="cupcake-meal-list">
                    ${receipt.items.map(
                      (item) => html`<li class="cupcake-meal-list__item">
                        <span class="cupcake-meal-list__name">${item.name}</span>
                        <span class="cupcake-meal-list__kcal">
                          ${
                            item.calories === undefined
                              ? ""
                              : t("cupcake.today.kcal", { value: item.calories.toLocaleString() })
                          }
                        </span>
                        <span class="cupcake-meal-list__time">${money.format(item.price)}</span>
                      </li>`,
                    )}
                  </ul>
                </li>`;
              })}
            </ul>`
      }
    </div>`;
  }
}

if (!customElements.get("openclaw-receipts-page")) {
  customElements.define("openclaw-receipts-page", ReceiptsPage);
}

export const receiptsPageComponent = {
  header: true,
  render: () => html`<openclaw-receipts-page></openclaw-receipts-page>`,
};
