import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db } from "@/db";
import { hyroxRaceTemplates } from "@/db/schema";
import { and, eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// DELETE — remove a saved template owned by the current user.
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const deleted = await db
    .delete(hyroxRaceTemplates)
    .where(
      and(
        eq(hyroxRaceTemplates.id, id),
        eq(hyroxRaceTemplates.userId, user.id),
      ),
    )
    .returning({ id: hyroxRaceTemplates.id });

  if (deleted.length === 0) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
