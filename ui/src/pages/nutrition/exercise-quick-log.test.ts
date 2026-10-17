import { afterEach, describe, expect, it, vi } from "vitest";
import { EXERCISE_CHANGED_EVENT, summarizeEstimateItem } from "./exercise-quick-log.ts";
import { createSampleNutritionAdapter, type NutritionAdapter } from "./nutrition-adapter.ts";
import { setNutritionAdapterForTesting } from "./nutrition-source.ts";

type QuickLog = HTMLElement & {
  updateComplete: Promise<boolean>;
  exercises: Awaited<ReturnType<NutritionAdapter["listExercises"]>>;
};

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

async function settle(element: QuickLog) {
  for (let index = 0; index < 4; index += 1) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    await element.updateComplete;
  }
}

async function mount(adapter: NutritionAdapter) {
  setNutritionAdapterForTesting(adapter);
  const element = document.createElement("openclaw-exercise-quick-log") as QuickLog;
  const changed = vi.fn(() => {
    void adapter.listExercises({ start: 0, end: Date.now() + 1 }).then((entries) => {
      element.exercises = entries;
    });
  });
  element.addEventListener(EXERCISE_CHANGED_EVENT, changed);
  document.body.append(element);
  await settle(element);
  return { element, changed };
}

describe("talk-to-log exercise", () => {
  afterEach(() => {
    document.body.replaceChildren();
    setNutritionAdapterForTesting(null);
    delete (globalThis as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  });

  it("falls back to one text field, logs the estimate, lists it, and undoes it", async () => {
    const adapter = createSampleNutritionAdapter({ storage: memoryStorage() });
    const { element, changed } = await mount(adapter);
    expect(element.textContent).toContain("Nothing logged yet");
    element.querySelector<HTMLButtonElement>(".cupcake-exercise__trigger")!.click();
    await settle(element);
    const input = element.querySelector<HTMLInputElement>(".cupcake-exercise__input")!;
    expect(element.querySelectorAll("input")).toHaveLength(1);
    expect(element.querySelector(".cupcake-exercise__mic")).toBeNull();
    expect(document.activeElement).toBe(input);
    input.value = "30 push-ups, 2 min plank, kettlebell rows 3x10 at 35lb";
    input.dispatchEvent(new Event("input"));
    await settle(element);
    element.querySelector<HTMLFormElement>(".cupcake-exercise__sheet")!.requestSubmit();
    await settle(element);
    expect(changed).toHaveBeenCalledTimes(1);
    const result = element.querySelector(".cupcake-exercise__result");
    expect(result?.textContent).toMatch(/≈ \d+ kcal burned/);
    expect(result?.textContent).toContain("push-ups ×30 · plank 2 min · kettlebell 3×10");
    expect(element.querySelectorAll(".cupcake-exercise__item")).toHaveLength(1);
    expect(element.querySelector(".cupcake-exercise__description")?.textContent).toContain(
      "30 push-ups",
    );
    element.querySelector<HTMLButtonElement>(".cupcake-exercise__undo")!.click();
    await settle(element);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(element.querySelectorAll(".cupcake-exercise__item")).toHaveLength(0);
    expect(element.textContent).toContain("Removed 30 push-ups");
  });

  it("does not log text it cannot recognize", async () => {
    const adapter = createSampleNutritionAdapter({ storage: memoryStorage() });
    const log = vi.spyOn(adapter, "logExercise");
    const { element } = await mount(adapter);
    element.querySelector<HTMLButtonElement>(".cupcake-exercise__trigger")!.click();
    await settle(element);
    const input = element.querySelector<HTMLInputElement>(".cupcake-exercise__input")!;
    input.value = "watched a movie";
    input.dispatchEvent(new Event("input"));
    await settle(element);
    element.querySelector<HTMLFormElement>(".cupcake-exercise__sheet")!.requestSubmit();
    await settle(element);
    expect(log).not.toHaveBeenCalled();
    expect(element.textContent).toContain("Couldn't find an exercise");
  });

  it("starts dictation on one tap and logs what was said", async () => {
    const instances: FakeRecognition[] = [];
    class FakeRecognition extends EventTarget {
      lang = "";
      continuous = true;
      interimResults = false;
      maxAlternatives = 0;
      start = vi.fn();
      stop = vi.fn(() => this.dispatchEvent(new Event("end")));
      abort = vi.fn();
      constructor() {
        super();
        instances.push(this);
      }
      speak(transcript: string) {
        const result = Object.assign([{ transcript }], { isFinal: true });
        this.dispatchEvent(
          Object.assign(new Event("result"), { resultIndex: 0, results: [result] }),
        );
        this.dispatchEvent(new Event("end"));
      }
    }
    (globalThis as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeRecognition;
    const adapter = createSampleNutritionAdapter({ storage: memoryStorage() });
    const log = vi.spyOn(adapter, "logExercise");
    const { element } = await mount(adapter);
    element.querySelector<HTMLButtonElement>(".cupcake-exercise__trigger")!.click();
    await settle(element);
    const recognition = instances[0]!;
    expect(recognition.start).toHaveBeenCalledTimes(1);
    expect(recognition.interimResults).toBe(true);
    expect(element.querySelector(".cupcake-exercise__mic--live")).not.toBeNull();
    recognition.speak("walked 20 minutes");
    await settle(element);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "walked 20 minutes",
        minutes: 20,
        estimator: "local-met",
      }),
    );
    expect(element.querySelector(".cupcake-exercise__result")).not.toBeNull();
  });

  it("summarizes estimate items compactly", () => {
    expect(
      summarizeEstimateItem({
        activity: "squats",
        minutes: 1.5,
        reps: 30,
        sets: 3,
        kcal: 10,
        assumed: false,
      }),
    ).toBe("squats 3×10");
    expect(
      summarizeEstimateItem({ activity: "plank", minutes: 0.8, kcal: 2, assumed: false }),
    ).toBe("plank 0.8 min");
  });
});
