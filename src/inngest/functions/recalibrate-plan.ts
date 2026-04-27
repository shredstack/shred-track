import { inngest } from "../client";
import { db } from "@/db";
import {
  hyroxTrainingPlans,
  hyroxPlanSessions,
  hyroxStationBenchmarks,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { AthleteSnapshot } from "@/types/hyrox-plan";
import { STATION_ORDER } from "@/lib/hyrox-data";

// ---------------------------------------------------------------------------
// Plan recalibration
//
// Triggered when an athlete elects to refresh upcoming weeks based on a fresh
// race result. We:
//   1. Pull the plan + its athleteSnapshot (the snapshot used during initial
//      generation).
//   2. Update the snapshot's stationAssessments using the most recent benchmark
//      times (which now include the race).
//   3. Fire `hyrox/week.regenerate` for each week >= today's week so that the
//      existing regenerator handles the actual session writes.
//   4. Clear the recalibration flag on the plan.
// ---------------------------------------------------------------------------

interface RecalibratePlanEvent {
  data: { planId: string; userId: string };
}

// Map a benchmark goal time as a "best time so far" → confidence on a 1–5 scale.
// Heuristic only; real signal lives in the AI prompt downstream.
function inferConfidence(currentSeconds: number, goalSeconds: number | null): number {
  if (!goalSeconds) return 3;
  const ratio = currentSeconds / goalSeconds;
  if (ratio <= 1.0) return 5;
  if (ratio <= 1.1) return 4;
  if (ratio <= 1.25) return 3;
  if (ratio <= 1.5) return 2;
  return 1;
}

export const recalibratePlan = inngest.createFunction(
  {
    id: "hyrox-recalibrate-plan",
    retries: 1,
    triggers: [{ event: "hyrox/plan.recalibrate" }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: { event: RecalibratePlanEvent; step: any }) => {
    const { planId, userId } = event.data;

    // Step 1: fetch plan + its athlete snapshot.
    const planContext = await step.run("fetch-plan", async () => {
      const [plan] = await db
        .select()
        .from(hyroxTrainingPlans)
        .where(
          and(
            eq(hyroxTrainingPlans.id, planId),
            eq(hyroxTrainingPlans.userId, userId),
          ),
        )
        .limit(1);

      if (!plan) throw new Error(`Plan ${planId} not found`);
      if (plan.status !== "active") {
        throw new Error(`Plan ${planId} is not active`);
      }

      // Pull the athlete snapshot (jsonb).
      const snapshot = plan.athleteSnapshot as AthleteSnapshot | null;
      if (!snapshot) throw new Error(`Plan ${planId} missing athleteSnapshot`);

      return { plan, snapshot };
    });

    // Step 2: refresh stationAssessments from latest benchmarks.
    const updatedSnapshot = await step.run("refresh-assessments", async () => {
      const benchmarks = await db
        .select()
        .from(hyroxStationBenchmarks)
        .where(eq(hyroxStationBenchmarks.userId, userId));

      // For each station, take the BEST (lowest) recent time.
      const bestByStation = new Map<string, number>();
      for (const row of benchmarks) {
        const cur = bestByStation.get(row.station);
        if (cur == null || row.timeSeconds < cur) {
          bestByStation.set(row.station, row.timeSeconds);
        }
      }

      type Assessment = AthleteSnapshot["stationAssessments"][number];
      const oldAssessments = planContext.snapshot.stationAssessments as Assessment[];
      const oldAssessmentByStation = new Map<string, Assessment>(
        oldAssessments.map((a: Assessment) => [a.station, a]),
      );

      const newAssessments = (STATION_ORDER as readonly string[]).map(
        (station) => {
          const old = oldAssessmentByStation.get(station);
          const goal = old?.goalTimeSeconds ?? null;
          const best = bestByStation.get(station);
          if (best != null) {
            return {
              station,
              completionConfidence: inferConfidence(best, goal),
              currentTimeSeconds: best,
              goalTimeSeconds: goal,
            };
          }
          // No data yet — keep what we had.
          return (
            old ?? {
              station,
              completionConfidence: 3,
              currentTimeSeconds: null,
              goalTimeSeconds: goal,
            }
          );
        },
      );

      const next: AthleteSnapshot = {
        ...planContext.snapshot,
        stationAssessments: newAssessments,
      };

      // Persist back so future regenerations see the new snapshot.
      await db
        .update(hyroxTrainingPlans)
        .set({ athleteSnapshot: next })
        .where(eq(hyroxTrainingPlans.id, planId));

      return next;
    });

    // Step 3: identify unfinished weeks.
    const unfinishedWeeks = await step.run("find-unfinished-weeks", async () => {
      const sessions = await db
        .select()
        .from(hyroxPlanSessions)
        .where(eq(hyroxPlanSessions.planId, planId));

      const startDate = new Date(planContext.plan.startDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const daysSinceStart = Math.floor(
        (today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      const currentWeek = Math.max(1, Math.floor(daysSinceStart / 7) + 1);

      const weeks = Array.from(new Set(sessions.map((s) => s.week))).sort(
        (a, b) => a - b,
      );
      // Recalibrate the CURRENT week + all future weeks. Past weeks stay frozen.
      return weeks.filter((w) => w >= currentWeek);
    });

    // Step 4: dispatch a regenerate event per unfinished week.
    await step.run("dispatch-regenerations", async () => {
      const weeks: number[] = unfinishedWeeks;
      if (weeks.length === 0) return;
      await inngest.send(
        weeks.map((weekNumber: number) => ({
          name: "hyrox/week.regenerate" as const,
          data: {
            planId,
            weekNumber,
            constraints:
              "RECALIBRATION: Athlete just completed a race that revealed updated weak stations. Re-prioritize station rotation and emphasize the lowest-confidence stations from the snapshot.",
            snapshot: updatedSnapshot,
          },
        })),
      );
    });

    // Step 5: clear the recalibration flag.
    await step.run("clear-flag", async () => {
      await db
        .update(hyroxTrainingPlans)
        .set({
          recalibrationSuggestedAt: null,
          recalibrationSourceRaceId: null,
        })
        .where(eq(hyroxTrainingPlans.id, planId));
    });

    return { planId, regenerated: unfinishedWeeks };
  },
);
