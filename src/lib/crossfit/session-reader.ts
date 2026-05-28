// ---------------------------------------------------------------------------
// Session reader — fetches sessions + their templates + parts/blocks/movements
// + the caller's scores, then groups them into the synthetic-workout response
// shape that the existing UI components (WorkoutCard, ProgrammedWorkoutDay)
// already consume.
//
// In the unified schema there's no "workout" container — a programmed gym
// day is N sessions sharing (community_id, workout_date); a personal log is
// 1 session per (user_id, workout_date). This reader groups by that key and
// emits one synthetic workout per group:
//
//   workout.id            = first session.id in the group
//   workout.workoutDate
//   workout.communityId   = group key (when gym-scoped)
//   workout.userId        = group key (when personal)
//   workout.title         = owner section's template title (benchmark > wod > scored)
//   workout.description   = owner section's template description
//   workout.requiresVest, vestWeight*, isPartner, partnerCount,
//   workout.estimatedKcal*= same — sourced from the owner section's template
//   workout.sections[]    = each session as a section (kind, position, title,
//                            body, notes (template + session concat'd),
//                            partIds, benchmarkWorkoutId)
//   workout.parts[]       = flatten all template parts (every section's
//                            template contributes its parts; ids are the
//                            crossfit_workout_parts.id, scoped per section
//                            via partIds)
//
// Scores are joined per (session, user) and attached to the part rows by
// crossfit_workout_part_id.
// ---------------------------------------------------------------------------

import { and, desc, eq, gte, ilike, inArray, isNull, lte, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  communities,
  communityMemberships,
  crossfitWorkoutBlocks,
  crossfitWorkoutMovements,
  crossfitWorkoutParts,
  crossfitWorkouts,
  movements,
  scoreMovementDetails,
  scores,
  users,
  workoutSessions,
} from "@/db/schema";
import { normalizeSetEntries } from "@/lib/crossfit/set-entries";

export interface SessionReaderFilters {
  // Required: caller's id, used to attach their scores.
  userId: string;
  // Scope. Pass exactly one — or omit both for "personal + every gym I'm
  // an active member of" (the default CrossFit-tab view).
  communityId?: string | null;
  personalOnly?: boolean;
  // Date filters.
  date?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  // Filter to sessions whose template references this movement.
  movementId?: string | null;
  // Free-text search over template title / description and session body.
  q?: string | null;
  // Row limit on the session fetch. Defaults to 50 (day view); search
  // requests usually want 100+.
  limit?: number;
  // Filter to a single session id (used by GET /api/workouts/[id]).
  sessionId?: string | null;
}

export async function readSessionWorkouts(
  filters: SessionReaderFilters
): Promise<SyntheticWorkout[]> {
  const conds: SQL<unknown>[] = [];
  if (filters.sessionId) {
    conds.push(eq(workoutSessions.id, filters.sessionId));
  } else if (filters.communityId) {
    conds.push(eq(workoutSessions.communityId, filters.communityId));
  } else if (filters.personalOnly) {
    conds.push(eq(workoutSessions.userId, filters.userId));
    conds.push(isNull(workoutSessions.communityId));
  } else {
    // Default = personal + any gym you're an active member of. Mirrors
    // the legacy default scope on /api/workouts.
    const myGyms = await db
      .select({ communityId: communityMemberships.communityId })
      .from(communityMemberships)
      .where(
        and(
          eq(communityMemberships.userId, filters.userId),
          eq(communityMemberships.isActive, true)
        )
      );
    const gymIds = myGyms.map((g) => g.communityId);
    const personalCond = and(
      eq(workoutSessions.userId, filters.userId),
      isNull(workoutSessions.communityId)
    );
    const scopeCond =
      gymIds.length > 0
        ? or(personalCond, inArray(workoutSessions.communityId, gymIds))
        : personalCond;
    if (scopeCond) conds.push(scopeCond);
  }

  if (filters.date) conds.push(eq(workoutSessions.workoutDate, filters.date));
  if (filters.startDate) conds.push(gte(workoutSessions.workoutDate, filters.startDate));
  if (filters.endDate) conds.push(lte(workoutSessions.workoutDate, filters.endDate));

  if (filters.movementId) {
    const templateIdsWithMovement = db
      .selectDistinct({ id: crossfitWorkoutMovements.crossfitWorkoutId })
      .from(crossfitWorkoutMovements)
      .where(eq(crossfitWorkoutMovements.movementId, filters.movementId));
    conds.push(
      inArray(
        workoutSessions.crossfitWorkoutId,
        templateIdsWithMovement
      )
    );
  }

  if (filters.q) {
    const pattern = `%${filters.q.trim()}%`;
    // Text search hits template title/description (via subquery) OR session body.
    const matchingTemplateIds = db
      .selectDistinct({ id: crossfitWorkouts.id })
      .from(crossfitWorkouts)
      .where(
        or(
          ilike(crossfitWorkouts.title, pattern),
          ilike(crossfitWorkouts.description, pattern)
        )
      );
    const textCond = or(
      inArray(workoutSessions.crossfitWorkoutId, matchingTemplateIds),
      ilike(workoutSessions.body, pattern)
    );
    if (textCond) conds.push(textCond);
  }

  const limit = filters.limit ?? 50;

  // Step 1: sessions. We over-fetch slightly when grouping (a day may have
  // N sessions), but `limit` here caps total sessions, not workouts. For
  // a 7-day gym programming view of ~4 sessions/day, 50 covers 12 days.
  const sessionRows = await db
    .select()
    .from(workoutSessions)
    .where(and(...conds))
    .orderBy(desc(workoutSessions.workoutDate), workoutSessions.position)
    .limit(limit);

  if (sessionRows.length === 0) return [];

  // Step 2: templates referenced by these sessions.
  const templateIds = Array.from(
    new Set(
      sessionRows
        .map((s) => s.crossfitWorkoutId)
        .filter((id): id is string => !!id)
    )
  );

  const templates = templateIds.length
    ? await db
        .select()
        .from(crossfitWorkouts)
        .where(inArray(crossfitWorkouts.id, templateIds))
    : [];
  const templateById = new Map(templates.map((t) => [t.id, t]));

  // Step 3: parts/blocks/movements for the templates.
  const partRows = templateIds.length
    ? await db
        .select()
        .from(crossfitWorkoutParts)
        .where(inArray(crossfitWorkoutParts.crossfitWorkoutId, templateIds))
        .orderBy(crossfitWorkoutParts.orderIndex)
    : [];
  const partIds = partRows.map((p) => p.id);
  const partsByTemplate = new Map<string, typeof partRows>();
  for (const p of partRows) {
    const list = partsByTemplate.get(p.crossfitWorkoutId) ?? [];
    list.push(p);
    partsByTemplate.set(p.crossfitWorkoutId, list);
  }

  const blockRows = partIds.length
    ? await db
        .select()
        .from(crossfitWorkoutBlocks)
        .where(inArray(crossfitWorkoutBlocks.crossfitWorkoutPartId, partIds))
        .orderBy(crossfitWorkoutBlocks.orderIndex)
    : [];
  const blocksByPart = new Map<string, typeof blockRows>();
  for (const b of blockRows) {
    const list = blocksByPart.get(b.crossfitWorkoutPartId) ?? [];
    list.push(b);
    blocksByPart.set(b.crossfitWorkoutPartId, list);
  }

  const movementRows = partIds.length
    ? await db
        .select({
          id: crossfitWorkoutMovements.id,
          crossfitWorkoutId: crossfitWorkoutMovements.crossfitWorkoutId,
          crossfitWorkoutPartId:
            crossfitWorkoutMovements.crossfitWorkoutPartId,
          crossfitWorkoutBlockId:
            crossfitWorkoutMovements.crossfitWorkoutBlockId,
          movementId: crossfitWorkoutMovements.movementId,
          orderIndex: crossfitWorkoutMovements.orderIndex,
          prescribedReps: crossfitWorkoutMovements.prescribedReps,
          prescribedWeightMale: crossfitWorkoutMovements.prescribedWeightMale,
          prescribedWeightFemale: crossfitWorkoutMovements.prescribedWeightFemale,
          prescribedCaloriesMale: crossfitWorkoutMovements.prescribedCaloriesMale,
          prescribedCaloriesFemale:
            crossfitWorkoutMovements.prescribedCaloriesFemale,
          prescribedDistanceMale: crossfitWorkoutMovements.prescribedDistanceMale,
          prescribedDistanceFemale:
            crossfitWorkoutMovements.prescribedDistanceFemale,
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
          prescribedWeightPctSourcePartId:
            crossfitWorkoutMovements.prescribedWeightPctSourcePartId,
          tempo: crossfitWorkoutMovements.tempo,
          isMaxReps: crossfitWorkoutMovements.isMaxReps,
          isSideCadence: crossfitWorkoutMovements.isSideCadence,
          repSchemeParsed: crossfitWorkoutMovements.repSchemeParsed,
          equipmentCount: crossfitWorkoutMovements.equipmentCount,
          rxStandard: crossfitWorkoutMovements.rxStandard,
          notes: crossfitWorkoutMovements.notes,
          movementName: movements.canonicalName,
          movementCategory: movements.category,
          isWeighted: movements.isWeighted,
          metricType: movements.metricType,
        })
        .from(crossfitWorkoutMovements)
        .innerJoin(movements, eq(movements.id, crossfitWorkoutMovements.movementId))
        .where(inArray(crossfitWorkoutMovements.crossfitWorkoutPartId, partIds))
        .orderBy(crossfitWorkoutMovements.orderIndex)
    : [];
  const movementsByPart = new Map<string, typeof movementRows>();
  for (const m of movementRows) {
    const list = movementsByPart.get(m.crossfitWorkoutPartId) ?? [];
    list.push(m);
    movementsByPart.set(m.crossfitWorkoutPartId, list);
  }

  // Step 4: caller's scores. Joined to sessions in the result set; we
  // pull every score with workoutSessionId in the session id set, scoped
  // by userId.
  const sessionIds = sessionRows.map((s) => s.id);
  const scoreRows = sessionIds.length
    ? await db
        .select()
        .from(scores)
        .where(
          and(
            inArray(scores.workoutSessionId, sessionIds),
            eq(scores.userId, filters.userId)
          )
        )
    : [];
  const scoreByPart = new Map<string, (typeof scoreRows)[number]>();
  for (const s of scoreRows) {
    if (s.crossfitWorkoutPartId) {
      scoreByPart.set(s.crossfitWorkoutPartId, s);
    }
  }

  const scoreIds = scoreRows.map((s) => s.id);
  const detailRows = scoreIds.length
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

  // Step 5: creator + community lookups for the UI "Programmed by" /
  // gym badge.
  const creatorIds = Array.from(
    new Set(
      sessionRows
        .map((s) => s.userId)
        .filter((id): id is string => !!id)
    )
  );
  const creatorRows = creatorIds.length
    ? await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, creatorIds))
    : [];
  const creatorNameById = new Map(creatorRows.map((r) => [r.id, r.name]));

  const communityIds = Array.from(
    new Set(
      sessionRows
        .map((s) => s.communityId)
        .filter((id): id is string => !!id)
    )
  );
  const communityRows = communityIds.length
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

  // Step 6: group sessions by (scope key, workoutDate) and build the
  // synthetic workout shape.
  type Group = {
    key: string;
    sessions: typeof sessionRows;
  };
  const groupByKey = new Map<string, Group>();
  for (const s of sessionRows) {
    const scopeKey = s.communityId ?? `u:${s.userId}`;
    const key = `${scopeKey}|${s.workoutDate}`;
    let g = groupByKey.get(key);
    if (!g) {
      g = { key, sessions: [] };
      groupByKey.set(key, g);
    }
    g.sessions.push(s);
  }

  // Preserve session order within each group by position; keep group
  // order by the first session's workoutDate desc.
  const result: SyntheticWorkout[] = [];
  const groups = Array.from(groupByKey.values()).sort((a, b) => {
    const da = a.sessions[0].workoutDate;
    const db_ = b.sessions[0].workoutDate;
    if (da !== db_) return da < db_ ? 1 : -1;
    return 0;
  });

  for (const group of groups) {
    const groupSessions = [...group.sessions].sort(
      (a, b) => a.position - b.position
    );
    const first = groupSessions[0];

    // Owner section: prefer a benchmark-backed session, then a wod, then
    // any scored session. Drives which template's metadata bubbles up to
    // the synthetic workout level (description, vest, partner, kcal).
    const benchmarkSession = groupSessions.find((s) => {
      const tmpl = s.crossfitWorkoutId
        ? templateById.get(s.crossfitWorkoutId)
        : null;
      return tmpl?.isBenchmark;
    });
    const wodSession = groupSessions.find((s) => s.kind === "wod");
    const scoredSession = groupSessions.find((s) => s.isScored);
    const ownerSession = benchmarkSession ?? wodSession ?? scoredSession ?? first;
    const ownerTemplate = ownerSession.crossfitWorkoutId
      ? templateById.get(ownerSession.crossfitWorkoutId)
      : null;

    // Flatten parts across every section in the group. The UI looks up
    // parts by id (via section.partIds), so a flat list with stable ids
    // is enough — order within the array doesn't matter.
    const flatParts: SyntheticWorkout["parts"] = [];
    for (const s of groupSessions) {
      if (!s.crossfitWorkoutId) continue;
      const parts = partsByTemplate.get(s.crossfitWorkoutId) ?? [];
      for (const p of parts) {
        const score = scoreByPart.get(p.id);
        flatParts.push({
          id: p.id,
          orderIndex: p.orderIndex,
          label: p.label ?? null,
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
            workoutBlockId: m.crossfitWorkoutBlockId ?? null,
            prescribedReps: m.prescribedReps,
            prescribedWeightMale: m.prescribedWeightMale,
            prescribedWeightFemale: m.prescribedWeightFemale,
            prescribedCaloriesMale: m.prescribedCaloriesMale,
            prescribedCaloriesFemale: m.prescribedCaloriesFemale,
            prescribedDistanceMale: m.prescribedDistanceMale,
            prescribedDistanceFemale: m.prescribedDistanceFemale,
            prescribedDurationSecondsMale: m.prescribedDurationSecondsMale ?? undefined,
            prescribedDurationSecondsFemale: m.prescribedDurationSecondsFemale ?? undefined,
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
                workoutPartId: score.crossfitWorkoutPartId,
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
                movementDetails: (detailsByScore.get(score.id) ?? []).map(
                  (d) => {
                    const entries = normalizeSetEntries(d.setEntries);
                    // Unified FK column drives the client wire shape;
                    // fall back to the legacy column for pre-cutover rows.
                    const movementRowId =
                      d.crossfitWorkoutMovementId ?? d.workoutMovementId;
                    return {
                      workoutMovementId: movementRowId ?? "",
                      wasRx: d.wasRx,
                      actualWeight: d.actualWeight
                        ? Number(d.actualWeight)
                        : undefined,
                      actualReps: d.actualReps ?? undefined,
                      modification: d.modification ?? undefined,
                      substitutionMovementId:
                        d.substitutionMovementId ?? undefined,
                      setEntries: entries.length > 0 ? entries : undefined,
                      actualDurationSeconds:
                        d.actualDurationSeconds ?? undefined,
                      actualHeightInches:
                        d.actualHeightInches != null
                          ? Number(d.actualHeightInches)
                          : undefined,
                      actualRepsPerRound:
                        d.actualRepsPerRound &&
                        d.actualRepsPerRound.length > 0
                          ? d.actualRepsPerRound
                          : undefined,
                      notes: d.notes ?? undefined,
                    };
                  }
                ),
              }
            : null,
        });
      }
    }

    // Sections: one per session.
    const sections = groupSessions.map((s) => {
      const tmpl = s.crossfitWorkoutId
        ? templateById.get(s.crossfitWorkoutId)
        : null;
      // Notes are template-level (always-true rule, e.g. Annie's "one
      // partner works at a time") + session-level (this-day-specific). The
      // renderer concatenates with a blank line; dedupe identical text.
      const tmplNotes = tmpl?.coachNotes?.trim() ?? "";
      const sessNotes = s.coachNotes?.trim() ?? "";
      const combinedNotes =
        !tmplNotes && !sessNotes
          ? null
          : tmplNotes === sessNotes
            ? tmplNotes
            : [tmplNotes, sessNotes].filter(Boolean).join("\n\n");
      const partIds = tmpl
        ? (partsByTemplate.get(tmpl.id) ?? []).map((p) => p.id)
        : [];
      return {
        id: s.id,
        kind: s.kind,
        position: s.position,
        title: s.title ?? tmpl?.title ?? null,
        body: s.body,
        notes: combinedNotes,
        isScored: s.isScored,
        scoreType: s.scoreType,
        partIds,
        sourceTrackId: s.sourceTrackId ?? null,
        // Track-day fields are handled by the caller when needed (the
        // gym programming card reads them); leave them null here.
        trackDayId: null,
        trackScoringConfig: null,
        trackPrescribedValue: null,
        // Benchmark id: the template id itself, only when the template
        // is_benchmark (so the UI's owner-section selection logic still
        // picks the right card for description / partner / vest chips).
        benchmarkWorkoutId: tmpl?.isBenchmark ? tmpl.id : null,
      };
    });

    result.push({
      id: first.id,
      title: ownerTemplate?.title ?? null,
      description: ownerTemplate?.description ?? null,
      workoutDate: first.workoutDate,
      createdBy: first.userId ?? "",
      creatorName: first.userId
        ? creatorNameById.get(first.userId) ?? null
        : null,
      communityId: first.communityId ?? null,
      communityName: first.communityId
        ? communityById.get(first.communityId)?.name ?? null
        : null,
      communityLogoUrl: first.communityId
        ? communityById.get(first.communityId)?.logoUrl ?? null
        : null,
      benchmarkWorkoutId: ownerTemplate?.isBenchmark
        ? ownerTemplate.id
        : null,
      requiresVest: ownerTemplate?.requiresVest ?? false,
      vestWeightMaleLb:
        ownerTemplate?.vestWeightMaleLb != null
          ? Number(ownerTemplate.vestWeightMaleLb)
          : null,
      vestWeightFemaleLb:
        ownerTemplate?.vestWeightFemaleLb != null
          ? Number(ownerTemplate.vestWeightFemaleLb)
          : null,
      isPartner: ownerTemplate?.isPartner ?? false,
      partnerCount: ownerTemplate?.partnerCount ?? null,
      estimatedKcalLow: ownerTemplate?.estimatedKcalLow ?? null,
      estimatedKcalHigh: ownerTemplate?.estimatedKcalHigh ?? null,
      estimatedKcalConfidence:
        (ownerTemplate?.estimatedKcalConfidence as
          | "high"
          | "medium"
          | "low"
          | null) ?? null,
      published: first.published,
      source: first.source,
      programmingReleaseId: first.programmingReleaseId ?? null,
      sections,
      parts: flatParts,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Response shapes. Loose typings — the legacy WorkoutDisplay in
// types/crossfit.ts is the same shape; we deliberately decouple from it
// here so changes on either side don't ripple.
// ---------------------------------------------------------------------------

export interface SyntheticWorkoutMovementScore {
  workoutMovementId: string;
  wasRx: boolean;
  actualWeight?: number;
  actualReps?: string;
  modification?: string;
  substitutionMovementId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setEntries?: any[];
  actualDurationSeconds?: number;
  actualHeightInches?: number;
  actualRepsPerRound?: number[];
  notes?: string;
}

export interface SyntheticWorkoutScore {
  id: string;
  workoutPartId: string | null;
  division: string;
  timeSeconds?: number;
  rounds?: number;
  remainderReps?: number;
  weightLbs?: string;
  totalReps?: number;
  scoreText?: string;
  hitTimeCap: boolean;
  notes?: string;
  rpe?: number;
  woreVest?: boolean | null;
  vestWeightLb?: number;
  estimatedKcal: number | null;
  estimatedKcalActive: number | null;
  estimatedKcalWithEpoc: number | null;
  estimatedKcalActiveWithEpoc: number | null;
  estimatedKcalConfidence: "high" | "medium" | "low" | null;
  movementDetails: SyntheticWorkoutMovementScore[];
}

export interface SyntheticWorkoutPart {
  id: string;
  orderIndex: number;
  label: string | null;
  workoutType: string;
  timeCapSeconds: number | null;
  amrapDurationSeconds: number | null;
  emomIntervalSeconds: number | null;
  intervalWorkSeconds: number | null;
  intervalRestSeconds: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  intervalRounds: any;
  sideCadenceIntervalSeconds: number | null;
  sideCadenceOpenEnded: boolean;
  repScheme: string | null;
  rounds: number | null;
  structure: string | null;
  notes: string | null;
  blocks: { id: string; orderIndex: number; title: string }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  movements: any[];
  score: SyntheticWorkoutScore | null;
}

export interface SyntheticWorkoutSection {
  id: string;
  kind: string;
  position: number;
  title: string | null;
  body: string | null;
  notes: string | null;
  isScored: boolean;
  scoreType: string | null;
  partIds: string[];
  sourceTrackId: string | null;
  trackDayId: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trackScoringConfig: any | null;
  trackPrescribedValue: number | null;
  benchmarkWorkoutId: string | null;
}

export interface SyntheticWorkout {
  id: string;
  title: string | null;
  description: string | null;
  workoutDate: string;
  createdBy: string;
  creatorName: string | null;
  communityId: string | null;
  communityName: string | null;
  communityLogoUrl: string | null;
  benchmarkWorkoutId: string | null;
  requiresVest: boolean;
  vestWeightMaleLb: number | null;
  vestWeightFemaleLb: number | null;
  isPartner: boolean;
  partnerCount: number | null;
  estimatedKcalLow: number | null;
  estimatedKcalHigh: number | null;
  estimatedKcalConfidence: "high" | "medium" | "low" | null;
  published: boolean;
  source: string;
  programmingReleaseId: string | null;
  sections: SyntheticWorkoutSection[];
  parts: SyntheticWorkoutPart[];
}

