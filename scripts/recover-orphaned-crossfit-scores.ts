/**
 * Recover CrossFit scores orphaned by a workout edit.
 *
 * Background
 * ----------
 * Editing a logged CrossFit WOD (e.g. reordering a movement) changes the
 * template's content fingerprint, which forks the session to a NEW template
 * with fresh part UUIDs. A score binds to a part via
 * `scores.crossfit_workout_part_id` — a column with NO foreign key — so the
 * old pointer is never updated. The score survives in the table but points at
 * a part that the relinked session no longer renders, so it disappears from
 * the UI. (The forward fix lives in src/app/api/workouts/[id]/route.ts, which
 * now repoints scores on every edit. This script heals rows orphaned BEFORE
 * that fix shipped.)
 *
 * What it does
 * ------------
 * 1. Finds scores whose part belongs to a template DIFFERENT from the score's
 *    session's current template.
 * 2. Determines whether the score is still "reachable" — i.e. some session in
 *    the same day group (same scope + date) still links to the part's
 *    template, so the UI day-view still renders it. Reachable scores are NOT
 *    lost and are SKIPPED.
 * 3. For each truly-lost score, proposes a target part: the part at the SAME
 *    order index in the session's current template. Prints both parts'
 *    movement lists so a human can confirm the match.
 *
 * Safety
 * ------
 * - DRY RUN by default. Prints a full report and writes nothing.
 * - Writes ONLY when APPLY=true AND the score id is listed in
 *   CONFIRM_SCORE_IDS (comma-separated). Double-gated on purpose so a prod run
 *   can never mass-repoint blindly.
 * - All writes run in a single transaction with before/after logging.
 *
 * Usage
 * -----
 *   # 1. Dry run against prod (report only):
 *   DATABASE_URL='postgres://…prod…' npx tsx scripts/recover-orphaned-crossfit-scores.ts
 *
 *   # 2. Apply to the specific score(s) you confirmed from the report:
 *   DATABASE_URL='postgres://…prod…' APPLY=true \
 *     CONFIRM_SCORE_IDS='64a312fd-…,abcdef…' \
 *     npx tsx scripts/recover-orphaned-crossfit-scores.ts
 */
import { db } from "../src/db/index";
import {
  scores,
  crossfitWorkouts,
  crossfitWorkoutParts,
  crossfitWorkoutMovements,
  workoutSessions,
  movements,
} from "../src/db/schema";
import { eq, and, isNotNull, inArray } from "drizzle-orm";

const APPLY = process.env.APPLY === "true";
const CONFIRM_SCORE_IDS = new Set(
  (process.env.CONFIRM_SCORE_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

type PartInfo = {
  id: string;
  templateId: string | null;
  orderIndex: number | null;
  templateTitle: string | null;
};

async function movementLabels(partId: string): Promise<string> {
  const mv = await db
    .select({ name: movements.canonicalName, ord: crossfitWorkoutMovements.orderIndex })
    .from(crossfitWorkoutMovements)
    .innerJoin(movements, eq(movements.id, crossfitWorkoutMovements.movementId))
    .where(eq(crossfitWorkoutMovements.crossfitWorkoutPartId, partId))
    .orderBy(crossfitWorkoutMovements.orderIndex);
  return mv.map((m) => `${m.ord}:${m.name}`).join(", ") || "(no movements)";
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN"}`);
  if (APPLY) console.log(`Confirmed score ids: ${[...CONFIRM_SCORE_IDS].join(", ") || "(none)"}\n`);

  // All session-linked scores joined to their session + the part's template.
  const rows = await db
    .select({
      scoreId: scores.id,
      userId: scores.userId,
      sessionId: scores.workoutSessionId,
      scorePartId: scores.crossfitWorkoutPartId,
      sessionTemplateId: workoutSessions.crossfitWorkoutId,
      sessionUserId: workoutSessions.userId,
      sessionCommunityId: workoutSessions.communityId,
      sessionDate: workoutSessions.workoutDate,
      partTemplateId: crossfitWorkoutParts.crossfitWorkoutId,
      partOrderIndex: crossfitWorkoutParts.orderIndex,
    })
    .from(scores)
    .innerJoin(workoutSessions, eq(workoutSessions.id, scores.workoutSessionId))
    .leftJoin(
      crossfitWorkoutParts,
      eq(crossfitWorkoutParts.id, scores.crossfitWorkoutPartId)
    )
    .where(
      and(
        isNotNull(scores.workoutSessionId),
        isNotNull(scores.crossfitWorkoutPartId)
      )
    );

  // Candidates: the score's part lives on a different template than the
  // session now uses (or the part is gone entirely).
  const candidates = rows.filter(
    (r) => r.partTemplateId == null || r.partTemplateId !== r.sessionTemplateId
  );

  console.log(`Session-linked scores: ${rows.length}`);
  console.log(`Cross-template candidates: ${candidates.length}\n`);

  const toApply: { scoreId: string; targetPartId: string }[] = [];

  for (const c of candidates) {
    // Day group = sessions sharing this session's scope + date.
    const scopeFilter = c.sessionCommunityId
      ? eq(workoutSessions.communityId, c.sessionCommunityId)
      : c.sessionUserId
        ? eq(workoutSessions.userId, c.sessionUserId)
        : null;
    const groupSessions = scopeFilter
      ? await db
          .select({ templateId: workoutSessions.crossfitWorkoutId })
          .from(workoutSessions)
          .where(and(scopeFilter, eq(workoutSessions.workoutDate, c.sessionDate)))
      : [];
    const groupTemplateIds = groupSessions
      .map((g) => g.templateId)
      .filter((id): id is string => !!id);

    // Rendered parts across the whole day group.
    const renderedParts: PartInfo[] = groupTemplateIds.length
      ? (
          await db
            .select({
              id: crossfitWorkoutParts.id,
              templateId: crossfitWorkoutParts.crossfitWorkoutId,
              orderIndex: crossfitWorkoutParts.orderIndex,
              templateTitle: crossfitWorkouts.title,
            })
            .from(crossfitWorkoutParts)
            .innerJoin(
              crossfitWorkouts,
              eq(crossfitWorkouts.id, crossfitWorkoutParts.crossfitWorkoutId)
            )
            .where(inArray(crossfitWorkoutParts.crossfitWorkoutId, groupTemplateIds))
        )
      : [];

    const reachable = renderedParts.some((p) => p.id === c.scorePartId);
    if (reachable) {
      // Still renders in the day view — not actually lost. Skip.
      continue;
    }

    // Propose the target: same order index within the session's current
    // template (if the session still has one).
    const target = renderedParts.find(
      (p) =>
        p.templateId === c.sessionTemplateId &&
        p.orderIndex === c.partOrderIndex
    );

    console.log("──────────────────────────────────────────────");
    console.log(`LOST score   : ${c.scoreId}  (user ${c.userId ?? c.sessionUserId})`);
    console.log(`Session      : ${c.sessionId}  date ${c.sessionDate}`);
    console.log(
      `Old part     : ${c.scorePartId}  (order ${c.partOrderIndex}, template ${c.partTemplateId ?? "DELETED"})`
    );
    if (c.scorePartId) console.log(`  movements  : ${await movementLabels(c.scorePartId)}`);
    if (!c.sessionTemplateId) {
      console.log("Target       : NONE — session has no current template. Manual review.");
      continue;
    }
    if (!target) {
      console.log(
        `Target       : NONE — current template ${c.sessionTemplateId} has no part at order ${c.partOrderIndex}. Manual review.`
      );
      continue;
    }
    console.log(
      `Target part  : ${target.id}  (order ${target.orderIndex}, template "${target.templateTitle}")`
    );
    console.log(`  movements  : ${await movementLabels(target.id)}`);

    if (APPLY && CONFIRM_SCORE_IDS.has(c.scoreId)) {
      toApply.push({ scoreId: c.scoreId, targetPartId: target.id });
      console.log("  -> WILL REPOINT (confirmed)");
    } else if (APPLY) {
      console.log("  -> skipped (not in CONFIRM_SCORE_IDS)");
    } else {
      console.log("  -> dry run (no write)");
    }
  }

  if (toApply.length > 0) {
    console.log(`\nApplying ${toApply.length} repoint(s)…`);
    await db.transaction(async (tx) => {
      for (const a of toApply) {
        await tx
          .update(scores)
          .set({ crossfitWorkoutPartId: a.targetPartId })
          .where(eq(scores.id, a.scoreId));
        console.log(`  repointed ${a.scoreId} -> ${a.targetPartId}`);
      }
    });
    console.log("Done.");
  } else if (APPLY) {
    console.log("\nNo confirmed scores to apply.");
  } else {
    console.log("\nDry run complete. Re-run with APPLY=true and CONFIRM_SCORE_IDS to repoint.");
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
