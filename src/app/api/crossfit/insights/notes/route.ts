import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import {
  aggregateDormantComplaints,
  aggregateGraduationTracker,
  aggregateNotesForUser,
  aggregateRpeComplaintCorrelation,
  aggregateTemporalComplaints,
} from "@/lib/crossfit/insights/notes-extraction";

export async function GET() {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [row] = await db
    .select({ isVip: users.isVip })
    .from(users)
    .where(eq(users.id, session.id))
    .limit(1);

  if (!row?.isVip) {
    // The card hides itself for non-VIPs; this is just defense in depth.
    return NextResponse.json(
      { error: "Notes Insights is currently a VIP-only feature." },
      { status: 403 }
    );
  }

  const [
    insights,
    temporalCallouts,
    rpeCallouts,
    dormantWins,
    graduationTracker,
  ] = await Promise.all([
    aggregateNotesForUser(session.id),
    aggregateTemporalComplaints(session.id),
    aggregateRpeComplaintCorrelation(session.id),
    aggregateDormantComplaints(session.id),
    aggregateGraduationTracker(session.id),
  ]);
  return NextResponse.json({
    ...insights,
    temporalCallouts,
    rpeCallouts,
    dormantWins,
    graduationTracker,
  });
}
