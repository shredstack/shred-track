import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { computeRxGap } from "@/lib/crossfit/insights/rx-gap";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = req.nextUrl.searchParams.get("windowDays");
  const parsed = raw ? parseInt(raw, 10) : NaN;
  const windowDays =
    Number.isFinite(parsed) && parsed >= 30 && parsed <= 730
      ? parsed
      : undefined;

  const result = await computeRxGap(user.id, { windowDays });
  return NextResponse.json(result);
}
