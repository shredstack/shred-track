// GET /api/gym/[id]/branding  — fetch the gym's branding (admin-or-coach)
// PUT /api/gym/[id]/branding  — update the gym's branding (admin-only)
//
// Per the CFD readiness spec §1.2. Validates that primary_color is #RRGGBB
// and that invite_url_slug matches /^[a-z0-9-]{2,32}$/ and isn't already
// taken by another gym.

import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { communities } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canAdminGym, canViewGym } from "@/lib/authz/community";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const SLUG_RE = /^[a-z0-9-]{2,32}$/;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId } = await params;

  if (!(await canViewGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [gym] = await db
    .select({
      id: communities.id,
      name: communities.name,
      logoUrl: communities.logoUrl,
      primaryColor: communities.primaryColor,
      brandAssets: communities.brandAssets,
      websiteUrl: communities.websiteUrl,
      inviteUrlSlug: communities.inviteUrlSlug,
      autoJoinViaLink: communities.autoJoinViaLink,
      gymTimezone: communities.gymTimezone,
    })
    .from(communities)
    .where(eq(communities.id, communityId))
    .limit(1);

  if (!gym) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(gym);
}

interface PutBody {
  logoUrl?: string | null;
  primaryColor?: string | null;
  websiteUrl?: string | null;
  inviteUrlSlug?: string | null;
  autoJoinViaLink?: boolean;
  gymTimezone?: string;
  brandAssets?: Record<string, unknown> | null;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId } = await params;

  if (!(await canAdminGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as PutBody | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (
    body.primaryColor !== undefined &&
    body.primaryColor !== null &&
    !HEX_COLOR_RE.test(body.primaryColor)
  ) {
    return NextResponse.json(
      { error: "primaryColor must be #RRGGBB" },
      { status: 400 }
    );
  }

  if (
    body.inviteUrlSlug !== undefined &&
    body.inviteUrlSlug !== null &&
    body.inviteUrlSlug !== "" &&
    !SLUG_RE.test(body.inviteUrlSlug)
  ) {
    return NextResponse.json(
      { error: "inviteUrlSlug must be 2-32 lowercase letters, digits, or dashes" },
      { status: 400 }
    );
  }

  // Slug uniqueness: caught by the unique index too, but a 400 with a
  // descriptive message reads better than a 500.
  if (body.inviteUrlSlug) {
    const [conflict] = await db
      .select({ id: communities.id })
      .from(communities)
      .where(
        and(
          eq(communities.inviteUrlSlug, body.inviteUrlSlug),
          ne(communities.id, communityId)
        )
      )
      .limit(1);
    if (conflict) {
      return NextResponse.json(
        { error: "That invite slug is already in use" },
        { status: 400 }
      );
    }
  }

  const updates: Partial<typeof communities.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (body.logoUrl !== undefined) updates.logoUrl = body.logoUrl;
  if (body.primaryColor !== undefined) updates.primaryColor = body.primaryColor;
  if (body.websiteUrl !== undefined) updates.websiteUrl = body.websiteUrl;
  if (body.inviteUrlSlug !== undefined)
    updates.inviteUrlSlug = body.inviteUrlSlug || null;
  if (body.autoJoinViaLink !== undefined)
    updates.autoJoinViaLink = body.autoJoinViaLink;
  if (body.gymTimezone !== undefined) updates.gymTimezone = body.gymTimezone;
  if (body.brandAssets !== undefined) updates.brandAssets = body.brandAssets;

  const [updated] = await db
    .update(communities)
    .set(updates)
    .where(eq(communities.id, communityId))
    .returning({
      id: communities.id,
      logoUrl: communities.logoUrl,
      primaryColor: communities.primaryColor,
      websiteUrl: communities.websiteUrl,
      inviteUrlSlug: communities.inviteUrlSlug,
      autoJoinViaLink: communities.autoJoinViaLink,
      gymTimezone: communities.gymTimezone,
      brandAssets: communities.brandAssets,
    });

  return NextResponse.json(updated);
}
