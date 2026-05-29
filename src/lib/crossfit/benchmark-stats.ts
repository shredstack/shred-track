import type { WorkoutType } from "@/types/crossfit";

export interface ScoreRow {
  scoreId: string;
  sessionId: string | null;
  workoutDate: string;
  division: string;
  timeSeconds: number | null;
  rounds: number | null;
  remainderReps: number | null;
  weightLbs: number | null;
  totalReps: number | null;
  scoreText: string | null;
  hitTimeCap: boolean;
  createdAt: string;
}

// "Best" depends on the workout type. Rules:
//   for_time   → lowest timeSeconds; capped attempts only count if no
//                un-capped attempt exists (a capped time isn't a finish).
//   amrap      → highest totalReps (or rounds*∞ approximation via totalReps);
//                fall back to (rounds, remainderReps) lexicographic.
//   for_load   → highest weightLbs.
//   for_reps,
//   for_calories,
//   tabata     → highest totalReps.
//   max_effort → highest weightLbs (treated like a strength benchmark).
//   emom,
//   other      → most recent attempt.
export function pickBestScore(
  workoutType: WorkoutType,
  rows: ScoreRow[]
): ScoreRow | null {
  if (rows.length === 0) return null;

  const cmpAmrap = (a: ScoreRow, b: ScoreRow) => {
    const aReps = a.totalReps ?? (a.rounds ?? 0) * 1000 + (a.remainderReps ?? 0);
    const bReps = b.totalReps ?? (b.rounds ?? 0) * 1000 + (b.remainderReps ?? 0);
    return bReps - aReps;
  };

  switch (workoutType) {
    case "for_time": {
      const finished = rows.filter(
        (r) => r.timeSeconds != null && !r.hitTimeCap
      );
      const pool = finished.length > 0 ? finished : rows.filter((r) => r.timeSeconds != null);
      if (pool.length === 0) return rows[0];
      return [...pool].sort((a, b) => (a.timeSeconds ?? Infinity) - (b.timeSeconds ?? Infinity))[0];
    }
    case "amrap":
      return [...rows].sort(cmpAmrap)[0];
    case "for_load":
    case "max_effort":
      return [...rows].sort(
        (a, b) => (b.weightLbs ?? -Infinity) - (a.weightLbs ?? -Infinity)
      )[0];
    case "for_reps":
    case "for_calories":
    case "tabata":
      return [...rows].sort(
        (a, b) => (b.totalReps ?? -Infinity) - (a.totalReps ?? -Infinity)
      )[0];
    default:
      return [...rows].sort(
        (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)
      )[0];
  }
}

// Format a score row into a short display string suited for the workout type.
export function formatBestScore(
  workoutType: WorkoutType,
  score: ScoreRow
): string {
  if (score.scoreText) return score.scoreText;
  switch (workoutType) {
    case "for_time": {
      if (score.timeSeconds == null) return "—";
      const m = Math.floor(score.timeSeconds / 60);
      const s = score.timeSeconds % 60;
      const base = `${m}:${s.toString().padStart(2, "0")}`;
      return score.hitTimeCap ? `${base} (capped)` : base;
    }
    case "amrap": {
      if (score.totalReps != null) return `${score.totalReps} reps`;
      if (score.rounds != null) {
        return `${score.rounds}+${score.remainderReps ?? 0}`;
      }
      return "—";
    }
    case "for_load":
    case "max_effort":
      return score.weightLbs != null ? `${score.weightLbs} lb` : "—";
    case "for_reps":
    case "for_calories":
    case "tabata":
      return score.totalReps != null ? `${score.totalReps} reps` : "—";
    default:
      if (score.timeSeconds != null) {
        const m = Math.floor(score.timeSeconds / 60);
        const s = score.timeSeconds % 60;
        return `${m}:${s.toString().padStart(2, "0")}`;
      }
      if (score.totalReps != null) return `${score.totalReps} reps`;
      if (score.weightLbs != null) return `${score.weightLbs} lb`;
      return "—";
  }
}
