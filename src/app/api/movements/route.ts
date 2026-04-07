import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { movements } from "@/db/schema";
import { ilike, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// GET /api/movements — search or list movements
export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams.get("q");
  const category = req.nextUrl.searchParams.get("category");

  let query = db.select().from(movements);

  if (search) {
    query = query.where(ilike(movements.canonicalName, `%${search}%`)) as typeof query;
  } else if (category) {
    query = query.where(eq(movements.category, category)) as typeof query;
  }

  const rows = await query.orderBy(movements.canonicalName).limit(100);

  return NextResponse.json(rows);
}

// POST /api/movements — add a new movement
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { canonicalName, category } = body;

  if (!canonicalName || !category) {
    return NextResponse.json({ error: "canonicalName and category are required" }, { status: 400 });
  }

  try {
    const [movement] = await db
      .insert(movements)
      .values({
        canonicalName,
        category,
        isWeighted: body.isWeighted ?? false,
        is1rmApplicable: body.is1rmApplicable ?? false,
        commonRxWeightMale: body.commonRxWeightMale || null,
        commonRxWeightFemale: body.commonRxWeightFemale || null,
      })
      .returning();

    return NextResponse.json(movement, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("unique") || message.includes("duplicate")) {
      return NextResponse.json({ error: "Movement already exists" }, { status: 409 });
    }
    throw err;
  }
}
