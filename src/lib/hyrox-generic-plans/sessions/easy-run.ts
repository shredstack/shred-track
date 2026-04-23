import type { RenderContext, RenderedSession } from "./types";
import { easyPaceForPhase, easyRunMinutesForPhase } from "../calibration";

/**
 * Tuesday easy run. Volume grows through Phases 1–5, tapers in Phase 6.
 *
 * Relay tier drops volume ~20% (shorter race, different energy system).
 */
export function renderEasyRun(ctx: RenderContext, dayOfWeek: number): RenderedSession {
  const baseMinutes = easyRunMinutesForPhase(ctx.paceTier, ctx.phase.phaseNumber);
  const minutes = ctx.raceFormat === "relay" ? Math.round(baseMinutes * 0.8) : baseMinutes;
  const easyPace = easyPaceForPhase(ctx.paceTier, ctx.phase.phaseNumber);
  // Show a ±15 sec/km band so athletes don't stress the exact number
  const paceRange: [number, number] = [easyPace - 15, easyPace + 15];

  const description =
    ctx.raceFormat === "relay"
      ? `${minutes} min truly conversational running. Relay training keeps aerobic volume modest — save the sharp edges for interval days.`
      : `${minutes} min truly conversational running. If you can't speak in full sentences, slow down.`;

  return {
    dayOfWeek,
    orderInDay: 1,
    sessionType: "run",
    title: "Easy Run",
    description,
    paceSpec: { kind: "run_per_km", seconds: easyPace, range: paceRange },
    durationMinutes: minutes,
    sessionDetail: {
      warmup: "2–3 min walk or easy jog, a few leg swings.",
      blocks: [
        {
          label: "Main",
          movements: [
            {
              name: `${minutes} min Easy Run`,
              paceSpec: { kind: "run_per_km", seconds: easyPace, range: paceRange },
              notes: "Heart rate stays in Zone 2. You should finish feeling like you could do another 10 minutes.",
            },
          ],
        },
      ],
      cooldown: "5 min walk. Light hamstring + calf stretch.",
      coachNotes:
        "CrossFit instincts will push you faster. Resist. This pace feels embarrassingly slow and that is the point.",
      estimatedDuration: minutes + 10,
    },
    equipmentRequired: ["running_shoes"],
  };
}
