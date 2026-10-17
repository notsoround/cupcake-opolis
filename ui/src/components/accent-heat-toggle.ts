import { state } from "lit/decorators.js";
import {
  loadAccentHeat,
  setAccentHeat,
  subscribeAccentHeat,
  type AccentHeat,
} from "../app/accent-heat.ts";
import { t } from "../i18n/index.ts";
import { OpenClawLightDomElement } from "../lit/openclaw-element.ts";
import { renderSettingsSegmented } from "./settings-ui.ts";

/** Calm/hot Cupcake pink switch; the state lives in app/accent-heat.ts. */
class AccentHeatToggle extends OpenClawLightDomElement {
  @state() private heat: AccentHeat = loadAccentHeat();
  private stop: (() => void) | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this.heat = loadAccentHeat();
    this.stop = subscribeAccentHeat((heat) => {
      this.heat = heat;
    });
  }

  override disconnectedCallback() {
    this.stop?.();
    this.stop = null;
    super.disconnectedCallback();
  }

  override render() {
    return renderSettingsSegmented<AccentHeat>({
      mode: "buttons",
      value: this.heat,
      ariaLabel: t("cupcake.heat.label"),
      options: [
        { value: "calm", label: t("cupcake.heat.calm"), testId: "accent-heat-calm" },
        { value: "hot", label: t("cupcake.heat.hot"), testId: "accent-heat-hot" },
      ],
      onChange: (heat) => setAccentHeat(heat),
    });
  }
}

if (!customElements.get("openclaw-accent-heat-toggle")) {
  customElements.define("openclaw-accent-heat-toggle", AccentHeatToggle);
}
