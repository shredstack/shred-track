// POST   /api/gym/[id]/programming/sections          — create a section on a workout
// PATCH  /api/gym/[id]/programming/sections          — update an existing section
// DELETE /api/gym/[id]/programming/sections?id=…     — remove a section (parts get null'd)
//
// Coach/admin only. Stamps reviewed_at on the section whenever a PATCH
// touches user-edited fields so the CAP re-paste guard skips it.

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  WORKOUT_SECTION_KINDS,
  WORKOUT_SECTION_SCORE_TYPES,
  workoutParts,
  workoutSections,
  workouts,
  type WorkoutSectionKind,
  type WorkoutSectionScoreType,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";

function isValidKind(v: unknown): v is WorkoutSectionKind {
  return typeof v === "string" && (WORKOUT_SECTION_KINDS as readonly string[]).includes(v);
}
function isValidScoreType(v: unknown): v is WorkoutSectionScoreType | null {
  if (v === null || v === undefined) return true;
  return (
    typeof v === "string" &&
    (WORKOUT_SECTION_SCORE_TYPES as readonly string[]).includes(v)
  );
}

async function workoutBelongsToGym(workoutId: string, communityId: string) {
  const [w] = await db
    .select({ id: workouts.id })
    .from(workouts)
    .where(and(eq(workouts.id, workoutId), eq(workouts.communityId, communityId)))
    .limit(1);
  return !!w;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    workoutId?: string;
    kind?: string;
    title?: string | null;
    position?: number;
    isScored?: boolean;
    scoreType?: string | null;
    subKind?: string | null;
  } | null;
  if (!body?.workoutId || !isValidKind(body.kind)) {
    return NextResponse.json(
      { error: "workoutId and a valid kind are required" },
      { status: 400 }
    );
  }
  if (!(await workoutBelongsToGym(body.workoutId, communityId))) {
    return NextResponse.json({ error: "Workout not in this gym" }, { status: 404 });
  }
  if (!isValidScoreType(body.scoreType ?? null)) {
    return NextResponse.json({ error: "Invalid scoreType" }, { status: 400 });
  }

  // Compute the next position if none provided.
  let position = body.position;
  if (position === undefined) {
    const existing = await db
      .select({ position: workoutSections.position })
      .from(workoutSections)
      .where(eq(workoutSections.workoutId, body.workoutId));
    position = existing.reduce((max, s) => Math.max(max, s.position + 1), 0);
  }

  const [created] = await db
    .insert(workoutSections)
    .values({
      workoutId: body.workoutId,
      kind: body.kind,
      subKind: body.subKind ?? null,
      position,
      title: body.title ?? null,
      isScored: !!body.isScored,
      scoreType: (body.scoreType as WorkoutSectionScoreType | null) ?? null,
      reviewedAt: new Date(),
    })
    .returning();

  return NextResponse.json(created);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    id?: string;
    kind?: string;
    title?: string | null;
    position?: number;
    isScored?: boolean;
    scoreType?: string | null;
    subKind?: string | null;
  } | null;
  if (!body?.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  // Verify the section's workout belongs to this gym.
  const [section] = await db
    .select({
      id: workoutSections.id,
      workoutId: workoutSections.workoutId,
    })
    .from(workoutSections)
    .where(eq(workoutSections.id, body.id))
    .limit(1);
  if (!section) {
    return NextResponse.json({ error: "Section not found" }, { status: 404 });
  }
  if (!(await workoutBelongsToGym(section.workoutId, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const updates: Partial<typeof workoutSections.$inferInsert> = {
    reviewedAt: new Date(),
    updatedAt: new Date(),
  };
  if (body.kind !== undefined) {
    if (!isValidKind(body.kind)) {
      return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
    }
    updates.kind = body.kind;
  }
  if (body.title !== undefined) updates.title = body.title;
  if (body.position !== undefined) updates.position = body.position;
  if (body.isScored !== undefined) updates.isScored = body.isScored;
  if (body.subKind !== undefined) updates.subKind = body.subKind;
  if (body.scoreType !== undefined) {
    if (!isValidScoreType(body.scoreType)) {
      return NextResponse.json({ error: "Invalid scoreType" }, { status: 400 });
    }
    updates.scoreType = (body.scoreType as WorkoutSectionScoreType | null) ?? null;
  }

  const [updated] = await db
    .update(workoutSections)
    .set(updates)
    .where(eq(workoutSections.id, body.id))
    .returning();

  return NextResponse.json(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const [section] = await db
    .select({ id: workoutSections.id, workoutId: workoutSections.workoutId })
    .from(workoutSections)
    .where(eq(workoutSections.id, id))
    .limit(1);
  if (!section) return NextResponse.json({ ok: true });
  if (!(await workoutBelongsToGym(section.workoutId, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.transaction(async (tx) => {
    // Detach parts so they survive section deletion.
    await tx
      .update(workoutParts)
      .set({ workoutSectionId: null })
      .where(inArray(workoutParts.workoutSectionId, [id]));
    await tx.delete(workoutSections).where(eq(workoutSections.id, id));
  });

  return NextResponse.json({ ok: true });
}
