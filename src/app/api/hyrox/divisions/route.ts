import { NextResponse } from "next/server";
import { db } from "@/db";
import { hyroxDivisions, hyroxDivisionStations } from "@/db/schema";
import { eq } from "drizzle-orm";

// GET /api/hyrox/divisions — list all divisions with station specs
export async function GET() {
  const divisions = await db
    .select()
    .from(hyroxDivisions)
    .orderBy(hyroxDivisions.displayOrder);

  const result = await Promise.all(
    divisions.map(async (div) => {
      const stations = await db
        .select()
        .from(hyroxDivisionStations)
        .where(eq(hyroxDivisionStations.divisionId, div.id));

      return { ...div, stations };
    })
  );

  return NextResponse.json(result);
}
