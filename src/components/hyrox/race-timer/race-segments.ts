import { DIVISIONS, STATION_ORDER, type DivisionKey } from "@/lib/hyrox-data";
import type { RaceSegment } from "./types";

let nextId = 1;
function uid(): string {
  return `seg-${nextId++}-${Date.now()}`;
}

/** Build the default full HYROX race segments for a given division */
export function buildFullRaceSegments(divisionKey: DivisionKey): RaceSegment[] {
  const div = DIVISIONS[divisionKey];
  if (!div) return buildFullRaceSegments("women_open");

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

  return segments;
}

/** Build a half race (4 runs + 4 stations, first half of the standard order) */
export function buildHalfRaceSegments(divisionKey: DivisionKey): RaceSegment[] {
  const full = buildFullRaceSegments(divisionKey);
  // Take the first 8 segments (4 run + 4 station pairs)
  return full.slice(0, 8).map((s) => ({ ...s, id: uid() }));
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
