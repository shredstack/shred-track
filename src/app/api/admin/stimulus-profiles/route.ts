import { NextRequest, NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import {
  stimulusProfiles,
  STIMULUS_CLASSES,
  type StimulusClass,
} from "@/db/schema";
import { getAdminAccess } from "@/lib/admin/access";

// GET /api/admin/stimulus-profiles
//
// Lists every (stimulus_class, movement_category) row. Super admin only —
// these bands govern the suggested-weight engine across the whole product.
export async function GET() {
  const access = await getAdminAccess();
  if (!access || !access.isSuperAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await db
    .select()
    .from(stimulusProfiles)
    .orderBy(
      asc(stimulusProfiles.stimulusClass),
      asc(stimulusProfiles.movementCategory)
    );

  return NextResponse.json({
    profiles: rows.map((r) => ({
      stimulusClass: r.stimulusClass as StimulusClass,
      movementCategory: r.movementCategory,
      pct1rmLow: Number(r.pct1rmLow),
      pct1rmHigh: Number(r.pct1rmHigh),
      notes: r.notes,
      updatedAt: r.updatedAt,
    })),
    stimulusClasses: STIMULUS_CLASSES,
  });
}

// PUT /api/admin/stimulus-profiles
//
// Upserts a single (stimulus_class, movement_category) band. Body:
//   { stimulusClass, movementCategory, pct1rmLow, pct1rmHigh, notes? }
//
// pct values must be in (0, 1] and pct1rmLow ≤ pct1rmHigh. The DB enforces
// the same; the early validation is for nicer error messages.
export async function PUT(req: NextRequest) {
  const access = await getAdminAccess();
  if (!access || !access.isSuperAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const stimulusClass = String(body?.stimulusClass ?? "").trim();
  const movementCategory = String(body?.movementCategory ?? "").trim();
  const pctLow = Number(body?.pct1rmLow);
  const pctHigh = Number(body?.pct1rmHigh);
  const notes = body?.notes != null ? String(body.notes) : null;

  if (!STIMULUS_CLASSES.includes(stimulusClass as StimulusClass)) {
    return NextResponse.json(
      { error: "Invalid stimulusClass" },
      { status: 400 }
    );
  }
  if (!movementCategory) {
    return NextResponse.json(
      { error: "movementCategory is required" },
      { status: 400 }
    );
  }
  if (
    !Number.isFinite(pctLow) ||
    !Number.isFinite(pctHigh) ||
    pctLow <= 0 ||
    pctHigh <= 0 ||
    pctLow > 1 ||
    pctHigh > 1
  ) {
    return NextResponse.json(
      { error: "pct1rmLow / pct1rmHigh must be in (0, 1]" },
      { status: 400 }
    );
  }
  if (pctLow > pctHigh) {
    return NextResponse.json(
      { error: "pct1rmLow must be ≤ pct1rmHigh" },
      { status: 400 }
    );
  }

  await db
    .insert(stimulusProfiles)
    .values({
      stimulusClass,
      movementCategory,
      pct1rmLow: pctLow.toString(),
      pct1rmHigh: pctHigh.toString(),
      notes,
    })
    .onConflictDoUpdate({
      target: [
        stimulusProfiles.stimulusClass,
        stimulusProfiles.movementCategory,
      ],
      set: {
        pct1rmLow: pctLow.toString(),
        pct1rmHigh: pctHigh.toString(),
        notes,
        updatedAt: new Date(),
      },
    });

  return NextResponse.json({ ok: true });
}
