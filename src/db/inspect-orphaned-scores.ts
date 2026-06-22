import "dotenv/config";
import { db } from "./index";
import {
  scores,
  crossfitWorkoutParts,
  workoutSessions,
} from "./schema";
import { eq, isNotNull, and } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

// Read-only: find scores whose crossfit_workout_part_id points at a part that
// belongs to a template DIFFERENT from the score's session's current template
// (the fork-orphan signature), plus scores pointing at a part that no longer
// exists at all.
async function main() {
  const scorePart = alias(crossfitWorkoutParts, "score_part");

  const rows = await db
    .select({
      scoreId: scores.id,
      userId: scores.userId,
      sessionId: scores.workoutSessionId,
      scorePartId: scores.crossfitWorkoutPartId,
      sessionTemplateId: workoutSessions.crossfitWorkoutId,
      // The template the score's part actually belongs to (null if the part
      // was hard-deleted, e.g. an in-place edit).
      scorePartTemplateId: scorePart.crossfitWorkoutId,
      scorePartOrderIndex: scorePart.orderIndex,
    })
    .from(scores)
    .innerJoin(workoutSessions, eq(workoutSessions.id, scores.workoutSessionId))
    .leftJoin(scorePart, eq(scorePart.id, scores.crossfitWorkoutPartId))
    .where(
      and(
        isNotNull(scores.workoutSessionId),
        isNotNull(scores.crossfitWorkoutPartId)
      )
    );

  const orphaned = rows.filter(
    (r) =>
      r.scorePartTemplateId === null || // part deleted
      r.scorePartTemplateId !== r.sessionTemplateId // part on a different template than the session now uses
  );

  console.log(`Total session-linked scores: ${rows.length}`);
  console.log(`Orphaned scores: ${orphaned.length}`);
  for (const o of orphaned) {
    console.log(JSON.stringify(o, null, 2));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
