// GET  /api/admin/feature-flags — flag matrix + overrides, scoped to the caller
// POST /api/admin/feature-flags — upsert/clear a community or user override
//
// Two tiers (see src/lib/admin/access.ts):
//   - Super admin: full matrix — every flag, every gym, every override.
//   - Gym admin/coach: limited view — only `isGymAdminConfigurable` flags and
//     only their active gym. Defense-in-depth: the route filters the GET
//     payload and rejects POSTs outside that gym / those flags, so a gym
//     admin can't reach other gyms even by calling the API directly.

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { communities, users } from "@/db/schema";
import { getAdminAccess } from "@/lib/admin/access";
import { canManageGym } from "@/lib/authz/community";
import {
  getFlagAdminMatrix,
  getGymAdminFlagView,
  getFlagGate,
  setCommunityFlagOverride,
  setUserFlagOverride,
} from "@/lib/feature-flags";

export async function GET() {
  const access = await getAdminAccess();
  if (!access)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Super admins get the full per-gym matrix.
  if (access.isSuperAdmin) {
    const matrix = await getFlagAdminMatrix();
    const gyms = await db
      .select({ id: communities.id, name: communities.name })
      .from(communities)
      .orderBy(communities.name);

    return NextResponse.json({
      scope: "super",
      flags: matrix.flags,
      gyms,
      overrides: matrix.overrides,
    });
  }

  // Gym admin/coach: limited to their active gym + configurable flags.
  const [row] = await db
    .select({ activeCommunityId: users.activeCommunityId })
    .from(users)
    .where(eq(users.id, access.user.id))
    .limit(1);
  const activeCommunityId = row?.activeCommunityId ?? null;

  // Always return the list of configurable flags so the empty state can
  // still explain what's available; `gym` is null when there's nothing to
  // manage (no active gym, or the active gym isn't one they staff).
  const view = activeCommunityId
    ? await getGymAdminFlagView(activeCommunityId)
    : { flags: [], overrides: {} as Record<string, unknown> };

  if (!activeCommunityId || !(await canManageGym(access.user.id, activeCommunityId))) {
    return NextResponse.json({
      scope: "gym",
      gym: null,
      flags: view.flags,
      overrides: {},
    });
  }

  const [gym] = await db
    .select({ id: communities.id, name: communities.name })
    .from(communities)
    .where(eq(communities.id, activeCommunityId))
    .limit(1);

  return NextResponse.json({
    scope: "gym",
    gym: gym ?? null,
    flags: view.flags,
    overrides: view.overrides,
  });
}

interface SetOverrideBody {
  scope: "community" | "user";
  targetId: string;
  flagKey: string;
  // null = clear the override (fall back to default)
  value: unknown;
}

export async function POST(req: NextRequest) {
  const access = await getAdminAccess();
  if (!access)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as SetOverrideBody | null;
  if (
    !body ||
    !body.scope ||
    !body.targetId ||
    typeof body.flagKey !== "string"
  ) {
    return NextResponse.json(
      { error: "scope, targetId, flagKey are required" },
      { status: 400 }
    );
  }

  // Super admins may set any override (community or user, any flag).
  if (access.isSuperAdmin) {
    if (body.scope === "community") {
      await setCommunityFlagOverride(
        body.targetId,
        body.flagKey,
        body.value ?? null
      );
    } else if (body.scope === "user") {
      await setUserFlagOverride(body.targetId, body.flagKey, body.value ?? null);
    } else {
      return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  // Gym admin/coach: community scope only, their own gym only, and only
  // flags explicitly marked gym-admin-configurable.
  if (body.scope !== "community") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const canManage = await canManageGym(access.user.id, body.targetId);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const gate = await getFlagGate(body.flagKey);
  if (!gate || !gate.isPerGym || !gate.isGymAdminConfigurable) {
    return NextResponse.json(
      { error: "This feature can't be changed by gym admins" },
      { status: 403 }
    );
  }
  await setCommunityFlagOverride(body.targetId, body.flagKey, body.value ?? null);
  return NextResponse.json({ ok: true });
}
