import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  benchmarkWorkouts,
} from "@/db/schema";
import { asc } from "drizzle-orm";
import { getAdminAccess } from "@/lib/admin/access";
import {
  assembleBenchmarkParts,
  fetchBenchmarkPartsAndMovements,
  type BenchmarkPartInput,
} from "@/lib/crossfit/benchmark-parts";
import {
  upsertTemplate,
  type TemplatePartInput,
} from "@/lib/crossfit/upsert-template";

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
      requiresVest: !!requiresVest,
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
