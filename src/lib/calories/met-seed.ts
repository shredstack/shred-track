// ============================================================
// MET value seed table.
// ============================================================
// Source: 2024 Adult Compendium of Physical Activities (Herrmann et al.).
// Codes prefixed `e_` are estimated by us where the Compendium has no direct
// entry — they carry `metIsEstimated: true` so admins know to review them.
//
// `repSecondsDefault` is seeded from public sources (CrossFit Games Open data,
// HYROX pacing benchmarks). Population averages, not Sarah's data — see the
// "Why population over personal" section of the spec.

export interface MetSeedRow {
  canonicalName: string;
  metValue?: number | null; // null when is_paced_run / is_paced_erg
  metCompendiumCode?: string | null;
  metIsEstimated?: boolean;
  metSource?: string;
  metNotes?: string;
  repSecondsDefault?: number | null;
  isPacedRun?: boolean;
  isPacedErg?: "row" | "ski" | null;
}

export const MET_SEED_ROWS: MetSeedRow[] = [
  // ---------- Barbell — strength block defaults ----------
  // Heavy strength lifts that mostly appear as for_load. When they appear in
  // for_time/amrap parts (Grace, Isabel) the part-level branch overrides this
  // with metcon-weighted math against the session duration.
  { canonicalName: "Back Squat",         metValue: 5.0, metCompendiumCode: "02052", repSecondsDefault: 4.0 },
  { canonicalName: "Front Squat",        metValue: 5.0, metCompendiumCode: "02052", repSecondsDefault: 4.0 },
  { canonicalName: "Overhead Squat",     metValue: 6.0, metCompendiumCode: "02050", repSecondsDefault: 4.0 },
  { canonicalName: "Deadlift",           metValue: 5.0, metCompendiumCode: "02052", repSecondsDefault: 4.0 },
  { canonicalName: "Sumo Deadlift High Pull", metValue: 6.0, metCompendiumCode: "02050", repSecondsDefault: 3.5 },
  { canonicalName: "Clean",              metValue: 6.5, metCompendiumCode: "e_clean",        metIsEstimated: true, metNotes: "Olympic lift base; metcon parts override via part-level weighted MET.", repSecondsDefault: 5.0 },
  { canonicalName: "Power Clean",        metValue: 6.5, metCompendiumCode: "e_clean",        metIsEstimated: true, repSecondsDefault: 4.5 },
  { canonicalName: "Squat Clean",        metValue: 6.5, metCompendiumCode: "e_clean",        metIsEstimated: true, repSecondsDefault: 5.0 },
  { canonicalName: "Hang Clean",         metValue: 6.5, metCompendiumCode: "e_clean",        metIsEstimated: true, repSecondsDefault: 4.5 },
  { canonicalName: "Hang Power Clean",   metValue: 6.5, metCompendiumCode: "e_clean",        metIsEstimated: true, repSecondsDefault: 4.0 },
  { canonicalName: "Clean and Jerk",     metValue: 6.5, metCompendiumCode: "e_clean",        metIsEstimated: true, repSecondsDefault: 5.5 },
  { canonicalName: "Snatch",             metValue: 6.5, metCompendiumCode: "e_snatch",       metIsEstimated: true, repSecondsDefault: 5.5 },
  { canonicalName: "Power Snatch",       metValue: 6.5, metCompendiumCode: "e_snatch",       metIsEstimated: true, repSecondsDefault: 5.0 },
  { canonicalName: "Squat Snatch",       metValue: 6.5, metCompendiumCode: "e_snatch",       metIsEstimated: true, repSecondsDefault: 5.5 },
  { canonicalName: "Hang Snatch",        metValue: 6.5, metCompendiumCode: "e_snatch",       metIsEstimated: true, repSecondsDefault: 5.0 },
  { canonicalName: "Hang Power Snatch",  metValue: 6.5, metCompendiumCode: "e_snatch",       metIsEstimated: true, repSecondsDefault: 4.5 },
  { canonicalName: "Thruster",           metValue: 8.0, metCompendiumCode: "e_thruster",     metIsEstimated: true, metNotes: "Compound squat-to-press; between heavy lifts and HIIT-vigorous.", repSecondsDefault: 3.5 },
  { canonicalName: "Push Press",         metValue: 6.0, metCompendiumCode: "02050", repSecondsDefault: 3.0 },
  { canonicalName: "Push Jerk",          metValue: 6.0, metCompendiumCode: "02050", repSecondsDefault: 3.0 },
  { canonicalName: "Split Jerk",         metValue: 6.0, metCompendiumCode: "02050", repSecondsDefault: 3.5 },
  { canonicalName: "Shoulder Press",     metValue: 5.0, metCompendiumCode: "02050", repSecondsDefault: 3.0 },
  { canonicalName: "Overhead Press",     metValue: 5.0, metCompendiumCode: "02050", repSecondsDefault: 3.0 },
  { canonicalName: "Bench Press",        metValue: 5.0, metCompendiumCode: "02050", repSecondsDefault: 3.0 },
  { canonicalName: "Barbell Row",        metValue: 5.0, metCompendiumCode: "02050", repSecondsDefault: 3.0 },
  { canonicalName: "Barbell Lunge",      metValue: 6.0, metCompendiumCode: "02050", repSecondsDefault: 2.5 },
  { canonicalName: "Cluster",            metValue: 8.0, metCompendiumCode: "e_thruster",     metIsEstimated: true, repSecondsDefault: 4.5 },

  // ---------- Dumbbell / loaded carries ----------
  { canonicalName: "Dumbbell Snatch",            metValue: 6.5, metCompendiumCode: "02057", repSecondsDefault: 2.5 },
  { canonicalName: "Dumbbell Clean",             metValue: 6.5, metCompendiumCode: "02057", repSecondsDefault: 3.0 },
  { canonicalName: "Dumbbell Thruster",          metValue: 8.0, metCompendiumCode: "e_thruster", metIsEstimated: true, repSecondsDefault: 3.0 },
  { canonicalName: "Devil Press",                metValue: 11.0, metCompendiumCode: "02214", repSecondsDefault: 5.0 },
  { canonicalName: "Man Maker",                  metValue: 11.0, metCompendiumCode: "02214", repSecondsDefault: 6.0 },
  { canonicalName: "Turkish Get-Up",             metValue: 6.0, metCompendiumCode: "02050", repSecondsDefault: 25.0 },
  { canonicalName: "Dumbbell Lunge",             metValue: 6.0, metCompendiumCode: "02050", repSecondsDefault: 2.0 },
  { canonicalName: "Dumbbell Box Step-Up",       metValue: 9.3, metCompendiumCode: "02065", repSecondsDefault: 3.0 },
  { canonicalName: "Dumbbell Shoulder to Overhead", metValue: 6.0, metCompendiumCode: "02050", repSecondsDefault: 2.5 },
  { canonicalName: "Dumbbell Hang Clean and Jerk",  metValue: 8.0, metCompendiumCode: "e_thruster", metIsEstimated: true, repSecondsDefault: 4.0 },

  // ---------- Kettlebell ----------
  { canonicalName: "Kettlebell Swing",      metValue: 9.8, metCompendiumCode: "02058", repSecondsDefault: 1.8 },
  { canonicalName: "Kettlebell Clean",      metValue: 7.5, metCompendiumCode: "02057", repSecondsDefault: 2.5 },
  { canonicalName: "Kettlebell Snatch",     metValue: 8.5, metCompendiumCode: "02057", repSecondsDefault: 2.5 },
  { canonicalName: "Goblet Squat",          metValue: 5.5, metCompendiumCode: "02052", repSecondsDefault: 2.5 },
  { canonicalName: "Kettlebell Turkish Get-Up", metValue: 6.0, metCompendiumCode: "02050", repSecondsDefault: 25.0 },

  // ---------- Gymnastics (vigorous calisthenics) ----------
  { canonicalName: "Pull-Up",                metValue: 7.5, metCompendiumCode: "02020", repSecondsDefault: 2.0 },
  { canonicalName: "Chest-to-Bar Pull-Up",   metValue: 7.5, metCompendiumCode: "02020", repSecondsDefault: 2.2 },
  { canonicalName: "Strict Pull-Up",         metValue: 7.5, metCompendiumCode: "02020", repSecondsDefault: 3.0 },
  { canonicalName: "Kipping Pull-Up",        metValue: 7.5, metCompendiumCode: "02020", repSecondsDefault: 1.8 },
  { canonicalName: "Muscle-Up",              metValue: 8.5, metCompendiumCode: "e_muscleup", metIsEstimated: true, metNotes: "Higher than pull-up due to press phase.", repSecondsDefault: 4.0 },
  { canonicalName: "Bar Muscle-Up",          metValue: 8.5, metCompendiumCode: "e_muscleup", metIsEstimated: true, repSecondsDefault: 4.0 },
  { canonicalName: "Ring Muscle-Up",         metValue: 8.5, metCompendiumCode: "e_muscleup", metIsEstimated: true, repSecondsDefault: 5.0 },
  { canonicalName: "Handstand Push-Up",      metValue: 7.5, metCompendiumCode: "02020", repSecondsDefault: 3.5 },
  { canonicalName: "Strict Handstand Push-Up", metValue: 7.5, metCompendiumCode: "02020", repSecondsDefault: 4.5 },
  { canonicalName: "Deficit Handstand Push-Up", metValue: 8.0, metCompendiumCode: "e_deficit_hspu", metIsEstimated: true, repSecondsDefault: 5.0 },
  { canonicalName: "Handstand Walk",         metValue: 7.5, metCompendiumCode: "02020", repSecondsDefault: 3.0 },
  { canonicalName: "Toes-to-Bar",            metValue: 7.5, metCompendiumCode: "02020", repSecondsDefault: 2.5 },
  { canonicalName: "Knees-to-Elbow",         metValue: 7.0, metCompendiumCode: "02020", repSecondsDefault: 2.5 },
  { canonicalName: "Rope Climb",             metValue: 8.0, metCompendiumCode: "e_rope_climb", metIsEstimated: true, metNotes: "Sustained loaded gymnastics.", repSecondsDefault: 20.0 },
  { canonicalName: "Legless Rope Climb",     metValue: 8.5, metCompendiumCode: "e_rope_climb", metIsEstimated: true, repSecondsDefault: 25.0 },
  { canonicalName: "Ring Dip",               metValue: 7.0, metCompendiumCode: "02020", repSecondsDefault: 2.0 },
  { canonicalName: "Pistol Squat",           metValue: 7.0, metCompendiumCode: "02020", repSecondsDefault: 3.0 },
  { canonicalName: "Ring Row",               metValue: 5.0, metCompendiumCode: "02022", repSecondsDefault: 2.0 },
  { canonicalName: "L-Sit",                  metValue: 4.0, metCompendiumCode: "02024", metNotes: "Static hold; metricType is duration." },
  { canonicalName: "Dead Hang",              metValue: 3.0, metCompendiumCode: "02024" },
  { canonicalName: "Handstand Hold",         metValue: 4.0, metCompendiumCode: "02024" },

  // ---------- Bodyweight ----------
  { canonicalName: "Push-Up",          metValue: 7.5, metCompendiumCode: "02020", repSecondsDefault: 1.5 },
  { canonicalName: "Deficit Push-Up",  metValue: 8.0, metCompendiumCode: "02020", repSecondsDefault: 2.0 },
  { canonicalName: "Air Squat",        metValue: 5.5, metCompendiumCode: "02052", repSecondsDefault: 1.8 },
  { canonicalName: "Burpee",           metValue: 11.0, metCompendiumCode: "02214", repSecondsDefault: 4.0 },
  { canonicalName: "Burpee Box Jump Over", metValue: 11.0, metCompendiumCode: "02214", repSecondsDefault: 5.0 },
  { canonicalName: "Burpee Pull-Up",   metValue: 11.0, metCompendiumCode: "02214", repSecondsDefault: 5.0 },
  { canonicalName: "Box Jump",         metValue: 9.3, metCompendiumCode: "02065", repSecondsDefault: 2.5 },
  { canonicalName: "Box Step-Up",      metValue: 8.0, metCompendiumCode: "02065", repSecondsDefault: 2.5 },
  { canonicalName: "Lunge",            metValue: 3.8, metCompendiumCode: "02022", repSecondsDefault: 1.8 },
  { canonicalName: "Walking Lunge",    metValue: 5.0, metCompendiumCode: "02022", repSecondsDefault: 2.0 },
  { canonicalName: "Sit-Up",           metValue: 7.5, metCompendiumCode: "02020", repSecondsDefault: 1.5 },
  { canonicalName: "GHD Sit-Up",       metValue: 8.0, metCompendiumCode: "02020", repSecondsDefault: 2.0 },
  { canonicalName: "Back Extension",   metValue: 4.0, metCompendiumCode: "02022", repSecondsDefault: 1.8 },
  { canonicalName: "Jumping Jack",     metValue: 7.0, metCompendiumCode: "02210", repSecondsDefault: 0.8 },
  { canonicalName: "Double-Under",     metValue: 11.0, metCompendiumCode: "02068", repSecondsDefault: 0.6 },
  { canonicalName: "Single-Under",     metValue: 11.0, metCompendiumCode: "02068", repSecondsDefault: 0.4 },
  { canonicalName: "Wall Ball",        metValue: 8.5, metCompendiumCode: "e_wall_ball", metIsEstimated: true, metNotes: "Between vigorous circuit and HIIT-vigorous.", repSecondsDefault: 2.5 },
  { canonicalName: "V-Up",             metValue: 4.0, metCompendiumCode: "02024", repSecondsDefault: 2.0 },
  { canonicalName: "Plank",            metValue: 2.8, metCompendiumCode: "02024" },
  { canonicalName: "Hollow Hold",      metValue: 2.8, metCompendiumCode: "02024" },
  { canonicalName: "Wall Sit",         metValue: 2.8, metCompendiumCode: "02024" },

  // ---------- Monostructural — paced ----------
  { canonicalName: "Run",   metValue: null, isPacedRun: true,           metNotes: "MET looked up from pace table (Compendium 12010–12130)." },
  { canonicalName: "Row",   metValue: null, isPacedErg: "row",          metNotes: "MET looked up from pace → watts → Compendium 02071–02074." },
  { canonicalName: "SkiErg", metValue: null, isPacedErg: "ski",         metNotes: "MET looked up from SkiErg pace table." },
  { canonicalName: "Bike (Assault)", metValue: 11.0, metCompendiumCode: "02214" },
  { canonicalName: "Bike (Echo)",    metValue: 11.0, metCompendiumCode: "02214" },
  { canonicalName: "Swim",  metValue: 8.3, metCompendiumCode: "18310", metNotes: "Freestyle laps, moderate-to-vigorous." },

  // ---------- HYROX-flavored loaded locomotion ----------
  { canonicalName: "Sled Push",       metValue: 11.0, metCompendiumCode: "e_sled", metIsEstimated: true, metNotes: "Sustained max-effort locomotion under load." },
  { canonicalName: "Sled Pull",       metValue: 11.0, metCompendiumCode: "e_sled", metIsEstimated: true },
  { canonicalName: "Farmers Carry",   metValue: 8.0,  metCompendiumCode: "e_carry", metIsEstimated: true, metNotes: "Loaded gait; above unloaded vigorous calisthenics." },
  { canonicalName: "Sandbag Lunges",  metValue: 8.5,  metCompendiumCode: "e_sandbag_lunge", metIsEstimated: true, repSecondsDefault: 2.0 },

  // ---------- Rest ----------
  { canonicalName: "Rest",   metValue: 1.3, metCompendiumCode: "07021", metNotes: "Sitting / coach brief." },
];
