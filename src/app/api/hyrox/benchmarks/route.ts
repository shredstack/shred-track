import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { hyroxStationBenchmarks } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// GET /api/hyrox/benchmarks — get user's station benchmarks
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const station = req.nextUrl.searchParams.get("station");

  const query = station
    ? db
        .select()
        .from(hyroxStationBenchmarks)
        .where(eq(hyroxStationBenchmarks.userId, user.id))
        // Filter by station if provided
    : db
        .select()
        .from(hyroxStationBenchmarks)
        .where(eq(hyroxStationBenchmarks.userId, user.id));

  const rows = await query.orderBy(desc(hyroxStationBenchmarks.loggedAt)).limit(100);

  // If station filter, apply in-memory (simpler than building dynamic and())
  const filtered = station ? rows.filter((r) => r.station === station) : rows;

  return NextResponse.json(filtered);
}

// POST /api/hyrox/benchmarks — log a station benchmark
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { station, timeSeconds } = body;

  if (!station || !timeSeconds) {
    return NextResponse.json({ error: "station and timeSeconds are required" }, { status: 400 });
  }

  const [benchmark] = await db
    .insert(hyroxStationBenchmarks)
    .values({
      userId: user.id,
      station,
      timeSeconds,
      source: body.source || "manual",
      notes: body.notes || null,
    })
    .returning();

  return NextResponse.json(benchmark, { status: 201 });
}
