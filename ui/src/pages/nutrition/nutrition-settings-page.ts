import "./nutrition.css";
import { consume } from "@lit/context";
import { html, nothing } from "lit";
import { state } from "lit/decorators.js";
import { titleForRoute } from "../../app-navigation.ts";
import { applicationContext, type ApplicationContext } from "../../app/context.ts";
import { shellLayoutTraits } from "../../app/shell-layout-traits.ts";
import {
  renderSettingsPage,
  renderSettingsRow,
  renderSettingsSection,
} from "../../components/settings-ui.ts";
import { renderSettingsWorkspace } from "../../components/settings-workspace.ts";
import { t } from "../../i18n/index.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";
import {
  DEFAULT_CALORIE_TARGET_KCAL,
  DEFAULT_TDEE_KCAL,
  type NutritionTargets,
} from "./nutrition-adapter.ts";
import { nutritionAdapter, watchNutritionAdapter } from "./nutrition-source.ts";
import { renderSampleDataNotice } from "./sample-data-notice.ts";

/** Accepted ranges; matches the old Today inline editor. */
export const NUTRITION_TARGET_LIMITS = {
  tdee: { min: 800, max: 6000 },
  calorieTarget: { min: 500, max: 6000 },
} as const satisfies Record<keyof NutritionTargets, { min: number; max: number }>;

type TargetField = keyof NutritionTargets;

/** Parses one draft value; null means out of range or not a number. */
export function parseNutritionTarget(field: TargetField, raw: string): number | null {
  const value = Number(raw.trim());
  const { min, max } = NUTRITION_TARGET_LIMITS[field];
  return raw.trim() && Number.isFinite(value) && value >= min && value <= max
    ? Math.round(value)
    : null;
}

/**
 * Settings → Nutrition: the TDEE and calorie target the Today screen uses.
 * Edits persist in this browser through NutritionAdapter.setTargets; owner-saved
 * library settings (when set) take precedence on the live adapter.
 */
class NutritionSettingsPage extends OpenClawLightDomElement {
  @consume({ context: applicationContext, subscribe: true })
  private context?: ApplicationContext;
  private unwatch: (() => void) | null = null;
  @state() private targets: NutritionTargets | null = null;
  @state() private status: { field: TargetField; kind: "saved" | "invalid" } | null = null;
  private loadGeneration = 0;
  private saveGeneration = 0;

  override connectedCallback() {
    super.connectedCallback();
    this.unwatch = watchNutritionAdapter(this.context?.gateway, () => void this.load());
    void this.load();
  }

  override disconnectedCallback() {
    this.unwatch?.();
    this.unwatch = null;
    this.loadGeneration += 1;
    this.saveGeneration += 1;
    super.disconnectedCallback();
  }

  private async load() {
    const generation = ++this.loadGeneration;
    const targets = await nutritionAdapter().getTargets();
    if (generation === this.loadGeneration) {
      this.targets = targets;
    }
  }

  private async save(field: TargetField, input: HTMLInputElement) {
    const value = parseNutritionTarget(field, input.value);
    if (value === null) {
      this.status = { field, kind: "invalid" };
      return;
    }
    // A newer save or load owns the presented targets.
    const generation = ++this.saveGeneration;
    this.loadGeneration += 1;
    const next = await nutritionAdapter().setTargets({ [field]: value });
    if (generation !== this.saveGeneration) {
      return;
    }
    this.targets = next;
    input.value = String(next[field]);
    this.status = { field, kind: "saved" };
  }

  private renderTargetInput(field: TargetField, label: string, value: number) {
    const { min, max } = NUTRITION_TARGET_LIMITS[field];
    const status = this.status?.field === field ? this.status.kind : null;
    return html`<span class="cupcake-settings-field">
      <span class="cupcake-settings-field__input">
        <input
          type="number"
          class="settings-input"
          name=${field}
          inputmode="numeric"
          min=${String(min)}
          max=${String(max)}
          step="1"
          aria-label=${label}
          aria-invalid=${status === "invalid" ? "true" : "false"}
          aria-describedby=${`cupcake-settings-${field}-status`}
          .value=${String(value)}
          @change=${(event: Event) =>
            // SAFETY: bound directly to this native number input.
            void this.save(field, event.currentTarget as HTMLInputElement)}
        />
        <span class="cupcake-settings-field__unit">${t("cupcake.settings.kcalPerDay")}</span>
      </span>
      <span
        id=${`cupcake-settings-${field}-status`}
        class="cupcake-settings-field__status ${status === "invalid" ? "cupcake-settings-field__status--invalid" : ""}"
        role="status"
        aria-live="polite"
        >${
          status === "invalid"
            ? t("cupcake.settings.outOfRange", { min: String(min), max: String(max) })
            : status === "saved"
              ? t("cupcake.settings.saved")
              : nothing
        }</span
      >
    </span>`;
  }

  override render() {
    const targets = this.targets;
    return html`
      <section class="content-header" ${shellLayoutTraits({ toolbarHeader: true })}>
        <h1 class="page-title">${titleForRoute("nutrition-settings")}</h1>
      </section>
      ${renderSettingsWorkspace(
        renderSettingsPage([
          renderSampleDataNotice(nutritionAdapter()),
          renderSettingsSection(
            {
              title: t("cupcake.settings.energyTitle"),
              description: t("cupcake.settings.energyDescription"),
            },
            targets
              ? [
                  renderSettingsRow({
                    title: t("cupcake.today.tdee"),
                    description: t("cupcake.settings.tdeeHint", {
                      value: String(DEFAULT_TDEE_KCAL),
                    }),
                    stackedOnNarrow: true,
                    control: this.renderTargetInput("tdee", t("cupcake.today.tdee"), targets.tdee),
                  }),
                  renderSettingsRow({
                    title: t("cupcake.today.calorieTarget"),
                    description: t("cupcake.settings.calorieTargetHint", {
                      value: String(DEFAULT_CALORIE_TARGET_KCAL),
                    }),
                    stackedOnNarrow: true,
                    control: this.renderTargetInput(
                      "calorieTarget",
                      t("cupcake.today.calorieTarget"),
                      targets.calorieTarget,
                    ),
                  }),
                ]
              : nothing,
          ),
        ]),
      )}
    `;
  }
}

if (!customElements.get("openclaw-nutrition-settings-page")) {
  customElements.define("openclaw-nutrition-settings-page", NutritionSettingsPage);
}
