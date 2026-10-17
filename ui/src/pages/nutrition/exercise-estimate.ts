/**
 * Deterministic burn estimator for plain-language exercise descriptions.
 * Pure, no I/O, works offline. Used by the Today quick-log ("Log exercise").
 *
 *   "30 push-ups, 2 min plank, kettlebell rows 3x10 at 35lb"
 *
 * Each clause is matched to an activity with a MET value (Compendium of
 * Physical Activities, rounded). Work time comes from an explicit duration,
 * from reps × seconds-per-rep, or from distance/steps at a typical pace.
 *
 * Only the *net* cost above resting is counted:
 *   kcal = (MET − 1) × bodyWeightKg × hours
 * because the baseline TDEE burn on the curve already includes resting energy.
 *
 * TODO(cupcake-exercise-ai): when the Gateway exposes a stateless model call
 * (today only `chat.send`, which creates a session, and the session-scoped
 * `sessions.companion.ask` exist), ask the model for `{ "kcal": number }` and
 * keep this estimator as the offline fallback.
 */

export const DEFAULT_BODY_WEIGHT_KG = 80;

type Activity = {
  id: string;
  /** Lower-case regex source, matched against the clause. */
  pattern: RegExp;
  met: number;
  /** Seconds of work per rep, for rep-counted movements. */
  secondsPerRep?: number;
  /** Minutes per mile, for distance-based movements. */
  minutesPerMile?: number;
  /** Assumed minutes when only the activity is named. */
  defaultMinutes?: number;
};

// Order matters: more specific patterns first.
const ACTIVITIES: readonly Activity[] = [
  { id: "push-ups", pattern: /push[\s-]?ups?|press[\s-]?ups?/, met: 8, secondsPerRep: 2 },
  { id: "pull-ups", pattern: /pull[\s-]?ups?|chin[\s-]?ups?/, met: 8, secondsPerRep: 3 },
  { id: "burpees", pattern: /burpees?/, met: 8, secondsPerRep: 4 },
  {
    id: "jumping jacks",
    pattern: /jumping[\s-]?jacks?|star[\s-]?jumps?/,
    met: 8,
    secondsPerRep: 1,
  },
  { id: "sit-ups", pattern: /sit[\s-]?ups?|crunch(?:es)?/, met: 3.8, secondsPerRep: 2.5 },
  { id: "squats", pattern: /squats?/, met: 5, secondsPerRep: 3 },
  { id: "lunges", pattern: /lunges?/, met: 4, secondsPerRep: 3 },
  { id: "plank", pattern: /planks?/, met: 3.8, defaultMinutes: 1 },
  { id: "kettlebell", pattern: /kettle[\s-]?bells?|\bkb\b/, met: 6, secondsPerRep: 3 },
  { id: "jump rope", pattern: /jump(?:ing)?[\s-]?rope|skipping/, met: 11, secondsPerRep: 0.5 },
  { id: "rowing", pattern: /row(?:ing)?[\s-]?machine|\berg\b|rower/, met: 7, minutesPerMile: 9 },
  {
    id: "weights",
    pattern: /weights?|lift(?:ing|ed)?|deadlifts?|bench|curls?|presses|\brows?\b/,
    met: 5,
    secondsPerRep: 3,
  },
  {
    id: "running",
    pattern: /\brun(?:s|ning)?\b|\bran\b|jog(?:s|ging|ged)?/,
    met: 9.8,
    minutesPerMile: 10,
  },
  {
    id: "cycling",
    pattern: /cycl(?:e|ing|ed)|bik(?:e|ing|ed)|spin(?:ning)?|peloton/,
    met: 7.5,
    minutesPerMile: 4,
  },
  { id: "swimming", pattern: /swim(?:s|ming)?|swam|laps?/, met: 7, minutesPerMile: 35 },
  { id: "hiking", pattern: /hik(?:e|ing|ed)/, met: 6, minutesPerMile: 25 },
  { id: "stairs", pattern: /stairs?|stair[\s-]?master|stepper/, met: 8 },
  { id: "elliptical", pattern: /elliptical|cross[\s-]?trainer/, met: 5 },
  { id: "hiit", pattern: /hiit|circuit|tabata|crossfit/, met: 8 },
  { id: "yoga", pattern: /yoga|pilates/, met: 2.8 },
  { id: "stretching", pattern: /stretch(?:ing|ed)?|mobility/, met: 2.3 },
  { id: "dancing", pattern: /danc(?:e|ing|ed)/, met: 5 },
  { id: "tennis", pattern: /tennis|pickleball|squash|padel/, met: 7 },
  { id: "basketball", pattern: /basketball|soccer|football/, met: 7 },
  { id: "golf", pattern: /golf/, met: 4.8 },
  { id: "walking", pattern: /walk(?:s|ing|ed)?|steps?\b|stroll/, met: 3.5, minutesPerMile: 20 },
  {
    id: "workout",
    pattern: /work(?:ed)?[\s-]?out|exercis(?:e|ed|ing)|training|gym/,
    met: 5,
    defaultMinutes: 30,
  },
];

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  hundred: 100,
  half: 0.5,
};

const REST_MET = 2; // Light movement between sets.
const REST_SECONDS_BETWEEN_SETS = 60;
const STEPS_PER_MINUTE = 100;

export type ExerciseEstimateItem = {
  activity: string;
  /** Minutes of work (rest between sets not included). */
  minutes: number;
  reps?: number;
  sets?: number;
  loadKg?: number;
  kcal: number;
  /** True when the activity or its amount had to be assumed. */
  assumed: boolean;
};

export type ExerciseEstimate = {
  kcal: number;
  minutes: number;
  items: ExerciseEstimateItem[];
  /** Clauses that matched no activity and were not counted. */
  unrecognized: string[];
  source: "local-met";
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/×/g, "x")
    .replace(/(\d),(\d{3})\b/g, "$1$2")
    .replace(/\bhalf (?:an )?hour\b/g, "30 min")
    .replace(/\b(?:an|one) hour\b/g, "60 min")
    .replace(/\bquarter (?:of )?(?:an )?hour\b/g, "15 min")
    .replace(
      /\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|hundred|half)\b(?=\s*(?:an?\s+)?(?:hours?|hrs?|minutes?|mins?|seconds?|secs?|miles?|mi|km|k|sets?|reps?|x\b|push|pull|sit|squat|lunge|burpee|jumping))/g,
      (word) => String(NUMBER_WORDS[word] ?? word),
    )
    .replace(/\s+/g, " ")
    .trim();
}

function splitClauses(text: string): string[] {
  return text
    .split(/[,;\n+]|\band then\b|\bthen\b|\band\b|\bplus\b|\bfollowed by\b/)
    .map((part) => part.trim())
    .filter((part) => /[a-z]/.test(part));
}

function parseDurationMinutes(clause: string): number | null {
  const clock = /\b(\d{1,2}):([0-5]\d)\b/.exec(clause);
  if (clock) {
    return Number(clock[1]) + Number(clock[2]) / 60;
  }
  let total = 0;
  let found = false;
  const unit = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h\b|minutes?|mins?|m\b|seconds?|secs?|s\b)/g;
  for (const match of clause.matchAll(unit)) {
    const value = Number(match[1]);
    const label = match[2] ?? "";
    found = true;
    total += label.startsWith("h") ? value * 60 : label.startsWith("s") ? value / 60 : value;
  }
  return found ? total : null;
}

function parseDistanceMiles(clause: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*(miles?|mi\b|km\b|kilometers?|kilometres?|k\b)/.exec(clause);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return (match[2] ?? "").startsWith("m") ? value : value * 0.621371;
}

function parseSteps(clause: string): number | null {
  const match = /(\d[\d,]*(?:\.\d+)?)\s*(k)?\s*steps?\b/.exec(clause);
  if (!match) {
    return null;
  }
  const value = Number((match[1] ?? "").replace(/,/g, ""));
  return match[2] ? value * 1000 : value;
}

function parseSetsReps(clause: string): { sets: number; reps: number } | null {
  const grid = /(\d+)\s*x\s*(\d+)\b/.exec(clause);
  if (grid) {
    return { sets: Number(grid[1]), reps: Number(grid[2]) };
  }
  const words = /(\d+)\s*sets?\s*(?:of\s*)?(\d+)/.exec(clause);
  if (words) {
    return { sets: Number(words[1]), reps: Number(words[2]) };
  }
  const repsOnly = /(\d+)\s*reps?\b/.exec(clause) ?? /\bx\s*(\d+)\b/.exec(clause);
  if (repsOnly) {
    return { sets: 1, reps: Number(repsOnly[1]) };
  }
  return null;
}

function parseLoadKg(clause: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*(lbs?|pounds?|#|kgs?|kilos?)/.exec(clause);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return (match[2] ?? "").startsWith("k") ? value : value * 0.453592;
}

/** A bare leading count ("30 push-ups"), ignoring numbers that carry units. */
function parseBareCount(clause: string): number | null {
  const stripped = clause
    .replace(
      /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h\b|minutes?|mins?|m\b|seconds?|secs?|s\b|miles?|mi\b|km\b|k\b|lbs?|pounds?|#|kgs?|kilos?|steps?)/g,
      " ",
    )
    .replace(/\d+\s*x\s*\d+/g, " ");
  const match = /\b(\d+)\b/.exec(stripped);
  return match ? Number(match[1]) : null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function estimateClause(clause: string, weightKg: number): ExerciseEstimateItem | null {
  const activity = ACTIVITIES.find((entry) => entry.pattern.test(clause));
  if (!activity) {
    return null;
  }
  const loadKg = parseLoadKg(clause) ?? undefined;
  // External load raises intensity modestly (capped at +40%).
  const met = activity.met * (loadKg ? 1 + Math.min(0.4, loadKg / weightKg / 2) : 1);
  const netKcalPerMinute = ((met - 1) * weightKg) / 60;

  let minutes = parseDurationMinutes(clause);
  let reps: number | undefined;
  let sets: number | undefined;
  let restMinutes = 0;
  let assumed = false;

  if (minutes === null) {
    const steps = parseSteps(clause);
    const miles = parseDistanceMiles(clause);
    if (steps !== null) {
      minutes = steps / STEPS_PER_MINUTE;
    } else if (miles !== null && activity.minutesPerMile) {
      minutes = miles * activity.minutesPerMile;
    }
  }
  if (minutes === null && activity.secondsPerRep) {
    const setsReps = parseSetsReps(clause);
    const count = setsReps ? null : parseBareCount(clause);
    if (setsReps) {
      sets = setsReps.sets;
      reps = setsReps.sets * setsReps.reps;
    } else if (count !== null) {
      sets = 1;
      reps = count;
    }
    if (reps !== undefined) {
      minutes = (reps * activity.secondsPerRep) / 60;
      restMinutes = (Math.max(0, (sets ?? 1) - 1) * REST_SECONDS_BETWEEN_SETS) / 60;
    }
  }
  if (minutes === null) {
    minutes = activity.defaultMinutes ?? 15;
    assumed = true;
  }
  minutes = Math.min(minutes, 8 * 60);
  const kcal = netKcalPerMinute * minutes + (((REST_MET - 1) * weightKg) / 60) * restMinutes;
  return {
    activity: activity.id,
    minutes: round1(minutes),
    ...(reps !== undefined ? { reps } : {}),
    ...(sets !== undefined && sets > 1 ? { sets } : {}),
    ...(loadKg !== undefined ? { loadKg: round1(loadKg) } : {}),
    kcal: Math.max(0, Math.round(kcal)),
    assumed,
  };
}

/** Estimate net kcal burned for a plain-language description. */
export function estimateExerciseBurn(
  description: string,
  options: { weightKg?: number } = {},
): ExerciseEstimate {
  const weightKg =
    options.weightKg && Number.isFinite(options.weightKg) && options.weightKg > 20
      ? options.weightKg
      : DEFAULT_BODY_WEIGHT_KG;
  const items: ExerciseEstimateItem[] = [];
  const unrecognized: string[] = [];
  for (const clause of splitClauses(normalize(description))) {
    const item = estimateClause(clause, weightKg);
    if (item) {
      items.push(item);
    } else {
      unrecognized.push(clause);
    }
  }
  return {
    kcal: items.reduce((sum, item) => sum + item.kcal, 0),
    minutes: round1(items.reduce((sum, item) => sum + item.minutes, 0)),
    items,
    unrecognized,
    source: "local-met",
  };
}
