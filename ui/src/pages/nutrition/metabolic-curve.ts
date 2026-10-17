import "./cupcake-motion.css";
import "./metabolic-curve.css";
import { html, nothing, svg, type PropertyValues } from "lit";
import { property, state } from "lit/decorators.js";
import { t } from "../../i18n/index.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";
import { getSafeLocalStorage } from "../../local-storage.ts";
import {
  buildMetabolicSeries,
  monotonePath,
  sampleNetAt,
  STEPS_INCLUDED_IN_TDEE,
  type MetabolicSeries,
  type MetabolicSeriesInput,
  type Point,
} from "./metabolic-series.ts";

const PRISM_STORAGE_KEY = "openclaw.control.cupcake.curvePrism.v1";
const MIN_HEIGHT = 188;
const MAX_HEIGHT = 260;
const PAD = { top: 18, right: 14, bottom: 24, left: 14 } as const;
/** Spring for path transitions: stiff and well damped, settles inside 500ms. */
const SPRING = { stiffness: 260, damping: 26 } as const;
const MAX_ANIMATION_MS = 480;

const kcal = (value: number) => Math.round(value).toLocaleString();
const signed = (value: number, sign: "+" | "−") =>
  Math.round(value) === 0 ? "0" : `${sign}${kcal(value)}`;
/** Markers sit just after the event, where the line has already moved. */
const MARKER_SETTLE_MS = 10 * 60_000;

export function formatNet(value: number): string {
  return value <= 0
    ? t("cupcake.today.deficit", { value: kcal(-value) })
    : t("cupcake.today.surplus", { value: kcal(value) });
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function loadPrism(): boolean {
  try {
    return getSafeLocalStorage()?.getItem(PRISM_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

let gradientIds = 0;
function nextGradientId(): string {
  gradientIds += 1;
  return `cupcake-curve-${gradientIds}`;
}

/**
 * Live metabolic balance curve: one line for net energy since midnight, with a
 * 24-hour clock dial, event markers, a breathing "now" point, a dashed
 * projection to midnight, and spring-animated transitions when data changes.
 */
class MetabolicCurve extends OpenClawLightDomElement {
  /** Raw Today data; the series is derived here so the page stays lean. */
  @property({ attribute: false }) input: MetabolicSeriesInput | null = null;
  private series: MetabolicSeries | null = null;
  /** Bumps when logged data (not just the clock) changes; only then animate. */
  @property({ type: Number }) revision = 0;
  @property({ attribute: false }) sampleKind: "sample" | "live" = "sample";
  @state() private width = 360;
  @state() private prism = loadPrism();
  /** Spring progress 0→1 (may overshoot slightly) between `from` and target. */
  @state() private progress = 1;
  private from: number[] = [];
  private fromNet = 0;
  private shown: number[] = [];
  private shownNet = 0;
  private frame = 0;
  private observer: ResizeObserver | null = null;
  private readonly gradientId = nextGradientId();

  override connectedCallback() {
    super.connectedCallback();
    if (typeof ResizeObserver === "function") {
      this.observer = new ResizeObserver((entries) => {
        const next = Math.round(entries[0]?.contentRect.width ?? 0);
        if (next > 0 && Math.abs(next - this.width) > 1) {
          this.width = next;
        }
      });
      this.observer.observe(this);
    }
  }

  override disconnectedCallback() {
    this.observer?.disconnect();
    this.observer = null;
    cancelAnimationFrame(this.frame);
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues<this>) {
    if (changed.has("input")) {
      this.series = this.input ? buildMetabolicSeries(this.input) : null;
    }
    if (!changed.has("revision") || !this.series || this.shown.length === 0) {
      return;
    }
    const previous = changed.get("revision") as number | undefined;
    if (previous === undefined || previous === 0 || prefersReducedMotion()) {
      return;
    }
    // Start from what is on screen right now, so rapid updates chain smoothly.
    this.from = [...this.shown];
    this.fromNet = this.shownNet;
    this.progress = 0;
    this.runSpring();
  }

  private runSpring() {
    cancelAnimationFrame(this.frame);
    if (typeof requestAnimationFrame !== "function") {
      this.progress = 1;
      return;
    }
    let position = 0;
    let velocity = 0;
    let last = performance.now();
    const started = last;
    const step = (time: number) => {
      const dt = Math.min(0.032, (time - last) / 1000);
      last = time;
      const force = -SPRING.stiffness * (position - 1) - SPRING.damping * velocity;
      velocity += force * dt;
      position += velocity * dt;
      const settled = Math.abs(position - 1) < 0.001 && Math.abs(velocity) < 0.01;
      if (settled || time - started > MAX_ANIMATION_MS) {
        this.progress = 1;
        return;
      }
      this.progress = position;
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  private togglePrism() {
    this.prism = !this.prism;
    try {
      getSafeLocalStorage()?.setItem(PRISM_STORAGE_KEY, this.prism ? "1" : "0");
    } catch {
      // Best effort.
    }
  }

  private renderDial(series: MetabolicSeries, net: number) {
    const fraction = (series.now - series.dayStart) / (series.dayEnd - series.dayStart);
    const angle = fraction * 2 * Math.PI - Math.PI / 2;
    const radius = 40;
    const ticks = Array.from({ length: 24 }, (_, hour) => {
      const theta = (hour / 24) * 2 * Math.PI - Math.PI / 2;
      const major = hour % 6 === 0;
      const inner = major ? 30 : 33;
      return svg`<line
        class="cupcake-dial__tick ${major ? "cupcake-dial__tick--major" : ""}"
        x1=${50 + Math.cos(theta) * inner}
        y1=${50 + Math.sin(theta) * inner}
        x2=${50 + Math.cos(theta) * 35}
        y2=${50 + Math.sin(theta) * 35}
      />`;
    });
    return html`<svg class="cupcake-dial" viewBox="0 0 100 100" aria-hidden="true">
      <circle class="cupcake-dial__track" cx="50" cy="50" r=${radius} />
      <circle
        class="cupcake-dial__elapsed ${net > 0 ? "cupcake-dial__elapsed--surplus" : ""}"
        cx="50"
        cy="50"
        r=${radius}
        pathLength="100"
        stroke-dasharray="100"
        stroke-dashoffset=${String(100 - fraction * 100)}
        transform="rotate(-90 50 50)"
      />
      ${ticks}
      <circle
        class="cupcake-dial__now"
        cx=${50 + Math.cos(angle) * radius}
        cy=${50 + Math.sin(angle) * radius}
        r="4.5"
      />
      <text class="cupcake-dial__value" x="50" y="52">
        ${net > 0 ? "+" : "−"}${kcal(Math.abs(net))}
      </text>
      <text class="cupcake-dial__unit" x="50" y="65">${t("cupcake.curve.kcalUnit")}</text>
    </svg>`;
  }

  private renderChip(label: string, value: string, tone: string, sample = false) {
    return html`<li class="cupcake-curve__chip cupcake-curve__chip--${tone}">
      <span class="cupcake-curve__chip-label">${label}</span>
      <span class="cupcake-curve__chip-value">${value}</span>
      ${sample ? html`<span class="cupcake-curve__sample">${t("cupcake.curve.sampleTag")}</span>` : nothing}
    </li>`;
  }

  override render() {
    const series = this.series;
    if (!series) {
      return html`<div class="cupcake-curve cupcake-curve--loading" aria-busy="true"></div>`;
    }
    const target = series.samples.map((sample) => sample.net);
    const p = this.progress;
    const values = target.map((value, index) => {
      const start = this.from[Math.min(index, this.from.length - 1)] ?? value;
      return p >= 1 ? value : start + (value - start) * p;
    });
    const net = p >= 1 ? series.net : this.fromNet + (series.net - this.fromNet) * p;
    this.shown = values;
    this.shownNet = net;

    const width = Math.max(240, this.width);
    // Phones keep a compact 188px chart; wider panels grow toward 260px.
    const height = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, width * 0.27)));
    const innerWidth = width - PAD.left - PAD.right;
    const innerHeight = height - PAD.top - PAD.bottom;
    const span = series.dayEnd - series.dayStart;
    const lo = Math.min(-150, series.projectedEndOfDay, ...values);
    const hi = Math.max(150, ...values);
    const padding = (hi - lo) * 0.12;
    const yMin = lo - padding;
    const yMax = hi + padding;
    const x = (time: number) => PAD.left + ((time - series.dayStart) / span) * innerWidth;
    const y = (value: number) => PAD.top + ((yMax - value) / (yMax - yMin)) * innerHeight;
    const zeroY = y(0);
    const points: Point[] = series.samples.map((sample, index) => ({
      x: x(sample.t),
      y: y(values[index] ?? sample.net),
    }));
    const line = monotonePath(points);
    const last = points.at(-1) ?? { x: PAD.left, y: zeroY };
    const area = line ? `${line}L${last.x},${zeroY}L${PAD.left},${zeroY}Z` : "";
    const projectedY = y(series.projectedEndOfDay + (net - series.net));
    const zeroOffset = Math.min(1, Math.max(0, (zeroY - PAD.top) / innerHeight));
    const id = this.gradientId;
    const shownSamples = series.samples.map((sample, index) => ({
      t: sample.t,
      net: values[index] ?? sample.net,
    }));
    const hours = [0, 6, 12, 18].map((hour) => {
      const time = new Date(series.dayStart);
      time.setHours(hour, 0, 0, 0);
      return time.getTime();
    });
    const sample = this.sampleKind === "sample";

    return html`<section
      class="cupcake-curve ${this.prism ? "cupcake-curve--prism" : ""}"
      aria-labelledby="${id}-title"
    >
      <header class="cupcake-curve__header">
        ${this.renderDial(series, net)}
        <div class="cupcake-curve__headline">
          <h3 id="${id}-title" class="cupcake-card__label">
            <span class="cupcake-curve__live" aria-hidden="true"></span>
            ${t("cupcake.curve.title")}
          </h3>
          <p
            class="cupcake-card__value ${net <= 0 ? "cupcake-card__value--deficit" : "cupcake-card__value--surplus"}"
          >
            ${formatNet(net)}
          </p>
          <p class="cupcake-card__detail cupcake-curve__projection">
            ${t("cupcake.curve.projected", { value: formatNet(series.projectedEndOfDay) })}
          </p>
        </div>
        <button
          type="button"
          class="cupcake-curve__prism-toggle"
          aria-pressed=${this.prism ? "true" : "false"}
          aria-label=${t("cupcake.curve.prismLabel")}
          @click=${() => this.togglePrism()}
        >
          <span class="cupcake-curve__prism-swatch" aria-hidden="true"></span>
          ${t("cupcake.curve.prism")}
        </button>
      </header>
      <svg
        class="cupcake-curve__chart"
        width=${width}
        height=${height}
        viewBox="0 0 ${width} ${height}"
        role="img"
        aria-label=${t("cupcake.curve.chartLabel", { value: formatNet(series.net) })}
      >
        <defs>
          <linearGradient
            id="${id}-area"
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1=${PAD.top}
            x2="0"
            y2=${PAD.top + innerHeight}
          >
            <stop class="cupcake-curve__stop-surplus" offset="0" stop-opacity="0.32" />
            <stop class="cupcake-curve__stop-surplus" offset=${zeroOffset} stop-opacity="0.04" />
            <stop class="cupcake-curve__stop-deficit" offset=${zeroOffset} stop-opacity="0.04" />
            <stop class="cupcake-curve__stop-deficit" offset="1" stop-opacity="0.28" />
          </linearGradient>
          <linearGradient
            id="${id}-prism"
            gradientUnits="userSpaceOnUse"
            x1=${PAD.left}
            y1="0"
            x2=${width - PAD.right}
            y2="0"
          >
            <stop class="cupcake-curve__stop-prism-1" offset="0" />
            <stop class="cupcake-curve__stop-prism-2" offset="0.35" />
            <stop class="cupcake-curve__stop-prism-3" offset="0.65" />
            <stop class="cupcake-curve__stop-prism-4" offset="1" />
          </linearGradient>
        </defs>
        ${hours.map(
          (
            time,
          ) => svg`<line class="cupcake-curve__grid" x1=${x(time)} x2=${x(time)} y1=${PAD.top} y2=${PAD.top + innerHeight} />
            <text class="cupcake-curve__axis" x=${x(time)} y=${height - 6}>${new Date(time).toLocaleTimeString([], { hour: "numeric" })}</text>`,
        )}
        <line
          class="cupcake-curve__zero"
          x1=${PAD.left}
          x2=${width - PAD.right}
          y1=${zeroY}
          y2=${zeroY}
        />
        <path class="cupcake-curve__area" d=${area} fill="url(#${id}-area)" />
        <line
          class="cupcake-curve__projection-line"
          x1=${last.x}
          y1=${last.y}
          x2=${x(series.dayEnd)}
          y2=${projectedY}
        />
        <path
          class="cupcake-curve__line"
          d=${line}
          style=${this.prism ? `stroke: url(#${id}-prism)` : nothing}
        />
        ${series.events.map((event) => {
          const value = sampleNetAt(
            shownSamples,
            Math.min(series.now, event.at + MARKER_SETTLE_MS),
          );
          return svg`<circle
            class="cupcake-curve__marker cupcake-curve__marker--${event.kind}"
            cx=${x(Math.min(series.now, event.at + MARKER_SETTLE_MS))}
            cy=${y(value)}
            r="3.5"
          ><title>${event.label} · ${event.kcal > 0 ? "+" : "−"}${kcal(Math.abs(event.kcal))} kcal</title></circle>`;
        })}
        <line
          class="cupcake-curve__now-rule"
          x1=${last.x}
          x2=${last.x}
          y1=${PAD.top}
          y2=${PAD.top + innerHeight}
        />
        <circle class="cupcake-curve__now-glow" cx=${last.x} cy=${last.y} r="6" />
        <circle class="cupcake-curve__now" cx=${last.x} cy=${last.y} r="4.5" />
      </svg>
      <ul class="cupcake-curve__chips">
        ${this.renderChip(t("cupcake.curve.eaten"), signed(series.eaten, "+"), "intake")}
        ${this.renderChip(t("cupcake.curve.bought"), signed(series.bought, "+"), "intake", sample)}
        ${this.renderChip(t("cupcake.curve.living"), signed(series.living, "−"), "burn")}
        ${this.renderChip(
          t("cupcake.curve.steps"),
          t("cupcake.curve.stepsValue", { steps: kcal(series.steps), kcal: kcal(series.stepBurn) }),
          "burn",
          sample,
        )}
        ${this.renderChip(t("cupcake.curve.exercise"), signed(series.exercise, "−"), "burn")}
      </ul>
      <p class="cupcake-card__basis">
        ${t("cupcake.curve.basis", {
          tdee: kcal(series.tdee),
          included: kcal(STEPS_INCLUDED_IN_TDEE),
        })}
      </p>
    </section>`;
  }
}

if (!customElements.get("openclaw-metabolic-curve")) {
  customElements.define("openclaw-metabolic-curve", MetabolicCurve);
}
