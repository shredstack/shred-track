import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { generateHyroxPlan } from "@/inngest/functions/generate-hyrox-plan";
import { regenerateWeek } from "@/inngest/functions/regenerate-week";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [generateHyroxPlan, regenerateWeek],
});
