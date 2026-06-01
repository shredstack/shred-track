import type { BenchmarkAttempt, WorkoutType } from "@/types/crossfit";

// Renders a single benchmark attempt's score in the most natural form for
// its workout type: "5:32" for time, "12+8" or "120 reps" for AMRAP,
// "225 lb" for max-load. Falls through workout-type-agnostic fallbacks
// when the primary metric is missing (e.g. an AMRAP without rounds breaks
// to whatever metric the user did populate).
export function formatBenchmarkAttempt(
  workoutType: WorkoutType,
  a: Pick<
    BenchmarkAttempt,
    | "scoreText"
    | "timeSeconds"
    | "totalReps"
    | "weightLbs"
    | "rounds"
    | "remainderReps"
  >
): string {
  if (a.scoreText) return a.scoreText;
  if (workoutType === "for_time" && a.timeSeconds != null) {
    return formatMmSs(a.timeSeconds);
  }
  if (workoutType === "amrap") {
    if (a.totalReps != null) return `${a.totalReps} reps`;
    if (a.rounds != null) return `${a.rounds}+${a.remainderReps ?? 0}`;
  }
  if (workoutType === "for_load" || workoutType === "max_effort") {
    if (a.weightLbs != null) return `${a.weightLbs} lb`;
  }
  if (
    workoutType === "for_reps" ||
    workoutType === "for_calories" ||
    workoutType === "tabata"
  ) {
    if (a.totalReps != null) return `${a.totalReps} reps`;
  }
  if (a.timeSeconds != null) return formatMmSs(a.timeSeconds);
  if (a.totalReps != null) return `${a.totalReps} reps`;
  if (a.weightLbs != null) return `${a.weightLbs} lb`;
  return "—";
}

function formatMmSs(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
