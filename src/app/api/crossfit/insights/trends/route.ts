import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/session";
import { computeTrends } from "@/lib/crossfit/insights/trends";

const MIN_VOLUME_WEEKS = 4;
const MAX_VOLUME_WEEKS = 52;

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = req.nextUrl.searchParams.get("weeks");
  const parsed = raw ? parseInt(raw, 10) : NaN;
  const volumeWeeks =
    Number.isFinite(parsed) &&
    parsed >= MIN_VOLUME_WEEKS &&
    parsed <= MAX_VOLUME_WEEKS
      ? parsed
      : undefined;

  const result = await computeTrends(user.id, { volumeWeeks });
  return NextResponse.json(result);
}
