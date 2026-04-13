import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { movements } from "@/db/schema";
import { ilike, asc } from "drizzle-orm";
import { getAdminUser } from "@/lib/admin";

// GET /api/admin/movements — list all movements (admin only)
export async function GET(req: NextRequest) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const search = req.nextUrl.searchParams.get("search");
  const category = req.nextUrl.searchParams.get("category");

  let query = db.select().from(movements).$dynamic();

  if (search) {
    query = query.where(ilike(movements.canonicalName, `%${search}%`));
  }
  if (category) {
    const { eq } = await import("drizzle-orm");
    query = query.where(eq(movements.category, category));
  }

  const rows = await query.orderBy(asc(movements.canonicalName));
  return NextResponse.json(rows);
}

// POST /api/admin/movements — create a new movement (admin only)
export async function POST(req: NextRequest) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  const trimmedName = canonicalName?.trim();
  if (!trimmedName) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (!category) {
    return NextResponse.json({ error: "Category is required" }, { status: 400 });
  }

  try {
    const [movement] = await db
      .insert(movements)
      .values({
        canonicalName: trimmedName,
        category,
        isWeighted: isWeighted ?? false,
        is1rmApplicable: is1rmApplicable ?? false,
        commonRxWeightMale: commonRxWeightMale?.toString() || null,
        commonRxWeightFemale: commonRxWeightFemale?.toString() || null,
        videoUrl: videoUrl || null,
      })
      .returning();

    return NextResponse.json(movement, { status: 201 });
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
