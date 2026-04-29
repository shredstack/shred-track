// ============================================
// Notes Extraction — Inngest cron
// ============================================
//
// Periodically pulls VIP users' un-extracted score notes through Claude and
// stores structured insights in `score_notes_extractions`. Schedule and
// per-user throughput are configurable via env so we can dial usage to
// actual cost.
//
// Env vars:
//   CROSSFIT_NOTES_CRON          cron expression (default "0 9 * * *" — daily 09:00 UTC)
//   CROSSFIT_NOTES_PER_USER_LIMIT max scores extracted per user per run (default 25)
//   CROSSFIT_NOTES_ENABLED       "true"/"false" — kill switch (default "true" in prod)
//   CROSSFIT_NOTES_MODEL         override Claude model id (default claude-sonnet-4-6)
//
// See claude_code_instructions/crossfit_smart_insights_spec.md §11.

import Anthropic from "@anthropic-ai/sdk";
import { inngest } from "../client";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  NOTES_MODEL_VERSION,
  extractNoteForScore,
  listScoresNeedingExtraction,
  saveExtraction,
} from "@/lib/crossfit/insights/notes-extraction";

const CRON_EXPRESSION =
  process.env.CROSSFIT_NOTES_CRON?.trim() || "0 9 * * *";

const PER_USER_LIMIT = (() => {
  const raw = process.env.CROSSFIT_NOTES_PER_USER_LIMIT;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0 && parsed <= 200) return parsed;
  return 25;
})();

// Inngest expects createFunction's trigger config object up front. We can't
// "disable" via a runtime check on the trigger itself — so the kill switch
// sits inside the handler. When false, the function still fires on schedule
// but no-ops immediately.
const ENABLED = process.env.CROSSFIT_NOTES_ENABLED?.toLowerCase() !== "false";

export const extractScoreNotes = inngest.createFunction(
  {
    id: "crossfit-extract-score-notes",
    retries: 1,
    triggers: [{ cron: CRON_EXPRESSION }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ step }: { step: any }) => {
    if (!ENABLED) {
      return { skipped: true, reason: "CROSSFIT_NOTES_ENABLED=false" };
    }

    // Step 1: list VIP users.
    const vipUsers = await step.run("list-vip-users", async () => {
      const rows = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.isVip, true));
      return rows;
    });

    if (vipUsers.length === 0) {
      return { vipUsers: 0, processed: 0 };
    }

    // Single Anthropic client across the run — system-prompt cache hits
    // benefit if multiple notes flow through the same connection.
    const summaries: Array<{
      userId: string;
      considered: number;
      extracted: number;
      errors: number;
    }> = [];

    for (const user of vipUsers) {
      // Each user is its own step — Inngest will retry just this user on
      // failure rather than re-running the whole batch.
      const summary = await step.run(`extract-${user.id}`, async () => {
        const candidates = await listScoresNeedingExtraction(
          user.id,
          NOTES_MODEL_VERSION,
          PER_USER_LIMIT
        );

        if (candidates.length === 0) {
          return {
            userId: user.id,
            considered: 0,
            extracted: 0,
            errors: 0,
          };
        }

        const client = new Anthropic({ maxRetries: 0 });
        let extracted = 0;
        let errors = 0;

        for (const note of candidates) {
          try {
            const { extraction, contentHash } = await extractNoteForScore(
              note,
              client
            );
            await saveExtraction(
              note.scoreId,
              extraction,
              NOTES_MODEL_VERSION,
              contentHash
            );
            extracted += 1;
          } catch (err) {
            errors += 1;
            console.warn(
              `[extract-score-notes] failed score ${note.scoreId}:`,
              err instanceof Error ? err.message : err
            );
          }
        }

        return {
          userId: user.id,
          considered: candidates.length,
          extracted,
          errors,
        };
      });

      summaries.push(summary);
    }

    return {
      vipUsers: vipUsers.length,
      processed: summaries.reduce((s, x) => s + x.extracted, 0),
      perUser: summaries,
    };
  }
);
