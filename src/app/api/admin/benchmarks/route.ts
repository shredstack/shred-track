import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  benchmarkWorkouts,
  benchmarkWorkoutBlocks,
  benchmarkWorkoutMovements,
  benchmarkWorkoutParts,
} from "@/db/schema";
import { asc } from "drizzle-orm";
import { getAdminAccess } from "@/lib/admin/access";
import {
  assembleBenchmarkParts,
  coerceBenchmarkBlockValues,
  coerceBenchmarkMovementValues,
  coerceBenchmarkPartValues,
  fetchBenchmarkPartsAndMovements,
  type BenchmarkPartInput,
} from "@/lib/crossfit/benchmark-parts";

// GET /api/admin/benchmarks — list all benchmarks (includes system).
// Open to super admins and to gym coaches/admins so they can curate.
export async function GET(_req: NextRequest) {
  const access = await getAdminAccess();
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select()
    .from(benchmarkWorkouts)
    .orderBy(asc(benchmarkWorkouts.name));

  const benchmarkIds = rows.map((r) => r.id);
  const { partsByBenchmark, movementsByBenchmark, blocksByPart } =
    await fetchBenchmarkPartsAndMovements(benchmarkIds);

  const result = rows.map((bw) => {
    const { parts, flatMovements } = assembleBenchmarkParts(
      bw,
      partsByBenchmark.get(bw.id) ?? [],
      movementsByBenchmark.get(bw.id) ?? [],
      blocksByPart
    );
    return {
      ...bw,
      requiresVest: bw.requiresVest,
      vestWeightMaleLb:
        bw.vestWeightMaleLb != null ? Number(bw.vestWeightMaleLb) : null,
      vestWeightFemaleLb:
        bw.vestWeightFemaleLb != null ? Number(bw.vestWeightFemaleLb) : null,
      isPartner: bw.isPartner,
      partnerCount: bw.partnerCount,
      movements: flatMovements,
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
    requiresVest,
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
    requiresVest?: boolean;
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
  const firstPartValues = coerceBenchmarkPartValues(firstPart);

  const result = await db.transaction(async (tx) => {
    const [bw] = await tx
      .insert(benchmarkWorkouts)
      .values({
        name: trimmedName,
        description: description?.trim() || null,
        workoutType: firstPart.workoutType,
        category: category || null,
        timeCapSeconds: firstPartValues.timeCapSeconds,
        amrapDurationSeconds: firstPartValues.amrapDurationSeconds,
        repScheme: firstPartValues.repScheme,
        createdBy: isSystem ? null : access.user.id,
        isSystem: isSystem ?? false,
        requiresVest: !!requiresVest,
        vestWeightMaleLb:
          vestWeightMaleLb != null && vestWeightMaleLb !== ""
            ? String(vestWeightMaleLb)
            : null,
        vestWeightFemaleLb:
          vestWeightFemaleLb != null && vestWeightFemaleLb !== ""
            ? String(vestWeightFemaleLb)
            : null,
        isPartner: !!isPartner,
        partnerCount:
          partnerCount != null && partnerCount !== ""
            ? Number(partnerCount)
            : null,
      })
      .returning();

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const partValues = coerceBenchmarkPartValues(p);
      const [insertedPart] = await tx
        .insert(benchmarkWorkoutParts)
        .values({
          benchmarkWorkoutId: bw.id,
          orderIndex: i,
          ...partValues,
        })
        .returning();

      const blockTempRefToId = new Map<string, string>();
      if (Array.isArray(p.blocks) && p.blocks.length > 0) {
        const blocksToInsert = p.blocks
          .map((b, k) => ({ input: b, values: coerceBenchmarkBlockValues(b, k) }))
          .filter((entry) => entry.values.title.length > 0);
        if (blocksToInsert.length > 0) {
          const inserted = await tx
            .insert(benchmarkWorkoutBlocks)
            .values(
              blocksToInsert.map((entry) => ({
                benchmarkWorkoutPartId: insertedPart.id,
                ...entry.values,
              }))
            )
            .returning({ id: benchmarkWorkoutBlocks.id });
          for (let k = 0; k < inserted.length; k++) {
            const tempRef = blocksToInsert[k].input.tempRef;
            if (tempRef) blockTempRefToId.set(tempRef, inserted[k].id);
          }
        }
      }

      if (Array.isArray(p.movements) && p.movements.length > 0) {
        await tx.insert(benchmarkWorkoutMovements).values(
          p.movements.map((m, j) => {
            const resolvedBlockId = m.blockTempRef
              ? blockTempRefToId.get(m.blockTempRef) ?? null
              : m.blockId ?? null;
            return {
              benchmarkWorkoutId: bw.id,
              benchmarkWorkoutPartId: insertedPart.id,
              benchmarkWorkoutBlockId: resolvedBlockId,
              ...coerceBenchmarkMovementValues(m, j),
            };
          })
        );
      }
    }

    return bw;
  });

  return NextResponse.json(result, { status: 201 });
}
