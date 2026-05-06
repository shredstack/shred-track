import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  recoveryMovements,
  recoveryMovementVideos,
  recoveryMovementGymOverrides,
  communityMemberships,
} from "@/db/schema";
import { and, eq, ilike, or, isNull, sql, inArray } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { isSuperAdmin, canProgramForGym } from "@/lib/authz/community";
import { slugify, RECOVERY_CATEGORIES, type RecoveryCategory } from "@/types/recovery";

// GET /api/recovery/movements
// Visible movements for the caller. Returns each movement enriched with the
// notes override for the caller's active gym (when applicable) and the
// number of videos the caller can see.
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const search = req.nextUrl.searchParams.get("q");
  const category = req.nextUrl.searchParams.get("category");
  const pendingOnly = req.nextUrl.searchParams.get("pending") === "true";
  const mineOnly = req.nextUrl.searchParams.get("mine") === "true";
  const bodyRegion = req.nextUrl.searchParams.get("bodyRegion");

  const visibilityCondition = or(
    eq(recoveryMovements.isValidated, true),
    eq(recoveryMovements.createdBy, user.id)
  )!;

  const filters = [visibilityCondition];
  if (search) filters.push(ilike(recoveryMovements.canonicalName, `%${search}%`));
  if (category) filters.push(eq(recoveryMovements.category, category));
  if (pendingOnly) filters.push(eq(recoveryMovements.isValidated, false));
  if (mineOnly) filters.push(eq(recoveryMovements.createdBy, user.id));
  if (bodyRegion) {
    filters.push(sql`${recoveryMovements.bodyRegion} @> ARRAY[${bodyRegion}]::text[]`);
  }

  const rows = await db
    .select()
    .from(recoveryMovements)
    .where(and(...filters))
    .orderBy(recoveryMovements.canonicalName);

  if (rows.length === 0) return NextResponse.json([]);

  // Fetch the caller's active gym membership ids — used to count visible
  // videos and to pick up gym notes overrides.
  const memberships = await db
    .select({ communityId: communityMemberships.communityId })
    .from(communityMemberships)
    .where(
      and(eq(communityMemberships.userId, user.id), eq(communityMemberships.isActive, true))
    );
  const myGyms = memberships.map((m) => m.communityId);

  const ids = rows.map((r) => r.id);

  // Notes overrides for any of the caller's gyms.
  const overrides = myGyms.length
    ? await db
        .select()
        .from(recoveryMovementGymOverrides)
        .where(
          and(
            inArray(recoveryMovementGymOverrides.movementId, ids),
            inArray(recoveryMovementGymOverrides.communityId, myGyms)
          )
        )
    : [];
  const overrideByMovement = new Map(overrides.map((o) => [o.movementId, o.notesOverride]));

  // Video counts per movement, filtered by visibility for this caller.
  const videoRows = await db
    .select({
      id: recoveryMovementVideos.id,
      movementId: recoveryMovementVideos.movementId,
      visibility: recoveryMovementVideos.visibility,
      communityId: recoveryMovementVideos.communityId,
    })
    .from(recoveryMovementVideos)
    .where(inArray(recoveryMovementVideos.movementId, ids));
  const videoCount = new Map<string, number>();
  for (const v of videoRows) {
    const visibleToCaller =
      v.visibility === "public" ||
      (v.visibility === "gym" && v.communityId && myGyms.includes(v.communityId));
    if (visibleToCaller) {
      videoCount.set(v.movementId, (videoCount.get(v.movementId) ?? 0) + 1);
    }
  }

  return NextResponse.json(
    rows.map((r) => ({
      ...r,
      notesOverride: overrideByMovement.get(r.id) ?? null,
      videoCount: videoCount.get(r.id) ?? 0,
      isOwnSubmission: r.createdBy === user.id,
    }))
  );
}

// POST /api/recovery/movements — create a new movement.
// Coaches/admins/super-admins create with is_validated=true. Members create
// with is_validated=false (pending validation).
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

  const category =
    typeof body.category === "string" &&
    (RECOVERY_CATEGORIES as readonly string[]).includes(body.category)
      ? (body.category as RecoveryCategory)
      : "other";
  const bodyRegion = Array.isArray(body.bodyRegion)
    ? body.bodyRegion.filter((b: unknown): b is string => typeof b === "string")
    : [];
  const description = typeof body.description === "string" ? body.description : null;
  const isPerSide = !!body.isPerSide;
  const defaultPrescription =
    body.defaultPrescription && typeof body.defaultPrescription === "object"
      ? body.defaultPrescription
      : {};

  // Pre-empt clashes with system rows so users can't shadow a canonical name.
  const [systemClash] = await db
    .select({ id: recoveryMovements.id })
    .from(recoveryMovements)
    .where(
      and(
        sql`LOWER(${recoveryMovements.canonicalName}) = LOWER(${canonicalName})`,
        isNull(recoveryMovements.createdBy)
      )
    )
    .limit(1);
  if (systemClash) {
    return NextResponse.json(
      { error: "A movement with this name already exists", movementId: systemClash.id },
      { status: 409 }
    );
  }

  // Determine validation: coaches/admins/super-admin auto-validate. We treat
  // any active coach/admin role in any of the user's gyms as enough.
  let isValidated = false;
  if (await isSuperAdmin(user.id)) {
    isValidated = true;
  } else {
    const memberships = await db
      .select()
      .from(communityMemberships)
      .where(
        and(
          eq(communityMemberships.userId, user.id),
          eq(communityMemberships.isActive, true)
        )
      );
    const elevated = memberships.find((m) => m.isAdmin || m.isCoach);
    if (elevated) {
      isValidated = await canProgramForGym(user.id, elevated.communityId);
    }
  }

  try {
    const [movement] = await db
      .insert(recoveryMovements)
      .values({
        canonicalName,
        slug: slugify(canonicalName),
        category,
        bodyRegion,
        description,
        defaultPrescription,
        isPerSide,
        isValidated,
        createdBy: user.id,
      })
      .returning();

    return NextResponse.json(movement, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("unique") || message.includes("duplicate")) {
      const [existing] = await db
        .select()
        .from(recoveryMovements)
        .where(
          and(
            eq(recoveryMovements.canonicalName, canonicalName),
            eq(recoveryMovements.createdBy, user.id)
          )
        )
        .limit(1);
      if (existing) return NextResponse.json(existing, { status: 200 });
      return NextResponse.json({ error: "Movement already exists" }, { status: 409 });
    }
    throw err;
  }
}
