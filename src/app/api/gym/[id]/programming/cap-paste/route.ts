// POST /api/gym/[id]/programming/cap-paste
//
// Takes raw CAP-style text, parses it via lib/cap-parser, and creates (or
// upserts) a draft release for the week along with one workout per day
// and one workout_section per parsed section.
//
// Coach/admin only. Re-paste overwrite rule (per spec §1.7): sections with
// reviewed_at set are preserved; sections without are replaced. Workouts
// without sections are left alone.

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import {
  programmingReleases,
  workouts,
  workoutSections,
  workoutParts,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";
import { isFlagOn } from "@/lib/feature-flags";
import { parseCapPaste } from "@/lib/cap-parser";

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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

  // CAP paste is gated by its own flag so we can ship the programming UI
  // first and turn on paste import per-gym when the parser is validated.
  if (!(await isFlagOn("cap_paste_import", { userId: user.id, communityId }))) {
    return NextResponse.json(
      { error: "CAP paste import is disabled for this gym" },
      { status: 403 }
    );
  }

  const body = (await req.json().catch(() => null)) as {
    weekStart?: string;
    text?: string;
  } | null;
  if (!body?.weekStart || !isIsoDate(body.weekStart)) {
    return NextResponse.json(
      { error: "weekStart (YYYY-MM-DD) is required" },
      { status: 400 }
    );
  }
  if (!body.text || body.text.trim().length === 0) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const parsed = parseCapPaste(body.text);
  if (parsed.days.length === 0) {
    return NextResponse.json(
      { error: "Couldn't find any day headers in the pasted text" },
      { status: 400 }
    );
  }

  const result = await db.transaction(async (tx) => {
    // Upsert the release. If one already exists in draft, we re-use it; if
    // it's already published, we still re-use it (the coach is patching).
    const existingRelease = await tx
      .select()
      .from(programmingReleases)
      .where(
        and(
          eq(programmingReleases.communityId, communityId),
          eq(programmingReleases.weekStart, body.weekStart!)
        )
      )
      .limit(1);

    let releaseId: string;
    if (existingRelease.length > 0) {
      releaseId = existingRelease[0].id;
      await tx
        .update(programmingReleases)
        .set({
          source: "cap_paste",
          sourceMeta: { rawText: body.text },
          updatedAt: new Date(),
        })
        .where(eq(programmingReleases.id, releaseId));
    } else {
      const [created] = await tx
        .insert(programmingReleases)
        .values({
          communityId,
          weekStart: body.weekStart!,
          status: "draft",
          source: "cap_paste",
          sourceMeta: { rawText: body.text },
        })
        .returning({ id: programmingReleases.id });
      releaseId = created.id;
    }

    // Each parsed day → one workout (upsert by date).
    const workoutIdByDayIndex = new Map<number, string>();
    for (const day of parsed.days) {
      const workoutDate = addDays(body.weekStart!, day.dayIndex);
      // Only reuse a workout if it already belongs to a programmed release.
      // Legacy single WODs (no programmingReleaseId) stay independent so a
      // CAP paste never absorbs a coach's ad-hoc workout.
      const existing = await tx
        .select({ id: workouts.id, reviewedAt: workouts.reviewedAt })
        .from(workouts)
        .where(
          and(
            eq(workouts.communityId, communityId),
            eq(workouts.workoutDate, workoutDate),
            isNotNull(workouts.programmingReleaseId)
          )
        )
        .limit(1);

      let workoutId: string;
      if (existing.length > 0) {
        workoutId = existing[0].id;
        await tx
          .update(workouts)
          .set({
            programmingReleaseId: releaseId,
            updatedAt: new Date(),
          })
          .where(eq(workouts.id, workoutId));
      } else {
        const [created] = await tx
          .insert(workouts)
          .values({
            createdBy: user.id,
            communityId,
            workoutDate,
            workoutType: "other",
            programmingReleaseId: releaseId,
            published: false,
            source: "parsed",
            title: day.headerText ?? null,
          })
          .returning({ id: workouts.id });
        workoutId = created.id;
      }
      workoutIdByDayIndex.set(day.dayIndex, workoutId);

      // Section replacement: keep any section with reviewed_at set; replace
      // the rest. Detach parts from sections-being-deleted first so the
      // cascade doesn't take the parts with it.
      const existingSections = await tx
        .select()
        .from(workoutSections)
        .where(eq(workoutSections.workoutId, workoutId));
      const reviewedSectionIds = new Set(
        existingSections
          .filter((s) => s.reviewedAt)
          .map((s) => s.id)
      );
      const toDeleteIds = existingSections
        .filter((s) => !reviewedSectionIds.has(s.id))
        .map((s) => s.id);

      if (toDeleteIds.length > 0) {
        // Detach parts from the about-to-be-deleted sections.
        await tx
          .update(workoutParts)
          .set({ workoutSectionId: null })
          .where(inArray(workoutParts.workoutSectionId, toDeleteIds));
        await tx
          .delete(workoutSections)
          .where(inArray(workoutSections.id, toDeleteIds));
      }

      // Insert one section per parsed section, skipping kinds already
      // present in the reviewed set (so we don't double up).
      const reviewedKinds = new Set(
        existingSections
          .filter((s) => reviewedSectionIds.has(s.id))
          .map((s) => s.kind)
      );

      let position = reviewedSectionIds.size; // append after preserved sections
      for (const section of day.sections) {
        if (reviewedKinds.has(section.kind)) continue;
        await tx.insert(workoutSections).values({
          workoutId,
          kind: section.kind,
          position,
          title: section.title,
          isScored: section.isScored,
          scoreType: section.scoreType ?? null,
        });
        position += 1;
      }
    }

    return { releaseId, days: parsed.days.length };
  });

  return NextResponse.json(result);
}
