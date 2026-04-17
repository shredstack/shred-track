import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { generateHyroxPlan } from "@/inngest/functions/generate-hyrox-plan";
import { regenerateWeek } from "@/inngest/functions/regenerate-week";

// Each Inngest step runs as a separate Vercel function invocation.
// Claude API calls (especially 16K-token week batches) can take 30-60+ seconds,
// so we need a longer timeout than the default 10s/60s.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [generateHyroxPlan, regenerateWeek],
});
