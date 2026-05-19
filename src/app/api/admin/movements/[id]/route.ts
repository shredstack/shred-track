import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { movements } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getAdminUser } from "@/lib/admin";
import { getAdminAccess } from "@/lib/admin/access";
import { ensureWeightliftingBenchmark } from "@/lib/crossfit/weightlifting-benchmarks";

// PUT /api/admin/movements/[id] — update a movement. Open to super admins
// and to gym coaches/admins. Edits land globally and immediately; there is
// no review queue today.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await getAdminAccess();
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const {
    canonicalName,
    category,
    isWeighted,
    is1rmApplicable,
    commonRxWeightMale,
    commonRxWeightFemale,
    videoUrl,
    isValidated,
    metricType,
    supportedMetricTypes,
    rxFields,
    rxDefaults,
  } = body;

  const [existing] = await db
    .select()
    .from(movements)
    .where(eq(movements.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Movement not found" }, { status: 404 });
  }

  try {
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(movements)
        .set({
          canonicalName: canonicalName?.trim() || existing.canonicalName,
          category: category || existing.category,
          isWeighted: isWeighted ?? existing.isWeighted,
          is1rmApplicable: is1rmApplicable ?? existing.is1rmApplicable,
          commonRxWeightMale: commonRxWeightMale !== undefined
            ? (commonRxWeightMale?.toString() || null)
            : existing.commonRxWeightMale,
          commonRxWeightFemale: commonRxWeightFemale !== undefined
            ? (commonRxWeightFemale?.toString() || null)
            : existing.commonRxWeightFemale,
          videoUrl: videoUrl !== undefined ? (videoUrl || null) : existing.videoUrl,
          isValidated: isValidated ?? existing.isValidated,
          ...(typeof metricType === "string" ? { metricType } : {}),
          ...(Array.isArray(supportedMetricTypes) && supportedMetricTypes.length > 0
            ? { supportedMetricTypes }
            : {}),
          ...(Array.isArray(rxFields) ? { rxFields } : {}),
          ...(rxDefaults !== undefined && rxDefaults !== null && typeof rxDefaults === "object"
            ? { rxDefaults }
            : {}),
        })
        .where(eq(movements.id, id))
        .returning();

      // Keep the weightlifting benchmark in sync with the movement.
      //   - newly applicable (false → true): upsert the benchmark
      //   - rename while applicable: ensureWeightliftingBenchmark refreshes the name
      //   - flipped off (true → false): leave the existing benchmark; the
      //     list endpoint hides it on read so existing history isn't orphaned
      if (row.is1rmApplicable) {
        await ensureWeightliftingBenchmark(tx, {
          id: row.id,
          canonicalName: row.canonicalName,
        });
      }

      return row;
    });

    return NextResponse.json(updated);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("unique")) {
      return NextResponse.json(
        { error: "A movement with this name already exists" },
        { status: 409 }
      );
    }
    throw err;
  }
}

// DELETE /api/admin/movements/[id] — delete a movement. Super admin only:
// movements are globally shared, so a coach at one gym shouldn't be able to
// delete a row that another gym's workouts may reference.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const [existing] = await db
    .select()
    .from(movements)
    .where(eq(movements.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Movement not found" }, { status: 404 });
  }

  try {
    await db.delete(movements).where(eq(movements.id, id));
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("foreign key")) {
      return NextResponse.json(
        { error: "Cannot delete — this movement is used in workouts or benchmarks" },
        { status: 409 }
      );
    }
    throw err;
  }
}
