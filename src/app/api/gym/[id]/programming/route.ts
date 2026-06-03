// GET /api/gym/[id]/programming?weekStart=YYYY-MM-DD
//
// Returns the programming release for the week + every session in that
// week, grouped by date. Each date = a "workout day" with N sections
// (workout_sessions rows). Coach/admin only.
//
// Unified-schema cutover: sections ARE workout_sessions rows. Templates
// (crossfit_workouts + crossfit_workout_parts/_blocks/_movements) are
// joined per section so the admin Programming card can render its inline
// preview without round-tripping per day.

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  crossfitWorkoutBlocks,
  crossfitWorkoutMovements,
  crossfitWorkoutParts,
  crossfitWorkouts,
  movements,
  programmingReleases,
  workoutSessions,
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

  // Sessions for this week + gym.
  const sessionRows = await db
    .select({
      id: workoutSessions.id,
      crossfitWorkoutId: workoutSessions.crossfitWorkoutId,
      workoutDate: workoutSessions.workoutDate,
      kind: workoutSessions.kind,
      subKind: workoutSessions.subKind,
      position: workoutSessions.position,
      title: workoutSessions.title,
      body: workoutSessions.body,
      coachNotes: workoutSessions.coachNotes,
      isScored: workoutSessions.isScored,
      scoreType: workoutSessions.scoreType,
      programmingReleaseId: workoutSessions.programmingReleaseId,
      reviewedAt: workoutSessions.reviewedAt,
      sourceTrackId: workoutSessions.sourceTrackId,
    })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.communityId, communityId),
        gte(workoutSessions.workoutDate, weekStart),
        lte(workoutSessions.workoutDate, weekEnd)
      )
    )
    .orderBy(asc(workoutSessions.workoutDate), asc(workoutSessions.position));

  const templateIds = Array.from(
    new Set(
      sessionRows
        .map((s) => s.crossfitWorkoutId)
        .filter((id): id is string => !!id)
    )
  );
  const templates = templateIds.length
    ? await db
        .select({
          id: crossfitWorkouts.id,
          title: crossfitWorkouts.title,
          description: crossfitWorkouts.description,
          isBenchmark: crossfitWorkouts.isBenchmark,
        })
        .from(crossfitWorkouts)
        .where(inArray(crossfitWorkouts.id, templateIds))
    : [];
  const templateById = new Map(templates.map((t) => [t.id, t]));

  const partRows = templateIds.length
    ? await db
        .select({
          id: crossfitWorkoutParts.id,
          crossfitWorkoutId: crossfitWorkoutParts.crossfitWorkoutId,
          label: crossfitWorkoutParts.label,
          orderIndex: crossfitWorkoutParts.orderIndex,
          notes: crossfitWorkoutParts.notes,
          workoutType: crossfitWorkoutParts.workoutType,
          timeCapSeconds: crossfitWorkoutParts.timeCapSeconds,
          amrapDurationSeconds: crossfitWorkoutParts.amrapDurationSeconds,
          emomIntervalSeconds: crossfitWorkoutParts.emomIntervalSeconds,
          intervalWorkSeconds: crossfitWorkoutParts.intervalWorkSeconds,
          intervalRestSeconds: crossfitWorkoutParts.intervalRestSeconds,
          intervalRounds: crossfitWorkoutParts.intervalRounds,
          sideCadenceIntervalSeconds:
            crossfitWorkoutParts.sideCadenceIntervalSeconds,
          sideCadenceOpenEnded: crossfitWorkoutParts.sideCadenceOpenEnded,
          repScheme: crossfitWorkoutParts.repScheme,
          rounds: crossfitWorkoutParts.rounds,
          structure: crossfitWorkoutParts.structure,
        })
        .from(crossfitWorkoutParts)
        .where(inArray(crossfitWorkoutParts.crossfitWorkoutId, templateIds))
        .orderBy(asc(crossfitWorkoutParts.orderIndex))
    : [];
  const partsByTemplate = new Map<string, typeof partRows>();
  for (const p of partRows) {
    const list = partsByTemplate.get(p.crossfitWorkoutId) ?? [];
    list.push(p);
    partsByTemplate.set(p.crossfitWorkoutId, list);
  }

  const partIds = partRows.map((p) => p.id);
  const movementRows = partIds.length
    ? await db
        .select({
          id: crossfitWorkoutMovements.id,
          crossfitWorkoutPartId: crossfitWorkoutMovements.crossfitWorkoutPartId,
          crossfitWorkoutBlockId: crossfitWorkoutMovements.crossfitWorkoutBlockId,
          orderIndex: crossfitWorkoutMovements.orderIndex,
          prescribedReps: crossfitWorkoutMovements.prescribedReps,
          prescribedWeightMale: crossfitWorkoutMovements.prescribedWeightMale,
          prescribedWeightFemale: crossfitWorkoutMovements.prescribedWeightFemale,
          prescribedCaloriesMale: crossfitWorkoutMovements.prescribedCaloriesMale,
          prescribedCaloriesFemale:
            crossfitWorkoutMovements.prescribedCaloriesFemale,
          prescribedDistanceMale: crossfitWorkoutMovements.prescribedDistanceMale,
          prescribedDistanceFemale: crossfitWorkoutMovements.prescribedDistanceFemale,
          prescribedDurationSecondsMale:
            crossfitWorkoutMovements.prescribedDurationSecondsMale,
          prescribedDurationSecondsFemale:
            crossfitWorkoutMovements.prescribedDurationSecondsFemale,
          prescribedHeightInches: crossfitWorkoutMovements.prescribedHeightInches,
          prescribedHeightInchesMale:
            crossfitWorkoutMovements.prescribedHeightInchesMale,
          prescribedHeightInchesFemale:
            crossfitWorkoutMovements.prescribedHeightInchesFemale,
          prescribedWeightMaleBwMultiplier:
            crossfitWorkoutMovements.prescribedWeightMaleBwMultiplier,
          prescribedWeightFemaleBwMultiplier:
            crossfitWorkoutMovements.prescribedWeightFemaleBwMultiplier,
          prescribedWeightPct: crossfitWorkoutMovements.prescribedWeightPct,
          tempo: crossfitWorkoutMovements.tempo,
          isMaxReps: crossfitWorkoutMovements.isMaxReps,
          captureDurationPerRound:
            crossfitWorkoutMovements.captureDurationPerRound,
          isSideCadence: crossfitWorkoutMovements.isSideCadence,
          equipmentCount: crossfitWorkoutMovements.equipmentCount,
          movementName: movements.canonicalName,
          metricType: movements.metricType,
        })
        .from(crossfitWorkoutMovements)
        .innerJoin(movements, eq(movements.id, crossfitWorkoutMovements.movementId))
        .where(inArray(crossfitWorkoutMovements.crossfitWorkoutPartId, partIds))
        .orderBy(asc(crossfitWorkoutMovements.orderIndex))
    : [];
  const movementsByPart = new Map<string, typeof movementRows>();
  for (const m of movementRows) {
    const list = movementsByPart.get(m.crossfitWorkoutPartId) ?? [];
    list.push(m);
    movementsByPart.set(m.crossfitWorkoutPartId, list);
  }

  const blockRows = partIds.length
    ? await db
        .select({
          id: crossfitWorkoutBlocks.id,
          crossfitWorkoutPartId: crossfitWorkoutBlocks.crossfitWorkoutPartId,
          orderIndex: crossfitWorkoutBlocks.orderIndex,
          title: crossfitWorkoutBlocks.title,
        })
        .from(crossfitWorkoutBlocks)
        .where(inArray(crossfitWorkoutBlocks.crossfitWorkoutPartId, partIds))
        .orderBy(asc(crossfitWorkoutBlocks.orderIndex))
    : [];
  const blocksByPart = new Map<string, typeof blockRows>();
  for (const b of blockRows) {
    const list = blocksByPart.get(b.crossfitWorkoutPartId) ?? [];
    list.push(b);
    blocksByPart.set(b.crossfitWorkoutPartId, list);
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
        workoutBlockId: m.crossfitWorkoutBlockId,
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
        prescribedWeightMaleBwMultiplier: m.prescribedWeightMaleBwMultiplier,
        prescribedWeightFemaleBwMultiplier:
          m.prescribedWeightFemaleBwMultiplier,
        prescribedWeightPct: m.prescribedWeightPct,
        tempo: m.tempo,
        isMaxReps: m.isMaxReps,
        captureDurationPerRound: m.captureDurationPerRound,
        isSideCadence: m.isSideCadence,
        equipmentCount: m.equipmentCount,
      })),
    };
  }

  // Bucket sessions by (workoutDate, releaseId). Programmed sessions
  // (release id set) on the same date merge into one "day" bucket — that
  // matches the legacy `workouts` row the admin UI treats as the day. A
  // manual session (release id null, added from the CrossFit tab as a
  // gym admin) is its own one-session bucket; the week-view then renders
  // it under the amber "manual workouts" banner instead of silently
  // mixing it into the programmed day's `sections[]` (which dropped the
  // manual/programmed boundary when we collapsed `workouts` away).
  type Bucket = {
    workoutDate: string;
    releaseId: string | null;
    sessions: typeof sessionRows;
  };
  const programmedBucketByKey = new Map<string, Bucket>();
  const buckets: Bucket[] = [];
  for (const s of sessionRows) {
    // Sessions sourced from a programming track are authored + managed in
    // the Tracks UI and surface on the athlete CrossFit tab via the
    // inline injector. They have no place in the programming admin week
    // view — bucketing them here would dump them under the amber
    // "manual workouts" banner with a misleading "Move into programming"
    // CTA (spec §7).
    if (s.sourceTrackId) continue;
    if (s.programmingReleaseId) {
      const key = `${s.workoutDate}:${s.programmingReleaseId}`;
      let b = programmedBucketByKey.get(key);
      if (!b) {
        b = {
          workoutDate: s.workoutDate,
          releaseId: s.programmingReleaseId,
          sessions: [],
        };
        programmedBucketByKey.set(key, b);
        buckets.push(b);
      }
      b.sessions.push(s);
    } else {
      buckets.push({
        workoutDate: s.workoutDate,
        releaseId: null,
        sessions: [s],
      });
    }
  }

  const workoutsPayload = buckets.map((bucket) => {
    const first = bucket.sessions[0];
    // Owner section: prefer benchmark > wod > scored > first. Mirrors the
    // selection in session-reader so the day-level title/description point
    // at the real workout (e.g. Murph) instead of section 0's warmup, which
    // typically has no template description.
    const templateForSession = (s: (typeof bucket.sessions)[number]) =>
      s.crossfitWorkoutId ? templateById.get(s.crossfitWorkoutId) ?? null : null;
    const benchmarkSession = bucket.sessions.find(
      (s) => templateForSession(s)?.isBenchmark
    );
    const wodSession = bucket.sessions.find((s) => s.kind === "wod");
    const scoredSession = bucket.sessions.find((s) => s.isScored);
    const ownerSession =
      benchmarkSession ?? wodSession ?? scoredSession ?? first;
    const ownerTemplate = templateForSession(ownerSession);
    return {
      id: first.id,
      title: ownerTemplate?.title ?? null,
      description: ownerTemplate?.description ?? null,
      workoutDate: bucket.workoutDate,
      workoutType: null, // legacy field; derived per-section in the new schema
      programmingReleaseId: bucket.releaseId,
      reviewedAt: first.reviewedAt,
      sections: bucket.sessions.map((s) => ({
        id: s.id,
        kind: s.kind,
        subKind: s.subKind,
        position: s.position,
        title: s.title,
        body: s.body,
        notes: s.coachNotes,
        isScored: s.isScored,
        scoreType: s.scoreType,
        reviewedAt: s.reviewedAt,
        sourceTrackId: s.sourceTrackId,
        parts: s.crossfitWorkoutId
          ? (partsByTemplate.get(s.crossfitWorkoutId) ?? []).map(mapPart)
          : [],
      })),
      partsWithoutSection: [],
    };
  });

  return NextResponse.json({
    weekStart,
    release: release ?? null,
    workouts: workoutsPayload,
  });
}
