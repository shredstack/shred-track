import type {
  WorkoutType,
  ParsedWorkout,
  ParsedMovement,
  MovementMetricType,
  RoundScoreAggregation,
} from "@/types/crossfit";

// ============================================
// Movement library lookup (Phase 2 movement settings)
// ============================================
//
// The parser stays pure — no DB access. Callers pass a sparse view of the
// movement library so we can look up `supported_metric_types` and route
// leading numbers to the right `prescribed_*` slot when the input doesn't
// carry an explicit "cal" / "m" unit.
//
// Why this matters: "Row 21" — without text cues — is ambiguous. The
// matched movement (Row) has supported metrics ['calories', 'distance'],
// not ['reps'], so the 21 should land in `prescribedCaloriesMale`, not
// `prescribedReps`. The heuristic-only path got this wrong.

export interface MovementLibraryEntry {
  canonicalName: string;
  metricType?: MovementMetricType | null;
  supportedMetricTypes?: MovementMetricType[] | null;
}

// ============================================
// Abbreviation Map
// ============================================

const ABBREVIATIONS: Record<string, string> = {
  t2b: "Toes-to-Bar",
  ttb: "Toes-to-Bar",
  k2e: "Knees-to-Elbows",
  kte: "Knees-to-Elbows",
  du: "Double-Under",
  dbl: "Double-Under",
  su: "Single-Under",
  hspu: "Handstand Push-Up",
  c2b: "Chest-to-Bar Pull-Up",
  ctb: "Chest-to-Bar Pull-Up",
  bmu: "Bar Muscle-Up",
  rmu: "Ring Muscle-Up",
  mu: "Muscle-Up",
  s2oh: "Shoulder-to-Overhead",
  sto: "Shoulder-to-Overhead",
  s2o: "Shoulder-to-Overhead",
  g2oh: "Ground-to-Overhead",
  gto: "Ground-to-Overhead",
  g2o: "Ground-to-Overhead",
  ohs: "Overhead Squat",
  fs: "Front Squat",
  bs: "Back Squat",
  dl: "Deadlift",
  sdl: "Sumo Deadlift",
  sdhp: "Sumo Deadlift High Pull",
  pc: "Power Clean",
  sqcl: "Squat Clean",
  sc: "Squat Clean",
  hpc: "Hang Power Clean",
  hsc: "Hang Squat Clean",
  hc: "Hang Clean",
  pj: "Push Jerk",
  sj: "Split Jerk",
  psn: "Power Snatch",
  sqsn: "Squat Snatch",
  hps: "Hang Power Snatch",
  hss: "Hang Squat Snatch",
  pp: "Push Press",
  sp: "Strict Press",
  bp: "Bench Press",
  wbs: "Wall Ball Shot",
  wb: "Wall Ball",
  kb: "Kettlebell Swing",
  kbs: "Kettlebell Swing",
  abmat: "AbMat Sit-Up",
  ghd: "GHD Sit-Up",
  ghdsu: "GHD Sit-Up",
  pu: "Pull-Up",
  burpee: "Burpee",
  "box jump": "Box Jump",
  bj: "Box Jump",
  bjo: "Box Jump Over",
  hsw: "Handstand Walk",
  rc: "Rope Climb",
  cal: "Calories",
  row: "Row",
  bike: "Assault Bike",
  "assault bike": "Assault Bike",
  "echo bike": "Echo Bike",
  run: "Run",
  ski: "Ski Erg",
  "ski erg": "Ski Erg",
  thruster: "Thruster",
  "wall walk": "Wall Walk",
  ww: "Wall Walk",
  "devil press": "Devil Press",
  "db snatch": "Dumbbell Snatch",
  "db clean": "Dumbbell Clean",
  "pistol": "Pistol Squat",
  "pistol squat": "Pistol Squat",
  "walking lunge": "Walking Lunge",
  lunge: "Lunge",
  "oh lunge": "Overhead Lunge",
  "oh walking lunge": "Overhead Walking Lunge",
  clean: "Clean",
  snatch: "Snatch",
  jerk: "Jerk",
  "clean and jerk": "Clean and Jerk",
  "c&j": "Clean and Jerk",
  "cluster": "Cluster",
  "pull-up": "Pull-Up",
  "pullup": "Pull-Up",
  "push-up": "Push-Up",
  "pushup": "Push-Up",
  "ring dip": "Ring Dip",
  "dip": "Dip",
  "sit-up": "Sit-Up",
  "situp": "Sit-Up",
  "double under": "Double-Under",
  "single under": "Single-Under",
  "deadlift": "Deadlift",
  "squat": "Squat",
  "air squat": "Air Squat",
  "goblet squat": "Goblet Squat",
  "front squat": "Front Squat",
  "back squat": "Back Squat",
  "overhead squat": "Overhead Squat",
  "power clean": "Power Clean",
  "squat clean": "Squat Clean",
  "hang clean": "Hang Clean",
  "hang power clean": "Hang Power Clean",
  "hang squat clean": "Hang Squat Clean",
  "power snatch": "Power Snatch",
  "squat snatch": "Squat Snatch",
  "hang power snatch": "Hang Power Snatch",
  "hang squat snatch": "Hang Squat Snatch",
  "push press": "Push Press",
  "strict press": "Strict Press",
  "push jerk": "Push Jerk",
  "split jerk": "Split Jerk",
  "shoulder press": "Shoulder Press",
  "bench press": "Bench Press",
  "sumo deadlift high pull": "Sumo Deadlift High Pull",
  "wall ball": "Wall Ball Shot",
  "wall ball shot": "Wall Ball Shot",
  "kettlebell swing": "Kettlebell Swing",
  "russian kb swing": "Russian Kettlebell Swing",
  "american kb swing": "American Kettlebell Swing",
  "turkish get-up": "Turkish Get-Up",
  "tgu": "Turkish Get-Up",
  "rope climb": "Rope Climb",
  "legless rope climb": "Legless Rope Climb",
  "handstand push-up": "Handstand Push-Up",
  "handstand walk": "Handstand Walk",
  "toes-to-bar": "Toes-to-Bar",
  "knees-to-elbows": "Knees-to-Elbows",
  "chest-to-bar": "Chest-to-Bar Pull-Up",
  "chest-to-bar pull-up": "Chest-to-Bar Pull-Up",
  "bar muscle-up": "Bar Muscle-Up",
  "ring muscle-up": "Ring Muscle-Up",
  "muscle-up": "Muscle-Up",
  "box jump over": "Box Jump Over",
  "burpee box jump over": "Burpee Box Jump Over",
  "burpee over bar": "Burpee Over Bar",
  "bar facing burpee": "Bar-Facing Burpee",
  "bar-facing burpee": "Bar-Facing Burpee",
};

// ============================================
// Workout Type Detection
// ============================================

function detectWorkoutType(text: string): {
  type: WorkoutType;
  confidence: number;
} {
  const lower = text.toLowerCase();

  // AMRAP detection
  if (/\bamrap\b/i.test(lower)) {
    return { type: "amrap", confidence: 0.95 };
  }
  if (/\bas\s+many\s+(rounds|reps)\b/i.test(lower)) {
    return { type: "amrap", confidence: 0.9 };
  }

  // Timed Rounds detection — "Every X:XX for N rounds" or "Every X:XX × N
  // rounds". Matched before generic EMOM detection so the more specific
  // "for N rounds" pattern wins.
  if (extractTimedRoundsHeader(text)) {
    return { type: "timed_rounds", confidence: 0.95 };
  }

  // EMOM detection
  if (/\bemom\b/i.test(lower)) {
    return { type: "emom", confidence: 0.95 };
  }
  if (/\bevery\s+\d+\s*min/i.test(lower)) {
    return { type: "emom", confidence: 0.85 };
  }

  // Tabata detection
  if (/\btabata\b/i.test(lower)) {
    return { type: "tabata", confidence: 0.95 };
  }

  // For Load detection
  if (/\bfor\s+load\b/i.test(lower)) {
    return { type: "for_load", confidence: 0.95 };
  }
  if (/\b\d+\s*rm\b/i.test(lower) || /\bmax\s+(effort\s+)?(clean|snatch|deadlift|squat|press|jerk|bench)/i.test(lower)) {
    return { type: "for_load", confidence: 0.85 };
  }

  // For Calories detection
  if (/\bfor\s+cal(orie)?s?\b/i.test(lower)) {
    return { type: "for_calories", confidence: 0.9 };
  }
  if (/\bmax\s+cal(orie)?s?\b/i.test(lower)) {
    return { type: "for_calories", confidence: 0.85 };
  }

  // Max Effort detection
  if (/\bmax\s+effort\b/i.test(lower) || /\bmax\s+reps?\b/i.test(lower)) {
    return { type: "max_effort", confidence: 0.85 };
  }

  // For Reps detection
  if (/\bfor\s+reps\b/i.test(lower) || /\bmax\s+reps\b/i.test(lower)) {
    return { type: "for_reps", confidence: 0.85 };
  }

  // For Time detection
  if (/\bfor\s+time\b/i.test(lower)) {
    return { type: "for_time", confidence: 0.95 };
  }
  if (/\btime\s*cap\b/i.test(lower) || /\btc[\s:]+\d/i.test(lower)) {
    return { type: "for_time", confidence: 0.8 };
  }
  if (/\b\d+\s*rounds?\s+(of|for)\b/i.test(lower)) {
    return { type: "for_time", confidence: 0.7 };
  }
  // Rep schemes like 21-15-9 often indicate for time
  if (/\b\d+-\d+-\d+\b/.test(lower)) {
    return { type: "for_time", confidence: 0.65 };
  }

  return { type: "other", confidence: 0.3 };
}

// ============================================
// Time Cap Extraction
// ============================================

function extractTimeCap(text: string): number | undefined {
  // Patterns: "(18 min cap)", "TC: 15", "Time Cap: 20 min", "(cap 15)"
  const patterns = [
    /\((\d+)\s*min(?:ute)?\s*cap\)/i,
    /time\s*cap[:\s]+(\d+)/i,
    /tc[:\s]+(\d+)/i,
    /\(cap\s*(\d+)\)/i,
    /cap[:\s]+(\d+)\s*min/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return parseInt(match[1]) * 60;
    }
  }

  return undefined;
}

// ============================================
// Timed Rounds Extraction
// ============================================
//
// Pattern: "Every M:SS for N rounds" or "Every M:SS × N rounds". Returns
// { windowSeconds, rounds } when matched, null otherwise. Used both to
// detect the workout type and to seed the prescription's rounds + window.
function extractTimedRoundsHeader(
  text: string
): { windowSeconds: number; rounds: number } | null {
  // Match within any line — the header is usually first but we don't
  // require it to lead the text. `(?:for|x)` accepts both "for N rounds"
  // and "× N rounds".
  const re = /every\s+(\d+):(\d{2})\s+(?:for|x|×)\s+(\d+)\s+rounds?\b/i;
  for (const line of text.split(/\n/)) {
    const m = line.trim().match(re);
    if (m) {
      const minutes = parseInt(m[1], 10);
      const seconds = parseInt(m[2], 10);
      const rounds = parseInt(m[3], 10);
      if (
        Number.isFinite(minutes) &&
        Number.isFinite(seconds) &&
        Number.isFinite(rounds) &&
        rounds > 0
      ) {
        return { windowSeconds: minutes * 60 + seconds, rounds };
      }
    }
  }
  return null;
}

// Look for "score is the slowest / fastest / sum / total / average / avg"
// lines anywhere in the text. Returns null when no scoring directive is
// found — caller defaults to 'slowest'.
function extractRoundScoreAggregation(
  text: string
): { aggregation: RoundScoreAggregation; matchedLine: string } | null {
  for (const rawLine of text.split(/\n/)) {
    const line = rawLine.trim();
    if (/score\s+is\s+the\s+slowest/i.test(line)) {
      return { aggregation: "slowest", matchedLine: rawLine };
    }
    if (/score\s+is\s+the\s+fastest/i.test(line)) {
      return { aggregation: "fastest", matchedLine: rawLine };
    }
    if (/score\s+is\s+the\s+(sum|total)/i.test(line)) {
      return { aggregation: "sum", matchedLine: rawLine };
    }
    if (/score\s+is\s+the\s+(average|avg)/i.test(line)) {
      return { aggregation: "average", matchedLine: rawLine };
    }
  }
  return null;
}

// ============================================
// AMRAP Duration Extraction
// ============================================

function extractAmrapDuration(text: string): number | undefined {
  // "AMRAP 12", "AMRAP in 15 minutes", "12 min AMRAP", "AMRAP 20:00"
  const patterns = [
    /amrap\s*(\d+)/i,
    /amrap\s+in\s+(\d+)/i,
    /(\d+)\s*min(?:ute)?s?\s*amrap/i,
    /amrap\s+(\d+):00/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return parseInt(match[1]) * 60;
    }
  }

  return undefined;
}

// ============================================
// Rep Scheme Extraction
// ============================================

function extractRepScheme(text: string): string | undefined {
  // "21-15-9", "5 rounds of", "5-5-5-5-5", "3 rounds for time"
  const dashPattern = text.match(/\b(\d+(?:-\d+)+)\b/);
  if (dashPattern) {
    return dashPattern[1];
  }

  const roundsPattern = text.match(/(\d+)\s*rounds?\b/i);
  if (roundsPattern) {
    return `${roundsPattern[1]} rounds`;
  }

  return undefined;
}

// ============================================
// Weight Parsing
// ============================================

function parseWeight(
  text: string
): { male?: number; female?: number; unit: "lb" | "kg" } | null {
  // "(95/65)", "(135/95 lb)", "(24/20 kg)", "(95#/65#)"
  const patterns = [
    /\((\d+(?:\.\d+)?)\s*#?\s*\/\s*(\d+(?:\.\d+)?)\s*#?\s*(lb|lbs|kg|kgs)?\)/i,
    /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(lb|lbs|kg|kgs|#)/i,
    /\((\d+(?:\.\d+)?)\s*(lb|lbs|kg|kgs|#)\)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const unitStr = (match[3] || match[2] || "lb").toLowerCase();
      const unit: "lb" | "kg" =
        unitStr === "kg" || unitStr === "kgs" ? "kg" : "lb";

      if (match[2] && !isNaN(parseFloat(match[2])) && parseFloat(match[2]) > 0) {
        return {
          male: parseFloat(match[1]),
          female: parseFloat(match[2]),
          unit,
        };
      }
      return {
        male: parseFloat(match[1]),
        unit,
      };
    }
  }

  return null;
}

// ============================================
// Movement Line Parsing
// ============================================

// Lookup helper: find the library entry for a matched canonical name.
function lookupLibraryEntry(
  matchedName: string | undefined,
  library?: MovementLibraryEntry[]
): MovementLibraryEntry | undefined {
  if (!matchedName || !library) return undefined;
  return library.find(
    (m) => m.canonicalName.toLowerCase() === matchedName.toLowerCase()
  );
}

// Returns true when the movement supports the given metric (via the
// new supported_metric_types column or the legacy single metricType).
function supportsMetric(
  entry: MovementLibraryEntry | undefined,
  metric: MovementMetricType
): boolean {
  if (!entry) return false;
  if (entry.supportedMetricTypes && entry.supportedMetricTypes.length > 0) {
    return entry.supportedMetricTypes.includes(metric);
  }
  return entry.metricType === metric;
}

function parseMovementLine(
  line: string,
  library?: MovementLibraryEntry[]
): ParsedMovement | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 2) return null;

  // Skip lines that are just workout type/metadata
  if (/^(for\s+time|amrap|emom|tabata|time\s*cap|tc:|rest)/i.test(trimmed)) {
    return null;
  }
  // Skip lines that are just round info
  if (/^\d+\s*rounds?\s*(of|for|:)/i.test(trimmed)) {
    return null;
  }
  // Skip lines that are just numbers (rep scheme headers like "21-15-9")
  if (/^\d+(-\d+)+$/.test(trimmed)) {
    return null;
  }

  let reps: string | undefined;
  let caloriesMale: number | undefined;
  let caloriesFemale: number | undefined;
  let distanceMaleMeters: number | undefined;
  let distanceFemaleMeters: number | undefined;
  let movementText = trimmed;
  let confidence = 0.5;

  // Extract calorie-based: "30 Cal Row", "20/15 Cal Bike", "Row 21/15 cal"
  // (run before the generic reps matcher so "21 Cal Row" doesn't get
  // captured as reps="21" + movement="Cal Row").
  const calMatch = movementText.match(
    /^(\d+)(?:\/(\d+))?\s*cal(?:orie)?s?\s+(.+)/i
  );
  const calTrailingMatch = !calMatch
    ? movementText.match(/^(.+?)\s+(\d+)(?:\/(\d+))?\s*cal(?:orie)?s?\s*$/i)
    : null;
  if (calMatch) {
    caloriesMale = parseInt(calMatch[1], 10);
    if (calMatch[2]) caloriesFemale = parseInt(calMatch[2], 10);
    movementText = calMatch[3];
  } else if (calTrailingMatch) {
    movementText = calTrailingMatch[1];
    caloriesMale = parseInt(calTrailingMatch[2], 10);
    if (calTrailingMatch[3]) caloriesFemale = parseInt(calTrailingMatch[3], 10);
  } else {
    // Extract distance-based: "400m Run", "1 mile Run", "800/600 m Run"
    const distanceMatch = movementText.match(
      /^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?\s*(m|meter|meters|ft|feet|mi(?:le)?s?|km|k)\b\s+(.+)/i
    );
    if (distanceMatch) {
      const unit = distanceMatch[3].toLowerCase();
      distanceMaleMeters = toMeters(parseFloat(distanceMatch[1]), unit);
      if (distanceMatch[2])
        distanceFemaleMeters = toMeters(parseFloat(distanceMatch[2]), unit);
      movementText = distanceMatch[4];
    } else {
      // Generic reps prefix: "21 Thrusters", "15 Pull-Ups"
      const repsMatch = movementText.match(
        /^(\d+(?:\s*[x×]\s*\d+)?(?:\s*(?:ea(?:ch)?|per\s+(?:side|arm|leg)))?)\s+(.+)/i
      );
      if (repsMatch) {
        reps = repsMatch[1];
        movementText = repsMatch[2];
      }
    }
  }

  // Extract weight from the movement text
  const weight = parseWeight(movementText);
  // Remove weight portion from movement text
  movementText = movementText
    .replace(
      /\s*\(\d+(?:\.\d+)?\s*#?\s*\/\s*\d+(?:\.\d+)?\s*#?\s*(?:lb|lbs|kg|kgs)?\)/i,
      ""
    )
    .replace(/\s*\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*(?:lb|lbs|kg|kgs|#)/i, "")
    .replace(/\s*\(\d+(?:\.\d+)?\s*(?:lb|lbs|kg|kgs|#)\)/i, "")
    .trim();

  // Remove height specs like "(20")" or "(24/20")"
  movementText = movementText
    .replace(/\s*\(\d+(?:\/\d+)?\s*["″']\)/g, "")
    .replace(/\s*\(\d+(?:\/\d+)?\s*(?:in|inch|inches)\)/gi, "")
    .trim();

  // Try to match the movement name against known movements
  const lowerMovement = movementText.toLowerCase().trim();
  let matchedName: string | undefined;

  // Try exact match first
  if (ABBREVIATIONS[lowerMovement]) {
    matchedName = ABBREVIATIONS[lowerMovement];
    confidence = 0.95;
  } else {
    // Try partial matching - find the best match
    const movementWords = lowerMovement.split(/\s+/);

    // Try matching progressively shorter phrases
    for (let len = movementWords.length; len >= 1; len--) {
      const phrase = movementWords.slice(0, len).join(" ");
      if (ABBREVIATIONS[phrase]) {
        matchedName = ABBREVIATIONS[phrase];
        confidence = len === movementWords.length ? 0.9 : 0.7;
        break;
      }
    }

    // If no match found, use the original text cleaned up
    if (!matchedName) {
      matchedName = movementText
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
      confidence = 0.4;
    }
  }

  // Library-driven re-routing: when the matched movement supports
  // calories or distance (and not reps), and the heuristics dropped the
  // leading number into `reps`, move it. This catches "Row 21" /
  // "Row 21/15" inputs that don't carry an explicit "cal" unit cue.
  // Falls back gracefully when no library is provided (the previous
  // text-pattern behavior is preserved).
  const libEntry = lookupLibraryEntry(matchedName, library);
  if (libEntry && reps != null) {
    const supportsReps = supportsMetric(libEntry, "reps");
    const supportsCalories = supportsMetric(libEntry, "calories");
    const supportsDistance = supportsMetric(libEntry, "distance");
    // Single-number reps like "21" or "21/15" → split on /. If the
    // movement scores in calories/distance only, route the number(s)
    // there.
    const repsParts = reps.match(/^(\d+)(?:\s*\/\s*(\d+))?$/);
    if (repsParts && !supportsReps) {
      if (supportsCalories) {
        caloriesMale = parseInt(repsParts[1], 10);
        if (repsParts[2]) caloriesFemale = parseInt(repsParts[2], 10);
        reps = undefined;
      } else if (supportsDistance) {
        distanceMaleMeters = parseInt(repsParts[1], 10);
        if (repsParts[2]) distanceFemaleMeters = parseInt(repsParts[2], 10);
        reps = undefined;
      }
    }
  }

  return {
    name: movementText,
    matchedCanonicalName: matchedName,
    reps,
    caloriesMale,
    caloriesFemale,
    distanceMaleMeters,
    distanceFemaleMeters,
    weightMale: weight?.male,
    weightFemale: weight?.female,
    weightUnit: weight?.unit,
    confidence,
  };
}

function toMeters(value: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u.startsWith("km") || u === "k") return Math.round(value * 1000);
  if (u.startsWith("mi")) return Math.round(value * 1609.344);
  if (u.startsWith("ft") || u.startsWith("feet")) return Math.round(value * 0.3048);
  // m | meter | meters
  return Math.round(value);
}

// ============================================
// Main Parser
// ============================================

export function parseWorkoutText(
  rawText: string,
  library?: MovementLibraryEntry[]
): ParsedWorkout {
  const lines = rawText
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Detect workout type
  const { type: workoutType, confidence: workoutTypeConfidence } =
    detectWorkoutType(rawText);

  // Extract time cap
  const timeCapSeconds = extractTimeCap(rawText);

  // Extract AMRAP duration
  const amrapDurationSeconds =
    workoutType === "amrap" ? extractAmrapDuration(rawText) : undefined;

  // Timed Rounds: extract the header (rounds + window) and the scoring
  // line aggregation. Both are workout-type-gated so they don't leak into
  // unrelated parses.
  const timedRoundsHeader =
    workoutType === "timed_rounds"
      ? extractTimedRoundsHeader(rawText)
      : null;
  const aggregationMatch =
    workoutType === "timed_rounds"
      ? extractRoundScoreAggregation(rawText)
      : null;

  // Extract rep scheme
  const repScheme = extractRepScheme(rawText);

  // Try to extract a title from the first line if it looks like one
  let title: string | undefined;
  const firstLine = lines[0];
  if (
    firstLine &&
    firstLine.length < 40 &&
    !/^\d/.test(firstLine) &&
    !/for\s+time|amrap|emom|tabata|every\s+\d/i.test(firstLine) &&
    !parseWeight(firstLine)
  ) {
    // Looks like a title (short, doesn't start with a number, not a workout type)
    title = firstLine;
  }

  // Parse each line as a potential movement. For timed_rounds, drop the
  // header line and the scoring directive — they're metadata, not movements.
  const headerRe = /every\s+\d+:\d{2}\s+(?:for|x|×)\s+\d+\s+rounds?:?$/i;
  const movements: ParsedMovement[] = [];
  for (const line of lines) {
    if (line === title) continue;
    if (workoutType === "timed_rounds" && headerRe.test(line)) continue;
    if (
      workoutType === "timed_rounds" &&
      aggregationMatch &&
      line === aggregationMatch.matchedLine.trim()
    ) {
      continue;
    }
    const parsed = parseMovementLine(line, library);
    if (parsed) {
      movements.push(parsed);
    }
  }

  return {
    title,
    workoutType,
    workoutTypeConfidence,
    timeCapSeconds,
    amrapDurationSeconds,
    repScheme,
    rounds: timedRoundsHeader?.rounds,
    roundWindowSeconds: timedRoundsHeader?.windowSeconds,
    roundScoreAggregation:
      workoutType === "timed_rounds"
        ? aggregationMatch?.aggregation ?? "slowest"
        : undefined,
    movements,
    rawText,
  };
}

// ============================================
// Helper: Format seconds as MM:SS
// ============================================

export function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function parseTimeToSeconds(timeStr: string): number | undefined {
  const match = timeStr.match(/^(\d+):(\d{1,2})$/);
  if (match) {
    return parseInt(match[1]) * 60 + parseInt(match[2]);
  }
  const minMatch = timeStr.match(/^(\d+)\s*min/i);
  if (minMatch) {
    return parseInt(minMatch[1]) * 60;
  }
  return undefined;
}
