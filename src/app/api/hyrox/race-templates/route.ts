import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db } from "@/db";
import {
  hyroxRaceTemplates,
  communityMemberships,
  users,
  type RaceTemplateSegment,
} from "@/db/schema";
import { and, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";

// ---------------------------------------------------------------------------
// GET — list templates the user can pick from.
//
// Returns:
//   { mine: RaceTemplate[],
//     gym: GymRaceTemplate[] }
//
// `mine` is every template owned by the user (private + ones the user
// chose to share). `gym` is templates shared with any community the user
// is an active member of, authored by other members. Coach-authored
// rows are flagged so the UI can pin/badge them.
// ---------------------------------------------------------------------------

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mine = await db
    .select()
    .from(hyroxRaceTemplates)
    .where(eq(hyroxRaceTemplates.userId, user.id))
    .orderBy(desc(hyroxRaceTemplates.createdAt));

  // Communities the user is an active member of — both for scoping the
  // gym list and for tagging which author is a coach in which gym.
  const myMemberships = await db
    .select({
      communityId: communityMemberships.communityId,
    })
    .from(communityMemberships)
    .where(
      and(
        eq(communityMemberships.userId, user.id),
        eq(communityMemberships.isActive, true),
      ),
    );

  const communityIds = myMemberships.map((m) => m.communityId);

  let gym: Array<{
    id: string;
    name: string;
    divisionKey: string | null;
    simulateRoxzone: boolean;
    segments: RaceTemplateSegment[];
    communityId: string;
    authorId: string;
    authorName: string;
    authorIsCoach: boolean;
    createdAt: string;
  }> = [];

  if (communityIds.length > 0) {
    const rows = await db
      .select({
        id: hyroxRaceTemplates.id,
        name: hyroxRaceTemplates.name,
        divisionKey: hyroxRaceTemplates.divisionKey,
        simulateRoxzone: hyroxRaceTemplates.simulateRoxzone,
        segments: hyroxRaceTemplates.segments,
        communityId: hyroxRaceTemplates.communityId,
        authorId: hyroxRaceTemplates.userId,
        authorName: users.name,
        authorIsCoach: communityMemberships.isCoach,
        createdAt: hyroxRaceTemplates.createdAt,
      })
      .from(hyroxRaceTemplates)
      .innerJoin(users, eq(users.id, hyroxRaceTemplates.userId))
      // Author must still be an active member of the gym the template is
      // shared with (matches the spirit of "members see members'
      // templates" — leaving the gym hides yours).
      .innerJoin(
        communityMemberships,
        and(
          eq(communityMemberships.userId, hyroxRaceTemplates.userId),
          eq(communityMemberships.communityId, hyroxRaceTemplates.communityId),
          eq(communityMemberships.isActive, true),
        ),
      )
      .where(
        and(
          isNotNull(hyroxRaceTemplates.communityId),
          inArray(hyroxRaceTemplates.communityId, communityIds),
          ne(hyroxRaceTemplates.userId, user.id),
        ),
      )
      .orderBy(
        // Coach-authored first, then newest first.
        desc(communityMemberships.isCoach),
        desc(hyroxRaceTemplates.createdAt),
      );

    gym = rows.map((r) => ({
      ...r,
      communityId: r.communityId!,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  return NextResponse.json({ mine, gym });
}

// ---------------------------------------------------------------------------
// POST — create a new template from the timer setup's current segments.
//
// When `communityId` is provided, the template is shared with that gym.
// The user must be an active member of the named community.
// ---------------------------------------------------------------------------

interface CreatePayload {
  name?: string;
  divisionKey?: string;
  simulateRoxzone?: boolean;
  segments?: RaceTemplateSegment[];
  communityId?: string | null;
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

  // If the caller wants to share with a gym, verify membership before writing.
  let communityId: string | null = null;
  if (body.communityId) {
    const [membership] = await db
      .select({ id: communityMemberships.id })
      .from(communityMemberships)
      .where(
        and(
          eq(communityMemberships.userId, user.id),
          eq(communityMemberships.communityId, body.communityId),
          eq(communityMemberships.isActive, true),
        ),
      )
      .limit(1);
    if (!membership) {
      return NextResponse.json(
        { error: "You're not an active member of that gym" },
        { status: 403 },
      );
    }
    communityId = body.communityId;
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
      communityId,
    })
    .returning();

  return NextResponse.json(row, { status: 201 });
}
