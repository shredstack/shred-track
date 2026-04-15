import { NextRequest, NextResponse } from "next/server";
import { getAverages } from "@/lib/insights/queries";
import { divisionSchema, eventIdSchema } from "@/lib/insights/validation";

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

  const eventIdResult = eventIdSchema.safeParse(params.get("eventId") || undefined);
  if (!eventIdResult.success) {
    return NextResponse.json({ error: "Invalid eventId format" }, { status: 400 });
  }

  const data = await getAverages(divisionResult.data, eventIdResult.data);
  return NextResponse.json(data);
}
