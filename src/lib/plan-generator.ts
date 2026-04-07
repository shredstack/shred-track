// ---------------------------------------------------------------------------
// HYROX Plan Generator — template-based 12-week plan
// ---------------------------------------------------------------------------

import {
  type DivisionKey,
  type StationName,
  STATION_ORDER,
  REFERENCE_TIMES,
  RUN_REFERENCE,
  RUN_SEGMENTS,
  formatTime,
} from "./hyrox-data";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OnboardingData {
  name: string;
  gender: "women" | "men";
  unit: "metric" | "imperial";
  division: DivisionKey;
  raceDate: string | null; // ISO date or null
  easyPace: number;   // seconds per km
  moderatePace: number;
  fastPace: number;
  hasExperience: boolean;
  raceCount: number;
  bestTime: number | null; // seconds
  stationConfidence: Record<StationName, number>; // 1-5
  stationCurrentTime: Record<StationName, number>; // seconds
  stationGoalTime: Record<StationName, number>;    // seconds
}

export type SessionType = "run" | "station" | "hyrox_class" | "rest";

export interface SessionTarget {
  label: string;
  value: string;
}

export interface PlanSession {
  id: string;
  weekNumber: number;
  dayOfWeek: number; // 0=Mon … 6=Sun
  dayLabel: string;
  type: SessionType;
  title: string;
  description: string;
  targets: SessionTarget[];
  techniqueCues: string[];
  status: "upcoming" | "completed" | "skipped" | "missed";
  loggedData?: Record<string, string | number>;
}

export interface PlanWeek {
  weekNumber: number;
  label: string;
  focus: string;
  sessions: PlanSession[];
}

export interface GeneratedPlan {
  id: string;
  athleteName: string;
  division: DivisionKey;
  totalWeeks: number;
  estimatedCurrentTime: number; // seconds
  goalTime: number;             // seconds
  weeks: PlanWeek[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function weeksUntil(dateStr: string | null): number {
  if (!dateStr) return 12;
  const diff = new Date(dateStr).getTime() - Date.now();
  const weeks = Math.max(4, Math.min(16, Math.ceil(diff / (7 * 24 * 60 * 60 * 1000))));
  return weeks;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ---------------------------------------------------------------------------
// Phase structure
// ---------------------------------------------------------------------------
type Phase = "base" | "build" | "peak" | "taper";

function getPhase(weekNum: number, total: number): Phase {
  const pct = weekNum / total;
  if (pct <= 0.33) return "base";
  if (pct <= 0.66) return "build";
  if (pct <= 0.88) return "peak";
  return "taper";
}

const PHASE_LABELS: Record<Phase, string> = {
  base: "Base Building",
  build: "Build Phase",
  peak: "Peak Performance",
  taper: "Race Taper",
};

// ---------------------------------------------------------------------------
// Session templates
// ---------------------------------------------------------------------------

function buildRunSession(
  weekNum: number,
  dayOfWeek: number,
  data: OnboardingData,
  phase: Phase,
  runIndex: number,
): PlanSession {
  // Scale paces by phase
  const phaseScale: Record<Phase, number> = { base: 1.0, build: 0.95, peak: 0.9, taper: 1.05 };
  const scale = phaseScale[phase];

  const runTypes = [
    {
      title: "Easy Run",
      desc: "Aerobic base builder at conversational pace",
      paceBase: data.easyPace,
      distKm: phase === "base" ? 5 : phase === "build" ? 6 : phase === "peak" ? 7 : 4,
      cues: ["Keep heart rate in Zone 2", "Nasal breathing if possible", "Relax shoulders"],
    },
    {
      title: "Tempo Run",
      desc: "Sustained effort at race-like intensity",
      paceBase: data.moderatePace,
      distKm: phase === "base" ? 4 : phase === "build" ? 5 : phase === "peak" ? 6 : 3,
      cues: ["Hold consistent splits", "Focus on strong arm drive", "Stay relaxed through the middle km"],
    },
    {
      title: "Interval Run",
      desc: "High-intensity intervals to build speed and lactate tolerance",
      paceBase: data.fastPace,
      distKm: 0, // intervals
      cues: ["Full recovery between reps", "Maintain form even when tired", "Drive knees forward"],
    },
  ];

  const template = runTypes[runIndex % runTypes.length];
  const adjustedPace = Math.round(template.paceBase * scale);

  const targets: SessionTarget[] = [];
  if (template.distKm > 0) {
    targets.push({ label: "Distance", value: `${template.distKm} km` });
    targets.push({ label: "Target Pace", value: `${formatTime(adjustedPace)} /km` });
  } else {
    // Intervals
    const reps = phase === "base" ? 4 : phase === "build" ? 6 : phase === "peak" ? 8 : 3;
    targets.push({ label: "Intervals", value: `${reps} × 400m` });
    targets.push({ label: "Target Pace", value: `${formatTime(adjustedPace)} /km` });
    targets.push({ label: "Rest", value: "90s between reps" });
  }

  return {
    id: uid(),
    weekNumber: weekNum,
    dayOfWeek,
    dayLabel: DAYS[dayOfWeek],
    type: "run",
    title: template.title,
    description: template.desc,
    targets,
    techniqueCues: template.cues,
    status: "upcoming",
  };
}

function buildStationSession(
  weekNum: number,
  dayOfWeek: number,
  data: OnboardingData,
  phase: Phase,
  stationIndex: number,
): PlanSession {
  const stationName = STATION_ORDER[stationIndex % STATION_ORDER.length];
  const refs = REFERENCE_TIMES[data.division][stationName];
  const confidence = data.stationConfidence[stationName] ?? 3;
  const currentTime = data.stationCurrentTime[stationName] ?? refs[1];
  const goalTime = data.stationGoalTime[stationName] ?? refs[1];

  // Progressive target: move from current toward goal over the plan
  const phaseProgress: Record<Phase, number> = { base: 0.2, build: 0.5, peak: 0.8, taper: 0.7 };
  const progress = phaseProgress[phase];
  const targetTime = Math.round(currentTime - (currentTime - goalTime) * progress);

  // Reps scale by confidence — lower confidence = more practice reps
  const repScale = Math.max(1, 4 - confidence + 1);

  const cuesByStation: Record<string, string[]> = {
    SkiErg: ["Drive with hips, not arms", "Keep core tight", "Full extension each pull"],
    "Sled Push": ["Stay low, drive through legs", "Short choppy steps", "Keep arms locked out"],
    "Sled Pull": ["Sit back into your hips", "Hand over hand, steady rhythm", "Brace your core"],
    "Broad Jump Burpees": ["Land soft, explode forward", "Minimize ground contact time", "Use arm swing for momentum"],
    Rowing: ["Legs-back-arms sequence", "Drive through heels", "Keep stroke rate 26-30"],
    "Farmers Carry": ["Shoulders packed down", "Short quick steps", "Grip hard, core tight"],
    "Sandbag Lunges": ["Keep torso upright", "Knee tracks over toes", "Breathe every rep"],
    "Wall Balls": ["Full depth squat", "Use leg drive to throw", "Catch and flow into next rep"],
  };

  return {
    id: uid(),
    weekNumber: weekNum,
    dayOfWeek,
    dayLabel: DAYS[dayOfWeek],
    type: "station",
    title: `${stationName} Finisher`,
    description: `Focused station work on ${stationName}. ${repScale > 2 ? "Extra volume to build proficiency." : "Maintain and sharpen technique."}`,
    targets: [
      { label: "Station", value: stationName },
      { label: "Target Time", value: formatTime(targetTime) },
      { label: "Sets", value: `${repScale}` },
    ],
    techniqueCues: cuesByStation[stationName] ?? ["Focus on form", "Steady pacing"],
    status: "upcoming",
  };
}

function buildHyroxClassSession(
  weekNum: number,
  dayOfWeek: number,
  phase: Phase,
): PlanSession {
  const classTypes: Record<Phase, { title: string; desc: string }> = {
    base: { title: "HYROX Foundations", desc: "Full walkthrough of all 8 stations at moderate intensity. Focus on transitions and pacing strategy." },
    build: { title: "HYROX Race Sim (Half)", desc: "Half-distance race simulation: 4 stations + 4 km run. Practice transitions and pacing." },
    peak: { title: "HYROX Full Sim", desc: "Full race simulation at target pace. Practice nutrition and mental strategy." },
    taper: { title: "HYROX Shakeout", desc: "Light run-through of stations at easy effort. Stay sharp without fatiguing." },
  };

  const ct = classTypes[phase];
  return {
    id: uid(),
    weekNumber: weekNum,
    dayOfWeek,
    dayLabel: DAYS[dayOfWeek],
    type: "hyrox_class",
    title: ct.title,
    description: ct.desc,
    targets: [
      { label: "Effort", value: phase === "taper" ? "Easy" : phase === "peak" ? "Race pace" : "Moderate" },
    ],
    techniqueCues: ["Practice smooth transitions", "Rehearse station order mentally"],
    status: "upcoming",
  };
}

function buildRestSession(weekNum: number, dayOfWeek: number): PlanSession {
  return {
    id: uid(),
    weekNumber: weekNum,
    dayOfWeek,
    dayLabel: DAYS[dayOfWeek],
    type: "rest",
    title: "Rest / Recovery",
    description: "Active recovery day. Light walking, stretching, or mobility work.",
    targets: [],
    techniqueCues: ["Foam roll any tight spots", "Hydrate well", "Get quality sleep"],
    status: "upcoming",
  };
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export function generatePlan(data: OnboardingData): GeneratedPlan {
  const totalWeeks = weeksUntil(data.raceDate);

  // Calculate estimated current and goal times
  const runRefs = RUN_REFERENCE[data.division];
  const currentRunPerKm = data.moderatePace;
  const totalCurrentRunTime = currentRunPerKm * RUN_SEGMENTS;
  const goalRunPerKm = Math.round(data.moderatePace * 0.9); // 10% improvement target
  const totalGoalRunTime = goalRunPerKm * RUN_SEGMENTS;

  let totalCurrentStationTime = 0;
  let totalGoalStationTime = 0;
  for (const station of STATION_ORDER) {
    totalCurrentStationTime += data.stationCurrentTime[station] ?? REFERENCE_TIMES[data.division][station][1];
    totalGoalStationTime += data.stationGoalTime[station] ?? REFERENCE_TIMES[data.division][station][0];
  }

  // Transition time estimate (30s between each of 16 transitions)
  const transitionTime = 16 * 30;
  const estimatedCurrentTime = totalCurrentRunTime + totalCurrentStationTime + transitionTime;
  const goalTime = totalGoalRunTime + totalGoalStationTime + Math.round(transitionTime * 0.8);

  const weeks: PlanWeek[] = [];

  for (let w = 1; w <= totalWeeks; w++) {
    const phase = getPhase(w, totalWeeks);
    const sessions: PlanSession[] = [];

    // Mon: Run 1 (easy)
    sessions.push(buildRunSession(w, 0, data, phase, 0));
    // Tue: Station finisher 1
    sessions.push(buildStationSession(w, 1, data, phase, (w - 1) * 2));
    // Wed: Run 2 (tempo)
    sessions.push(buildRunSession(w, 2, data, phase, 1));
    // Thu: Station finisher 2
    sessions.push(buildStationSession(w, 3, data, phase, (w - 1) * 2 + 1));
    // Fri: Rest
    sessions.push(buildRestSession(w, 4));
    // Sat: HYROX class / sim
    sessions.push(buildHyroxClassSession(w, 5, phase));
    // Sun: Run 3 (intervals or easy depending on phase)
    sessions.push(buildRunSession(w, 6, data, phase, phase === "taper" ? 0 : 2));

    weeks.push({
      weekNumber: w,
      label: `Week ${w}`,
      focus: PHASE_LABELS[phase],
      sessions,
    });
  }

  return {
    id: uid(),
    athleteName: data.name,
    division: data.division,
    totalWeeks,
    estimatedCurrentTime,
    goalTime,
    weeks,
    createdAt: new Date().toISOString(),
  };
}
