import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { movements } from "@/db/schema";
import { ilike, eq, or, and, isNull, sql } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// GET /api/movements — list movements visible to the caller
// (system-shared ∪ caller's own custom ones)
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const search = req.nextUrl.searchParams.get("q");
  const category = req.nextUrl.searchParams.get("category");

  const visibilityCondition = or(
    isNull(movements.createdBy),
    eq(movements.createdBy, user.id)
  )!;

  const whereClause = search
    ? and(visibilityCondition, ilike(movements.canonicalName, `%${search}%`))
    : category
      ? and(visibilityCondition, eq(movements.category, category))
      : visibilityCondition;

  const rows = await db
    .select()
    .from(movements)
    .where(whereClause)
    .orderBy(movements.canonicalName)
    .limit(100);

  return NextResponse.json(rows);
}

// POST /api/movements — create a user-scoped movement. System movements are
// seeded server-side; this endpoint only creates user-owned rows.
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const canonicalName = typeof body.canonicalName === "string" ? body.canonicalName.trim() : "";

  if (!canonicalName) {
    return NextResponse.json({ error: "canonicalName is required" }, { status: 400 });
  }
  if (canonicalName.length > 80) {
    return NextResponse.json({ error: "canonicalName too long (max 80)" }, { status: 400 });
  }

  // Block clashes with system movements before attempting insert — the unique
  // index only guards user-scoped rows, so without this check a user could
  // create "Deadlift" as their own row and shadow the system one in their UI.
  const [systemClash] = await db
    .select({ id: movements.id })
    .from(movements)
    .where(
      and(
        sql`LOWER(${movements.canonicalName}) = LOWER(${canonicalName})`,
        isNull(movements.createdBy)
      )
    )
    .limit(1);

  if (systemClash) {
    return NextResponse.json(
      { error: "A movement with this name already exists", movementId: systemClash.id },
      { status: 409 }
    );
  }

  try {
    const [movement] = await db
      .insert(movements)
      .values({
        canonicalName,
        category: body.category || "other",
        isWeighted: body.isWeighted ?? false,
        is1rmApplicable: body.is1rmApplicable ?? false,
        commonRxWeightMale: body.commonRxWeightMale || null,
        commonRxWeightFemale: body.commonRxWeightFemale || null,
        createdBy: user.id,
      })
      .returning();

    return NextResponse.json(movement, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("unique") || message.includes("duplicate")) {
      // User already has a movement with this name — return it so the caller
      // can reuse the existing id rather than surfacing an error.
      const [existing] = await db
        .select()
        .from(movements)
        .where(
          and(
            eq(movements.canonicalName, canonicalName),
            eq(movements.createdBy, user.id)
          )
        )
        .limit(1);
      if (existing) return NextResponse.json(existing, { status: 200 });
      return NextResponse.json({ error: "Movement already exists" }, { status: 409 });
    }
    throw err;
  }
}
