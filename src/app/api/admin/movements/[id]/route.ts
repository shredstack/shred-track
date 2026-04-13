import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { movements } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getAdminUser } from "@/lib/admin";

// PUT /api/admin/movements/[id] — update a movement
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
    const [updated] = await db
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
      })
      .where(eq(movements.id, id))
      .returning();

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

// DELETE /api/admin/movements/[id] — delete a movement
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
