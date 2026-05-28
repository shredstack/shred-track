// POST /api/gym/[id]/programming/sections/from-workout
//
// Move a manual CrossFit-tab workout into the day's programming as a new
// section of the chosen kind. The source workout's parts, movements, and
// scores get reparented onto the day's programmed workout; the source
// workout shell is then deleted so the manual entry disappears from the
// CrossFit tab.
//
// Body: { sourceWorkoutId, kind, workoutDate (YYYY-MM-DD) }
// Coach/admin only.

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import {
  WORKOUT_SECTION_KINDS,
  classInstances,
  gymPosts,
  programmingReleases,
  scores,
  workoutMovements,
  workoutParts,
  workoutSections,
  workouts,
  type WorkoutSectionKind,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";

function isValidKind(v: unknown): v is WorkoutSectionKind {
  return (
    typeof v === "string" &&
    (WORKOUT_SECTION_KINDS as readonly string[]).includes(v)
  );
}

function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: communityId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    sourceWorkoutId?: string;
    kind?: string;
    workoutDate?: string;
  } | null;

  if (!body?.sourceWorkoutId) {
    return NextResponse.json(
      { error: "sourceWorkoutId is required" },
      { status: 400 }
    );
  }
  if (!isValidKind(body.kind)) {
    return NextResponse.json({ error: "A valid kind is required" }, { status: 400 });
  }
  const workoutDate = body.workoutDate;
  if (!workoutDate || !/^\d{4}-\d{2}-\d{2}$/.test(workoutDate)) {
    return NextResponse.json(
      { error: "workoutDate (YYYY-MM-DD) is required" },
      { status: 400 }
    );
  }

  // Confirm the source workout belongs to this gym and is a manual workout
  // (no programming release). Refuse to move workouts that are already
  // part of a release — those are already in programming.
  //
  // Also pull benchmark + partner + vest metadata: benchmark-tagged manual
  // adds carry their description / partner / vest flags on the workout row
  // (set by POST /api/workouts' fast path). The move needs to forward
  // them to the destination so the section reads identically to one
  // composed via the programming admin's Benchmark tab.
  const [source] = await db
    .select({
      id: workouts.id,
      title: workouts.title,
      description: workouts.description,
      workoutDate: workouts.workoutDate,
      programmingReleaseId: workouts.programmingReleaseId,
      benchmarkWorkoutId: workouts.benchmarkWorkoutId,
      isPartner: workouts.isPartner,
      partnerCount: workouts.partnerCount,
      requiresVest: workouts.requiresVest,
      vestWeightMaleLb: workouts.vestWeightMaleLb,
      vestWeightFemaleLb: workouts.vestWeightFemaleLb,
    })
    .from(workouts)
    .where(
      and(
        eq(workouts.id, body.sourceWorkoutId),
        eq(workouts.communityId, communityId)
      )
    )
    .limit(1);
  if (!source) {
    return NextResponse.json(
      { error: "Workout not found in this gym" },
      { status: 404 }
    );
  }
  if (source.programmingReleaseId) {
    return NextResponse.json(
      { error: "Workout is already part of programming" },
      { status: 400 }
    );
  }
  if (source.workoutDate !== workoutDate) {
    return NextResponse.json(
      { error: "Source workout's date does not match the target date" },
      { status: 400 }
    );
  }

  const kind = body.kind;

  try {
    const result = await db.transaction(async (tx) => {
      // Find or create the destination programmed workout for the date.
      let destWorkoutId: string;
      const [existing] = await tx
        .select({ id: workouts.id })
        .from(workouts)
        .where(
          and(
            eq(workouts.communityId, communityId),
            eq(workouts.workoutDate, workoutDate),
            isNotNull(workouts.programmingReleaseId)
          )
        )
        .limit(1);
      if (existing) {
        destWorkoutId = existing.id;
      } else {
        // Find or create the draft release for the week.
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
        destWorkoutId = w.id;
      }

      // Next position for the new section.
      const positions = await tx
        .select({ position: workoutSections.position })
        .from(workoutSections)
        .where(eq(workoutSections.workoutId, destWorkoutId));
      const nextPosition = positions.reduce(
        (max, s) => Math.max(max, s.position + 1),
        0
      );

      // Create the new section. Use the source workout's title so the
      // section header shows something meaningful (e.g. "Cindy"). Carry
      // the benchmark link over so athlete scores logged against this
      // section still roll up into the benchmark's history / trends, and
      // so ProgrammedWorkoutDay attaches the description / partner / vest
      // chips to this section (same owner-selection logic as a section
      // composed via the programming admin's Benchmark tab).
      const [newSection] = await tx
        .insert(workoutSections)
        .values({
          workoutId: destWorkoutId,
          kind,
          position: nextPosition,
          title: source.title?.trim() ? source.title : null,
          benchmarkWorkoutId: source.benchmarkWorkoutId,
          reviewedAt: new Date(),
        })
        .returning();

      // Move the source workout's parts. Renumber orderIndex sequentially
      // from the destination's current max so we don't collide with the
      // (workoutId, orderIndex) unique index.
      const destPartsMax = await tx
        .select({ orderIndex: workoutParts.orderIndex })
        .from(workoutParts)
        .where(eq(workoutParts.workoutId, destWorkoutId));
      const baseOrder = destPartsMax.reduce(
        (max, p) => Math.max(max, p.orderIndex + 1),
        0
      );

      const sourceParts = await tx
        .select({ id: workoutParts.id, orderIndex: workoutParts.orderIndex })
        .from(workoutParts)
        .where(eq(workoutParts.workoutId, source.id))
        .orderBy(workoutParts.orderIndex);

      // Two-phase update: bump source parts' orderIndex into a temporary
      // high range first to avoid colliding with destination's existing
      // (workoutId, orderIndex) pairs once we flip workoutId. Then flip
      // workoutId + workoutSectionId + final orderIndex in one shot.
      // Use a large offset that can't realistically overlap.
      const SAFE_OFFSET = 1_000_000;
      for (let i = 0; i < sourceParts.length; i++) {
        await tx
          .update(workoutParts)
          .set({ orderIndex: SAFE_OFFSET + i })
          .where(eq(workoutParts.id, sourceParts[i].id));
      }
      for (let i = 0; i < sourceParts.length; i++) {
        await tx
          .update(workoutParts)
          .set({
            workoutId: destWorkoutId,
            workoutSectionId: newSection.id,
            orderIndex: baseOrder + i,
          })
          .where(eq(workoutParts.id, sourceParts[i].id));
      }

      // Reparent any workoutMovements / scores that referenced the source
      // workout directly. (workoutMovements.workoutPartId stays valid since
      // the parts themselves moved with us; only the denormalized workoutId
      // needs updating.)
      await tx
        .update(workoutMovements)
        .set({ workoutId: destWorkoutId })
        .where(eq(workoutMovements.workoutId, source.id));
      await tx
        .update(scores)
        .set({ workoutId: destWorkoutId })
        .where(eq(scores.workoutId, source.id));

      // Any sections that lived on the source workout get cascade-deleted
      // with the workout below. Parts have already been reparented so this
      // only drops the empty section shells.

      // Lift workout-level metadata from the source onto the destination,
      // but only into fields still at their default. Mirrors the same
      // "don't clobber a coach's prior customization" rule the backfill
      // snippet uses. Title goes the same way as the rest. We never
      // downgrade a true partner/vest flag to false — only flip false to
      // true when the source asks for it.
      const [dest] = await tx
        .select({
          title: workouts.title,
          description: workouts.description,
          isPartner: workouts.isPartner,
          partnerCount: workouts.partnerCount,
          requiresVest: workouts.requiresVest,
          vestWeightMaleLb: workouts.vestWeightMaleLb,
          vestWeightFemaleLb: workouts.vestWeightFemaleLb,
        })
        .from(workouts)
        .where(eq(workouts.id, destWorkoutId))
        .limit(1);
      const patch: Record<string, unknown> = {};
      if (dest && !dest.title && source.title?.trim()) {
        patch.title = source.title;
      }
      if (dest && dest.description == null && source.description != null) {
        patch.description = source.description;
      }
      if (dest && dest.isPartner === false && source.isPartner === true) {
        patch.isPartner = true;
      }
      if (
        dest &&
        dest.partnerCount == null &&
        source.partnerCount != null
      ) {
        patch.partnerCount = source.partnerCount;
      }
      if (
        dest &&
        dest.requiresVest === false &&
        source.requiresVest === true
      ) {
        patch.requiresVest = true;
      }
      if (
        dest &&
        dest.vestWeightMaleLb == null &&
        source.vestWeightMaleLb != null
      ) {
        patch.vestWeightMaleLb = source.vestWeightMaleLb;
      }
      if (
        dest &&
        dest.vestWeightFemaleLb == null &&
        source.vestWeightFemaleLb != null
      ) {
        patch.vestWeightFemaleLb = source.vestWeightFemaleLb;
      }
      if (Object.keys(patch).length > 0) {
        patch.updatedAt = new Date();
        await tx
          .update(workouts)
          .set(patch)
          .where(eq(workouts.id, destWorkoutId));
      }

      // class_instances.workout_id and gym_posts.workout_id reference
      // workouts with no ON DELETE rule. Null them out before deleting the
      // source shell so a manual workout that's been scheduled to a class
      // or posted to the feed can still be moved into programming.
      await tx
        .update(classInstances)
        .set({ workoutId: null })
        .where(eq(classInstances.workoutId, source.id));
      await tx
        .update(gymPosts)
        .set({ workoutId: null })
        .where(eq(gymPosts.workoutId, source.id));

      // Finally delete the source workout shell.
      await tx.delete(workouts).where(eq(workouts.id, source.id));

      return { sectionId: newSection.id, workoutId: destWorkoutId };
    });

    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to move workout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
