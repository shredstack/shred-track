// ---------------------------------------------------------------------------
// HYROX Static Data — divisions, station specs, and reference times
// ---------------------------------------------------------------------------

export type Gender = "women" | "men";
export type Tier = "open" | "pro";
export type DivisionKey = `${Gender}_${Tier}`;

export interface StationSpec {
  name: string;
  shortName: string;
  distance?: string;   // e.g. "1000m", "50m", "80m", "200m", "100m"
  reps?: number;       // e.g. 100 for wall balls
  weightKg?: number;   // total sled / sandbag / ball weight
  weightLabel?: string; // display string e.g. "2×16 kg"
  icon: string;        // lucide icon name hint
}

export interface DivisionSpec {
  label: string;
  gender: Gender;
  tier: Tier;
  stations: StationSpec[];
}

export interface ReferenceTimes {
  /** seconds per station: [pro, average, slow] */
  [stationName: string]: [number, number, number];
}

// ---------------------------------------------------------------------------
// Station order (same for every division — only weights change)
// ---------------------------------------------------------------------------
export const STATION_ORDER = [
  "SkiErg",
  "Sled Push",
  "Sled Pull",
  "Broad Jump Burpees",
  "Rowing",
  "Farmers Carry",
  "Sandbag Lunges",
  "Wall Balls",
] as const;

export type StationName = (typeof STATION_ORDER)[number];

// ---------------------------------------------------------------------------
// Helper to build a full division spec
// ---------------------------------------------------------------------------
function mkStation(
  name: StationName,
  opts: Partial<Pick<StationSpec, "distance" | "reps" | "weightKg" | "weightLabel">>
): StationSpec {
  const shortNames: Record<StationName, string> = {
    SkiErg: "SkiErg",
    "Sled Push": "Sled Push",
    "Sled Pull": "Sled Pull",
    "Broad Jump Burpees": "BBJ",
    Rowing: "Row",
    "Farmers Carry": "Farmers",
    "Sandbag Lunges": "Lunges",
    "Wall Balls": "Wall Balls",
  };
  const icons: Record<StationName, string> = {
    SkiErg: "wind",
    "Sled Push": "move-horizontal",
    "Sled Pull": "cable",
    "Broad Jump Burpees": "arrow-up",
    Rowing: "waves",
    "Farmers Carry": "dumbbell",
    "Sandbag Lunges": "footprints",
    "Wall Balls": "circle-dot",
  };
  return { name, shortName: shortNames[name], icon: icons[name], ...opts };
}

// ---------------------------------------------------------------------------
// Division definitions
// ---------------------------------------------------------------------------
function buildDivision(
  gender: Gender,
  tier: Tier,
  weights: {
    sledPush: number;
    sledPull: number;
    farmersEach: number;
    sandbag: number;
    wallBall: number;
  }
): DivisionSpec {
  const label = `${gender === "women" ? "Women" : "Men"} ${tier === "open" ? "Open" : "Pro"}`;
  return {
    label,
    gender,
    tier,
    stations: [
      mkStation("SkiErg", { distance: "1000m" }),
      mkStation("Sled Push", { distance: "50m", weightKg: weights.sledPush, weightLabel: `${weights.sledPush} kg` }),
      mkStation("Sled Pull", { distance: "50m", weightKg: weights.sledPull, weightLabel: `${weights.sledPull} kg` }),
      mkStation("Broad Jump Burpees", { distance: "80m" }),
      mkStation("Rowing", { distance: "1000m" }),
      mkStation("Farmers Carry", { distance: "200m", weightKg: weights.farmersEach * 2, weightLabel: `2×${weights.farmersEach} kg` }),
      mkStation("Sandbag Lunges", { distance: "100m", weightKg: weights.sandbag, weightLabel: `${weights.sandbag} kg` }),
      mkStation("Wall Balls", { reps: 100, weightKg: weights.wallBall, weightLabel: `${weights.wallBall} kg` }),
    ],
  };
}

export const DIVISIONS: Record<DivisionKey, DivisionSpec> = {
  women_open: buildDivision("women", "open", { sledPush: 102, sledPull: 78, farmersEach: 16, sandbag: 10, wallBall: 4 }),
  women_pro: buildDivision("women", "pro", { sledPush: 152, sledPull: 103, farmersEach: 24, sandbag: 20, wallBall: 6 }),
  men_open: buildDivision("men", "open", { sledPush: 152, sledPull: 103, farmersEach: 24, sandbag: 20, wallBall: 6 }),
  men_pro: buildDivision("men", "pro", { sledPush: 202, sledPull: 153, farmersEach: 32, sandbag: 30, wallBall: 9 }),
};

export const DIVISION_KEYS: DivisionKey[] = ["women_open", "women_pro", "men_open", "men_pro"];

// ---------------------------------------------------------------------------
// Reference times — seconds [pro, average, slow] per station per division
// For simplicity we provide Women Open explicitly and scale others.
// ---------------------------------------------------------------------------

/** Parse "m:ss" to seconds */
function ts(m: number, s: number): number {
  return m * 60 + s;
}

const WOMEN_OPEN_REFS: Record<StationName, [number, number, number]> = {
  SkiErg: [ts(3, 15), ts(5, 0), ts(7, 0)],
  "Sled Push": [ts(1, 0), ts(2, 30), ts(5, 0)],
  "Sled Pull": [ts(1, 0), ts(2, 30), ts(5, 0)],
  "Broad Jump Burpees": [ts(2, 0), ts(3, 30), ts(6, 0)],
  Rowing: [ts(3, 30), ts(4, 30), ts(6, 0)],
  "Farmers Carry": [ts(1, 15), ts(2, 0), ts(3, 30)],
  "Sandbag Lunges": [ts(2, 0), ts(3, 30), ts(6, 0)],
  "Wall Balls": [ts(2, 30), ts(4, 0), ts(7, 0)],
};

// Scale factors relative to Women Open (approximate)
const SCALE: Record<DivisionKey, number> = {
  women_open: 1.0,
  women_pro: 1.15,
  men_open: 0.9,
  men_pro: 1.05,
};

function scaleRefs(key: DivisionKey): Record<StationName, [number, number, number]> {
  const s = SCALE[key];
  const result = {} as Record<StationName, [number, number, number]>;
  for (const station of STATION_ORDER) {
    const [pro, avg, slow] = WOMEN_OPEN_REFS[station];
    result[station] = [Math.round(pro * s), Math.round(avg * s), Math.round(slow * s)];
  }
  return result;
}

export const REFERENCE_TIMES: Record<DivisionKey, Record<StationName, [number, number, number]>> = {
  women_open: WOMEN_OPEN_REFS,
  women_pro: scaleRefs("women_pro"),
  men_open: scaleRefs("men_open"),
  men_pro: scaleRefs("men_pro"),
};

// ---------------------------------------------------------------------------
// Running reference (8 × 1 km runs between stations)
// ---------------------------------------------------------------------------
export const RUN_SEGMENTS = 8;
export const RUN_DISTANCE_KM = 1; // each segment

/** Reference 1 km run splits in seconds [pro, average, slow] */
export const RUN_REFERENCE: Record<DivisionKey, [number, number, number]> = {
  women_open: [ts(4, 30), ts(5, 30), ts(7, 0)],
  women_pro: [ts(4, 0), ts(5, 0), ts(6, 30)],
  men_open: [ts(3, 45), ts(5, 0), ts(6, 30)],
  men_pro: [ts(3, 30), ts(4, 30), ts(6, 0)],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format seconds to MM:SS */
export function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Format seconds to H:MM:SS */
export function formatLongTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/** Parse MM:SS or M:SS string to seconds, returns NaN on bad input */
export function parseTimeToSeconds(str: string): number {
  const parts = str.split(":");
  if (parts.length !== 2) return NaN;
  const m = parseInt(parts[0], 10);
  const s = parseInt(parts[1], 10);
  if (isNaN(m) || isNaN(s) || s < 0 || s >= 60) return NaN;
  return m * 60 + s;
}

/** Parse HH:MM:SS to seconds */
export function parseLongTimeToSeconds(str: string): number {
  const parts = str.split(":");
  if (parts.length !== 3) return NaN;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const s = parseInt(parts[2], 10);
  if (isNaN(h) || isNaN(m) || isNaN(s)) return NaN;
  return h * 3600 + m * 60 + s;
}

/** Convert kg to lbs */
export function kgToLbs(kg: number): number {
  return Math.round(kg * 2.20462);
}

/** Convert meters to feet */
export function metersToFeet(m: number): number {
  return Math.round(m * 3.28084);
}

/** Confidence labels */
export const CONFIDENCE_LABELS: Record<number, string> = {
  1: "Struggling",
  2: "Needs work",
  3: "Decent",
  4: "Strong",
  5: "Crushing it",
};
