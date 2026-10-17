/**
 * Minimal wrapper over the browser Web Speech API for one-shot dictation.
 *
 * The Control UI's Gateway dictation path (chat composer) streams audio to a
 * configured transcription provider; the Today quick-log only needs a short
 * phrase, so it uses on-device/browser recognition where available and falls
 * back to typing everywhere else (Firefox, most desktop Linux, tests).
 */

type RecognitionResultList = ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;

type RecognitionEvent = { resultIndex: number; results: RecognitionResultList };

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  addEventListener(type: "result", listener: (event: RecognitionEvent) => void): void;
  addEventListener(type: "error", listener: (event: { error: string }) => void): void;
  addEventListener(type: "end", listener: () => void): void;
  start(): void;
  stop(): void;
  abort(): void;
};

type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | null {
  const scope = globalThis as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export function speechDictationSupported(): boolean {
  return recognitionConstructor() !== null;
}

export type DictationHandlers = {
  /** Running transcript (final + interim) as Matt speaks. */
  onTranscript: (text: string) => void;
  /** Recognition stopped; `text` is the final transcript (may be empty). */
  onEnd: (text: string) => void;
  onError: (code: string) => void;
};

export type DictationSession = { stop(): void; abort(): void };

/** Start dictation, or return null when the browser has no speech API. */
export function startDictation(
  handlers: DictationHandlers,
  lang = globalThis.navigator?.language ?? "en-US",
): DictationSession | null {
  const Constructor = recognitionConstructor();
  if (!Constructor) {
    return null;
  }
  const recognition = new Constructor();
  recognition.lang = lang;
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  let finalText = "";
  let aborted = false;
  recognition.addEventListener("result", (event) => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result?.[0]?.transcript ?? "";
      if (result?.isFinal) {
        finalText += transcript;
      } else {
        interim += transcript;
      }
    }
    handlers.onTranscript(`${finalText}${interim}`.trim());
  });
  recognition.addEventListener("error", (event) => {
    if (event.error !== "aborted" && event.error !== "no-speech") {
      handlers.onError(event.error);
    }
  });
  recognition.addEventListener("end", () => {
    if (!aborted) {
      handlers.onEnd(finalText.trim());
    }
  });
  try {
    recognition.start();
  } catch {
    return null;
  }
  return {
    stop: () => recognition.stop(),
    abort: () => {
      aborted = true;
      recognition.abort();
    },
  };
}
