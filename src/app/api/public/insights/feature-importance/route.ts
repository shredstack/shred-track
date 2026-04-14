import { NextRequest, NextResponse } from "next/server";
import { getFeatureImportance } from "@/lib/insights/queries";
import { divisionSchema } from "@/lib/insights/validation";

export const revalidate = 3600;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const divisionResult = divisionSchema.safeParse(params.get("division"));
  if (!divisionResult.success) {
    return NextResponse.json(
      { error: "Invalid division. Must be one of: men_open, women_open, men_pro, women_pro" },
      { status: 400 },
    );
  }

  const data = await getFeatureImportance(divisionResult.data);
  if (!data) {
    return NextResponse.json(
      { error: "No trained model available for this division yet" },
      { status: 404 },
    );
  }

  return NextResponse.json(data);
}
