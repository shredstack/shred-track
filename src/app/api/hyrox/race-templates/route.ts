import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db } from "@/db";
import { hyroxRaceTemplates, type RaceTemplateSegment } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// GET — list the current user's saved race templates, newest first.
// ---------------------------------------------------------------------------

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select()
    .from(hyroxRaceTemplates)
    .where(eq(hyroxRaceTemplates.userId, user.id))
    .orderBy(desc(hyroxRaceTemplates.createdAt));

  return NextResponse.json(rows);
}

// ---------------------------------------------------------------------------
// POST — create a new template from the timer setup's current segments.
// ---------------------------------------------------------------------------

interface CreatePayload {
  name?: string;
  divisionKey?: string;
  simulateRoxzone?: boolean;
  segments?: RaceTemplateSegment[];
}

const MAX_NAME_LENGTH = 60;
const MAX_SEGMENTS = 60;

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as CreatePayload;

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json(
      { error: "Template name is required" },
      { status: 400 },
    );
  }
  if (name.length > MAX_NAME_LENGTH) {
    return NextResponse.json(
      { error: `Template name must be ${MAX_NAME_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }
  if (!Array.isArray(body.segments) || body.segments.length === 0) {
    return NextResponse.json(
      { error: "At least one segment is required" },
      { status: 400 },
    );
  }
  if (body.segments.length > MAX_SEGMENTS) {
    return NextResponse.json(
      { error: `Templates are limited to ${MAX_SEGMENTS} segments` },
      { status: 400 },
    );
  }

  // Strip any client-side fields that aren't part of the stored shape
  // (e.g. the volatile `id` used as a React key) so JSONB stays clean.
  const segments: RaceTemplateSegment[] = body.segments.map((s) => ({
    segmentType: s.segmentType,
    label: s.label,
    ...(s.segmentSubtype ? { segmentSubtype: s.segmentSubtype } : {}),
    ...(s.distance ? { distance: s.distance } : {}),
    ...(typeof s.distanceMeters === "number"
      ? { distanceMeters: s.distanceMeters }
      : {}),
    ...(typeof s.reps === "number" ? { reps: s.reps } : {}),
    ...(typeof s.weightKg === "number" ? { weightKg: s.weightKg } : {}),
    ...(s.weightLabel ? { weightLabel: s.weightLabel } : {}),
  }));

  const [row] = await db
    .insert(hyroxRaceTemplates)
    .values({
      userId: user.id,
      name,
      divisionKey: body.divisionKey ?? null,
      simulateRoxzone: body.simulateRoxzone ?? false,
      segments,
    })
    .returning();

  return NextResponse.json(row, { status: 201 });
}
