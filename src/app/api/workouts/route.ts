import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  workouts,
  workoutParts,
  workoutBlocks,
  workoutMovements,
  movements,
  scores,
  scoreMovementDetails,
  communityMemberships,
  communities,
  crossfitWorkouts,
  workoutSections,
  users,
  programmingTrackDays,
  programmingTracks,
} from "@/db/schema";
import { eq, desc, and, inArray, gte, lte, or, ilike, isNull } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { canCreateWorkoutInGym } from "@/lib/authz/workout";
import { canViewGym } from "@/lib/authz/community";
import type { WorkoutType } from "@/types/crossfit";
import { normalizeSetEntries } from "@/lib/crossfit/set-entries";
import {
  upsertTemplate,
  type TemplatePartInput,
  type TemplatePartMovementInput,
  type UpsertTemplateScope,
} from "@/lib/crossfit/upsert-template";
import { createSession } from "@/lib/crossfit/session-writer";
import { inferWeightliftingBenchmark } from "@/lib/crossfit/weightlifting-benchmarks";
import { inngest } from "@/inngest/client";

// ============================================
// Request body shape
// ============================================
//
// The `parts[]` shape (and its movement/block sub-shapes) is the same as
// `TemplatePartInput` from `@/lib/crossfit/upsert-template` — see that
// module for the canonical type definitions. We re-export the input alias
// here so the legacy flat-shape normalizer below can name it.
type PartInput = TemplatePartInput;

// GET /api/workouts — list workouts.
// Supports filters:
//   ?communityId=<uuid>     — gym programming view: visible to all active
//                             members of that gym (not just the creator).
//   ?personal=1             — explicit personal-only view (createdBy=me AND
//                             communityId IS NULL).
//   ?date=YYYY-MM-DD        — exact match on workoutDate
//   ?startDate=YYYY-MM-DD   — workoutDate >=
//   ?endDate=YYYY-MM-DD     — workoutDate <=
//   ?movementId=<uuid>      — only workouts containing this movement
//   ?q=<text>               — case-insensitive search over title/description/rawText
// With no scope filter we return everything the caller can read: their
// personal workouts plus gym workouts from any gym they're an active
// member of. Returns each workout with its nested parts, movements, and
// (for the caller's own workouts) per-part scores + movement details.
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const communityId = params.get("communityId");
  const personal = params.get("personal");
  const date = params.get("date");
  const startDate = params.get("startDate");
  const endDate = params.get("endDate");
  const movementId = params.get("movementId");
  const q = params.get("q")?.trim();

  const conds = [];
  if (communityId) {
    // Gym programming view. Membership check before the query so a
    // non-member can't read a gym's WODs by guessing the id.
    const ok = await canViewGym(user.id, communityId);
    if (!ok)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    conds.push(eq(workouts.communityId, communityId));
  } else if (personal === "1" || personal === "true") {
    conds.push(eq(workouts.createdBy, user.id));
    conds.push(isNull(workouts.communityId));
  } else {
    // Default scope = personal + any gym the user is an active member of.
    const myGyms = await db
      .select({ communityId: communityMemberships.communityId })
      .from(communityMemberships)
      .where(
        and(
          eq(communityMemberships.userId, user.id),
          eq(communityMemberships.isActive, true)
        )
      );
    const gymIds = myGyms.map((g) => g.communityId);
    const personalCond = and(
      eq(workouts.createdBy, user.id),
      isNull(workouts.communityId)
    );
    const scopeCond =
      gymIds.length > 0
        ? or(personalCond, inArray(workouts.communityId, gymIds))
        : personalCond;
    if (scopeCond) conds.push(scopeCond);
  }
  if (date) conds.push(eq(workouts.workoutDate, date));
  if (startDate) conds.push(gte(workouts.workoutDate, startDate));
  if (endDate) conds.push(lte(workouts.workoutDate, endDate));

  if (movementId) {
    const workoutIdsWithMovement = db
      .selectDistinct({ id: workoutMovements.workoutId })
      .from(workoutMovements)
      .where(eq(workoutMovements.movementId, movementId));
    conds.push(inArray(workouts.id, workoutIdsWithMovement));
  }

  if (q) {
    const pattern = `%${q}%`;
    const textCond = or(
      ilike(workouts.title, pattern),
      ilike(workouts.description, pattern),
      ilike(workouts.rawText, pattern)
    );
    if (textCond) conds.push(textCond);
  }

  // Search requests (any filter beyond date/community) return more results so
  // the user can scan history; the day-view path stays at 50 since a single
  // date rarely has more.
  const isSearch = !!(startDate || endDate || movementId || q);
  const limit = isSearch ? 100 : 50;

  const workoutRows = await db
    .select()
    .from(workouts)
    .where(and(...conds))
    .orderBy(desc(workouts.workoutDate))
    .limit(limit);

  if (workoutRows.length === 0) return NextResponse.json([]);

  const workoutIds = workoutRows.map((w) => w.id);

  // Nested fetches — all filtered by the workout IDs we already have.
  const [partRows, movementRows, scoreRows] = await Promise.all([
    db
      .select()
      .from(workoutParts)
      .where(inArray(workoutParts.workoutId, workoutIds))
      .orderBy(workoutParts.orderIndex),
    db
      .select({
        id: workoutMovements.id,
        workoutId: workoutMovements.workoutId,
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
      .where(inArray(workoutMovements.workoutId, workoutIds))
      .orderBy(workoutMovements.orderIndex),
    db
      .select()
      .from(scores)
      .where(
        and(inArray(scores.workoutId, workoutIds), eq(scores.userId, user.id))
      ),
  ]);

  // Workout blocks for the part list — fetched after parts so we have the
  // partIds. Empty when no blocks exist (legacy workouts render flat).
  const partIds = partRows.map((p) => p.id);
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

  // Resolve creator names so the WorkoutCard can render "Programmed by
  // Coach X" on gym workouts. One query, only when there are creators we
  // don't already know.
  const creatorIds = Array.from(new Set(workoutRows.map((w) => w.createdBy)));
  const creatorRows =
    creatorIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, creatorIds))
      : [];
  const creatorNameById = new Map(creatorRows.map((r) => [r.id, r.name]));

  // Resolve gym name + logo for each gym-scoped workout. Replaces the
  // "Programmed by" attribution on member-facing cards (spec §1.3).
  const communityIds = Array.from(
    new Set(
      workoutRows
        .map((w) => w.communityId)
        .filter((id): id is string => !!id)
    )
  );
  const communityRows =
    communityIds.length > 0
      ? await db
          .select({
            id: communities.id,
            name: communities.name,
            logoUrl: communities.logoUrl,
          })
          .from(communities)
          .where(inArray(communities.id, communityIds))
      : [];
  const communityById = new Map(communityRows.map((r) => [r.id, r]));

  // Typed sections (spec §1.6). When a workout has sections, the CrossFit
  // tab renders one card per section; otherwise the legacy flat body.
  const sectionRows = await db
    .select({
      id: workoutSections.id,
      workoutId: workoutSections.workoutId,
      kind: workoutSections.kind,
      position: workoutSections.position,
      title: workoutSections.title,
      body: workoutSections.body,
      notes: workoutSections.notes,
      isScored: workoutSections.isScored,
      scoreType: workoutSections.scoreType,
      sourceTrackId: workoutSections.sourceTrackId,
      benchmarkWorkoutId: workoutSections.benchmarkWorkoutId,
    })
    .from(workoutSections)
    .where(inArray(workoutSections.workoutId, workoutIds))
    .orderBy(workoutSections.position);
  const sectionsByWorkout = new Map<string, typeof sectionRows>();
  for (const s of sectionRows) {
    const list = sectionsByWorkout.get(s.workoutId) ?? [];
    list.push(s);
    sectionsByWorkout.set(s.workoutId, list);
  }
  const partIdsBySection = new Map<string, string[]>();
  for (const p of partRows) {
    if (p.workoutSectionId) {
      const list = partIdsBySection.get(p.workoutSectionId) ?? [];
      list.push(p.id);
      partIdsBySection.set(p.workoutSectionId, list);
    }
  }

  // Track-day lookup for sections sourced from a programming track (spec
  // §3.5). The athlete needs the track_day_id to log a per-day score on
  // the free-form (non-Smart-Builder) variant of the section.
  const trackSectionRows = sectionRows.filter((s) => s.sourceTrackId);
  const trackDayBySectionId = new Map<
    string,
    {
      trackDayId: string;
      body: string | null;
      isScored: boolean;
      scoreType: string | null;
      scoringConfig: unknown;
      prescribedValue: number | null;
    }
  >();
  if (trackSectionRows.length > 0) {
    // Fetch all (trackId, workoutId) pairs in one round-trip, then match
    // back per section row.
    const trackIds = Array.from(
      new Set(trackSectionRows.map((s) => s.sourceTrackId as string))
    );
    const sectionWorkoutIds = Array.from(
      new Set(trackSectionRows.map((s) => s.workoutId))
    );
    const candidateDays = await db
      .select({
        id: programmingTrackDays.id,
        trackId: programmingTrackDays.trackId,
        workoutId: programmingTrackDays.workoutId,
        body: programmingTrackDays.body,
        isScored: programmingTrackDays.isScored,
        scoreType: programmingTrackDays.scoreType,
        scoringConfig: programmingTracks.scoringConfig,
        prescribedValue: programmingTrackDays.prescribedValue,
      })
      .from(programmingTrackDays)
      .innerJoin(
        programmingTracks,
        eq(programmingTracks.id, programmingTrackDays.trackId)
      )
      .where(
        and(
          inArray(programmingTrackDays.trackId, trackIds),
          inArray(programmingTrackDays.workoutId, sectionWorkoutIds)
        )
      );
    const dayByKey = new Map<string, (typeof candidateDays)[number]>();
    for (const d of candidateDays) {
      if (!d.workoutId) continue;
      dayByKey.set(`${d.trackId}|${d.workoutId}`, d);
    }
    for (const s of trackSectionRows) {
      if (!s.sourceTrackId) continue;
      const td = dayByKey.get(`${s.sourceTrackId}|${s.workoutId}`);
      if (!td) continue;
      trackDayBySectionId.set(s.id, {
        trackDayId: td.id,
        body: td.body,
        isScored: td.isScored,
        scoreType: td.scoreType,
        scoringConfig: td.scoringConfig,
        prescribedValue:
          td.prescribedValue == null ? null : Number(td.prescribedValue),
      });
    }
  }

  const scoreIds = scoreRows.map((s) => s.id);
  const detailRows =
    scoreIds.length > 0
      ? await db
          .select()
          .from(scoreMovementDetails)
          .where(inArray(scoreMovementDetails.scoreId, scoreIds))
      : [];

  const detailsByScore = new Map<string, typeof detailRows>();
  for (const d of detailRows) {
    const list = detailsByScore.get(d.scoreId) ?? [];
    list.push(d);
    detailsByScore.set(d.scoreId, list);
  }

  const scoreByPart = new Map<string, (typeof scoreRows)[number]>();
  for (const s of scoreRows) {
    if (s.workoutPartId) scoreByPart.set(s.workoutPartId, s);
  }

  const movementsByPart = new Map<string, typeof movementRows>();
  for (const m of movementRows) {
    if (!m.workoutPartId) continue;
    const list = movementsByPart.get(m.workoutPartId) ?? [];
    list.push(m);
    movementsByPart.set(m.workoutPartId, list);
  }

  const partsByWorkout = new Map<string, typeof partRows>();
  for (const p of partRows) {
    const list = partsByWorkout.get(p.workoutId) ?? [];
    list.push(p);
    partsByWorkout.set(p.workoutId, list);
  }

  const result = workoutRows.map((w) => ({
    ...w,
    requiresVest: w.requiresVest,
    vestWeightMaleLb:
      w.vestWeightMaleLb != null ? Number(w.vestWeightMaleLb) : null,
    vestWeightFemaleLb:
      w.vestWeightFemaleLb != null ? Number(w.vestWeightFemaleLb) : null,
    isPartner: w.isPartner,
    partnerCount: w.partnerCount,
    estimatedKcalLow: w.estimatedKcalLow ?? null,
    estimatedKcalHigh: w.estimatedKcalHigh ?? null,
    estimatedKcalConfidence:
      (w.estimatedKcalConfidence as "high" | "medium" | "low" | null) ?? null,
    creatorName: creatorNameById.get(w.createdBy) ?? null,
    communityName: w.communityId
      ? communityById.get(w.communityId)?.name ?? null
      : null,
    communityLogoUrl: w.communityId
      ? communityById.get(w.communityId)?.logoUrl ?? null
      : null,
    sections: (sectionsByWorkout.get(w.id) ?? []).map((s) => {
      const td = trackDayBySectionId.get(s.id);
      // Track-injected sections may have empty body on the section but
      // have body on the underlying track day; surface the track-day
      // body so the athlete sees the prescription text.
      const effectiveBody = s.body ?? td?.body ?? null;
      return {
        id: s.id,
        kind: s.kind,
        position: s.position,
        title: s.title,
        body: effectiveBody,
        notes: s.notes ?? null,
        isScored: td?.isScored ?? s.isScored,
        scoreType: td?.scoreType ?? s.scoreType,
        partIds: partIdsBySection.get(s.id) ?? [],
        sourceTrackId: s.sourceTrackId ?? null,
        trackDayId: td?.trackDayId ?? null,
        trackScoringConfig: td?.scoringConfig ?? null,
        trackPrescribedValue: td?.prescribedValue ?? null,
        benchmarkWorkoutId: s.benchmarkWorkoutId ?? null,
      };
    }),
    parts: (partsByWorkout.get(w.id) ?? []).map((p) => {
      const score = scoreByPart.get(p.id);
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
              woreVest: score.woreVest ?? undefined,
              vestWeightLb:
                score.vestWeightLb != null
                  ? Number(score.vestWeightLb)
                  : undefined,
              estimatedKcal: score.estimatedKcal ?? null,
              estimatedKcalActive: score.estimatedKcalActive ?? null,
              estimatedKcalWithEpoc: score.estimatedKcalWithEpoc ?? null,
              estimatedKcalActiveWithEpoc:
                score.estimatedKcalActiveWithEpoc ?? null,
              estimatedKcalConfidence:
                (score.estimatedKcalConfidence as
                  | "high"
                  | "medium"
                  | "low"
                  | null
                  | undefined) ?? null,
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
    }),
  }));

  return NextResponse.json(result);
}

// POST /api/workouts — create a workout (session + template) on the
// unified-schema tables. Every path here ends in:
//   1. An `upsertTemplate` call that resolves a `crossfit_workouts` row
//      (deduped by content fingerprint within scope), or a direct lookup of
//      an existing benchmark template.
//   2. A `createSession` call that produces a `workout_sessions` row
//      pointing at that template (kind = 'wod', position = 0).
//
// Body shapes accepted (all-or-nothing per request):
//   • Benchmark fast-path:        { benchmarkWorkoutId, workoutDate, communityId? }
//                                  benchmarkWorkoutId is a crossfit_workouts.id
//                                  with is_benchmark = true.
//   • Smart Builder (parts[]):    { parts: [...], title, description?, ... }
//   • Weightlifting attempt:      Falls through the parts path; the auto-link
//                                  inference routes the session at the
//                                  canonical weightlifting template when the
//                                  prescription qualifies.
//
// Response: the new `workout_sessions` row, augmented with `crossfitWorkoutId`
// + `isNewTemplate`. The `id` field is the session id — that's the same handle
// the GET / DELETE endpoints will use post-cutover.
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const {
    title,
    description,
    workoutDate,
    communityId,
    published,
    source,
    benchmarkWorkoutId,
    requiresVest,
    vestWeightMaleLb,
    vestWeightFemaleLb,
    isPartner,
    partnerCount,
  } = body;

  // Gym-workout authorization: only coaches/admins of the target gym can
  // create gym programming. Personal workouts (communityId omitted/null)
  // are always allowed.
  const targetCommunityId =
    typeof communityId === "string" && communityId.length > 0
      ? communityId
      : null;
  if (targetCommunityId) {
    const ok = await canCreateWorkoutInGym(user.id, targetCommunityId);
    if (!ok)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Vest validation: if the workout claims it requires a vest, at least
  // one of the gendered weights must be set. We won't trust a "true"
  // toggle with no weight on either side.
  if (requiresVest === true) {
    if (
      vestWeightMaleLb == null &&
      vestWeightFemaleLb == null
    ) {
      return NextResponse.json(
        { error: "Vest weight is required when requiresVest is true" },
        { status: 400 }
      );
    }
  }

  if (!workoutDate) {
    return NextResponse.json(
      { error: "workoutDate is required" },
      { status: 400 }
    );
  }

  const scope: UpsertTemplateScope = targetCommunityId
    ? { kind: "community", communityId: targetCommunityId }
    : { kind: "personal", userId: user.id };

  // ============================================
  // Benchmark fast-path — session points directly at the canonical template
  // ============================================
  //
  // The benchmarkWorkoutId in the request body is a `crossfit_workouts.id`
  // with `is_benchmark = true`. We don't copy parts/movements — sessions
  // share the template. The override fields (`isPartner`, `requiresVest`,
  // etc.) on the body are ignored here; in the unified schema those live
  // on the template, so changing them would either mutate the canonical
  // template (bad) or require a fork (deferred to commit #8). The picker
  // already surfaces the canonical metadata, so an athlete picking Murph
  // gets Murph's vest config without having to re-send it.

  if (benchmarkWorkoutId) {
    const [tmpl] = await db
      .select({
        id: crossfitWorkouts.id,
        isBenchmark: crossfitWorkouts.isBenchmark,
        weightliftingMovementId: crossfitWorkouts.weightliftingMovementId,
      })
      .from(crossfitWorkouts)
      .where(eq(crossfitWorkouts.id, benchmarkWorkoutId))
      .limit(1);

    if (!tmpl) {
      return NextResponse.json(
        { error: "Benchmark not found" },
        { status: 404 }
      );
    }
    if (!tmpl.isBenchmark) {
      return NextResponse.json(
        { error: "Template is not a benchmark" },
        { status: 400 }
      );
    }

    // Weightlifting benchmarks are stat-tracker anchors, not workouts to
    // pick directly — when the client supplies `parts` alongside a
    // weightlifting benchmark id, the user's typed rep/weight is the
    // prescription. Fall through to the parts path; the auto-link
    // inference there relinks the session to this canonical template.
    const hasParts =
      Array.isArray(body.parts) && (body.parts as unknown[]).length > 0;
    if (!(tmpl.weightliftingMovementId && hasParts)) {
      const session = await db.transaction(async (tx) => {
        return createSession(tx, {
          crossfitWorkoutId: tmpl.id,
          userId: targetCommunityId ? null : user.id,
          communityId: targetCommunityId,
          workoutDate,
          kind: "wod",
          position: 0,
          isScored: true,
          source: source || "benchmark",
          published: published ?? targetCommunityId !== null,
        });
      });

      await fireCalorieEstimate(tmpl.id);
      return NextResponse.json(
        { ...session, crossfitWorkoutId: tmpl.id, isNewTemplate: false },
        { status: 201 }
      );
    }
  }

  // ============================================
  // Parts path — upsert a template, then create a session pointing at it
  // ============================================

  const parts: PartInput[] = normalizeParts(body);

  if (parts.length === 0) {
    return NextResponse.json(
      { error: "At least one part with movements is required" },
      { status: 400 }
    );
  }

  const firstPart = parts[0];

  // Weightlifting auto-link: detect the qualifying shape BEFORE upserting
  // so the session lands directly on the canonical benchmark template (no
  // orphan personal template). Skipped when the caller supplied an explicit
  // `source` — that signals user intent that overrides inference.
  let autoLinkedTemplateId: string | null = null;
  if (!source && !benchmarkWorkoutId) {
    const autoLink = await inferWeightliftingBenchmark(
      db,
      parts.map((p) => ({
        workoutType: p.workoutType,
        repScheme: p.repScheme ?? null,
        movementIds: p.movements.map((m) => m.movementId),
        movementPrescribedReps: p.movements.map((m) => m.prescribedReps ?? null),
      }))
    );
    if (autoLink) autoLinkedTemplateId = autoLink.templateId;
  }

  const result = await db.transaction(async (tx) => {
    let templateId: string;
    let isNewTemplate = false;

    if (autoLinkedTemplateId) {
      // Reuse the canonical weightlifting benchmark template — the
      // athlete's actual weight will live on the score, not the template.
      templateId = autoLinkedTemplateId;
    } else {
      const upsertResult = await upsertTemplate(tx, {
        title: deriveTitle(title, firstPart),
        description: description ?? null,
        scope,
        workoutType: firstPart.workoutType,
        timeCapSeconds: firstPart.timeCapSeconds ?? null,
        amrapDurationSeconds: firstPart.amrapDurationSeconds ?? null,
        repScheme: firstPart.repScheme ?? null,
        rounds: firstPart.rounds ?? null,
        requiresVest: !!requiresVest,
        vestWeightMaleLb: vestWeightMaleLb ?? null,
        vestWeightFemaleLb: vestWeightFemaleLb ?? null,
        isPartner: !!isPartner,
        partnerCount: partnerCount ?? null,
        parts,
      });
      templateId = upsertResult.templateId;
      isNewTemplate = upsertResult.isNew;
    }

    const session = await createSession(tx, {
      crossfitWorkoutId: templateId,
      userId: targetCommunityId ? null : user.id,
      communityId: targetCommunityId,
      workoutDate,
      kind: "wod",
      position: 0,
      isScored: true,
      source:
        source || (autoLinkedTemplateId ? "benchmark_inferred" : "manual"),
      published: published ?? targetCommunityId !== null,
    });

    return { session, templateId, isNewTemplate };
  });

  await fireCalorieEstimate(result.templateId);
  return NextResponse.json(
    {
      ...result.session,
      crossfitWorkoutId: result.templateId,
      isNewTemplate: result.isNewTemplate,
    },
    { status: 201 }
  );
}

// Pick a non-empty title for the template. Templates require a NOT NULL
// title; if the client didn't send one, fall back to the first part's label
// or a generic placeholder so the row writes successfully. Cosmetic only —
// excluded from the content fingerprint, so the title choice never affects
// dedup behavior.
function deriveTitle(
  title: unknown,
  firstPart: TemplatePartInput
): string {
  const candidate = typeof title === "string" ? title.trim() : "";
  if (candidate) return candidate;
  const partLabel = firstPart.label?.trim();
  if (partLabel) return partLabel;
  return "Untitled workout";
}

// Fire-and-forget Inngest event so the template-level calorie estimate is
// computed asynchronously. Failing to send must not break the workout
// creation — the estimate can always be backfilled later. The event data
// key stays `workoutId` for now to avoid breaking pending Inngest payloads;
// the value is a `crossfit_workouts.id` post-cutover, and the compute
// function will be updated to read from the unified schema in commit #6.
async function fireCalorieEstimate(crossfitWorkoutId: string): Promise<void> {
  try {
    await inngest.send({
      name: "workouts/calories.compute",
      data: { workoutId: crossfitWorkoutId },
    });
  } catch (err) {
    console.error("[calories] failed to dispatch compute event", err);
  }
}

// ============================================
// Accept parts[] or legacy flat shape.
// ============================================

function normalizeParts(body: Record<string, unknown>): PartInput[] {
  if (Array.isArray(body.parts)) {
    return (body.parts as PartInput[]).filter(
      (p) => p?.workoutType && Array.isArray(p.movements)
    );
  }

  // Legacy: flat { workoutType, movements, ... }. Wrapped into a single
  // part. The duration/numeric coercions land later inside `upsertTemplate`
  // — we just shuttle the raw inputs through here.
  if (body.workoutType && Array.isArray(body.movements)) {
    return [
      {
        workoutType: body.workoutType as WorkoutType,
        timeCapSeconds: body.timeCapSeconds as number | undefined,
        amrapDurationSeconds: body.amrapDurationSeconds as number | undefined,
        repScheme: body.repScheme as string | undefined,
        rounds: body.rounds as number | undefined,
        movements: body.movements as TemplatePartMovementInput[],
      },
    ];
  }

  return [];
}

