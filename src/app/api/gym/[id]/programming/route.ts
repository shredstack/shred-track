// GET /api/gym/[id]/programming?weekStart=YYYY-MM-DD
//
// Returns the programming release + its 7 days of workouts (and their
// sections) for a single week. Coach/admin only.

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  movements,
  programmingReleases,
  workoutBlocks,
  workoutSections,
  workouts,
  workoutMovements,
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
            workoutType: workoutParts.workoutType,
            timeCapSeconds: workoutParts.timeCapSeconds,
            amrapDurationSeconds: workoutParts.amrapDurationSeconds,
            emomIntervalSeconds: workoutParts.emomIntervalSeconds,
            intervalWorkSeconds: workoutParts.intervalWorkSeconds,
            intervalRestSeconds: workoutParts.intervalRestSeconds,
            intervalRounds: workoutParts.intervalRounds,
            sideCadenceIntervalSeconds:
              workoutParts.sideCadenceIntervalSeconds,
            sideCadenceOpenEnded: workoutParts.sideCadenceOpenEnded,
            repScheme: workoutParts.repScheme,
            rounds: workoutParts.rounds,
            structure: workoutParts.structure,
          })
          .from(workoutParts)
          .where(inArray(workoutParts.workoutId, workoutIds))
          .orderBy(asc(workoutParts.orderIndex))
      : [];

  const partIds = partRows.map((p) => p.id);

  // Fetch movements + blocks for all parts so the admin day card can render
  // an inline preview without a separate per-workout round trip. Joined to
  // movements for the canonical name + metric type that the prescription
  // formatter needs.
  const movementRows =
    partIds.length > 0
      ? await db
          .select({
            id: workoutMovements.id,
            workoutPartId: workoutMovements.workoutPartId,
            workoutBlockId: workoutMovements.workoutBlockId,
            orderIndex: workoutMovements.orderIndex,
            prescribedReps: workoutMovements.prescribedReps,
            prescribedWeightMale: workoutMovements.prescribedWeightMale,
            prescribedWeightFemale: workoutMovements.prescribedWeightFemale,
            prescribedCaloriesMale: workoutMovements.prescribedCaloriesMale,
            prescribedCaloriesFemale:
              workoutMovements.prescribedCaloriesFemale,
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
            tempo: workoutMovements.tempo,
            isMaxReps: workoutMovements.isMaxReps,
            isSideCadence: workoutMovements.isSideCadence,
            equipmentCount: workoutMovements.equipmentCount,
            movementName: movements.canonicalName,
            metricType: movements.metricType,
          })
          .from(workoutMovements)
          .innerJoin(movements, eq(movements.id, workoutMovements.movementId))
          .where(inArray(workoutMovements.workoutPartId, partIds))
          .orderBy(asc(workoutMovements.orderIndex))
      : [];

  const blockRows =
    partIds.length > 0
      ? await db
          .select({
            id: workoutBlocks.id,
            workoutPartId: workoutBlocks.workoutPartId,
            orderIndex: workoutBlocks.orderIndex,
            title: workoutBlocks.title,
          })
          .from(workoutBlocks)
          .where(inArray(workoutBlocks.workoutPartId, partIds))
          .orderBy(asc(workoutBlocks.orderIndex))
      : [];

  const movementsByPart = new Map<string, typeof movementRows>();
  for (const m of movementRows) {
    if (!m.workoutPartId) continue;
    const list = movementsByPart.get(m.workoutPartId) ?? [];
    list.push(m);
    movementsByPart.set(m.workoutPartId, list);
  }

  const blocksByPart = new Map<string, typeof blockRows>();
  for (const b of blockRows) {
    const list = blocksByPart.get(b.workoutPartId) ?? [];
    list.push(b);
    blocksByPart.set(b.workoutPartId, list);
  }

  function mapPart(p: (typeof partRows)[number]) {
    return {
      id: p.id,
      label: p.label,
      orderIndex: p.orderIndex,
      notes: p.notes,
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
      blocks: (blocksByPart.get(p.id) ?? []).map((b) => ({
        id: b.id,
        orderIndex: b.orderIndex,
        title: b.title,
      })),
      movements: (movementsByPart.get(p.id) ?? []).map((m) => ({
        id: m.id,
        movementName: m.movementName,
        metricType: m.metricType,
        orderIndex: m.orderIndex,
        workoutBlockId: m.workoutBlockId,
        prescribedReps: m.prescribedReps,
        prescribedWeightMale: m.prescribedWeightMale,
        prescribedWeightFemale: m.prescribedWeightFemale,
        prescribedCaloriesMale: m.prescribedCaloriesMale,
        prescribedCaloriesFemale: m.prescribedCaloriesFemale,
        prescribedDistanceMale: m.prescribedDistanceMale,
        prescribedDistanceFemale: m.prescribedDistanceFemale,
        prescribedDurationSecondsMale: m.prescribedDurationSecondsMale,
        prescribedDurationSecondsFemale: m.prescribedDurationSecondsFemale,
        prescribedHeightInches: m.prescribedHeightInches,
        prescribedHeightInchesMale: m.prescribedHeightInchesMale,
        prescribedHeightInchesFemale: m.prescribedHeightInchesFemale,
        prescribedWeightMaleBwMultiplier:
          m.prescribedWeightMaleBwMultiplier,
        prescribedWeightFemaleBwMultiplier:
          m.prescribedWeightFemaleBwMultiplier,
        prescribedWeightPct: m.prescribedWeightPct,
        tempo: m.tempo,
        isMaxReps: m.isMaxReps,
        isSideCadence: m.isSideCadence,
        equipmentCount: m.equipmentCount,
      })),
    };
  }

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
        body: s.body,
        notes: s.notes,
        isScored: s.isScored,
        scoreType: s.scoreType,
        reviewedAt: s.reviewedAt,
        sourceTrackId: s.sourceTrackId,
        parts: (partsBySection.get(s.id) ?? []).map(mapPart),
      })),
      partsWithoutSection: (partsByWorkout.get(w.id) ?? [])
        .filter((p) => !p.workoutSectionId)
        .map(mapPart),
    })),
  });
}
