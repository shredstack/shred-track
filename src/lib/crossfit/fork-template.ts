// ---------------------------------------------------------------------------
// Fork-on-edit template helper.
//
// When the user edits a template's prescription:
//
//   1. Compute the new fingerprint.
//   2. If it matches an existing template in the same scope → just relink
//      the session to that template. No new row.
//   3. Else if the original template has no other sessions referencing it
//      AND no scores attached to any of its parts → safe to edit in place.
//      Replaces the parts/blocks/movements tree and updates workout-level
//      fields. The template id is preserved.
//   4. Else → create a new template with `forked_from_crossfit_workout_id`
//      pointing at the original. Old scores stay attached to the original
//      prescription; the session is relinked to the fork.
//
// System templates (`is_system = true`) are immutable here — the caller is
// expected to detect this case and route through a "save personalized
// version" UI flow that calls upsertTemplate with the user's scope.
// ---------------------------------------------------------------------------

import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import {
  crossfitWorkoutParts,
  crossfitWorkouts,
  scores,
  workoutSessions,
} from "@/db/schema";
import { computeWorkoutFingerprint } from "@/lib/crossfit/fingerprint";
import {
  buildFingerprintInput,
  insertTemplateParts,
  upsertTemplate,
  type UpsertTemplateInput,
  type UpsertTemplateResult,
} from "@/lib/crossfit/upsert-template";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

export type ForkResult = UpsertTemplateResult & {
  mode: "matched_existing" | "edited_in_place" | "forked";
};

export async function forkOrEditTemplate(
  tx: Tx,
  opts: {
    originalTemplateId: string;
    // The new prescription. Same shape upsertTemplate accepts.
    next: UpsertTemplateInput;
    // The session that triggered the edit. Used to detect "other sessions
    // reference this template" (we exclude the caller's own session). May
    // be null when called outside a session edit (rare).
    triggeringSessionId?: string | null;
  }
): Promise<ForkResult> {
  // Block edits to system templates — caller must route through a fork to
  // a personal/community scope first.
  const [orig] = await tx
    .select({
      id: crossfitWorkouts.id,
      isSystem: crossfitWorkouts.isSystem,
    })
    .from(crossfitWorkouts)
    .where(eq(crossfitWorkouts.id, opts.originalTemplateId))
    .limit(1);
  if (!orig) {
    throw new Error(`fork-template: original ${opts.originalTemplateId} not found`);
  }
  if (orig.isSystem) {
    throw new Error(
      "fork-template: cannot edit system template; create a scoped fork via upsertTemplate"
    );
  }

  const nextFingerprint = computeWorkoutFingerprint(
    buildFingerprintInput(opts.next)
  );

  // Step 2: scope-match an existing template by fingerprint. If found,
  // relink only — no need to mutate anything.
  const match = await upsertTemplate(tx, opts.next);
  if (!match.isNew && match.templateId !== opts.originalTemplateId) {
    return { ...match, mode: "matched_existing" };
  }
  if (!match.isNew && match.templateId === opts.originalTemplateId) {
    // Fingerprint unchanged — the prescription is identical to the original.
    // No-op fork; still considered "matched_existing" for the caller.
    return { ...match, mode: "matched_existing" };
  }

  // upsertTemplate inserted a fresh template (match.isNew) — but we may have
  // wanted to edit-in-place instead. Check if the original is safe to mutate.
  const safeToEdit = await isOriginalSafeToEditInPlace(tx, {
    originalTemplateId: opts.originalTemplateId,
    excludeSessionId: opts.triggeringSessionId ?? null,
  });

  if (!safeToEdit) {
    // Stamp the lineage on the freshly-created fork.
    await tx
      .update(crossfitWorkouts)
      .set({ forkedFromCrossfitWorkoutId: opts.originalTemplateId })
      .where(eq(crossfitWorkouts.id, match.templateId));
    return { ...match, mode: "forked" };
  }

  // Safe to edit in place. Roll back the new template we just created and
  // mutate the original instead. (We deliberately use upsertTemplate first
  // and unwind on the edit-in-place path because doing it the other way
  // would require duplicating the fingerprint-match check inline.)
  await tx
    .delete(crossfitWorkouts)
    .where(eq(crossfitWorkouts.id, match.templateId));

  // Replace parts/blocks/movements on the original.
  await tx
    .delete(crossfitWorkoutParts)
    .where(eq(crossfitWorkoutParts.crossfitWorkoutId, opts.originalTemplateId));

  await insertTemplateParts(tx, opts.originalTemplateId, opts.next.parts);

  // Update workout-level fields.
  await tx
    .update(crossfitWorkouts)
    .set({
      title: opts.next.title,
      description: opts.next.description ?? null,
      category: opts.next.category ?? null,
      weightliftingMovementId: opts.next.weightliftingMovementId ?? null,
      contentFingerprint: nextFingerprint,
      workoutType: opts.next.workoutType,
      timeCapSeconds: opts.next.timeCapSeconds ?? null,
      amrapDurationSeconds: opts.next.amrapDurationSeconds ?? null,
      repScheme: opts.next.repScheme ?? null,
      rounds: opts.next.rounds ?? null,
      vestRequirement: opts.next.vestRequirement ?? "none",
      vestWeightMaleLb:
        opts.next.vestWeightMaleLb != null
          ? String(opts.next.vestWeightMaleLb)
          : null,
      vestWeightFemaleLb:
        opts.next.vestWeightFemaleLb != null
          ? String(opts.next.vestWeightFemaleLb)
          : null,
      isPartner: !!opts.next.isPartner,
      partnerCount: opts.next.partnerCount ?? null,
      coachNotes: opts.next.coachNotes ?? null,
      updatedAt: sql`now()`,
    })
    .where(eq(crossfitWorkouts.id, opts.originalTemplateId));

  // Re-load part ids for the caller (same template id, fresh tree).
  const reloadedParts = await tx
    .select({
      id: crossfitWorkoutParts.id,
      orderIndex: crossfitWorkoutParts.orderIndex,
    })
    .from(crossfitWorkoutParts)
    .where(eq(crossfitWorkoutParts.crossfitWorkoutId, opts.originalTemplateId))
    .orderBy(crossfitWorkoutParts.orderIndex);

  return {
    templateId: opts.originalTemplateId,
    isNew: false,
    contentFingerprint: nextFingerprint,
    partIdsByOrder: reloadedParts.map((r: { id: string }) => r.id),
    mode: "edited_in_place",
  };
}

async function isOriginalSafeToEditInPlace(
  tx: Tx,
  opts: { originalTemplateId: string; excludeSessionId: string | null }
): Promise<boolean> {
  // Any other session referencing this template?
  const otherSessions = await tx
    .select({ id: workoutSessions.id })
    .from(workoutSessions)
    .where(
      opts.excludeSessionId
        ? and(
            eq(workoutSessions.crossfitWorkoutId, opts.originalTemplateId),
            ne(workoutSessions.id, opts.excludeSessionId)
          )
        : eq(workoutSessions.crossfitWorkoutId, opts.originalTemplateId)
    )
    .limit(1);
  if (otherSessions.length > 0) return false;

  // Any score attached to a part of this template? (scores.crossfit_workout_part_id
  // FKs the unified-schema part table.)
  const scoreRow = await tx
    .select({ id: scores.id })
    .from(scores)
    .innerJoin(
      crossfitWorkoutParts,
      eq(crossfitWorkoutParts.id, scores.crossfitWorkoutPartId)
    )
    .where(
      and(
        eq(crossfitWorkoutParts.crossfitWorkoutId, opts.originalTemplateId),
        isNotNull(scores.crossfitWorkoutPartId)
      )
    )
    .limit(1);
  if (scoreRow.length > 0) return false;

  return true;
}
