import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  crossfitWorkoutParts,
  crossfitWorkouts,
} from "@/db/schema";
import { and, eq, ilike, ne } from "drizzle-orm";
import { getAdminUser } from "@/lib/admin";
import { getAdminAccess } from "@/lib/admin/access";
import { type BenchmarkPartInput } from "@/lib/crossfit/benchmark-parts";
import {
  buildFingerprintInput,
  insertTemplateParts,
  type TemplatePartInput,
} from "@/lib/crossfit/upsert-template";
import { computeWorkoutFingerprint } from "@/lib/crossfit/fingerprint";
import type { VestRequirement } from "@/types/crossfit";

// PUT /api/admin/benchmarks/[id] — update a benchmark template in place.
//
// In the unified schema there's no "linked workouts" loop: sessions share
// the template, so writing to the template propagates the edit to every
// session that references it (Murph everywhere, Fran everywhere). This
// IS the spec's "snapshot independence" tradeoff — admin edits to system
// templates propagate to all historical sessions. Member edits are
// covered by the Smart Builder fork-on-edit flow elsewhere.
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
    .from(crossfitWorkouts)
    .where(eq(crossfitWorkouts.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Benchmark not found" }, { status: 404 });
  }

  const firstPart = parts[0];
  const nextTitle = name?.trim() || existing.title;

  // Block edits that would collide with another benchmark on Name + Type
  // within the same scope (excluding this row).
  const nextIsSystem = !!(isSystem !== undefined ? isSystem : existing.isSystem);
  const dupConditions = [
    ne(crossfitWorkouts.id, id),
    eq(crossfitWorkouts.isBenchmark, true),
    ilike(crossfitWorkouts.title, nextTitle),
    eq(crossfitWorkouts.workoutType, firstPart.workoutType),
  ];
  if (nextIsSystem) {
    dupConditions.push(eq(crossfitWorkouts.isSystem, true));
  } else if (existing.createdBy) {
    dupConditions.push(eq(crossfitWorkouts.isSystem, false));
    dupConditions.push(eq(crossfitWorkouts.createdBy, existing.createdBy));
  }
  const dupConflict = await db
    .select({ id: crossfitWorkouts.id })
    .from(crossfitWorkouts)
    .where(and(...dupConditions))
    .limit(1);
  if (dupConflict.length > 0) {
    return NextResponse.json(
      {
        error: `A ${nextIsSystem ? "system " : ""}benchmark named "${nextTitle}" (${firstPart.workoutType}) already exists.`,
      },
      { status: 409 }
    );
  }

  const nextDescription =
    description !== undefined
      ? description?.trim() || null
      : existing.description;

  // Recompute the fingerprint against the new prescription so dedup queries
  // continue to find this template after an edit.
  const fingerprint = computeWorkoutFingerprint(
    buildFingerprintInput({
      title: nextTitle,
      scope: existing.createdBy
        ? { kind: "personal", userId: existing.createdBy }
        : existing.communityId
          ? { kind: "community", communityId: existing.communityId }
          : { kind: "system" },
      workoutType: firstPart.workoutType,
      timeCapSeconds: firstPart.timeCapSeconds ?? null,
      amrapDurationSeconds: firstPart.amrapDurationSeconds ?? null,
      repScheme: firstPart.repScheme ?? null,
      rounds: firstPart.rounds ?? null,
      isBenchmark: true,
      isSystem: !!(isSystem !== undefined ? isSystem : existing.isSystem),
      vestRequirement: (vestRequirement !== undefined
        ? vestRequirement
        : (existing.vestRequirement as VestRequirement)) ?? "none",
      vestWeightMaleLb:
        vestWeightMaleLb !== undefined ? vestWeightMaleLb : existing.vestWeightMaleLb,
      vestWeightFemaleLb:
        vestWeightFemaleLb !== undefined
          ? vestWeightFemaleLb
          : existing.vestWeightFemaleLb,
      isPartner: !!(isPartner !== undefined ? isPartner : existing.isPartner),
      partnerCount:
        partnerCount !== undefined
          ? partnerCount != null && partnerCount !== ""
            ? Number(partnerCount)
            : null
          : existing.partnerCount,
      parts: parts as unknown as TemplatePartInput[],
    })
  );

  const result = await db.transaction(async (tx) => {
    // Replace the parts/blocks/movements tree. Cascade FKs handle the
    // dependents (blocks and movements drop with their parent part).
    await tx
      .delete(crossfitWorkoutParts)
      .where(eq(crossfitWorkoutParts.crossfitWorkoutId, id));

    await insertTemplateParts(
      tx,
      id,
      parts as unknown as TemplatePartInput[]
    );

    const [updated] = await tx
      .update(crossfitWorkouts)
      .set({
        title: nextTitle,
        description: nextDescription,
        category: category !== undefined ? category || null : existing.category,
        workoutType: firstPart.workoutType,
        timeCapSeconds: firstPart.timeCapSeconds ?? null,
        amrapDurationSeconds: firstPart.amrapDurationSeconds ?? null,
        repScheme: firstPart.repScheme ?? null,
        rounds: firstPart.rounds ?? null,
        isSystem:
          isSystem !== undefined ? !!isSystem : existing.isSystem,
        contentFingerprint: fingerprint,
        ...(vestRequirement !== undefined
          ? { vestRequirement }
          : {}),
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
      .where(eq(crossfitWorkouts.id, id))
      .returning();

    return updated;
  });

  return NextResponse.json(result);
}

// DELETE /api/admin/benchmarks/[id] — delete a benchmark template. Super
// admin only: templates are globally shared, so coaches at one gym
// shouldn't be able to delete rows other gyms reference.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  // Scope to benchmark templates only. `crossfit_workouts` also holds personal
  // and gym templates in the unified schema; deleting a row by raw id would
  // either nuke a user's template or hit the `workout_sessions` FK restrict
  // and error confusingly. Explicit predicate keeps the admin route's blast
  // radius bounded to what it claims to manage.
  await db
    .delete(crossfitWorkouts)
    .where(and(eq(crossfitWorkouts.id, id), eq(crossfitWorkouts.isBenchmark, true)));
  return NextResponse.json({ success: true });
}
