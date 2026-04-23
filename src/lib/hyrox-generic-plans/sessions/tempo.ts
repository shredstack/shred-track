import type { RenderContext, RenderedSession } from "./types";
import {
  easyPaceForPhase,
  tempoPaceForPhase,
  tempoBlockMinutesForPhase,
} from "../calibration";

/**
 * Thursday tempo / race-pace run.
 *
 * Structure: 10 min easy → [tempo block] → 10 min easy. Tempo block length
 * grows through Phases 1–4, holds in Phase 5 (now called "Race Pace Run"
 * in copy), and shortens in Phase 6 taper.
 *
 * Relay tier: replace tempo with VO2-max-style 3–5 min intervals starting
 * in Phase 3. Shorter total volume, higher intensity — closer to relay
 * race demand.
 */
export function renderTempo(ctx: RenderContext, dayOfWeek: number): RenderedSession {
  if (ctx.raceFormat === "relay" && ctx.phase.phaseNumber >= 3) {
    return renderVo2Intervals(ctx, dayOfWeek);
  }
  return renderStandardTempo(ctx, dayOfWeek);
}

function renderStandardTempo(ctx: RenderContext, dayOfWeek: number): RenderedSession {
  const tempoPace = tempoPaceForPhase(ctx.paceTier, ctx.phase.phaseNumber);
  const easyPace = easyPaceForPhase(ctx.paceTier, ctx.phase.phaseNumber);
  const tempoMinutes = tempoBlockMinutesForPhase(ctx.paceTier, ctx.phase.phaseNumber);
  const warmupMinutes = ctx.phase.phaseNumber <= 2 ? 8 : 10;
  const cooldownMinutes = warmupMinutes;

  const title =
    ctx.phase.phaseNumber >= 5 ? "Race Pace Run" : "Tempo Run";
  const description =
    ctx.phase.phaseNumber >= 5
      ? `${warmupMinutes} min easy → ${tempoMinutes} min @ race pace → ${cooldownMinutes} min easy. This is how race-day running should feel: controlled but committed.`
      : `${warmupMinutes} min easy → ${tempoMinutes} min tempo → ${cooldownMinutes} min easy. Tempo is comfortably hard, not a race effort.`;

  return {
    dayOfWeek,
    orderInDay: 1,
    sessionType: "run",
    title,
    description,
    paceSpec: { kind: "run_per_km", seconds: tempoPace },
    durationMinutes: warmupMinutes + tempoMinutes + cooldownMinutes,
    sessionDetail: {
      warmup: `${warmupMinutes} min easy + 3×20m strides`,
      blocks: [
        {
          label: "Warmup",
          movements: [
            {
              name: `${warmupMinutes} min Easy`,
              paceSpec: { kind: "run_per_km", seconds: easyPace },
            },
          ],
        },
        {
          label: ctx.phase.phaseNumber >= 5 ? "Race Pace" : "Tempo",
          movements: [
            {
              name: `${tempoMinutes} min ${ctx.phase.phaseNumber >= 5 ? "Race Pace" : "Tempo"}`,
              paceSpec: { kind: "run_per_km", seconds: tempoPace },
              notes: ctx.phase.phaseNumber >= 5
                ? "You should be able to speak in 2–3 word chunks. Not all-out."
                : "Feel it in your legs and lungs but stay in control. If you're gasping, ease off.",
            },
          ],
        },
        {
          label: "Cooldown",
          movements: [
            {
              name: `${cooldownMinutes} min Easy`,
              paceSpec: { kind: "run_per_km", seconds: easyPace },
            },
          ],
        },
      ],
      cooldown: "Walk 3 min. Quad + hamstring stretch.",
      coachNotes:
        "Build the tempo block over the phases — this is the single most valuable session for HYROX running.",
      estimatedDuration: warmupMinutes + tempoMinutes + cooldownMinutes + 5,
    },
    equipmentRequired: ["running_shoes"],
  };
}

function renderVo2Intervals(ctx: RenderContext, dayOfWeek: number): RenderedSession {
  // Relay-specific: 4–5 × 3-min intervals at faster-than-tempo, full recovery
  const tempoPace = tempoPaceForPhase(ctx.paceTier, ctx.phase.phaseNumber);
  const vo2Pace = Math.max(tempoPace - 20, 150); // ~20 sec/km faster than tempo
  const easyPace = easyPaceForPhase(ctx.paceTier, ctx.phase.phaseNumber);
  const reps =
    ctx.phase.phaseNumber === 3 ? 4
      : ctx.phase.phaseNumber === 4 ? 5
      : ctx.phase.phaseNumber === 5 ? 5
      : 3; // Phase 6 taper

  return {
    dayOfWeek,
    orderInDay: 1,
    sessionType: "run",
    title: "VO2-Max Intervals",
    description: `${reps} × 3 min hard with 2 min walk-jog recovery. Relay race pace demands are closer to 5K effort than HYROX singles tempo.`,
    paceSpec: { kind: "run_per_km", seconds: vo2Pace },
    durationMinutes: 10 + reps * 5 + 10,
    sessionDetail: {
      warmup: "10 min easy + 4×20m strides",
      blocks: [
        {
          label: "Main",
          movements: [
            {
              name: `${reps} × 3 min Hard`,
              paceSpec: { kind: "run_per_km", seconds: vo2Pace },
              restSeconds: 120,
              notes: "Recovery is easy jog or walk — fully recover before the next effort.",
            },
          ],
        },
      ],
      cooldown: "10 min easy + light stretching",
      coachNotes: `Easy-jog recovery @ ≈${Math.round(easyPace / 60)}:${String(easyPace % 60).padStart(2, "0")}/km between efforts. Don't short-change the recovery — it's what lets the next interval land.`,
      estimatedDuration: 10 + reps * 5 + 10,
    },
    equipmentRequired: ["running_shoes"],
  };
}
