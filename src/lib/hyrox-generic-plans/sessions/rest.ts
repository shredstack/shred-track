import type { RenderContext, RenderedSession } from "./types";

/**
 * Friday (light / optional mobility) or Sunday (full rest). Both render as
 * session_type='rest'; the only differences are copy and duration.
 */
export function renderRestOrLight(
  _ctx: RenderContext,
  dayOfWeek: number,
  flavor: "friday_light" | "sunday_rest",
): RenderedSession {
  if (flavor === "sunday_rest") {
    return {
      dayOfWeek,
      orderInDay: 1,
      sessionType: "rest",
      title: "Rest",
      description: "Full rest day. Sleep, eat, move gently if you want to.",
      paceSpec: null,
      durationMinutes: 0,
      sessionDetail: {
        blocks: [],
        coachNotes:
          "Recovery is where the training lands. Don't feel guilty about doing nothing today.",
        estimatedDuration: 0,
      },
      equipmentRequired: [],
    };
  }
  return {
    dayOfWeek,
    orderInDay: 1,
    sessionType: "rest",
    title: "Rest or Light Mobility",
    description:
      "Optional: 20 minutes of mobility, yoga, or an easy walk. Nothing that raises heart rate meaningfully.",
    paceSpec: null,
    durationMinutes: 20,
    sessionDetail: {
      blocks: [
        {
          label: "Optional mobility",
          movements: [
            {
              name: "Hip mobility flow",
              prescription: "5–10 minutes — 90/90, deep squat holds, couch stretch",
            },
            {
              name: "Thoracic mobility",
              prescription: "5 minutes — open books, cat-cow, foam roll upper back",
            },
            {
              name: "Easy walk",
              prescription: "10 minutes outdoors if the weather's good",
            },
          ],
        },
      ],
      coachNotes:
        "If you're feeling beaten up from CrossFit this week, skip the mobility and take a true rest day.",
      estimatedDuration: 20,
    },
    equipmentRequired: [],
  };
}

export function renderRaceDay(dayOfWeek: number): RenderedSession {
  return {
    dayOfWeek,
    orderInDay: 1,
    sessionType: "hyrox_day",
    title: "🏁 RACE DAY",
    description:
      "This is what you trained for. Execute your race plan: run smart, move briskly between stations, trust your taper.",
    paceSpec: null,
    durationMinutes: null,
    sessionDetail: {
      blocks: [
        {
          label: "Race",
          movements: [
            {
              name: "HYROX Race",
              prescription: "Full 8 × (1km + station). Your training is banked — trust it.",
              notes:
                "Hit the line with a plan. Don't blow out on Run 1 — most people regret it by Run 4.",
            },
          ],
        },
      ],
      coachNotes:
        "Ignore the athletes around you in the first heat. Stick to your paces. Celebrate hard afterwards.",
      estimatedDuration: 80,
    },
    equipmentRequired: ["race_kit"],
  };
}
