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
  programmingReleases,
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
    // When workoutId is omitted, callers can pass workoutDate to have the
    // route create the day's workout on demand. Lets coaches add sections
    // to an otherwise-empty day without first running a CAP paste.
    workoutDate?: string;
    kind?: string;
    title?: string | null;
    position?: number;
    isScored?: boolean;
    scoreType?: string | null;
    subKind?: string | null;
  } | null;
  if (!isValidKind(body?.kind)) {
    return NextResponse.json(
      { error: "A valid kind is required" },
      { status: 400 }
    );
  }
  if (!isValidScoreType(body?.scoreType ?? null)) {
    return NextResponse.json({ error: "Invalid scoreType" }, { status: 400 });
  }

  // Resolve or create the parent workout for this section.
  let workoutId = body?.workoutId ?? null;
  if (workoutId) {
    if (!(await workoutBelongsToGym(workoutId, communityId))) {
      return NextResponse.json(
        { error: "Workout not in this gym" },
        { status: 404 }
      );
    }
  } else {
    const workoutDate = body?.workoutDate;
    if (!workoutDate || !/^\d{4}-\d{2}-\d{2}$/.test(workoutDate)) {
      return NextResponse.json(
        { error: "workoutId or a valid workoutDate (YYYY-MM-DD) is required" },
        { status: 400 }
      );
    }
    workoutId = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: workouts.id })
        .from(workouts)
        .where(
          and(
            eq(workouts.communityId, communityId),
            eq(workouts.workoutDate, workoutDate)
          )
        )
        .limit(1);
      if (existing) return existing.id;
      // Find or create the draft release covering this date (week-start =
      // Monday of the date's week). Sections always live inside a release.
      const monday = mondayOf(workoutDate);
      let releaseId: string;
      const [release] = await tx
        .select({ id: programmingReleases.id })
        .from(programmingReleases)
        .where(
          and(
            eq(programmingReleases.communityId, communityId),
            eq(programmingReleases.weekStart, monday)
          )
        )
        .limit(1);
      if (release) {
        releaseId = release.id;
      } else {
        const [r] = await tx
          .insert(programmingReleases)
          .values({
            communityId,
            weekStart: monday,
            status: "draft",
            source: "manual",
          })
          .returning({ id: programmingReleases.id });
        releaseId = r.id;
      }
      const [w] = await tx
        .insert(workouts)
        .values({
          createdBy: user.id,
          communityId,
          workoutDate,
          workoutType: "other",
          programmingReleaseId: releaseId,
          published: false,
          source: "manual",
        })
        .returning({ id: workouts.id });
      return w.id;
    });
  }

  // Compute the next position if none provided.
  let position = body!.position;
  if (position === undefined) {
    const existing = await db
      .select({ position: workoutSections.position })
      .from(workoutSections)
      .where(eq(workoutSections.workoutId, workoutId!));
    position = existing.reduce((max, s) => Math.max(max, s.position + 1), 0);
  }

  const [created] = await db
    .insert(workoutSections)
    .values({
      workoutId: workoutId!,
      kind: body!.kind!,
      subKind: body!.subKind ?? null,
      position,
      title: body!.title ?? null,
      isScored: !!body!.isScored,
      scoreType: (body!.scoreType as WorkoutSectionScoreType | null) ?? null,
      reviewedAt: new Date(),
    })
    .returning();

  return NextResponse.json(created);
}

function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
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
    body?: string | null;
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
  if (body.body !== undefined) updates.body = body.body;
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
