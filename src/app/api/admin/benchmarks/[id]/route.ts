import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  benchmarkWorkouts,
  benchmarkWorkoutBlocks,
  benchmarkWorkoutMovements,
  benchmarkWorkoutParts,
  workouts,
  workoutBlocks,
  workoutParts,
  workoutMovements,
} from "@/db/schema";
import { eq, and, inArray, notInArray } from "drizzle-orm";
import { getAdminUser } from "@/lib/admin";
import { getAdminAccess } from "@/lib/admin/access";
import {
  coerceBenchmarkBlockValues,
  coerceBenchmarkMovementValues,
  coerceBenchmarkPartValues,
  type BenchmarkPartInput,
} from "@/lib/crossfit/benchmark-parts";

// PUT /api/admin/benchmarks/[id] — update any benchmark (including system).
// Open to super admins and to gym coaches/admins. Edits land globally and
// immediately; there is no review queue today.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await getAdminAccess();
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
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

  const [existing] = await db
    .select()
    .from(benchmarkWorkouts)
    .where(eq(benchmarkWorkouts.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Benchmark not found" }, { status: 404 });
  }

  const firstPart = parts[0];
  const firstPartValues = coerceBenchmarkPartValues(firstPart);

  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(benchmarkWorkouts)
      .set({
        name: name?.trim() || existing.name,
        description:
          description !== undefined
            ? description?.trim() || null
            : existing.description,
        workoutType: firstPart.workoutType,
        category:
          category !== undefined
            ? category || null
            : existing.category,
        timeCapSeconds: firstPartValues.timeCapSeconds,
        amrapDurationSeconds: firstPartValues.amrapDurationSeconds,
        repScheme: firstPartValues.repScheme,
        isSystem: isSystem !== undefined ? !!isSystem : existing.isSystem,
        ...(requiresVest !== undefined ? { requiresVest: !!requiresVest } : {}),
        ...(vestWeightMaleLb !== undefined
          ? {
              vestWeightMaleLb:
                vestWeightMaleLb != null && vestWeightMaleLb !== ""
                  ? String(vestWeightMaleLb)
                  : null,
            }
          : {}),
        ...(vestWeightFemaleLb !== undefined
          ? {
              vestWeightFemaleLb:
                vestWeightFemaleLb != null && vestWeightFemaleLb !== ""
                  ? String(vestWeightFemaleLb)
                  : null,
            }
          : {}),
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

    // Diff benchmark parts: drop missing, upsert by id.
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

    // Per-part block tempRef → real benchmark block id, captured in the
    // benchmark write loop so the linked-workouts propagation loop below
    // can resolve movement.blockTempRef → block id without re-querying.
    const blockTempRefByPartIndex = new Map<number, Map<string, string>>();

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

      // Diff blocks for this part. Done before movements so we can resolve
      // blockTempRef → real block id when upserting movements.
      const inputBlocks = Array.isArray(p.blocks) ? p.blocks : [];
      const keepBlockIds = inputBlocks
        .map((b) => b.id)
        .filter((x): x is string => !!x);
      if (keepBlockIds.length > 0) {
        await tx
          .delete(benchmarkWorkoutBlocks)
          .where(
            and(
              eq(benchmarkWorkoutBlocks.benchmarkWorkoutPartId, partId),
              notInArray(benchmarkWorkoutBlocks.id, keepBlockIds)
            )
          );
      } else {
        await tx
          .delete(benchmarkWorkoutBlocks)
          .where(eq(benchmarkWorkoutBlocks.benchmarkWorkoutPartId, partId));
      }

      const blockTempRefToId = new Map<string, string>();
      blockTempRefByPartIndex.set(i, blockTempRefToId);
      for (let k = 0; k < inputBlocks.length; k++) {
        const b = inputBlocks[k];
        const blockValues = coerceBenchmarkBlockValues(b, k);
        if (blockValues.title.length === 0) continue;

        if (b.id) {
          const [updatedBlock] = await tx
            .update(benchmarkWorkoutBlocks)
            .set(blockValues)
            .where(
              and(
                eq(benchmarkWorkoutBlocks.id, b.id),
                eq(benchmarkWorkoutBlocks.benchmarkWorkoutPartId, partId)
              )
            )
            .returning({ id: benchmarkWorkoutBlocks.id });
          if (!updatedBlock) {
            const [inserted] = await tx
              .insert(benchmarkWorkoutBlocks)
              .values({
                benchmarkWorkoutPartId: partId,
                ...blockValues,
              })
              .returning({ id: benchmarkWorkoutBlocks.id });
            if (b.tempRef) blockTempRefToId.set(b.tempRef, inserted.id);
          }
        } else {
          const [inserted] = await tx
            .insert(benchmarkWorkoutBlocks)
            .values({ benchmarkWorkoutPartId: partId, ...blockValues })
            .returning({ id: benchmarkWorkoutBlocks.id });
          if (b.tempRef) blockTempRefToId.set(b.tempRef, inserted.id);
        }
      }

      const resolveMovementBlockId = (
        m: BenchmarkPartInput["movements"][number]
      ): string | null => {
        if (m.blockTempRef) return blockTempRefToId.get(m.blockTempRef) ?? null;
        if (m.blockId) return m.blockId;
        return null;
      };

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
        const benchmarkWorkoutBlockId = resolveMovementBlockId(m);

        if (m.id) {
          const [updatedMov] = await tx
            .update(benchmarkWorkoutMovements)
            .set({ ...fields, benchmarkWorkoutBlockId })
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
              benchmarkWorkoutBlockId,
              ...fields,
            });
          }
        } else {
          await tx.insert(benchmarkWorkoutMovements).values({
            benchmarkWorkoutId: id,
            benchmarkWorkoutPartId: partId,
            benchmarkWorkoutBlockId,
            ...fields,
          });
        }
      }
    }

    // ============================================
    // Propagate edits to linked workouts.
    // ============================================
    //
    // Users opted into "edits flow everywhere": when a benchmark changes,
    // workouts created from it pick up the change. Score history (the
    // `scores` row itself) survives. For each linked workout we sync:
    //
    //   1. Top-level `workouts.*` columns (mirroring the first part —
    //      same legacy fallback the read path uses).
    //   2. Each linked-workout part at orderIndex `i` < parts.length —
    //      structural fields and per-movement diff, matching the
    //      benchmark's part at the same orderIndex.
    //
    // Linked-workout parts beyond `parts.length` are left alone (the user
    // may have added them on top of the benchmark). New benchmark parts
    // at higher orderIndex are *not* inserted onto linked workouts —
    // stale snapshots live with their original part count rather than us
    // grafting in parts that have no score row attached. Re-adding the
    // workout from the benchmark picks up any new parts.
    const linkedWorkouts = await tx
      .select({ id: workouts.id })
      .from(workouts)
      .where(eq(workouts.benchmarkWorkoutId, id));

    if (linkedWorkouts.length > 0) {
      const workoutIds = linkedWorkouts.map((w) => w.id);

      await tx
        .update(workouts)
        .set({
          title: updated.name,
          description: updated.description,
          workoutType: updated.workoutType,
          timeCapSeconds: updated.timeCapSeconds,
          amrapDurationSeconds: updated.amrapDurationSeconds,
          repScheme: updated.repScheme,
          requiresVest: updated.requiresVest,
          vestWeightMaleLb: updated.vestWeightMaleLb,
          vestWeightFemaleLb: updated.vestWeightFemaleLb,
          isPartner: updated.isPartner,
          partnerCount: updated.partnerCount,
          updatedAt: new Date(),
        })
        .where(inArray(workouts.id, workoutIds));

      for (let i = 0; i < parts.length; i++) {
        const benchmarkPart = parts[i];
        const benchmarkPartValues = coerceBenchmarkPartValues(benchmarkPart);

        // Sync structural fields on each linked workout's part at this
        // orderIndex (no-op when the linked workout has fewer parts).
        await tx
          .update(workoutParts)
          .set({
            label: benchmarkPartValues.label,
            workoutType: benchmarkPartValues.workoutType,
            timeCapSeconds: benchmarkPartValues.timeCapSeconds,
            amrapDurationSeconds: benchmarkPartValues.amrapDurationSeconds,
            emomIntervalSeconds: benchmarkPartValues.emomIntervalSeconds,
            repScheme: benchmarkPartValues.repScheme,
            rounds: benchmarkPartValues.rounds,
            structure: benchmarkPartValues.structure,
            intervalWorkSeconds: benchmarkPartValues.intervalWorkSeconds,
            intervalRestSeconds: benchmarkPartValues.intervalRestSeconds,
            intervalRounds: benchmarkPartValues.intervalRounds,
            sideCadenceIntervalSeconds:
              benchmarkPartValues.sideCadenceIntervalSeconds,
            sideCadenceOpenEnded: benchmarkPartValues.sideCadenceOpenEnded,
          })
          .where(
            and(
              inArray(workoutParts.workoutId, workoutIds),
              eq(workoutParts.orderIndex, i)
            )
          );

        // Read the just-upserted benchmark blocks for this part so we can
        // mirror them onto each linked workout's matching part. The map is
        // keyed by benchmarkBlockId so each linked-workout block can be
        // looked up when stamping movement.workoutBlockId below.
        const benchmarkBlocksForPart = await tx
          .select({
            id: benchmarkWorkoutBlocks.id,
            orderIndex: benchmarkWorkoutBlocks.orderIndex,
            title: benchmarkWorkoutBlocks.title,
          })
          .from(benchmarkWorkoutBlocks)
          .innerJoin(
            benchmarkWorkoutParts,
            eq(
              benchmarkWorkoutBlocks.benchmarkWorkoutPartId,
              benchmarkWorkoutParts.id
            )
          )
          .where(
            and(
              eq(benchmarkWorkoutParts.benchmarkWorkoutId, id),
              eq(benchmarkWorkoutParts.orderIndex, i)
            )
          )
          .orderBy(benchmarkWorkoutBlocks.orderIndex);

        // Diff per-part movements on each linked workout. Match by
        // orderIndex within the part — preserves score_movement_details
        // FKs when shape lines up.
        for (const wid of workoutIds) {
          const [linkedPart] = await tx
            .select({ id: workoutParts.id })
            .from(workoutParts)
            .where(
              and(
                eq(workoutParts.workoutId, wid),
                eq(workoutParts.orderIndex, i)
              )
            )
            .limit(1);
          if (!linkedPart) continue;

          // Replace this linked-part's blocks with a fresh copy so block
          // edits propagate. Existing workout_movements.workoutBlockId
          // references get nulled by ON DELETE SET NULL — we re-stamp
          // them below from the benchmark movement's blockId.
          await tx
            .delete(workoutBlocks)
            .where(eq(workoutBlocks.workoutPartId, linkedPart.id));

          const benchmarkBlockIdToWorkoutBlockId = new Map<string, string>();
          if (benchmarkBlocksForPart.length > 0) {
            const inserted = await tx
              .insert(workoutBlocks)
              .values(
                benchmarkBlocksForPart.map((b) => ({
                  workoutPartId: linkedPart.id,
                  orderIndex: b.orderIndex,
                  title: b.title,
                }))
              )
              .returning({ id: workoutBlocks.id });
            for (let k = 0; k < inserted.length; k++) {
              benchmarkBlockIdToWorkoutBlockId.set(
                benchmarkBlocksForPart[k].id,
                inserted[k].id
              );
            }
          }

          const existingMovs = await tx
            .select({
              id: workoutMovements.id,
              orderIndex: workoutMovements.orderIndex,
            })
            .from(workoutMovements)
            .where(eq(workoutMovements.workoutPartId, linkedPart.id))
            .orderBy(workoutMovements.orderIndex);

          const existingByOrder = new Map(
            existingMovs.map((m) => [m.orderIndex, m])
          );

          const inputs = benchmarkPart.movements;
          for (let j = 0; j < inputs.length; j++) {
            const m = inputs[j];
            const orderIndex = m.orderIndex ?? j;
            const fields = coerceBenchmarkMovementValues(m, orderIndex);
            // Resolve the movement's benchmark block (by tempRef if newly
            // created; by id otherwise) and map it to the corresponding
            // linked-workout block id we just inserted.
            const partBlockTempRefMap =
              blockTempRefByPartIndex.get(i) ?? new Map<string, string>();
            const benchmarkBlockId = m.blockTempRef
              ? partBlockTempRefMap.get(m.blockTempRef) ?? null
              : m.blockId ?? null;
            const workoutBlockId = benchmarkBlockId
              ? benchmarkBlockIdToWorkoutBlockId.get(benchmarkBlockId) ?? null
              : null;
            // workoutMovements has the same column set as benchmarkWorkoutMovements;
            // the coerce helper produces the right shape.
            const existingMov = existingByOrder.get(orderIndex);
            if (existingMov) {
              await tx
                .update(workoutMovements)
                .set({ ...fields, workoutBlockId })
                .where(eq(workoutMovements.id, existingMov.id));
            } else {
              await tx.insert(workoutMovements).values({
                workoutId: wid,
                workoutPartId: linkedPart.id,
                workoutBlockId,
                ...fields,
              });
            }
          }

          const orphanIds = existingMovs
            .filter((m) => m.orderIndex >= inputs.length)
            .map((m) => m.id);
          if (orphanIds.length > 0) {
            await tx
              .delete(workoutMovements)
              .where(inArray(workoutMovements.id, orphanIds));
          }
        }
      }
    }

    return updated;
  });

  return NextResponse.json(result);
}

// DELETE /api/admin/benchmarks/[id] — delete any benchmark. Super admin
// only: benchmarks are globally shared, so coaches at one gym shouldn't be
// able to delete rows other gyms reference.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await db.delete(benchmarkWorkouts).where(eq(benchmarkWorkouts.id, id));
  return NextResponse.json({ success: true });
}
