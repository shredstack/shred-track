// ---------------------------------------------------------------------------
// Phase definitions — same shape for every pace tier and race format.
// Content inside each phase is calibrated by the renderer.
// ---------------------------------------------------------------------------

export interface GenericPhase {
  phaseNumber: number;
  name: string;
  description: string;
  startWeek: number;
  endWeek: number;
  focusAreas: string[];
}

export const PHASES: GenericPhase[] = [
  {
    phaseNumber: 1,
    name: "Foundation",
    description:
      "Build a running rhythm alongside your CrossFit schedule. Introduce all 8 HYROX stations at low intensity. The only goal this phase is showing up consistently.",
    startWeek: 1,
    endWeek: 3,
    focusAreas: ["consistency", "station familiarity", "aerobic base"],
  },
  {
    phaseNumber: 2,
    name: "Base Building",
    description:
      "Add easy-run volume and start timing station work. Every station gets touched every two weeks.",
    startWeek: 4,
    endWeek: 6,
    focusAreas: ["easy volume", "timed station benchmarks", "rotation coverage"],
  },
  {
    phaseNumber: 3,
    name: "Aerobic Development",
    description:
      "Tempo blocks lengthen. Every station gets benchmarked at full race distance. Saturday sessions introduce station work between runs.",
    startWeek: 7,
    endWeek: 10,
    focusAreas: ["tempo capacity", "full-distance station benchmarks", "transitions"],
  },
  {
    phaseNumber: 4,
    name: "Threshold Push",
    description:
      "Race-pace tempos get longer. Target aspirational station times. First half-race simulation.",
    startWeek: 11,
    endWeek: 13,
    focusAreas: ["race pace", "station aspirations", "half simulation"],
  },
  {
    phaseNumber: 5,
    name: "Race Specificity",
    description:
      "Two full race simulations land in this phase. Transitions, nutrition, kit rehearsal.",
    startWeek: 14,
    endWeek: 16,
    focusAreas: ["full race simulation", "race-day systems"],
  },
  {
    phaseNumber: 6,
    name: "Peak & Taper",
    description:
      "Volume drops meaningfully, intensity stays sharp. Race Saturday of Week 18.",
    startWeek: 17,
    endWeek: 18,
    focusAreas: ["sharpness", "recovery", "race week"],
  },
];

export function phaseForWeek(week: number): GenericPhase {
  for (const p of PHASES) {
    if (week >= p.startWeek && week <= p.endWeek) return p;
  }
  throw new Error(`No phase for week ${week}`);
}
