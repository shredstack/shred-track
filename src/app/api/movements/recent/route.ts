import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  crossfitWorkoutMovements,
  crossfitWorkoutParts,
  workoutSessions,
} from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// GET /api/movements/recent — movement IDs the caller has used in their own
// sessions, ordered by most recent use. The picker surfaces these at the top.
//
// Unified-schema: join sessions → template-parts → template-movements,
// filtered to the caller's own personal sessions (userId = me).
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select({
      movementId: crossfitWorkoutMovements.movementId,
      lastUsed: sql<string>`max(${workoutSessions.workoutDate})`.as("last_used"),
    })
    .from(crossfitWorkoutMovements)
    .innerJoin(
      crossfitWorkoutParts,
      eq(crossfitWorkoutParts.id, crossfitWorkoutMovements.crossfitWorkoutPartId)
    )
    .innerJoin(
      workoutSessions,
      eq(workoutSessions.crossfitWorkoutId, crossfitWorkoutParts.crossfitWorkoutId)
    )
    .where(eq(workoutSessions.userId, user.id))
    .groupBy(crossfitWorkoutMovements.movementId)
    .orderBy(desc(sql`max(${workoutSessions.workoutDate})`))
    .limit(12);

  return NextResponse.json(rows.map((r) => r.movementId));
}
