import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { generateHyroxPlan } from "@/inngest/functions/generate-hyrox-plan";
import { regenerateWeek } from "@/inngest/functions/regenerate-week";
import { generateRaceReport } from "@/inngest/functions/generate-race-report";
import { recalibratePlan } from "@/inngest/functions/recalibrate-plan";
import { extractScoreNotes } from "@/inngest/functions/extract-score-notes";
import { notifyReactionCreated } from "@/inngest/functions/notify-reaction-created";
import {
  notifyCommentCreated,
  notifyCommentMentioned,
} from "@/inngest/functions/notify-comment-created";

// Each Inngest step runs as a separate Vercel function invocation.
// Vercel Pro allows up to 300s per invocation. Each step makes one Claude
// API call (240s timeout) + DB write, well within this limit.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    generateHyroxPlan,
    regenerateWeek,
    generateRaceReport,
    recalibratePlan,
    extractScoreNotes,
    notifyReactionCreated,
    notifyCommentCreated,
    notifyCommentMentioned,
  ],
});
