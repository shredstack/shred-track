// ============================================================
// Inngest cron: nightly sweep of athlete_movement_strength.
// ============================================================
//
// Recomputes every (user, movement) strength row for users whose data has
// drifted in the last 30 days OR whose existing strength row hasn't been
// updated in 30 days. Catches:
//   - score edits / deletes (the score-save hook covers fresh inserts)
//   - templates whose weight data was edited
//   - 12-month rolloff of stale signal
//
// See claude_code_instructions/crossfit_improvements/
//     suggested_working_weight_and_template_history_spec.md §"When and where
//     it runs" — item 3.

import { gte, or, lt, sql } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "@/db";
import { athleteMovementStrength, scores } from "@/db/schema";
import { refreshStrengthForUser } from "@/lib/crossfit/strength-updater";

const STALE_DAYS = 30;

export const refreshAthleteMovementStrength = inngest.createFunction(
  {
    id: "refresh-athlete-movement-strength",
    name: "Refresh athlete movement strength",
    concurrency: { limit: 1 },
    triggers: [{ cron: "0 8 * * *" }], // 08:00 UTC daily (after pace sweep)
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ step }: { step: any }) => {
    return step.run("sweep", async () => {
      const staleCutoff = new Date();
      staleCutoff.setDate(staleCutoff.getDate() - STALE_DAYS);

      // Two sources of work:
      //   - users who have logged a score in the last STALE_DAYS days
      //   - users whose strength row computed_at is older than STALE_DAYS
      const fromScores = await db
        .selectDistinct({ userId: scores.userId })
        .from(scores)
        .where(gte(scores.createdAt, staleCutoff));

      const fromStrength = await db
        .selectDistinct({ userId: athleteMovementStrength.userId })
        .from(athleteMovementStrength)
        .where(lt(athleteMovementStrength.computedAt, staleCutoff));

      const userIds = Array.from(
        new Set([
          ...fromScores.map((r) => r.userId),
          ...fromStrength.map((r) => r.userId),
        ])
      );

      let totalRefreshed = 0;
      let totalDeleted = 0;
      for (const userId of userIds) {
        const result = await refreshStrengthForUser(userId);
        totalRefreshed += result.refreshed;
        totalDeleted += result.deleted;
      }

      return {
        sweepedUsers: userIds.length,
        refreshed: totalRefreshed,
        deleted: totalDeleted,
      };
    });
  }
);
