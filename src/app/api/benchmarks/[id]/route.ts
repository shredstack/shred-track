import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  benchmarkWorkouts,
  benchmarkWorkoutMovements,
  benchmarkWorkoutParts,
} from "@/db/schema";
import { eq, and, notInArray } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import {
  coerceBenchmarkMovementValues,
  coerceBenchmarkPartValues,
  type BenchmarkPartInput,
} from "@/lib/crossfit/benchmark-parts";

// PUT /api/benchmarks/[id] — update a user-created benchmark.
//
// Accepts the multi-part shape: `parts[]` with the same per-part /
// per-movement schema as POST. Existing parts/movements with an `id` are
// updated in place (preserving their UUIDs); rows missing from the payload
// are deleted; rows without an id are inserted.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const [existing] = await db
    .select()
    .from(benchmarkWorkouts)
    .where(eq(benchmarkWorkouts.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Benchmark not found" }, { status: 404 });
  }

  if (existing.isSystem) {
    return NextResponse.json({ error: "System benchmarks cannot be modified" }, { status: 403 });
  }

  if (existing.createdBy !== user.id) {
    return NextResponse.json({ error: "Not authorized to modify this benchmark" }, { status: 403 });
  }

  const body = await req.json();
  const {
    name,
    description,
    category,
    isPartner,
    partnerCount,
    parts,
  } = body as {
    name?: string;
    description?: string;
    category?: string | null;
    isPartner?: boolean;
    partnerCount?: number | string | null;
    parts?: BenchmarkPartInput[];
  };

  const trimmedName = name?.trim();
  if (!trimmedName || trimmedName.length > 100) {
    return NextResponse.json({ error: "Name is required (max 100 characters)" }, { status: 400 });
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
    if (!Array.isArray(p.movements) || p.movements.length === 0) {
      return NextResponse.json(
        { error: "Each part must have at least one movement" },
        { status: 400 }
      );
    }
  }

  if (trimmedName !== existing.name) {
    const systemConflict = await db
      .select({ id: benchmarkWorkouts.id })
      .from(benchmarkWorkouts)
      .where(
        and(
          eq(benchmarkWorkouts.name, trimmedName),
          eq(benchmarkWorkouts.isSystem, true)
        )
      )
      .limit(1);

    if (systemConflict.length > 0) {
      return NextResponse.json(
        { error: "A system benchmark with this name already exists" },
        { status: 409 }
      );
    }
  }

  const firstPart = parts[0];
  const firstPartValues = coerceBenchmarkPartValues(firstPart);

  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(benchmarkWorkouts)
      .set({
        name: trimmedName,
        description: description?.trim() || null,
        workoutType: firstPart.workoutType,
        category: category !== undefined ? (category || null) : existing.category,
        timeCapSeconds: firstPartValues.timeCapSeconds,
        amrapDurationSeconds: firstPartValues.amrapDurationSeconds,
        repScheme: firstPartValues.repScheme,
        ...(isPartner !== undefined ? { isPartner: !!isPartner } : {}),
        ...(partnerCount !== undefined
          ? {
              partnerCount:
                partnerCount != null && partnerCount !== ""
                  ? Number(partnerCount)
                  : null,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(benchmarkWorkouts.id, id))
      .returning();

    // Drop parts that disappeared from the payload. Cascade removes their
    // movements. Synthetic ids (from legacy single-part rows) never match
    // a real id, so they're treated as new inserts and the legacy part
    // (the sole row in the parts table) gets pruned by the diff.
    const keepPartIds = parts
      .map((p) => p.id)
      .filter((x): x is string => !!x && !x.startsWith("synthetic:"));
    if (keepPartIds.length > 0) {
      await tx
        .delete(benchmarkWorkoutParts)
        .where(
          and(
            eq(benchmarkWorkoutParts.benchmarkWorkoutId, id),
            notInArray(benchmarkWorkoutParts.id, keepPartIds)
          )
        );
    } else {
      await tx
        .delete(benchmarkWorkoutParts)
        .where(eq(benchmarkWorkoutParts.benchmarkWorkoutId, id));
    }

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const partValues = coerceBenchmarkPartValues(p);
      let partId: string;

      if (p.id && !p.id.startsWith("synthetic:")) {
        const [updatedPart] = await tx
          .update(benchmarkWorkoutParts)
          .set({ orderIndex: i, ...partValues })
          .where(
            and(
              eq(benchmarkWorkoutParts.id, p.id),
              eq(benchmarkWorkoutParts.benchmarkWorkoutId, id)
            )
          )
          .returning();
        if (!updatedPart) {
          const [inserted] = await tx
            .insert(benchmarkWorkoutParts)
            .values({
              benchmarkWorkoutId: id,
              orderIndex: i,
              ...partValues,
            })
            .returning();
          partId = inserted.id;
        } else {
          partId = updatedPart.id;
        }
      } else {
        const [inserted] = await tx
          .insert(benchmarkWorkoutParts)
          .values({
            benchmarkWorkoutId: id,
            orderIndex: i,
            ...partValues,
          })
          .returning();
        partId = inserted.id;
      }

      // Diff movements within this part.
      const keepMovementIds = p.movements
        .map((m) => m.id)
        .filter((x): x is string => !!x);
      if (keepMovementIds.length > 0) {
        await tx
          .delete(benchmarkWorkoutMovements)
          .where(
            and(
              eq(benchmarkWorkoutMovements.benchmarkWorkoutPartId, partId),
              notInArray(benchmarkWorkoutMovements.id, keepMovementIds)
            )
          );
      } else {
        await tx
          .delete(benchmarkWorkoutMovements)
          .where(eq(benchmarkWorkoutMovements.benchmarkWorkoutPartId, partId));
      }

      for (let j = 0; j < p.movements.length; j++) {
        const m = p.movements[j];
        const fields = coerceBenchmarkMovementValues(m, j);

        if (m.id) {
          const [updatedMov] = await tx
            .update(benchmarkWorkoutMovements)
            .set(fields)
            .where(
              and(
                eq(benchmarkWorkoutMovements.id, m.id),
                eq(benchmarkWorkoutMovements.benchmarkWorkoutPartId, partId)
              )
            )
            .returning();
          if (!updatedMov) {
            await tx.insert(benchmarkWorkoutMovements).values({
              benchmarkWorkoutId: id,
              benchmarkWorkoutPartId: partId,
              ...fields,
            });
          }
        } else {
          await tx.insert(benchmarkWorkoutMovements).values({
            benchmarkWorkoutId: id,
            benchmarkWorkoutPartId: partId,
            ...fields,
          });
        }
      }
    }

    return updated;
  });

  return NextResponse.json(result);
}

// DELETE /api/benchmarks/[id] — delete a user-created benchmark
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const [existing] = await db
    .select()
    .from(benchmarkWorkouts)
    .where(eq(benchmarkWorkouts.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Benchmark not found" }, { status: 404 });
  }

  if (existing.isSystem) {
    return NextResponse.json({ error: "System benchmarks cannot be deleted" }, { status: 403 });
  }

  if (existing.createdBy !== user.id) {
    return NextResponse.json({ error: "Not authorized to delete this benchmark" }, { status: 403 });
  }

  await db.delete(benchmarkWorkouts).where(eq(benchmarkWorkouts.id, id));

  return NextResponse.json({ success: true });
}
