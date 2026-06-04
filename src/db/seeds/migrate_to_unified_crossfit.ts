// ---------------------------------------------------------------------------
// One-shot data migration: legacy `workouts` / `benchmark_workouts` /
// `workout_sections` trees → unified `crossfit_workouts` + `workout_sessions`.
//
// Runs as part of the seed pipeline on deploy. Idempotent: if the legacy
// `workouts` table has been dropped (drop migration applied), the script
// exits cleanly. If the legacy tables exist but every row already has a
// mapped session, the script also no-ops.
//
// On first run, the script:
//   1. Creates one `crossfit_workouts` row per `benchmark_workouts` row,
//      preserving `is_system` and `is_benchmark = true`. Records bw → cw
//      and bw_part → cw_part id maps.
//   2. For each `workouts` row that has parts, either reuses a benchmark
//      template (if `benchmark_workout_id` is set) or creates a new
//      personal/gym template deduplicated by fingerprint. Records
//      w → cw and w_part → cw_part id maps.
//   3. Creates `workout_sessions` rows:
//        - Non-sectioned workouts: one session per workout, template-backed.
//        - Sectioned workouts: one session per section. Warm-up / stretching
//          sections are freeform body-only; other kinds resolve a template
//          from the section's parts (or from `section.benchmark_workout_id`).
//   4. Re-FKs `scores` to (workout_session_id, crossfit_workout_part_id).
//   5. Re-FKs cross-domain references (notifications, programming_track_days,
//      class_instances, gym_posts) so their `workout_session_id` columns are
//      populated alongside the legacy `workout_id`.
//   6. Runs verify assertions inside the transaction; any failure rolls
//      back the entire backfill.
//
// See claude_code_instructions/crossfit_improvements/unified_crossfit_workout_template_spec.md.
// ---------------------------------------------------------------------------

import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql, eq, and, isNotNull, inArray } from "drizzle-orm";
import { fileURLToPath } from "url";

import * as schema from "../schema";
import {
  benchmarkWorkoutMovements,
  benchmarkWorkoutParts,
  benchmarkWorkouts,
  classInstances,
  crossfitWorkoutBlocks,
  crossfitWorkoutMovements,
  crossfitWorkoutParts,
  crossfitWorkouts,
  gymPosts,
  notifications,
  programmingTrackDays,
  scoreMovementDetails,
  scores,
  workoutBlocks,
  workoutMovements,
  workoutParts,
  workoutSections,
  workoutSessions,
  workouts,
} from "../schema";
import {
  buildFingerprintInput,
  type TemplatePartInput,
  type TemplatePartBlockInput,
  type TemplatePartMovementInput,
} from "@/lib/crossfit/upsert-template";
import { computeWorkoutFingerprint } from "@/lib/crossfit/fingerprint";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

export async function run(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client, { schema });

  try {
    const legacyExists = await checkLegacyTablesExist(db);
    if (!legacyExists) {
      console.log("[migrate_to_unified_crossfit] legacy tables already dropped — skip");
      return;
    }

    const unmigratedCount = await countUnmigratedWorkouts(db);
    const orphanSmdCount = await countOrphanedScoreMovementDetails(db);
    if (unmigratedCount === 0 && orphanSmdCount === 0) {
      console.log(
        "[migrate_to_unified_crossfit] every workout already mapped and no SMD orphans — skip"
      );
      return;
    }
    if (unmigratedCount > 0) {
      console.log(
        `[migrate_to_unified_crossfit] backfilling ${unmigratedCount} unmigrated workouts`
      );
    }
    if (orphanSmdCount > 0) {
      console.log(
        `[migrate_to_unified_crossfit] re-FKing ${orphanSmdCount} orphaned score_movement_details`
      );
    }

    const preScoreCount = await countScores(db);

    await db.transaction(async (tx) => {
      // Workout / session / score backfill only runs when there's something
      // to do. The score_movement_details re-FK runs unconditionally because
      // it's idempotent against an empty orphan set and self-heals rows that
      // slipped through earlier runs.
      if (unmigratedCount > 0) {
        const { benchmarkTemplateMap, benchmarkPartMap } =
          await backfillBenchmarkTemplates(tx);
        console.log(
          `  → backfilled ${benchmarkTemplateMap.size} benchmark templates`
        );

        const { workoutTemplateMap, workoutPartMap } =
          await backfillWorkoutTemplates(tx, {
            benchmarkTemplateMap,
            benchmarkPartMap,
          });
        console.log(
          `  → mapped ${workoutTemplateMap.size} workouts to templates`
        );

        const { workoutSessionMap, sectionSessionMap } =
          await backfillSessionsFromWorkouts(tx, {
            workoutTemplateMap,
            benchmarkTemplateMap,
            workoutPartMap,
          });
        console.log(
          `  → created sessions: ${workoutSessionMap.size} workout-level + ${sectionSessionMap.size} section-level`
        );

        await reFKScores(tx, {
          workoutSessionMap,
          sectionSessionMap,
          workoutPartMap,
        });
        console.log("  → re-FK'd scores");

        await reFKCrossDomain(tx, { workoutSessionMap });
        console.log("  → re-FK'd cross-domain references");
      }

      await reFKScoreMovementDetails(tx);

      await runVerifyAssertions(tx, { preScoreCount });
      console.log("  → verify assertions passed");
    });

    console.log("[migrate_to_unified_crossfit] done");
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// Step 0: pre-flight checks
// ---------------------------------------------------------------------------

async function checkLegacyTablesExist(db: Tx): Promise<boolean> {
  const result = await db.execute(sql`
    select count(*)::int as count
    from information_schema.tables
    where table_schema = 'public' and table_name = 'workouts'
  `);
  const row = result?.[0] ?? result?.rows?.[0];
  return Number(row?.count ?? 0) > 0;
}

async function countUnmigratedWorkouts(db: Tx): Promise<number> {
  // Count workouts that have no corresponding session yet.
  const result = await db.execute(sql`
    select count(*)::int as count
    from workouts w
    where not exists (
      select 1 from workout_sessions ws
      where (ws.user_id = w.created_by or ws.community_id = w.community_id)
        and ws.workout_date = w.workout_date
    )
  `);
  const row = result?.[0] ?? result?.rows?.[0];
  return Number(row?.count ?? 0);
}

async function countScores(db: Tx): Promise<number> {
  const [row] = await db.select({ c: sql<number>`count(*)::int` }).from(scores);
  return Number(row?.c ?? 0);
}

// Count score_movement_details rows that the unified-schema cutover left
// stranded: legacy FK populated, unified FK null, AND the score is anchored
// to a non-null crossfit_workout_part_id so the lookup actually has a
// template to resolve against. SMD rows attached to scores whose part lived
// on a freeform section (warm_up / stretching) are deliberately excluded —
// those sessions never got a template, so there is no
// crossfit_workout_movement to map onto. See the orphanedPartFK exemption
// in runVerifyAssertions for the matching rule on scores.
async function countOrphanedScoreMovementDetails(db: Tx): Promise<number> {
  const result = await db.execute(sql`
    select count(*)::int as count
    from score_movement_details smd
    join scores s on s.id = smd.score_id
    where smd.crossfit_workout_movement_id is null
      and smd.workout_movement_id is not null
      and s.crossfit_workout_part_id is not null
  `);
  const row = result?.[0] ?? result?.rows?.[0];
  return Number(row?.count ?? 0);
}

// ---------------------------------------------------------------------------
// Step 1: benchmark templates
// ---------------------------------------------------------------------------

type BenchmarkTemplateMap = Map<string, string>; // bw_id → cw_id
type BenchmarkPartMap = Map<string, string>; // bw_part_id → cw_part_id

async function backfillBenchmarkTemplates(
  tx: Tx
): Promise<{
  benchmarkTemplateMap: BenchmarkTemplateMap;
  benchmarkPartMap: BenchmarkPartMap;
}> {
  const benchmarkTemplateMap: BenchmarkTemplateMap = new Map();
  const benchmarkPartMap: BenchmarkPartMap = new Map();

  const bws = await tx.select().from(benchmarkWorkouts);
  for (const bw of bws) {
    // Load parts + blocks + movements for the benchmark.
    const parts = await tx
      .select()
      .from(benchmarkWorkoutParts)
      .where(eq(benchmarkWorkoutParts.benchmarkWorkoutId, bw.id))
      .orderBy(benchmarkWorkoutParts.orderIndex);

    const partTrees: TemplatePartInput[] = [];
    const partIdToOriginal: string[] = []; // index aligned with partTrees

    for (const p of parts) {
      const blocks = await tx
        .select()
        .from(schema.benchmarkWorkoutBlocks)
        .where(eq(schema.benchmarkWorkoutBlocks.benchmarkWorkoutPartId, p.id))
        .orderBy(schema.benchmarkWorkoutBlocks.orderIndex);
      const movements = await tx
        .select()
        .from(benchmarkWorkoutMovements)
        .where(eq(benchmarkWorkoutMovements.benchmarkWorkoutPartId, p.id))
        .orderBy(benchmarkWorkoutMovements.orderIndex);

      const tempBlockRefs = new Map<string, string>();
      blocks.forEach((b: { id: string }, i: number) => {
        tempBlockRefs.set(b.id, `bwbl-${b.id}`);
      });

      const blockInputs: TemplatePartBlockInput[] = blocks.map(
        (b: { id: string; orderIndex: number; title: string }) => ({
          tempRef: tempBlockRefs.get(b.id),
          title: b.title,
          orderIndex: b.orderIndex,
        })
      );

      const movementInputs: TemplatePartMovementInput[] = movements.map(
        (m: typeof benchmarkWorkoutMovements.$inferSelect, i: number) => ({
          movementId: m.movementId,
          orderIndex: m.orderIndex ?? i,
          prescribedReps: m.prescribedReps ?? undefined,
          prescribedWeightMale: m.prescribedWeightMale ?? undefined,
          prescribedWeightFemale: m.prescribedWeightFemale ?? undefined,
          prescribedCaloriesMale: m.prescribedCaloriesMale ?? undefined,
          prescribedCaloriesFemale: m.prescribedCaloriesFemale ?? undefined,
          prescribedDistanceMale: m.prescribedDistanceMale ?? undefined,
          prescribedDistanceFemale: m.prescribedDistanceFemale ?? undefined,
          prescribedDurationSecondsMale:
            m.prescribedDurationSecondsMale ?? undefined,
          prescribedDurationSecondsFemale:
            m.prescribedDurationSecondsFemale ?? undefined,
          prescribedHeightInches: m.prescribedHeightInches ?? undefined,
          prescribedHeightInchesMale: m.prescribedHeightInchesMale ?? undefined,
          prescribedHeightInchesFemale:
            m.prescribedHeightInchesFemale ?? undefined,
          prescribedWeightMaleBwMultiplier:
            m.prescribedWeightMaleBwMultiplier ?? undefined,
          prescribedWeightFemaleBwMultiplier:
            m.prescribedWeightFemaleBwMultiplier ?? undefined,
          tempo: m.tempo ?? undefined,
          isMaxReps: !!m.isMaxReps,
          isSideCadence: !!m.isSideCadence,
          equipmentCount: m.equipmentCount ?? undefined,
          rxStandard: m.rxStandard ?? undefined,
          notes: m.notes ?? undefined,
          blockTempRef: m.benchmarkWorkoutBlockId
            ? tempBlockRefs.get(m.benchmarkWorkoutBlockId) ?? null
            : null,
        })
      );

      partTrees.push({
        label: p.label ?? undefined,
        workoutType: p.workoutType as TemplatePartInput["workoutType"],
        timeCapSeconds: p.timeCapSeconds ?? undefined,
        amrapDurationSeconds: p.amrapDurationSeconds ?? undefined,
        emomIntervalSeconds: p.emomIntervalSeconds ?? undefined,
        intervalWorkSeconds: p.intervalWorkSeconds ?? undefined,
        intervalRestSeconds: p.intervalRestSeconds ?? undefined,
        intervalRounds: Array.isArray(p.intervalRounds)
          ? (p.intervalRounds as TemplatePartInput["intervalRounds"])
          : undefined,
        sideCadenceIntervalSeconds: p.sideCadenceIntervalSeconds ?? undefined,
        sideCadenceOpenEnded: !!p.sideCadenceOpenEnded,
        repScheme: p.repScheme ?? undefined,
        rounds: p.rounds ?? undefined,
        structure: p.structure ?? undefined,
        notes: p.notes ?? undefined,
        movements: movementInputs,
        blocks: blockInputs,
      });
      partIdToOriginal.push(p.id);
    }

    // Fingerprint and insert. Benchmarks aren't deduped (each one stays
    // its own template even if two share a prescription).
    const fingerprintInput = buildFingerprintInput({
      title: bw.name,
      isBenchmark: true,
      isSystem: bw.isSystem,
      scope: bw.isSystem
        ? { kind: "system" }
        : bw.createdBy
          ? { kind: "personal", userId: bw.createdBy }
          : { kind: "community", communityId: bw.communityId! },
      workoutType: bw.workoutType as TemplatePartInput["workoutType"],
      timeCapSeconds: bw.timeCapSeconds,
      amrapDurationSeconds: bw.amrapDurationSeconds,
      repScheme: bw.repScheme,
      requiresVest: bw.requiresVest,
      vestWeightMaleLb: bw.vestWeightMaleLb ?? null,
      vestWeightFemaleLb: bw.vestWeightFemaleLb ?? null,
      isPartner: bw.isPartner,
      partnerCount: bw.partnerCount,
      weightliftingMovementId: bw.weightliftingMovementId,
      parts: partTrees,
    });
    const fingerprint = computeWorkoutFingerprint(fingerprintInput);

    // Idempotency: a prior partial run may already have inserted this
    // benchmark template. Look it up by (scope, fingerprint, is_benchmark=true)
    // before inserting — the unique constraints on (created_by, fp, benchmark)
    // and (community_id, fp, benchmark) would otherwise throw 23505.
    const existingId = await findBenchmarkTemplate(tx, bw, fingerprint);
    if (existingId) {
      benchmarkTemplateMap.set(bw.id, existingId);
      const existingParts = await tx
        .select({
          id: crossfitWorkoutParts.id,
          orderIndex: crossfitWorkoutParts.orderIndex,
        })
        .from(crossfitWorkoutParts)
        .where(eq(crossfitWorkoutParts.crossfitWorkoutId, existingId))
        .orderBy(crossfitWorkoutParts.orderIndex);
      const byOrder = new Map<number, string>(
        existingParts.map((p: { orderIndex: number; id: string }) => [
          p.orderIndex,
          p.id,
        ])
      );
      for (let i = 0; i < partIdToOriginal.length; i++) {
        const target = byOrder.get(i);
        if (target) benchmarkPartMap.set(partIdToOriginal[i], target);
      }
      continue;
    }

    const [inserted] = await tx
      .insert(crossfitWorkouts)
      .values({
        title: bw.name,
        description: bw.description ?? null,
        category: bw.category ?? null,
        isBenchmark: true,
        isSystem: bw.isSystem,
        weightliftingMovementId: bw.weightliftingMovementId ?? null,
        createdBy: bw.isSystem ? null : bw.createdBy ?? null,
        communityId: bw.isSystem ? null : bw.communityId ?? null,
        contentFingerprint: fingerprint,
        workoutType: bw.workoutType,
        timeCapSeconds: bw.timeCapSeconds ?? null,
        amrapDurationSeconds: bw.amrapDurationSeconds ?? null,
        repScheme: bw.repScheme ?? null,
        requiresVest: bw.requiresVest,
        vestWeightMaleLb: bw.vestWeightMaleLb ?? null,
        vestWeightFemaleLb: bw.vestWeightFemaleLb ?? null,
        isPartner: bw.isPartner,
        partnerCount: bw.partnerCount ?? null,
        createdAt: bw.createdAt,
        updatedAt: bw.updatedAt,
      })
      .returning({ id: crossfitWorkouts.id });

    benchmarkTemplateMap.set(bw.id, inserted.id);

    // Insert parts + blocks + movements, recording the bw_part → cw_part map.
    const partIds = await insertPartTreeRecorded(
      tx,
      inserted.id,
      partTrees,
      partIdToOriginal
    );
    for (const [origId, newId] of partIds) {
      benchmarkPartMap.set(origId, newId);
    }
  }

  return { benchmarkTemplateMap, benchmarkPartMap };
}

async function findBenchmarkTemplate(
  tx: Tx,
  bw: { isSystem: boolean; createdBy: string | null; communityId: string | null },
  fingerprint: string
): Promise<string | null> {
  if (bw.isSystem) {
    const [row] = await tx
      .select({ id: crossfitWorkouts.id })
      .from(crossfitWorkouts)
      .where(
        and(
          eq(crossfitWorkouts.isSystem, true),
          eq(crossfitWorkouts.contentFingerprint, fingerprint),
          eq(crossfitWorkouts.isBenchmark, true)
        )
      )
      .limit(1);
    return row?.id ?? null;
  }
  if (bw.communityId) {
    const [row] = await tx
      .select({ id: crossfitWorkouts.id })
      .from(crossfitWorkouts)
      .where(
        and(
          eq(crossfitWorkouts.communityId, bw.communityId),
          eq(crossfitWorkouts.contentFingerprint, fingerprint),
          eq(crossfitWorkouts.isBenchmark, true)
        )
      )
      .limit(1);
    return row?.id ?? null;
  }
  if (bw.createdBy) {
    const [row] = await tx
      .select({ id: crossfitWorkouts.id })
      .from(crossfitWorkouts)
      .where(
        and(
          eq(crossfitWorkouts.createdBy, bw.createdBy),
          eq(crossfitWorkouts.contentFingerprint, fingerprint),
          eq(crossfitWorkouts.isBenchmark, true)
        )
      )
      .limit(1);
    return row?.id ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Step 2: workout templates (personal + gym)
// ---------------------------------------------------------------------------

type WorkoutTemplateMap = Map<string, string>; // workout_id → cw_id
type WorkoutPartMap = Map<string, string>; // workout_part_id → cw_part_id

async function backfillWorkoutTemplates(
  tx: Tx,
  ctx: {
    benchmarkTemplateMap: BenchmarkTemplateMap;
    benchmarkPartMap: BenchmarkPartMap;
  }
): Promise<{
  workoutTemplateMap: WorkoutTemplateMap;
  workoutPartMap: WorkoutPartMap;
}> {
  const workoutTemplateMap: WorkoutTemplateMap = new Map();
  const workoutPartMap: WorkoutPartMap = new Map();

  // Cache (scope, fingerprint, is_benchmark=false) → cw_id so two saves of
  // the same prescription in the same scope dedup.
  type FpKey = string;
  const fpCache = new Map<FpKey, string>();
  const fpKey = (
    scope: { userId?: string | null; communityId?: string | null },
    fp: string
  ) => `${scope.userId ?? "_"}|${scope.communityId ?? "_"}|${fp}`;

  const sections = await tx.select().from(workoutSections);
  const sectionsByWorkoutId = new Map<string, typeof sections>();
  for (const s of sections) {
    const arr = sectionsByWorkoutId.get(s.workoutId) ?? [];
    arr.push(s);
    sectionsByWorkoutId.set(s.workoutId, arr);
  }

  // Pre-load all parts for all workouts in one query for efficiency.
  const allParts = await tx
    .select()
    .from(workoutParts)
    .orderBy(workoutParts.workoutId, workoutParts.orderIndex);
  const partsByWorkoutId = new Map<string, typeof allParts>();
  for (const p of allParts) {
    const arr = partsByWorkoutId.get(p.workoutId) ?? [];
    arr.push(p);
    partsByWorkoutId.set(p.workoutId, arr);
  }

  const ws = await tx.select().from(workouts);

  for (const w of ws) {
    const wSections = sectionsByWorkoutId.get(w.id) ?? [];
    const wParts = partsByWorkoutId.get(w.id) ?? [];

    // If the workout has sections, each section's parts become its own
    // template; we don't create a workout-level template here. The session
    // backfill will handle per-section template resolution.
    if (wSections.length > 0) {
      // Nothing to record at the workout level; sections are processed in
      // step 3.
      continue;
    }

    // No sections: this workout maps 1:1 to a single template.
    if (wParts.length === 0) {
      // Empty workout (legacy raw_text only, or partial save) — no template
      // possible. We'll still create a session pointing at no template
      // later by treating it as a freeform "custom" section. Skip template
      // creation here.
      continue;
    }

    // If benchmark_workout_id is set, reuse the benchmark template.
    if (w.benchmarkWorkoutId) {
      const benchmarkId = ctx.benchmarkTemplateMap.get(w.benchmarkWorkoutId);
      if (benchmarkId) {
        workoutTemplateMap.set(w.id, benchmarkId);
        // Map the workout's parts to the benchmark's parts by orderIndex.
        // The benchmark already has a parts tree under the new ids.
        const benchmarkParts = await tx
          .select({
            id: crossfitWorkoutParts.id,
            orderIndex: crossfitWorkoutParts.orderIndex,
          })
          .from(crossfitWorkoutParts)
          .where(eq(crossfitWorkoutParts.crossfitWorkoutId, benchmarkId))
          .orderBy(crossfitWorkoutParts.orderIndex);
        const benchmarkPartByOrder = new Map<number, string>(
          benchmarkParts.map((p: { orderIndex: number; id: string }) => [
            p.orderIndex,
            p.id,
          ])
        );
        for (const wp of wParts) {
          const target = benchmarkPartByOrder.get(wp.orderIndex);
          if (target) workoutPartMap.set(wp.id, target);
        }
        continue;
      }
      // Stale FK — fall through to fingerprint dedup.
    }

    // Compute fingerprint from workout parts and dedup within scope.
    const partTrees = await buildPartTreesFromLegacyParts(tx, wParts);
    const scope: {
      userId?: string | null;
      communityId?: string | null;
    } = w.communityId
      ? { communityId: w.communityId }
      : { userId: w.createdBy };

    const fingerprintInput = buildFingerprintInput({
      title: w.title ?? "Untitled workout",
      isBenchmark: false,
      scope: w.communityId
        ? { kind: "community", communityId: w.communityId }
        : { kind: "personal", userId: w.createdBy },
      workoutType: w.workoutType as TemplatePartInput["workoutType"],
      timeCapSeconds: w.timeCapSeconds,
      amrapDurationSeconds: w.amrapDurationSeconds,
      repScheme: w.repScheme,
      rounds: w.rounds,
      requiresVest: w.requiresVest,
      vestWeightMaleLb: w.vestWeightMaleLb ?? null,
      vestWeightFemaleLb: w.vestWeightFemaleLb ?? null,
      isPartner: w.isPartner,
      partnerCount: w.partnerCount,
      parts: partTrees.partTrees,
    });
    const fingerprint = computeWorkoutFingerprint(fingerprintInput);
    const key = fpKey(scope, fingerprint);

    let templateId: string | undefined = fpCache.get(key);
    if (!templateId) {
      const existing = await findScopeTemplate(tx, scope, fingerprint, false);
      if (existing) {
        templateId = existing;
        fpCache.set(key, existing);
      }
    }
    if (templateId === undefined) {
      const [row] = await tx
        .insert(crossfitWorkouts)
        .values({
          title: w.title ?? "Untitled workout",
          description: w.description ?? null,
          isBenchmark: false,
          isSystem: false,
          createdBy: w.communityId ? null : w.createdBy,
          communityId: w.communityId ?? null,
          contentFingerprint: fingerprint,
          workoutType: w.workoutType,
          timeCapSeconds: w.timeCapSeconds ?? null,
          amrapDurationSeconds: w.amrapDurationSeconds ?? null,
          repScheme: w.repScheme ?? null,
          rounds: w.rounds ?? null,
          requiresVest: w.requiresVest,
          vestWeightMaleLb: w.vestWeightMaleLb ?? null,
          vestWeightFemaleLb: w.vestWeightFemaleLb ?? null,
          isPartner: w.isPartner,
          partnerCount: w.partnerCount ?? null,
          estimatedKcalLow: w.estimatedKcalLow ?? null,
          estimatedKcalHigh: w.estimatedKcalHigh ?? null,
          estimatedKcalMethod: w.estimatedKcalMethod ?? null,
          estimatedKcalConfidence: w.estimatedKcalConfidence ?? null,
          estimatedKcalComputedAt: w.estimatedKcalComputedAt ?? null,
          createdAt: w.createdAt,
          updatedAt: w.updatedAt,
        })
        .returning({ id: crossfitWorkouts.id });
      const newId = row.id as string;
      templateId = newId;
      fpCache.set(key, newId);

      const partIds = await insertPartTreeRecorded(
        tx,
        newId,
        partTrees.partTrees,
        partTrees.originalPartIds
      );
      for (const [origId, mappedId] of partIds) {
        workoutPartMap.set(origId, mappedId);
      }
    } else {
      // Reusing an existing template — map our parts onto its parts by orderIndex.
      const targetParts = await tx
        .select({
          id: crossfitWorkoutParts.id,
          orderIndex: crossfitWorkoutParts.orderIndex,
        })
        .from(crossfitWorkoutParts)
        .where(eq(crossfitWorkoutParts.crossfitWorkoutId, templateId))
        .orderBy(crossfitWorkoutParts.orderIndex);
      const targetByOrder = new Map<number, string>(
        targetParts.map((p: { orderIndex: number; id: string }) => [
          p.orderIndex,
          p.id,
        ])
      );
      for (const wp of wParts) {
        const target = targetByOrder.get(wp.orderIndex);
        if (target) workoutPartMap.set(wp.id, target);
      }
    }
    workoutTemplateMap.set(w.id, templateId);
  }

  return { workoutTemplateMap, workoutPartMap };
}

async function findScopeTemplate(
  tx: Tx,
  scope: { userId?: string | null; communityId?: string | null },
  fingerprint: string,
  isBenchmark: boolean
): Promise<string | null> {
  if (scope.communityId) {
    const [row] = await tx
      .select({ id: crossfitWorkouts.id })
      .from(crossfitWorkouts)
      .where(
        and(
          eq(crossfitWorkouts.communityId, scope.communityId),
          eq(crossfitWorkouts.contentFingerprint, fingerprint),
          eq(crossfitWorkouts.isBenchmark, isBenchmark)
        )
      )
      .limit(1);
    return row?.id ?? null;
  }
  if (scope.userId) {
    const [row] = await tx
      .select({ id: crossfitWorkouts.id })
      .from(crossfitWorkouts)
      .where(
        and(
          eq(crossfitWorkouts.createdBy, scope.userId),
          eq(crossfitWorkouts.contentFingerprint, fingerprint),
          eq(crossfitWorkouts.isBenchmark, isBenchmark)
        )
      )
      .limit(1);
    return row?.id ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helper: load legacy parts/blocks/movements and produce a TemplatePartInput[]
// suitable for insertPartTreeRecorded.
// ---------------------------------------------------------------------------

async function buildPartTreesFromLegacyParts(
  tx: Tx,
  parts: (typeof workoutParts.$inferSelect)[]
): Promise<{ partTrees: TemplatePartInput[]; originalPartIds: string[] }> {
  const partTrees: TemplatePartInput[] = [];
  const originalPartIds: string[] = [];

  for (const p of parts) {
    const blocks = await tx
      .select()
      .from(workoutBlocks)
      .where(eq(workoutBlocks.workoutPartId, p.id))
      .orderBy(workoutBlocks.orderIndex);
    const movements = await tx
      .select()
      .from(workoutMovements)
      .where(eq(workoutMovements.workoutPartId, p.id))
      .orderBy(workoutMovements.orderIndex);

    const tempBlockRefs = new Map<string, string>();
    blocks.forEach((b: { id: string }) =>
      tempBlockRefs.set(b.id, `wblk-${b.id}`)
    );

    partTrees.push({
      tempRef: `wpart-${p.id}`,
      label: p.label ?? undefined,
      workoutType: p.workoutType as TemplatePartInput["workoutType"],
      timeCapSeconds: p.timeCapSeconds ?? undefined,
      amrapDurationSeconds: p.amrapDurationSeconds ?? undefined,
      emomIntervalSeconds: p.emomIntervalSeconds ?? undefined,
      intervalWorkSeconds: p.intervalWorkSeconds ?? undefined,
      intervalRestSeconds: p.intervalRestSeconds ?? undefined,
      intervalRounds: Array.isArray(p.intervalRounds)
        ? (p.intervalRounds as TemplatePartInput["intervalRounds"])
        : undefined,
      sideCadenceIntervalSeconds: p.sideCadenceIntervalSeconds ?? undefined,
      sideCadenceOpenEnded: !!p.sideCadenceOpenEnded,
      repScheme: p.repScheme ?? undefined,
      rounds: p.rounds ?? undefined,
      structure: p.structure ?? undefined,
      notes: p.notes ?? undefined,
      blocks: blocks.map(
        (b: { id: string; title: string; orderIndex: number }) => ({
          tempRef: tempBlockRefs.get(b.id),
          title: b.title,
          orderIndex: b.orderIndex,
        })
      ),
      movements: movements.map(
        (m: typeof workoutMovements.$inferSelect, i: number) => ({
          movementId: m.movementId,
          orderIndex: m.orderIndex ?? i,
          prescribedReps: m.prescribedReps ?? undefined,
          prescribedWeightMale: m.prescribedWeightMale ?? undefined,
          prescribedWeightFemale: m.prescribedWeightFemale ?? undefined,
          prescribedCaloriesMale: m.prescribedCaloriesMale ?? undefined,
          prescribedCaloriesFemale: m.prescribedCaloriesFemale ?? undefined,
          prescribedDistanceMale: m.prescribedDistanceMale ?? undefined,
          prescribedDistanceFemale: m.prescribedDistanceFemale ?? undefined,
          prescribedDurationSecondsMale:
            m.prescribedDurationSecondsMale ?? undefined,
          prescribedDurationSecondsFemale:
            m.prescribedDurationSecondsFemale ?? undefined,
          prescribedHeightInches: m.prescribedHeightInches ?? undefined,
          prescribedHeightInchesMale: m.prescribedHeightInchesMale ?? undefined,
          prescribedHeightInchesFemale:
            m.prescribedHeightInchesFemale ?? undefined,
          prescribedWeightMaleBwMultiplier:
            m.prescribedWeightMaleBwMultiplier ?? undefined,
          prescribedWeightFemaleBwMultiplier:
            m.prescribedWeightFemaleBwMultiplier ?? undefined,
          prescribedWeightPct: m.prescribedWeightPct ?? undefined,
          tempo: m.tempo ?? undefined,
          isMaxReps: !!m.isMaxReps,
          isSideCadence: !!m.isSideCadence,
          equipmentCount: m.equipmentCount ?? undefined,
          rxStandard: m.rxStandard ?? undefined,
          notes: m.notes ?? undefined,
          blockTempRef: m.workoutBlockId
            ? tempBlockRefs.get(m.workoutBlockId) ?? null
            : null,
        })
      ),
    });
    originalPartIds.push(p.id);
  }

  return { partTrees, originalPartIds };
}

// Like insertTemplateParts but also records (originalPartId → newPartId).
async function insertPartTreeRecorded(
  tx: Tx,
  templateId: string,
  parts: TemplatePartInput[],
  originalPartIds: string[]
): Promise<Map<string, string>> {
  const recorded = new Map<string, string>();
  const partTempRefToId = new Map<string, string>();

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const [row] = await tx
      .insert(crossfitWorkoutParts)
      .values({
        crossfitWorkoutId: templateId,
        orderIndex: i,
        label: p.label || null,
        workoutType: p.workoutType,
        timeCapSeconds: p.timeCapSeconds ?? null,
        amrapDurationSeconds: p.amrapDurationSeconds ?? null,
        emomIntervalSeconds: p.emomIntervalSeconds ?? null,
        intervalWorkSeconds:
          typeof p.intervalWorkSeconds === "number"
            ? p.intervalWorkSeconds
            : null,
        intervalRestSeconds:
          typeof p.intervalRestSeconds === "number"
            ? p.intervalRestSeconds
            : null,
        intervalRounds: p.intervalRounds ?? null,
        sideCadenceIntervalSeconds:
          typeof p.sideCadenceIntervalSeconds === "number"
            ? p.sideCadenceIntervalSeconds
            : null,
        sideCadenceOpenEnded: !!p.sideCadenceOpenEnded,
        repScheme: p.repScheme ?? null,
        rounds: p.rounds ?? null,
        structure: p.structure ?? null,
        notes: p.notes ?? null,
      })
      .returning({ id: crossfitWorkoutParts.id });
    recorded.set(originalPartIds[i], row.id);
    if (p.tempRef) partTempRefToId.set(p.tempRef, row.id);

    const blockTempRefToId = new Map<string, string>();
    if (p.blocks && p.blocks.length > 0) {
      const blocksToInsert = p.blocks
        .map((b, k) => ({
          input: b,
          values: {
            crossfitWorkoutPartId: row.id,
            orderIndex: b.orderIndex ?? k,
            title: b.title?.trim() ?? "",
          },
        }))
        .filter((entry) => entry.values.title.length > 0);
      if (blocksToInsert.length > 0) {
        const inserted = await tx
          .insert(crossfitWorkoutBlocks)
          .values(blocksToInsert.map((entry) => entry.values))
          .returning({ id: crossfitWorkoutBlocks.id });
        for (let k = 0; k < inserted.length; k++) {
          const tempRef = blocksToInsert[k].input.tempRef;
          if (tempRef) blockTempRefToId.set(tempRef, inserted[k].id);
        }
      }
    }

    if (p.movements.length > 0) {
      await tx.insert(crossfitWorkoutMovements).values(
        p.movements.map((m, j) => ({
          crossfitWorkoutId: templateId,
          crossfitWorkoutPartId: row.id,
          crossfitWorkoutBlockId: m.blockTempRef
            ? blockTempRefToId.get(m.blockTempRef) ?? null
            : null,
          movementId: m.movementId,
          orderIndex: m.orderIndex ?? j,
          prescribedReps: m.prescribedReps || null,
          prescribedWeightMale:
            m.prescribedWeightMale != null
              ? String(m.prescribedWeightMale)
              : null,
          prescribedWeightFemale:
            m.prescribedWeightFemale != null
              ? String(m.prescribedWeightFemale)
              : null,
          prescribedCaloriesMale:
            m.prescribedCaloriesMale != null
              ? String(m.prescribedCaloriesMale)
              : null,
          prescribedCaloriesFemale:
            m.prescribedCaloriesFemale != null
              ? String(m.prescribedCaloriesFemale)
              : null,
          prescribedDistanceMale:
            m.prescribedDistanceMale != null
              ? String(m.prescribedDistanceMale)
              : null,
          prescribedDistanceFemale:
            m.prescribedDistanceFemale != null
              ? String(m.prescribedDistanceFemale)
              : null,
          prescribedDurationSecondsMale:
            typeof m.prescribedDurationSecondsMale === "number"
              ? m.prescribedDurationSecondsMale
              : null,
          prescribedDurationSecondsFemale:
            typeof m.prescribedDurationSecondsFemale === "number"
              ? m.prescribedDurationSecondsFemale
              : null,
          prescribedHeightInches:
            m.prescribedHeightInches != null
              ? String(m.prescribedHeightInches)
              : null,
          prescribedHeightInchesMale:
            m.prescribedHeightInchesMale != null
              ? String(m.prescribedHeightInchesMale)
              : null,
          prescribedHeightInchesFemale:
            m.prescribedHeightInchesFemale != null
              ? String(m.prescribedHeightInchesFemale)
              : null,
          prescribedWeightMaleBwMultiplier:
            m.prescribedWeightMaleBwMultiplier != null
              ? String(m.prescribedWeightMaleBwMultiplier)
              : null,
          prescribedWeightFemaleBwMultiplier:
            m.prescribedWeightFemaleBwMultiplier != null
              ? String(m.prescribedWeightFemaleBwMultiplier)
              : null,
          prescribedWeightPct:
            m.prescribedWeightPct != null
              ? String(m.prescribedWeightPct)
              : null,
          prescribedWeightPctSourcePartId: m.weightPctSourcePartTempRef
            ? partTempRefToId.get(m.weightPctSourcePartTempRef) ?? null
            : null,
          tempo: m.tempo ?? null,
          isMaxReps: !!m.isMaxReps,
          isSideCadence: !!m.isSideCadence,
          equipmentCount: m.equipmentCount ?? null,
          rxStandard: m.rxStandard ?? null,
          notes: m.notes ?? null,
        }))
      );
    }
  }

  return recorded;
}

// ---------------------------------------------------------------------------
// Step 3: sessions from workouts + sections
// ---------------------------------------------------------------------------

type WorkoutSessionMap = Map<string, string>; // workout_id → session_id
type SectionSessionMap = Map<string, string>; // section_id → session_id

async function backfillSessionsFromWorkouts(
  tx: Tx,
  ctx: {
    workoutTemplateMap: WorkoutTemplateMap;
    benchmarkTemplateMap: BenchmarkTemplateMap;
    workoutPartMap: WorkoutPartMap;
  }
): Promise<{
  workoutSessionMap: WorkoutSessionMap;
  sectionSessionMap: SectionSessionMap;
}> {
  const workoutSessionMap: WorkoutSessionMap = new Map();
  const sectionSessionMap: SectionSessionMap = new Map();

  const sections = await tx.select().from(workoutSections);
  const sectionsByWorkoutId = new Map<string, typeof sections>();
  for (const s of sections) {
    const arr = sectionsByWorkoutId.get(s.workoutId) ?? [];
    arr.push(s);
    sectionsByWorkoutId.set(s.workoutId, arr);
  }

  const allParts = await tx.select().from(workoutParts);
  const partsByWorkoutId = new Map<string, typeof allParts>();
  for (const p of allParts) {
    const arr = partsByWorkoutId.get(p.workoutId) ?? [];
    arr.push(p);
    partsByWorkoutId.set(p.workoutId, arr);
  }

  const ws = await tx.select().from(workouts);
  for (const w of ws) {
    const wSections = sectionsByWorkoutId.get(w.id) ?? [];
    const wParts = partsByWorkoutId.get(w.id) ?? [];

    // Scope for sessions:
    //   - personal workouts (no community_id): user_id = w.created_by
    //   - gym workouts (community_id set): user_id = null, community_id = w.community_id
    const sessionScope: { userId: string | null; communityId: string | null } =
      w.communityId
        ? { userId: null, communityId: w.communityId }
        : { userId: w.createdBy, communityId: null };

    if (wSections.length === 0) {
      // One session for the whole workout.
      let templateId = ctx.workoutTemplateMap.get(w.id) ?? null;
      let kind: schema.WorkoutSessionKind = "wod";
      let body: string | null = null;

      if (!templateId) {
        // Empty workout (no parts). Best we can do is store as a freeform
        // "custom" session with whatever description / raw_text exists.
        // Use "custom" kind (still requires non-null template by CHECK
        // constraint) — but with no parts we have no template. Use
        // "stretching" as a fallback freeform kind, populated from raw_text
        // or description.
        const fallbackBody =
          w.rawText?.trim() || w.description?.trim() || w.title?.trim() || "—";
        kind = "stretching";
        body = fallbackBody;
      }

      const [session] = await tx
        .insert(workoutSessions)
        .values({
          crossfitWorkoutId: templateId,
          userId: sessionScope.userId,
          communityId: sessionScope.communityId,
          workoutDate: w.workoutDate,
          kind,
          position: 0,
          title: w.title ?? null,
          body,
          isScored: !templateId ? false : true,
          source: mapLegacySource(w.source),
          programmingReleaseId: w.programmingReleaseId ?? null,
          published: w.published,
          reviewedAt: w.reviewedAt ?? null,
          estimatedKcalLow: w.estimatedKcalLow ?? null,
          estimatedKcalHigh: w.estimatedKcalHigh ?? null,
          estimatedKcalConfidence: w.estimatedKcalConfidence ?? null,
          createdAt: w.createdAt,
          updatedAt: w.updatedAt,
        })
        .returning({ id: workoutSessions.id });

      workoutSessionMap.set(w.id, session.id);
      continue;
    }

    // Sectioned workout: one session per section.
    for (const s of wSections) {
      const isFreeform = s.kind === "warm_up" || s.kind === "stretching";

      let templateId: string | null = null;
      if (!isFreeform) {
        // Resolve template for this section.
        if (s.benchmarkWorkoutId) {
          templateId =
            ctx.benchmarkTemplateMap.get(s.benchmarkWorkoutId) ?? null;
          if (templateId) {
            // Map this section's parts to the benchmark's parts by orderIndex.
            const benchmarkParts = await tx
              .select({
                id: crossfitWorkoutParts.id,
                orderIndex: crossfitWorkoutParts.orderIndex,
              })
              .from(crossfitWorkoutParts)
              .where(eq(crossfitWorkoutParts.crossfitWorkoutId, templateId))
              .orderBy(crossfitWorkoutParts.orderIndex);
            // Match by sorted position rather than raw orderIndex —
            // section parts may have non-zero starting orderIndex (e.g. 2, 3
            // when an earlier section had parts 0, 1) and the benchmark
            // template always starts at 0.
            const sectionParts = wParts
              .filter(
                (p: typeof workoutParts.$inferSelect) =>
                  p.workoutSectionId === s.id
              )
              .sort(
                (
                  a: typeof workoutParts.$inferSelect,
                  b: typeof workoutParts.$inferSelect
                ) => a.orderIndex - b.orderIndex
              );
            for (
              let i = 0;
              i < sectionParts.length && i < benchmarkParts.length;
              i++
            ) {
              ctx.workoutPartMap.set(sectionParts[i].id, benchmarkParts[i].id);
            }
          }
        }

        if (!templateId) {
          // No benchmark link — compute fingerprint from the section's parts.
          const sectionParts = wParts
            .filter(
              (p: typeof workoutParts.$inferSelect) =>
                p.workoutSectionId === s.id
            )
            .sort(
              (
                a: typeof workoutParts.$inferSelect,
                b: typeof workoutParts.$inferSelect
              ) => a.orderIndex - b.orderIndex
            );
          if (sectionParts.length === 0) {
            // Section with no parts and not freeform — treat as freeform
            // with a "—" body so the CHECK constraint is satisfied.
            const [session] = await tx
              .insert(workoutSessions)
              .values({
                crossfitWorkoutId: null,
                userId: sessionScope.userId,
                communityId: sessionScope.communityId,
                workoutDate: w.workoutDate,
                kind: "stretching",
                subKind: s.subKind ?? null,
                position: s.position,
                title: s.title ?? null,
                body: s.body?.trim() || s.notes?.trim() || "—",
                isScored: false,
                source: mapLegacySource(w.source),
                programmingReleaseId: w.programmingReleaseId ?? null,
                sourceTrackId: s.sourceTrackId ?? null,
                published: w.published,
                reviewedAt: s.reviewedAt ?? w.reviewedAt ?? null,
                coachNotes: s.notes ?? null,
                createdAt: s.createdAt,
                updatedAt: s.updatedAt,
              })
              .returning({ id: workoutSessions.id });
            sectionSessionMap.set(s.id, session.id);
            continue;
          }

          // Re-normalize orderIndex within the section to start at 0 so
          // fingerprints don't depend on which positions the section's
          // parts happened to land on in the parent workout.
          const renumbered = sectionParts.map(
            (
              p: typeof workoutParts.$inferSelect,
              i: number
            ): typeof workoutParts.$inferSelect => ({ ...p, orderIndex: i })
          );
          const built = await buildPartTreesFromLegacyParts(tx, renumbered);

          const scope: { userId?: string | null; communityId?: string | null } =
            w.communityId
              ? { communityId: w.communityId }
              : { userId: w.createdBy };

          const fingerprintInput = buildFingerprintInput({
            title: s.title ?? w.title ?? "Untitled section",
            isBenchmark: false,
            scope: w.communityId
              ? { kind: "community", communityId: w.communityId }
              : { kind: "personal", userId: w.createdBy },
            workoutType: built.partTrees[0]
              .workoutType as TemplatePartInput["workoutType"],
            timeCapSeconds: built.partTrees[0].timeCapSeconds,
            amrapDurationSeconds: built.partTrees[0].amrapDurationSeconds,
            repScheme: built.partTrees[0].repScheme,
            rounds: built.partTrees[0].rounds,
            requiresVest: w.requiresVest,
            vestWeightMaleLb: w.vestWeightMaleLb ?? null,
            vestWeightFemaleLb: w.vestWeightFemaleLb ?? null,
            isPartner: w.isPartner,
            partnerCount: w.partnerCount,
            parts: built.partTrees,
          });
          const fingerprint = computeWorkoutFingerprint(fingerprintInput);

          let existing = await findScopeTemplate(tx, scope, fingerprint, false);
          if (!existing) {
            const [row] = await tx
              .insert(crossfitWorkouts)
              .values({
                title: s.title ?? w.title ?? "Untitled section",
                description: w.description ?? null,
                isBenchmark: false,
                isSystem: false,
                createdBy: w.communityId ? null : w.createdBy,
                communityId: w.communityId ?? null,
                contentFingerprint: fingerprint,
                workoutType: built.partTrees[0].workoutType,
                timeCapSeconds: built.partTrees[0].timeCapSeconds ?? null,
                amrapDurationSeconds:
                  built.partTrees[0].amrapDurationSeconds ?? null,
                repScheme: built.partTrees[0].repScheme ?? null,
                rounds: built.partTrees[0].rounds ?? null,
                requiresVest: w.requiresVest,
                vestWeightMaleLb: w.vestWeightMaleLb ?? null,
                vestWeightFemaleLb: w.vestWeightFemaleLb ?? null,
                isPartner: w.isPartner,
                partnerCount: w.partnerCount ?? null,
                createdAt: s.createdAt,
                updatedAt: s.updatedAt,
              })
              .returning({ id: crossfitWorkouts.id });
            const newTemplateId = row.id as string;
            existing = newTemplateId;

            const partIds = await insertPartTreeRecorded(
              tx,
              newTemplateId,
              built.partTrees,
              built.originalPartIds
            );
            for (const [origId, mappedId] of partIds) {
              ctx.workoutPartMap.set(origId, mappedId);
            }
          } else {
            const targetParts = await tx
              .select({
                id: crossfitWorkoutParts.id,
                orderIndex: crossfitWorkoutParts.orderIndex,
              })
              .from(crossfitWorkoutParts)
              .where(eq(crossfitWorkoutParts.crossfitWorkoutId, existing))
              .orderBy(crossfitWorkoutParts.orderIndex);
            const targetByOrder = new Map<number, string>(
              targetParts.map((p: { orderIndex: number; id: string }) => [
                p.orderIndex,
                p.id,
              ])
            );
            for (let i = 0; i < built.originalPartIds.length; i++) {
              const target = targetByOrder.get(i);
              if (target)
                ctx.workoutPartMap.set(built.originalPartIds[i], target);
            }
          }
          templateId = existing;
        }
      }

      const [session] = await tx
        .insert(workoutSessions)
        .values({
          crossfitWorkoutId: templateId,
          userId: sessionScope.userId,
          communityId: sessionScope.communityId,
          workoutDate: w.workoutDate,
          kind: s.kind as schema.WorkoutSessionKind,
          subKind: s.subKind ?? null,
          position: s.position,
          title: s.title ?? null,
          body:
            isFreeform
              ? s.body?.trim() || s.notes?.trim() || "—"
              : null,
          isScored: s.isScored,
          scoreType:
            (s.scoreType as schema.WorkoutSessionScoreType | null) ?? null,
          coachNotes: s.notes ?? null,
          source: mapLegacySource(w.source),
          programmingReleaseId: w.programmingReleaseId ?? null,
          sourceTrackId: s.sourceTrackId ?? null,
          published: w.published,
          reviewedAt: s.reviewedAt ?? w.reviewedAt ?? null,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })
        .returning({ id: workoutSessions.id });

      sectionSessionMap.set(s.id, session.id);
    }

    // Orphan parts: this workout has sections, but at least one of its
    // parts has workout_section_id = null. Create a fallback "custom"
    // session backed by its own template so any scores against those
    // parts still re-FK cleanly. Without this, the verify assertion fails.
    const orphanParts = wParts
      .filter(
        (p: typeof workoutParts.$inferSelect) => p.workoutSectionId == null
      )
      .sort(
        (
          a: typeof workoutParts.$inferSelect,
          b: typeof workoutParts.$inferSelect
        ) => a.orderIndex - b.orderIndex
      );
    if (orphanParts.length > 0) {
      const orphanPosition =
        Math.max(0, ...wSections.map((s: { position: number }) => s.position)) +
        1;

      const renumbered = orphanParts.map(
        (
          p: typeof workoutParts.$inferSelect,
          i: number
        ): typeof workoutParts.$inferSelect => ({ ...p, orderIndex: i })
      );
      const built = await buildPartTreesFromLegacyParts(tx, renumbered);

      const scope: { userId?: string | null; communityId?: string | null } =
        w.communityId
          ? { communityId: w.communityId }
          : { userId: w.createdBy };

      const fingerprintInput = buildFingerprintInput({
        title: w.title ?? "Untitled",
        isBenchmark: false,
        scope: w.communityId
          ? { kind: "community", communityId: w.communityId }
          : { kind: "personal", userId: w.createdBy },
        workoutType: built.partTrees[0]
          .workoutType as TemplatePartInput["workoutType"],
        timeCapSeconds: built.partTrees[0].timeCapSeconds,
        amrapDurationSeconds: built.partTrees[0].amrapDurationSeconds,
        repScheme: built.partTrees[0].repScheme,
        rounds: built.partTrees[0].rounds,
        requiresVest: w.requiresVest,
        vestWeightMaleLb: w.vestWeightMaleLb ?? null,
        vestWeightFemaleLb: w.vestWeightFemaleLb ?? null,
        isPartner: w.isPartner,
        partnerCount: w.partnerCount,
        parts: built.partTrees,
      });
      const fingerprint = computeWorkoutFingerprint(fingerprintInput);

      let templateId: string | null = await findScopeTemplate(
        tx,
        scope,
        fingerprint,
        false
      );
      if (!templateId) {
        const [row] = await tx
          .insert(crossfitWorkouts)
          .values({
            title: w.title ?? "Untitled",
            description: w.description ?? null,
            isBenchmark: false,
            isSystem: false,
            createdBy: w.communityId ? null : w.createdBy,
            communityId: w.communityId ?? null,
            contentFingerprint: fingerprint,
            workoutType: built.partTrees[0].workoutType,
            timeCapSeconds: built.partTrees[0].timeCapSeconds ?? null,
            amrapDurationSeconds:
              built.partTrees[0].amrapDurationSeconds ?? null,
            repScheme: built.partTrees[0].repScheme ?? null,
            rounds: built.partTrees[0].rounds ?? null,
            requiresVest: w.requiresVest,
            vestWeightMaleLb: w.vestWeightMaleLb ?? null,
            vestWeightFemaleLb: w.vestWeightFemaleLb ?? null,
            isPartner: w.isPartner,
            partnerCount: w.partnerCount ?? null,
            createdAt: w.createdAt,
            updatedAt: w.updatedAt,
          })
          .returning({ id: crossfitWorkouts.id });
        templateId = row.id as string;
        const partIds = await insertPartTreeRecorded(
          tx,
          templateId,
          built.partTrees,
          built.originalPartIds
        );
        for (const [origId, mappedId] of partIds) {
          ctx.workoutPartMap.set(origId, mappedId);
        }
      } else {
        const targetParts = await tx
          .select({
            id: crossfitWorkoutParts.id,
            orderIndex: crossfitWorkoutParts.orderIndex,
          })
          .from(crossfitWorkoutParts)
          .where(eq(crossfitWorkoutParts.crossfitWorkoutId, templateId))
          .orderBy(crossfitWorkoutParts.orderIndex);
        const targetByOrder = new Map<number, string>(
          targetParts.map((p: { orderIndex: number; id: string }) => [
            p.orderIndex,
            p.id,
          ])
        );
        for (let i = 0; i < built.originalPartIds.length; i++) {
          const target = targetByOrder.get(i);
          if (target) ctx.workoutPartMap.set(built.originalPartIds[i], target);
        }
      }

      const [orphanSession] = await tx
        .insert(workoutSessions)
        .values({
          crossfitWorkoutId: templateId,
          userId: sessionScope.userId,
          communityId: sessionScope.communityId,
          workoutDate: w.workoutDate,
          kind: "custom",
          position: orphanPosition,
          title: w.title ?? null,
          isScored: true,
          source: mapLegacySource(w.source),
          programmingReleaseId: w.programmingReleaseId ?? null,
          published: w.published,
          reviewedAt: w.reviewedAt ?? null,
          createdAt: w.createdAt,
          updatedAt: w.updatedAt,
        })
        .returning({ id: workoutSessions.id });

      // Record under the workout id so reFKScores falls back here when an
      // orphan part's section couldn't be resolved.
      workoutSessionMap.set(w.id, orphanSession.id as string);
    }
  }

  return { workoutSessionMap, sectionSessionMap };
}

function mapLegacySource(legacy: string): string {
  // Pass-through; the new schema accepts the same values plus 'programming'
  // (which we don't synthesize during backfill — left to new writes).
  return legacy ?? "manual";
}

// ---------------------------------------------------------------------------
// Step 4: re-FK scores
// ---------------------------------------------------------------------------

async function reFKScores(
  tx: Tx,
  ctx: {
    workoutSessionMap: WorkoutSessionMap;
    sectionSessionMap: SectionSessionMap;
    workoutPartMap: WorkoutPartMap;
  }
): Promise<void> {
  // Load every part with its section assignment so we can resolve which
  // session a score belongs to.
  const parts = await tx
    .select({
      id: workoutParts.id,
      workoutId: workoutParts.workoutId,
      workoutSectionId: workoutParts.workoutSectionId,
    })
    .from(workoutParts);
  const partSectionMap = new Map<
    string,
    { workoutId: string; sectionId: string | null }
  >();
  for (const p of parts) {
    partSectionMap.set(p.id, {
      workoutId: p.workoutId,
      sectionId: p.workoutSectionId ?? null,
    });
  }

  // Only scores still needing migration. New unified-schema writes leave
  // the legacy workout_id/workout_part_id columns null and populate
  // workout_session_id directly — iterating those would throw on the
  // unresolved-session check below.
  const allScores = await tx
    .select({
      id: scores.id,
      workoutId: scores.workoutId,
      workoutPartId: scores.workoutPartId,
    })
    .from(scores)
    .where(sql`workout_session_id is null`);

  for (const s of allScores) {
    let sessionId: string | null = null;
    let partId: string | null = null;

    if (s.workoutPartId) {
      const partInfo = partSectionMap.get(s.workoutPartId);
      if (partInfo?.sectionId) {
        sessionId = ctx.sectionSessionMap.get(partInfo.sectionId) ?? null;
      }
      partId = ctx.workoutPartMap.get(s.workoutPartId) ?? null;
    }

    if (!sessionId) {
      sessionId = ctx.workoutSessionMap.get(s.workoutId) ?? null;
    }

    if (!sessionId) {
      throw new Error(
        `reFKScores: could not resolve workout_session for score ${s.id} (workoutId=${s.workoutId}, partId=${s.workoutPartId})`
      );
    }

    await tx
      .update(scores)
      .set({
        workoutSessionId: sessionId,
        crossfitWorkoutPartId: partId,
      })
      .where(eq(scores.id, s.id));
  }
}

// ---------------------------------------------------------------------------
// Step 4b: re-FK score_movement_details
// ---------------------------------------------------------------------------
//
// Insights queries inner-join on score_movement_details.crossfit_workout_movement_id,
// so any SMD row left with only the legacy workout_movement_id populated is
// silently invisible to Trends, RX-Gap, Domain Profile, 1RM Predictions, and
// Notes Insights. This step resolves the unified FK from data already on the
// row: the score has been re-FK'd to a crossfit_workout_part_id by
// reFKScores, the legacy workout_movements row carries (movement_id,
// order_index), and the backfill copied the legacy movement set into
// crossfit_workout_movements verbatim. So:
//
//   score.crossfit_workout_part_id × workout_movements.(movement_id, order_index)
//     → crossfit_workout_movements.id
//
// is a 1:1 lookup. SMD rows whose score lost its part FK (freeform section)
// can't be resolved and are skipped — the verify assertion exempts them with
// the same rule as scores.orphanedPartFK.
//
// Standalone: this step does not depend on the in-memory maps produced by
// the workout backfill, so it self-heals on re-runs even after the workout
// backfill has already completed.
async function reFKScoreMovementDetails(tx: Tx): Promise<void> {
  const result = await tx.execute(sql`
    select
      smd.id as smd_id,
      smd.workout_movement_id,
      wm.workout_part_id,
      wm.movement_id,
      wm.order_index,
      s.crossfit_workout_part_id
    from score_movement_details smd
    join workout_movements wm on wm.id = smd.workout_movement_id
    join scores s on s.id = smd.score_id
    where smd.crossfit_workout_movement_id is null
      and smd.workout_movement_id is not null
  `);
  const rows = (result?.rows ?? result ?? []) as Array<{
    smd_id: string;
    workout_movement_id: string;
    workout_part_id: string | null;
    movement_id: string;
    order_index: number;
    crossfit_workout_part_id: string | null;
  }>;
  if (rows.length === 0) return;

  // Bulk-fetch crossfit_workout_movements only for the parts we need. Build
  // two indexes:
  //   1. (cwPart, movement, orderIndex) → cwm.id — fast path when the legacy
  //      workout_movement.order_index happens to match the new
  //      crossfit_workout_movement.order_index. True when the cwPart was
  //      built from the score's own legacy part.
  //   2. (cwPart, movement) → cwm.id[] sorted by orderIndex — fallback when
  //      the cwPart was sourced from somewhere else (benchmark template,
  //      fingerprint-deduped existing template). The benchmark's raw
  //      order_index values aren't required to match the legacy workout's,
  //      so the strict lookup misses even though the right cwm exists in
  //      the part at a different position.
  const cwPartIds = new Set<string>();
  const legacyPartIds = new Set<string>();
  for (const r of rows) {
    if (r.crossfit_workout_part_id) cwPartIds.add(r.crossfit_workout_part_id);
    if (r.workout_part_id) legacyPartIds.add(r.workout_part_id);
  }
  const cwByKey = new Map<string, string>();
  const cwByPosition = new Map<string, string[]>();
  if (cwPartIds.size > 0) {
    const cwm = await tx
      .select({
        id: crossfitWorkoutMovements.id,
        crossfitWorkoutPartId: crossfitWorkoutMovements.crossfitWorkoutPartId,
        movementId: crossfitWorkoutMovements.movementId,
        orderIndex: crossfitWorkoutMovements.orderIndex,
      })
      .from(crossfitWorkoutMovements)
      .where(
        inArray(
          crossfitWorkoutMovements.crossfitWorkoutPartId,
          Array.from(cwPartIds)
        )
      );
    // Sort so the position arrays are stable: by (part, movement, orderIndex).
    cwm.sort(
      (
        a: { crossfitWorkoutPartId: string; movementId: string; orderIndex: number },
        b: { crossfitWorkoutPartId: string; movementId: string; orderIndex: number }
      ) => {
        if (a.crossfitWorkoutPartId !== b.crossfitWorkoutPartId)
          return a.crossfitWorkoutPartId.localeCompare(b.crossfitWorkoutPartId);
        if (a.movementId !== b.movementId)
          return a.movementId.localeCompare(b.movementId);
        return a.orderIndex - b.orderIndex;
      }
    );
    for (const c of cwm) {
      cwByKey.set(
        `${c.crossfitWorkoutPartId}::${c.movementId}::${c.orderIndex}`,
        c.id
      );
      const posKey = `${c.crossfitWorkoutPartId}::${c.movementId}`;
      const arr = cwByPosition.get(posKey) ?? [];
      arr.push(c.id);
      cwByPosition.set(posKey, arr);
    }
  }

  // Legacy (workout_part, movement) → wm.id[] sorted by order_index. Used to
  // compute the rank of a failing wm within its part among same-movement
  // siblings, so we can pick the cwm at the same rank.
  const legacyByPosition = new Map<string, string[]>();
  if (legacyPartIds.size > 0) {
    const wm = await tx
      .select({
        id: workoutMovements.id,
        workoutPartId: workoutMovements.workoutPartId,
        movementId: workoutMovements.movementId,
        orderIndex: workoutMovements.orderIndex,
      })
      .from(workoutMovements)
      .where(
        inArray(workoutMovements.workoutPartId, Array.from(legacyPartIds))
      );
    wm.sort(
      (
        a: { workoutPartId: string | null; movementId: string; orderIndex: number },
        b: { workoutPartId: string | null; movementId: string; orderIndex: number }
      ) => {
        const aPart = a.workoutPartId ?? "";
        const bPart = b.workoutPartId ?? "";
        if (aPart !== bPart) return aPart.localeCompare(bPart);
        if (a.movementId !== b.movementId)
          return a.movementId.localeCompare(b.movementId);
        return a.orderIndex - b.orderIndex;
      }
    );
    for (const m of wm) {
      if (!m.workoutPartId) continue;
      const key = `${m.workoutPartId}::${m.movementId}`;
      const arr = legacyByPosition.get(key) ?? [];
      arr.push(m.id);
      legacyByPosition.set(key, arr);
    }
  }

  let resolved = 0;
  let resolvedByPosition = 0;
  let skippedFreeform = 0;
  let skippedDivergent = 0;
  for (const r of rows) {
    if (!r.crossfit_workout_part_id) {
      // Score's part wasn't migrated (freeform section). Per the
      // orphanedPartFK verify exemption, these SMD rows can legitimately
      // stay unmapped.
      skippedFreeform += 1;
      continue;
    }
    let cwMovementId = cwByKey.get(
      `${r.crossfit_workout_part_id}::${r.movement_id}::${r.order_index}`
    );

    // Position-based fallback (see index-construction comment above).
    if (!cwMovementId && r.workout_part_id) {
      const legacyList =
        legacyByPosition.get(`${r.workout_part_id}::${r.movement_id}`) ?? [];
      const posInLegacy = legacyList.indexOf(r.workout_movement_id);
      if (posInLegacy >= 0) {
        const cwList =
          cwByPosition.get(
            `${r.crossfit_workout_part_id}::${r.movement_id}`
          ) ?? [];
        if (posInLegacy < cwList.length) {
          cwMovementId = cwList[posInLegacy];
          resolvedByPosition += 1;
        }
      }
    }

    if (!cwMovementId) {
      // Unresolvable. Most common cause: the legacy workout was tagged to a
      // benchmark (or fingerprint-deduped to an existing template) but its
      // movements diverged from that template's movements — so the cwPart
      // either has no cwm for this movement_id at all, or has fewer copies
      // of it than the legacy part did. Log and skip; the verify check
      // below exempts orphans that match this exact rule (cwPart's cwm
      // count for the movement < legacy part's wm count), so genuine bugs
      // still trip the assertion.
      const cwListForDiagnostics =
        cwByPosition.get(
          `${r.crossfit_workout_part_id}::${r.movement_id}`
        ) ?? [];
      console.warn(
        `  ⚠ reFKScoreMovementDetails: SMD ${r.smd_id} unresolved — cwPart ${r.crossfit_workout_part_id} has ${cwListForDiagnostics.length} cwm for movement ${r.movement_id} (legacy wm=${r.workout_movement_id}, legacy part=${r.workout_part_id ?? "null"}, orderIndex=${r.order_index})`
      );
      skippedDivergent += 1;
      continue;
    }
    await tx
      .update(scoreMovementDetails)
      .set({ crossfitWorkoutMovementId: cwMovementId })
      .where(eq(scoreMovementDetails.id, r.smd_id));
    resolved += 1;
  }

  console.log(
    `  → reFKScoreMovementDetails: ${resolved} resolved (${resolvedByPosition} via position fallback), ${skippedFreeform} skipped (freeform-section parts), ${skippedDivergent} skipped (divergent — cwPart lacks the movement)`
  );
}

// ---------------------------------------------------------------------------
// Step 5: re-FK cross-domain references
// ---------------------------------------------------------------------------

async function reFKCrossDomain(
  tx: Tx,
  ctx: { workoutSessionMap: WorkoutSessionMap }
): Promise<void> {
  // notifications.workout_id → workout_session_id
  await tx.execute(sql`
    update notifications n
    set workout_session_id = ws.id
    from workout_sessions ws, workouts w
    where n.workout_id = w.id
      and ((ws.user_id = w.created_by and w.community_id is null)
        or (ws.community_id = w.community_id and w.community_id is not null))
      and ws.workout_date = w.workout_date
      and ws.position = 0
      and n.workout_session_id is null
  `);

  // notifications.workout_part_id → crossfit_workout_part_id (best-effort
  // via orderIndex on the resolved template).
  // We populate this only when a workoutPartId was set and a mapping exists.
  // The cleanest way is to look up each row, but bulk SQL via the part map
  // table isn't easy without a temp table. For a single-month dataset this
  // is small; do a per-row update.
  const rows = await tx
    .select({ id: notifications.id, workoutPartId: notifications.workoutPartId })
    .from(notifications)
    .where(isNotNull(notifications.workoutPartId));
  for (const r of rows) {
    if (!r.workoutPartId) continue;
    const [parts] = await tx
      .select({
        order: workoutParts.orderIndex,
        workoutId: workoutParts.workoutId,
      })
      .from(workoutParts)
      .where(eq(workoutParts.id, r.workoutPartId))
      .limit(1);
    if (!parts) continue;
    const sessionId = ctx.workoutSessionMap.get(parts.workoutId);
    if (!sessionId) continue;
    const [session] = await tx
      .select({ id: workoutSessions.id, templateId: workoutSessions.crossfitWorkoutId })
      .from(workoutSessions)
      .where(eq(workoutSessions.id, sessionId))
      .limit(1);
    if (!session?.templateId) continue;
    const [newPart] = await tx
      .select({ id: crossfitWorkoutParts.id })
      .from(crossfitWorkoutParts)
      .where(
        and(
          eq(crossfitWorkoutParts.crossfitWorkoutId, session.templateId),
          eq(crossfitWorkoutParts.orderIndex, parts.order)
        )
      )
      .limit(1);
    if (!newPart) continue;
    await tx
      .update(notifications)
      .set({ crossfitWorkoutPartId: newPart.id })
      .where(eq(notifications.id, r.id));
  }

  // programming_track_days.workout_id → workout_session_id
  await tx.execute(sql`
    update programming_track_days td
    set workout_session_id = ws.id
    from workout_sessions ws, workouts w
    where td.workout_id = w.id
      and ((ws.user_id = w.created_by and w.community_id is null)
        or (ws.community_id = w.community_id and w.community_id is not null))
      and ws.workout_date = w.workout_date
      and ws.position = 0
      and td.workout_session_id is null
  `);

  // class_instances.workout_id → workout_session_id
  await tx.execute(sql`
    update class_instances ci
    set workout_session_id = ws.id
    from workout_sessions ws, workouts w
    where ci.workout_id = w.id
      and ((ws.user_id = w.created_by and w.community_id is null)
        or (ws.community_id = w.community_id and w.community_id is not null))
      and ws.workout_date = w.workout_date
      and ws.position = 0
      and ci.workout_session_id is null
  `);

  // gym_posts.workout_id → workout_session_id
  await tx.execute(sql`
    update gym_posts gp
    set workout_session_id = ws.id
    from workout_sessions ws, workouts w
    where gp.workout_id = w.id
      and ((ws.user_id = w.created_by and w.community_id is null)
        or (ws.community_id = w.community_id and w.community_id is not null))
      and ws.workout_date = w.workout_date
      and ws.position = 0
      and gp.workout_session_id is null
  `);
}

// ---------------------------------------------------------------------------
// Step 6: verify assertions (run inside the migration tx — any throw rolls
// back the entire backfill).
// ---------------------------------------------------------------------------

async function runVerifyAssertions(
  tx: Tx,
  ctx: { preScoreCount: number }
): Promise<void> {
  // Score count unchanged.
  const [postScores] = await tx
    .select({ c: sql<number>`count(*)::int` })
    .from(scores);
  if (Number(postScores.c) !== ctx.preScoreCount) {
    throw new Error(
      `verify: score count drift ${ctx.preScoreCount} → ${postScores.c}`
    );
  }

  // Every score has a non-null session FK.
  const [scoresWithoutSession] = await tx
    .select({ c: sql<number>`count(*)::int` })
    .from(scores)
    .where(sql`workout_session_id is null`);
  if (Number(scoresWithoutSession.c) > 0) {
    throw new Error(
      `verify: ${scoresWithoutSession.c} scores have a null workout_session_id`
    );
  }

  // Every score with a pre-migration part FK that mapped to a template
  // part has a new part FK. Parts that belonged to freeform-kind sections
  // (warm_up / stretching) legitimately have no template-side counterpart;
  // we accept the dropped part FK in that narrow case since the session FK
  // is sufficient to reconstruct the score's context.
  const [orphanedPartFK] = await tx
    .select({ c: sql<number>`count(*)::int` })
    .from(scores)
    .where(
      sql`
        workout_part_id is not null
        and crossfit_workout_part_id is null
        and not exists (
          select 1
          from workout_parts wp
          join workout_sections ws on ws.id = wp.workout_section_id
          where wp.id = scores.workout_part_id
            and ws.kind in ('warm_up', 'stretching')
        )
      `
    );
  if (Number(orphanedPartFK.c) > 0) {
    throw new Error(
      `verify: ${orphanedPartFK.c} scores lost their crossfit_workout_part_id mapping`
    );
  }

  // Every SMD whose score has a non-null crossfit_workout_part_id and a
  // legacy workout_movement_id has a non-null crossfit_workout_movement_id.
  // Two exemptions:
  //   (a) SMDs on freeform-section parts (same reason as the score-level
  //       orphanedPartFK check above).
  //   (b) SMDs whose legacy workout diverged from the cwPart's template —
  //       the legacy part had more wm rows for this movement_id than the
  //       cwPart has cwm rows, so reFKScoreMovementDetails couldn't pick a
  //       target. This narrowly captures the divergent-workout case
  //       without papering over genuine resolution bugs.
  const [orphanedSmd] = await tx
    .select({ c: sql<number>`count(*)::int` })
    .from(scoreMovementDetails)
    .where(
      sql`
        crossfit_workout_movement_id is null
        and workout_movement_id is not null
        and exists (
          select 1 from scores s
          where s.id = score_movement_details.score_id
            and s.crossfit_workout_part_id is not null
        )
        and not exists (
          -- Exempt either:
          --   (i)  legacy wm has no workout_part_id, so we can't compute a
          --        position-within-part rank to map it onto a cwm; or
          --   (ii) cwPart has fewer cwm of this movement_id than the
          --        legacy part has wm of it (divergent template / count
          --        mismatch — workout was tagged to a benchmark whose
          --        movements diverged from the legacy workout's).
          -- Anything else (cwm_count >= wm_count AND workout_part_id set)
          -- should have resolved via the position fallback in
          -- reFKScoreMovementDetails — failure there is a real bug.
          select 1
          from scores s
          join workout_movements wm
            on wm.id = score_movement_details.workout_movement_id
          where s.id = score_movement_details.score_id
            and s.crossfit_workout_part_id is not null
            and (
              wm.workout_part_id is null
              or (
                select count(*)
                from crossfit_workout_movements cwm
                where cwm.crossfit_workout_part_id = s.crossfit_workout_part_id
                  and cwm.movement_id = wm.movement_id
              ) < (
                select count(*)
                from workout_movements wm2
                where wm2.workout_part_id = wm.workout_part_id
                  and wm2.movement_id = wm.movement_id
              )
            )
        )
      `
    );
  if (Number(orphanedSmd.c) > 0) {
    throw new Error(
      `verify: ${orphanedSmd.c} score_movement_details lost their crossfit_workout_movement_id mapping`
    );
  }

  // Every non-freeform session has a non-null template.
  const [orphanSessions] = await tx
    .select({ c: sql<number>`count(*)::int` })
    .from(workoutSessions)
    .where(
      sql`kind not in ('warm_up', 'stretching') and crossfit_workout_id is null`
    );
  if (Number(orphanSessions.c) > 0) {
    throw new Error(
      `verify: ${orphanSessions.c} non-freeform sessions lack a template`
    );
  }

  // Every freeform session has a non-null body.
  const [emptyFreeform] = await tx
    .select({ c: sql<number>`count(*)::int` })
    .from(workoutSessions)
    .where(sql`kind in ('warm_up', 'stretching') and body is null`);
  if (Number(emptyFreeform.c) > 0) {
    throw new Error(
      `verify: ${emptyFreeform.c} freeform sessions have a null body`
    );
  }

  // Exactly one of (user_id, community_id) on every session.
  const [scopeDrift] = await tx
    .select({ c: sql<number>`count(*)::int` })
    .from(workoutSessions)
    .where(
      sql`(user_id is null and community_id is null) or (user_id is not null and community_id is not null)`
    );
  if (Number(scopeDrift.c) > 0) {
    throw new Error(
      `verify: ${scopeDrift.c} sessions violate scope sanity`
    );
  }

  // Exactly one of (created_by, community_id) on every non-system template.
  const [tplScopeDrift] = await tx
    .select({ c: sql<number>`count(*)::int` })
    .from(crossfitWorkouts)
    .where(
      sql`is_system = false and (
        (created_by is null and community_id is null)
        or (created_by is not null and community_id is not null)
      )`
    );
  if (Number(tplScopeDrift.c) > 0) {
    throw new Error(
      `verify: ${tplScopeDrift.c} non-system templates violate scope sanity`
    );
  }
}

// ---------------------------------------------------------------------------
// CLI entry point — direct `npx tsx` invocation.
// ---------------------------------------------------------------------------

if (
  typeof import.meta.url === "string" &&
  process.argv[1] === fileURLToPath(import.meta.url)
) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
