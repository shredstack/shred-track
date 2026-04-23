"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Calendar, Sparkles, Users, User, Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  useCreateFreePlan,
  RaceTooSoonError,
} from "@/hooks/useHyroxPlan";
import { DisclaimerModal } from "./disclaimer-modal";

type Gender = "women" | "men";
type RaceFormat = "singles" | "doubles" | "relay";
type WeightTier = "open" | "pro";
type PaceTier = "beginner" | "intermediate" | "advanced" | "elite";

interface PaceTierDef {
  key: PaceTier;
  label: string;
  description: string;
  milePace: string;
  kmPace: string;
}

const PACE_TIERS: PaceTierDef[] = [
  {
    key: "beginner",
    label: "Beginner",
    description: "Comfortable running, building from a modest aerobic base",
    milePace: "10:00–16:00 /mi",
    kmPace: "6:13–9:57 /km",
  },
  {
    key: "intermediate",
    label: "Intermediate",
    description: "You've run consistently and can hold a steady conversation on easy runs",
    milePace: "8:30–9:59 /mi",
    kmPace: "5:17–6:12 /km",
  },
  {
    key: "advanced",
    label: "Advanced",
    description: "You run or do CrossFit 4+ days a week and hold faster paces without grinding",
    milePace: "7:00–8:29 /mi",
    kmPace: "4:21–5:16 /km",
  },
  {
    key: "elite",
    label: "Elite",
    description: "You comfortably hold sub-7 miles and have a competitive endurance background",
    milePace: "sub-7:00 /mi",
    kmPace: "sub-4:21 /km",
  },
];

interface Props {
  onCompleted: (planId: string) => void;
}

export function FreeOnboardingWizard({ onCompleted }: Props) {
  const router = useRouter();
  const [gender, setGender] = useState<Gender | null>(null);
  const [raceFormat, setRaceFormat] = useState<RaceFormat | null>(null);
  const [weightTier, setWeightTier] = useState<WeightTier | null>(null);
  const [paceTier, setPaceTier] = useState<PaceTier | null>(null);
  const [raceDate, setRaceDate] = useState<string | null>(null);
  const [startToday, setStartToday] = useState(false);

  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const [raceTooSoon, setRaceTooSoon] = useState<{ weeksUntilRace: number; message: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const createFreePlan = useCreateFreePlan();

  // Validation: what's the first unanswered question?
  const firstMissing = !gender
    ? 1
    : !raceFormat
      ? 2
      : raceFormat !== "relay" && !weightTier
        ? 3
        : !paceTier
          ? 4
          : !startToday && !raceDate
            ? 5
            : null;

  const canContinue = firstMissing === null;

  function handleContinue() {
    setSubmitError(null);
    setRaceTooSoon(null);
    if (!canContinue) return;
    setDisclaimerOpen(true);
  }

  function handleAcceptDisclaimer() {
    if (!gender || !raceFormat || !paceTier) return;
    setSubmitError(null);
    createFreePlan.mutate(
      {
        gender,
        raceFormat,
        weightTier: raceFormat === "relay" ? undefined : weightTier ?? undefined,
        paceTier,
        raceDate: startToday ? null : raceDate,
        disclaimerAccepted: true,
      },
      {
        onSuccess: (data) => {
          setDisclaimerOpen(false);
          onCompleted(data.planId);
        },
        onError: (err) => {
          if (err instanceof RaceTooSoonError) {
            setDisclaimerOpen(false);
            setRaceTooSoon({ weeksUntilRace: err.weeksUntilRace, message: err.message });
            return;
          }
          setSubmitError((err as Error).message || "Something went wrong. Try again.");
        },
      },
    );
  }

  return (
    <>
      <div className="flex flex-col gap-6 pb-10">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            Free 18-week plan
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Let&apos;s build your plan</h1>
          <p className="text-sm text-muted-foreground">
            Five quick questions. You&apos;ll have a structured 18-week HYROX plan ready in seconds.
          </p>
        </header>

        {raceTooSoon && (
          <RaceTooSoonNotice
            weeksUntilRace={raceTooSoon.weeksUntilRace}
            message={raceTooSoon.message}
            onUpgrade={() => router.push("/hyrox/onboarding")}
            onReset={() => {
              setRaceDate(null);
              setStartToday(true);
              setRaceTooSoon(null);
            }}
          />
        )}

        {/* Q1 — Gender */}
        <Section number={1} label="I'm training as">
          <ToggleRow>
            <OptionPill active={gender === "women"} onClick={() => setGender("women")}>
              Woman
            </OptionPill>
            <OptionPill active={gender === "men"} onClick={() => setGender("men")}>
              Man
            </OptionPill>
          </ToggleRow>
        </Section>

        {/* Q2 — Race format */}
        <Section number={2} label="I'm racing">
          <div className="grid grid-cols-3 gap-2">
            <FormatCard
              active={raceFormat === "singles"}
              onClick={() => {
                setRaceFormat("singles");
                setWeightTier(null);
              }}
              icon={<User className="h-4 w-4" />}
              title="Singles"
              subtitle="Full 8 × 1km + 8 stations"
            />
            <FormatCard
              active={raceFormat === "doubles"}
              onClick={() => {
                setRaceFormat("doubles");
                setWeightTier(null);
              }}
              icon={<Users className="h-4 w-4" />}
              title="Doubles"
              subtitle="Partner — split station work"
            />
            <FormatCard
              active={raceFormat === "relay"}
              onClick={() => {
                setRaceFormat("relay");
                setWeightTier(null);
              }}
              icon={<Trophy className="h-4 w-4" />}
              title="Relay"
              subtitle="4 athletes — 2 runs each"
            />
          </div>
        </Section>

        {/* Q3 — Weight tier (singles + doubles only) */}
        {raceFormat && raceFormat !== "relay" && (
          <Section number={3} label="Weight category">
            <ToggleRow>
              <OptionPill active={weightTier === "open"} onClick={() => setWeightTier("open")}>
                <div className="flex flex-col items-start">
                  <span className="font-medium">Open</span>
                  <span className="text-[10px] opacity-70">
                    {gender === "men" ? "Men 152kg push" : "Women 102kg push"}
                  </span>
                </div>
              </OptionPill>
              <OptionPill active={weightTier === "pro"} onClick={() => setWeightTier("pro")}>
                <div className="flex flex-col items-start">
                  <span className="font-medium">Pro</span>
                  <span className="text-[10px] opacity-70">
                    {gender === "men" ? "Men 202kg push" : "Women 152kg push"}
                  </span>
                </div>
              </OptionPill>
            </ToggleRow>
          </Section>
        )}

        {/* Q4 — Pace tier */}
        <Section
          number={raceFormat === "relay" ? 3 : 4}
          label="My comfortable running pace"
          hint="Pick the range that matches how you run easy — no racing involved"
        >
          <div className="flex flex-col gap-2">
            {PACE_TIERS.map((p) => (
              <PaceTierCard
                key={p.key}
                active={paceTier === p.key}
                onClick={() => setPaceTier(p.key)}
                tier={p}
              />
            ))}
          </div>
        </Section>

        {/* Q5 — Race date */}
        <Section
          number={raceFormat === "relay" ? 4 : 5}
          label="Target race date"
          hint="18-week plan anchored to your race. Pick a Saturday — or start today if you're just building fitness."
        >
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Calendar className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="date"
                value={startToday ? "" : raceDate ?? ""}
                disabled={startToday}
                min={new Date().toISOString().split("T")[0]}
                onChange={(e) => setRaceDate(e.target.value || null)}
                className="h-11 w-full rounded-md border bg-background pl-9 pr-3 text-sm tabular-nums disabled:opacity-50"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setStartToday(!startToday);
                if (!startToday) setRaceDate(null);
              }}
              className={`text-xs text-left px-3 py-2 rounded-md border transition-colors ${
                startToday
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {startToday ? "✓ Starting today (no race date)" : "Not sure yet — start today"}
            </button>
          </div>
        </Section>

        {submitError && (
          <p className="text-xs text-red-500">{submitError}</p>
        )}

        <div className="flex flex-col gap-2 pt-2">
          <Button
            size="lg"
            disabled={!canContinue || createFreePlan.isPending}
            onClick={handleContinue}
            className="w-full"
          >
            Continue
            <ArrowRight className="h-4 w-4" />
          </Button>

          <button
            type="button"
            onClick={() => router.push("/hyrox/onboarding")}
            className="text-center text-xs text-muted-foreground hover:text-foreground py-2"
          >
            Want a plan that fits your actual station times and weak spots?{" "}
            <span className="underline underline-offset-2">Try Personalized →</span>
          </button>
        </div>
      </div>

      <DisclaimerModal
        open={disclaimerOpen}
        onOpenChange={setDisclaimerOpen}
        onAccept={handleAcceptDisclaimer}
        acceptPending={createFreePlan.isPending}
        acceptError={submitError}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Section({
  number,
  label,
  hint,
  children,
}: {
  number: number;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
          {number}
        </span>
        <Label className="text-sm font-semibold">{label}</Label>
      </div>
      {hint && <p className="-mt-1 ml-7 text-xs text-muted-foreground">{hint}</p>}
      <div className="ml-0">{children}</div>
    </div>
  );
}

function ToggleRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

function OptionPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-12 rounded-lg border text-sm font-medium transition-colors px-3 text-left ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border hover:border-foreground/30"
      }`}
    >
      {children}
    </button>
  );
}

function FormatCard({
  active,
  onClick,
  icon,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-colors ${
        active
          ? "border-primary bg-primary/10"
          : "border-border hover:border-foreground/30"
      }`}
    >
      <div
        className={`flex h-7 w-7 items-center justify-center rounded-md ${
          active ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
        }`}
      >
        {icon}
      </div>
      <span className={`text-sm font-semibold ${active ? "text-primary" : ""}`}>
        {title}
      </span>
      <span className="text-[10px] leading-tight text-muted-foreground">
        {subtitle}
      </span>
    </button>
  );
}

function PaceTierCard({
  active,
  onClick,
  tier,
}: {
  active: boolean;
  onClick: () => void;
  tier: PaceTierDef;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors ${
        active
          ? "border-primary bg-primary/10"
          : "border-border hover:border-foreground/30"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className={`text-sm font-semibold ${active ? "text-primary" : ""}`}>
          {tier.label}
        </span>
        <span className="text-[10px] font-mono tabular-nums text-muted-foreground">
          {tier.milePace} · {tier.kmPace}
        </span>
      </div>
      <p className="text-xs leading-snug text-muted-foreground">
        {tier.description}
      </p>
    </button>
  );
}

function RaceTooSoonNotice({
  weeksUntilRace,
  message,
  onUpgrade,
  onReset,
}: {
  weeksUntilRace: number;
  message: string;
  onUpgrade: () => void;
  onReset: () => void;
}) {
  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardContent className="flex flex-col gap-3 py-4">
        <div>
          <p className="text-sm font-semibold text-amber-500">
            Your race is only {weeksUntilRace} weeks away
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{message}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button size="sm" onClick={onUpgrade} className="flex-1">
            Upgrade to Personalized
          </Button>
          <Button variant="outline" size="sm" onClick={onReset} className="flex-1">
            Start today instead
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
