import { NextRequest, NextResponse } from "next/server";
import { getComparisons } from "@/lib/insights/queries";
import { divisionSchema } from "@/lib/insights/validation";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const divisionResult = divisionSchema.safeParse(params.get("division"));
  if (!divisionResult.success) {
    return NextResponse.json(
      { error: "Invalid division. Must be one of: men_open, women_open, men_pro, women_pro" },
      { status: 400 },
    );
  }

  const eventId = params.get("eventId");
  if (!eventId || !z.string().uuid().safeParse(eventId).success) {
    return NextResponse.json(
      { error: "eventId is required and must be a valid UUID" },
      { status: 400 },
    );
  }

  const data = await getComparisons(divisionResult.data, eventId);
  return NextResponse.json(data);
}
