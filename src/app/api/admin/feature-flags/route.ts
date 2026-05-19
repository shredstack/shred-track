// GET  /api/admin/feature-flags — list all flags + per-gym overrides + gyms
// POST /api/admin/feature-flags — upsert/clear a community or user override
//
// Super-admin only. Mirrors the pattern used by other admin tools (see
// /api/admin/gyms).

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { communities } from "@/db/schema";
import { getAdminUser } from "@/lib/admin";
import {
  getFlagAdminMatrix,
  setCommunityFlagOverride,
  setUserFlagOverride,
} from "@/lib/feature-flags";

export async function GET() {
  const admin = await getAdminUser();
  if (!admin)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const matrix = await getFlagAdminMatrix();
  const gyms = await db
    .select({ id: communities.id, name: communities.name })
    .from(communities)
    .orderBy(communities.name);

  return NextResponse.json({
    flags: matrix.flags,
    gyms,
    overrides: matrix.overrides,
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
  const admin = await getAdminUser();
  if (!admin)
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

  if (body.scope === "community") {
    await setCommunityFlagOverride(body.targetId, body.flagKey, body.value ?? null);
  } else if (body.scope === "user") {
    await setUserFlagOverride(body.targetId, body.flagKey, body.value ?? null);
  } else {
    return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
