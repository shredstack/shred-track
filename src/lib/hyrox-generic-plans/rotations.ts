// ---------------------------------------------------------------------------
// Station rotation
//
// Monday and Wednesday "station skills" slots each target 2 stations of
// the 8. A full sweep of all 8 stations happens every 2 weeks.
//
// The 8 stations naturally split into:
//   - Machine pair: SkiErg + Rowing (pacing stations)
//   - Strength pair: Sled Push + Sled Pull
//   - Gymnastics pair: Burpee Broad Jumps + Sandbag Lunges
//   - Grip/metabolic pair: Farmers Carry + Wall Balls
//
// Week A covers machine + strength; Week B covers gymnastics + grip.
// This pairs complementary stations so each session has varied demands,
// and guarantees every station gets trained ~9 times across 18 weeks.
// ---------------------------------------------------------------------------

import type { StationName } from "@/lib/hyrox-data";

export interface WeeklyRotation {
  mon: [StationName, StationName];
  wed: [StationName, StationName];
}

const WEEK_A: WeeklyRotation = {
  mon: ["SkiErg", "Wall Balls"],       // pace + grip
  wed: ["Sled Push", "Farmers Carry"], // push + carry
};

const WEEK_B: WeeklyRotation = {
  mon: ["Rowing", "Sandbag Lunges"],            // pace + legs
  wed: ["Sled Pull", "Burpee Broad Jumps"],     // pull + gymnastics
};

export function rotationForWeek(week: number): WeeklyRotation {
  return week % 2 === 1 ? WEEK_A : WEEK_B;
}

/** All 8 stations in their race order — used for Saturday full-rotation sessions. */
export const ALL_STATIONS_IN_ORDER: readonly StationName[] = [
  "SkiErg",
  "Sled Push",
  "Sled Pull",
  "Burpee Broad Jumps",
  "Rowing",
  "Farmers Carry",
  "Sandbag Lunges",
  "Wall Balls",
] as const;
