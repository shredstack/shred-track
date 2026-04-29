import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { computeDomainProfile } from "@/lib/crossfit/insights/domain-profile";
import {
  countUserScores,
  readCachedDomainProfile,
  writeCachedDomainProfile,
} from "@/lib/crossfit/insights/cache";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const liveScoreCount = await countUserScores(user.id);

  const cached = await readCachedDomainProfile(user.id, liveScoreCount);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "x-cache": "hit" },
    });
  }

  const profile = await computeDomainProfile(user.id);
  await writeCachedDomainProfile(user.id, profile, liveScoreCount);

  return NextResponse.json(profile, {
    headers: { "x-cache": "miss" },
  });
}
