"use client";

// arnold-copy.ts — opt-in Schwarzenegger-flavored notification copy.
//
// The iOS local-notification system can't change the system TTS voice
// for spoken push delivery, so this only changes the *text*. Keep
// references playful (no political stuff, no quoting full lines from
// films). When in doubt, lean motivational coach > parody.

export interface ArnoldBriefInput {
  hyrox?: string;        // e.g. "Threshold Run (Wk 4 Build)"
  hyroxRest: boolean;
  crossfit?: string;     // WOD title
  recovery?: string;     // mobility / recovery name
}

const ARNOLD_BRIEF_TITLES = [
  "Time to train, champion",
  "GET TO THE CHOPPA",
  "Hear me now",
];

export function arnoldBriefTitle(): string {
  return ARNOLD_BRIEF_TITLES[0];
}

export function arnoldBriefBody(input: ArnoldBriefInput): string | null {
  const parts: string[] = [];
  if (input.hyroxRest) {
    parts.push("Rest day. Even Conan sleeps.");
  } else if (input.hyrox) {
    parts.push(`HYROX: ${input.hyrox}. No pain, no gain.`);
  }
  if (input.crossfit) {
    parts.push(`WOD: ${input.crossfit}. Crush it.`);
  }
  if (input.recovery) {
    parts.push(`Mobility: ${input.recovery}. Steel needs oil.`);
  }
  if (parts.length === 0) return null;
  return parts.join(" • ");
}

export interface ArnoldNudgeInput {
  primary: string; // best label for the unlogged thing
}

export function arnoldMiddayNudgeTitle(): string {
  return "Log it. Now.";
}

export function arnoldMiddayNudgeBody({ primary }: ArnoldNudgeInput): string {
  return `Listen up — you haven't logged ${primary} yet. Stop whining. Open ShredTrack.`;
}

export function arnoldCrossfitLogNudgeTitle(): string {
  return "Where is your score?";
}

export function arnoldCrossfitLogNudgeBody({
  primary,
}: ArnoldNudgeInput): string {
  return `${primary} is not logged. Don't make me come over there. Open ShredTrack — log it.`;
}
