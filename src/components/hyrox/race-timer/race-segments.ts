import { DIVISIONS, STATION_ORDER, type DivisionKey } from "@/lib/hyrox-data";
import type { RaceSegment } from "./types";

let nextId = 1;
function uid(): string {
  return `seg-${nextId++}-${Date.now()}`;
}

export const ROXZONE_DISTANCE_M = 100;

export interface BuildRaceOptions {
  /** When true, insert a 100m Roxzone segment after every station that is
   *  followed by a run — simulates the transition zone covered on race day.
   *  See claude_code_instructions/hyrox_specs/roxzone_simulation_spec.md. */
  simulateRoxzone?: boolean;
}

function createRoxzoneSegment(): RaceSegment {
  return {
    id: uid(),
    segmentType: "run",
    segmentSubtype: "roxzone",
    label: "Roxzone",
    distance: `${ROXZONE_DISTANCE_M}m`,
  };
}

/**
 * Insert a Roxzone segment after every station that is followed by a run.
 * Skips the final station (no Roxzone after the last segment) so a half
 * race ending on a station and a full race ending on Wall Balls both
 * "do the right thing" automatically.
 */
function insertRoxzoneSegments(segments: RaceSegment[]): RaceSegment[] {
  const out: RaceSegment[] = [];
  for (let i = 0; i < segments.length; i++) {
    out.push(segments[i]);
    const isStation = segments[i].segmentType === "station";
    const nextIsRun = segments[i + 1]?.segmentType === "run";
    if (isStation && nextIsRun) {
      out.push(createRoxzoneSegment());
    }
  }
  return out;
}

/** Build the default full HYROX race segments for a given division */
export function buildFullRaceSegments(
  divisionKey: DivisionKey,
  options?: BuildRaceOptions,
): RaceSegment[] {
  const div = DIVISIONS[divisionKey];
  if (!div) return buildFullRaceSegments("women_open", options);

  const segments: RaceSegment[] = [];
  const runDist =
    div.runDistanceM >= 1000
      ? `${div.runDistanceM / 1000} km`
      : `${div.runDistanceM}m`;

  if (div.runSegments === 8) {
    // Standard alternating format
    for (let i = 0; i < 8; i++) {
      const station = div.stations[i];
      segments.push({
        id: uid(),
        segmentType: "run",
        segmentSubtype: "prescribed_run",
        label: `Run ${i + 1}`,
        distance: runDist,
      });
      segments.push({
        id: uid(),
        segmentType: "station",
        label: station.name,
        distance: station.distance,
        reps: station.reps,
        weightLabel: station.weightLabel,
      });
    }
  } else {
    // Youngstars grouped format — still create run/station pairs for timing
    let runNum = 1;
    let stationIdx = 0;
    const stationsPerRun =
      div.runSegments === 3 ? [4, 3, 1] : [7, 1]; // 3-run or 2-run

    for (const count of stationsPerRun) {
      segments.push({
        id: uid(),
        segmentType: "run",
        segmentSubtype: "prescribed_run",
        label: `Run ${runNum++}`,
        distance: runDist,
      });
      for (let j = 0; j < count && stationIdx < div.stations.length; j++) {
        const station = div.stations[stationIdx++];
        segments.push({
          id: uid(),
          segmentType: "station",
          label: station.name,
          distance: station.distance,
          reps: station.reps,
          weightLabel: station.weightLabel,
        });
      }
    }
  }

  return options?.simulateRoxzone ? insertRoxzoneSegments(segments) : segments;
}

/** Build a half race (4 runs + 4 stations, first half of the standard order) */
export function buildHalfRaceSegments(
  divisionKey: DivisionKey,
  options?: BuildRaceOptions,
): RaceSegment[] {
  // Build the half WITHOUT roxzone first, then insert — keeps the
  // "no Roxzone after the final station" rule automatic.
  const full = buildFullRaceSegments(divisionKey);
  const half = full.slice(0, 8).map((s) => ({ ...s, id: uid() }));
  return options?.simulateRoxzone ? insertRoxzoneSegments(half) : half;
}

/** Create a blank run segment */
export function createRunSegment(distance = "1 km"): RaceSegment {
  return { id: uid(), segmentType: "run", label: "Run", distance };
}

/** Create a blank station segment */
export function createStationSegment(
  name: string = "Custom Station",
): RaceSegment {
  return { id: uid(), segmentType: "station", label: name };
}

/** Available stations for the "Add Station" picker */
export const AVAILABLE_STATIONS = [
  ...STATION_ORDER,
  "Custom Station",
] as const;
