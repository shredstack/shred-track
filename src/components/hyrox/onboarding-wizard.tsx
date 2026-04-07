"use client";

import { useState, useCallback } from "react";
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
  CalendarIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  DIVISIONS,
  DIVISION_KEYS,
  STATION_ORDER,
  REFERENCE_TIMES,
  CONFIDENCE_LABELS,
  formatTime,
  formatLongTime,
  parseTimeToSeconds,
  parseLongTimeToSeconds,
  type DivisionKey,
  type Gender,
  type StationName,
} from "@/lib/hyrox-data";
import { generatePlan, type OnboardingData, type GeneratedPlan } from "@/lib/plan-generator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WizardState {
  // Step 1
  name: string;
  gender: Gender;
  unit: "metric" | "imperial";
  // Step 2
  raceDate: string;
  division: DivisionKey;
  noRaceYet: boolean;
  // Step 3
  easyPace: string;
  moderatePace: string;
  fastPace: string;
  // Step 4
  hasExperience: boolean;
  raceCount: string;
  bestTime: string;
  bestDivision: DivisionKey;
  // Step 5
  stationConfidence: Record<StationName, number>;
  stationCurrentTime: Record<StationName, number>;
  stationGoalTime: Record<StationName, number>;
}

const STEPS = [
  { label: "Profile", icon: User },
  { label: "Race", icon: Flag },
  { label: "Running", icon: Activity },
  { label: "Experience", icon: Trophy },
  { label: "Stations", icon: BarChart3 },
  { label: "Summary", icon: CheckCircle2 },
];

function getInitialStationTimes(division: DivisionKey): {
  current: Record<StationName, number>;
  goal: Record<StationName, number>;
} {
  const refs = REFERENCE_TIMES[division];
  const current = {} as Record<StationName, number>;
  const goal = {} as Record<StationName, number>;
  for (const s of STATION_ORDER) {
    current[s] = refs[s][1]; // average
    goal[s] = Math.round((refs[s][0] + refs[s][1]) / 2); // between pro and avg
  }
  return { current, goal };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface OnboardingWizardProps {
  onComplete: (plan: GeneratedPlan) => void;
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const defaultDivision: DivisionKey = "women_open";
  const { current: defCurrent, goal: defGoal } = getInitialStationTimes(defaultDivision);

  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>({
    name: "",
    gender: "women",
    unit: "metric",
    raceDate: "",
    division: defaultDivision,
    noRaceYet: false,
    easyPace: "6:00",
    moderatePace: "5:15",
    fastPace: "4:30",
    hasExperience: false,
    raceCount: "0",
    bestTime: "",
    bestDivision: defaultDivision,
    stationConfidence: Object.fromEntries(STATION_ORDER.map((s) => [s, 3])) as Record<StationName, number>,
    stationCurrentTime: defCurrent,
    stationGoalTime: defGoal,
  });

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

  const handleGenerate = () => {
    const onboardingData: OnboardingData = {
      name: state.name,
      gender: state.gender,
      unit: state.unit,
      division: state.division,
      raceDate: state.noRaceYet ? null : state.raceDate,
      easyPace: parseTimeToSeconds(state.easyPace),
      moderatePace: parseTimeToSeconds(state.moderatePace),
      fastPace: parseTimeToSeconds(state.fastPace),
      hasExperience: state.hasExperience,
      raceCount: parseInt(state.raceCount) || 0,
      bestTime: state.bestTime ? parseLongTimeToSeconds(state.bestTime) : null,
      stationConfidence: state.stationConfidence,
      stationCurrentTime: state.stationCurrentTime,
      stationGoalTime: state.stationGoalTime,
    };
    const plan = generatePlan(onboardingData);
    onComplete(plan);
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
          <span>
            Step {step + 1} of {STEPS.length}
          </span>
          <span>{STEPS[step].label}</span>
        </div>
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all duration-300"
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
                  i <= step ? "text-primary" : "text-muted-foreground/40"
                }`}
              >
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                    i < step
                      ? "bg-primary text-primary-foreground"
                      : i === step
                        ? "bg-primary/20 text-primary ring-2 ring-primary"
                        : "bg-muted text-muted-foreground/40"
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
        <CardContent className="pt-2">
          {step === 0 && <StepProfile state={state} set={set} setGender={setGender} />}
          {step === 1 && (
            <StepRace state={state} set={set} setDivision={setDivision} divisionSpecs={divisionSpecs} />
          )}
          {step === 2 && <StepRunning state={state} set={set} />}
          {step === 3 && <StepExperience state={state} set={set} />}
          {step === 4 && <StepStations state={state} setState={setState} />}
          {step === 5 && (
            <StepSummary
              state={state}
              estimatedCurrent={estimatedCurrentTime()}
              estimatedGoal={estimatedGoalTime()}
              onGenerate={handleGenerate}
            />
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex gap-3">
        {step > 0 && (
          <Button variant="outline" onClick={prev} className="flex-1">
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
          {(["metric", "imperial"] as const).map((u) => (
            <Button
              key={u}
              variant={state.unit === u ? "default" : "outline"}
              onClick={() => set("unit", u)}
              className="flex-1 capitalize"
            >
              {u === "metric" ? "Metric (kg/m)" : "Imperial (lbs/ft)"}
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
  const genderDivisions = DIVISION_KEYS.filter((k) => k.startsWith(state.gender));

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
        <div className="flex gap-2">
          {genderDivisions.map((d) => (
            <Button
              key={d}
              variant={state.division === d ? "default" : "outline"}
              onClick={() => setDivision(d)}
              className="flex-1"
            >
              {d.includes("open") ? "Open" : "Pro"}
            </Button>
          ))}
        </div>
      </div>

      {/* Station specs for selected division */}
      <div className="space-y-2">
        <Label>Station Specs — {divisionSpecs.label}</Label>
        <div className="space-y-1.5 rounded-lg bg-muted/50 p-3">
          {divisionSpecs.stations.map((s) => (
            <div key={s.name} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{s.shortName}</span>
              <span className="font-mono">
                {s.distance ?? `${s.reps} reps`}
                {s.weightLabel ? ` @ ${s.weightLabel}` : ""}
              </span>
            </div>
          ))}
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
          <Input
            placeholder="M:SS"
            value={state[key]}
            onChange={(e) => set(key, e.target.value)}
            className="font-mono"
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
    </div>
  );
}

// ---------------------------------------------------------------------------
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
            <Label>Best finish time (HH:MM:SS)</Label>
            <Input
              placeholder="1:30:00"
              value={state.bestTime}
              onChange={(e) => set("bestTime", e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Division raced</Label>
            <div className="flex gap-2">
              {DIVISION_KEYS.map((d) => (
                <Button
                  key={d}
                  variant={state.bestDivision === d ? "default" : "outline"}
                  onClick={() => set("bestDivision", d)}
                  size="sm"
                  className="flex-1 text-xs"
                >
                  {DIVISIONS[d].label}
                </Button>
              ))}
            </div>
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
  const refs = REFERENCE_TIMES[state.division][station];

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
      <div className="flex flex-wrap gap-1.5">
        {STATION_ORDER.map((s, i) => (
          <button
            key={s}
            onClick={() => setActiveStation(i)}
            className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
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
            {divSpec.weightLabel ? ` @ ${divSpec.weightLabel}` : ""}
          </p>
          <div className="mt-1 flex gap-2 text-[10px] text-muted-foreground">
            <span>Pro: {formatTime(refs[0])}</span>
            <span>Avg: {formatTime(refs[1])}</span>
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
          <div className="flex justify-between">
            <Label>Current Time</Label>
            <span className="font-mono text-sm text-primary">{formatTime(state.stationCurrentTime[station])}</span>
          </div>
          <Slider
            min={refs[0]}
            max={refs[2]}
            value={[state.stationCurrentTime[station]]}
            onValueChange={(val) => setCurrentTime(Array.isArray(val) ? val[0] : val)}
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Pro {formatTime(refs[0])}</span>
            <span>Slow {formatTime(refs[2])}</span>
          </div>
        </div>

        {/* Goal time slider */}
        <div className="space-y-2">
          <div className="flex justify-between">
            <Label>Goal Time</Label>
            <span className="font-mono text-sm text-green-500">{formatTime(state.stationGoalTime[station])}</span>
          </div>
          <Slider
            min={refs[0]}
            max={state.stationCurrentTime[station]}
            value={[state.stationGoalTime[station]]}
            onValueChange={(val) => setGoalTime(Array.isArray(val) ? val[0] : val)}
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Pro {formatTime(refs[0])}</span>
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
// Step 6 — Summary
// ---------------------------------------------------------------------------

function StepSummary({
  state,
  estimatedCurrent,
  estimatedGoal,
  onGenerate,
}: {
  state: WizardState;
  estimatedCurrent: number;
  estimatedGoal: number;
  onGenerate: () => void;
}) {
  const weeks = state.noRaceYet
    ? 12
    : Math.max(4, Math.min(16, Math.ceil((new Date(state.raceDate).getTime() - Date.now()) / (7 * 24 * 60 * 60 * 1000))));

  const improvement = estimatedCurrent - estimatedGoal;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Your Plan Summary</h2>
        <p className="text-sm text-muted-foreground">
          Here is what we have calculated based on your inputs.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-muted/50 p-3 text-center">
          <p className="text-xs text-muted-foreground">Est. Current</p>
          <p className="text-xl font-bold font-mono">{formatLongTime(estimatedCurrent)}</p>
        </div>
        <div className="rounded-lg bg-green-500/10 p-3 text-center">
          <p className="text-xs text-green-400">Goal Time</p>
          <p className="text-xl font-bold font-mono text-green-400">{formatLongTime(estimatedGoal)}</p>
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
          <span className="text-muted-foreground">Sessions / Week</span>
          <span className="font-medium">6 (3 runs + 2 stations + 1 class)</span>
        </div>
      </div>

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

      <Button onClick={onGenerate} className="w-full" size="lg">
        <Sparkles className="mr-2 h-4 w-4" />
        Generate My Plan
      </Button>
    </div>
  );
}
