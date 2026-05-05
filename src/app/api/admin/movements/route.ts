import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { movements, users } from "@/db/schema";
import { ilike, asc, eq, and, type SQL } from "drizzle-orm";
import { getAdminUser } from "@/lib/admin";

// GET /api/admin/movements — list all movements (admin only).
// Optional filters: ?search=&category=&status=pending|validated|all (default all)
export async function GET(req: NextRequest) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const search = req.nextUrl.searchParams.get("search");
  const category = req.nextUrl.searchParams.get("category");
  const status = req.nextUrl.searchParams.get("status");

  const filters: SQL[] = [];
  if (search) filters.push(ilike(movements.canonicalName, `%${search}%`));
  if (category) filters.push(eq(movements.category, category));
  if (status === "pending") filters.push(eq(movements.isValidated, false));
  if (status === "validated") filters.push(eq(movements.isValidated, true));

  const rows = await db
    .select({
      id: movements.id,
      canonicalName: movements.canonicalName,
      category: movements.category,
      isWeighted: movements.isWeighted,
      is1rmApplicable: movements.is1rmApplicable,
      metricType: movements.metricType,
      supportedMetricTypes: movements.supportedMetricTypes,
      rxFields: movements.rxFields,
      rxDefaults: movements.rxDefaults,
      commonRxWeightMale: movements.commonRxWeightMale,
      commonRxWeightFemale: movements.commonRxWeightFemale,
      videoUrl: movements.videoUrl,
      createdBy: movements.createdBy,
      isValidated: movements.isValidated,
      createdAt: movements.createdAt,
      createdByEmail: users.email,
      createdByName: users.name,
    })
    .from(movements)
    .leftJoin(users, eq(users.id, movements.createdBy))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(asc(movements.canonicalName));

  return NextResponse.json(rows);
}

// POST /api/admin/movements — create a new movement (admin only)
export async function POST(req: NextRequest) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const {
    canonicalName,
    category,
    isWeighted,
    is1rmApplicable,
    commonRxWeightMale,
    commonRxWeightFemale,
    videoUrl,
    metricType,
    supportedMetricTypes,
    rxFields,
    rxDefaults,
  } = body;

  const trimmedName = canonicalName?.trim();
  if (!trimmedName) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (!category) {
    return NextResponse.json({ error: "Category is required" }, { status: 400 });
  }

  try {
    const [movement] = await db
      .insert(movements)
      .values({
        canonicalName: trimmedName,
        category,
        isWeighted: isWeighted ?? false,
        is1rmApplicable: is1rmApplicable ?? false,
        commonRxWeightMale: commonRxWeightMale?.toString() || null,
        commonRxWeightFemale: commonRxWeightFemale?.toString() || null,
        videoUrl: videoUrl || null,
        isValidated: true,
        ...(typeof metricType === "string" ? { metricType } : {}),
        ...(Array.isArray(supportedMetricTypes) && supportedMetricTypes.length > 0
          ? { supportedMetricTypes }
          : {}),
        ...(Array.isArray(rxFields) ? { rxFields } : {}),
        ...(rxDefaults && typeof rxDefaults === "object"
          ? { rxDefaults }
          : {}),
      })
      .returning();

    return NextResponse.json(movement, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("unique")) {
      return NextResponse.json(
        { error: "A movement with this name already exists" },
        { status: 409 }
      );
    }
    throw err;
  }
}
