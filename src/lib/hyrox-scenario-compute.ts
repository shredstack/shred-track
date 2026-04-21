// ---------------------------------------------------------------------------
// Deterministic HYROX Race Scenario Computation
//
// Computes race-day scenario splits using real percentile data from scraped
// HYROX results. All numeric values (targetSeconds, paceDisplay,
// cumulativeSeconds, estimatedFinishSeconds) are computed here — never by AI.
// ---------------------------------------------------------------------------

import type { AthleteSnapshot } from "@/types/hyrox-plan";
import type { ScenarioSplit, RaceScenario } from "@/types/hyrox-plan";
import {
  STATION_ORDER,
  DIVISION_REF_DATA,
  DIVISIONS,
  estimatePercentile,
  formatTime,
  type DivisionKey,
  type StationName,
  type RefDistribution,
} from "@/lib/hyrox-data";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Numeric scenario skeleton — everything except AI-generated text fields */
export interface NumericScenario {
  scenarioLabel: string;
  sortOrder: number;
  estimatedFinishSeconds: number;
  bufferSeconds: number | null;
  splits: ScenarioSplit[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KNOWN_PERCENTILES = [10, 25, 50, 75, 90] as const;

/** Total transition time in seconds by level */
const TRANSITION_TOTAL_PRO = 180; // ~22.5s per transition
const TRANSITION_TOTAL_STANDARD = 300; // ~37.5s per transition
const NUM_TRANSITIONS = 16;

// ---------------------------------------------------------------------------
// Percentile ↔ seconds interpolation
// ---------------------------------------------------------------------------

/**
 * Inverse of estimatePercentile: given a target percentile, return the
 * estimated time in seconds by interpolating between known quantile points.
 *
 * Lower percentile = faster/better (matches estimatePercentile convention).
 */
export function secondsAtPercentile(
  percentile: number,
  dist: RefDistribution,
): number {
  const p = Math.max(1, Math.min(99, percentile));

  // Below p10 — extrapolate
  if (p <= 10) {
    return Math.round(dist[0] * (p / 10));
  }
  // Above p90 — extrapolate
  if (p >= 90) {
    const ratio = (p - 90) / 10;
    return Math.round(dist[4] + ratio * (dist[4] - dist[2]));
  }
  // Interpolate between adjacent known points
  for (let i = 0; i < KNOWN_PERCENTILES.length - 1; i++) {
    if (p <= KNOWN_PERCENTILES[i + 1]) {
      const pLow = KNOWN_PERCENTILES[i];
      const pHigh = KNOWN_PERCENTILES[i + 1];
      const fraction = (p - pLow) / (pHigh - pLow);
      return Math.round(dist[i] + fraction * (dist[i + 1] - dist[i]));
    }
  }
  return Math.round(dist[2]); // fallback to median
}

// ---------------------------------------------------------------------------
// Improvement model
// ---------------------------------------------------------------------------

/**
 * Compute how many percentile points an athlete can realistically improve
 * given training weeks and philosophy.
 *
 * Returns a factor 0..1 representing what fraction of the gap between
 * current percentile and the floor (p10) can be closed.
 *
 * Heuristic:
 *   - More weeks → more improvement (logarithmic, diminishing returns)
 *   - Aggressive philosophy → ~50% more improvement than conservative
 *   - Caps at 0.6 (you can't close 100% of the gap in one training cycle)
 */
function improvementFactor(
  totalWeeks: number,
  philosophy: string,
): number {
  // Base factor: logarithmic curve, 4 weeks → ~0.15, 12 weeks → ~0.25, 24 weeks → ~0.35
  const weekFactor = Math.min(0.35, 0.1 * Math.log2(Math.max(4, totalWeeks) / 2));

  const philosophyMultiplier =
    philosophy === "aggressive" ? 1.5 :
    philosophy === "moderate" ? 1.2 :
    1.0; // conservative

  return Math.min(0.6, weekFactor * philosophyMultiplier);
}

// ---------------------------------------------------------------------------
// Pace display helpers
// ---------------------------------------------------------------------------

/**
 * Format pace display for a split segment.
 *
 * - Runs: "X:XX/km"
 * - SkiErg / Rowing (1000m): "X:XX/500m"
 * - All other stations: "X:XX" (total time)
 */
function formatPaceDisplay(
  segmentType: "run" | "station",
  segmentName: string,
  targetSeconds: number,
): string {
  if (segmentType === "run") {
    return `${formatTime(targetSeconds)}/km`;
  }
  // SkiErg and Rowing are 1000m — show /500m pace
  if (segmentName === "SkiErg" || segmentName === "Rowing") {
    return `${formatTime(Math.round(targetSeconds / 2))}/500m`;
  }
  return formatTime(targetSeconds);
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

/**
 * Compute deterministic race-day scenarios from athlete data + real
 * HYROX percentile distributions.
 *
 * Returns 2-3 numeric scenario skeletons (no qualitative text).
 */
export function computeScenarioSplits(
  snapshot: AthleteSnapshot,
  totalWeeks: number,
): NumericScenario[] {
  const division = snapshot.division;
  const refData = DIVISION_REF_DATA[division];
  const divSpec = DIVISIONS[division];

  // -------------------------------------------------------------------------
  // Transition budget
  // -------------------------------------------------------------------------
  const isProLevel =
    division.includes("pro") ||
    (snapshot.goalFinishTimeSeconds != null && snapshot.goalFinishTimeSeconds <= 3600);
  const totalTransition = isProLevel ? TRANSITION_TOTAL_PRO : TRANSITION_TOTAL_STANDARD;
  const transitionPerSegment = totalTransition / NUM_TRANSITIONS;

  // -------------------------------------------------------------------------
  // Convert athlete run paces to per-km
  // -------------------------------------------------------------------------
  const paceToKm = (pacePerUnit: number): number =>
    snapshot.paceUnit === "mile" ? pacePerUnit / 1.60934 : pacePerUnit;

  const easyPacePerKm = paceToKm(snapshot.easyPaceSecondsPerUnit);
  const moderatePacePerKm = paceToKm(snapshot.moderatePaceSecondsPerUnit);

  // -------------------------------------------------------------------------
  // Resolve current & goal station times (with fallbacks to ref data)
  // -------------------------------------------------------------------------
  const assessmentMap = new Map(
    snapshot.stationAssessments.map((a) => [a.station, a]),
  );

  function currentStationTime(station: StationName): number {
    const assessment = assessmentMap.get(station);
    if (assessment?.currentTimeSeconds != null) return assessment.currentTimeSeconds;
    // Fallback: p50 (median) from reference data
    const dist = refData?.stations[station];
    return dist ? dist[2] : 300;
  }

  function goalStationTime(station: StationName): number {
    const assessment = assessmentMap.get(station);
    if (assessment?.goalTimeSeconds != null) return assessment.goalTimeSeconds;
    // Fallback: p10 (fast) from reference data
    const dist = refData?.stations[station];
    return dist ? dist[0] : 240;
  }

  // -------------------------------------------------------------------------
  // Compute per-run target seconds using real per-run distributions
  //
  // Instead of a flat run pace, we compute where the athlete currently sits
  // in the per-run distribution and then project improvement. This naturally
  // captures pacing patterns (Run 1 faster, post-BBJ run slower, etc.).
  // -------------------------------------------------------------------------
  const factor = improvementFactor(totalWeeks, snapshot.trainingPhilosophy);

  function computeRunTimes(
    basePacePerKm: number,
    improvementMultiplier: number, // 0 = no improvement, 1 = full factor
  ): number[] {
    const runTimes: number[] = [];
    for (let i = 0; i < 8; i++) {
      const runLabel = `Run ${i + 1}`;
      const runDist = refData?.runs[runLabel];
      if (runDist) {
        // Place athlete on this run's curve using their base pace
        const currentPct = estimatePercentile(basePacePerKm, runDist);
        // Improve toward p10 (scaled by factor × multiplier)
        const improvement = factor * improvementMultiplier;
        const targetPct = Math.max(
          5,
          currentPct - improvement * (currentPct - 10),
        );
        runTimes.push(secondsAtPercentile(targetPct, runDist));
      } else {
        // No per-run ref data — use flat pace with slight fatigue curve
        const fatigueFactor = 1 + 0.02 * i; // ~2% slower each run
        const improved = basePacePerKm * (1 - factor * improvementMultiplier * 0.1);
        runTimes.push(Math.round(improved * fatigueFactor));
      }
    }
    return runTimes;
  }

  function computeStationTimes(
    useGoal: boolean,
    improvementMultiplier: number, // 0 = current, 1 = full factor
  ): number[] {
    return STATION_ORDER.map((station) => {
      const current = currentStationTime(station);
      const goal = goalStationTime(station);

      if (useGoal && improvementMultiplier === 0) {
        // "Current fitness" scenario — no station improvement
        return current;
      }

      const dist = refData?.stations[station];
      if (dist) {
        const currentPct = estimatePercentile(current, dist);
        const goalPct = estimatePercentile(goal, dist);
        // Move from current toward goal, scaled by improvement factor
        const improvement = factor * improvementMultiplier;
        const targetPct = Math.max(
          5,
          currentPct - improvement * (currentPct - goalPct),
        );
        return secondsAtPercentile(targetPct, dist);
      }
      // No ref data — linear interpolation
      return Math.round(current - improvementMultiplier * factor * (current - goal));
    });
  }

  // -------------------------------------------------------------------------
  // Build split segments from run + station times
  // -------------------------------------------------------------------------
  function buildSplits(runTimes: number[], stationTimes: number[]): ScenarioSplit[] {
    const splits: ScenarioSplit[] = [];
    let cumulative = 0;

    for (let i = 0; i < 8; i++) {
      // Run segment
      const runSeconds = runTimes[i];
      cumulative += runSeconds + transitionPerSegment;
      splits.push({
        segmentNumber: i * 2 + 1,
        segmentType: "run",
        segmentName: `Run ${i + 1} (1km)`,
        targetSeconds: runSeconds,
        paceDisplay: formatPaceDisplay("run", `Run ${i + 1}`, runSeconds),
        strategy: "", // filled by AI later
        cumulativeSeconds: Math.round(cumulative),
      });

      // Station segment
      const stationName = STATION_ORDER[i];
      const stationSeconds = stationTimes[i];
      cumulative += stationSeconds + transitionPerSegment;

      // Build segment name with distance/reps info
      const stationSpec = divSpec?.stations[i];
      const stationLabel = stationSpec
        ? `${stationName} — ${stationSpec.distance ?? `${stationSpec.reps} reps`}`
        : stationName;

      splits.push({
        segmentNumber: i * 2 + 2,
        segmentType: "station",
        segmentName: stationLabel,
        targetSeconds: stationSeconds,
        paceDisplay: formatPaceDisplay("station", stationName, stationSeconds),
        strategy: "", // filled by AI later
        cumulativeSeconds: Math.round(cumulative),
      });
    }

    return splits;
  }

  // -------------------------------------------------------------------------
  // Scenario A: "Faster Runs" — run improvement, stations stay as current
  // -------------------------------------------------------------------------
  const scenarioARuns = computeRunTimes(easyPacePerKm, 1.0);
  const scenarioAStations = computeStationTimes(false, 0);
  const scenarioASplits = buildSplits(scenarioARuns, scenarioAStations);
  const scenarioAFinish = scenarioASplits[scenarioASplits.length - 1].cumulativeSeconds;

  const scenarioA: NumericScenario = {
    scenarioLabel: "Scenario A: Faster Runs",
    sortOrder: 0,
    estimatedFinishSeconds: scenarioAFinish,
    bufferSeconds: snapshot.goalFinishTimeSeconds
      ? snapshot.goalFinishTimeSeconds - scenarioAFinish
      : null,
    splits: scenarioASplits,
  };

  // -------------------------------------------------------------------------
  // Scenario B: "Full Improvement" — both runs and stations improve
  // -------------------------------------------------------------------------
  const scenarioBRuns = computeRunTimes(easyPacePerKm, 1.0);
  const scenarioBStations = computeStationTimes(true, 1.0);
  const scenarioBSplits = buildSplits(scenarioBRuns, scenarioBStations);
  const scenarioBFinish = scenarioBSplits[scenarioBSplits.length - 1].cumulativeSeconds;

  const scenarioB: NumericScenario = {
    scenarioLabel: "Scenario B: Full Improvement",
    sortOrder: 1,
    estimatedFinishSeconds: scenarioBFinish,
    bufferSeconds: snapshot.goalFinishTimeSeconds
      ? snapshot.goalFinishTimeSeconds - scenarioBFinish
      : null,
    splits: scenarioBSplits,
  };

  const scenarios: NumericScenario[] = [scenarioA, scenarioB];

  // -------------------------------------------------------------------------
  // Scenario C: "Conservative" — moderate improvement, only for 12+ weeks
  // -------------------------------------------------------------------------
  if (totalWeeks >= 12) {
    const scenarioCRuns = computeRunTimes(easyPacePerKm, 0.5);
    const scenarioCStations = computeStationTimes(true, 0.4);
    const scenarioCSplits = buildSplits(scenarioCRuns, scenarioCStations);
    const scenarioCFinish = scenarioCSplits[scenarioCSplits.length - 1].cumulativeSeconds;

    scenarios.push({
      scenarioLabel: "Scenario C: Conservative",
      sortOrder: 2,
      estimatedFinishSeconds: scenarioCFinish,
      bufferSeconds: snapshot.goalFinishTimeSeconds
        ? snapshot.goalFinishTimeSeconds - scenarioCFinish
        : null,
      splits: scenarioCSplits,
    });
  }

  return scenarios;
}
