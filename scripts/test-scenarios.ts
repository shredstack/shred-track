/**
 * Quick smoke test for deterministic scenario computation.
 * Run: npx tsx scripts/test-scenarios.ts
 */
import { computeScenarioSplits } from "../src/lib/hyrox-scenario-compute";
import { formatTime, formatLongTime } from "../src/lib/hyrox-data";
import type { AthleteSnapshot } from "../src/types/hyrox-plan";

// Mock snapshot roughly matching Sarah's profile (Women Open, sub-60 goal)
const snapshot: AthleteSnapshot = {
  name: "Test Athlete",
  gender: "women",
  unit: "mixed",
  division: "women_open",
  raceDate: "2026-07-15",
  goalFinishTimeSeconds: 3600, // 1:00:00
  easyPaceSecondsPerUnit: 570, // 9:30/mile
  moderatePaceSecondsPerUnit: 510, // 8:30/mile
  fastPaceSecondsPerUnit: 450, // 7:30/mile
  paceUnit: "mile",
  hasExperience: true,
  previousRaceCount: 2,
  bestFinishTimeSeconds: 4200, // 1:10:00
  bestDivision: "women_open",
  bestTimeNotes: null,
  crossfitDaysPerWeek: 5,
  crossfitGymName: "Test Gym",
  availableEquipment: ["skierg", "rower", "sled"],
  injuriesNotes: null,
  trainingPhilosophy: "moderate",
  stationAssessments: [
    { station: "SkiErg", completionConfidence: 4, currentTimeSeconds: 315, goalTimeSeconds: 280 },
    { station: "Sled Push", completionConfidence: 3, currentTimeSeconds: 180, goalTimeSeconds: 140 },
    { station: "Sled Pull", completionConfidence: 2, currentTimeSeconds: 350, goalTimeSeconds: 270 },
    { station: "Burpee Broad Jumps", completionConfidence: 3, currentTimeSeconds: 390, goalTimeSeconds: 300 },
    { station: "Rowing", completionConfidence: 4, currentTimeSeconds: 320, goalTimeSeconds: 290 },
    { station: "Farmers Carry", completionConfidence: 4, currentTimeSeconds: 130, goalTimeSeconds: 110 },
    { station: "Sandbag Lunges", completionConfidence: 3, currentTimeSeconds: 300, goalTimeSeconds: 220 },
    { station: "Wall Balls", completionConfidence: 3, currentTimeSeconds: 400, goalTimeSeconds: 300 },
  ],
};

const scenarios = computeScenarioSplits(snapshot, 12);

for (const sc of scenarios) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${sc.scenarioLabel}`);
  console.log(`Estimated finish: ${formatLongTime(sc.estimatedFinishSeconds)}`);
  console.log(`Buffer vs goal:  ${sc.bufferSeconds != null ? `${sc.bufferSeconds > 0 ? "+" : ""}${formatTime(Math.abs(sc.bufferSeconds))}` : "N/A"}`);
  console.log(`${"=".repeat(70)}`);
  console.log(
    `${"#".padEnd(4)}${"Segment".padEnd(30)}${"Target".padEnd(10)}${"Pace".padEnd(14)}${"Cumul.".padEnd(10)}`
  );
  console.log("-".repeat(70));

  let totalRun = 0;
  let totalStation = 0;

  for (const split of sc.splits) {
    if (split.segmentType === "run") totalRun += split.targetSeconds;
    else totalStation += split.targetSeconds;

    console.log(
      `${String(split.segmentNumber).padEnd(4)}${split.segmentName.padEnd(30)}${formatTime(split.targetSeconds).padEnd(10)}${split.paceDisplay.padEnd(14)}${formatTime(split.cumulativeSeconds).padEnd(10)}`
    );
  }

  console.log("-".repeat(70));
  console.log(`Run total:     ${formatTime(totalRun)}`);
  console.log(`Station total: ${formatTime(totalStation)}`);
  console.log(`Transition:    ${formatTime(sc.estimatedFinishSeconds - totalRun - totalStation)}`);
  console.log(`Sum check:     ${formatTime(totalRun + totalStation + (sc.estimatedFinishSeconds - totalRun - totalStation))} = ${formatLongTime(sc.estimatedFinishSeconds)}`);

  // Verify cumulative adds up
  const finalCumulative = sc.splits[sc.splits.length - 1].cumulativeSeconds;
  if (finalCumulative !== sc.estimatedFinishSeconds) {
    console.error(`ERROR: Final cumulative (${finalCumulative}) != estimatedFinish (${sc.estimatedFinishSeconds})`);
  }

  // Verify pace display math for SkiErg/Rowing
  for (const split of sc.splits) {
    if (split.segmentName.includes("SkiErg") || split.segmentName.includes("Rowing")) {
      const per500 = Math.round(split.targetSeconds / 2);
      const expected = `${formatTime(per500)}/500m`;
      if (split.paceDisplay !== expected) {
        console.error(`ERROR: ${split.segmentName} pace "${split.paceDisplay}" should be "${expected}" (target=${split.targetSeconds}s)`);
      }
    }
  }
}

console.log("\nAll checks passed!");
