// ============================================================
// Pace → MET lookup tables.
// ============================================================
// Used when a movement is `is_paced_run` or `is_paced_erg` — a single MET per
// movement can't capture the 2-3x energy swing between recovery and sprint
// paces. Runs are keyed by seconds-per-km, ergs by seconds-per-500m.

export interface PaceMetPoint {
  /** Seconds for the canonical pace unit. Run: per km. Erg: per 500m. */
  paceSeconds: number;
  met: number;
}

// Canonical Compendium running table (12010–12130) converted to sec/km.
// Linearly interpolate between rows; cap at endpoints.
export const RUN_PACE_TABLE: PaceMetPoint[] = [
  { paceSeconds: 485, met: 6.5 },   // 13:00/mi
  { paceSeconds: 447, met: 8.5 },   // 12:00/mi
  { paceSeconds: 406, met: 9.0 },   // 10:55/mi
  { paceSeconds: 373, met: 9.3 },   // 10:00/mi
  { paceSeconds: 335, met: 10.5 },  // 9:00/mi
  { paceSeconds: 319, met: 11.0 },  // 8:34/mi
  { paceSeconds: 279, met: 11.8 },  // 7:30/mi
  { paceSeconds: 261, met: 12.3 },  // 7:00/mi
  { paceSeconds: 224, met: 14.5 },  // 6:00/mi
  { paceSeconds: 205, met: 16.0 },  // 5:30/mi
  { paceSeconds: 186, met: 19.0 },  // 5:00/mi
];

// SkiErg pace → MET. Canonical pace unit is sec/500m.
export const SKIERG_PACE_TABLE: PaceMetPoint[] = [
  { paceSeconds: 150, met: 6.5 },   // 2:30+
  { paceSeconds: 135, met: 8.5 },   // 2:15
  { paceSeconds: 120, met: 10.5 },  // 2:00
  { paceSeconds: 110, met: 13.0 },  // 1:50
  { paceSeconds: 100, met: 15.5 },  // 1:40
  { paceSeconds:  90, met: 18.0 },  // ≤1:30
];

/**
 * Linear interpolation between adjacent rows; clamped at endpoints.
 * Slower-than-table → bottom value; faster-than-table → top value.
 * Tables must be sorted descending by `paceSeconds` (slow → fast).
 */
function lookupPace(table: PaceMetPoint[], paceSeconds: number): number {
  if (paceSeconds >= table[0].paceSeconds) return table[0].met;
  if (paceSeconds <= table[table.length - 1].paceSeconds) {
    return table[table.length - 1].met;
  }
  for (let i = 0; i < table.length - 1; i++) {
    const a = table[i];
    const b = table[i + 1];
    if (paceSeconds <= a.paceSeconds && paceSeconds >= b.paceSeconds) {
      const t = (a.paceSeconds - paceSeconds) / (a.paceSeconds - b.paceSeconds);
      return a.met + t * (b.met - a.met);
    }
  }
  return table[table.length - 1].met;
}

export function metForRunPace(secondsPerKm: number): number {
  return lookupPace(RUN_PACE_TABLE, secondsPerKm);
}

export function metForSkiErgPace(secondsPer500m: number): number {
  return lookupPace(SKIERG_PACE_TABLE, secondsPer500m);
}

/**
 * Row erg: convert pace to watts via Concept2's `watts ≈ 2.8 / (sec_per_meter)³`,
 * then bucket into Compendium codes 02071–02074.
 */
export function metForRowPace(secondsPer500m: number): number {
  if (secondsPer500m <= 0) return 7.5;
  const secPerMeter = secondsPer500m / 500;
  const watts = 2.8 / Math.pow(secPerMeter, 3);
  if (watts >= 200) return 14.0;
  if (watts >= 150) return 11.0;
  if (watts >= 100) return 7.5;
  return 5.0;
}
