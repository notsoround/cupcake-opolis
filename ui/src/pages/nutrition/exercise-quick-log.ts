import "./cupcake-motion.css";
import "./exercise-quick-log.css";
import { html, nothing } from "lit";
import { property, query, state } from "lit/decorators.js";
import { icons } from "../../components/icons.ts";
import { t } from "../../i18n/index.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";
import {
  DEFAULT_BODY_WEIGHT_KG,
  estimateExerciseBurn,
  type ExerciseEstimate,
  type ExerciseEstimateItem,
} from "./exercise-estimate.ts";
import type { ExerciseEntry } from "./nutrition-adapter.ts";
import { nutritionAdapter } from "./nutrition-source.ts";
import {
  speechDictationSupported,
  startDictation,
  type DictationSession,
} from "./speech-dictation.ts";

/** Fired (bubbling) after an exercise is logged or undone. */
export const EXERCISE_CHANGED_EVENT = "cupcake-exercise-changed";

type Status =
  | { kind: "idle" }
  | { kind: "logged"; entry: ExerciseEntry; estimate: ExerciseEstimate }
  | { kind: "undone"; description: string }
  | { kind: "empty" }
  | { kind: "error"; code: string };

const kcal = (value: number) => Math.round(value).toLocaleString();
const timeOfDay = (time: number) =>
  new Date(time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function summarizeEstimateItem(item: ExerciseEstimateItem): string {
  const amount =
    item.sets && item.reps
      ? `${item.sets}×${Math.round(item.reps / item.sets)}`
      : item.reps
        ? `×${item.reps}`
        : `${item.minutes < 1 ? item.minutes : Math.round(item.minutes)} min`;
  return `${item.activity} ${amount}`;
}

/**
 * Talk-to-log exercise: one tap opens a single field and starts browser
 * dictation when available (text otherwise). Cupcake estimates the burn
 * locally, logs it, and the Today curve drops. Today's entries are listed
 * below with kcal, time and undo.
 */
class ExerciseQuickLog extends OpenClawLightDomElement {
  @property({ attribute: false }) exercises: ExerciseEntry[] = [];
  @state() private open = false;
  @state() private listening = false;
  @state() private text = "";
  @state() private busy = false;
  @state() private status: Status = { kind: "idle" };
  @query(".cupcake-exercise__input") private input?: HTMLInputElement;
  private dictation: DictationSession | null = null;
  private readonly speech = speechDictationSupported();

  override disconnectedCallback() {
    this.dictation?.abort();
    this.dictation = null;
    super.disconnectedCallback();
  }

  private notifyChanged() {
    this.dispatchEvent(new CustomEvent(EXERCISE_CHANGED_EVENT, { bubbles: true }));
  }

  private async openSheet() {
    this.open = true;
    this.status = { kind: "idle" };
    this.text = "";
    await this.updateComplete;
    if (this.speech) {
      this.listen();
    } else {
      this.input?.focus();
    }
  }

  private closeSheet() {
    this.dictation?.abort();
    this.dictation = null;
    this.listening = false;
    this.open = false;
  }

  private listen() {
    if (this.listening) {
      this.dictation?.stop();
      return;
    }
    this.dictation = startDictation({
      onTranscript: (text) => {
        this.text = text;
      },
      onEnd: (text) => {
        this.listening = false;
        this.dictation = null;
        // Talk-to-log: a finished utterance logs immediately. If recognition
        // ended without speech, keep whatever was typed and let Matt submit.
        if (text.trim()) {
          this.text = text;
          void this.submit();
        } else {
          this.input?.focus();
        }
      },
      onError: (code) => {
        this.listening = false;
        this.status = { kind: "error", code };
        this.input?.focus();
      },
    });
    this.listening = this.dictation !== null;
    if (!this.dictation) {
      this.input?.focus();
    }
  }

  private async submit() {
    const description = this.text.trim();
    if (!description || this.busy) {
      return;
    }
    const estimate = estimateExerciseBurn(description);
    if (estimate.items.length === 0) {
      this.status = { kind: "empty" };
      this.input?.focus();
      return;
    }
    this.busy = true;
    try {
      const entry = await nutritionAdapter().logExercise({
        description,
        kcal: estimate.kcal,
        minutes: estimate.minutes,
        estimator: estimate.source,
      });
      this.status = { kind: "logged", entry, estimate };
      this.text = "";
      this.open = false;
      this.notifyChanged();
    } finally {
      this.busy = false;
    }
  }

  private async undo(entry: ExerciseEntry) {
    if (await nutritionAdapter().deleteExercise(entry.id)) {
      this.status = { kind: "undone", description: entry.description };
      this.notifyChanged();
    }
  }

  private renderStatus() {
    const status = this.status;
    if (status.kind === "logged") {
      return html`<div class="cupcake-exercise__result" role="status">
        <span class="cupcake-exercise__result-kcal"
          >${t("cupcake.exercise.logged", { value: kcal(status.estimate.kcal) })}</span
        >
        <span class="cupcake-exercise__result-detail">
          ${status.estimate.items.map(summarizeEstimateItem).join(" · ")}
          ${
            status.estimate.unrecognized.length > 0
              ? html`<br />${t("cupcake.exercise.skipped", { text: status.estimate.unrecognized.join(", ") })}`
              : nothing
          }
        </span>
        <span class="cupcake-exercise__result-basis"
          >${t("cupcake.exercise.basis", { weight: String(DEFAULT_BODY_WEIGHT_KG) })}</span
        >
        <button
          type="button"
          class="btn btn--sm cupcake-exercise__undo"
          @click=${() => this.undo(status.entry)}
        >
          ${icons.rotateCcw} ${t("cupcake.exercise.undo")}
        </button>
      </div>`;
    }
    const message =
      status.kind === "undone"
        ? t("cupcake.exercise.undone", { description: status.description })
        : status.kind === "empty"
          ? t("cupcake.exercise.nothingFound")
          : status.kind === "error"
            ? t("cupcake.exercise.dictationFailed", { code: status.code })
            : "";
    return html`<p class="cupcake-exercise__status" role="status" aria-live="polite">
      ${message}
    </p>`;
  }

  private renderSheet() {
    return html`<form
      class="cupcake-exercise__sheet"
      @submit=${(event: SubmitEvent) => {
        event.preventDefault();
        void this.submit();
      }}
    >
      <label class="cupcake-exercise__field">
        <span class="sr-only">${t("cupcake.exercise.fieldLabel")}</span>
        <input
          class="cupcake-exercise__input"
          name="exercise"
          type="text"
          autocomplete="off"
          enterkeyhint="done"
          .value=${this.text}
          placeholder=${
            this.listening ? t("cupcake.exercise.listening") : t("cupcake.exercise.placeholder")
          }
          @input=${(event: InputEvent) => {
            this.text = (event.target as HTMLInputElement).value;
            // Typing means Matt chose the keyboard; stop listening quietly.
            if (this.listening && event.isTrusted) {
              this.dictation?.abort();
              this.dictation = null;
              this.listening = false;
            }
            if (this.status.kind !== "idle") {
              this.status = { kind: "idle" };
            }
          }}
        />
      </label>
      ${
        this.speech
          ? html`<button
              type="button"
              class="cupcake-exercise__mic ${this.listening ? "cupcake-exercise__mic--live" : ""}"
              aria-pressed=${this.listening ? "true" : "false"}
              aria-label=${
                this.listening ? t("cupcake.exercise.micStop") : t("cupcake.exercise.micStart")
              }
              @click=${() => this.listen()}
            >
              ${icons.mic}
            </button>`
          : nothing
      }
      <button
        type="submit"
        class="btn primary cupcake-exercise__submit"
        ?disabled=${this.busy || !this.text.trim()}
      >
        ${t("cupcake.exercise.submit")}
      </button>
      <button
        type="button"
        class="btn btn--icon cupcake-exercise__close"
        aria-label=${t("cupcake.exercise.close")}
        @click=${() => this.closeSheet()}
      >
        ${icons.x}
      </button>
      <p class="cupcake-exercise__hint">
        ${
          this.listening
            ? t("cupcake.exercise.listening")
            : this.speech
              ? t("cupcake.exercise.speechHint")
              : t("cupcake.exercise.typeHint")
        }
      </p>
    </form>`;
  }

  private renderFeed() {
    const entries = this.exercises.toSorted((a, b) => b.performedAt - a.performedAt);
    return html`<section
      class="cupcake-exercise__feed"
      aria-labelledby="cupcake-exercise-feed-title"
    >
      <h3 id="cupcake-exercise-feed-title" class="cupcake-card__label">
        ${icons.activity} ${t("cupcake.exercise.feedTitle")}
      </h3>
      ${
        entries.length === 0
          ? html`<p class="cupcake-card__detail cupcake-exercise__empty">
              ${t("cupcake.exercise.feedEmpty")}
            </p>`
          : html`<ul class="cupcake-exercise__list">
              ${entries.map(
                (entry) => html`<li class="cupcake-exercise__item" data-exercise-id=${entry.id}>
                  <span class="cupcake-exercise__time">${timeOfDay(entry.performedAt)}</span>
                  <span class="cupcake-exercise__description">${entry.description}</span>
                  <span class="cupcake-exercise__kcal"
                    >${t("cupcake.exercise.kcalBurned", { value: kcal(entry.kcal) })}</span
                  >
                  <button
                    type="button"
                    class="cupcake-exercise__item-undo"
                    aria-label=${t("cupcake.exercise.undoEntry", { description: entry.description })}
                    @click=${() => this.undo(entry)}
                  >
                    ${icons.rotateCcw}
                  </button>
                </li>`,
              )}
            </ul>`
      }
    </section>`;
  }

  override render() {
    return html`<div class="cupcake-exercise ${this.open ? "cupcake-exercise--open" : ""}">
      ${
        this.open
          ? this.renderSheet()
          : html`<button
              type="button"
              class="cupcake-exercise__trigger"
              @click=${() => void this.openSheet()}
            >
              <span class="cupcake-exercise__trigger-icon" aria-hidden="true"
                >${this.speech ? icons.mic : icons.activity}</span
              >
              <span class="cupcake-exercise__trigger-text">
                <span class="cupcake-exercise__trigger-title">${t("cupcake.exercise.button")}</span>
                <span class="cupcake-exercise__trigger-hint"
                  >${this.speech ? t("cupcake.exercise.buttonHint") : t("cupcake.exercise.buttonHintType")}</span
                >
              </span>
            </button>`
      }
      ${this.renderStatus()} ${this.renderFeed()}
    </div>`;
  }
}

if (!customElements.get("openclaw-exercise-quick-log")) {
  customElements.define("openclaw-exercise-quick-log", ExerciseQuickLog);
}
