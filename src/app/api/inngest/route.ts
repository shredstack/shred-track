import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { generateHyroxPlan } from "@/inngest/functions/generate-hyrox-plan";
import { regenerateWeek } from "@/inngest/functions/regenerate-week";
import { generateRaceReport } from "@/inngest/functions/generate-race-report";
import { recalibratePlan } from "@/inngest/functions/recalibrate-plan";

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
  ],
});
