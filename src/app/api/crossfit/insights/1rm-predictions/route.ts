import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { estimate1RMForUser } from "@/lib/crossfit/insights/predicted-1rm";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await estimate1RMForUser(user.id);
  return NextResponse.json(result);
}
