import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  crossfitWorkoutMovements,
  crossfitWorkoutParts,
  crossfitWorkouts,
  movements,
} from "@/db/schema";
import { and, asc, eq, ilike, inArray } from "drizzle-orm";
import { getAdminAccess } from "@/lib/admin/access";
import { type BenchmarkPartInput } from "@/lib/crossfit/benchmark-parts";
import {
  upsertTemplate,
  type TemplatePartInput,
} from "@/lib/crossfit/upsert-template";
import type { VestRequirement } from "@/types/crossfit";

// GET /api/admin/benchmarks — list every benchmark template (includes
// system). Open to super admins + gym coaches/admins for curation.
export async function GET(_req: NextRequest) {
  const access = await getAdminAccess();
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select()
    .from(crossfitWorkouts)
    .where(eq(crossfitWorkouts.isBenchmark, true))
    .orderBy(asc(crossfitWorkouts.title));

  const benchmarkIds = rows.map((r) => r.id);
  const partRows = benchmarkIds.length
    ? await db
        .select()
        .from(crossfitWorkoutParts)
        .where(inArray(crossfitWorkoutParts.crossfitWorkoutId, benchmarkIds))
        .orderBy(crossfitWorkoutParts.orderIndex)
    : [];
  const movementRows = benchmarkIds.length
    ? await db
        .select({
          id: crossfitWorkoutMovements.id,
          crossfitWorkoutId: crossfitWorkoutMovements.crossfitWorkoutId,
          crossfitWorkoutPartId: crossfitWorkoutMovements.crossfitWorkoutPartId,
          movementId: crossfitWorkoutMovements.movementId,
          orderIndex: crossfitWorkoutMovements.orderIndex,
          prescribedReps: crossfitWorkoutMovements.prescribedReps,
          prescribedWeightMale: crossfitWorkoutMovements.prescribedWeightMale,
          prescribedWeightFemale: crossfitWorkoutMovements.prescribedWeightFemale,
          movementName: movements.canonicalName,
        })
        .from(crossfitWorkoutMovements)
        .innerJoin(movements, eq(movements.id, crossfitWorkoutMovements.movementId))
        .where(inArray(crossfitWorkoutMovements.crossfitWorkoutId, benchmarkIds))
        .orderBy(crossfitWorkoutMovements.orderIndex)
    : [];

  const partsByBenchmark = new Map<string, typeof partRows>();
  for (const p of partRows) {
    const list = partsByBenchmark.get(p.crossfitWorkoutId) ?? [];
    list.push(p);
    partsByBenchmark.set(p.crossfitWorkoutId, list);
  }
  const movementsByPart = new Map<string, typeof movementRows>();
  for (const m of movementRows) {
    const list = movementsByPart.get(m.crossfitWorkoutPartId) ?? [];
    list.push(m);
    movementsByPart.set(m.crossfitWorkoutPartId, list);
  }

  const movementsByBenchmark = new Map<string, typeof movementRows>();
  for (const m of movementRows) {
    const list = movementsByBenchmark.get(m.crossfitWorkoutId) ?? [];
    list.push(m);
    movementsByBenchmark.set(m.crossfitWorkoutId, list);
  }

  const result = rows.map((bw) => {
    const parts = (partsByBenchmark.get(bw.id) ?? []).map((p) => ({
      id: p.id,
      orderIndex: p.orderIndex,
      label: p.label,
      workoutType: p.workoutType,
      timeCapSeconds: p.timeCapSeconds,
      amrapDurationSeconds: p.amrapDurationSeconds,
      emomIntervalSeconds: p.emomIntervalSeconds,
      repScheme: p.repScheme,
      rounds: p.rounds,
      structure: p.structure,
      notes: p.notes,
      movements: (movementsByPart.get(p.id) ?? []).map((m) => ({
        id: m.id,
        movementId: m.movementId,
        movementName: m.movementName,
        orderIndex: m.orderIndex,
        prescribedReps: m.prescribedReps,
        prescribedWeightMale:
          m.prescribedWeightMale != null
            ? Number(m.prescribedWeightMale)
            : null,
        prescribedWeightFemale:
          m.prescribedWeightFemale != null
            ? Number(m.prescribedWeightFemale)
            : null,
      })),
      blocks: [],
    }));
    return {
      id: bw.id,
      name: bw.title,
      description: bw.description,
      workoutType: bw.workoutType,
      category: bw.category,
      timeCapSeconds: bw.timeCapSeconds,
      amrapDurationSeconds: bw.amrapDurationSeconds,
      repScheme: bw.repScheme,
      isSystem: bw.isSystem,
      createdBy: bw.createdBy,
      communityId: bw.communityId,
      vestRequirement: bw.vestRequirement as VestRequirement,
      vestWeightMaleLb:
        bw.vestWeightMaleLb != null ? Number(bw.vestWeightMaleLb) : null,
      vestWeightFemaleLb:
        bw.vestWeightFemaleLb != null ? Number(bw.vestWeightFemaleLb) : null,
      isPartner: bw.isPartner,
      partnerCount: bw.partnerCount,
      weightliftingMovementId: bw.weightliftingMovementId,
      movements: (movementsByBenchmark.get(bw.id) ?? []).map((m) => ({
        id: m.id,
        movementId: m.movementId,
        movementName: m.movementName,
        orderIndex: m.orderIndex,
        prescribedReps: m.prescribedReps,
        prescribedWeightMale:
          m.prescribedWeightMale != null ? Number(m.prescribedWeightMale) : null,
        prescribedWeightFemale:
          m.prescribedWeightFemale != null
            ? Number(m.prescribedWeightFemale)
            : null,
      })),
      parts,
    };
  });

  return NextResponse.json(result);
}

// POST /api/admin/benchmarks — create a benchmark (system or otherwise).
// Open to super admins and to gym coaches/admins. There is no review
// queue today; new rows are visible globally on save.
//
// Multi-part shape: `parts: [...]` (same schema as the user-facing
// benchmark POST). The first part's structural fields are mirrored onto
// the legacy top-level columns on benchmark_workouts for read-fallback.
export async function POST(req: NextRequest) {
  const access = await getAdminAccess();
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const {
    name,
    description,
    category,
    isSystem,
    vestRequirement,
    vestWeightMaleLb,
    vestWeightFemaleLb,
    isPartner,
    partnerCount,
    parts,
  } = body as {
    name?: string;
    description?: string;
    category?: string | null;
    isSystem?: boolean;
    vestRequirement?: VestRequirement;
    vestWeightMaleLb?: number | string | null;
    vestWeightFemaleLb?: number | string | null;
    isPartner?: boolean;
    partnerCount?: number | string | null;
    parts?: BenchmarkPartInput[];
  };

  const trimmedName = name?.trim();
  if (!trimmedName) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  if (!Array.isArray(parts) || parts.length === 0) {
    return NextResponse.json(
      { error: "At least one part is required" },
      { status: 400 }
    );
  }

  for (const p of parts) {
    if (!p.workoutType) {
      return NextResponse.json(
        { error: "Each part must have a workoutType" },
        { status: 400 }
      );
    }
  }

  const VALID_CATEGORIES = new Set([
    "girls",
    "heroes",
    "open",
    "weightlifting",
    "gym_benchmark",
  ]);
  if (category != null && category !== "" && !VALID_CATEGORIES.has(category)) {
    return NextResponse.json(
      { error: "Invalid benchmark category" },
      { status: 400 }
    );
  }

  const firstPart = parts[0];

  // Reject duplicates on Name + Type within the same scope. A benchmark is
  // identified by its name and workout type (e.g. "JT" / for_time), so the
  // same pairing can't be created twice — system benchmarks are deduped
  // globally, personal ones per-creator.
  const dupConditions = [
    eq(crossfitWorkouts.isBenchmark, true),
    ilike(crossfitWorkouts.title, trimmedName),
    eq(crossfitWorkouts.workoutType, firstPart.workoutType),
  ];
  if (isSystem) {
    dupConditions.push(eq(crossfitWorkouts.isSystem, true));
  } else {
    dupConditions.push(eq(crossfitWorkouts.isSystem, false));
    dupConditions.push(eq(crossfitWorkouts.createdBy, access.user.id));
  }
  const existingDup = await db
    .select({ id: crossfitWorkouts.id })
    .from(crossfitWorkouts)
    .where(and(...dupConditions))
    .limit(1);
  if (existingDup.length > 0) {
    return NextResponse.json(
      {
        error: `A ${isSystem ? "system " : ""}benchmark named "${trimmedName}" (${firstPart.workoutType}) already exists.`,
      },
      { status: 409 }
    );
  }

  const scope = isSystem
    ? ({ kind: "system" } as const)
    : ({ kind: "personal" as const, userId: access.user.id });

  const result = await db.transaction(async (tx) => {
    return upsertTemplate(tx, {
      title: trimmedName,
      description: description?.trim() || null,
      category: category || null,
      isBenchmark: true,
      isSystem: !!isSystem,
      scope,
      workoutType: firstPart.workoutType,
      timeCapSeconds: firstPart.timeCapSeconds ?? null,
      amrapDurationSeconds: firstPart.amrapDurationSeconds ?? null,
      repScheme: firstPart.repScheme ?? null,
      rounds: firstPart.rounds ?? null,
      vestRequirement: vestRequirement ?? "none",
      vestWeightMaleLb:
        vestWeightMaleLb != null && vestWeightMaleLb !== ""
          ? vestWeightMaleLb
          : null,
      vestWeightFemaleLb:
        vestWeightFemaleLb != null && vestWeightFemaleLb !== ""
          ? vestWeightFemaleLb
          : null,
      isPartner: !!isPartner,
      partnerCount:
        partnerCount != null && partnerCount !== ""
          ? Number(partnerCount)
          : null,
      // The BenchmarkPartInput shape is a structural superset of
      // TemplatePartInput (same fields, same coercion rules) — cast at
      // the boundary so callers don't have to re-shape.
      parts: parts as unknown as TemplatePartInput[],
    });
  });

  return NextResponse.json(
    {
      id: result.templateId,
      contentFingerprint: result.contentFingerprint,
      isNew: result.isNew,
    },
    { status: 201 }
  );
}
