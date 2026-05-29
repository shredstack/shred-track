// GET  /api/gym/[id]/programming/sections/[sectionId]/content
// PUT  /api/gym/[id]/programming/sections/[sectionId]/content
//
// GET returns the session's body + (its template's) parts/blocks/movements
// in the same wire shape Smart Builder expects to rehydrate.
//
// PUT replaces the session's content. Body shape:
//   { body?: string | null, parts?: PartInput[], title?, notes?,
//     benchmarkWorkoutId?, description?, isPartner?, partnerCount?,
//     requiresVest?, vestWeightMaleLb?, vestWeightFemaleLb? }
//
// In the unified schema there is no "section" table — sections ARE
// workout_sessions rows. When `parts` is supplied, the route routes
// through `forkOrEditTemplate` (community-scoped) so a shared community
// template stays intact when only this section's prescription changed —
// a new template is forked off it; the original keeps its scores. The
// helper edits in place when safe (no other sessions, no scores), and
// system templates get a scoped fork via `upsertTemplate` instead. When
// `benchmarkWorkoutId` is supplied the session relinks to that benchmark
// template directly (no per-day copy of the prescription). Freeform
// sessions (warm-up, stretching) keep their body-only shape.

import { NextRequest, NextResponse } from "next/server";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  crossfitWorkoutBlocks,
  crossfitWorkoutMovements,
  crossfitWorkoutParts,
  crossfitWorkouts,
  movements,
  workoutSessions,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";
import {
  upsertTemplate,
  type TemplatePartInput,
} from "@/lib/crossfit/upsert-template";
import { forkOrEditTemplate } from "@/lib/crossfit/fork-template";
import { updateSession } from "@/lib/crossfit/session-writer";
import { inngest } from "@/inngest/client";

async function loadSection(sectionId: string, communityId: string) {
  const [row] = await db
    .select({
      id: workoutSessions.id,
      crossfitWorkoutId: workoutSessions.crossfitWorkoutId,
      body: workoutSessions.body,
      isScored: workoutSessions.isScored,
      title: workoutSessions.title,
      coachNotes: workoutSessions.coachNotes,
      kind: workoutSessions.kind,
      communityId: workoutSessions.communityId,
    })
    .from(workoutSessions)
    .where(eq(workoutSessions.id, sectionId))
    .limit(1);
  if (!row || row.communityId !== communityId) return null;
  return row;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; sectionId: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId, sectionId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const section = await loadSection(sectionId, communityId);
  if (!section) {
    return NextResponse.json({ error: "Section not found" }, { status: 404 });
  }

  // Body-only freeform section, or a session that hasn't been wired to a
  // template yet — return the row without parts. Smart Builder hydrates
  // an empty parts list as a fresh builder state.
  if (!section.crossfitWorkoutId) {
    return NextResponse.json({
      section: {
        id: section.id,
        kind: section.kind,
        title: section.title,
        body: section.body,
        notes: section.coachNotes,
      },
      parts: [],
    });
  }

  const parts = await db
    .select()
    .from(crossfitWorkoutParts)
    .where(eq(crossfitWorkoutParts.crossfitWorkoutId, section.crossfitWorkoutId))
    .orderBy(asc(crossfitWorkoutParts.orderIndex));
  const partIds = parts.map((p) => p.id);

  const blockRows = partIds.length
    ? await db
        .select()
        .from(crossfitWorkoutBlocks)
        .where(inArray(crossfitWorkoutBlocks.crossfitWorkoutPartId, partIds))
        .orderBy(asc(crossfitWorkoutBlocks.orderIndex))
    : [];
  const movementRows = partIds.length
    ? await db
        .select({
          id: crossfitWorkoutMovements.id,
          workoutPartId: crossfitWorkoutMovements.crossfitWorkoutPartId,
          workoutBlockId: crossfitWorkoutMovements.crossfitWorkoutBlockId,
          movementId: crossfitWorkoutMovements.movementId,
          orderIndex: crossfitWorkoutMovements.orderIndex,
          prescribedReps: crossfitWorkoutMovements.prescribedReps,
          prescribedWeightMale: crossfitWorkoutMovements.prescribedWeightMale,
          prescribedWeightFemale:
            crossfitWorkoutMovements.prescribedWeightFemale,
          prescribedCaloriesMale:
            crossfitWorkoutMovements.prescribedCaloriesMale,
          prescribedCaloriesFemale:
            crossfitWorkoutMovements.prescribedCaloriesFemale,
          prescribedDistanceMale:
            crossfitWorkoutMovements.prescribedDistanceMale,
          prescribedDistanceFemale:
            crossfitWorkoutMovements.prescribedDistanceFemale,
          prescribedDurationSecondsMale:
            crossfitWorkoutMovements.prescribedDurationSecondsMale,
          prescribedDurationSecondsFemale:
            crossfitWorkoutMovements.prescribedDurationSecondsFemale,
          prescribedHeightInches:
            crossfitWorkoutMovements.prescribedHeightInches,
          prescribedHeightInchesMale:
            crossfitWorkoutMovements.prescribedHeightInchesMale,
          prescribedHeightInchesFemale:
            crossfitWorkoutMovements.prescribedHeightInchesFemale,
          prescribedWeightMaleBwMultiplier:
            crossfitWorkoutMovements.prescribedWeightMaleBwMultiplier,
          prescribedWeightFemaleBwMultiplier:
            crossfitWorkoutMovements.prescribedWeightFemaleBwMultiplier,
          tempo: crossfitWorkoutMovements.tempo,
          isMaxReps: crossfitWorkoutMovements.isMaxReps,
          captureDurationPerRound:
            crossfitWorkoutMovements.captureDurationPerRound,
          isSideCadence: crossfitWorkoutMovements.isSideCadence,
          equipmentCount: crossfitWorkoutMovements.equipmentCount,
          rxStandard: crossfitWorkoutMovements.rxStandard,
          notes: crossfitWorkoutMovements.notes,
          movementName: movements.canonicalName,
          category: movements.category,
          isWeighted: movements.isWeighted,
          metricType: movements.metricType,
        })
        .from(crossfitWorkoutMovements)
        .innerJoin(movements, eq(movements.id, crossfitWorkoutMovements.movementId))
        .where(inArray(crossfitWorkoutMovements.crossfitWorkoutPartId, partIds))
        .orderBy(asc(crossfitWorkoutMovements.orderIndex))
    : [];

  return NextResponse.json({
    section: {
      id: section.id,
      kind: section.kind,
      title: section.title,
      body: section.body,
      notes: section.coachNotes,
    },
    parts: parts.map((p) => ({
      ...p,
      blocks: blockRows.filter((b) => b.crossfitWorkoutPartId === p.id),
      movements: movementRows.filter((m) => m.workoutPartId === p.id),
    })),
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sectionId: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId, sectionId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const section = await loadSection(sectionId, communityId);
  if (!section) {
    return NextResponse.json({ error: "Section not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    body?: string | null;
    parts?: TemplatePartInput[];
    title?: string | null;
    notes?: string | null;
    // When a Benchmark-tab pick is forwarded, this is a crossfit_workouts.id
    // with is_benchmark = true. The session relinks to that template
    // directly — the template is shared, the per-session metadata
    // (description, vest, partner) lives on the template.
    benchmarkWorkoutId?: string | null;
    description?: string | null;
    isPartner?: boolean;
    partnerCount?: number | null;
    requiresVest?: boolean;
    vestWeightMaleLb?: number | string | null;
    vestWeightFemaleLb?: number | string | null;
  } | null;
  if (!body) {
    return NextResponse.json({ error: "Body required" }, { status: 400 });
  }

  try {
    await db.transaction(async (tx) => {
      // ----- Session-level fields -----
      const sessionPatch: Record<string, unknown> = {
        reviewedAt: new Date(),
      };
      if (body.body !== undefined) sessionPatch.body = body.body;
      if (body.title !== undefined) {
        const trimmed = typeof body.title === "string" ? body.title.trim() : "";
        sessionPatch.title = trimmed.length > 0 ? trimmed : null;
      }
      if (body.notes !== undefined) {
        const trimmed = typeof body.notes === "string" ? body.notes.trim() : "";
        sessionPatch.coachNotes = trimmed.length > 0 ? body.notes : null;
      }

      // ----- Benchmark fast-path: relink to a canonical template -----
      if (body.benchmarkWorkoutId !== undefined) {
        const nextLink =
          typeof body.benchmarkWorkoutId === "string" &&
          body.benchmarkWorkoutId.length > 0
            ? body.benchmarkWorkoutId
            : null;
        if (nextLink) {
          const [tmpl] = await tx
            .select({ id: crossfitWorkouts.id })
            .from(crossfitWorkouts)
            .where(eq(crossfitWorkouts.id, nextLink))
            .limit(1);
          if (!tmpl) {
            throw new Error("Benchmark template not found");
          }
          sessionPatch.crossfitWorkoutId = nextLink;
          // Body is no longer needed when we have a real template; null it
          // so the section card doesn't show a stale placeholder.
          sessionPatch.body = null;
        } else {
          // Clear the link only; the body keeps the placeholder.
          sessionPatch.crossfitWorkoutId = null;
        }
      }

      // ----- Smart Builder parts: route through the fork-on-edit helper -----
      //   • No current template (freeform → structured) → plain upsert.
      //   • Current template is a system row (Fran et al.) → scoped fork via
      //     upsertTemplate; the system row stays untouched.
      //   • Benchmark-link patch above this block already changed
      //     sessionPatch.crossfitWorkoutId — re-read so the fork decision is
      //     based on the target template, not the about-to-be-replaced one.
      //   • Otherwise → forkOrEditTemplate; matches an existing community
      //     template by fingerprint, edits in place when safe, or forks.
      //
      // Skipped entirely when this PUT is a pure benchmark relink: per spec
      // the session points at the canonical template, no clone. A coach who
      // wants a variant edits the section via Smart Builder afterwards,
      // which arrives without `benchmarkWorkoutId` and forks correctly.
      const isBenchmarkRelink =
        typeof body.benchmarkWorkoutId === "string" &&
        body.benchmarkWorkoutId.length > 0;
      if (
        !isBenchmarkRelink &&
        Array.isArray(body.parts) &&
        body.parts.length > 0
      ) {
        const validParts = body.parts.filter(
          (p) => p && p.workoutType && Array.isArray(p.movements)
        );
        if (validParts.length === 0) {
          throw new Error("parts is empty after validation");
        }
        const firstPart = validParts[0];
        const nextTemplate = {
          title:
            (typeof body.title === "string" && body.title.trim()) ||
            firstPart.label?.trim() ||
            "Untitled section",
          description: body.description ?? null,
          scope: { kind: "community", communityId } as const,
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
          parts: validParts,
        };

        // Determine the "original" template id for fork purposes. The
        // benchmark fast-path above may have just set sessionPatch.crossfitWorkoutId
        // to a benchmark template — that's the *target* of a relink, not an
        // edit, so we use the section's pre-PUT template id as the fork
        // origin if no benchmark relink happened.
        const originalTemplateId =
          sessionPatch.crossfitWorkoutId === undefined
            ? section.crossfitWorkoutId
            : (sessionPatch.crossfitWorkoutId as string | null);

        let resolvedTemplateId: string;
        if (!originalTemplateId) {
          const r = await upsertTemplate(tx, nextTemplate);
          resolvedTemplateId = r.templateId;
        } else {
          const [orig] = await tx
            .select({ isSystem: crossfitWorkouts.isSystem })
            .from(crossfitWorkouts)
            .where(eq(crossfitWorkouts.id, originalTemplateId))
            .limit(1);
          if (orig?.isSystem) {
            const r = await upsertTemplate(tx, nextTemplate);
            resolvedTemplateId = r.templateId;
          } else {
            const r = await forkOrEditTemplate(tx, {
              originalTemplateId,
              next: nextTemplate,
              triggeringSessionId: sectionId,
            });
            resolvedTemplateId = r.templateId;
          }
        }

        sessionPatch.crossfitWorkoutId = resolvedTemplateId;
        sessionPatch.body = null;
      }

      await updateSession(tx, sectionId, sessionPatch);
    });
  } catch (err) {
    // Surface validation errors thrown from upsertTemplate /
    // forkOrEditTemplate / insertTemplateParts so the Smart Builder dialog
    // can display exactly what's wrong instead of a generic "Failed to save".
    const message =
      err instanceof Error && err.message ? err.message : "Failed to save";
    console.error("[programming/sections/content] PUT failed", err);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Recompute the template-level calorie estimate — the session's template
  // (and therefore its parts/movements) may have changed.
  try {
    const [refreshed] = await db
      .select({ crossfitWorkoutId: workoutSessions.crossfitWorkoutId })
      .from(workoutSessions)
      .where(eq(workoutSessions.id, sectionId))
      .limit(1);
    if (refreshed?.crossfitWorkoutId) {
      await inngest.send({
        name: "workouts/calories.compute",
        data: { workoutId: refreshed.crossfitWorkoutId },
      });
    }
  } catch (err) {
    console.error(
      "[calories] failed to dispatch compute event on section content PUT",
      err
    );
  }

  return NextResponse.json({ ok: true });
}

// Explicit clear endpoint kept for symmetry.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; sectionId: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId, sectionId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const section = await loadSection(sectionId, communityId);
  if (!section) return NextResponse.json({ ok: true });

  // Unlink the template and reset the body to a placeholder so the CHECK
  // constraint still holds. The template itself stays (other sessions may
  // reference it; orphan-clean lands in a later commit).
  await db.transaction(async (tx) =>
    updateSession(tx, sectionId, {
      crossfitWorkoutId: null,
      body: "(empty)",
      reviewedAt: new Date(),
    })
  );
  return NextResponse.json({ ok: true });
}
