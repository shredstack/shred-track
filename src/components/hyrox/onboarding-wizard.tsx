"use client";

import { useState, useCallback, useEffect } from "react";
import {
  User,
  Flag,
  Activity,
  Trophy,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Settings2,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  DIVISIONS,
  STATION_ORDER,
  REFERENCE_TIMES,
  DIVISION_REF_DATA,
  estimatePercentile,
  formatPercentile,
  CONFIDENCE_LABELS,
  RACE_DIVISION_LABELS,
  RACE_DIVISION_KEYS,
  DIVISION_CATEGORIES,
  isTeamDivision,
  formatTime,
  formatLongTime,
  parseTimeToSeconds,
  parseLongTimeToSeconds,
  kgToLbs,
  type DivisionKey,
  type RaceDivisionKey,
  type Gender,
  type StationName,
} from "@/lib/hyrox-data";
import { TimeInput } from "@/components/shared/time-input";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EquipmentKey =
  | "skierg"
  | "rower"
  | "sled"
  | "sandbag"
  | "wall_ball_target"
  | "assault_bike"
  | "farmers_handles";

interface EquipmentItem {
  key: EquipmentKey;
  label: string;
  description: string;
}

const EQUIPMENT_LIST: EquipmentItem[] = [
  { key: "skierg", label: "SkiErg", description: "Concept2 SkiErg or equivalent pull-down machine" },
  { key: "rower", label: "Rower", description: "Concept2 rower or similar rowing ergometer" },
  { key: "sled", label: "Sled", description: "Push/pull sled with adjustable weight" },
  { key: "sandbag", label: "Sandbag", description: "Heavy sandbag for lunges (20kg / 10kg typical)" },
  { key: "wall_ball_target", label: "Wall Ball Target", description: "Wall ball with regulation-height target" },
  { key: "assault_bike", label: "Assault Bike", description: "Assault/Echo bike or air resistance bike" },
  { key: "farmers_handles", label: "Farmer's Handles", description: "Farmer's carry handles or heavy dumbbells" },
];

type TrainingPhilosophy = "conservative" | "moderate" | "aggressive";

interface WizardState {
  // Step 1 — Profile
  name: string;
  gender: Gender;
  unit: "metric" | "mixed";
  // Step 2 — Race Details
  raceDate: string;
  division: DivisionKey;
  noRaceYet: boolean;
  goalFinishTime: string;
  // Step 3 — Running Assessment
  easyPace: string;
  moderatePace: string;
  fastPace: string;
  recent5kTime: string;
  recent800mRepeat: string;
  // Step 4 — HYROX Experience
  hasExperience: boolean;
  raceCount: string;
  bestTime: string;
  bestDivision: RaceDivisionKey;
  bestTimeNotes: string;
  // Step 5 — Station Assessment
  stationConfidence: Record<StationName, number>;
  stationCurrentTime: Record<StationName, number>;
  stationGoalTime: Record<StationName, number>;
  // Step 6 — Training Preferences
  crossfitDaysPerWeek: number;
  gymName: string;
  equipment: Record<EquipmentKey, boolean>;
  injuryNotes: string;
  trainingPhilosophy: TrainingPhilosophy;
}

const STEPS = [
  { label: "Profile", icon: User },
  { label: "Race", icon: Flag },
  { label: "Running", icon: Activity },
  { label: "Experience", icon: Trophy },
  { label: "Stations", icon: BarChart3 },
  { label: "Preferences", icon: Settings2 },
  { label: "Summary", icon: CheckCircle2 },
];

/** Convert a kg weight label to lbs, handling "2×16 kg" style labels */
function convertWeightLabel(label: string): string {
  return label.replace(/([\d.]+)\s*kg/g, (_, num) => `${kgToLbs(parseFloat(num))} lbs`);
}

function getInitialStationTimes(division: DivisionKey): {
  current: Record<StationName, number>;
  goal: Record<StationName, number>;
} {
  const refs = REFERENCE_TIMES[division];
  const current = {} as Record<StationName, number>;
  const goal = {} as Record<StationName, number>;
  for (const s of STATION_ORDER) {
    const r = refs?.[s];
    current[s] = r ? r[1] : 300; // average (fallback 5min)
    goal[s] = r ? Math.round((r[0] + r[1]) / 2) : 240; // between pro and avg
  }
  return { current, goal };
}

function getInitialEquipment(): Record<EquipmentKey, boolean> {
  return Object.fromEntries(EQUIPMENT_LIST.map((e) => [e.key, false])) as Record<EquipmentKey, boolean>;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface OnboardingWizardProps {
  onComplete: (result: { planId: string }) => void;
}

const WIZARD_STORAGE_KEY = "hyrox-onboarding-draft";

function loadDraft(defaultState: WizardState, defaultStep: number): { state: WizardState; step: number } {
  if (typeof window === "undefined") return { state: defaultState, step: defaultStep };
  try {
    const raw = localStorage.getItem(WIZARD_STORAGE_KEY);
    if (!raw) return { state: defaultState, step: defaultStep };
    const saved = JSON.parse(raw);
    return {
      state: { ...defaultState, ...saved.state },
      step: saved.step ?? defaultStep,
    };
  } catch {
    return { state: defaultState, step: defaultStep };
  }
}

function saveDraft(state: WizardState, step: number) {
  try {
    localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify({ state, step }));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(WIZARD_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const defaultDivision: DivisionKey = "women_open";
  const { current: defCurrent, goal: defGoal } = getInitialStationTimes(defaultDivision);

  const defaultState: WizardState = {
    name: "",
    gender: "women",
    unit: "metric",
    raceDate: "",
    division: defaultDivision,
    noRaceYet: false,
    goalFinishTime: "",
    easyPace: "6:00",
    moderatePace: "5:15",
    fastPace: "4:30",
    recent5kTime: "",
    recent800mRepeat: "",
    hasExperience: false,
    raceCount: "0",
    bestTime: "",
    bestDivision: defaultDivision,
    bestTimeNotes: "",
    stationConfidence: Object.fromEntries(STATION_ORDER.map((s) => [s, 3])) as Record<StationName, number>,
    stationCurrentTime: defCurrent,
    stationGoalTime: defGoal,
    crossfitDaysPerWeek: 4,
    gymName: "",
    equipment: getInitialEquipment(),
    injuryNotes: "",
    trainingPhilosophy: "moderate",
  };

  const [draft] = useState(() => loadDraft(defaultState, 0));
  const [step, setStep] = useState(draft.step);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<WizardState>(draft.state);
  const [profileLoaded, setProfileLoaded] = useState(false);

  // On mount, fetch existing profile from DB and merge into wizard state.
  // localStorage draft takes priority (user may have edited since last save),
  // but DB values fill in any fields still at their defaults.
  useEffect(() => {
    let cancelled = false;
    const hasDraft = typeof window !== "undefined" && !!localStorage.getItem(WIZARD_STORAGE_KEY);

    async function loadProfile() {
      try {
        const res = await fetch("/api/hyrox/profile");
        if (!res.ok || cancelled) return;
        const profile = await res.json();
        if (!profile || cancelled) return;

        setState((prev) => {
          // If there's a localStorage draft, only fill in fields still at defaults.
          // Use JSON comparison so objects/arrays match by value, not reference.
          const shouldOverride = (currentVal: unknown, defaultVal: unknown) =>
            !hasDraft ||
            (typeof currentVal === "object"
              ? JSON.stringify(currentVal) === JSON.stringify(defaultVal)
              : currentVal === defaultVal);

          const patch: Partial<WizardState> = {};

          // Step 1 — Profile
          if (profile.name && shouldOverride(prev.name, defaultState.name))
            patch.name = profile.name;
          if (profile.gender && shouldOverride(prev.gender, defaultState.gender))
            patch.gender = profile.gender as Gender;
          if (profile.preferredUnits && shouldOverride(prev.unit, defaultState.unit))
            patch.unit = profile.preferredUnits as "metric" | "mixed";

          // Step 2 — Race Details
          if (profile.targetDivision && shouldOverride(prev.division, defaultState.division))
            patch.division = profile.targetDivision as DivisionKey;
          if (profile.nextRaceDate && shouldOverride(prev.raceDate, defaultState.raceDate))
            patch.raceDate = profile.nextRaceDate;
          if (profile.goalFinishTimeSeconds && shouldOverride(prev.goalFinishTime, defaultState.goalFinishTime))
            patch.goalFinishTime = formatLongTime(profile.goalFinishTimeSeconds);

          // Step 3 — Running Assessment
          if (profile.easyPaceSecondsPerUnit && shouldOverride(prev.easyPace, defaultState.easyPace))
            patch.easyPace = formatTime(profile.easyPaceSecondsPerUnit);
          if (profile.moderatePaceSecondsPerUnit && shouldOverride(prev.moderatePace, defaultState.moderatePace))
            patch.moderatePace = formatTime(profile.moderatePaceSecondsPerUnit);
          if (profile.fastPaceSecondsPerUnit && shouldOverride(prev.fastPace, defaultState.fastPace))
            patch.fastPace = formatTime(profile.fastPaceSecondsPerUnit);
          if (profile.recent5kTimeSeconds && shouldOverride(prev.recent5kTime, defaultState.recent5kTime))
            patch.recent5kTime = formatLongTime(profile.recent5kTimeSeconds);
          if (profile.recent800mRepeatSeconds && shouldOverride(prev.recent800mRepeat, defaultState.recent800mRepeat))
            patch.recent800mRepeat = formatTime(profile.recent800mRepeatSeconds);

          // Step 4 — HYROX Experience
          if (profile.previousRaceCount > 0 && shouldOverride(prev.hasExperience, defaultState.hasExperience)) {
            patch.hasExperience = true;
            patch.raceCount = String(profile.previousRaceCount);
          }
          if (profile.bestFinishTimeSeconds && shouldOverride(prev.bestTime, defaultState.bestTime))
            patch.bestTime = formatLongTime(profile.bestFinishTimeSeconds);
          if (profile.bestDivision && shouldOverride(prev.bestDivision, defaultState.bestDivision))
            patch.bestDivision = profile.bestDivision as RaceDivisionKey;
          if (profile.bestTimeNotes && shouldOverride(prev.bestTimeNotes, defaultState.bestTimeNotes))
            patch.bestTimeNotes = profile.bestTimeNotes;

          // Step 5 — Station assessments
          if (profile.assessments?.length && shouldOverride(prev.stationConfidence, defaultState.stationConfidence)) {
            const confidence = { ...prev.stationConfidence };
            const currentTime = { ...prev.stationCurrentTime };
            const goalTime = { ...prev.stationGoalTime };
            for (const a of profile.assessments) {
              const s = a.station as StationName;
              if (STATION_ORDER.includes(s)) {
                confidence[s] = a.completionConfidence;
                if (a.currentTimeSeconds) currentTime[s] = a.currentTimeSeconds;
                if (a.goalTimeSeconds) goalTime[s] = a.goalTimeSeconds;
              }
            }
            patch.stationConfidence = confidence;
            patch.stationCurrentTime = currentTime;
            patch.stationGoalTime = goalTime;
          }

          // Step 6 — Training Preferences
          if (profile.crossfitDaysPerWeek != null && shouldOverride(prev.crossfitDaysPerWeek, defaultState.crossfitDaysPerWeek))
            patch.crossfitDaysPerWeek = profile.crossfitDaysPerWeek;
          if (profile.crossfitGymName && shouldOverride(prev.gymName, defaultState.gymName))
            patch.gymName = profile.crossfitGymName;
          if (profile.injuriesNotes && shouldOverride(prev.injuryNotes, defaultState.injuryNotes))
            patch.injuryNotes = profile.injuriesNotes;
          if (profile.trainingPhilosophy && shouldOverride(prev.trainingPhilosophy, defaultState.trainingPhilosophy))
            patch.trainingPhilosophy = profile.trainingPhilosophy as TrainingPhilosophy;
          if (profile.availableEquipment?.length && shouldOverride(prev.equipment, defaultState.equipment)) {
            const eq = { ...prev.equipment };
            for (const k of profile.availableEquipment) {
              if (k in eq) eq[k as EquipmentKey] = true;
            }
            patch.equipment = eq;
          }

          if (Object.keys(patch).length === 0) return prev;
          return { ...prev, ...patch };
        });
      } catch {
        // Fetch failed — user can still fill in manually
      } finally {
        if (!cancelled) setProfileLoaded(true);
      }
    }

    loadProfile();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist to localStorage whenever state or step changes
  useEffect(() => {
    if (profileLoaded) saveDraft(state, step);
  }, [state, step, profileLoaded]);

  const set = useCallback(
    <K extends keyof WizardState>(key: K, value: WizardState[K]) => {
      setState((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  // When division changes, reset station times to new references
  const setDivision = useCallback((d: DivisionKey) => {
    const { current, goal } = getInitialStationTimes(d);
    setState((prev) => ({
      ...prev,
      division: d,
      stationCurrentTime: current,
      stationGoalTime: goal,
    }));
  }, []);

  // Derive gender-based division on gender change
  const setGender = useCallback((g: Gender) => {
    setState((prev) => {
      const tier = prev.division.split("_")[1] as "open" | "pro";
      const newDiv = `${g}_${tier}` as DivisionKey;
      const { current, goal } = getInitialStationTimes(newDiv);
      return { ...prev, gender: g, division: newDiv, stationCurrentTime: current, stationGoalTime: goal };
    });
  }, []);

  const toggleEquipment = useCallback((key: EquipmentKey) => {
    setState((prev) => ({
      ...prev,
      equipment: { ...prev.equipment, [key]: !prev.equipment[key] },
    }));
  }, []);

  // Validation
  const canProceed = (): boolean => {
    switch (step) {
      case 0:
        return state.name.trim().length > 0;
      case 1:
        return state.noRaceYet || state.raceDate.length > 0;
      case 2: {
        const e = parseTimeToSeconds(state.easyPace);
        const m = parseTimeToSeconds(state.moderatePace);
        const f = parseTimeToSeconds(state.fastPace);
        return !isNaN(e) && !isNaN(m) && !isNaN(f) && e > m && m > f;
      }
      case 3:
        return true;
      case 4:
        return true;
      case 5:
        return true;
      case 6:
        return true;
      default:
        return true;
    }
  };

  const next = () => {
    if (step < STEPS.length - 1 && canProceed()) setStep(step + 1);
  };
  const prev = () => {
    if (step > 0) setStep(step - 1);
  };

  // Estimated times for summary
  const estimatedCurrentTime = (): number => {
    const runTime = parseTimeToSeconds(state.moderatePace) * 8;
    let stationTime = 0;
    for (const s of STATION_ORDER) stationTime += state.stationCurrentTime[s];
    return runTime + stationTime + 16 * 30;
  };

  const estimatedGoalTime = (): number => {
    const runTime = Math.round(parseTimeToSeconds(state.moderatePace) * 0.9) * 8;
    let stationTime = 0;
    for (const s of STATION_ORDER) stationTime += state.stationGoalTime[s];
    return runTime + stationTime + 16 * 24;
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);

    try {
      // 1. Save profile
      const profileBody = {
        name: state.name || null,
        gender: state.gender || null,
        preferredUnits: state.unit,
        targetDivision: state.division,
        nextRaceDate: state.noRaceYet ? null : state.raceDate,
        easyPaceSecondsPerUnit: parseTimeToSeconds(state.easyPace),
        moderatePaceSecondsPerUnit: parseTimeToSeconds(state.moderatePace),
        fastPaceSecondsPerUnit: parseTimeToSeconds(state.fastPace),
        recent5kTimeSeconds: state.recent5kTime ? parseLongTimeToSeconds(state.recent5kTime) : null,
        recent800mRepeatSeconds: state.recent800mRepeat ? parseTimeToSeconds(state.recent800mRepeat) : null,
        paceUnit: "mile",
        previousRaceCount: parseInt(state.raceCount) || 0,
        bestFinishTimeSeconds: state.bestTime ? parseLongTimeToSeconds(state.bestTime) : null,
        bestDivision: state.hasExperience ? state.bestDivision : null,
        bestTimeNotes: state.bestTimeNotes || null,
        goalFinishTimeSeconds: state.goalFinishTime ? parseLongTimeToSeconds(state.goalFinishTime) : null,
        crossfitDaysPerWeek: state.crossfitDaysPerWeek,
        crossfitGymName: state.gymName || null,
        availableEquipment: Object.entries(state.equipment)
          .filter(([, v]) => v)
          .map(([k]) => k),
        injuriesNotes: state.injuryNotes || null,
        trainingPhilosophy: state.trainingPhilosophy,
      };

      // Try POST first; if profile already exists (409), fall back to PUT
      let profileRes = await fetch("/api/hyrox/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profileBody),
      });

      if (profileRes.status === 409) {
        profileRes = await fetch("/api/hyrox/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(profileBody),
        });
      }

      if (!profileRes.ok) {
        const data = await profileRes.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to save profile");
      }

      const profile = await profileRes.json();

      // 2. Save station assessments
      const assessments = STATION_ORDER.map((s) => ({
        profileId: profile.id,
        station: s,
        completionConfidence: state.stationConfidence[s],
        currentTimeSeconds: state.stationCurrentTime[s],
        goalTimeSeconds: state.stationGoalTime[s],
      }));

      await fetch("/api/hyrox/profile/assessments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assessments }),
      });

      // 3. Generate plan
      const res = await fetch("/api/hyrox/plan/generate", {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Failed to generate plan (${res.status})`);
      }

      const { planId } = await res.json();
      clearDraft();
      onComplete({ planId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const progressPct = ((step + 1) / STEPS.length) * 100;
  const divisionSpecs = DIVISIONS[state.division];

  return (
    <div className="flex flex-col gap-6">
      {/* Progress bar */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-medium">
            Step {step + 1} of {STEPS.length}
          </span>
          <span className="font-semibold text-foreground">{STEPS[step].label}</span>
        </div>
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full bg-primary transition-all duration-300 drop-shadow-[0_0_6px_oklch(0.85_0.20_130_/_30%)]"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {/* Step icons */}
        <div className="flex justify-between">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <div
                key={s.label}
                className={`flex flex-col items-center gap-1 ${
                  i <= step ? "text-primary" : "text-muted-foreground/30"
                }`}
              >
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-200 ${
                    i < step
                      ? "bg-primary text-primary-foreground"
                      : i === step
                        ? "bg-primary/15 text-primary ring-2 ring-primary/40 glow-primary-sm"
                        : "bg-white/[0.04] text-muted-foreground/30"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <span className="hidden text-[10px] sm:block">{s.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Step content */}
      <Card>
        <CardContent className="max-h-[60vh] overflow-y-auto pt-2">
          {step === 0 && <StepProfile state={state} set={set} setGender={setGender} />}
          {step === 1 && (
            <StepRace state={state} set={set} setDivision={setDivision} divisionSpecs={divisionSpecs} />
          )}
          {step === 2 && <StepRunning state={state} set={set} />}
          {step === 3 && <StepExperience state={state} set={set} />}
          {step === 4 && <StepStations state={state} setState={setState} />}
          {step === 5 && (
            <StepPreferences state={state} set={set} toggleEquipment={toggleEquipment} />
          )}
          {step === 6 && (
            <StepSummary
              state={state}
              estimatedCurrent={estimatedCurrentTime()}
              estimatedGoal={estimatedGoalTime()}
              onGenerate={handleGenerate}
              generating={generating}
              error={error}
            />
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex gap-3">
        {step > 0 && (
          <Button variant="outline" onClick={prev} disabled={generating} className="flex-1">
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back
          </Button>
        )}
        {step < STEPS.length - 1 && (
          <Button onClick={next} disabled={!canProceed()} className="flex-1">
            Next
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Profile
// ---------------------------------------------------------------------------

function StepProfile({
  state,
  set,
  setGender,
}: {
  state: WizardState;
  set: <K extends keyof WizardState>(k: K, v: WizardState[K]) => void;
  setGender: (g: Gender) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Your Profile</h2>
        <p className="text-sm text-muted-foreground">Tell us about yourself to personalize your plan.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          placeholder="Your name"
          value={state.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label>Gender</Label>
        <p className="text-xs text-muted-foreground">Determines division weights and reference times</p>
        <div className="flex gap-2">
          {(["women", "men"] as const).map((g) => (
            <Button
              key={g}
              variant={state.gender === g ? "default" : "outline"}
              onClick={() => setGender(g)}
              className="flex-1 capitalize"
            >
              {g}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Units</Label>
        <div className="flex gap-2">
          {(["metric", "mixed"] as const).map((u) => (
            <Button
              key={u}
              variant={state.unit === u ? "default" : "outline"}
              onClick={() => set("unit", u)}
              className="flex-1 capitalize"
            >
              {u === "metric" ? "Metric (Kg/M)" : "Mixed (Lbs/M)"}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Race Details
// ---------------------------------------------------------------------------

function StepRace({
  state,
  set,
  setDivision,
  divisionSpecs,
}: {
  state: WizardState;
  set: <K extends keyof WizardState>(k: K, v: WizardState[K]) => void;
  setDivision: (d: DivisionKey) => void;
  divisionSpecs: (typeof DIVISIONS)[DivisionKey];
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Race Details</h2>
        <p className="text-sm text-muted-foreground">When and how are you competing?</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="race-date">Next Race Date</Label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              checked={state.noRaceYet}
              onCheckedChange={(val) => set("noRaceYet", val as boolean)}
            />
            No race yet
          </label>
        </div>
        {!state.noRaceYet && (
          <Input
            id="race-date"
            type="date"
            value={state.raceDate}
            onChange={(e) => set("raceDate", e.target.value)}
            min={new Date().toISOString().split("T")[0]}
          />
        )}
      </div>

      <div className="space-y-2">
        <Label>Division</Label>
        <DivisionPicker gender={state.gender} value={state.division} onChange={setDivision} />
      </div>

      {/* Goal finish time */}
      <div className="space-y-1.5">
        <Label>Goal Finish Time</Label>
        <p className="text-xs text-muted-foreground">
          Your target race finish time. This helps the AI calibrate training intensity and progression.
        </p>
        <TimeInput
          mode="hms"
          value={state.goalFinishTime}
          onChange={(val) => set("goalFinishTime", val)}
        />
      </div>

      {/* Station specs for selected division */}
      <div className="space-y-2">
        <Label>Station Specs — {divisionSpecs.label}</Label>
        <div className="space-y-1.5 rounded-lg bg-muted/50 p-3">
          {divisionSpecs.stations.map((s) => {
            const weight = s.weightLabel && state.unit === "mixed"
              ? convertWeightLabel(s.weightLabel)
              : s.weightLabel;
            return (
              <div key={s.name} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{s.shortName}</span>
                <span className="font-mono">
                  {s.distance ?? `${s.reps} reps`}
                  {weight ? ` @ ${weight}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Running Assessment
// ---------------------------------------------------------------------------

function StepRunning({
  state,
  set,
}: {
  state: WizardState;
  set: <K extends keyof WizardState>(k: K, v: WizardState[K]) => void;
}) {
  const e = parseTimeToSeconds(state.easyPace);
  const m = parseTimeToSeconds(state.moderatePace);
  const f = parseTimeToSeconds(state.fastPace);
  const valid = !isNaN(e) && !isNaN(m) && !isNaN(f);
  const orderOk = valid && e > m && m > f;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Running Assessment</h2>
        <p className="text-sm text-muted-foreground">
          Enter your current running paces per kilometer in MM:SS format.
        </p>
      </div>

      {[
        { label: "Easy Pace", key: "easyPace" as const, hint: "Conversational effort" },
        { label: "Moderate Pace", key: "moderatePace" as const, hint: "Comfortably hard" },
        { label: "Fast Pace", key: "fastPace" as const, hint: "Race effort" },
      ].map(({ label, key, hint }) => (
        <div key={key} className="space-y-1.5">
          <Label>{label}</Label>
          <p className="text-xs text-muted-foreground">{hint}</p>
          <TimeInput
            mode="ms"
            value={state[key]}
            onChange={(val) => set(key, val)}
          />
        </div>
      ))}

      {valid && !orderOk && (
        <p className="text-xs text-destructive">
          Paces must be: Easy (slowest) &gt; Moderate &gt; Fast (fastest)
        </p>
      )}
      {valid && orderOk && (
        <p className="text-xs text-green-500">Paces look good.</p>
      )}

      {/* Optional race times */}
      <div className="space-y-4 rounded-lg bg-muted/30 p-4">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Optional</p>

        <div className="space-y-1.5">
          <Label>Recent 5K Time</Label>
          <p className="text-xs text-muted-foreground">Your most recent 5K run time</p>
          <TimeInput
            mode="ms"
            value={state.recent5kTime}
            onChange={(val) => set("recent5kTime", val)}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Recent 800m Repeat Time</Label>
          <p className="text-xs text-muted-foreground">Your average 800m interval time</p>
          <TimeInput
            mode="ms"
            value={state.recent800mRepeat}
            onChange={(val) => set("recent800mRepeat", val)}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared — Division picker
// ---------------------------------------------------------------------------

function DivisionPicker({
  gender,
  value,
  onChange,
}: {
  gender: Gender;
  value: DivisionKey | RaceDivisionKey;
  onChange: (d: DivisionKey) => void;
}) {
  return (
    <div className="space-y-2">
      {DIVISION_CATEGORIES.map((cat) => {
        const relevantKeys = cat.keys.filter((k) => {
          if (gender === "women") return k.includes("women") || k.includes("mixed");
          if (gender === "men") return k.includes("men") || k.includes("mixed");
          return true;
        });
        if (relevantKeys.length === 0) return null;
        return (
          <div key={cat.label}>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-1">
              {cat.label}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {relevantKeys.map((d) => {
                const label = DIVISIONS[d].label
                  .replace(/^(Women|Men)\s+/, "")
                  .replace(cat.label + " ", "");
                return (
                  <Button
                    key={d}
                    variant={value === d ? "default" : "outline"}
                    onClick={() => onChange(d)}
                    size="sm"
                    className="text-xs"
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Step 4 — Experience
// ---------------------------------------------------------------------------

function StepExperience({
  state,
  set,
}: {
  state: WizardState;
  set: <K extends keyof WizardState>(k: K, v: WizardState[K]) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">HYROX Experience</h2>
        <p className="text-sm text-muted-foreground">Have you competed in HYROX before?</p>
      </div>

      <div className="flex items-center gap-3">
        <Switch
          checked={state.hasExperience}
          onCheckedChange={(val) => set("hasExperience", val as boolean)}
        />
        <span className="text-sm">{state.hasExperience ? "Yes, I have!" : "No, this will be my first"}</span>
      </div>

      {state.hasExperience && (
        <div className="space-y-4 rounded-lg bg-muted/30 p-4">
          <div className="space-y-1.5">
            <Label>Number of races</Label>
            <Input
              type="number"
              min="1"
              value={state.raceCount}
              onChange={(e) => set("raceCount", e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Best finish time</Label>
            <TimeInput
              mode="hms"
              value={state.bestTime}
              onChange={(val) => set("bestTime", val)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Division raced</Label>
            <DivisionPicker gender={state.gender} value={state.bestDivision} onChange={(d) => set("bestDivision", d)} />
            {isTeamDivision(state.bestDivision) && (
              <div className="rounded-md border border-primary/20 bg-primary/5 p-2.5 text-xs text-muted-foreground">
                <strong className="text-foreground">Note:</strong> Since you split station work with a
                partner/team, the AI will adjust its assessment of your individual station capabilities.
                Your run segments are still considered individual effort.
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="best-time-notes">Race notes (optional)</Label>
            <p className="text-xs text-muted-foreground">
              Anything the AI should know about this race?
            </p>
            <textarea
              id="best-time-notes"
              placeholder="e.g., Partner was slower on runs, I bonked at station 6, sled track was wet..."
              value={state.bestTimeNotes}
              onChange={(e) => set("bestTimeNotes", e.target.value)}
              rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5 — Station Assessment
// ---------------------------------------------------------------------------

function StepStations({
  state,
  setState,
}: {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}) {
  const [activeStation, setActiveStation] = useState(0);
  const station = STATION_ORDER[activeStation];
  const divSpec = DIVISIONS[state.division].stations[activeStation];
  const refs = REFERENCE_TIMES[state.division]?.[station] ?? [240, 300, 420];
  const dist = DIVISION_REF_DATA[state.division]?.stations[station];
  const range = DIVISION_REF_DATA[state.division]?.stationRanges[station];
  const sliderMin = range?.[0] ?? Math.round(refs[0] * 0.5);
  const sliderMax = range?.[1] ?? Math.round(refs[2] * 1.5);

  const setConfidence = (val: number) => {
    setState((prev) => ({
      ...prev,
      stationConfidence: { ...prev.stationConfidence, [station]: val },
    }));
  };

  const setCurrentTime = (val: number) => {
    setState((prev) => ({
      ...prev,
      stationCurrentTime: { ...prev.stationCurrentTime, [station]: val },
    }));
  };

  const setGoalTime = (val: number) => {
    setState((prev) => ({
      ...prev,
      stationGoalTime: { ...prev.stationGoalTime, [station]: val },
    }));
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Station Assessment</h2>
        <p className="text-sm text-muted-foreground">
          Rate your confidence and set time targets for each station.
        </p>
      </div>

      {/* Station selector */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {STATION_ORDER.map((s, i) => (
          <button
            key={s}
            onClick={() => setActiveStation(i)}
            className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
              i === activeStation
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {DIVISIONS[state.division].stations[i].shortName}
          </button>
        ))}
      </div>

      {/* Active station detail */}
      <div className="rounded-lg bg-muted/30 p-4 space-y-5">
        <div>
          <h3 className="font-semibold">{station}</h3>
          <p className="text-xs text-muted-foreground">
            {divSpec.distance ?? `${divSpec.reps} reps`}
            {divSpec.weightLabel ? ` @ ${state.unit === "mixed" ? convertWeightLabel(divSpec.weightLabel) : divSpec.weightLabel}` : ""}
          </p>
          <div className="mt-1 flex gap-2 text-[10px] text-muted-foreground">
            <span>Fast: {formatTime(refs[0])}</span>
            <span>Median: {formatTime(refs[1])}</span>
            <span>Slow: {formatTime(refs[2])}</span>
          </div>
        </div>

        {/* Confidence */}
        <div className="space-y-2">
          <Label>Confidence</Label>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setConfidence(n)}
                className={`flex-1 rounded-md py-2 text-xs font-medium transition-colors ${
                  state.stationConfidence[station] === n
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="text-center text-xs text-muted-foreground">
            {CONFIDENCE_LABELS[state.stationConfidence[station]]}
          </p>
        </div>

        {/* Current time slider */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <Label>Current Time</Label>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-primary">{formatTime(state.stationCurrentTime[station])}</span>
              {dist && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {formatPercentile(estimatePercentile(state.stationCurrentTime[station], dist))}
                </span>
              )}
            </div>
          </div>
          <Slider
            min={sliderMin}
            max={sliderMax}
            value={[state.stationCurrentTime[station]]}
            onValueChange={(val) => setCurrentTime(Array.isArray(val) ? val[0] : val)}
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{formatTime(sliderMin)}</span>
            <span>{formatTime(sliderMax)}</span>
          </div>
        </div>

        {/* Goal time slider */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <Label>Goal Time</Label>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-green-500">{formatTime(state.stationGoalTime[station])}</span>
              {dist && (
                <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-500">
                  {formatPercentile(estimatePercentile(state.stationGoalTime[station], dist))}
                </span>
              )}
            </div>
          </div>
          <Slider
            min={sliderMin}
            max={state.stationCurrentTime[station]}
            value={[state.stationGoalTime[station]]}
            onValueChange={(val) => setGoalTime(Array.isArray(val) ? val[0] : val)}
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{formatTime(sliderMin)}</span>
            <span>Current {formatTime(state.stationCurrentTime[station])}</span>
          </div>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          disabled={activeStation === 0}
          onClick={() => setActiveStation(activeStation - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
          Prev
        </Button>
        <span className="text-xs text-muted-foreground">
          {activeStation + 1} / {STATION_ORDER.length}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={activeStation === STATION_ORDER.length - 1}
          onClick={() => setActiveStation(activeStation + 1)}
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 6 — Training Preferences (combines preferences + equipment)
// ---------------------------------------------------------------------------

function StepPreferences({
  state,
  set,
  toggleEquipment,
}: {
  state: WizardState;
  set: <K extends keyof WizardState>(k: K, v: WizardState[K]) => void;
  toggleEquipment: (key: EquipmentKey) => void;
}) {
  const philosophyOptions: { value: TrainingPhilosophy; label: string; hint: string }[] = [
    { value: "conservative", label: "Conservative", hint: "Gradual progression, lower injury risk" },
    { value: "moderate", label: "Moderate", hint: "Balanced intensity and recovery" },
    { value: "aggressive", label: "Aggressive", hint: "Push hard, faster results" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Training Preferences</h2>
        <p className="text-sm text-muted-foreground">
          Help us tailor your plan to your schedule, gym, and goals.
        </p>
      </div>

      {/* CrossFit days per week */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>CrossFit Days / Week</Label>
          <Badge variant="secondary" className="font-mono">
            {state.crossfitDaysPerWeek}
          </Badge>
        </div>
        <Slider
          min={3}
          max={6}
          step={1}
          value={[state.crossfitDaysPerWeek]}
          onValueChange={(val) => set("crossfitDaysPerWeek", Array.isArray(val) ? val[0] : val)}
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>3 days</span>
          <span>6 days</span>
        </div>
      </div>

      {/* Gym name */}
      <div className="space-y-1.5">
        <Label htmlFor="gym-name">Gym Name</Label>
        <Input
          id="gym-name"
          placeholder="e.g., CrossFit Central"
          value={state.gymName}
          onChange={(e) => set("gymName", e.target.value)}
        />
      </div>

      {/* Equipment availability */}
      <div className="space-y-2">
        <Label>Equipment Availability</Label>
        <p className="text-xs text-muted-foreground">
          Check the equipment you have access to at your gym or home.
        </p>
        <div className="space-y-2 rounded-lg bg-muted/30 p-3">
          {EQUIPMENT_LIST.map((item) => (
            <label
              key={item.key}
              className="flex items-start gap-3 cursor-pointer rounded-md p-2 transition-colors hover:bg-muted/50"
            >
              <Switch
                checked={state.equipment[item.key]}
                onCheckedChange={() => toggleEquipment(item.key)}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{item.label}</span>
                <p className="text-xs text-muted-foreground">{item.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Injury notes */}
      <div className="space-y-1.5">
        <Label htmlFor="injury-notes">Injury Notes</Label>
        <p className="text-xs text-muted-foreground">
          Any current injuries, limitations, or areas to be careful with.
        </p>
        <textarea
          id="injury-notes"
          placeholder="e.g., Recovering from a mild knee sprain, avoid heavy lunges..."
          value={state.injuryNotes}
          onChange={(e) => set("injuryNotes", e.target.value)}
          rows={3}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </div>

      {/* Training philosophy */}
      <div className="space-y-2">
        <Label>Training Philosophy</Label>
        <div className="space-y-1.5">
          {philosophyOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => set("trainingPhilosophy", opt.value)}
              className={`w-full rounded-lg p-3 text-left transition-colors ${
                state.trainingPhilosophy === opt.value
                  ? "bg-primary/15 ring-2 ring-primary/40"
                  : "bg-muted/30 hover:bg-muted/50"
              }`}
            >
              <span className="text-sm font-medium">{opt.label}</span>
              <p className="text-xs text-muted-foreground">{opt.hint}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 7 — Summary
// ---------------------------------------------------------------------------

function StepSummary({
  state,
  estimatedCurrent,
  estimatedGoal,
  onGenerate,
  generating,
  error,
}: {
  state: WizardState;
  estimatedCurrent: number;
  estimatedGoal: number;
  onGenerate: () => void;
  generating: boolean;
  error: string | null;
}) {
  const weeks = state.noRaceYet
    ? 12
    : Math.max(4, Math.min(16, Math.ceil((new Date(state.raceDate).getTime() - Date.now()) / (7 * 24 * 60 * 60 * 1000))));

  const improvement = estimatedCurrent - estimatedGoal;
  const availableEquipment = EQUIPMENT_LIST.filter((e) => state.equipment[e.key]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Your Plan Summary</h2>
        <p className="text-sm text-muted-foreground">
          Review your inputs below. AI will generate your personalized training plan.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-muted/50 p-3 text-center">
          <p className="text-xs text-muted-foreground">Est. Current</p>
          <p className="text-xl font-bold font-mono">{formatLongTime(estimatedCurrent)}</p>
        </div>
        <div className="rounded-lg bg-green-500/10 p-3 text-center">
          <p className="text-xs text-green-400">Goal Time</p>
          <p className="text-xl font-bold font-mono text-green-400">
            {state.goalFinishTime ? state.goalFinishTime : formatLongTime(estimatedGoal)}
          </p>
        </div>
      </div>

      <div className="rounded-lg bg-muted/30 p-3 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Division</span>
          <span className="font-medium">{DIVISIONS[state.division].label}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Plan Length</span>
          <span className="font-medium">{weeks} weeks</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Target Improvement</span>
          <span className="font-medium text-green-400">-{formatTime(improvement)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">CrossFit Days / Week</span>
          <span className="font-medium">{state.crossfitDaysPerWeek}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Philosophy</span>
          <span className="font-medium capitalize">{state.trainingPhilosophy}</span>
        </div>
        {state.gymName && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Gym</span>
            <span className="font-medium">{state.gymName}</span>
          </div>
        )}
      </div>

      {/* Equipment summary */}
      {availableEquipment.length > 0 && (
        <div className="space-y-2">
          <Label>Available Equipment</Label>
          <div className="flex flex-wrap gap-1.5">
            {availableEquipment.map((e) => (
              <Badge key={e.key} variant="secondary" className="text-xs">
                {e.label}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Station breakdown */}
      <div className="space-y-2">
        <Label>Station Time Targets</Label>
        <div className="space-y-1.5 rounded-lg bg-muted/30 p-3">
          {STATION_ORDER.map((s) => (
            <div key={s} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{s}</span>
              <div className="flex items-center gap-2 font-mono">
                <span>{formatTime(state.stationCurrentTime[s])}</span>
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                <span className="text-green-400">{formatTime(state.stationGoalTime[s])}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* AI generation notice */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-center">
        <Sparkles className="mx-auto mb-1.5 h-5 w-5 text-primary" />
        <p className="text-sm font-medium">AI-Powered Plan Generation</p>
        <p className="text-xs text-muted-foreground">
          Your personalized training plan will be generated using AI based on all the data you provided.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-center">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <Button onClick={onGenerate} disabled={generating} className="w-full" size="lg">
        {generating ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Generating Your Plan...
          </>
        ) : (
          <>
            <Sparkles className="mr-2 h-4 w-4" />
            Generate My Plan
          </>
        )}
      </Button>
    </div>
  );
}
