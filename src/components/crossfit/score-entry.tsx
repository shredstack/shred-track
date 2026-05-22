"use client";

import { useState, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Save, Trophy, Shield, AlertTriangle } from "lucide-react";
import { SetWeightBreakdown } from "@/components/crossfit/set-weight-breakdown";
import {
  formatSecondsAsClock,
  parseDurationToSeconds,
} from "@/lib/crossfit/duration-parser";
import {
  resolveRxWeightLb,
  formatGenderedHeight,
} from "@/lib/crossfit/prescription";
import { useUserProfile } from "@/hooks/useProfile";
import { useMovements } from "@/hooks/useMovements";
import { useLogForCandidates } from "@/hooks/useFamily";
import type {
  WorkoutPartDisplay,
  WorkoutMovementDisplay,
  ScoreInput,
  MovementScaling,
  ScoreDisplay,
  SetEntry,
  WorkoutDisplay,
} from "@/types/crossfit";
import { WORKOUT_TYPE_LABELS } from "@/types/crossfit";

const MAX_SET_INPUTS = 15;

// Each modification type declares which contextual input (if any) it exposes.
// - `weight` → numeric input. For monostructural movements (Row, Run, etc.)
//              we relabel this on render to "Cals used" / "Distance used"
//              so the same column captures whatever the metric is.
// - `reps`   → text "Reps / time completed" input (supports "2 min practice")
// - `none`   → notes only
type ScalingFieldType = "weight" | "reps" | "none";

// Helper: returns the right label/unit/placeholder for the numeric scaling
// field based on the movement's metric type. Re-uses the `actualWeight`
// numeric column to store the value regardless of unit (the unit is
// recovered at read time from the movement's metric type).
function scaledMetricCopy(
  mov: WorkoutMovementDisplay,
  userBodyWeightLb: number | null,
  gender: "male" | "female" | "other" | null
): {
  label: string;
  unit: string;
  placeholder: string;
} {
  if (mov.metricType === "calories") {
    const rx = mov.prescribedCaloriesMale ?? mov.prescribedCaloriesFemale;
    return {
      label: "Cals used",
      unit: "cal",
      placeholder: rx != null ? `Rx: ${rx} cal` : "Cals completed",
    };
  }
  if (mov.metricType === "distance") {
    const rx = mov.prescribedDistanceMale ?? mov.prescribedDistanceFemale;
    return {
      label: "Distance used (m)",
      unit: "m",
      placeholder: rx != null ? `Rx: ${rx} m` : "Distance completed",
    };
  }
  if (mov.metricType === "duration") {
    const rxSec =
      mov.prescribedDurationSecondsMale ?? mov.prescribedDurationSecondsFemale;
    return {
      label: "Duration held (sec)",
      unit: "sec",
      placeholder:
        rxSec != null ? `Rx: ${formatSecondsAsClock(rxSec)}` : "Time held",
    };
  }

  // Weight — prefer absolute lb, fall back to BW multiplier resolved
  // against the athlete's logged bodyweight.
  const resolved = resolveRxWeightLb(gender, mov, userBodyWeightLb);
  let placeholder = "Weight used";
  if (resolved != null) {
    const mult =
      gender === "female"
        ? mov.prescribedWeightFemaleBwMultiplier ??
          mov.prescribedWeightMaleBwMultiplier
        : mov.prescribedWeightMaleBwMultiplier ??
          mov.prescribedWeightFemaleBwMultiplier;
    if (mov.prescribedWeightMale || mov.prescribedWeightFemale) {
      placeholder = `Rx: ${resolved} lb`;
    } else if (mult != null) {
      placeholder = `Rx: ${mult}× BW = ${resolved} lb`;
    } else {
      placeholder = `Rx: ${resolved} lb`;
    }
  } else {
    const mult =
      gender === "female"
        ? mov.prescribedWeightFemaleBwMultiplier ??
          mov.prescribedWeightMaleBwMultiplier
        : mov.prescribedWeightMaleBwMultiplier ??
          mov.prescribedWeightFemaleBwMultiplier;
    if (mult != null) {
      placeholder = `Rx: ${mult}× bodyweight (set bodyweight to resolve)`;
    } else if (mov.prescribedWeightMale) {
      placeholder = `Rx: ${mov.prescribedWeightMale} lb`;
    }
  }
  return {
    label: "Weight used (lb)",
    unit: "lb",
    placeholder,
  };
}

interface ScalingModification {
  value: string;
  fieldType: ScalingFieldType;
  repsLabel?: string;
  repsPlaceholder?: string;
}

const MODIFICATION_OPTIONS: ScalingModification[] = [
  { value: "Lighter weight", fieldType: "weight" },
  {
    value: "Fewer reps",
    fieldType: "reps",
    repsLabel: "Reps / time completed",
    repsPlaceholder: 'e.g. "50" or "2 min practice"',
  },
  {
    value: "Alternate movement",
    fieldType: "reps",
    repsLabel: "What you did",
    repsPlaceholder: 'e.g. "2 min DU practice", "Singles"',
  },
  { value: "Banded", fieldType: "none" },
  { value: "Ring rows", fieldType: "none" },
  { value: "Jumping", fieldType: "none" },
  { value: "Strict", fieldType: "none" },
  { value: "Kipping", fieldType: "none" },
  { value: "Box-assisted", fieldType: "none" },
  { value: "Reduced ROM", fieldType: "none" },
  { value: "Step-ups instead", fieldType: "none" },
  { value: "Singles instead", fieldType: "none" },
  { value: "Other", fieldType: "none" },
];

const MODIFICATION_BY_VALUE = new Map(
  MODIFICATION_OPTIONS.map((m) => [m.value, m])
);

// ============================================
// Per-part state
// ============================================

interface PartState {
  // null = user hasn't picked yet; required before save
  division: "rx" | "scaled" | "rx_plus" | null;
  timeSeconds?: number;
  hitTimeCap: boolean;
  totalReps: string;
  rounds: string;
  remainderReps: string;
  weightLbs: string;
  scoreText: string;
  rpe: number;
  notes: string;
  // Keyed by **movement_id** (not workout_movement_id) so the same movement
  // appearing multiple times in a part only needs one scaling entry. On save,
  // this scaling is spread to every workout_movement occurrence of that movement.
  movementScalings: Record<string, Partial<MovementScaling>>;
  // Keyed by workout_movement_id — set entries are per-occurrence (one row
  // per barbell per set in a for_load part). Drafts hold strings so the
  // user can type without losing focus; commit to numbers on save.
  setEntriesMap: Record<string, SetEntryDraft[]>;
  // Per-occurrence (workout_movement_id) drafts for the new fields. Held
  // as strings so the user can type freely and we parse on save.
  durationDrafts: Record<string, string>;
  heightDrafts: Record<string, string>;
  // Per-occurrence per-round rep drafts for max-reps movements.
  // map[workoutMovementId] = ["8", "7", "6", ...] — one slot per round.
  maxRepsDrafts: Record<string, string[]>;
}

export interface SetEntryDraft {
  weight: string;
  reps: string;
  rpe: string;
}

function emptyPartState(
  part: WorkoutPartDisplay | null,
  existing?: ScoreDisplay | null
): PartState {
  const scalings: Record<string, Partial<MovementScaling>> = {};
  const setEntriesMap: Record<string, SetEntryDraft[]> = {};
  const durationDrafts: Record<string, string> = {};
  const heightDrafts: Record<string, string> = {};
  const maxRepsDrafts: Record<string, string[]> = {};

  // Walk existing movementDetails (keyed by workout_movement_id) and collapse
  // down to one entry per movement_id. Different occurrences of the same
  // movement are expected to share scaling — if they diverge, the first one
  // wins (rare; acceptable fidelity loss).
  if (existing?.movementDetails && part) {
    const wmIdToMovementId = new Map<string, string>();
    for (const mov of part.movements) wmIdToMovementId.set(mov.id, mov.movementId);
    for (const d of existing.movementDetails) {
      const mId = wmIdToMovementId.get(d.workoutMovementId);
      if (mId && !scalings[mId]) {
        scalings[mId] = {
          wasRx: d.wasRx,
          actualWeight: d.actualWeight,
          actualReps: d.actualReps,
          modification: d.modification,
          substitutionMovementId: d.substitutionMovementId,
          notes: d.notes,
        };
      }
      if (d.setEntries && d.setEntries.length > 0) {
        setEntriesMap[d.workoutMovementId] = d.setEntries.map((e) => ({
          weight: e.weight.toString(),
          reps: e.reps != null ? e.reps.toString() : "",
          rpe: e.rpe != null ? e.rpe.toString() : "",
        }));
      }
      if (d.actualDurationSeconds != null) {
        durationDrafts[d.workoutMovementId] = formatSecondsAsClock(
          d.actualDurationSeconds
        );
      }
      if (d.actualHeightInches != null) {
        heightDrafts[d.workoutMovementId] = String(d.actualHeightInches);
      }
      if (d.actualRepsPerRound && d.actualRepsPerRound.length > 0) {
        maxRepsDrafts[d.workoutMovementId] = d.actualRepsPerRound.map((n) =>
          String(n)
        );
      }
    }
  }

  return {
    division: existing?.division ?? null,
    timeSeconds: existing?.timeSeconds,
    hitTimeCap: existing?.hitTimeCap ?? false,
    totalReps: existing?.totalReps?.toString() ?? "",
    rounds: existing?.rounds?.toString() ?? "",
    remainderReps: existing?.remainderReps?.toString() ?? "",
    weightLbs: existing?.weightLbs ?? "",
    scoreText: existing?.scoreText ?? "",
    rpe: existing?.rpe ?? 7,
    notes: existing?.notes ?? "",
    movementScalings: scalings,
    setEntriesMap,
    durationDrafts,
    heightDrafts,
    maxRepsDrafts,
  };
}

// Returns one movement per distinct movement_id, in first-occurrence order.
function distinctMovements(part: WorkoutPartDisplay) {
  const seen = new Set<string>();
  const out: typeof part.movements = [];
  for (const m of part.movements) {
    if (seen.has(m.movementId)) continue;
    seen.add(m.movementId);
    out.push(m);
  }
  return out;
}

// Compact one-liner of a movement's prescription: reps, duration, height.
// Used by the read-only block outline so chipper-style WODs surface the
// :30 next to "Rest" and the 24 in next to "Box step-up" without redirecting
// the athlete to the score-entry form.
function outlinePrescription(m: WorkoutMovementDisplay): string {
  const segments: string[] = [];
  if (m.prescribedReps) segments.push(m.prescribedReps);
  const dur =
    m.prescribedDurationSecondsMale ?? m.prescribedDurationSecondsFemale;
  if (dur != null) {
    segments.push(formatSecondsAsClock(dur));
  }
  const heightSegment = formatGenderedHeight(
    m.prescribedHeightInchesMale ?? null,
    m.prescribedHeightInchesFemale ?? null,
    m.prescribedHeightInches ?? null
  );
  if (heightSegment) segments.push(heightSegment);
  return segments.join(" · ");
}

// Read-only outline of the active part's movements grouped by block titles.
// Surfaces "Buy-in / Main set / Buy-out" structure for chipper-style
// benchmarks (Drew, etc.) while the athlete is logging — score inputs
// remain part-level, so this is reference only.
function PartBlockOutline({ part }: { part: WorkoutPartDisplay }) {
  const orderedBlocks = [...part.blocks].sort(
    (a, b) => a.orderIndex - b.orderIndex
  );
  const ungrouped = part.movements.filter((m) => !m.workoutBlockId);
  const movementsByBlock = new Map<string, typeof part.movements>();
  for (const m of part.movements) {
    if (!m.workoutBlockId) continue;
    const list = movementsByBlock.get(m.workoutBlockId) ?? [];
    list.push(m);
    movementsByBlock.set(m.workoutBlockId, list);
  }
  const renderLine = (m: WorkoutMovementDisplay) => {
    const details = outlinePrescription(m);
    return (
      <li key={m.id} className="text-muted-foreground">
        · {m.movementName}
        {details ? ` ${details}` : ""}
      </li>
    );
  };
  return (
    <div className="space-y-2 rounded-lg border border-border/40 bg-muted/20 p-3 text-xs">
      {ungrouped.length > 0 && (
        <ul className="space-y-0.5">{ungrouped.map(renderLine)}</ul>
      )}
      {orderedBlocks.map((b) => {
        const ms = movementsByBlock.get(b.id) ?? [];
        if (ms.length === 0) return null;
        return (
          <div key={b.id} className="space-y-0.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
              {b.title}
            </div>
            <ul className="space-y-0.5">{ms.map(renderLine)}</ul>
          </div>
        );
      })}
    </div>
  );
}

// ============================================
// Helpers
// ============================================

function repSchemeParts(repScheme?: string): number[] {
  if (!repScheme) return [];
  return repScheme
    .split("-")
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map((s) => parseInt(s, 10));
}

function setsFromRepScheme(repScheme?: string): number {
  const parts = repSchemeParts(repScheme);
  if (parts.length > 0) return Math.min(parts.length, MAX_SET_INPUTS);
  return 1;
}

// For Load set count. An explicit prescribed set count (`rounds` — surfaced
// in the builder as "Sets", required for complexes where the per-movement
// rep scheme is a single number) wins over the dash-derived scheme count.
// Falls back to the rep scheme so legacy for_load workouts that predate the
// Sets field render exactly as before.
function setCountForLoad(
  rounds: number | undefined | null,
  repScheme?: string
): number {
  if (rounds && rounds > 0) return Math.min(rounds, MAX_SET_INPUTS);
  return setsFromRepScheme(repScheme);
}

function repsPerSetFromRepScheme(repScheme?: string): number {
  const parts = repSchemeParts(repScheme);
  if (parts.length > 0) {
    // Use the last set's reps for e1RM (usually the heaviest working set).
    return parts[parts.length - 1];
  }
  return 1;
}

function prescribedRepsForSet(repScheme: string | undefined, setIdx: number): number | undefined {
  const parts = repSchemeParts(repScheme);
  if (parts.length === 0) return undefined;
  if (setIdx < parts.length) return parts[setIdx];
  // Out-of-bounds (extra set added) — fall back to last prescribed value.
  return parts[parts.length - 1];
}

// The TimeInput owns its own string drafts so the user can type "06" in
// seconds without the browser stripping the leading zero (the old type="number"
// input did). On mount we seed from `value`; we never re-sync afterwards — the
// parent is expected to remount the component with a `key` when it wants to
// load a fresh value (e.g. switching between parts).
function TimeInput({
  value,
  onChange,
  label,
}: {
  value: number | undefined;
  onChange: (seconds: number | undefined) => void;
  label: string;
}) {
  const [minDraft, setMinDraft] = useState(() =>
    value !== undefined ? Math.floor(value / 60).toString() : ""
  );
  const [secDraft, setSecDraft] = useState(() =>
    value !== undefined ? (value % 60).toString().padStart(2, "0") : ""
  );

  const commit = (m: string, s: string) => {
    if (!m && !s) {
      onChange(undefined);
      return;
    }
    const minutes = parseInt(m) || 0;
    const seconds = Math.min(59, parseInt(s) || 0);
    onChange(minutes * 60 + seconds);
  };

  const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.replace(/\D/g, "").slice(0, 3);
    setMinDraft(v);
    commit(v, secDraft);
  };

  const handleSecChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.replace(/\D/g, "").slice(0, 2);
    setSecDraft(v);
    commit(minDraft, v);
  };

  const handleSecBlur = () => {
    if (secDraft.length === 1) {
      const padded = secDraft.padStart(2, "0");
      setSecDraft(padded);
      commit(minDraft, padded);
    }
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-1.5">
        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={3}
          value={minDraft}
          onChange={handleMinChange}
          placeholder="MM"
          className="w-16 text-center font-mono text-lg"
          autoComplete="off"
        />
        <span className="text-lg font-bold text-muted-foreground">:</span>
        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={2}
          value={secDraft}
          onChange={handleSecChange}
          onBlur={handleSecBlur}
          placeholder="SS"
          className="w-16 text-center font-mono text-lg"
          autoComplete="off"
        />
      </div>
    </div>
  );
}

// ============================================
// Props
// ============================================

interface ScoreEntryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workoutId: string;
  workoutTitle?: string;
  parts: WorkoutPartDisplay[];
  initialPartId?: string;
  onSubmit?: (partId: string, score: ScoreInput) => void;
  // Workout-level signal for the vest toggle. Pass when the workout has
  // a vest prescription (e.g. Murph). If omitted, the vest UI is hidden.
  workout?: Pick<
    WorkoutDisplay,
    "requiresVest" | "vestWeightMaleLb" | "vestWeightFemaleLb"
  >;
  // "Log for…" dependent picker (family_memberships, spec §8). When
  // candidates are non-empty the sheet shows a dropdown to attribute the
  // score to a dependent instead of the signed-in user. The active gym's
  // communityId is required for the candidates list — the consumer
  // passes both.
  communityId?: string | null;
}

// ============================================
// Component
// ============================================

export function ScoreEntry({
  open,
  onOpenChange,
  workoutId,
  workoutTitle,
  parts,
  initialPartId,
  onSubmit,
  workout,
  communityId,
}: ScoreEntryProps) {
  // forUserId is null for "log for myself" (the default), or a
  // dependent's userId when the account holder picked one from the
  // dropdown. Threaded into buildScoreInput below.
  const [forUserId, setForUserId] = useState<string | null>(null);
  const { data: logForData } = useLogForCandidates(communityId);
  const dependents = logForData?.candidates ?? [];
  const [activePartId, setActivePartId] = useState<string>(
    () => initialPartId ?? parts[0]?.id ?? ""
  );
  const [divisionError, setDivisionError] = useState<string | null>(null);
  const { data: profile } = useUserProfile();
  // Movement library — used by the per-movement details renderer to look
  // up rx_fields off the canonical movement (Phase 2 movement settings).
  // Falls back to legacy heuristics when the lookup is empty (cold cache,
  // un-backfilled movement).
  const { data: movementLibrary = [] } = useMovements();
  const userBodyWeightLb = profile?.bodyWeightLb ?? null;
  const gender =
    profile?.gender === "male" ||
    profile?.gender === "female" ||
    profile?.gender === "other"
      ? profile.gender
      : null;

  const requiresVest = !!workout?.requiresVest;
  const defaultVestWeightLb =
    gender === "female"
      ? workout?.vestWeightFemaleLb ?? workout?.vestWeightMaleLb ?? null
      : workout?.vestWeightMaleLb ?? workout?.vestWeightFemaleLb ?? null;

  // Workout-level vest state. The toggle defaults to "wore the vest" =
  // true when the workout requires one — matches the intuition that an
  // athlete logging a Murph score with vest on by default is the common
  // case. Switching to "false" surfaces an inline warning but doesn't
  // auto-flip division.
  const [woreVest, setWoreVest] = useState<boolean>(true);
  const [vestWeightLbDraft, setVestWeightLbDraft] = useState<string>(
    defaultVestWeightLb != null ? String(defaultVestWeightLb) : ""
  );

  // One state slot per part, seeded from each part's existing score.
  // The parent remounts ScoreEntry for each target workout, so initial seeding
  // is sufficient — no re-sync effect needed.
  const [partStates, setPartStates] = useState<Record<string, PartState>>(() => {
    const initial: Record<string, PartState> = {};
    for (const p of parts) initial[p.id] = emptyPartState(p, p.score ?? null);
    return initial;
  });

  const activePart = useMemo(
    () => parts.find((p) => p.id === activePartId) ?? parts[0],
    [parts, activePartId]
  );
  const state = partStates[activePart?.id] ?? emptyPartState(null, null);

  const updateState = useCallback(
    (partId: string, updates: Partial<PartState>) => {
      setPartStates((prev) => ({
        ...prev,
        [partId]: { ...prev[partId], ...updates },
      }));
    },
    []
  );

  const updateMovementScaling = useCallback(
    (partId: string, movId: string, updates: Partial<MovementScaling>) => {
      setPartStates((prev) => ({
        ...prev,
        [partId]: {
          ...prev[partId],
          movementScalings: {
            ...prev[partId].movementScalings,
            [movId]: { ...prev[partId].movementScalings[movId], ...updates },
          },
        },
      }));
    },
    []
  );

  // Update a single field (weight, reps, or rpe) on a single set draft.
  // Auto-grows the array up to setIdx so the user can edit Set 3 even if
  // Set 1 and 2 are empty.
  const updateSetEntry = useCallback(
    (
      partId: string,
      movId: string,
      setIdx: number,
      field: "weight" | "reps" | "rpe",
      value: string,
      defaultReps?: number
    ) => {
      setPartStates((prev) => {
        const current = prev[partId].setEntriesMap[movId] ?? [];
        const updated = [...current];
        for (let i = updated.length; i <= setIdx; i++) {
          updated[i] = {
            weight: "",
            reps: defaultReps != null ? String(defaultReps) : "",
            rpe: "",
          };
        }
        updated[setIdx] = { ...updated[setIdx], [field]: value };
        return {
          ...prev,
          [partId]: {
            ...prev[partId],
            setEntriesMap: {
              ...prev[partId].setEntriesMap,
              [movId]: updated,
            },
          },
        };
      });
    },
    []
  );

  // ============================================
  // Build and submit ScoreInput per part
  // ============================================

  const buildScoreInput = useCallback(
    (
      part: WorkoutPartDisplay,
      st: PartState & { division: NonNullable<PartState["division"]> }
    ): ScoreInput => {
      // Scaling details are only meaningful when the user picked Scaled.
      // For Rx / Rx+, discard any per-movement scaling the user may have
      // left in state (from a prior toggle), but keep setEntries — those
      // are the canonical record of what was lifted on for_load parts.
      const includeScalingDetails = st.division === "scaled";
      // For a complex, the per-set load lives only on the lead movement —
      // guard against stale per-movement entries from an earlier log.
      const isComplexPart = part.structure === "complex";
      const complexAnchorId = isComplexPart
        ? part.movements.find((m) => m.metricType !== "duration")?.id
        : undefined;
      const scalings: MovementScaling[] = part.movements.map((mov) => {
        const scaling = st.movementScalings[mov.movementId] ?? {};
        const setEntries: SetEntry[] = (st.setEntriesMap[mov.id] ?? [])
          .map((draft): SetEntry | null => {
            const weight = parseFloat(draft.weight);
            if (!Number.isFinite(weight) || weight <= 0) return null;
            const reps = parseInt(draft.reps, 10);
            const rpe = parseFloat(draft.rpe);
            return {
              weight,
              ...(Number.isFinite(reps) && reps > 0 ? { reps } : {}),
              ...(Number.isFinite(rpe) && rpe >= 1 && rpe <= 10 ? { rpe } : {}),
            };
          })
          .filter((e): e is SetEntry => e !== null);
        const durDraft = st.durationDrafts[mov.id];
        const durSec = durDraft ? parseDurationToSeconds(durDraft) : null;
        const heightDraft = st.heightDrafts[mov.id];
        const heightInches = heightDraft ? parseFloat(heightDraft) : NaN;
        // Max-reps per-round drafts → INTEGER[]. Empty rounds become 0
        // (so an athlete who DNF'd round 7 still gets a contiguous array
        // matching part.rounds).
        const maxDrafts = st.maxRepsDrafts[mov.id];
        let actualRepsPerRound: number[] | undefined;
        if (mov.isMaxReps && maxDrafts && maxDrafts.length > 0) {
          actualRepsPerRound = maxDrafts.map((s) => {
            const n = parseInt(s, 10);
            return Number.isFinite(n) && n >= 0 ? n : 0;
          });
        }
        // Duration / height are only meaningful when the athlete deviated
        // from the prescription. The scaling card surfaces these inputs
        // exclusively when the movement is flagged scaled, so we mirror
        // that gate here — Rx and Rx+ rows never carry an "actual" value.
        const movWasScaled = includeScalingDetails && scaling.wasRx === false;
        return {
          workoutMovementId: mov.id,
          wasRx: includeScalingDetails ? (scaling.wasRx ?? true) : true,
          actualWeight: includeScalingDetails ? scaling.actualWeight : undefined,
          actualReps: includeScalingDetails ? scaling.actualReps : undefined,
          modification: includeScalingDetails ? scaling.modification : undefined,
          substitutionMovementId: includeScalingDetails
            ? scaling.substitutionMovementId
            : undefined,
          setEntries:
            setEntries.length > 0 &&
            (!isComplexPart || mov.id === complexAnchorId)
              ? setEntries
              : undefined,
          actualDurationSeconds: movWasScaled
            ? (durSec ?? undefined)
            : undefined,
          actualHeightInches:
            movWasScaled &&
            Number.isFinite(heightInches) &&
            heightInches > 0
              ? heightInches
              : undefined,
          actualRepsPerRound,
          notes: includeScalingDetails ? scaling.notes : undefined,
        };
      });

      // Auto-sum totalReps from max-reps movements when the part has any.
      // The user can still override via the "Total Reps" input — we
      // prefer their explicit value when set.
      const sumFromMaxReps = scalings.reduce((acc, s) => {
        if (!s.actualRepsPerRound) return acc;
        return acc + s.actualRepsPerRound.reduce((a, b) => a + b, 0);
      }, 0);
      const partHasMaxReps = part.movements.some((m) => m.isMaxReps);

      const vestWeightNumeric = parseFloat(vestWeightLbDraft);
      const score: ScoreInput = {
        workoutId,
        workoutPartId: part.id,
        ...(forUserId ? { forUserId } : {}),
        division: st.division,
        hitTimeCap: st.hitTimeCap,
        notes: st.notes || undefined,
        rpe: st.rpe,
        movementScalings: scalings,
        ...(requiresVest
          ? {
              woreVest,
              vestWeightLb:
                woreVest && Number.isFinite(vestWeightNumeric) && vestWeightNumeric > 0
                  ? vestWeightNumeric
                  : undefined,
            }
          : {}),
      };

      switch (part.workoutType) {
        case "for_time":
          if (st.hitTimeCap) {
            score.totalReps = st.totalReps ? parseInt(st.totalReps) : undefined;
            score.timeSeconds = part.timeCapSeconds;
          } else {
            score.timeSeconds = st.timeSeconds;
          }
          break;
        case "amrap":
          score.rounds = st.rounds ? parseInt(st.rounds) : undefined;
          score.remainderReps = st.remainderReps
            ? parseInt(st.remainderReps)
            : undefined;
          break;
        case "for_load": {
          const explicit = st.weightLbs ? parseFloat(st.weightLbs) : undefined;
          const maxFromSets = Math.max(
            0,
            ...scalings.flatMap((s) => (s.setEntries ?? []).map((e) => e.weight))
          );
          score.weightLbs = explicit ?? (maxFromSets > 0 ? maxFromSets : undefined);
          break;
        }
        case "for_reps":
        case "for_calories":
        case "intervals":
        case "max_effort":
          // Prefer explicit total when typed; otherwise sum the max-reps
          // movement contributions. This is what "8 rounds × max C&Js" workouts
          // score by — the athlete enters per-round, we compute the total.
          score.totalReps = st.totalReps
            ? parseInt(st.totalReps)
            : partHasMaxReps && sumFromMaxReps > 0
              ? sumFromMaxReps
              : undefined;
          break;
        case "emom":
        case "tabata":
          score.scoreText = st.scoreText || undefined;
          break;
        default:
          score.scoreText = st.scoreText || undefined;
      }

      return score;
    },
    [workoutId, requiresVest, woreVest, vestWeightLbDraft, forUserId]
  );

  const partHasData = useCallback(
    (part: WorkoutPartDisplay, st: PartState): boolean => {
      switch (part.workoutType) {
        case "for_time":
          return st.timeSeconds != null || st.hitTimeCap;
        case "amrap":
          return !!st.rounds || !!st.remainderReps;
        case "for_load":
          return (
            !!st.weightLbs ||
            Object.values(st.setEntriesMap).some((entries) =>
              entries.some((e) => parseFloat(e.weight) > 0)
            )
          );
        case "for_reps":
        case "for_calories":
        case "intervals":
        case "max_effort":
          return (
            !!st.totalReps ||
            // Per-round entries on a max-reps movement count as data — the
            // user shouldn't have to also type the total in the explicit
            // input when they've been clicking through round inputs.
            Object.values(st.maxRepsDrafts).some((rounds) =>
              rounds.some((r) => parseInt(r, 10) > 0)
            )
          );
        default:
          return !!st.scoreText;
      }
    },
    []
  );

  const handleSubmit = () => {
    // Every part with data must have a division picked. If one doesn't,
    // jump to it so the user sees the inline error.
    const missing = parts.find((part) => {
      const st = partStates[part.id];
      return !!st && partHasData(part, st) && st.division === null;
    });
    if (missing) {
      setActivePartId(missing.id);
      setDivisionError("Please select a division before saving.");
      return;
    }

    for (const part of parts) {
      const st = partStates[part.id];
      if (!st) continue;
      if (!partHasData(part, st)) continue;
      if (st.division === null) continue;
      const score = buildScoreInput(part, { ...st, division: st.division });
      onSubmit?.(part.id, score);
    }
    onOpenChange(false);
  };

  // ============================================
  // Render scoring inputs for the active part
  // ============================================

  if (!activePart) return null;
  const isEditing = !!activePart.score;
  const workoutType = activePart.workoutType;

  const renderScoreInputs = () => {
    switch (workoutType) {
      case "for_time":
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Switch
                checked={state.hitTimeCap}
                onCheckedChange={(checked) =>
                  updateState(activePart.id, { hitTimeCap: !!checked })
                }
              />
              <Label className="text-sm">Hit time cap</Label>
              {state.hitTimeCap && activePart.timeCapSeconds && (
                <span className="text-xs text-muted-foreground">
                  ({Math.floor(activePart.timeCapSeconds / 60)}:
                  {(activePart.timeCapSeconds % 60).toString().padStart(2, "0")})
                </span>
              )}
            </div>

            {state.hitTimeCap ? (
              <div className="space-y-2">
                <Label htmlFor="se-total-reps">Total Reps Completed</Label>
                <Input
                  id="se-total-reps"
                  type="number"
                  min={0}
                  value={state.totalReps}
                  onChange={(e) =>
                    updateState(activePart.id, { totalReps: e.target.value })
                  }
                  placeholder="e.g. 102"
                />
              </div>
            ) : (
              <TimeInput
                key={`time-${activePart.id}`}
                value={state.timeSeconds}
                onChange={(v) => updateState(activePart.id, { timeSeconds: v })}
                label="Completion Time"
              />
            )}
          </div>
        );

      case "amrap":
        return (
          <div className="grid gap-4 grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="se-rounds">Rounds</Label>
              <Input
                id="se-rounds"
                type="number"
                min={0}
                value={state.rounds}
                onChange={(e) =>
                  updateState(activePart.id, { rounds: e.target.value })
                }
                placeholder="e.g. 5"
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="se-extra-reps">+ Extra Reps</Label>
              <Input
                id="se-extra-reps"
                type="number"
                min={0}
                value={state.remainderReps}
                onChange={(e) =>
                  updateState(activePart.id, { remainderReps: e.target.value })
                }
                placeholder="e.g. 12"
                className="font-mono"
              />
            </div>
            {state.rounds && (
              <div className="col-span-2 text-center">
                <span className="font-mono text-lg font-semibold text-foreground">
                  {state.rounds} rds
                  {state.remainderReps ? ` + ${state.remainderReps} reps` : ""}
                </span>
              </div>
            )}
          </div>
        );

      case "for_load": {
        // For Load: weight IS the score, so render per-set inputs for every
        // movement in the part. We don't gate on `isWeighted` because that
        // flag lives on the canonical movement and is unreliable when a row
        // was created on-the-fly via the typeahead (the POST handler
        // defaults it to false). Duration-typed movements (Rest, Plank) are
        // skipped — a weight input there doesn't make sense.
        const loadMovements = activePart.movements.filter(
          (m) => m.metricType !== "duration"
        );

        // A complex is one barbell — the load doesn't change between
        // movements, so there's a single weight per *set*, not per movement.
        // We render one set-weight row and store it against the lead movement
        // (`anchor`), which the per-movement save/score path picks up
        // unchanged (the other movements simply carry no set entries).
        if (activePart.structure === "complex" && loadMovements.length > 0) {
          const anchor = loadMovements[0];
          const sets = setCountForLoad(
            activePart.rounds,
            anchor.prescribedReps
          );
          const drafts = state.setEntriesMap[anchor.id] ?? [];
          const displayEntries: SetEntry[] = Array.from(
            { length: sets },
            (_, i) => {
              const w = drafts[i] ? parseFloat(drafts[i].weight) : NaN;
              return Number.isFinite(w) && w > 0 ? { weight: w } : { weight: 0 };
            }
          );
          return (
            <div className="space-y-2 rounded-lg border border-border/50 bg-muted/20 p-3">
              <Label className="text-xs font-medium">
                Set weights
                <span className="ml-1 font-normal text-muted-foreground">
                  · one weight per set — the bar doesn&apos;t come down
                </span>
              </Label>
              <div
                className="grid gap-1.5"
                style={{
                  gridTemplateColumns: `repeat(${Math.min(sets, 5)}, minmax(0, 1fr))`,
                }}
              >
                {Array.from({ length: sets }, (_, i) => {
                  const draft = drafts[i];
                  return (
                    <div key={i} className="space-y-1">
                      <Input
                        type="number"
                        value={draft?.weight ?? ""}
                        onChange={(e) =>
                          updateSetEntry(
                            activePart.id,
                            anchor.id,
                            i,
                            "weight",
                            e.target.value
                          )
                        }
                        placeholder={`Set ${i + 1}`}
                        className="h-8 text-xs font-mono text-center"
                        aria-label={`Set ${i + 1} weight`}
                      />
                      <Input
                        type="number"
                        min={1}
                        max={10}
                        step="0.5"
                        value={draft?.rpe ?? ""}
                        onChange={(e) =>
                          updateSetEntry(
                            activePart.id,
                            anchor.id,
                            i,
                            "rpe",
                            e.target.value
                          )
                        }
                        placeholder="RPE"
                        className="h-6 text-[10px] font-mono text-center text-muted-foreground"
                        aria-label={`Set ${i + 1} RPE`}
                      />
                    </div>
                  );
                })}
              </div>
              <SetWeightBreakdown entries={displayEntries} />
            </div>
          );
        }

        return (
          <div className="space-y-4">
            {/* Per-movement set weights — the canonical data. Each movement
                carries its own rep scheme (e.g. Deadlift "10-10-7-7-3-3-3"),
                so we derive set count per movement and fall back to the
                part-level scheme for legacy/parsed workouts. */}
            {loadMovements.map((mov) => {
                const movScheme =
                  mov.prescribedReps || activePart.repScheme;
                const sets = setCountForLoad(activePart.rounds, movScheme);
                const fallbackRepsPerSet = repsPerSetFromRepScheme(movScheme);
                const drafts = state.setEntriesMap[mov.id] ?? [];
                // Resolve drafts → SetEntry[] for the breakdown display.
                // Empty reps fall back to the per-set prescription so the
                // e1RM estimate is sensible from the moment a weight is typed.
                const displayEntries: SetEntry[] = Array.from(
                  { length: sets },
                  (_, i) => {
                    const d = drafts[i];
                    const w = d ? parseFloat(d.weight) : NaN;
                    if (!Number.isFinite(w) || w <= 0) return { weight: 0 };
                    const typedReps = d ? parseInt(d.reps, 10) : NaN;
                    const reps = Number.isFinite(typedReps) && typedReps > 0
                      ? typedReps
                      : prescribedRepsForSet(movScheme, i) ?? fallbackRepsPerSet;
                    return { weight: w, reps };
                  }
                );
                return (
                  <div
                    key={mov.id}
                    className="space-y-2 rounded-lg border border-border/50 bg-muted/20 p-3"
                  >
                    <Label className="text-xs font-medium">
                      {mov.movementName}
                      {movScheme && (
                        <span className="ml-1 text-muted-foreground font-normal">
                          · {movScheme}
                        </span>
                      )}
                    </Label>
                    <div
                      className="grid gap-1.5"
                      style={{
                        gridTemplateColumns: `repeat(${Math.min(sets, 5)}, minmax(0, 1fr))`,
                      }}
                    >
                      {Array.from({ length: sets }, (_, i) => {
                        const draft = drafts[i];
                        const prescribed = prescribedRepsForSet(movScheme, i);
                        return (
                          <div key={i} className="space-y-1">
                            <Input
                              type="number"
                              value={draft?.weight ?? ""}
                              onChange={(e) =>
                                updateSetEntry(
                                  activePart.id,
                                  mov.id,
                                  i,
                                  "weight",
                                  e.target.value,
                                  prescribed
                                )
                              }
                              placeholder={`Set ${i + 1}`}
                              className="h-8 text-xs font-mono text-center"
                              aria-label={`Set ${i + 1} weight`}
                            />
                            <Input
                              type="number"
                              value={draft?.reps ?? ""}
                              onChange={(e) =>
                                updateSetEntry(
                                  activePart.id,
                                  mov.id,
                                  i,
                                  "reps",
                                  e.target.value,
                                  prescribed
                                )
                              }
                              placeholder={
                                prescribed != null
                                  ? `${prescribed} reps`
                                  : "reps"
                              }
                              className="h-6 text-[10px] font-mono text-center text-muted-foreground"
                              aria-label={`Set ${i + 1} reps`}
                            />
                            <Input
                              type="number"
                              min={1}
                              max={10}
                              step="0.5"
                              value={draft?.rpe ?? ""}
                              onChange={(e) =>
                                updateSetEntry(
                                  activePart.id,
                                  mov.id,
                                  i,
                                  "rpe",
                                  e.target.value,
                                  prescribed
                                )
                              }
                              placeholder="RPE"
                              className="h-6 text-[10px] font-mono text-center text-muted-foreground"
                              aria-label={`Set ${i + 1} RPE`}
                            />
                          </div>
                        );
                      })}
                    </div>
                    <SetWeightBreakdown
                      entries={displayEntries}
                      repsPerSet={fallbackRepsPerSet}
                    />
                  </div>
                );
              })}

            {loadMovements.length === 0 && (
              <div className="space-y-2">
                <Label htmlFor="se-weight">Max Weight (lb)</Label>
                <Input
                  id="se-weight"
                  type="number"
                  min={0}
                  value={state.weightLbs}
                  onChange={(e) =>
                    updateState(activePart.id, { weightLbs: e.target.value })
                  }
                  placeholder="e.g. 225"
                  className="font-mono text-lg"
                />
              </div>
            )}
          </div>
        );
      }

      case "for_reps":
      case "for_calories":
      case "intervals":
      case "max_effort": {
        const partHasMax = activePart.movements.some((m) => m.isMaxReps);
        return (
          <div className="space-y-2">
            <Label htmlFor="se-total">
              {workoutType === "for_calories" ? "Total Calories" : "Total Reps"}
              {partHasMax && (
                <span className="ml-1 text-xs text-muted-foreground font-normal">
                  (auto from per-round inputs)
                </span>
              )}
            </Label>
            <Input
              id="se-total"
              type="number"
              min={0}
              value={state.totalReps}
              onChange={(e) =>
                updateState(activePart.id, { totalReps: e.target.value })
              }
              placeholder={partHasMax ? "Auto-summed below" : "e.g. 150"}
              className="font-mono text-lg"
            />
          </div>
        );
      }

      case "emom":
        return (
          <div className="space-y-2">
            <Label htmlFor="se-emom-score">Score / Notes</Label>
            <Input
              id="se-emom-score"
              value={state.scoreText}
              onChange={(e) =>
                updateState(activePart.id, { scoreText: e.target.value })
              }
              placeholder="e.g. Completed all rounds, or 8/10 rounds completed"
            />
          </div>
        );

      case "tabata":
        return (
          <div className="space-y-2">
            <Label htmlFor="se-tabata-score">Lowest Round / Total Reps</Label>
            <Input
              id="se-tabata-score"
              value={state.scoreText}
              onChange={(e) =>
                updateState(activePart.id, { scoreText: e.target.value })
              }
              placeholder="e.g. Lowest: 8, Total: 92"
            />
          </div>
        );

      default:
        return (
          <div className="space-y-2">
            <Label htmlFor="se-free">Score</Label>
            <Input
              id="se-free"
              value={state.scoreText}
              onChange={(e) =>
                updateState(activePart.id, { scoreText: e.target.value })
              }
              placeholder="Enter your score..."
            />
          </div>
        );
    }
  };

  const multiPart = parts.length > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10">
              <Trophy className="size-3.5 text-primary" />
            </div>
            {isEditing ? "Edit Score" : "Log Score"}
          </DialogTitle>
          <DialogDescription>
            {workoutTitle || "Workout"}
            {!multiPart && ` · ${WORKOUT_TYPE_LABELS[workoutType]}`}
          </DialogDescription>
          {dependents.length > 0 && (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <Label htmlFor="score-for-user" className="text-muted-foreground">
                Logging for
              </Label>
              <Select
                value={forUserId ?? "self"}
                onValueChange={(val) =>
                  setForUserId(val === "self" ? null : val)
                }
              >
                <SelectTrigger
                  id="score-for-user"
                  className="h-7 w-auto min-w-[8rem] text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="self">Yourself</SelectItem>
                  {dependents.map((d) => (
                    <SelectItem key={d.userId} value={d.userId}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {isEditing && activePart.score?.estimatedKcalActiveWithEpoc != null && (
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-xs text-orange-200">
              <span className="font-semibold">
                ≈ {activePart.score.estimatedKcalActiveWithEpoc} kcal
              </span>
              <span
                className="text-[10px] text-orange-200/70"
                title="Active-energy estimate based on movement MET values, your bodyweight, vest, RPE, and EPOC. Real burn varies ±20%."
              >
                est. active energy — your bodyweight applied
              </span>
            </div>
          )}
        </DialogHeader>

        {/* Part switcher */}
        {multiPart && (
          <div className="flex flex-wrap gap-1.5 rounded-lg border border-border/50 bg-muted/20 p-1">
            {parts.map((p, idx) => {
              const isActive = p.id === activePart.id;
              const label = p.label || `Part ${String.fromCharCode(65 + idx)}`;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActivePartId(p.id)}
                  className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  {label}
                  <span className="ml-1 opacity-70">
                    · {WORKOUT_TYPE_LABELS[p.workoutType]}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="space-y-6">
          {/* Block outline — read-only reference of the active part's
              movements grouped by block, so athletes see "Buy-in / Main set
              / Buy-out" while logging. Score inputs remain at the part
              level. Only renders when the part actually has blocks. */}
          {activePart.blocks.length > 0 && (
            <PartBlockOutline part={activePart} />
          )}

          {/* Division */}
          <div className="space-y-2">
            <Label>
              Division <span className="text-destructive">*</span>
            </Label>
            <div className="flex gap-2">
              {(["rx", "scaled", "rx_plus"] as const).map((div) => {
                const labels = { rx: "Rx", scaled: "Scaled", rx_plus: "Rx+" };
                const isActive = state.division === div;
                return (
                  <Button
                    key={div}
                    type="button"
                    variant={isActive ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      updateState(activePart.id, { division: div });
                      setDivisionError(null);
                    }}
                    className="flex-1"
                  >
                    {labels[div]}
                  </Button>
                );
              })}
            </div>
            {divisionError && (
              <p className="text-xs text-destructive">{divisionError}</p>
            )}
          </div>

          {/* Workout-level vest toggle. Only renders when the workout
              prescribes a vest. */}
          {requiresVest && (
            <div className="space-y-2 rounded-lg border border-border/40 bg-muted/20 p-3">
              <div className="flex items-center gap-2">
                <Shield className="size-4 text-amber-400" />
                <Label className="text-sm font-medium flex-1">
                  Wore the vest?
                </Label>
                <Switch
                  checked={woreVest}
                  onCheckedChange={(checked) => setWoreVest(!!checked)}
                />
              </div>
              {woreVest && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Vest weight (lb)
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.5"
                    value={vestWeightLbDraft}
                    onChange={(e) => setVestWeightLbDraft(e.target.value)}
                    placeholder={
                      defaultVestWeightLb != null
                        ? `Rx: ${defaultVestWeightLb} lb`
                        : "e.g. 20"
                    }
                    className="h-7 text-xs font-mono"
                  />
                </div>
              )}
              {!woreVest && state.division === "rx" && (
                <p className="flex items-start gap-1.5 text-[11px] text-amber-300/90">
                  <AlertTriangle className="size-3 mt-0.5 shrink-0" />
                  Without the vest this typically logs as Scaled. The score
                  will keep Rx and surface a &quot;No vest&quot; badge — the
                  leaderboard will reflect both signals.
                </p>
              )}
            </div>
          )}

          {/* Type-specific inputs */}
          {renderScoreInputs()}

          {/* Max-reps per-round inputs. For each movement flagged
              isMaxReps, render N inputs (N = part.rounds, fall back to 1
              if rounds is unset). Sum is shown live and feeds the
              part-level totalReps on save. */}
          {(() => {
            const maxMovements = activePart.movements.filter(
              (m) => m.isMaxReps
            );
            if (maxMovements.length === 0) return null;
            const rounds = activePart.rounds && activePart.rounds > 0
              ? activePart.rounds
              : 1;
            const totalAcrossMovements = maxMovements.reduce((acc, mov) => {
              const drafts = state.maxRepsDrafts[mov.id] ?? [];
              const movSum = drafts.reduce((a, s) => {
                const n = parseInt(s, 10);
                return a + (Number.isFinite(n) && n > 0 ? n : 0);
              }, 0);
              return acc + movSum;
            }, 0);
            return (
              <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="flex items-center gap-2">
                  <Label className="text-sm font-medium flex-1">
                    Max reps {rounds > 1 ? "per round" : ""}
                  </Label>
                  <span className="font-mono text-sm font-bold text-amber-300">
                    Total: {totalAcrossMovements}
                  </span>
                </div>
                {maxMovements.map((mov) => {
                  const drafts = state.maxRepsDrafts[mov.id] ?? [];
                  const movSum = drafts.reduce((a, s) => {
                    const n = parseInt(s, 10);
                    return a + (Number.isFinite(n) && n > 0 ? n : 0);
                  }, 0);
                  return (
                    <div key={mov.id} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium">
                          {mov.movementName}
                        </Label>
                        {maxMovements.length > 1 && (
                          <span className="text-[10px] text-muted-foreground font-mono">
                            sub-total: {movSum}
                          </span>
                        )}
                      </div>
                      <div
                        className="grid gap-1.5"
                        style={{
                          gridTemplateColumns: `repeat(${Math.min(rounds, 5)}, minmax(0, 1fr))`,
                        }}
                      >
                        {Array.from({ length: rounds }, (_, i) => (
                          <div key={i} className="space-y-0.5">
                            <Label className="text-[10px] text-muted-foreground text-center block">
                              {rounds > 1 ? `R${i + 1}` : "Reps"}
                            </Label>
                            <Input
                              type="number"
                              min={0}
                              value={drafts[i] ?? ""}
                              onChange={(e) =>
                                setPartStates((prev) => {
                                  const current =
                                    prev[activePart.id].maxRepsDrafts[mov.id] ?? [];
                                  const updated = [...current];
                                  for (let j = updated.length; j <= i; j++) {
                                    updated[j] = "";
                                  }
                                  updated[i] = e.target.value;
                                  return {
                                    ...prev,
                                    [activePart.id]: {
                                      ...prev[activePart.id],
                                      maxRepsDrafts: {
                                        ...prev[activePart.id].maxRepsDrafts,
                                        [mov.id]: updated,
                                      },
                                    },
                                  };
                                })
                              }
                              placeholder="0"
                              className="h-8 text-center font-mono text-xs"
                              aria-label={`${mov.movementName} round ${i + 1} reps`}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                <p className="text-[10px] text-muted-foreground">
                  Sum auto-fills the workout total. Type a value in &quot;Total
                  Reps&quot; above to override.
                </p>
              </div>
            );
          })()}

          <Separator />

          {/* Per-movement scaling — shown automatically when division is Scaled */}
          {activePart.movements.length > 0 && state.division === "scaled" && (
            <div className="space-y-4">
              <Label className="text-sm">Scaling details</Label>
              <div className="space-y-3">
                  {distinctMovements(activePart).map((mov) => {
                    const scaling = state.movementScalings[mov.movementId] ?? {};
                    const selectedMod = scaling.modification
                      ? MODIFICATION_BY_VALUE.get(scaling.modification)
                      : undefined;
                    const occurrences = activePart.movements.filter(
                      (m) => m.movementId === mov.movementId
                    );
                    const occurrenceCount = occurrences.length;

                    // Movement settings (rx_fields) drive whether to expose
                    // a Duration / Height input on this scaling card. Falls
                    // back to legacy heuristics (metric_type + presence of
                    // a prescribed height) when rx_fields is empty.
                    const libEntry = movementLibrary.find(
                      (m) => m.id === mov.movementId
                    );
                    const rxFields = libEntry?.rxFields ?? [];
                    const useRxFields = rxFields.length > 0;
                    const heightRx =
                      gender === "female"
                        ? mov.prescribedHeightInchesFemale ??
                          mov.prescribedHeightInchesMale ??
                          mov.prescribedHeightInches
                        : mov.prescribedHeightInchesMale ??
                          mov.prescribedHeightInchesFemale ??
                          mov.prescribedHeightInches;
                    const wantsDuration = useRxFields
                      ? rxFields.includes("duration")
                      : mov.metricType === "duration";
                    const wantsHeight = useRxFields
                      ? rxFields.includes("height")
                      : heightRx != null;
                    const rxSec =
                      mov.prescribedDurationSecondsMale ??
                      mov.prescribedDurationSecondsFemale;
                    // Drafts are stored per-occurrence (workout_movement_id);
                    // the panel itself is one card per movement_id. Read the
                    // first occurrence's draft for the input value, and on
                    // change broadcast to every occurrence so save emits a
                    // value for each row that the API expects.
                    const firstOccId = occurrences[0]?.id;
                    const durDraft =
                      firstOccId != null
                        ? state.durationDrafts[firstOccId] ?? ""
                        : "";
                    const heightDraft =
                      firstOccId != null
                        ? state.heightDrafts[firstOccId] ?? ""
                        : "";

                    return (
                      <div
                        key={mov.movementId}
                        className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">
                            {mov.movementName}
                            {occurrenceCount > 1 && (
                              <span className="ml-1.5 text-[10px] text-muted-foreground font-normal">
                                (×{occurrenceCount} in workout)
                              </span>
                            )}
                          </span>
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              scaling.wasRx === false
                                ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/30"
                                : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                            }`}
                          >
                            {scaling.wasRx === false ? "Scaled" : "Rx"}
                          </Badge>
                        </div>

                        <div className="flex items-center gap-3">
                          <Switch
                            checked={scaling.wasRx !== false}
                            onCheckedChange={(checked) =>
                              updateMovementScaling(
                                activePart.id,
                                mov.movementId,
                                { wasRx: !!checked }
                              )
                            }
                            size="sm"
                          />
                          <Label className="text-xs text-muted-foreground">
                            As prescribed
                          </Label>
                        </div>

                        {scaling.wasRx === false && (
                          <div className="space-y-2 pt-1">
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">
                                How did you scale?
                              </Label>
                              <Select
                                value={scaling.modification || ""}
                                onValueChange={(val) =>
                                  updateMovementScaling(
                                    activePart.id,
                                    mov.movementId,
                                    {
                                      modification: val || undefined,
                                      // Clear the contextual field when switching modification type
                                      actualWeight: undefined,
                                      actualReps: undefined,
                                    }
                                  )
                                }
                              >
                                <SelectTrigger className="h-7 text-xs">
                                  <SelectValue placeholder="Select how you scaled..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {MODIFICATION_OPTIONS.map((mod) => (
                                    <SelectItem key={mod.value} value={mod.value}>
                                      {mod.value}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            {/* Contextual field driven by modification choice.
                                For monostructural movements (rowers, runs)
                                we re-label "Weight used" to "Cals used" or
                                "Distance used" with the gendered Rx as the
                                placeholder hint — most "scaled" notes here
                                are "did 10 cal instead of 12". */}
                            {selectedMod?.fieldType === "weight" && (
                              <div className="space-y-1">
                                {(() => {
                                  const { label, unit, placeholder } =
                                    scaledMetricCopy(
                                      mov,
                                      userBodyWeightLb,
                                      gender
                                    );
                                  return (
                                    <>
                                      <Label className="text-xs text-muted-foreground">
                                        {label}
                                      </Label>
                                      <Input
                                        type="number"
                                        value={scaling.actualWeight ?? ""}
                                        onChange={(e) =>
                                          updateMovementScaling(
                                            activePart.id,
                                            mov.movementId,
                                            {
                                              actualWeight: e.target.value
                                                ? parseFloat(e.target.value)
                                                : undefined,
                                            }
                                          )
                                        }
                                        placeholder={placeholder}
                                        className="h-7 text-xs font-mono"
                                        aria-label={`${label} (${unit})`}
                                      />
                                    </>
                                  );
                                })()}
                              </div>
                            )}

                            {selectedMod?.fieldType === "reps" && (
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">
                                  {selectedMod.repsLabel ?? "Reps / time completed"}
                                </Label>
                                <Input
                                  value={scaling.actualReps ?? ""}
                                  onChange={(e) =>
                                    updateMovementScaling(
                                      activePart.id,
                                      mov.movementId,
                                      {
                                        actualReps: e.target.value || undefined,
                                      }
                                    )
                                  }
                                  placeholder={
                                    selectedMod.repsPlaceholder ??
                                    (mov.prescribedReps
                                      ? `Rx: ${mov.prescribedReps}`
                                      : "Reps completed")
                                  }
                                  className="h-7 text-xs"
                                />
                              </div>
                            )}

                            {/* Duration / height inputs — only the movements
                                whose prescription includes one of these (per
                                rx_fields) surface here, and only when the
                                athlete is logging this movement as scaled. */}
                            {wantsDuration && (
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">
                                  Actual duration
                                </Label>
                                <Input
                                  value={durDraft}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    setPartStates((prev) => {
                                      const drafts = {
                                        ...prev[activePart.id].durationDrafts,
                                      };
                                      for (const occ of occurrences) {
                                        drafts[occ.id] = value;
                                      }
                                      return {
                                        ...prev,
                                        [activePart.id]: {
                                          ...prev[activePart.id],
                                          durationDrafts: drafts,
                                        },
                                      };
                                    });
                                  }}
                                  placeholder={
                                    rxSec != null
                                      ? `Rx: ${formatSecondsAsClock(rxSec)}`
                                      : "Time held (e.g. :22)"
                                  }
                                  className="h-7 text-xs"
                                />
                              </div>
                            )}
                            {wantsHeight && (
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">
                                  Actual height (in)
                                </Label>
                                <Input
                                  type="number"
                                  min={0}
                                  step="0.5"
                                  value={heightDraft}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    setPartStates((prev) => {
                                      const drafts = {
                                        ...prev[activePart.id].heightDrafts,
                                      };
                                      for (const occ of occurrences) {
                                        drafts[occ.id] = value;
                                      }
                                      return {
                                        ...prev,
                                        [activePart.id]: {
                                          ...prev[activePart.id],
                                          heightDrafts: drafts,
                                        },
                                      };
                                    });
                                  }}
                                  placeholder={
                                    heightRx != null
                                      ? `Rx: ${heightRx} in`
                                      : "Height used"
                                  }
                                  className="h-7 text-xs"
                                />
                              </div>
                            )}

                            {/* Freeform notes — always available */}
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">
                                Notes
                              </Label>
                              <Textarea
                                value={scaling.notes ?? ""}
                                onChange={(e) =>
                                  updateMovementScaling(
                                    activePart.id,
                                    mov.movementId,
                                    {
                                      notes: e.target.value || undefined,
                                    }
                                  )
                                }
                                placeholder="Any context on this scale..."
                                rows={2}
                                className="text-xs"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          <Separator />

          {/* RPE */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>RPE (Rate of Perceived Exertion)</Label>
              <span className="font-mono text-sm font-semibold text-primary">
                {state.rpe}/10
              </span>
            </div>
            <Slider
              value={[state.rpe]}
              onValueChange={(val) =>
                updateState(activePart.id, {
                  rpe: Array.isArray(val) ? val[0] : val,
                })
              }
              min={1}
              max={10}
              step={1}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Easy</span>
              <span>Moderate</span>
              <span>Max Effort</span>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="se-notes">Notes</Label>
            <Textarea
              id="se-notes"
              value={state.notes}
              onChange={(e) =>
                updateState(activePart.id, { notes: e.target.value })
              }
              placeholder="How did it feel? What went well? What to improve?"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} className="w-full sm:w-auto">
            <Save className="size-4" />
            {multiPart
              ? isEditing
                ? "Update All"
                : "Save All"
              : isEditing
                ? "Update Score"
                : "Save Score"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
