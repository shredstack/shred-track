// GET  /api/gym/[id]/programming/sections/[sectionId]/content
// PUT  /api/gym/[id]/programming/sections/[sectionId]/content
//
// GET returns the section's body + parts/blocks/movements in a shape the
// Smart Builder can rehydrate (matches the GET /api/workouts wire shape
// for the section's parts only).
//
// PUT replaces the section's content. Body: { body?: string | null,
// parts?: PartInput[] }. When `parts` is provided we delete every
// existing part with workoutSectionId = sectionId and insert the new
// ones. Other parts on the parent workout (i.e. parts belonging to other
// sections) are untouched.

import { NextRequest, NextResponse } from "next/server";
import { asc, eq, inArray, max } from "drizzle-orm";
import { db } from "@/db";
import {
  movements,
  workouts,
  workoutBlocks,
  workoutMovements,
  workoutParts,
  workoutSections,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";
import {
  insertWorkoutParts,
  type PartInput,
} from "@/lib/crossfit/insert-workout-parts";

async function loadSection(sectionId: string, communityId: string) {
  const [row] = await db
    .select({
      id: workoutSections.id,
      workoutId: workoutSections.workoutId,
      body: workoutSections.body,
      isScored: workoutSections.isScored,
      title: workoutSections.title,
      kind: workoutSections.kind,
      gymOk: workouts.communityId,
    })
    .from(workoutSections)
    .innerJoin(workouts, eq(workouts.id, workoutSections.workoutId))
    .where(eq(workoutSections.id, sectionId))
    .limit(1);
  if (!row || row.gymOk !== communityId) return null;
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

  // Pull the parts under this section + their blocks + movements + the
  // movement library metadata Smart Builder needs to render.
  const parts = await db
    .select()
    .from(workoutParts)
    .where(eq(workoutParts.workoutSectionId, sectionId))
    .orderBy(asc(workoutParts.orderIndex));
  const partIds = parts.map((p) => p.id);

  const blocks = partIds.length
    ? await db
        .select()
        .from(workoutBlocks)
        .where(inArray(workoutBlocks.workoutPartId, partIds))
        .orderBy(asc(workoutBlocks.orderIndex))
    : [];
  const movementRows = partIds.length
    ? await db
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
          prescribedHeightInchesMale: workoutMovements.prescribedHeightInchesMale,
          prescribedHeightInchesFemale:
            workoutMovements.prescribedHeightInchesFemale,
          prescribedWeightMaleBwMultiplier:
            workoutMovements.prescribedWeightMaleBwMultiplier,
          prescribedWeightFemaleBwMultiplier:
            workoutMovements.prescribedWeightFemaleBwMultiplier,
          tempo: workoutMovements.tempo,
          isMaxReps: workoutMovements.isMaxReps,
          isSideCadence: workoutMovements.isSideCadence,
          equipmentCount: workoutMovements.equipmentCount,
          rxStandard: workoutMovements.rxStandard,
          notes: workoutMovements.notes,
          movementName: movements.canonicalName,
          category: movements.category,
          isWeighted: movements.isWeighted,
          metricType: movements.metricType,
        })
        .from(workoutMovements)
        .innerJoin(movements, eq(movements.id, workoutMovements.movementId))
        .where(inArray(workoutMovements.workoutPartId, partIds))
        .orderBy(asc(workoutMovements.orderIndex))
    : [];

  return NextResponse.json({
    section: {
      id: section.id,
      workoutId: section.workoutId,
      kind: section.kind,
      title: section.title,
      body: section.body,
    },
    parts: parts.map((p) => ({
      ...p,
      blocks: blocks.filter((b) => b.workoutPartId === p.id),
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
    parts?: PartInput[];
  } | null;
  if (!body) {
    return NextResponse.json({ error: "Body required" }, { status: 400 });
  }

  await db.transaction(async (tx) => {
    if (body.body !== undefined) {
      await tx
        .update(workoutSections)
        .set({
          body: body.body,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(workoutSections.id, sectionId));
    }

    if (Array.isArray(body.parts)) {
      const validParts = body.parts.filter(
        (p) => p && p.workoutType && Array.isArray(p.movements)
      );

      // Remove existing parts (and their cascading blocks/movements) under
      // this section. FK cascade on workout_parts.workout_section_id is
      // delete-cascade in the schema, but we hard-delete to be explicit so
      // a reader doesn't need to know about cascade semantics.
      const existing = await tx
        .select({ id: workoutParts.id })
        .from(workoutParts)
        .where(eq(workoutParts.workoutSectionId, sectionId));
      if (existing.length > 0) {
        const ids = existing.map((p) => p.id);
        await tx
          .delete(workoutMovements)
          .where(inArray(workoutMovements.workoutPartId, ids));
        await tx
          .delete(workoutBlocks)
          .where(inArray(workoutBlocks.workoutPartId, ids));
        await tx.delete(workoutParts).where(inArray(workoutParts.id, ids));
      }

      if (validParts.length > 0) {
        // Pick an order index that doesn't collide with parts belonging to
        // sibling sections on the same workout.
        const [maxRow] = await tx
          .select({ m: max(workoutParts.orderIndex) })
          .from(workoutParts)
          .where(eq(workoutParts.workoutId, section.workoutId));
        const startOrderIndex = (maxRow?.m ?? -1) + 1;
        await insertWorkoutParts(tx, {
          workoutId: section.workoutId,
          parts: validParts,
          sectionId,
          startOrderIndex,
        });
      }

      await tx
        .update(workoutSections)
        .set({ reviewedAt: new Date(), updatedAt: new Date() })
        .where(eq(workoutSections.id, sectionId));
    }
  });

  return NextResponse.json({ ok: true });
}

// Unused, but kept for symmetry: an explicit endpoint to clear content.
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
  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: workoutParts.id })
      .from(workoutParts)
      .where(eq(workoutParts.workoutSectionId, sectionId));
    if (existing.length > 0) {
      const ids = existing.map((p) => p.id);
      await tx
        .delete(workoutMovements)
        .where(inArray(workoutMovements.workoutPartId, ids));
      await tx
        .delete(workoutBlocks)
        .where(inArray(workoutBlocks.workoutPartId, ids));
      await tx.delete(workoutParts).where(inArray(workoutParts.id, ids));
    }
    await tx
      .update(workoutSections)
      .set({ body: null, reviewedAt: new Date(), updatedAt: new Date() })
      .where(eq(workoutSections.id, sectionId));
  });
  return NextResponse.json({ ok: true });
}
