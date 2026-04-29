import { NextResponse } from "next/server";
import { db } from "@/db";
import { workoutMovements, workouts } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// GET /api/movements/recent — movement IDs the caller has used in their own
// workouts, ordered by most recent use. The picker uses this to surface
// frequently-cycled movements at the top of the list.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select({
      movementId: workoutMovements.movementId,
      lastUsed: sql<string>`max(${workouts.workoutDate})`.as("last_used"),
    })
    .from(workoutMovements)
    .innerJoin(workouts, eq(workouts.id, workoutMovements.workoutId))
    .where(eq(workouts.createdBy, user.id))
    .groupBy(workoutMovements.movementId)
    .orderBy(desc(sql`max(${workouts.workoutDate})`))
    .limit(12);

  return NextResponse.json(rows.map((r) => r.movementId));
}
