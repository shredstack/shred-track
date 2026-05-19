// GET /api/gym/[id]/programming?weekStart=YYYY-MM-DD
//
// Returns the programming release + its 7 days of workouts (and their
// sections) for a single week. Coach/admin only.

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  programmingReleases,
  workoutSections,
  workouts,
  workoutParts,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function GET(
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
  const weekStart = url.searchParams.get("weekStart");
  if (!weekStart || !isIsoDate(weekStart)) {
    return NextResponse.json(
      { error: "weekStart must be YYYY-MM-DD" },
      { status: 400 }
    );
  }
  const weekEnd = addDays(weekStart, 6);

  const [release] = await db
    .select()
    .from(programmingReleases)
    .where(
      and(
        eq(programmingReleases.communityId, communityId),
        eq(programmingReleases.weekStart, weekStart)
      )
    )
    .limit(1);

  // Workouts in this week for the gym, whether or not they're tied to the
  // release (legacy gym workouts pre-§1.6 won't be).
  const workoutRows = await db
    .select({
      id: workouts.id,
      title: workouts.title,
      description: workouts.description,
      workoutDate: workouts.workoutDate,
      workoutType: workouts.workoutType,
      programmingReleaseId: workouts.programmingReleaseId,
      reviewedAt: workouts.reviewedAt,
    })
    .from(workouts)
    .where(
      and(
        eq(workouts.communityId, communityId),
        gte(workouts.workoutDate, weekStart),
        lte(workouts.workoutDate, weekEnd)
      )
    )
    .orderBy(asc(workouts.workoutDate));

  const workoutIds = workoutRows.map((w) => w.id);
  const sectionRows =
    workoutIds.length > 0
      ? await db
          .select()
          .from(workoutSections)
          .where(inArray(workoutSections.workoutId, workoutIds))
          .orderBy(asc(workoutSections.position))
      : [];

  const sectionsByWorkout = new Map<string, typeof sectionRows>();
  for (const s of sectionRows) {
    const list = sectionsByWorkout.get(s.workoutId) ?? [];
    list.push(s);
    sectionsByWorkout.set(s.workoutId, list);
  }

  const partRows =
    workoutIds.length > 0
      ? await db
          .select({
            id: workoutParts.id,
            workoutId: workoutParts.workoutId,
            workoutSectionId: workoutParts.workoutSectionId,
            label: workoutParts.label,
            orderIndex: workoutParts.orderIndex,
            notes: workoutParts.notes,
          })
          .from(workoutParts)
          .where(inArray(workoutParts.workoutId, workoutIds))
          .orderBy(asc(workoutParts.orderIndex))
      : [];

  const partsBySection = new Map<string, typeof partRows>();
  const partsByWorkout = new Map<string, typeof partRows>();
  for (const p of partRows) {
    if (p.workoutSectionId) {
      const list = partsBySection.get(p.workoutSectionId) ?? [];
      list.push(p);
      partsBySection.set(p.workoutSectionId, list);
    }
    const wlist = partsByWorkout.get(p.workoutId) ?? [];
    wlist.push(p);
    partsByWorkout.set(p.workoutId, wlist);
  }

  return NextResponse.json({
    weekStart,
    release: release ?? null,
    workouts: workoutRows.map((w) => ({
      id: w.id,
      title: w.title,
      description: w.description,
      workoutDate: w.workoutDate,
      workoutType: w.workoutType,
      programmingReleaseId: w.programmingReleaseId,
      reviewedAt: w.reviewedAt,
      sections: (sectionsByWorkout.get(w.id) ?? []).map((s) => ({
        id: s.id,
        kind: s.kind,
        subKind: s.subKind,
        position: s.position,
        title: s.title,
        isScored: s.isScored,
        scoreType: s.scoreType,
        reviewedAt: s.reviewedAt,
        sourceTrackId: s.sourceTrackId,
        parts: (partsBySection.get(s.id) ?? []).map((p) => ({
          id: p.id,
          label: p.label,
          orderIndex: p.orderIndex,
          notes: p.notes,
        })),
      })),
      partsWithoutSection: (partsByWorkout.get(w.id) ?? [])
        .filter((p) => !p.workoutSectionId)
        .map((p) => ({
          id: p.id,
          label: p.label,
          orderIndex: p.orderIndex,
          notes: p.notes,
        })),
    })),
  });
}
