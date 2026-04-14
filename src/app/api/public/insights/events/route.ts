import { NextResponse } from "next/server";
import { getEvents } from "@/lib/insights/queries";

export const revalidate = 3600;

export async function GET() {
  const events = await getEvents();
  return NextResponse.json(events);
}
