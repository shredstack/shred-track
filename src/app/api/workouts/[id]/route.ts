import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  workouts,
  workoutParts,
  workoutBlocks,
  workoutMovements,
  crossfitWorkouts,
  movements,
  scores,
  scoreMovementDetails,
  users,
  communities,
  workoutSections,
  workoutSessions,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import {
  getSessionAccess,
  getWorkoutAccess,
} from "@/lib/authz/workout";
import type { WorkoutType } from "@/types/crossfit";
import { normalizeSetEntries } from "@/lib/crossfit/set-entries";
import {
  upsertTemplate,
  type TemplatePartInput,
  type UpsertTemplateScope,
} from "@/lib/crossfit/upsert-template";
import { updateSession } from "@/lib/crossfit/session-writer";
import { inngest } from "@/inngest/client";

// GET /api/workouts/[id] — single workout with its parts, movements, and
// (if the requester has one) the caller's scores per part.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  const { id } = await params;

  const [workout] = await db
    .select()
    .from(workouts)
    .where(eq(workouts.id, id))
    .limit(1);

  if (!workout) {
    return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  }

  // Permission gate. Anonymous callers fall through (legacy behavior — we
  // never threw on no-auth GETs); authenticated callers must have read
  // access to this workout.
  if (user) {
    const access = await getWorkoutAccess(user.id, id);
    if (!access.canRead) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const parts = await db
    .select()
    .from(workoutParts)
    .where(eq(workoutParts.workoutId, id))
    .orderBy(workoutParts.orderIndex);

  const allMovements = await db
    .select({
      id: workoutMovements.id,
      workoutPartId: workoutMovements.workoutPartId,
      workoutBlockId: workoutMovements.workoutBlockId,
      movementId: workoutMovements.movementId,
      orderIndex: workoutMovements.orderIndex,
      prescribedReps: workoutMovements.prescribedReps,
      prescribedWeightMale: workoutMovements.prescribedWeightMale,
      prescribedWeightFemale: workoutMovements.prescribedWeightFemale,
      prescribedCaloriesMale: workoutMovements.prescribedCaloriesMale,
      prescribedCaloriesFemale: workoutMovements.prescribedCaloriesFemale,
      prescribedDistanceMale: workoutMovements.prescribedDistanceMale,
      prescribedDistanceFemale: workoutMovements.prescribedDistanceFemale,
      prescribedDurationSecondsMale:
        workoutMovements.prescribedDurationSecondsMale,
      prescribedDurationSecondsFemale:
        workoutMovements.prescribedDurationSecondsFemale,
      prescribedHeightInches: workoutMovements.prescribedHeightInches,
      prescribedHeightInchesMale:
        workoutMovements.prescribedHeightInchesMale,
      prescribedHeightInchesFemale:
        workoutMovements.prescribedHeightInchesFemale,
      prescribedWeightMaleBwMultiplier:
        workoutMovements.prescribedWeightMaleBwMultiplier,
      prescribedWeightFemaleBwMultiplier:
        workoutMovements.prescribedWeightFemaleBwMultiplier,
      prescribedWeightPct: workoutMovements.prescribedWeightPct,
      prescribedWeightPctSourcePartId:
        workoutMovements.prescribedWeightPctSourcePartId,
      tempo: workoutMovements.tempo,
      isMaxReps: workoutMovements.isMaxReps,
      isSideCadence: workoutMovements.isSideCadence,
      repSchemeParsed: workoutMovements.repSchemeParsed,
      equipmentCount: workoutMovements.equipmentCount,
      rxStandard: workoutMovements.rxStandard,
      notes: workoutMovements.notes,
      movementName: movements.canonicalName,
      movementCategory: movements.category,
      isWeighted: movements.isWeighted,
      metricType: movements.metricType,
    })
    .from(workoutMovements)
    .innerJoin(movements, eq(movements.id, workoutMovements.movementId))
    .where(eq(workoutMovements.workoutId, id))
    .orderBy(workoutMovements.orderIndex);

  // Fetch caller's score per part (if any).
  let userScoresByPart = new Map<string, {
    id: string;
    workoutPartId: string | null;
    division: string;
    timeSeconds: number | null;
    rounds: number | null;
    remainderReps: number | null;
    weightLbs: string | null;
    totalReps: number | null;
    scoreText: string | null;
    hitTimeCap: boolean;
    notes: string | null;
    rpe: number | null;
  }>();
  let detailsByScore = new Map<string, Array<{
    workoutMovementId: string;
    wasRx: boolean;
    actualWeight: string | null;
    actualReps: string | null;
    modification: string | null;
    substitutionMovementId: string | null;
    setEntries: unknown;
    actualDurationSeconds: number | null;
    actualHeightInches: string | null;
    actualRepsPerRound: number[] | null;
    notes: string | null;
  }>>();

  if (user) {
    const userScoreRows = await db
      .select()
      .from(scores)
      .where(and(eq(scores.workoutId, id), eq(scores.userId, user.id)));

    userScoresByPart = new Map(
      userScoreRows
        .filter((s) => s.workoutPartId)
        .map((s) => [s.workoutPartId as string, s])
    );

    if (userScoreRows.length > 0) {
      const scoreIds = userScoreRows.map((s) => s.id);
      const detailRows = await db
        .select()
        .from(scoreMovementDetails)
        .where(inArray(scoreMovementDetails.scoreId, scoreIds));
      detailsByScore = new Map();
      for (const d of detailRows) {
        const list = detailsByScore.get(d.scoreId) ?? [];
        list.push({
          workoutMovementId: d.workoutMovementId,
          wasRx: d.wasRx,
          actualWeight: d.actualWeight,
          actualReps: d.actualReps,
          modification: d.modification,
          substitutionMovementId: d.substitutionMovementId,
          setEntries: d.setEntries,
          actualDurationSeconds: d.actualDurationSeconds,
          actualHeightInches: d.actualHeightInches,
          actualRepsPerRound: d.actualRepsPerRound,
          notes: d.notes,
        });
        detailsByScore.set(d.scoreId, list);
      }
    }
  }

  // Group movements by part.
  const movementsByPart = new Map<string, typeof allMovements>();
  for (const m of allMovements) {
    if (!m.workoutPartId) continue;
    const list = movementsByPart.get(m.workoutPartId) ?? [];
    list.push(m);
    movementsByPart.set(m.workoutPartId, list);
  }

  const partIds = parts.map((p) => p.id);
  const blockRows =
    partIds.length > 0
      ? await db
          .select()
          .from(workoutBlocks)
          .where(inArray(workoutBlocks.workoutPartId, partIds))
          .orderBy(workoutBlocks.orderIndex)
      : [];
  const blocksByPart = new Map<string, typeof blockRows>();
  for (const b of blockRows) {
    const list = blocksByPart.get(b.workoutPartId) ?? [];
    list.push(b);
    blocksByPart.set(b.workoutPartId, list);
  }

  const partsPayload = parts.map((p) => {
    const score = userScoresByPart.get(p.id);
    return {
      id: p.id,
      orderIndex: p.orderIndex,
      label: p.label,
      workoutType: p.workoutType,
      timeCapSeconds: p.timeCapSeconds,
      amrapDurationSeconds: p.amrapDurationSeconds,
      emomIntervalSeconds: p.emomIntervalSeconds,
      intervalWorkSeconds: p.intervalWorkSeconds,
      intervalRestSeconds: p.intervalRestSeconds,
      intervalRounds: p.intervalRounds,
      sideCadenceIntervalSeconds: p.sideCadenceIntervalSeconds,
      sideCadenceOpenEnded: p.sideCadenceOpenEnded,
      repScheme: p.repScheme,
      rounds: p.rounds,
      structure: p.structure,
      notes: p.notes,
      blocks: (blocksByPart.get(p.id) ?? []).map((b) => ({
        id: b.id,
        orderIndex: b.orderIndex,
        title: b.title,
      })),
      movements: (movementsByPart.get(p.id) ?? []).map((m) => ({
        id: m.id,
        movementId: m.movementId,
        movementName: m.movementName,
        category: m.movementCategory,
        isWeighted: m.isWeighted,
        metricType: m.metricType,
        orderIndex: m.orderIndex,
        workoutBlockId: m.workoutBlockId ?? null,
        prescribedReps: m.prescribedReps,
        prescribedWeightMale: m.prescribedWeightMale,
        prescribedWeightFemale: m.prescribedWeightFemale,
        prescribedCaloriesMale: m.prescribedCaloriesMale,
        prescribedCaloriesFemale: m.prescribedCaloriesFemale,
        prescribedDistanceMale: m.prescribedDistanceMale,
        prescribedDistanceFemale: m.prescribedDistanceFemale,
        prescribedDurationSecondsMale:
          m.prescribedDurationSecondsMale ?? undefined,
        prescribedDurationSecondsFemale:
          m.prescribedDurationSecondsFemale ?? undefined,
        prescribedHeightInches:
          m.prescribedHeightInches != null
            ? Number(m.prescribedHeightInches)
            : undefined,
        prescribedHeightInchesMale:
          m.prescribedHeightInchesMale != null
            ? Number(m.prescribedHeightInchesMale)
            : undefined,
        prescribedHeightInchesFemale:
          m.prescribedHeightInchesFemale != null
            ? Number(m.prescribedHeightInchesFemale)
            : undefined,
        prescribedWeightMaleBwMultiplier:
          m.prescribedWeightMaleBwMultiplier != null
            ? Number(m.prescribedWeightMaleBwMultiplier)
            : undefined,
        prescribedWeightFemaleBwMultiplier:
          m.prescribedWeightFemaleBwMultiplier != null
            ? Number(m.prescribedWeightFemaleBwMultiplier)
            : undefined,
        prescribedWeightPct:
          m.prescribedWeightPct != null
            ? Number(m.prescribedWeightPct)
            : undefined,
        prescribedWeightPctSourcePartId:
          m.prescribedWeightPctSourcePartId ?? undefined,
        tempo: m.tempo ?? undefined,
        isMaxReps: !!m.isMaxReps,
        isSideCadence: !!m.isSideCadence,
        repSchemeParsed: m.repSchemeParsed,
        equipmentCount: m.equipmentCount,
        rxStandard: m.rxStandard,
        notes: m.notes,
      })),
      score: score
        ? {
            id: score.id,
            workoutPartId: score.workoutPartId,
            division: score.division,
            timeSeconds: score.timeSeconds ?? undefined,
            rounds: score.rounds ?? undefined,
            remainderReps: score.remainderReps ?? undefined,
            weightLbs: score.weightLbs ?? undefined,
            totalReps: score.totalReps ?? undefined,
            scoreText: score.scoreText ?? undefined,
            hitTimeCap: score.hitTimeCap,
            notes: score.notes ?? undefined,
            rpe: score.rpe ?? undefined,
            movementDetails: (detailsByScore.get(score.id) ?? []).map((d) => {
              const entries = normalizeSetEntries(d.setEntries);
              return {
                workoutMovementId: d.workoutMovementId,
                wasRx: d.wasRx,
                actualWeight: d.actualWeight ? Number(d.actualWeight) : undefined,
                actualReps: d.actualReps ?? undefined,
                modification: d.modification ?? undefined,
                substitutionMovementId: d.substitutionMovementId ?? undefined,
                setEntries: entries.length > 0 ? entries : undefined,
                actualDurationSeconds: d.actualDurationSeconds ?? undefined,
                actualHeightInches:
                  d.actualHeightInches != null
                    ? Number(d.actualHeightInches)
                    : undefined,
                actualRepsPerRound:
                  d.actualRepsPerRound && d.actualRepsPerRound.length > 0
                    ? d.actualRepsPerRound
                    : undefined,
                notes: d.notes ?? undefined,
              };
            }),
          }
        : null,
    };
  });

  const [creatorRow] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, workout.createdBy))
    .limit(1);

  const [communityRow] = workout.communityId
    ? await db
        .select({
          name: communities.name,
          logoUrl: communities.logoUrl,
        })
        .from(communities)
        .where(eq(communities.id, workout.communityId))
        .limit(1)
    : [undefined as { name: string; logoUrl: string | null } | undefined];

  // Sections (spec §1.6) — same shape the list endpoint returns.
  const sectionRows = await db
    .select({
      id: workoutSections.id,
      kind: workoutSections.kind,
      position: workoutSections.position,
      title: workoutSections.title,
      body: workoutSections.body,
      notes: workoutSections.notes,
      isScored: workoutSections.isScored,
      scoreType: workoutSections.scoreType,
    })
    .from(workoutSections)
    .where(eq(workoutSections.workoutId, workout.id))
    .orderBy(workoutSections.position);
  const partIdsBySection = new Map<string, string[]>();
  for (const p of parts) {
    if (p.workoutSectionId) {
      const list = partIdsBySection.get(p.workoutSectionId) ?? [];
      list.push(p.id);
      partIdsBySection.set(p.workoutSectionId, list);
    }
  }

  return NextResponse.json({
    ...workout,
    requiresVest: workout.requiresVest,
    vestWeightMaleLb:
      workout.vestWeightMaleLb != null
        ? Number(workout.vestWeightMaleLb)
        : null,
    vestWeightFemaleLb:
      workout.vestWeightFemaleLb != null
        ? Number(workout.vestWeightFemaleLb)
        : null,
    isPartner: workout.isPartner,
    partnerCount: workout.partnerCount,
    creatorName: creatorRow?.name ?? null,
    communityName: communityRow?.name ?? null,
    communityLogoUrl: communityRow?.logoUrl ?? null,
    sections: sectionRows.map((s) => ({
      id: s.id,
      kind: s.kind,
      position: s.position,
      title: s.title,
      body: s.body,
      notes: s.notes,
      isScored: s.isScored,
      scoreType: s.scoreType,
      partIds: partIdsBySection.get(s.id) ?? [],
    })),
    parts: partsPayload,
  });
}

// In the unified schema the prescription lives on a template (not on a per-
// session row), so a "workout update" is one of two operations:
//   • Metadata-only PATCH — updates session-level fields (workoutDate,
//     published, kind, title-override, coachNotes). Template-level fields
//     (description, vest, partner, partnerCount) are intentionally NOT
//     mutable here for v1; mutating shared/system templates needs the
//     fork-on-edit logic that lands in a later commit. A metadata-only
//     patch silently ignores those fields rather than failing the request,
//     so existing callers keep working — when they next send `parts[]`,
//     the new fields propagate through `upsertTemplate` and into a (forked
//     or matched) template.
//   • Prescription PATCH — re-runs `upsertTemplate` with the new parts;
//     the session is relinked to whatever template id the upsert resolves.
//     This is functionally "matched_existing" plus "create-new"; the full
//     fork-on-edit logic (with in-place edit when safe) wires in commit #8.
type UpdatePartInput = TemplatePartInput;

// PUT /api/workouts/[id] — update a workout session and (when the
// prescription changes) the template it points at.
//
// `id` is a `workout_sessions.id`. There are two modes:
//   • parts[] omitted → metadata-only patch. Session-level fields
//     (workoutDate, published, kind, title-override, coachNotes) are
//     applied directly; template-level fields are intentionally NOT
//     mutated here (see the type comment above).
//   • parts[] provided → re-runs upsertTemplate with the new prescription.
//     The session is relinked to whatever template id the upsert resolves
//     (matched_existing OR new). Full fork-on-edit (with in-place edit
//     when the original template has no other sessions / scores) is
//     wired in commit #8.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const access = await getSessionAccess(user.id, id);
  if (!access.exists) {
    return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  }
  if (!access.canEdit) {
    return NextResponse.json(
      { error: "You don't have permission to edit this workout" },
      { status: 403 }
    );
  }

  const [session] = await db
    .select()
    .from(workoutSessions)
    .where(eq(workoutSessions.id, id))
    .limit(1);
  if (!session) {
    return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  }

  // Vest validation: if the resulting state has requiresVest=true, at
  // least one gendered vest weight must be set. Only enforced when the
  // caller is supplying parts (the body carries the new prescription).
  if (Array.isArray(body.parts) && body.requiresVest === true) {
    if (body.vestWeightMaleLb == null && body.vestWeightFemaleLb == null) {
      return NextResponse.json(
        { error: "Vest weight is required when requiresVest is true" },
        { status: 400 }
      );
    }
  }

  // ------------------------------------------------------------------
  // Metadata-only patch
  // ------------------------------------------------------------------
  if (!Array.isArray(body.parts)) {
    const sessionPatch: Record<string, unknown> = {};
    if (typeof body.workoutDate === "string" && body.workoutDate.trim()) {
      sessionPatch.workoutDate = body.workoutDate;
    }
    if (body.published !== undefined) {
      sessionPatch.published = !!body.published;
    }
    if (body.title !== undefined) {
      const trimmed =
        typeof body.title === "string" ? body.title.trim() : "";
      sessionPatch.title = trimmed.length > 0 ? trimmed : null;
    }
    if (body.coachNotes !== undefined) {
      const trimmed =
        typeof body.coachNotes === "string" ? body.coachNotes.trim() : "";
      sessionPatch.coachNotes = trimmed.length > 0 ? body.coachNotes : null;
    }

    if (Object.keys(sessionPatch).length === 0) {
      return NextResponse.json(session);
    }

    const updated = await db.transaction(async (tx) =>
      updateSession(tx, id, sessionPatch)
    );
    return NextResponse.json(updated);
  }

  // ------------------------------------------------------------------
  // Prescription patch — re-upsert the template, relink the session
  // ------------------------------------------------------------------
  const incomingParts = body.parts as UpdatePartInput[];
  if (incomingParts.length === 0) {
    return NextResponse.json(
      { error: "At least one part with movements is required" },
      { status: 400 }
    );
  }

  const firstPart = incomingParts[0];

  // Scope is determined by the session — personal sessions stay personal,
  // gym sessions stay gym-scoped. The session's owner / community drives
  // template scope so a personal edit can't accidentally write a community
  // template (and vice versa).
  const scope: UpsertTemplateScope = session.communityId
    ? { kind: "community", communityId: session.communityId }
    : session.userId
      ? { kind: "personal", userId: session.userId }
      : { kind: "system" };
  if (scope.kind === "system") {
    return NextResponse.json(
      { error: "System sessions cannot be edited here" },
      { status: 400 }
    );
  }

  const result = await db.transaction(async (tx) => {
    // Inherit the existing template's title/description when the patch
    // doesn't override them — same as the legacy `body.title ?? existing.title`
    // fallback. Pulled inside the tx so the read is consistent with the write.
    const [currentTemplate] = session.crossfitWorkoutId
      ? await tx
          .select({
            title: crossfitWorkouts.title,
            description: crossfitWorkouts.description,
          })
          .from(crossfitWorkouts)
          .where(eq(crossfitWorkouts.id, session.crossfitWorkoutId))
          .limit(1)
      : [undefined];

    const upsertResult = await upsertTemplate(tx, {
      title: deriveTitle(body.title, currentTemplate?.title, firstPart),
      description:
        body.description !== undefined
          ? body.description
          : currentTemplate?.description ?? null,
      scope,
      workoutType: firstPart.workoutType,
      timeCapSeconds: firstPart.timeCapSeconds ?? null,
      amrapDurationSeconds: firstPart.amrapDurationSeconds ?? null,
      repScheme: firstPart.repScheme ?? null,
      rounds: firstPart.rounds ?? null,
      requiresVest:
        body.requiresVest !== undefined ? !!body.requiresVest : undefined,
      vestWeightMaleLb:
        body.vestWeightMaleLb !== undefined ? body.vestWeightMaleLb : null,
      vestWeightFemaleLb:
        body.vestWeightFemaleLb !== undefined
          ? body.vestWeightFemaleLb
          : null,
      isPartner:
        body.isPartner !== undefined ? !!body.isPartner : undefined,
      partnerCount:
        body.partnerCount !== undefined ? body.partnerCount : null,
      parts: incomingParts,
    });

    // Relink the session if the resolved template id differs.
    const sessionPatch: Record<string, unknown> = {};
    if (upsertResult.templateId !== session.crossfitWorkoutId) {
      sessionPatch.crossfitWorkoutId = upsertResult.templateId;
    }
    if (typeof body.workoutDate === "string" && body.workoutDate.trim()) {
      sessionPatch.workoutDate = body.workoutDate;
    }
    if (body.published !== undefined) {
      sessionPatch.published = !!body.published;
    }
    const updated =
      Object.keys(sessionPatch).length > 0
        ? await updateSession(tx, id, sessionPatch)
        : session;
    return {
      session: updated,
      crossfitWorkoutId: upsertResult.templateId,
      isNewTemplate: upsertResult.isNew,
    };
  });

  // Re-fire the calorie compute against the (new or matched) template.
  try {
    await inngest.send({
      name: "workouts/calories.compute",
      data: { workoutId: result.crossfitWorkoutId },
    });
  } catch (err) {
    console.error("[calories] failed to dispatch compute event on PUT", err);
  }

  return NextResponse.json({
    ...result.session,
    crossfitWorkoutId: result.crossfitWorkoutId,
    isNewTemplate: result.isNewTemplate,
  });
}

// Same title-derivation rule as POST: an explicit non-empty title wins,
// otherwise fall through to the current template title, then to the first
// part's label, then to a generic placeholder.
function deriveTitle(
  incomingTitle: unknown,
  fallbackTitle: string | undefined | null,
  firstPart: UpdatePartInput
): string {
  const candidate =
    typeof incomingTitle === "string" ? incomingTitle.trim() : "";
  if (candidate) return candidate;
  if (fallbackTitle && fallbackTitle.trim()) return fallbackTitle;
  const partLabel = firstPart.label?.trim();
  if (partLabel) return partLabel;
  return "Untitled workout";
}

// DELETE /api/workouts/[id] — delete the session. Cascade FKs handle the
// scores / score_movement_details / cross-domain references on the row;
// the template stays (it may have other sessions, scores, or be a system
// benchmark). The template orphan-clean is intentionally NOT done here in
// commit #5 — deletes a template only when it has no other sessions AND
// no scores belongs to a later commit so the cleanup logic gets its own
// review.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  // When called from the programming admin, the client passes
  // ?programmingOnly=1 so a wrong/stale id can't silently delete a manual
  // workout. Without this guard, the endpoint deletes any session the
  // caller can edit — including ad-hoc WODs sharing the same date.
  const programmingOnly =
    req.nextUrl.searchParams.get("programmingOnly") === "1";

  const access = await getSessionAccess(user.id, id);
  if (!access.exists) {
    return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  }
  if (!access.canEdit) {
    return NextResponse.json(
      { error: "You don't have permission to delete this workout" },
      { status: 403 }
    );
  }

  if (programmingOnly) {
    const [row] = await db
      .select({
        programmingReleaseId: workoutSessions.programmingReleaseId,
      })
      .from(workoutSessions)
      .where(eq(workoutSessions.id, id))
      .limit(1);
    if (!row?.programmingReleaseId) {
      return NextResponse.json(
        { error: "Workout is not part of programming" },
        { status: 400 }
      );
    }
  }

  try {
    // The session's `scores` cascade-delete via FK; score_movement_details
    // rows attached to those scores go via THEIR cascade (the same FK
    // configuration as the legacy schema). class_instances /  gym_posts
    // FKs to workout_session_id are `on delete set null`, so they unhook
    // automatically. No explicit cleanup needed here.
    await db.transaction(async (tx) => {
      await tx.delete(workoutSessions).where(eq(workoutSessions.id, id));
    });

    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("DELETE /api/workouts/[id] failed", { sessionId: id, err });
    const message =
      err instanceof Error ? err.message : "Failed to delete workout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
