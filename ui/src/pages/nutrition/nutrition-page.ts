import "./nutrition.css";
import "../../components/accent-heat-toggle.ts";
import { consume } from "@lit/context";
import { html, nothing } from "lit";
import { state } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import { pathForRoute } from "../../app-route-paths.ts";
import { applicationContext, type ApplicationContext } from "../../app/context.ts";
import { icons } from "../../components/icons.ts";
import { renderSettingsSegmented } from "../../components/settings-ui.ts";
import { t } from "../../i18n/index.ts";
import { shouldHandleNavigationClick } from "../../lib/navigation-click.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";
import {
  bucketMeals,
  calendarRange,
  estimateEnergyBalance,
  formatElapsed,
  lastMealBefore,
  localDayBounds,
  shiftCalendarAnchor,
  type CalendarView,
} from "./energy-balance.ts";
import type { MetabolicSeriesInput } from "./metabolic-series.ts";
import type {
  ExerciseEntry,
  GlucoseReading,
  MealEntry,
  NutritionTargets,
  Receipt,
  StepBucket,
} from "./nutrition-adapter.ts";
import { nutritionAdapter } from "./nutrition-source.ts";
import { renderSampleDataNotice } from "./sample-data-notice.ts";

const CLOCK_TICK_MS = 60_000;
const LAST_MEAL_LOOKBACK_MS = 2 * 86_400_000;

const kcal = (value: number) => Math.round(value).toLocaleString();
const timeOfDay = (time: number) =>
  new Date(time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

class NutritionPage extends OpenClawLightDomElement {
  @consume({ context: applicationContext, subscribe: true })
  private context?: ApplicationContext;
  @state() private now = Date.now();
  @state() private todayMeals: MealEntry[] = [];
  @state() private lastMeal: MealEntry | null = null;
  @state() private targets: NutritionTargets | null = null;
  @state() private todayReceipts: Receipt[] = [];
  @state() private todayExercises: ExerciseEntry[] = [];
  @state() private todaySteps: StepBucket[] = [];
  /** Bumps whenever logged data is (re)loaded; the curve animates on change. */
  @state() private dataRevision = 0;
  @state() private glucose: GlucoseReading | null = null;
  @state() private calendarView: CalendarView = "week";
  @state() private calendarAnchor = Date.now();
  @state() private calendarMeals: MealEntry[] = [];
  @state() private quickLogStatus = "";
  private todayGeneration = 0;
  private calendarGeneration = 0;
  private clock: ReturnType<typeof globalThis.setInterval> | null = null;

  override connectedCallback() {
    super.connectedCallback();
    // The curve and the talk-to-log exercise widget load off the startup
    // path; their hosts reserve space until the custom elements upgrade.
    void import("./metabolic-curve.ts");
    // <openclaw-exercise-quick-log> fires cupcake-exercise-changed.
    void import("./exercise-quick-log.ts");
    this.now = Date.now();
    this.clock = globalThis.setInterval(() => {
      const previousDay = localDayBounds(this.now).dayStart;
      this.now = Date.now();
      // Crossing midnight changes which meals count as today.
      if (localDayBounds(this.now).dayStart !== previousDay) {
        void this.loadToday();
      }
    }, CLOCK_TICK_MS);
    void this.loadToday();
    void this.loadCalendar();
  }

  override disconnectedCallback() {
    globalThis.clearInterval(this.clock ?? undefined);
    this.clock = null;
    this.todayGeneration += 1;
    this.calendarGeneration += 1;
    super.disconnectedCallback();
  }

  private async loadToday() {
    const generation = ++this.todayGeneration;
    const adapter = nutritionAdapter();
    const now = Date.now();
    const { dayStart, dayEnd } = localDayBounds(now);
    const today = { start: dayStart, end: dayEnd };
    const [recent, targets, glucose, receipts, exercises, steps] = await Promise.all([
      adapter.listMeals({ start: now - LAST_MEAL_LOOKBACK_MS, end: dayEnd }),
      adapter.getTargets(),
      adapter.getSixPmGlucose(new Date(now)),
      adapter.listReceipts(today),
      adapter.listExercises(today),
      adapter.listSteps(today),
    ]);
    // A late result from an earlier load must not replace newer state.
    if (generation !== this.todayGeneration) {
      return;
    }
    this.now = now;
    this.todayMeals = recent.filter((meal) => meal.eatenAt >= dayStart);
    this.lastMeal = lastMealBefore(recent, now);
    this.targets = targets;
    this.glucose = glucose;
    this.todayReceipts = receipts;
    this.todayExercises = exercises;
    this.todaySteps = steps;
    this.dataRevision += 1;
  }

  private async loadCalendar() {
    const generation = ++this.calendarGeneration;
    const range = calendarRange(this.calendarView, this.calendarAnchor);
    const meals = await nutritionAdapter().listMeals(range);
    if (generation === this.calendarGeneration) {
      this.calendarMeals = meals;
    }
  }

  private setCalendar(view: CalendarView, anchor: number) {
    this.calendarView = view;
    this.calendarAnchor = anchor;
    void this.loadCalendar();
  }

  private readonly submitQuickLog = async (event: SubmitEvent) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const rawName = data.get("name");
    const name = typeof rawName === "string" ? rawName.trim() : "";
    const calories = Number(data.get("calories"));
    if (!name || !Number.isFinite(calories) || calories <= 0) {
      this.quickLogStatus = t("cupcake.today.quickLogInvalid");
      return;
    }
    const meal = await nutritionAdapter().logMeal({ name, calories });
    form.reset();
    this.quickLogStatus = t("cupcake.today.quickLogged", { name: meal.name });
    await Promise.all([this.loadToday(), this.loadCalendar()]);
  };

  private renderLastMeal() {
    const meal = this.lastMeal;
    const elapsed = meal ? formatElapsed(this.now - meal.eatenAt) : null;
    return html`<article class="cupcake-card">
      <h3 class="cupcake-card__label">${icons.utensils} ${t("cupcake.today.lastMeal")}</h3>
      ${
        meal
          ? html`<p class="cupcake-card__value">
                ${elapsed ? t("cupcake.today.elapsedAgo", { duration: elapsed }) : t("cupcake.today.justNow")}
              </p>
              <p class="cupcake-card__detail">
                ${meal.name} · ${timeOfDay(meal.eatenAt)} ·
                ${t("cupcake.today.kcal", { value: kcal(meal.calories) })}
              </p>`
          : html`<p class="cupcake-card__detail">${t("cupcake.today.noMeals")}</p>`
      }
    </article>`;
  }

  private renderCalories(consumed: number) {
    const target = this.targets?.calorieTarget ?? 0;
    const percent = target > 0 ? Math.min(100, (consumed / target) * 100) : 0;
    const remaining = target - consumed;
    return html`<article class="cupcake-card">
      <h3 class="cupcake-card__label">${t("cupcake.today.calories")}</h3>
      <p class="cupcake-card__value">
        ${t("cupcake.today.caloriesOfTarget", { consumed: kcal(consumed), target: kcal(target) })}
      </p>
      <div
        class="cupcake-progress ${remaining < 0 ? "cupcake-progress--over" : ""}"
        role="progressbar"
        aria-label=${t("cupcake.today.calories")}
        aria-valuemin="0"
        aria-valuemax=${String(Math.round(target))}
        aria-valuenow=${String(Math.round(consumed))}
        style=${styleMap({ "--cupcake-progress": `${percent}%` })}
      >
        <span class="cupcake-progress__fill"></span>
      </div>
      <p class="cupcake-card__detail">
        ${
          remaining >= 0
            ? t("cupcake.today.caloriesRemaining", { value: kcal(remaining) })
            : t("cupcake.today.caloriesOver", { value: kcal(-remaining) })
        }
      </p>
    </article>`;
  }

  private renderCurve() {
    const input: MetabolicSeriesInput | null = this.targets
      ? {
          now: this.now,
          tdee: this.targets.tdee,
          meals: this.todayMeals,
          receipts: this.todayReceipts,
          exercises: this.todayExercises,
          steps: this.todaySteps,
        }
      : null;
    return html`<openclaw-metabolic-curve
      class="cupcake-card cupcake-card--curve"
      .input=${input}
      .revision=${this.dataRevision}
      .sampleKind=${nutritionAdapter().kind}
    ></openclaw-metabolic-curve>`;
  }

  private renderSugar() {
    const sixPm = new Date(this.now);
    sixPm.setHours(18, 0, 0, 0);
    const reading = this.glucose;
    return html`<article class="cupcake-card">
      <h3 class="cupcake-card__label">${icons.droplet} ${t("cupcake.today.sugar")}</h3>
      ${
        reading
          ? html`<p class="cupcake-card__value">
                ${reading.value} <span class="cupcake-card__unit">${reading.unit}</span>
              </p>
              <p class="cupcake-card__detail">${timeOfDay(reading.takenAt)}</p>`
          : html`<p class="cupcake-card__detail">
              ${this.now < sixPm.getTime() ? t("cupcake.today.sugarPending") : t("cupcake.today.sugarMissing")}
            </p>`
      }
    </article>`;
  }

  private renderQuickLog() {
    return html`<form class="cupcake-quick-log" @submit=${this.submitQuickLog}>
      <h3 class="cupcake-card__label">${icons.plus} ${t("cupcake.today.quickLog")}</h3>
      <label class="cupcake-field cupcake-field--grow">
        <span class="sr-only">${t("cupcake.today.quickLogName")}</span>
        <input
          name="name"
          type="text"
          autocomplete="off"
          required
          placeholder=${t("cupcake.today.quickLogNamePlaceholder")}
        />
      </label>
      <label class="cupcake-field cupcake-field--kcal">
        <span class="sr-only">${t("cupcake.today.quickLogCalories")}</span>
        <input
          name="calories"
          type="number"
          inputmode="numeric"
          min="1"
          max="5000"
          required
          placeholder=${t("cupcake.today.quickLogCalories")}
        />
      </label>
      <button type="submit" class="btn primary cupcake-quick-log__submit">
        ${t("cupcake.today.quickLogSubmit")}
      </button>
      <p class="cupcake-quick-log__status" role="status" aria-live="polite">
        ${this.quickLogStatus}
      </p>
    </form>`;
  }

  /** Read-only basis for the estimates; editing lives in Settings → Nutrition. */
  private renderTargets() {
    const targets = this.targets;
    if (!targets) {
      return nothing;
    }
    const basePath = this.context?.basePath ?? "";
    return html`<p class="cupcake-targets-basis">
      <span>
        ${t("cupcake.today.targetsBasis", {
          tdee: kcal(targets.tdee),
          target: kcal(targets.calorieTarget),
        })}
      </span>
      <a
        class="cupcake-targets-basis__link"
        href=${pathForRoute("nutrition-settings", basePath)}
        @click=${(event: MouseEvent) => {
          if (!this.context || !shouldHandleNavigationClick(event)) {
            return;
          }
          event.preventDefault();
          this.context.navigate("nutrition-settings");
        }}
        >${icons.settings} ${t("cupcake.today.editTargets")}</a
      >
    </p>`;
  }

  private renderCalendar() {
    const view = this.calendarView;
    const range = calendarRange(view, this.calendarAnchor);
    const buckets = bucketMeals(this.calendarMeals, view, this.calendarAnchor);
    const today = localDayBounds(this.now).dayStart;
    const rangeLabel =
      view === "year"
        ? new Date(range.start).getFullYear()
        : view === "month"
          ? new Date(range.start).toLocaleDateString([], { month: "long", year: "numeric" })
          : view === "week"
            ? `${new Date(range.start).toLocaleDateString([], { month: "short", day: "numeric" })} – ${new Date(range.end - 1).toLocaleDateString([], { month: "short", day: "numeric" })}`
            : new Date(range.start).toLocaleDateString([], {
                weekday: "long",
                month: "short",
                day: "numeric",
              });
    return html`<section class="cupcake-calendar" aria-labelledby="cupcake-calendar-title">
      <header class="cupcake-calendar__header">
        <h2 id="cupcake-calendar-title" class="cupcake-section-title">
          ${t("cupcake.today.calendar")}
        </h2>
        ${renderSettingsSegmented<CalendarView>({
          mode: "buttons",
          value: view,
          ariaLabel: t("cupcake.today.calendar"),
          options: (["day", "week", "month", "year"] as const).map((value) => ({
            value,
            label: t(`cupcake.today.${value}`),
          })),
          onChange: (next) => this.setCalendar(next, this.calendarAnchor),
        })}
      </header>
      <div class="cupcake-calendar__nav">
        <button
          type="button"
          class="btn btn--icon"
          aria-label=${t("cupcake.today.previous")}
          @click=${() => this.setCalendar(view, shiftCalendarAnchor(view, this.calendarAnchor, -1))}
        >
          ${icons.chevronLeft}
        </button>
        <span class="cupcake-calendar__range">${rangeLabel}</span>
        <button
          type="button"
          class="btn btn--icon"
          aria-label=${t("cupcake.today.next")}
          @click=${() => this.setCalendar(view, shiftCalendarAnchor(view, this.calendarAnchor, 1))}
        >
          ${icons.chevronRight}
        </button>
        <button
          type="button"
          class="btn btn--sm"
          @click=${() => this.setCalendar(view, Date.now())}
        >
          ${t("cupcake.today.jumpToToday")}
        </button>
      </div>
      ${
        view === "day"
          ? this.renderDayMeals()
          : html`<ol class="cupcake-calendar__grid cupcake-calendar__grid--${view}">
              ${
                view === "month"
                  ? Array.from(
                      { length: (new Date(range.start).getDay() + 6) % 7 },
                      () => html`<li aria-hidden="true"></li>`,
                    )
                  : nothing
              }
              ${buckets.map((bucket) => {
                const days = Math.max(1, Math.round((bucket.end - bucket.start) / 86_400_000));
                const label =
                  view === "year"
                    ? new Date(bucket.start).toLocaleDateString([], { month: "short" })
                    : view === "week"
                      ? new Date(bucket.start).toLocaleDateString([], {
                          weekday: "short",
                          day: "numeric",
                        })
                      : String(new Date(bucket.start).getDate());
                return html`<li>
                  <button
                    type="button"
                    class="cupcake-calendar__cell ${bucket.start === today ? "cupcake-calendar__cell--today" : ""}"
                    ?disabled=${bucket.start > this.now}
                    @click=${() => this.setCalendar(view === "year" ? "month" : "day", bucket.start)}
                  >
                    <span class="cupcake-calendar__cell-label">${label}</span>
                    <span class="cupcake-calendar__cell-value">
                      ${
                        bucket.meals === 0
                          ? "—"
                          : view === "year"
                            ? t("cupcake.today.kcalPerDay", { value: kcal(bucket.calories / days) })
                            : kcal(bucket.calories)
                      }
                    </span>
                  </button>
                </li>`;
              })}
            </ol>`
      }
    </section>`;
  }

  private renderDayMeals() {
    if (this.calendarMeals.length === 0) {
      return html`<p class="cupcake-card__detail">${t("cupcake.today.calendarEmpty")}</p>`;
    }
    return html`<ul class="cupcake-meal-list">
      ${this.calendarMeals.map(
        (meal) => html`<li class="cupcake-meal-list__item">
          <span class="cupcake-meal-list__time">${timeOfDay(meal.eatenAt)}</span>
          <span class="cupcake-meal-list__name">${meal.name}</span>
          <span class="cupcake-meal-list__kcal"
            >${t("cupcake.today.kcal", { value: kcal(meal.calories) })}</span
          >
        </li>`,
      )}
    </ul>`;
  }

  override render() {
    const consumed = estimateEnergyBalance({
      meals: this.todayMeals,
      now: this.now,
      tdee: 0,
    }).consumedSoFar;
    return html`<div class="cupcake-page">
      ${renderSampleDataNotice(nutritionAdapter().kind)}
      <section class="cupcake-today" aria-labelledby="cupcake-today-title">
        <header class="cupcake-today__header">
          <h2 id="cupcake-today-title" class="cupcake-section-title">
            ${t("cupcake.today.title")}
            <span class="cupcake-today__date">
              ${new Date(this.now).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}
            </span>
          </h2>
          <openclaw-accent-heat-toggle></openclaw-accent-heat-toggle>
        </header>
        ${this.renderCurve()}
        <openclaw-exercise-quick-log
          class="cupcake-card cupcake-card--exercise"
          .exercises=${this.todayExercises}
          @cupcake-exercise-changed=${() => void this.loadToday()}
        ></openclaw-exercise-quick-log>
        <div class="cupcake-today__grid">
          ${this.renderLastMeal()} ${this.renderCalories(consumed)} ${this.renderSugar()}
        </div>
        ${this.renderQuickLog()} ${this.renderTargets()}
      </section>
      ${this.renderCalendar()}
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
