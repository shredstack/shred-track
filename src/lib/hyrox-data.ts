// ---------------------------------------------------------------------------
// HYROX Static Data — divisions, station specs, and reference times
// ---------------------------------------------------------------------------

export type Gender = "women" | "men";
export type Tier = "open" | "pro";

// Original 4 singles division keys
export type SinglesDivisionKey = `${Gender}_${Tier}`;

// All division keys in the app
export type DivisionKey =
  | SinglesDivisionKey
  // Elite 15
  | "elite_15_women" | "elite_15_men"
  // Doubles
  | "doubles_women_open" | "doubles_men_open" | "doubles_mixed_open"
  | "doubles_women_pro" | "doubles_men_pro" | "doubles_mixed_pro"
  // Elite 15 Doubles
  | "elite_15_doubles_women" | "elite_15_doubles_men" | "elite_15_doubles_mixed"
  // Relay
  | "relay_women" | "relay_men" | "relay_mixed"
  // Corporate Relay
  | "corporate_relay_women" | "corporate_relay_men" | "corporate_relay_mixed"
  // Company Challenge
  | "company_challenge_women" | "company_challenge_men" | "company_challenge_mixed"
  // Adaptive
  | "adaptive_women" | "adaptive_men"
  // Youngstars
  | "youngstars_8_9_women" | "youngstars_8_9_men"
  | "youngstars_10_11_women" | "youngstars_10_11_men"
  | "youngstars_12_13_women" | "youngstars_12_13_men"
  | "youngstars_14_15_women" | "youngstars_14_15_men";

export type DivisionCategory =
  | "single" | "elite" | "double" | "relay"
  | "corporate_relay" | "adaptive" | "youngstars";

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
  category: DivisionCategory;
  athletes: number;           // 1 for singles, 2 for doubles, 4 for relay
  formatDescription: string;  // Brief description of the format
  stations: StationSpec[];
  /** Number of run segments (8 for adults, 2-3 for younger Youngstars) */
  runSegments: number;
  /** Run distance per segment in meters */
  runDistanceM: number;
}

export interface ReferenceTimes {
  /** seconds per station: [pro, average, slow] */
  [stationName: string]: [number, number, number];
}

// ---------------------------------------------------------------------------
// Station order (standard adult format — only weights change)
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

// Youngstars have different station names for some age groups
export const YOUNGSTARS_STATION_ORDER_8_9 = [
  "SkiErg", "Sled Push", "Sled Drag", "Frogger Jumps",
  "Rowing", "Farmers Carry", "Lunges", "Wall Ball Squats",
] as const;

export const YOUNGSTARS_STATION_ORDER_10_11 = [
  "SkiErg", "Sled Push", "Sled Drag", "Broad Jump Burpees",
  "Rowing", "Farmers Carry", "Lunges", "Wall Ball Squats",
] as const;

export const YOUNGSTARS_STATION_ORDER_12_13 = [
  "SkiErg", "Sled Push", "Sled Pull", "Broad Jump Burpees",
  "Rowing", "Farmers Carry", "Sandbag Lunges", "Wall Balls",
] as const;

export const YOUNGSTARS_STATION_ORDER_14_15 = [
  "SkiErg", "Sled Push", "Sled Pull", "Broad Jump Burpees",
  "Rowing", "Farmers Carry", "Sandbag Lunges", "Wall Balls",
] as const;

// ---------------------------------------------------------------------------
// Helper to build a full station spec
// ---------------------------------------------------------------------------
function mkStation(
  name: string,
  opts: Partial<Pick<StationSpec, "distance" | "reps" | "weightKg" | "weightLabel">>
): StationSpec {
  const shortNames: Record<string, string> = {
    SkiErg: "SkiErg",
    "Sled Push": "Sled Push",
    "Sled Pull": "Sled Pull",
    "Sled Drag": "Sled Drag",
    "Broad Jump Burpees": "BBJ",
    "Frogger Jumps": "Frogger",
    Rowing: "Row",
    "Farmers Carry": "Farmers",
    "Sandbag Lunges": "Lunges",
    Lunges: "Lunges",
    "Wall Balls": "Wall Balls",
    "Wall Ball Squats": "WB Squats",
  };
  const icons: Record<string, string> = {
    SkiErg: "wind",
    "Sled Push": "move-horizontal",
    "Sled Pull": "cable",
    "Sled Drag": "cable",
    "Broad Jump Burpees": "arrow-up",
    "Frogger Jumps": "arrow-up",
    Rowing: "waves",
    "Farmers Carry": "dumbbell",
    "Sandbag Lunges": "footprints",
    Lunges: "footprints",
    "Wall Balls": "circle-dot",
    "Wall Ball Squats": "circle-dot",
  };
  return {
    name,
    shortName: shortNames[name] ?? name,
    icon: icons[name] ?? "circle",
    ...opts,
  };
}

// ---------------------------------------------------------------------------
// Standard adult stations builder (same 8 stations, different weights)
// ---------------------------------------------------------------------------
function buildAdultStations(weights: {
  sledPush: number;
  sledPull: number;
  farmersEach: number;
  sandbag: number;
  wallBall: number;
}): StationSpec[] {
  return [
    mkStation("SkiErg", { distance: "1000m" }),
    mkStation("Sled Push", { distance: "50m", weightKg: weights.sledPush, weightLabel: `${weights.sledPush} kg` }),
    mkStation("Sled Pull", { distance: "50m", weightKg: weights.sledPull, weightLabel: `${weights.sledPull} kg` }),
    mkStation("Broad Jump Burpees", { distance: "80m" }),
    mkStation("Rowing", { distance: "1000m" }),
    mkStation("Farmers Carry", { distance: "200m", weightKg: weights.farmersEach * 2, weightLabel: `2×${weights.farmersEach} kg` }),
    mkStation("Sandbag Lunges", { distance: "100m", weightKg: weights.sandbag, weightLabel: `${weights.sandbag} kg` }),
    mkStation("Wall Balls", { reps: 100, weightKg: weights.wallBall, weightLabel: `${weights.wallBall} kg` }),
  ];
}

// Weight presets
const OPEN_WOMEN_WEIGHTS  = { sledPush: 102, sledPull: 78,  farmersEach: 16, sandbag: 10, wallBall: 4 };
const OPEN_MEN_WEIGHTS    = { sledPush: 152, sledPull: 103, farmersEach: 24, sandbag: 20, wallBall: 6 };
const PRO_WOMEN_WEIGHTS   = { sledPush: 152, sledPull: 103, farmersEach: 24, sandbag: 20, wallBall: 6 };
const PRO_MEN_WEIGHTS     = { sledPush: 202, sledPull: 153, farmersEach: 32, sandbag: 30, wallBall: 9 };

// ---------------------------------------------------------------------------
// Division definitions — ALL divisions
// ---------------------------------------------------------------------------
export const DIVISIONS: Record<DivisionKey, DivisionSpec> = {
  // === Singles ===
  women_open: {
    label: "Women Open", category: "single", athletes: 1,
    formatDescription: "8 × (1 km run + station)",
    stations: buildAdultStations(OPEN_WOMEN_WEIGHTS), runSegments: 8, runDistanceM: 1000,
  },
  women_pro: {
    label: "Women Pro", category: "single", athletes: 1,
    formatDescription: "8 × (1 km run + station)",
    stations: buildAdultStations(PRO_WOMEN_WEIGHTS), runSegments: 8, runDistanceM: 1000,
  },
  men_open: {
    label: "Men Open", category: "single", athletes: 1,
    formatDescription: "8 × (1 km run + station)",
    stations: buildAdultStations(OPEN_MEN_WEIGHTS), runSegments: 8, runDistanceM: 1000,
  },
  men_pro: {
    label: "Men Pro", category: "single", athletes: 1,
    formatDescription: "8 × (1 km run + station)",
    stations: buildAdultStations(PRO_MEN_WEIGHTS), runSegments: 8, runDistanceM: 1000,
  },

  // === Elite 15 (same weights as Pro, invitational) ===
  elite_15_women: {
    label: "Women Elite 15", category: "elite", athletes: 1,
    formatDescription: "8 × (1 km run + station) — top 15 invitational, Pro weights",
    stations: buildAdultStations(PRO_WOMEN_WEIGHTS), runSegments: 8, runDistanceM: 1000,
  },
  elite_15_men: {
    label: "Men Elite 15", category: "elite", athletes: 1,
    formatDescription: "8 × (1 km run + station) — top 15 invitational, Pro weights",
    stations: buildAdultStations(PRO_MEN_WEIGHTS), runSegments: 8, runDistanceM: 1000,
  },

  // === Doubles Open ===
  doubles_women_open: {
    label: "Women Doubles Open", category: "double", athletes: 2,
    formatDescription: "Both athletes run together, split station work — Open weights",
    stations: buildAdultStations(OPEN_WOMEN_WEIGHTS), runSegments: 8, runDistanceM: 1000,
  },
  doubles_men_open: {
    label: "Men Doubles Open", category: "double", athletes: 2,
    formatDescription: "Both athletes run together, split station work — Open weights",
    stations: buildAdultStations(OPEN_MEN_WEIGHTS), runSegments: 8, runDistanceM: 1000,
  },
  doubles_mixed_open: {
    label: "Mixed Doubles Open", category: "double", athletes: 2,
    formatDescription: "Both athletes run together, split station work — Open men weights",
    stations: buildAdultStations(OPEN_MEN_WEIGHTS), runSegments: 8, runDistanceM: 1000,
  },

  // === Doubles Pro ===
  doubles_women_pro: {
    label: "Women Doubles Pro", category: "double", athletes: 2,
    formatDescription: "Both athletes run together, split station work — Pro weights",
    stations: buildAdultStations(PRO_WOMEN_WEIGHTS), runSegments: 8, runDistanceM: 1000,
  },
  doubles_men_pro: {
    label: "Men Doubles Pro", category: "double", athletes: 2,
    formatDescription: "Both athletes run together, split station work — Pro weights",
    stations: buildAdultStations(PRO_MEN_WEIGHTS), runSegments: 8, runDistanceM: 1000,
  },
  doubles_mixed_pro: {
    label: "Mixed Doubles Pro", category: "double", athletes: 2,
    formatDescription: "Both athletes run together, split station work — Pro men weights",
    stations: buildAdultStations(PRO_MEN_WEIGHTS), runSegments: 8, runDistanceM: 1000,
  },

  // === Elite 15 Doubles ===
  elite_15_doubles_women: {
    label: "Women Elite 15 Doubles", category: "elite", athletes: 2,
    formatDescription: "Doubles format, Pro weights, invitational",
    stations: buildAdultStations(PRO_WOMEN_WEIGHTS), runSegments: 8, runDistanceM: 1000,
  },
  elite_15_doubles_men: {
    label: "Men Elite 15 Doubles", category: "elite", athletes: 2,
    formatDescription: "Doubles format, Pro weights, invitational",
    stations: buildAdultStations(PRO_MEN_WEIGHTS), runSegments: 8, runDistanceM: 1000,
  },
  elite_15_doubles_mixed: {
    label: "Mixed Elite 15 Doubles", category: "elite", athletes: 2,
    formatDescription: "Doubles format, Pro men weights, invitational",
    stations: buildAdultStations(PRO_MEN_WEIGHTS), runSegments: 8, runDistanceM: 1000,
  },

  // === Team Relay ===
  relay_women: {
    label: "Women Relay", category: "relay", athletes: 4,
    formatDescription: "4 athletes, each does 2 blocks (1 km run + 1 station)",
    stations: buildAdultStations(OPEN_WOMEN_WEIGHTS), runSegments: 8, runDistanceM: 1000,
  },
  relay_men: {
    label: "Men Relay", category: "relay", athletes: 4,
    formatDescription: "4 athletes, each does 2 blocks (1 km run + 1 station)",
    stations: buildAdultStations(OPEN_MEN_WEIGHTS), runSegments: 8, runDistanceM: 1000,
  },
  relay_mixed: {
    label: "Mixed Relay", category: "relay", athletes: 4,
    formatDescription: "4 athletes, each does 2 blocks (1 km run + 1 station)",
    stations: buildAdultStations(OPEN_MEN_WEIGHTS), runSegments: 8, runDistanceM: 1000,
  },

  // === Corporate Relay ===
  corporate_relay_women: {
    label: "Women Corporate Relay", category: "corporate_relay", athletes: 4,
    formatDescription: "4 athletes, each does 2 blocks — Open weights",
    stations: buildAdultStations(OPEN_WOMEN_WEIGHTS), runSegments: 8, runDistanceM: 1000,
  },
  corporate_relay_men: {
    label: "Men Corporate Relay", category: "corporate_relay", athletes: 4,
    formatDescription: "4 athletes, each does 2 blocks — Open weights",
    stations: buildAdultStations(OPEN_MEN_WEIGHTS), runSegments: 8, runDistanceM: 1000,
  },
  corporate_relay_mixed: {
    label: "Mixed Corporate Relay", category: "corporate_relay", athletes: 4,
    formatDescription: "4 athletes, each does 2 blocks — Open weights",
    stations: buildAdultStations(OPEN_MEN_WEIGHTS), runSegments: 8, runDistanceM: 1000,
  },

  // === Company Challenge (same format as corporate relay) ===
  company_challenge_women: {
    label: "Women Company Challenge", category: "corporate_relay", athletes: 4,
    formatDescription: "4 athletes, each does 2 blocks — Open weights",
    stations: buildAdultStations(OPEN_WOMEN_WEIGHTS), runSegments: 8, runDistanceM: 1000,
  },
  company_challenge_men: {
    label: "Men Company Challenge", category: "corporate_relay", athletes: 4,
    formatDescription: "4 athletes, each does 2 blocks — Open weights",
    stations: buildAdultStations(OPEN_MEN_WEIGHTS), runSegments: 8, runDistanceM: 1000,
  },
  company_challenge_mixed: {
    label: "Mixed Company Challenge", category: "corporate_relay", athletes: 4,
    formatDescription: "4 athletes, each does 2 blocks — Open weights",
    stations: buildAdultStations(OPEN_MEN_WEIGHTS), runSegments: 8, runDistanceM: 1000,
  },

  // === Adaptive (Open weights, movement modifications not weight changes) ===
  adaptive_women: {
    label: "Women Adaptive", category: "adaptive", athletes: 1,
    formatDescription: "8 × (1 km run + station) — modified movements, Open weights",
    stations: buildAdultStations(OPEN_WOMEN_WEIGHTS), runSegments: 8, runDistanceM: 1000,
  },
  adaptive_men: {
    label: "Men Adaptive", category: "adaptive", athletes: 1,
    formatDescription: "8 × (1 km run + station) — modified movements, Open weights",
    stations: buildAdultStations(OPEN_MEN_WEIGHTS), runSegments: 8, runDistanceM: 1000,
  },

  // === Youngstars 8-9 ===
  youngstars_8_9_women: {
    label: "Women Youngstars 8-9", category: "youngstars", athletes: 1,
    formatDescription: "3 runs with stations grouped between them",
    runSegments: 3, runDistanceM: 500,
    stations: [
      mkStation("SkiErg", { distance: "300m" }),
      mkStation("Sled Push", { distance: "15m" }),
      mkStation("Sled Drag", { distance: "15m" }),
      mkStation("Frogger Jumps", { distance: "20m" }),
      mkStation("Rowing", { distance: "200m" }),
      mkStation("Farmers Carry", { distance: "50m", weightKg: 11.4, weightLabel: "2×5.7 kg" }),
      mkStation("Lunges", { distance: "20m" }),
      mkStation("Wall Ball Squats", { reps: 30, weightKg: 1, weightLabel: "1 kg / 2m target" }),
    ],
  },
  youngstars_8_9_men: {
    label: "Men Youngstars 8-9", category: "youngstars", athletes: 1,
    formatDescription: "3 runs with stations grouped between them",
    runSegments: 3, runDistanceM: 500,
    stations: [
      mkStation("SkiErg", { distance: "300m" }),
      mkStation("Sled Push", { distance: "15m" }),
      mkStation("Sled Drag", { distance: "15m" }),
      mkStation("Frogger Jumps", { distance: "20m" }),
      mkStation("Rowing", { distance: "200m" }),
      mkStation("Farmers Carry", { distance: "50m", weightKg: 11.4, weightLabel: "2×5.7 kg" }),
      mkStation("Lunges", { distance: "20m" }),
      mkStation("Wall Ball Squats", { reps: 30, weightKg: 1, weightLabel: "1 kg / 2m target" }),
    ],
  },

  // === Youngstars 10-11 ===
  youngstars_10_11_women: {
    label: "Women Youngstars 10-11", category: "youngstars", athletes: 1,
    formatDescription: "3 runs with stations grouped between them",
    runSegments: 3, runDistanceM: 500,
    stations: [
      mkStation("SkiErg", { distance: "400m" }),
      mkStation("Sled Push", { distance: "15m" }),
      mkStation("Sled Drag", { distance: "15m" }),
      mkStation("Broad Jump Burpees", { distance: "20m" }),
      mkStation("Rowing", { distance: "300m" }),
      mkStation("Farmers Carry", { distance: "50m", weightKg: 11.4, weightLabel: "2×5.7 kg" }),
      mkStation("Lunges", { distance: "20m" }),
      mkStation("Wall Ball Squats", { reps: 40, weightKg: 2, weightLabel: "2 kg / 2m target" }),
    ],
  },
  youngstars_10_11_men: {
    label: "Men Youngstars 10-11", category: "youngstars", athletes: 1,
    formatDescription: "3 runs with stations grouped between them",
    runSegments: 3, runDistanceM: 500,
    stations: [
      mkStation("SkiErg", { distance: "400m" }),
      mkStation("Sled Push", { distance: "15m" }),
      mkStation("Sled Drag", { distance: "15m" }),
      mkStation("Broad Jump Burpees", { distance: "20m" }),
      mkStation("Rowing", { distance: "300m" }),
      mkStation("Farmers Carry", { distance: "50m", weightKg: 11.4, weightLabel: "2×5.7 kg" }),
      mkStation("Lunges", { distance: "20m" }),
      mkStation("Wall Ball Squats", { reps: 40, weightKg: 2, weightLabel: "2 kg / 2m target" }),
    ],
  },

  // === Youngstars 12-13 ===
  youngstars_12_13_women: {
    label: "Women Youngstars 12-13", category: "youngstars", athletes: 1,
    formatDescription: "2 runs with stations grouped between them",
    runSegments: 2, runDistanceM: 750,
    stations: [
      mkStation("SkiErg", { distance: "500m" }),
      mkStation("Sled Push", { distance: "30m" }),
      mkStation("Sled Pull", { distance: "30m" }),
      mkStation("Broad Jump Burpees", { distance: "40m" }),
      mkStation("Rowing", { distance: "400m" }),
      mkStation("Farmers Carry", { distance: "100m", weightKg: 18.2, weightLabel: "2×9.1 kg" }),
      mkStation("Sandbag Lunges", { distance: "40m" }),
      mkStation("Wall Balls", { reps: 50, weightKg: 2, weightLabel: "2 kg / 2.5m target" }),
    ],
  },
  youngstars_12_13_men: {
    label: "Men Youngstars 12-13", category: "youngstars", athletes: 1,
    formatDescription: "2 runs with stations grouped between them",
    runSegments: 2, runDistanceM: 750,
    stations: [
      mkStation("SkiErg", { distance: "500m" }),
      mkStation("Sled Push", { distance: "30m" }),
      mkStation("Sled Pull", { distance: "30m" }),
      mkStation("Broad Jump Burpees", { distance: "40m" }),
      mkStation("Rowing", { distance: "400m" }),
      mkStation("Farmers Carry", { distance: "100m", weightKg: 18.2, weightLabel: "2×9.1 kg" }),
      mkStation("Sandbag Lunges", { distance: "40m" }),
      mkStation("Wall Balls", { reps: 50, weightKg: 2, weightLabel: "2 kg / 2.5m target" }),
    ],
  },

  // === Youngstars 14-15 (near-adult format) ===
  youngstars_14_15_women: {
    label: "Women Youngstars 14-15", category: "youngstars", athletes: 1,
    formatDescription: "8 × (run + station) — near-adult format",
    runSegments: 8, runDistanceM: 1000,
    stations: [
      mkStation("SkiErg", { distance: "600m" }),
      mkStation("Sled Push", { distance: "30m" }),
      mkStation("Sled Pull", { distance: "30m" }),
      mkStation("Broad Jump Burpees", { distance: "40m" }),
      mkStation("Rowing", { distance: "500m" }),
      mkStation("Farmers Carry", { distance: "100m", weightKg: 22.8, weightLabel: "2×11.4 kg" }),
      mkStation("Sandbag Lunges", { distance: "40m" }),
      mkStation("Wall Balls", { reps: 50, weightKg: 4, weightLabel: "4 kg / 2.5m target" }),
    ],
  },
  youngstars_14_15_men: {
    label: "Men Youngstars 14-15", category: "youngstars", athletes: 1,
    formatDescription: "8 × (run + station) — near-adult format",
    runSegments: 8, runDistanceM: 1000,
    stations: [
      mkStation("SkiErg", { distance: "600m" }),
      mkStation("Sled Push", { distance: "30m" }),
      mkStation("Sled Pull", { distance: "30m" }),
      mkStation("Broad Jump Burpees", { distance: "40m" }),
      mkStation("Rowing", { distance: "500m" }),
      mkStation("Farmers Carry", { distance: "100m", weightKg: 22.8, weightLabel: "2×11.4 kg" }),
      mkStation("Sandbag Lunges", { distance: "40m" }),
      mkStation("Wall Balls", { reps: 50, weightKg: 4, weightLabel: "4 kg / 2.5m target" }),
    ],
  },
};

// ---------------------------------------------------------------------------
// Division key arrays for different use cases
// ---------------------------------------------------------------------------

/** Original 4 singles — used by training plans that only support singles */
export const SINGLES_DIVISION_KEYS: SinglesDivisionKey[] = [
  "women_open", "women_pro", "men_open", "men_pro",
];

/** All division keys */
export const ALL_DIVISION_KEYS = Object.keys(DIVISIONS) as DivisionKey[];

/** Backwards compat: same as SINGLES_DIVISION_KEYS */
export const DIVISION_KEYS = SINGLES_DIVISION_KEYS;

// ---------------------------------------------------------------------------
// Division categories for the overview page
// ---------------------------------------------------------------------------
export interface DivisionCategoryGroup {
  label: string;
  description: string;
  keys: DivisionKey[];
}

export const DIVISION_CATEGORIES: DivisionCategoryGroup[] = [
  {
    label: "Singles",
    description: "1 athlete — 8 × (1 km run + station)",
    keys: ["women_open", "women_pro", "men_open", "men_pro"],
  },
  {
    label: "Elite 15",
    description: "Top 15 invitational — Pro weights",
    keys: ["elite_15_women", "elite_15_men"],
  },
  {
    label: "Doubles",
    description: "2 athletes run together, split station work",
    keys: [
      "doubles_women_open", "doubles_mixed_open", "doubles_men_open",
      "doubles_women_pro", "doubles_mixed_pro", "doubles_men_pro",
    ],
  },
  {
    label: "Elite 15 Doubles",
    description: "Doubles format, Pro weights, invitational",
    keys: ["elite_15_doubles_women", "elite_15_doubles_mixed", "elite_15_doubles_men"],
  },
  {
    label: "Team Relay",
    description: "4 athletes — each does 2 blocks (1 km run + 1 station)",
    keys: ["relay_women", "relay_mixed", "relay_men"],
  },
  {
    label: "Corporate Relay",
    description: "4 athletes — same as Team Relay, Open weights",
    keys: [
      "corporate_relay_women", "corporate_relay_mixed", "corporate_relay_men",
      "company_challenge_women", "company_challenge_mixed", "company_challenge_men",
    ],
  },
  {
    label: "Adaptive",
    description: "Modified movements, Open weights — 6 impairment categories",
    keys: ["adaptive_women", "adaptive_men"],
  },
  {
    label: "Youngstars",
    description: "Youth divisions with age-appropriate distances and weights",
    keys: [
      "youngstars_8_9_women", "youngstars_8_9_men",
      "youngstars_10_11_women", "youngstars_10_11_men",
      "youngstars_12_13_women", "youngstars_12_13_men",
      "youngstars_14_15_women", "youngstars_14_15_men",
    ],
  },
];

// ---------------------------------------------------------------------------
// Race-history divisions (legacy compat — maps old keys to new ones)
// ---------------------------------------------------------------------------
export type RaceDivisionKey =
  | DivisionKey
  | "mixed_doubles"
  | "women_doubles"
  | "men_doubles"
  | "relay";

export const RACE_DIVISION_LABELS: Record<RaceDivisionKey, string> = {
  // All new division keys
  ...Object.fromEntries(ALL_DIVISION_KEYS.map(k => [k, DIVISIONS[k].label])) as Record<DivisionKey, string>,
  // Legacy keys for backwards compat
  mixed_doubles: "Mixed Doubles",
  women_doubles: "Women Doubles",
  men_doubles: "Men Doubles",
  relay: "Relay",
};

export const RACE_DIVISION_KEYS: RaceDivisionKey[] = [
  ...ALL_DIVISION_KEYS,
  "mixed_doubles", "women_doubles", "men_doubles", "relay",
];

/** Whether a race division involves split station work (doubles/relay) */
export function isTeamDivision(key: RaceDivisionKey): boolean {
  const div = DIVISIONS[key as DivisionKey];
  if (div) return div.athletes > 1;
  // Legacy keys
  return key === "mixed_doubles" || key === "women_doubles" || key === "men_doubles" || key === "relay";
}

// ---------------------------------------------------------------------------
// Reference times — seconds [pro, average, slow] per station per division
// Only available for the 4 original singles divisions.
// Other divisions will build reference data from scraped results over time.
// ---------------------------------------------------------------------------

/** Parse "m:ss" to seconds */
function ts(m: number, s: number): number {
  return m * 60 + s;
}

// Women Open — 102kg sled push, 78kg sled pull, 2×16kg farmers, 10kg sandbag, 4kg wall ball
const WOMEN_OPEN_REFS: Record<StationName, [number, number, number]> = {
  SkiErg:                [ts(4, 15), ts(5,  5), ts(7,  0)],
  "Sled Push":           [ts(1, 40), ts(2, 35), ts(4, 30)],
  "Sled Pull":           [ts(3, 30), ts(5, 30), ts(7, 30)],
  "Broad Jump Burpees":  [ts(4,  0), ts(6, 15), ts(9, 30)],
  Rowing:                [ts(4,  0), ts(5,  5), ts(7,  0)],
  "Farmers Carry":       [ts(1, 15), ts(2, 10), ts(3, 30)],
  "Sandbag Lunges":      [ts(3,  0), ts(4, 45), ts(7, 30)],
  "Wall Balls":          [ts(3, 15), ts(5, 30), ts(8, 30)],
};

// Men Open — 152kg sled push, 103kg sled pull, 2×24kg farmers, 20kg sandbag, 6kg wall ball
const MEN_OPEN_REFS: Record<StationName, [number, number, number]> = {
  SkiErg:                [ts(3, 30), ts(4, 25), ts(6,  0)],
  "Sled Push":           [ts(2,  0), ts(2, 40), ts(4, 30)],
  "Sled Pull":           [ts(3, 15), ts(5, 10), ts(7, 30)],
  "Broad Jump Burpees":  [ts(3, 30), ts(5, 30), ts(8, 30)],
  Rowing:                [ts(3, 30), ts(4, 45), ts(6, 30)],
  "Farmers Carry":       [ts(1, 15), ts(2,  5), ts(3, 30)],
  "Sandbag Lunges":      [ts(3, 30), ts(5, 25), ts(8,  0)],
  "Wall Balls":          [ts(3, 30), ts(6,  0), ts(9,  0)],
};

// Women Pro — 152kg sled push, 103kg sled pull, 2×24kg farmers, 20kg sandbag, 6kg wall ball
// Same weights as Men Open but faster overall athletes
const WOMEN_PRO_REFS: Record<StationName, [number, number, number]> = {
  SkiErg:                [ts(3, 30), ts(4, 30), ts(6,  0)],
  "Sled Push":           [ts(1, 30), ts(2, 20), ts(4,  0)],
  "Sled Pull":           [ts(3,  0), ts(4, 45), ts(7,  0)],
  "Broad Jump Burpees":  [ts(3,  0), ts(5,  0), ts(7, 30)],
  Rowing:                [ts(3, 30), ts(4, 30), ts(6,  0)],
  "Farmers Carry":       [ts(1,  0), ts(1, 45), ts(3,  0)],
  "Sandbag Lunges":      [ts(2, 30), ts(4, 15), ts(6, 30)],
  "Wall Balls":          [ts(3,  0), ts(5,  0), ts(7, 30)],
};

// Men Pro — 202kg sled push, 153kg sled pull, 2×32kg farmers, 30kg sandbag, 9kg wall ball
const MEN_PRO_REFS: Record<StationName, [number, number, number]> = {
  SkiErg:                [ts(3, 10), ts(4,  0), ts(5, 30)],
  "Sled Push":           [ts(2,  0), ts(3,  0), ts(5,  0)],
  "Sled Pull":           [ts(3, 30), ts(5, 30), ts(8,  0)],
  "Broad Jump Burpees":  [ts(3,  0), ts(4, 45), ts(7,  0)],
  Rowing:                [ts(3, 15), ts(4, 15), ts(5, 45)],
  "Farmers Carry":       [ts(1, 15), ts(2, 15), ts(3, 45)],
  "Sandbag Lunges":      [ts(3, 15), ts(5, 30), ts(8, 30)],
  "Wall Balls":          [ts(3, 30), ts(6, 15), ts(9, 30)],
};

export const REFERENCE_TIMES: Partial<Record<DivisionKey, Record<StationName, [number, number, number]>>> = {
  women_open: WOMEN_OPEN_REFS,
  women_pro: WOMEN_PRO_REFS,
  men_open: MEN_OPEN_REFS,
  men_pro: MEN_PRO_REFS,
};

// ---------------------------------------------------------------------------
// Running reference (8 × 1 km runs between stations)
// ---------------------------------------------------------------------------
export const RUN_SEGMENTS = 8;
export const RUN_DISTANCE_KM = 1; // each segment

/** Reference 1 km run splits in seconds [pro, average, slow] */
export const RUN_REFERENCE: Partial<Record<DivisionKey, [number, number, number]>> = {
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
