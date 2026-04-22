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
  // Adaptive (13 subdivisions × 2 genders)
  | "adaptive_ll_minor_women" | "adaptive_ll_minor_men"
  | "adaptive_ll_major_women" | "adaptive_ll_major_men"
  | "adaptive_ul_minor_women" | "adaptive_ul_minor_men"
  | "adaptive_ul_major_women" | "adaptive_ul_major_men"
  | "adaptive_short_stature_women" | "adaptive_short_stature_men"
  | "adaptive_visual_women" | "adaptive_visual_men"
  | "adaptive_deaf_women" | "adaptive_deaf_men"
  | "adaptive_neuro_minor_women" | "adaptive_neuro_minor_men"
  | "adaptive_neuro_moderate_women" | "adaptive_neuro_moderate_men"
  | "adaptive_neuro_major_women" | "adaptive_neuro_major_men"
  | "adaptive_swhf_women" | "adaptive_swhf_men"
  | "adaptive_swohf_women" | "adaptive_swohf_men"
  | "adaptive_swoc_women" | "adaptive_swoc_men"
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
  adaptation?: string; // movement adaptation for adaptive divisions
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
  "Burpee Broad Jumps",
  "Rowing",
  "Farmers Carry",
  "Sandbag Lunges",
  "Wall Balls",
] as const;

export type StationName = (typeof STATION_ORDER)[number];

/**
 * How to display pace for each station type.
 * - "per500m": show pace/500m (SkiErg, Rowing — matches machine display)
 * - "perRep": show seconds/rep (Wall Balls)
 * - "total": just show total time (Sled Push/Pull, BBJ, Farmers, Lunges — short or bodyweight)
 */
export type StationPaceType = "per500m" | "perRep" | "total";

export const STATION_PACE_TYPE: Record<string, StationPaceType> = {
  SkiErg: "per500m",
  "Sled Push": "total",
  "Sled Pull": "total",
  "Burpee Broad Jumps": "total",
  Rowing: "per500m",
  "Farmers Carry": "total",
  "Sandbag Lunges": "total",
  "Wall Balls": "perRep",
  // Youngstars variants
  "Sled Drag": "total",
  "Frogger Jumps": "total",
  Lunges: "total",
  "Wall Ball Squats": "perRep",
};

/**
 * Format a meaningful pace string for a station given its total time in seconds.
 * Returns null if pace display doesn't add value (i.e. "total" type — same as the time).
 */
export function formatStationPace(
  stationName: string,
  totalSeconds: number,
  distanceM?: number,
  reps?: number,
): string | null {
  const paceType = STATION_PACE_TYPE[stationName] ?? "total";

  if (paceType === "per500m" && distanceM && distanceM > 0) {
    const pacePer500 = (totalSeconds / distanceM) * 500;
    const m = Math.floor(pacePer500 / 60);
    const s = Math.round(pacePer500 % 60);
    return `${m}:${s.toString().padStart(2, "0")}/500m`;
  }

  if (paceType === "perRep" && reps && reps > 0) {
    const secPerRep = totalSeconds / reps;
    return `${secPerRep.toFixed(1)}s/rep`;
  }

  // "total" type — no separate pace to show
  return null;
}

// Youngstars have different station names for some age groups
export const YOUNGSTARS_STATION_ORDER_8_9 = [
  "SkiErg", "Sled Push", "Sled Drag", "Frogger Jumps",
  "Rowing", "Farmers Carry", "Lunges", "Wall Ball Squats",
] as const;

export const YOUNGSTARS_STATION_ORDER_10_11 = [
  "SkiErg", "Sled Push", "Sled Drag", "Burpee Broad Jumps",
  "Rowing", "Farmers Carry", "Lunges", "Wall Ball Squats",
] as const;

export const YOUNGSTARS_STATION_ORDER_12_13 = [
  "SkiErg", "Sled Push", "Sled Pull", "Burpee Broad Jumps",
  "Rowing", "Farmers Carry", "Sandbag Lunges", "Wall Balls",
] as const;

export const YOUNGSTARS_STATION_ORDER_14_15 = [
  "SkiErg", "Sled Push", "Sled Pull", "Burpee Broad Jumps",
  "Rowing", "Farmers Carry", "Sandbag Lunges", "Wall Balls",
] as const;

// ---------------------------------------------------------------------------
// Helper to build a full station spec
// ---------------------------------------------------------------------------
function mkStation(
  name: string,
  opts: Partial<Pick<StationSpec, "distance" | "reps" | "weightKg" | "weightLabel" | "adaptation">>
): StationSpec {
  const shortNames: Record<string, string> = {
    SkiErg: "SkiErg",
    "Sled Push": "Sled Push",
    "Sled Pull": "Sled Pull",
    "Sled Drag": "Sled Drag",
    "Burpee Broad Jumps": "BBJ",
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
    "Burpee Broad Jumps": "arrow-up",
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
    mkStation("Burpee Broad Jumps", { distance: "80m" }),
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

  // === Adaptive — Lower Limb Minor ===
  adaptive_ll_minor_women: {
    label: "Women Adaptive — Lower Limb Minor", category: "adaptive", athletes: 1,
    formatDescription: "8 × (1 km run + station) — below-knee amputation / joint instability",
    runSegments: 8, runDistanceM: 1000,
    stations: [
      mkStation("SkiErg", { distance: "1000m" }),
      mkStation("Sled Push", { distance: "50m", weightKg: 102, weightLabel: "102 kg" }),
      mkStation("Sled Pull", { distance: "25m", weightKg: 78, weightLabel: "78 kg" }),
      mkStation("Burpee Broad Jumps", { distance: "80m" }),
      mkStation("Rowing", { distance: "1000m" }),
      mkStation("Farmers Carry", { distance: "200m", weightKg: 32, weightLabel: "2×16 kg" }),
      mkStation("Sandbag Lunges", { distance: "100m", weightKg: 10, weightLabel: "10 kg" }),
      mkStation("Wall Balls", { reps: 100, weightKg: 4, weightLabel: "4 kg / 2.7m target" }),
    ],
  },
  adaptive_ll_minor_men: {
    label: "Men Adaptive — Lower Limb Minor", category: "adaptive", athletes: 1,
    formatDescription: "8 × (1 km run + station) — below-knee amputation / joint instability",
    runSegments: 8, runDistanceM: 1000,
    stations: [
      mkStation("SkiErg", { distance: "1000m" }),
      mkStation("Sled Push", { distance: "50m", weightKg: 152, weightLabel: "152 kg" }),
      mkStation("Sled Pull", { distance: "25m", weightKg: 103, weightLabel: "103 kg" }),
      mkStation("Burpee Broad Jumps", { distance: "80m" }),
      mkStation("Rowing", { distance: "1000m" }),
      mkStation("Farmers Carry", { distance: "200m", weightKg: 48, weightLabel: "2×24 kg" }),
      mkStation("Sandbag Lunges", { distance: "100m", weightKg: 20, weightLabel: "20 kg" }),
      mkStation("Wall Balls", { reps: 100, weightKg: 6, weightLabel: "6 kg / 3.0m target" }),
    ],
  },

  // === Adaptive — Lower Limb Major ===
  adaptive_ll_major_women: {
    label: "Women Adaptive — Lower Limb Major", category: "adaptive", athletes: 1,
    formatDescription: "8 × (1 km run + station) — above-knee amputation / severe mobility impairment",
    runSegments: 8, runDistanceM: 1000,
    stations: [
      mkStation("SkiErg", { distance: "1000m" }),
      mkStation("Sled Push", { distance: "25m", weightKg: 102, weightLabel: "102 kg" }),
      mkStation("Sled Pull", { distance: "25m", weightKg: 53, weightLabel: "53 kg" }),
      mkStation("Burpee Broad Jumps", { distance: "40m", adaptation: "Adapted: walkouts + crutch steps" }),
      mkStation("Rowing", { distance: "1000m" }),
      mkStation("Farmers Carry", { distance: "200m", weightKg: 24, weightLabel: "2×12 kg" }),
      mkStation("Sandbag Lunges", { distance: "100m", weightKg: 5, weightLabel: "5 kg" }),
      mkStation("Wall Balls", { reps: 100, weightKg: 2, weightLabel: "2 kg / 2.7m target" }),
    ],
  },
  adaptive_ll_major_men: {
    label: "Men Adaptive — Lower Limb Major", category: "adaptive", athletes: 1,
    formatDescription: "8 × (1 km run + station) — above-knee amputation / severe mobility impairment",
    runSegments: 8, runDistanceM: 1000,
    stations: [
      mkStation("SkiErg", { distance: "1000m" }),
      mkStation("Sled Push", { distance: "25m", weightKg: 152, weightLabel: "152 kg" }),
      mkStation("Sled Pull", { distance: "25m", weightKg: 78, weightLabel: "78 kg" }),
      mkStation("Burpee Broad Jumps", { distance: "40m", adaptation: "Adapted: walkouts + crutch steps" }),
      mkStation("Rowing", { distance: "1000m" }),
      mkStation("Farmers Carry", { distance: "200m", weightKg: 32, weightLabel: "2×16 kg" }),
      mkStation("Sandbag Lunges", { distance: "100m", weightKg: 10, weightLabel: "10 kg" }),
      mkStation("Wall Balls", { reps: 100, weightKg: 4, weightLabel: "4 kg / 3.0m target" }),
    ],
  },

  // === Adaptive — Upper Limb Minor ===
  adaptive_ul_minor_women: {
    label: "Women Adaptive — Upper Limb Minor", category: "adaptive", athletes: 1,
    formatDescription: "8 × (1 km run + station) — below-elbow / partial upper limb loss",
    runSegments: 8, runDistanceM: 1000,
    stations: [
      mkStation("SkiErg", { distance: "1000m" }),
      mkStation("Sled Push", { distance: "50m", weightKg: 102, weightLabel: "102 kg" }),
      mkStation("Sled Pull", { distance: "25m", weightKg: 78, weightLabel: "78 kg" }),
      mkStation("Burpee Broad Jumps", { distance: "80m" }),
      mkStation("Rowing", { distance: "1000m" }),
      mkStation("Farmers Carry", { distance: "200m", weightKg: 16, weightLabel: "1×16 kg" }),
      mkStation("Sandbag Lunges", { distance: "100m", weightKg: 10, weightLabel: "10 kg" }),
      mkStation("Wall Balls", { reps: 100, weightKg: 2, weightLabel: "2 kg / 2.7m target" }),
    ],
  },
  adaptive_ul_minor_men: {
    label: "Men Adaptive — Upper Limb Minor", category: "adaptive", athletes: 1,
    formatDescription: "8 × (1 km run + station) — below-elbow / partial upper limb loss",
    runSegments: 8, runDistanceM: 1000,
    stations: [
      mkStation("SkiErg", { distance: "1000m" }),
      mkStation("Sled Push", { distance: "50m", weightKg: 152, weightLabel: "152 kg" }),
      mkStation("Sled Pull", { distance: "25m", weightKg: 103, weightLabel: "103 kg" }),
      mkStation("Burpee Broad Jumps", { distance: "80m" }),
      mkStation("Rowing", { distance: "1000m" }),
      mkStation("Farmers Carry", { distance: "200m", weightKg: 24, weightLabel: "1×24 kg" }),
      mkStation("Sandbag Lunges", { distance: "100m", weightKg: 20, weightLabel: "20 kg" }),
      mkStation("Wall Balls", { reps: 100, weightKg: 4, weightLabel: "4 kg / 3.0m target" }),
    ],
  },

  // === Adaptive — Upper Limb Major ===
  adaptive_ul_major_women: {
    label: "Women Adaptive — Upper Limb Major", category: "adaptive", athletes: 1,
    formatDescription: "8 × (750m run + station) — above-elbow / major upper limb loss",
    runSegments: 8, runDistanceM: 750,
    stations: [
      mkStation("SkiErg", { distance: "750m" }),
      mkStation("Sled Push", { distance: "25m", weightKg: 102, weightLabel: "102 kg" }),
      mkStation("Sled Pull", { distance: "25m", weightKg: 53, weightLabel: "53 kg" }),
      mkStation("Burpee Broad Jumps", { distance: "80m" }),
      mkStation("Rowing", { distance: "750m" }),
      mkStation("Farmers Carry", { distance: "200m", weightKg: 12, weightLabel: "1×12 kg" }),
      mkStation("Sandbag Lunges", { distance: "100m", weightKg: 10, weightLabel: "10 kg" }),
      mkStation("Wall Balls", { reps: 100, weightKg: 2, weightLabel: "2 kg / 2.7m target" }),
    ],
  },
  adaptive_ul_major_men: {
    label: "Men Adaptive — Upper Limb Major", category: "adaptive", athletes: 1,
    formatDescription: "8 × (750m run + station) — above-elbow / major upper limb loss",
    runSegments: 8, runDistanceM: 750,
    stations: [
      mkStation("SkiErg", { distance: "750m" }),
      mkStation("Sled Push", { distance: "25m", weightKg: 152, weightLabel: "152 kg" }),
      mkStation("Sled Pull", { distance: "25m", weightKg: 78, weightLabel: "78 kg" }),
      mkStation("Burpee Broad Jumps", { distance: "80m" }),
      mkStation("Rowing", { distance: "750m" }),
      mkStation("Farmers Carry", { distance: "200m", weightKg: 16, weightLabel: "1×16 kg" }),
      mkStation("Sandbag Lunges", { distance: "100m", weightKg: 20, weightLabel: "20 kg" }),
      mkStation("Wall Balls", { reps: 100, weightKg: 4, weightLabel: "4 kg / 3.0m target" }),
    ],
  },

  // === Adaptive — Short Stature ===
  adaptive_short_stature_women: {
    label: "Women Adaptive — Short Stature", category: "adaptive", athletes: 1,
    formatDescription: "8 × (500m run + station) — skeletal dysplasia / growth conditions",
    runSegments: 8, runDistanceM: 500,
    stations: [
      mkStation("SkiErg", { distance: "500m" }),
      mkStation("Sled Push", { distance: "25m", weightKg: 77, weightLabel: "77 kg" }),
      mkStation("Sled Pull", { distance: "25m", weightKg: 53, weightLabel: "53 kg" }),
      mkStation("Burpee Broad Jumps", { distance: "40m" }),
      mkStation("Rowing", { distance: "500m" }),
      mkStation("Farmers Carry", { distance: "200m", weightKg: 24, weightLabel: "2×12 kg" }),
      mkStation("Sandbag Lunges", { distance: "100m", weightKg: 5, weightLabel: "5 kg" }),
      mkStation("Wall Balls", { reps: 50, weightKg: 2, weightLabel: "2 kg / 2.0m target" }),
    ],
  },
  adaptive_short_stature_men: {
    label: "Men Adaptive — Short Stature", category: "adaptive", athletes: 1,
    formatDescription: "8 × (500m run + station) — skeletal dysplasia / growth conditions",
    runSegments: 8, runDistanceM: 500,
    stations: [
      mkStation("SkiErg", { distance: "500m" }),
      mkStation("Sled Push", { distance: "25m", weightKg: 102, weightLabel: "102 kg" }),
      mkStation("Sled Pull", { distance: "25m", weightKg: 78, weightLabel: "78 kg" }),
      mkStation("Burpee Broad Jumps", { distance: "40m" }),
      mkStation("Rowing", { distance: "500m" }),
      mkStation("Farmers Carry", { distance: "200m", weightKg: 32, weightLabel: "2×16 kg" }),
      mkStation("Sandbag Lunges", { distance: "100m", weightKg: 10, weightLabel: "10 kg" }),
      mkStation("Wall Balls", { reps: 50, weightKg: 4, weightLabel: "4 kg / 2.2m target" }),
    ],
  },

  // === Adaptive — Visual Impairment ===
  adaptive_visual_women: {
    label: "Women Adaptive — Visual Impairment", category: "adaptive", athletes: 1,
    formatDescription: "8 × (1 km run + station) — partial or complete vision loss, guide runner",
    runSegments: 8, runDistanceM: 1000,
    stations: [
      mkStation("SkiErg", { distance: "1000m" }),
      mkStation("Sled Push", { distance: "50m", weightKg: 102, weightLabel: "102 kg" }),
      mkStation("Sled Pull", { distance: "50m", weightKg: 78, weightLabel: "78 kg" }),
      mkStation("Burpee Broad Jumps", { distance: "80m" }),
      mkStation("Rowing", { distance: "1000m" }),
      mkStation("Farmers Carry", { distance: "200m", weightKg: 32, weightLabel: "2×16 kg" }),
      mkStation("Sandbag Lunges", { distance: "100m", weightKg: 10, weightLabel: "10 kg" }),
      mkStation("Wall Balls", { reps: 100, weightKg: 4, weightLabel: "4 kg / 2.7m target" }),
    ],
  },
  adaptive_visual_men: {
    label: "Men Adaptive — Visual Impairment", category: "adaptive", athletes: 1,
    formatDescription: "8 × (1 km run + station) — partial or complete vision loss, guide runner",
    runSegments: 8, runDistanceM: 1000,
    stations: [
      mkStation("SkiErg", { distance: "1000m" }),
      mkStation("Sled Push", { distance: "50m", weightKg: 152, weightLabel: "152 kg" }),
      mkStation("Sled Pull", { distance: "50m", weightKg: 103, weightLabel: "103 kg" }),
      mkStation("Burpee Broad Jumps", { distance: "80m" }),
      mkStation("Rowing", { distance: "1000m" }),
      mkStation("Farmers Carry", { distance: "200m", weightKg: 48, weightLabel: "2×24 kg" }),
      mkStation("Sandbag Lunges", { distance: "100m", weightKg: 20, weightLabel: "20 kg" }),
      mkStation("Wall Balls", { reps: 100, weightKg: 6, weightLabel: "6 kg / 3.0m target" }),
    ],
  },

  // === Adaptive — Deaf or Hard of Hearing ===
  adaptive_deaf_women: {
    label: "Women Adaptive — Deaf / Hard of Hearing", category: "adaptive", athletes: 1,
    formatDescription: "8 × (1 km run + station) — partial or complete hearing loss",
    runSegments: 8, runDistanceM: 1000,
    stations: [
      mkStation("SkiErg", { distance: "1000m" }),
      mkStation("Sled Push", { distance: "50m", weightKg: 102, weightLabel: "102 kg" }),
      mkStation("Sled Pull", { distance: "50m", weightKg: 78, weightLabel: "78 kg" }),
      mkStation("Burpee Broad Jumps", { distance: "80m" }),
      mkStation("Rowing", { distance: "1000m" }),
      mkStation("Farmers Carry", { distance: "200m", weightKg: 32, weightLabel: "2×16 kg" }),
      mkStation("Sandbag Lunges", { distance: "100m", weightKg: 10, weightLabel: "10 kg" }),
      mkStation("Wall Balls", { reps: 100, weightKg: 4, weightLabel: "4 kg / 2.7m target" }),
    ],
  },
  adaptive_deaf_men: {
    label: "Men Adaptive — Deaf / Hard of Hearing", category: "adaptive", athletes: 1,
    formatDescription: "8 × (1 km run + station) — partial or complete hearing loss",
    runSegments: 8, runDistanceM: 1000,
    stations: [
      mkStation("SkiErg", { distance: "1000m" }),
      mkStation("Sled Push", { distance: "50m", weightKg: 152, weightLabel: "152 kg" }),
      mkStation("Sled Pull", { distance: "50m", weightKg: 103, weightLabel: "103 kg" }),
      mkStation("Burpee Broad Jumps", { distance: "80m" }),
      mkStation("Rowing", { distance: "1000m" }),
      mkStation("Farmers Carry", { distance: "200m", weightKg: 48, weightLabel: "2×24 kg" }),
      mkStation("Sandbag Lunges", { distance: "100m", weightKg: 20, weightLabel: "20 kg" }),
      mkStation("Wall Balls", { reps: 100, weightKg: 6, weightLabel: "6 kg / 3.0m target" }),
    ],
  },

  // === Adaptive — Neurological Minor ===
  adaptive_neuro_minor_women: {
    label: "Women Adaptive — Neuro Minor", category: "adaptive", athletes: 1,
    formatDescription: "8 × (1 km run + station) — mild neurological impairment, single extremity",
    runSegments: 8, runDistanceM: 1000,
    stations: [
      mkStation("SkiErg", { distance: "1000m" }),
      mkStation("Sled Push", { distance: "50m", weightKg: 77, weightLabel: "77 kg" }),
      mkStation("Sled Pull", { distance: "50m", weightKg: 53, weightLabel: "53 kg" }),
      mkStation("Burpee Broad Jumps", { distance: "80m" }),
      mkStation("Rowing", { distance: "1000m" }),
      mkStation("Farmers Carry", { distance: "200m", weightKg: 32, weightLabel: "2×16 kg" }),
      mkStation("Sandbag Lunges", { distance: "50m", weightKg: 5, weightLabel: "5 kg" }),
      mkStation("Wall Balls", { reps: 100, weightKg: 4, weightLabel: "4 kg / 2.7m target" }),
    ],
  },
  adaptive_neuro_minor_men: {
    label: "Men Adaptive — Neuro Minor", category: "adaptive", athletes: 1,
    formatDescription: "8 × (1 km run + station) — mild neurological impairment, single extremity",
    runSegments: 8, runDistanceM: 1000,
    stations: [
      mkStation("SkiErg", { distance: "1000m" }),
      mkStation("Sled Push", { distance: "50m", weightKg: 102, weightLabel: "102 kg" }),
      mkStation("Sled Pull", { distance: "50m", weightKg: 78, weightLabel: "78 kg" }),
      mkStation("Burpee Broad Jumps", { distance: "80m" }),
      mkStation("Rowing", { distance: "1000m" }),
      mkStation("Farmers Carry", { distance: "200m", weightKg: 48, weightLabel: "2×24 kg" }),
      mkStation("Sandbag Lunges", { distance: "50m", weightKg: 10, weightLabel: "10 kg" }),
      mkStation("Wall Balls", { reps: 100, weightKg: 6, weightLabel: "6 kg / 3.0m target" }),
    ],
  },

  // === Adaptive — Neurological Moderate ===
  adaptive_neuro_moderate_women: {
    label: "Women Adaptive — Neuro Moderate", category: "adaptive", athletes: 1,
    formatDescription: "8 × (750m run + station) — moderate neurological impairment, hemiplegia",
    runSegments: 8, runDistanceM: 750,
    stations: [
      mkStation("SkiErg", { distance: "750m" }),
      mkStation("Sled Push", { distance: "25m", weightKg: 77, weightLabel: "77 kg" }),
      mkStation("Sled Pull", { distance: "25m", weightKg: 25, weightLabel: "25 kg (sled only)" }),
      mkStation("Burpee Broad Jumps", { distance: "80m" }),
      mkStation("Rowing", { distance: "750m" }),
      mkStation("Farmers Carry", { distance: "200m", weightKg: 24, weightLabel: "2×12 kg" }),
      mkStation("Sandbag Lunges", { distance: "50m", weightKg: 5, weightLabel: "5 kg" }),
      mkStation("Wall Balls", { reps: 100, weightKg: 4, weightLabel: "4 kg / 2.7m target" }),
    ],
  },
  adaptive_neuro_moderate_men: {
    label: "Men Adaptive — Neuro Moderate", category: "adaptive", athletes: 1,
    formatDescription: "8 × (750m run + station) — moderate neurological impairment, hemiplegia",
    runSegments: 8, runDistanceM: 750,
    stations: [
      mkStation("SkiErg", { distance: "750m" }),
      mkStation("Sled Push", { distance: "25m", weightKg: 102, weightLabel: "102 kg" }),
      mkStation("Sled Pull", { distance: "25m", weightKg: 53, weightLabel: "53 kg" }),
      mkStation("Burpee Broad Jumps", { distance: "80m" }),
      mkStation("Rowing", { distance: "750m" }),
      mkStation("Farmers Carry", { distance: "200m", weightKg: 32, weightLabel: "2×16 kg" }),
      mkStation("Sandbag Lunges", { distance: "50m", weightKg: 10, weightLabel: "10 kg" }),
      mkStation("Wall Balls", { reps: 100, weightKg: 6, weightLabel: "6 kg / 3.0m target" }),
    ],
  },

  // === Adaptive — Neurological Major ===
  adaptive_neuro_major_women: {
    label: "Women Adaptive — Neuro Major", category: "adaptive", athletes: 1,
    formatDescription: "8 × (500m run + station) — severe neurological impairment, paraplegia",
    runSegments: 8, runDistanceM: 500,
    stations: [
      mkStation("SkiErg", { distance: "500m" }),
      mkStation("Sled Push", { distance: "25m", weightKg: 50, weightLabel: "50 kg (sled only)" }),
      mkStation("Sled Pull", { distance: "25m", weightKg: 25, weightLabel: "25 kg (sled only)" }),
      mkStation("Burpee Broad Jumps", { distance: "40m", adaptation: "Adapted: walkouts + crutch steps" }),
      mkStation("Rowing", { distance: "500m" }),
      mkStation("Farmers Carry", { distance: "100m", weightKg: 24, weightLabel: "2×12 kg" }),
      mkStation("Sandbag Lunges", { distance: "50m", weightKg: 5, weightLabel: "5 kg" }),
      mkStation("Wall Balls", { reps: 100, weightKg: 2, weightLabel: "2 kg / 2.0m target" }),
    ],
  },
  adaptive_neuro_major_men: {
    label: "Men Adaptive — Neuro Major", category: "adaptive", athletes: 1,
    formatDescription: "8 × (500m run + station) — severe neurological impairment, paraplegia",
    runSegments: 8, runDistanceM: 500,
    stations: [
      mkStation("SkiErg", { distance: "500m" }),
      mkStation("Sled Push", { distance: "25m", weightKg: 77, weightLabel: "77 kg" }),
      mkStation("Sled Pull", { distance: "25m", weightKg: 53, weightLabel: "53 kg" }),
      mkStation("Burpee Broad Jumps", { distance: "40m", adaptation: "Adapted: walkouts + crutch steps" }),
      mkStation("Rowing", { distance: "500m" }),
      mkStation("Farmers Carry", { distance: "100m", weightKg: 32, weightLabel: "2×16 kg" }),
      mkStation("Sandbag Lunges", { distance: "50m", weightKg: 10, weightLabel: "10 kg" }),
      mkStation("Wall Balls", { reps: 100, weightKg: 4, weightLabel: "4 kg / 2.2m target" }),
    ],
  },

  // === Adaptive — Seated with Hip Function (SWHF) ===
  adaptive_swhf_women: {
    label: "Women Adaptive — Seated (SWHF)", category: "adaptive", athletes: 1,
    formatDescription: "8 × (1 km push + station) — wheelchair, retains hip function",
    runSegments: 8, runDistanceM: 1000,
    stations: [
      mkStation("SkiErg", { distance: "1000m" }),
      mkStation("Sled Push", { distance: "25m", weightKg: 77, weightLabel: "77 kg", adaptation: "Sled attached to chair, athlete drags" }),
      mkStation("Sled Pull", { distance: "25m", weightKg: 78, weightLabel: "78 kg", adaptation: "Sled attached to chair, athlete drags" }),
      mkStation("Burpee Broad Jumps", { distance: "80m", adaptation: "1 Front-Chair Dip + 2 Wheel-Length Pushes" }),
      mkStation("Rowing", { distance: "1000m" }),
      mkStation("Farmers Carry", { distance: "200m", weightKg: 16, weightLabel: "1×16 kg", adaptation: "1 KB on lap" }),
      mkStation("Sandbag Lunges", { distance: "50m", weightKg: 10, weightLabel: "10 kg", adaptation: "Side Sandbag Lift & Turnaround" }),
      mkStation("Wall Balls", { reps: 85, weightKg: 2, weightLabel: "2 kg / 2.0m target", adaptation: "Seated throw from lap" }),
    ],
  },
  adaptive_swhf_men: {
    label: "Men Adaptive — Seated (SWHF)", category: "adaptive", athletes: 1,
    formatDescription: "8 × (1 km push + station) — wheelchair, retains hip function",
    runSegments: 8, runDistanceM: 1000,
    stations: [
      mkStation("SkiErg", { distance: "1000m" }),
      mkStation("Sled Push", { distance: "50m", weightKg: 77, weightLabel: "77 kg", adaptation: "Sled attached to chair, athlete drags" }),
      mkStation("Sled Pull", { distance: "50m", weightKg: 78, weightLabel: "78 kg", adaptation: "Sled attached to chair, athlete drags" }),
      mkStation("Burpee Broad Jumps", { distance: "80m", adaptation: "1 Front-Chair Dip + 2 Wheel-Length Pushes" }),
      mkStation("Rowing", { distance: "1000m" }),
      mkStation("Farmers Carry", { distance: "200m", weightKg: 24, weightLabel: "1×24 kg", adaptation: "1 KB on lap" }),
      mkStation("Sandbag Lunges", { distance: "50m", weightKg: 20, weightLabel: "20 kg", adaptation: "Side Sandbag Lift & Turnaround" }),
      mkStation("Wall Balls", { reps: 85, weightKg: 4, weightLabel: "4 kg / 2.2m target", adaptation: "Seated throw from lap" }),
    ],
  },

  // === Adaptive — Seated without Hip Function (SWOHF) ===
  adaptive_swohf_women: {
    label: "Women Adaptive — Seated (SWOHF)", category: "adaptive", athletes: 1,
    formatDescription: "8 × (750m push + station) — wheelchair, no hip function",
    runSegments: 8, runDistanceM: 750,
    stations: [
      mkStation("SkiErg", { distance: "750m" }),
      mkStation("Sled Push", { distance: "25m", weightKg: 77, weightLabel: "77 kg", adaptation: "Sled attached to chair, athlete drags" }),
      mkStation("Sled Pull", { distance: "25m", weightKg: 53, weightLabel: "53 kg", adaptation: "Sled attached to chair, athlete drags" }),
      mkStation("Burpee Broad Jumps", { distance: "80m", adaptation: "2 In-Chair Dips + 1 Wheel-Length Push" }),
      mkStation("Rowing", { distance: "750m" }),
      mkStation("Farmers Carry", { distance: "200m", weightKg: 16, weightLabel: "1×16 kg", adaptation: "1 KB on lap" }),
      mkStation("Sandbag Lunges", { distance: "50m", weightKg: 10, weightLabel: "10 kg", adaptation: "Side Sandbag Lift & Turnaround" }),
      mkStation("Wall Balls", { reps: 75, weightKg: 2, weightLabel: "2 kg / 2.0m target", adaptation: "Seated throw from lap" }),
    ],
  },
  adaptive_swohf_men: {
    label: "Men Adaptive — Seated (SWOHF)", category: "adaptive", athletes: 1,
    formatDescription: "8 × (750m push + station) — wheelchair, no hip function",
    runSegments: 8, runDistanceM: 750,
    stations: [
      mkStation("SkiErg", { distance: "750m" }),
      mkStation("Sled Push", { distance: "50m", weightKg: 77, weightLabel: "77 kg", adaptation: "Sled attached to chair, athlete drags" }),
      mkStation("Sled Pull", { distance: "50m", weightKg: 53, weightLabel: "53 kg", adaptation: "Sled attached to chair, athlete drags" }),
      mkStation("Burpee Broad Jumps", { distance: "80m", adaptation: "2 In-Chair Dips + 1 Wheel-Length Push" }),
      mkStation("Rowing", { distance: "750m" }),
      mkStation("Farmers Carry", { distance: "200m", weightKg: 24, weightLabel: "1×24 kg", adaptation: "1 KB on lap" }),
      mkStation("Sandbag Lunges", { distance: "50m", weightKg: 20, weightLabel: "20 kg", adaptation: "Side Sandbag Lift & Turnaround" }),
      mkStation("Wall Balls", { reps: 75, weightKg: 4, weightLabel: "4 kg / 2.2m target", adaptation: "Seated throw from lap" }),
    ],
  },

  // === Adaptive — Seated without Core Function (SWOC) ===
  adaptive_swoc_women: {
    label: "Women Adaptive — Seated (SWOC)", category: "adaptive", athletes: 1,
    formatDescription: "8 × (500m push + station) — wheelchair, no hip or core function",
    runSegments: 8, runDistanceM: 500,
    stations: [
      mkStation("SkiErg", { distance: "500m" }),
      mkStation("Sled Push", { distance: "25m", weightKg: 50, weightLabel: "50 kg (sled only)", adaptation: "Sled attached to chair, athlete drags" }),
      mkStation("Sled Pull", { distance: "25m", weightKg: 25, weightLabel: "25 kg (sled only)", adaptation: "Sled attached to chair, athlete drags" }),
      mkStation("Burpee Broad Jumps", { distance: "80m", adaptation: "2 In-Chair Dips + 1 Wheel-Length Push" }),
      mkStation("Rowing", { distance: "500m" }),
      mkStation("Farmers Carry", { distance: "200m", weightKg: 12, weightLabel: "1×12 kg", adaptation: "1 KB on lap" }),
      mkStation("Sandbag Lunges", { distance: "50m", weightKg: 5, weightLabel: "5 kg", adaptation: "Side Sandbag Lift & Turnaround" }),
      mkStation("Wall Balls", { reps: 65, weightKg: 2, weightLabel: "2 kg / 2.0m target", adaptation: "Seated throw from lap" }),
    ],
  },
  adaptive_swoc_men: {
    label: "Men Adaptive — Seated (SWOC)", category: "adaptive", athletes: 1,
    formatDescription: "8 × (500m push + station) — wheelchair, no hip or core function",
    runSegments: 8, runDistanceM: 500,
    stations: [
      mkStation("SkiErg", { distance: "500m" }),
      mkStation("Sled Push", { distance: "50m", weightKg: 50, weightLabel: "50 kg (sled only)", adaptation: "Sled attached to chair, athlete drags" }),
      mkStation("Sled Pull", { distance: "50m", weightKg: 25, weightLabel: "25 kg (sled only)", adaptation: "Sled attached to chair, athlete drags" }),
      mkStation("Burpee Broad Jumps", { distance: "80m", adaptation: "2 In-Chair Dips + 1 Wheel-Length Push" }),
      mkStation("Rowing", { distance: "500m" }),
      mkStation("Farmers Carry", { distance: "200m", weightKg: 16, weightLabel: "1×16 kg", adaptation: "1 KB on lap" }),
      mkStation("Sandbag Lunges", { distance: "50m", weightKg: 10, weightLabel: "10 kg", adaptation: "Side Sandbag Lift & Turnaround" }),
      mkStation("Wall Balls", { reps: 65, weightKg: 4, weightLabel: "4 kg / 2.2m target", adaptation: "Seated throw from lap" }),
    ],
  },

  // === Youngstars 8-9 (same weights for girls & boys) ===
  youngstars_8_9_women: {
    label: "Girls Youngstars 8-9", category: "youngstars", athletes: 1,
    formatDescription: "3 × 1 lap (200-275m) with 8 stations grouped between runs",
    runSegments: 3, runDistanceM: 250,
    stations: [
      mkStation("SkiErg", { distance: "300m" }),
      mkStation("Sled Push", { distance: "15m", weightKg: 35, weightLabel: "35 kg" }),
      mkStation("Sled Drag", { distance: "15m", weightKg: 25, weightLabel: "25 kg" }),
      mkStation("Frogger Jumps", { distance: "20m" }),
      mkStation("Rowing", { distance: "200m" }),
      mkStation("Farmers Carry", { distance: "50m", weightKg: 8, weightLabel: "2×4 kg" }),
      mkStation("Lunges", { distance: "20m" }),
      mkStation("Wall Ball Squats", { reps: 50, weightKg: 1, weightLabel: "1 kg ball" }),
    ],
  },
  youngstars_8_9_men: {
    label: "Boys Youngstars 8-9", category: "youngstars", athletes: 1,
    formatDescription: "3 × 1 lap (200-275m) with 8 stations grouped between runs",
    runSegments: 3, runDistanceM: 250,
    stations: [
      mkStation("SkiErg", { distance: "300m" }),
      mkStation("Sled Push", { distance: "15m", weightKg: 35, weightLabel: "35 kg" }),
      mkStation("Sled Drag", { distance: "15m", weightKg: 25, weightLabel: "25 kg" }),
      mkStation("Frogger Jumps", { distance: "20m" }),
      mkStation("Rowing", { distance: "200m" }),
      mkStation("Farmers Carry", { distance: "50m", weightKg: 8, weightLabel: "2×4 kg" }),
      mkStation("Lunges", { distance: "20m" }),
      mkStation("Wall Ball Squats", { reps: 50, weightKg: 1, weightLabel: "1 kg ball" }),
    ],
  },

  // === Youngstars 10-11 (same weights for girls & boys) ===
  youngstars_10_11_women: {
    label: "Girls Youngstars 10-11", category: "youngstars", athletes: 1,
    formatDescription: "3 × 1 lap (200-275m) with 8 stations grouped between runs",
    runSegments: 3, runDistanceM: 250,
    stations: [
      mkStation("SkiErg", { distance: "400m" }),
      mkStation("Sled Push", { distance: "15m", weightKg: 50, weightLabel: "50 kg" }),
      mkStation("Sled Drag", { distance: "15m", weightKg: 40, weightLabel: "40 kg" }),
      mkStation("Burpee Broad Jumps", { distance: "20m" }),
      mkStation("Rowing", { distance: "300m" }),
      mkStation("Farmers Carry", { distance: "50m", weightKg: 12, weightLabel: "2×6 kg" }),
      mkStation("Lunges", { distance: "20m" }),
      mkStation("Wall Ball Squats", { reps: 50, weightKg: 2, weightLabel: "2 kg ball" }),
    ],
  },
  youngstars_10_11_men: {
    label: "Boys Youngstars 10-11", category: "youngstars", athletes: 1,
    formatDescription: "3 × 1 lap (200-275m) with 8 stations grouped between runs",
    runSegments: 3, runDistanceM: 250,
    stations: [
      mkStation("SkiErg", { distance: "400m" }),
      mkStation("Sled Push", { distance: "15m", weightKg: 50, weightLabel: "50 kg" }),
      mkStation("Sled Drag", { distance: "15m", weightKg: 40, weightLabel: "40 kg" }),
      mkStation("Burpee Broad Jumps", { distance: "20m" }),
      mkStation("Rowing", { distance: "300m" }),
      mkStation("Farmers Carry", { distance: "50m", weightKg: 12, weightLabel: "2×6 kg" }),
      mkStation("Lunges", { distance: "20m" }),
      mkStation("Wall Ball Squats", { reps: 50, weightKg: 2, weightLabel: "2 kg ball" }),
    ],
  },

  // === Youngstars 12-13 (girls & boys have different weights) ===
  youngstars_12_13_women: {
    label: "Girls Youngstars 12-13", category: "youngstars", athletes: 1,
    formatDescription: "2 × 2 laps (200-275m each) with 8 stations grouped between runs",
    runSegments: 2, runDistanceM: 500,
    stations: [
      mkStation("SkiErg", { distance: "500m" }),
      mkStation("Sled Push", { distance: "30m", weightKg: 60, weightLabel: "60 kg" }),
      mkStation("Sled Pull", { distance: "30m", weightKg: 25, weightLabel: "25 kg" }),
      mkStation("Burpee Broad Jumps", { distance: "40m" }),
      mkStation("Rowing", { distance: "400m" }),
      mkStation("Farmers Carry", { distance: "100m", weightKg: 16, weightLabel: "2×8 kg" }),
      mkStation("Sandbag Lunges", { distance: "40m", weightKg: 5, weightLabel: "5 kg" }),
      mkStation("Wall Balls", { reps: 50, weightKg: 2, weightLabel: "2 kg / 2.4m target" }),
    ],
  },
  youngstars_12_13_men: {
    label: "Boys Youngstars 12-13", category: "youngstars", athletes: 1,
    formatDescription: "2 × 2 laps (200-275m each) with 8 stations grouped between runs",
    runSegments: 2, runDistanceM: 500,
    stations: [
      mkStation("SkiErg", { distance: "500m" }),
      mkStation("Sled Push", { distance: "30m", weightKg: 70, weightLabel: "70 kg" }),
      mkStation("Sled Pull", { distance: "30m", weightKg: 50, weightLabel: "50 kg" }),
      mkStation("Burpee Broad Jumps", { distance: "40m" }),
      mkStation("Rowing", { distance: "400m" }),
      mkStation("Farmers Carry", { distance: "100m", weightKg: 24, weightLabel: "2×12 kg" }),
      mkStation("Sandbag Lunges", { distance: "40m", weightKg: 7.5, weightLabel: "7.5 kg" }),
      mkStation("Wall Balls", { reps: 50, weightKg: 3, weightLabel: "3 kg / 2.4m target" }),
    ],
  },

  // === Youngstars 14-15 (girls & boys have different weights) ===
  youngstars_14_15_women: {
    label: "Girls Youngstars 14-15", category: "youngstars", athletes: 1,
    formatDescription: "8 × (1 lap 200-275m + station)",
    runSegments: 8, runDistanceM: 250,
    stations: [
      mkStation("SkiErg", { distance: "600m" }),
      mkStation("Sled Push", { distance: "30m", weightKg: 70, weightLabel: "70 kg" }),
      mkStation("Sled Pull", { distance: "30m", weightKg: 50, weightLabel: "50 kg" }),
      mkStation("Burpee Broad Jumps", { distance: "40m" }),
      mkStation("Rowing", { distance: "500m" }),
      mkStation("Farmers Carry", { distance: "100m", weightKg: 24, weightLabel: "2×12 kg" }),
      mkStation("Sandbag Lunges", { distance: "40m", weightKg: 7.5, weightLabel: "7.5 kg" }),
      mkStation("Wall Balls", { reps: 50, weightKg: 3, weightLabel: "3 kg / 2.4m target" }),
    ],
  },
  youngstars_14_15_men: {
    label: "Boys Youngstars 14-15", category: "youngstars", athletes: 1,
    formatDescription: "8 × (1 lap 200-275m + station)",
    runSegments: 8, runDistanceM: 250,
    stations: [
      mkStation("SkiErg", { distance: "600m" }),
      mkStation("Sled Push", { distance: "30m", weightKg: 102, weightLabel: "102 kg" }),
      mkStation("Sled Pull", { distance: "30m", weightKg: 78, weightLabel: "78 kg" }),
      mkStation("Burpee Broad Jumps", { distance: "40m" }),
      mkStation("Rowing", { distance: "500m" }),
      mkStation("Farmers Carry", { distance: "100m", weightKg: 32, weightLabel: "2×16 kg" }),
      mkStation("Sandbag Lunges", { distance: "40m", weightKg: 10, weightLabel: "10 kg" }),
      mkStation("Wall Balls", { reps: 50, weightKg: 4, weightLabel: "4 kg / 2.7m target" }),
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
    label: "Adaptive — Lower Limb",
    description: "Below/above-knee amputation, joint instability",
    keys: [
      "adaptive_ll_minor_women", "adaptive_ll_minor_men",
      "adaptive_ll_major_women", "adaptive_ll_major_men",
    ],
  },
  {
    label: "Adaptive — Upper Limb",
    description: "Below/above-elbow amputation, loss of function",
    keys: [
      "adaptive_ul_minor_women", "adaptive_ul_minor_men",
      "adaptive_ul_major_women", "adaptive_ul_major_men",
    ],
  },
  {
    label: "Adaptive — Other Standing",
    description: "Short stature, visual, deaf, neurological impairments",
    keys: [
      "adaptive_short_stature_women", "adaptive_short_stature_men",
      "adaptive_visual_women", "adaptive_visual_men",
      "adaptive_deaf_women", "adaptive_deaf_men",
      "adaptive_neuro_minor_women", "adaptive_neuro_minor_men",
      "adaptive_neuro_moderate_women", "adaptive_neuro_moderate_men",
      "adaptive_neuro_major_women", "adaptive_neuro_major_men",
    ],
  },
  {
    label: "Adaptive — Seated",
    description: "Wheelchair divisions — SWHF, SWOHF, SWOC",
    keys: [
      "adaptive_swhf_women", "adaptive_swhf_men",
      "adaptive_swohf_women", "adaptive_swohf_men",
      "adaptive_swoc_women", "adaptive_swoc_men",
    ],
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
// Reference times — derived from scraped race data
//
// Each distribution is [p10, p25, p50, p75, p90] in seconds.
//   p10 = top 10%  (fast)
//   p25 = top 25%
//   p50 = median
//   p75 = bottom 25%
//   p90 = bottom 10% (slow)
//
// Source: hyrox_division_stats.csv generated from hyrox_public_splits
// ---------------------------------------------------------------------------

/** 5-point percentile distribution [p10, p25, p50, p75, p90] in seconds */
export type RefDistribution = [number, number, number, number, number];

/** Convenience alias — [fast, median, slow] extracted from RefDistribution */
export type RefTuple = [number, number, number];

// -- Women Open (n ≈ 3700) ---------------------------------------------------
const WOMEN_OPEN_STATION_REFS: Record<StationName, RefDistribution> = {
  SkiErg:               [287, 299, 315, 337, 361],
  "Sled Push":          [135, 151, 173, 200, 230],
  "Sled Pull":          [265, 295, 341, 399, 470],
  "Burpee Broad Jumps": [278, 324, 391, 489, 617],
  Rowing:               [297, 308, 325, 348, 374],
  "Farmers Carry":      [108, 118, 130, 149, 177],
  "Sandbag Lunges":     [207, 251, 301, 374, 459],
  "Wall Balls":         [285, 329, 398, 514, 651],
};
const WOMEN_OPEN_RUN_REFS: Record<string, RefDistribution> = {
  "Run 1": [196, 225, 262, 299, 335],
  "Run 2": [281, 305, 338, 382, 434],
  "Run 3": [295, 320, 357, 403, 461],
  "Run 4": [294, 320, 359, 405, 471],
  "Run 5": [299, 326, 365, 418, 486],
  "Run 6": [294, 323, 361, 414, 482],
  "Run 7": [292, 319, 359, 411, 477],
  "Run 8": [295, 326, 371, 437, 530],
};
const WOMEN_OPEN_ROXZONE_REF: RefDistribution = [375, 423, 497, 606, 727];

// -- Men Open (n ≈ 3400) -----------------------------------------------------
const MEN_OPEN_STATION_REFS: Record<StationName, RefDistribution> = {
  SkiErg:               [250, 260, 274, 290, 308],
  "Sled Push":          [147, 169, 194, 224, 270],
  "Sled Pull":          [227, 253, 293, 341, 399],
  "Burpee Broad Jumps": [235, 275, 333, 410, 497],
  Rowing:               [266, 276, 292, 312, 335],
  "Farmers Carry":      [ 97, 110, 125, 146, 174],
  "Sandbag Lunges":     [219, 263, 314, 381, 473],
  "Wall Balls":         [298, 355, 428, 544, 709],
};
const MEN_OPEN_RUN_REFS: Record<string, RefDistribution> = {
  "Run 1": [176, 200, 228, 258, 299],
  "Run 2": [246, 268, 299, 339, 381],
  "Run 3": [266, 292, 324, 368, 419],
  "Run 4": [265, 290, 324, 368, 421],
  "Run 5": [268, 296, 332, 381, 445],
  "Run 6": [264, 290, 328, 375, 439],
  "Run 7": [263, 289, 325, 375, 443],
  "Run 8": [269, 301, 346, 410, 522],
};
const MEN_OPEN_ROXZONE_REF: RefDistribution = [345, 394, 477, 588, 721];

// -- Women Pro (n ≈ 509) ------------------------------------------------------
const WOMEN_PRO_STATION_REFS: Record<StationName, RefDistribution> = {
  SkiErg:               [272, 283, 295, 309, 324],
  "Sled Push":          [193, 218, 256, 302, 357],
  "Sled Pull":          [268, 299, 363, 437, 528],
  "Burpee Broad Jumps": [228, 264, 318, 392, 484],
  Rowing:               [281, 291, 306, 322, 342],
  "Farmers Carry":      [108, 125, 147, 181, 216],
  "Sandbag Lunges":     [212, 255, 308, 367, 437],
  "Wall Balls":         [271, 317, 392, 503, 628],
};
const WOMEN_PRO_RUN_REFS: Record<string, RefDistribution> = {
  "Run 1": [166, 186, 222, 266, 304],
  "Run 2": [243, 264, 291, 327, 369],
  "Run 3": [258, 282, 315, 356, 404],
  "Run 4": [258, 283, 314, 355, 401],
  "Run 5": [260, 286, 318, 357, 415],
  "Run 6": [258, 282, 313, 354, 406],
  "Run 7": [260, 285, 319, 358, 412],
  "Run 8": [264, 290, 324, 374, 456],
};
const WOMEN_PRO_ROXZONE_REF: RefDistribution = [317, 361, 434, 533, 651];

// -- Men Pro (n ≈ 812) --------------------------------------------------------
const MEN_PRO_STATION_REFS: Record<StationName, RefDistribution> = {
  SkiErg:               [242, 248, 258, 270, 282],
  "Sled Push":          [179, 208, 248, 296, 358],
  "Sled Pull":          [257, 292, 346, 424, 525],
  "Burpee Broad Jumps": [194, 221, 264, 318, 368],
  Rowing:               [253, 260, 272, 287, 306],
  "Farmers Carry":      [ 96, 106, 123, 150, 181],
  "Sandbag Lunges":     [210, 251, 294, 347, 429],
  "Wall Balls":         [286, 334, 404, 515, 647],
};
const MEN_PRO_RUN_REFS: Record<string, RefDistribution> = {
  "Run 1": [153, 170, 202, 223, 247],
  "Run 2": [223, 238, 258, 287, 318],
  "Run 3": [237, 258, 284, 319, 361],
  "Run 4": [241, 260, 287, 321, 357],
  "Run 5": [242, 261, 288, 328, 366],
  "Run 6": [237, 256, 283, 320, 362],
  "Run 7": [241, 259, 287, 324, 364],
  "Run 8": [246, 265, 297, 342, 400],
};
const MEN_PRO_ROXZONE_REF: RefDistribution = [300, 334, 395, 478, 580];

// -- Doubles Mixed Open (n ≈ 5050) --------------------------------------------
const DOUBLES_MIXED_OPEN_STATION_REFS: Record<StationName, RefDistribution> = {
  SkiErg:               [246, 260, 280, 302, 321],
  "Sled Push":          [106, 118, 135, 157, 182],
  "Sled Pull":          [187, 211, 243, 281, 324],
  "Burpee Broad Jumps": [154, 180, 218, 267, 330],
  Rowing:               [265, 282, 302, 324, 346],
  "Farmers Carry":      [ 88,  97, 108, 122, 133],
  "Sandbag Lunges":     [172, 195, 229, 272, 326],
  "Wall Balls":         [226, 245, 275, 321, 390],
};
const DOUBLES_MIXED_OPEN_RUN_REFS: Record<string, RefDistribution> = {
  "Run 1": [185, 210, 239, 272, 305],
  "Run 2": [289, 322, 363, 410, 463],
  "Run 3": [306, 340, 385, 431, 492],
  "Run 4": [307, 341, 386, 435, 497],
  "Run 5": [313, 348, 393, 451, 524],
  "Run 6": [308, 344, 391, 448, 518],
  "Run 7": [311, 344, 392, 451, 521],
  "Run 8": [309, 345, 399, 468, 558],
};
const DOUBLES_MIXED_OPEN_ROXZONE_REF: RefDistribution = [363, 420, 500, 597, 702];

// -- Doubles Mixed Pro (n ≈ 584) ----------------------------------------------
const DOUBLES_MIXED_PRO_STATION_REFS: Record<StationName, RefDistribution> = {
  SkiErg:               [228, 237, 252, 270, 286],
  "Sled Push":          [123, 137, 153, 179, 205],
  "Sled Pull":          [205, 223, 253, 291, 343],
  "Burpee Broad Jumps": [128, 146, 168, 200, 235],
  Rowing:               [242, 255, 273, 292, 313],
  "Farmers Carry":      [ 87,  94, 104, 115, 126],
  "Sandbag Lunges":     [165, 184, 209, 244, 287],
  "Wall Balls":         [218, 231, 259, 297, 367],
};
const DOUBLES_MIXED_PRO_RUN_REFS: Record<string, RefDistribution> = {
  "Run 1": [153, 166, 187, 216, 242],
  "Run 2": [242, 262, 297, 334, 377],
  "Run 3": [258, 284, 323, 360, 403],
  "Run 4": [258, 283, 319, 361, 403],
  "Run 5": [261, 289, 328, 371, 412],
  "Run 6": [259, 284, 322, 366, 410],
  "Run 7": [264, 289, 325, 371, 419],
  "Run 8": [263, 290, 327, 374, 441],
};
const DOUBLES_MIXED_PRO_ROXZONE_REF: RefDistribution = [296, 334, 388, 472, 555];

// -- Relay Mixed (n ≈ 529) ----------------------------------------------------
const RELAY_MIXED_STATION_REFS: Record<StationName, RefDistribution> = {
  SkiErg:               [265, 291, 317, 352, 383],
  "Sled Push":          [126, 147, 176, 206, 256],
  "Sled Pull":          [199, 230, 276, 334, 404],
  "Burpee Broad Jumps": [183, 226, 288, 382, 465],
  Rowing:               [263, 285, 314, 343, 372],
  "Farmers Carry":      [ 90, 102, 117, 131, 155],
  "Sandbag Lunges":     [195, 240, 285, 359, 426],
  "Wall Balls":         [233, 270, 332, 442, 577],
};
const RELAY_MIXED_RUN_REFS: Record<string, RefDistribution> = {
  "Run 1": [150, 168, 195, 223, 257],
  "Run 2": [260, 286, 321, 366, 429],
  "Run 3": [260, 289, 324, 377, 443],
  "Run 4": [259, 286, 321, 367, 423],
  "Run 5": [268, 295, 338, 388, 455],
  "Run 6": [275, 308, 344, 391, 452],
  "Run 7": [267, 299, 338, 382, 432],
  "Run 8": [271, 301, 340, 386, 442],
};
const RELAY_MIXED_ROXZONE_REF: RefDistribution = [343, 390, 460, 532, 599];

// -- Adaptive Men (n = 4, limited data) ----------------------------------------
const ADAPTIVE_MEN_STATION_REFS: Record<StationName, RefDistribution> = {
  SkiErg:               [229, 243, 276, 300, 301],
  "Sled Push":          [ 88, 138, 216, 291, 336],
  "Sled Pull":          [141, 167, 256, 330, 331],
  "Burpee Broad Jumps": [280, 294, 325, 389, 462],
  Rowing:               [276, 278, 310, 341, 343],
  "Farmers Carry":      [ 93,  96, 124, 168, 202],
  "Sandbag Lunges":     [319, 324, 340, 358, 369],
  "Wall Balls":         [206, 218, 259, 367, 499],
};
const ADAPTIVE_MEN_RUN_REFS: Record<string, RefDistribution> = {
  "Run 1": [ 92, 149, 185, 201, 221],
  "Run 2": [216, 275, 312, 330, 352],
  "Run 3": [222, 289, 342, 367, 383],
  "Run 4": [223, 294, 344, 362, 378],
  "Run 5": [225, 302, 352, 371, 394],
  "Run 6": [224, 294, 340, 361, 384],
  "Run 7": [224, 296, 350, 372, 388],
  "Run 8": [240, 312, 358, 376, 396],
};
const ADAPTIVE_MEN_ROXZONE_REF: RefDistribution = [410, 479, 562, 638, 697];

// -- Assembled reference lookup -----------------------------------------------

export interface DivisionRefData {
  stations: Record<StationName, RefDistribution>;
  runs: Record<string, RefDistribution>;
  roxzone: RefDistribution;
}

// ---------------------------------------------------------------------------
// Observed min/max from scraped data (fastest & slowest per segment)
// Source: hyrox_division_stats.csv — update after running cleanup_outliers.sql
// ---------------------------------------------------------------------------

type StationRanges = Record<StationName, [number, number]>;
type RunRanges = Record<string, [number, number]>;

// -- Women Open ranges --------------------------------------------------------
const WOMEN_OPEN_STATION_RANGES: StationRanges = {
  SkiErg:               [256, 606],
  "Sled Push":          [ 84, 626],
  "Sled Pull":          [193, 1064],
  "Burpee Broad Jumps": [148, 1200],
  Rowing:               [184, 606],
  "Farmers Carry":      [ 73, 697],
  "Sandbag Lunges":     [ 89, 1200],
  "Wall Balls":         [193, 1200],
};
const WOMEN_OPEN_RUN_RANGES: RunRanges = {
  "Run 1": [147, 708], "Run 2": [181, 859], "Run 3": [235, 900], "Run 4": [237, 882],
  "Run 5": [235, 900], "Run 6": [237, 900], "Run 7": [137, 900], "Run 8": [195, 900],
};
const WOMEN_OPEN_ROXZONE_RANGE: [number, number] = [256, 1800];

// -- Men Open ranges ----------------------------------------------------------
const MEN_OPEN_STATION_RANGES: StationRanges = {
  SkiErg:               [150, 401],
  "Sled Push":          [ 93, 1200],
  "Sled Pull":          [139, 1200],
  "Burpee Broad Jumps": [134, 1200],
  Rowing:               [235, 511],
  "Farmers Carry":      [ 66, 689],
  "Sandbag Lunges":     [ 99, 1200],
  "Wall Balls":         [201, 1200],
};
const MEN_OPEN_RUN_RANGES: RunRanges = {
  "Run 1": [129, 643], "Run 2": [166, 900], "Run 3": [209, 900], "Run 4": [91, 900],
  "Run 5": [201, 900], "Run 6": [212, 900], "Run 7": [216, 900], "Run 8": [215, 900],
};
const MEN_OPEN_ROXZONE_RANGE: [number, number] = [253, 1800];

// -- Women Pro ranges ---------------------------------------------------------
const WOMEN_PRO_STATION_RANGES: StationRanges = {
  SkiErg:               [250, 366],
  "Sled Push":          [140, 616],
  "Sled Pull":          [214, 813],
  "Burpee Broad Jumps": [148, 1128],
  Rowing:               [184, 459],
  "Farmers Carry":      [ 78, 411],
  "Sandbag Lunges":     [100, 836],
  "Wall Balls":         [196, 1200],
};
const WOMEN_PRO_RUN_RANGES: RunRanges = {
  "Run 1": [141, 697], "Run 2": [207, 608], "Run 3": [222, 670], "Run 4": [223, 900],
  "Run 5": [136, 900], "Run 6": [125, 900], "Run 7": [138, 900], "Run 8": [150, 900],
};
const WOMEN_PRO_ROXZONE_RANGE: [number, number] = [258, 1800];

// -- Men Pro ranges -----------------------------------------------------------
const MEN_PRO_STATION_RANGES: StationRanges = {
  SkiErg:               [224, 402],
  "Sled Push":          [133, 906],
  "Sled Pull":          [187, 1193],
  "Burpee Broad Jumps": [129, 1092],
  Rowing:               [232, 871],
  "Farmers Carry":      [ 75, 900],
  "Sandbag Lunges":     [108, 1134],
  "Wall Balls":         [186, 1200],
};
const MEN_PRO_RUN_RANGES: RunRanges = {
  "Run 1": [135, 444], "Run 2": [198, 840], "Run 3": [116, 739], "Run 4": [132, 759],
  "Run 5": [124, 586], "Run 6": [126, 741], "Run 7": [122, 708], "Run 8": [207, 900],
};
const MEN_PRO_ROXZONE_RANGE: [number, number] = [238, 1800];

// -- Doubles Mixed Open ranges ------------------------------------------------
const DOUBLES_MIXED_OPEN_STATION_RANGES: StationRanges = {
  SkiErg:               [148, 438],
  "Sled Push":          [ 73, 736],
  "Sled Pull":          [116, 1200],
  "Burpee Broad Jumps": [ 84, 1200],
  Rowing:               [165, 561],
  "Farmers Carry":      [ 43, 689],
  "Sandbag Lunges":     [115, 1200],
  "Wall Balls":         [184, 1200],
};
const DOUBLES_MIXED_OPEN_RUN_RANGES: RunRanges = {
  "Run 1": [125, 774], "Run 2": [123, 900], "Run 3": [167, 900], "Run 4": [179, 900],
  "Run 5": [149, 900], "Run 6": [108, 900], "Run 7": [193, 900], "Run 8": [180, 900],
};
const DOUBLES_MIXED_OPEN_ROXZONE_RANGE: [number, number] = [221, 1800];

// -- Doubles Mixed Pro ranges -------------------------------------------------
const DOUBLES_MIXED_PRO_STATION_RANGES: StationRanges = {
  SkiErg:               [201, 370],
  "Sled Push":          [ 87, 525],
  "Sled Pull":          [151, 1078],
  "Burpee Broad Jumps": [ 91, 641],
  Rowing:               [165, 406],
  "Farmers Carry":      [ 66, 379],
  "Sandbag Lunges":     [123, 799],
  "Wall Balls":         [194, 1200],
};
const DOUBLES_MIXED_PRO_RUN_RANGES: RunRanges = {
  "Run 1": [126, 500], "Run 2": [196, 656], "Run 3": [205, 797], "Run 4": [205, 900],
  "Run 5": [210, 900], "Run 6": [210, 830], "Run 7": [216, 809], "Run 8": [149, 900],
};
const DOUBLES_MIXED_PRO_ROXZONE_RANGE: [number, number] = [219, 1034];

// -- Relay Mixed ranges -------------------------------------------------------
const RELAY_MIXED_STATION_RANGES: StationRanges = {
  SkiErg:               [228, 513],
  "Sled Push":          [ 85, 563],
  "Sled Pull":          [138, 763],
  "Burpee Broad Jumps": [109, 1184],
  Rowing:               [163, 528],
  "Farmers Carry":      [ 71, 275],
  "Sandbag Lunges":     [132, 1200],
  "Wall Balls":         [142, 1200],
};
const RELAY_MIXED_RUN_RANGES: RunRanges = {
  "Run 1": [120, 696], "Run 2": [169, 900], "Run 3": [198, 900], "Run 4": [204, 900],
  "Run 5": [218, 900], "Run 6": [216, 900], "Run 7": [228, 900], "Run 8": [215, 900],
};
const RELAY_MIXED_ROXZONE_RANGE: [number, number] = [263, 1800];

// -- Adaptive Men ranges ------------------------------------------------------
const ADAPTIVE_MEN_STATION_RANGES: StationRanges = {
  SkiErg:               [219, 302],
  "Sled Push":          [ 55, 366],
  "Sled Pull":          [124, 331],
  "Burpee Broad Jumps": [271, 511],
  Rowing:               [274, 344],
  "Farmers Carry":      [ 91, 224],
  "Sandbag Lunges":     [316, 376],
  "Wall Balls":         [199, 587],
};
const ADAPTIVE_MEN_RUN_RANGES: RunRanges = {
  "Run 1": [ 55, 234], "Run 2": [177, 367], "Run 3": [178, 394], "Run 4": [176, 388],
  "Run 5": [174, 410], "Run 6": [178, 399], "Run 7": [175, 399], "Run 8": [193, 410],
};
const ADAPTIVE_MEN_ROXZONE_RANGE: [number, number] = [364, 736];

// ---------------------------------------------------------------------------

export interface DivisionRefDataFull extends DivisionRefData {
  stationRanges: StationRanges;
  runRanges: RunRanges;
  roxzoneRange: [number, number];
}

export const DIVISION_REF_DATA: Partial<Record<DivisionKey, DivisionRefDataFull>> = {
  women_open: {
    stations: WOMEN_OPEN_STATION_REFS, runs: WOMEN_OPEN_RUN_REFS, roxzone: WOMEN_OPEN_ROXZONE_REF,
    stationRanges: WOMEN_OPEN_STATION_RANGES, runRanges: WOMEN_OPEN_RUN_RANGES, roxzoneRange: WOMEN_OPEN_ROXZONE_RANGE,
  },
  women_pro: {
    stations: WOMEN_PRO_STATION_REFS, runs: WOMEN_PRO_RUN_REFS, roxzone: WOMEN_PRO_ROXZONE_REF,
    stationRanges: WOMEN_PRO_STATION_RANGES, runRanges: WOMEN_PRO_RUN_RANGES, roxzoneRange: WOMEN_PRO_ROXZONE_RANGE,
  },
  men_open: {
    stations: MEN_OPEN_STATION_REFS, runs: MEN_OPEN_RUN_REFS, roxzone: MEN_OPEN_ROXZONE_REF,
    stationRanges: MEN_OPEN_STATION_RANGES, runRanges: MEN_OPEN_RUN_RANGES, roxzoneRange: MEN_OPEN_ROXZONE_RANGE,
  },
  men_pro: {
    stations: MEN_PRO_STATION_REFS, runs: MEN_PRO_RUN_REFS, roxzone: MEN_PRO_ROXZONE_REF,
    stationRanges: MEN_PRO_STATION_RANGES, runRanges: MEN_PRO_RUN_RANGES, roxzoneRange: MEN_PRO_ROXZONE_RANGE,
  },
  doubles_mixed_open: {
    stations: DOUBLES_MIXED_OPEN_STATION_REFS, runs: DOUBLES_MIXED_OPEN_RUN_REFS, roxzone: DOUBLES_MIXED_OPEN_ROXZONE_REF,
    stationRanges: DOUBLES_MIXED_OPEN_STATION_RANGES, runRanges: DOUBLES_MIXED_OPEN_RUN_RANGES, roxzoneRange: DOUBLES_MIXED_OPEN_ROXZONE_RANGE,
  },
  doubles_mixed_pro: {
    stations: DOUBLES_MIXED_PRO_STATION_REFS, runs: DOUBLES_MIXED_PRO_RUN_REFS, roxzone: DOUBLES_MIXED_PRO_ROXZONE_REF,
    stationRanges: DOUBLES_MIXED_PRO_STATION_RANGES, runRanges: DOUBLES_MIXED_PRO_RUN_RANGES, roxzoneRange: DOUBLES_MIXED_PRO_ROXZONE_RANGE,
  },
  relay_mixed: {
    stations: RELAY_MIXED_STATION_REFS, runs: RELAY_MIXED_RUN_REFS, roxzone: RELAY_MIXED_ROXZONE_REF,
    stationRanges: RELAY_MIXED_STATION_RANGES, runRanges: RELAY_MIXED_RUN_RANGES, roxzoneRange: RELAY_MIXED_ROXZONE_RANGE,
  },
  // Adaptive ref data — originally from n=4 combined "adaptive_men" division.
  // Mapped to Neuro Minor Men as the closest subdivision match for now.
  adaptive_neuro_minor_men: {
    stations: ADAPTIVE_MEN_STATION_REFS, runs: ADAPTIVE_MEN_RUN_REFS, roxzone: ADAPTIVE_MEN_ROXZONE_REF,
    stationRanges: ADAPTIVE_MEN_STATION_RANGES, runRanges: ADAPTIVE_MEN_RUN_RANGES, roxzoneRange: ADAPTIVE_MEN_ROXZONE_RANGE,
  },
};

// ---------------------------------------------------------------------------
// Percentile estimation — interpolate between known quantile points
// ---------------------------------------------------------------------------

const KNOWN_PERCENTILES = [10, 25, 50, 75, 90] as const;

/**
 * Estimate what percentile a given time falls in for a segment.
 * Returns 1–99 (lower = faster/better). Returns null if no distribution available.
 *
 * Note: percentile here means "% of athletes who were SLOWER than you",
 * so a lower time → lower percentile number → better performance.
 * We invert at display time to show "Top X%".
 */
export function estimatePercentile(timeSeconds: number, dist: RefDistribution): number {
  // Faster than p10 → extrapolate toward 1
  if (timeSeconds <= dist[0]) {
    return Math.max(1, Math.round(10 * (timeSeconds / dist[0])));
  }
  // Slower than p90 → extrapolate toward 99
  if (timeSeconds >= dist[4]) {
    const ratio = (timeSeconds - dist[4]) / (dist[4] - dist[2]); // how far past p90
    return Math.min(99, Math.round(90 + 10 * Math.min(ratio, 1)));
  }
  // Interpolate between adjacent known points
  for (let i = 0; i < KNOWN_PERCENTILES.length - 1; i++) {
    if (timeSeconds <= dist[i + 1]) {
      const pLow = KNOWN_PERCENTILES[i];
      const pHigh = KNOWN_PERCENTILES[i + 1];
      const fraction = (timeSeconds - dist[i]) / (dist[i + 1] - dist[i]);
      return Math.round(pLow + fraction * (pHigh - pLow));
    }
  }
  return 50;
}

/** Format a percentile as "Top X%" for display */
export function formatPercentile(percentile: number): string {
  return `Top ${percentile}%`;
}

// ---------------------------------------------------------------------------
// Backwards-compatible accessors — extract [p10, p50, p90] as RefTuple
// ---------------------------------------------------------------------------

function toRefTuple(d: RefDistribution): RefTuple {
  return [d[0], d[2], d[4]];
}

// Station-only [fast, median, slow]
export const REFERENCE_TIMES: Partial<Record<DivisionKey, Record<StationName, RefTuple>>> = Object.fromEntries(
  Object.entries(DIVISION_REF_DATA).map(([k, v]) => [
    k,
    Object.fromEntries(Object.entries(v.stations).map(([s, d]) => [s, toRefTuple(d)])),
  ])
) as Partial<Record<DivisionKey, Record<StationName, RefTuple>>>;

// ---------------------------------------------------------------------------
// Running reference (8 × 1 km runs between stations)
// ---------------------------------------------------------------------------
export const RUN_SEGMENTS = 8;
export const RUN_DISTANCE_KM = 1; // each segment

/** Average run reference across all 8 runs [fast, median, slow] */
export const RUN_REFERENCE: Partial<Record<DivisionKey, RefTuple>> = Object.fromEntries(
  Object.entries(DIVISION_REF_DATA).map(([divKey, data]) => {
    const runs = Object.values(data.runs);
    const avg = (idx: 0 | 2 | 4) => Math.round(runs.reduce((sum, r) => sum + r[idx], 0) / runs.length);
    return [divKey, [avg(0), avg(2), avg(4)] as RefTuple];
  })
) as Partial<Record<DivisionKey, RefTuple>>;

/** Per-run reference times [fast, median, slow] by run label ("Run 1" .. "Run 8") */
export const RUN_REFERENCES_BY_SEGMENT: Partial<Record<DivisionKey, Record<string, RefTuple>>> = Object.fromEntries(
  Object.entries(DIVISION_REF_DATA).map(([k, v]) => [
    k,
    Object.fromEntries(Object.entries(v.runs).map(([r, d]) => [r, toRefTuple(d)])),
  ])
) as Partial<Record<DivisionKey, Record<string, RefTuple>>>;

/** Roxzone (transition) total reference times [fast, median, slow] */
export const ROXZONE_REFERENCE: Partial<Record<DivisionKey, RefTuple>> = Object.fromEntries(
  Object.entries(DIVISION_REF_DATA).map(([k, v]) => [k, toRefTuple(v.roxzone)])
) as Partial<Record<DivisionKey, RefTuple>>;

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

/**
 * Convert a weight label to mixed units, preserving multiplier prefixes.
 * "2×16 kg" → "2 × 35 lbs"
 * "102 kg"  → "225 lbs"
 * "1×16 kg" → "1 × 35 lbs"
 * If useMixed is false, returns the original label unchanged.
 */
export function convertWeightLabel(
  weightLabel: string | undefined,
  weightKg: number | undefined,
  useMixed: boolean,
): string {
  if (!weightLabel) return "";
  if (!useMixed) return weightLabel;

  // Match patterns like "2×16 kg" or "1×24 kg"
  const multiplierMatch = weightLabel.match(/^(\d+)\s*×\s*(\d+(?:\.\d+)?)\s*kg/);
  if (multiplierMatch) {
    const count = multiplierMatch[1];
    const perUnit = parseFloat(multiplierMatch[2]);
    return `${count} × ${kgToLbs(perUnit)} lbs`;
  }

  // Fall back to converting total weightKg
  if (weightKg !== undefined) {
    return `${kgToLbs(weightKg)} lbs`;
  }

  return weightLabel;
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
