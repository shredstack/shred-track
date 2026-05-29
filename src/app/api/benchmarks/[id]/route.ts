// PUT /api/benchmarks/[id]    — update a user-created benchmark template.
// DELETE /api/benchmarks/[id] — delete a user-created benchmark template.
//
// Unified-schema cutover: user benchmarks live in `crossfit_workouts` with
// `is_benchmark = true, is_system = false`. The PUT replaces the
// prescription via insertTemplateParts (delete + reinsert), preserving
// the template id so existing scores stay attached.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { crossfitWorkoutParts, crossfitWorkouts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import {
  buildFingerprintInput,
  insertTemplateParts,
  type TemplatePartInput,
} from "@/lib/crossfit/upsert-template";
import { computeWorkoutFingerprint } from "@/lib/crossfit/fingerprint";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const [existing] = await db
    .select()
    .from(crossfitWorkouts)
    .where(eq(crossfitWorkouts.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Benchmark not found" }, { status: 404 });
  }
  if (existing.isSystem) {
    return NextResponse.json(
      { error: "System benchmarks cannot be modified" },
      { status: 403 }
    );
  }
  if (existing.createdBy !== user.id) {
    return NextResponse.json(
      { error: "Not authorized to modify this benchmark" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const { name, description, category, isPartner, partnerCount, parts } =
    body as {
      name?: string;
      description?: string;
      category?: string | null;
      isPartner?: boolean;
      partnerCount?: number | string | null;
      parts?: TemplatePartInput[];
    };

  const trimmedName = name?.trim();
  if (!trimmedName || trimmedName.length > 100) {
    return NextResponse.json(
      { error: "Name is required (max 100 characters)" },
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
    if (!Array.isArray(p.movements) || p.movements.length === 0) {
      return NextResponse.json(
        { error: "Each part must have at least one movement" },
        { status: 400 }
      );
    }
  }

  if (trimmedName !== existing.title) {
    const systemConflict = await db
      .select({ id: crossfitWorkouts.id })
      .from(crossfitWorkouts)
      .where(
        and(
          eq(crossfitWorkouts.title, trimmedName),
          eq(crossfitWorkouts.isSystem, true)
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

  // Recompute the fingerprint so dedup queries still find this template.
  const fingerprint = computeWorkoutFingerprint(
    buildFingerprintInput({
      title: trimmedName,
      scope: existing.communityId
        ? { kind: "community", communityId: existing.communityId }
        : { kind: "personal", userId: user.id },
      workoutType: firstPart.workoutType,
      timeCapSeconds: firstPart.timeCapSeconds ?? null,
      amrapDurationSeconds: firstPart.amrapDurationSeconds ?? null,
      repScheme: firstPart.repScheme ?? null,
      isBenchmark: true,
      isSystem: false,
      requiresVest: !!existing.requiresVest,
      vestWeightMaleLb: existing.vestWeightMaleLb,
      vestWeightFemaleLb: existing.vestWeightFemaleLb,
      isPartner:
        isPartner !== undefined ? !!isPartner : !!existing.isPartner,
      partnerCount:
        partnerCount !== undefined
          ? partnerCount != null && partnerCount !== ""
            ? Number(partnerCount)
            : null
          : existing.partnerCount,
      parts,
    })
  );

  const result = await db.transaction(async (tx) => {
    await tx
      .delete(crossfitWorkoutParts)
      .where(eq(crossfitWorkoutParts.crossfitWorkoutId, id));
    await insertTemplateParts(tx, id, parts);

    const [updated] = await tx
      .update(crossfitWorkouts)
      .set({
        title: trimmedName,
        description: description?.trim() || null,
        category:
          category !== undefined ? category || null : existing.category,
        workoutType: firstPart.workoutType,
        timeCapSeconds: firstPart.timeCapSeconds ?? null,
        amrapDurationSeconds: firstPart.amrapDurationSeconds ?? null,
        repScheme: firstPart.repScheme ?? null,
        rounds: firstPart.rounds ?? null,
        contentFingerprint: fingerprint,
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
      .where(eq(crossfitWorkouts.id, id))
      .returning();
    return updated;
  });

  return NextResponse.json({
    id: result.id,
    name: result.title,
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const [existing] = await db
    .select({
      id: crossfitWorkouts.id,
      isSystem: crossfitWorkouts.isSystem,
      createdBy: crossfitWorkouts.createdBy,
    })
    .from(crossfitWorkouts)
    .where(eq(crossfitWorkouts.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Benchmark not found" }, { status: 404 });
  }
  if (existing.isSystem) {
    return NextResponse.json(
      { error: "System benchmarks cannot be deleted" },
      { status: 403 }
    );
  }
  if (existing.createdBy !== user.id) {
    return NextResponse.json(
      { error: "Not authorized to delete this benchmark" },
      { status: 403 }
    );
  }

  await db.delete(crossfitWorkouts).where(eq(crossfitWorkouts.id, id));
  return NextResponse.json({ success: true });
}
