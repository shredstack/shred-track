"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, ClipboardPaste, Wrench, Zap, Trophy, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WorkoutCard } from "@/components/crossfit/workout-card";
import { SmartBuilder } from "@/components/crossfit/smart-builder";
import { WorkoutParser } from "@/components/crossfit/workout-parser";
import { BenchmarkPicker } from "@/components/crossfit/benchmark-picker";
import { ScoreEntry } from "@/components/crossfit/score-entry";
import { DateNavigator } from "@/components/shared/date-navigator";
import {
  useWorkoutsByDate,
  useCreateWorkout,
  useUpdateWorkout,
  useDeleteWorkout,
  useLogScore,
  useUpdateScore,
  useMoveWorkoutToGym,
  type CreatePartInput,
  type WorkoutScopeFilter,
} from "@/hooks/useWorkouts";
import { useActiveMembership, useGymContext } from "@/hooks/useGymContext";
import { builderPartToPayload } from "@/lib/crossfit/builder-payload";
import { formatSecondsAsClock } from "@/lib/crossfit/duration-parser";
import { useMovements, useCreateMovement } from "@/hooks/useMovements";
import { useStickyTab } from "@/hooks/useStickyTab";
import type {
  WorkoutBuilderForm,
  WorkoutBuilderPart,
  WorkoutBuilderMovement,
  WorkoutDisplay,
  ParsedWorkout,
  ParsedMovement,
  ScoreInput,
  MovementOption,
} from "@/types/crossfit";

// Local (not UTC) YYYY-MM-DD. `.toISOString()` yields a UTC date, which
// in positive timezones can roll a selected "Nov 18 local" back to Nov 17.
function toDateString(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ============================================
// WorkoutDisplay → builder form (edit mode)
// ============================================

function generateTempId() {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function workoutToBuilderForm(w: WorkoutDisplay): WorkoutBuilderForm {
  return {
    title: w.title ?? "",
    description: w.description ?? "",
    workoutDate: w.workoutDate,
    benchmarkWorkoutId: w.benchmarkWorkoutId ?? null,
    requiresVest: !!w.requiresVest,
    vestWeightMaleLb:
      w.vestWeightMaleLb != null ? String(w.vestWeightMaleLb) : "",
    vestWeightFemaleLb:
      w.vestWeightFemaleLb != null ? String(w.vestWeightFemaleLb) : "",
    isPartner: !!w.isPartner,
    partnerCount: w.partnerCount != null ? String(w.partnerCount) : "",
    parts: w.parts.map((p): WorkoutBuilderPart => {
      const blocks = (p.blocks ?? []).map((b) => ({
        tempId: generateTempId(),
        id: b.id,
        title: b.title,
        orderIndex: b.orderIndex,
      }));
      const blockTempRefByDbId = new Map(
        blocks.map((b) => [b.id ?? "", b.tempId])
      );
      return {
        tempId: generateTempId(),
        id: p.id,
        label: p.label ?? "",
        workoutType: p.workoutType,
        timeCapInput: p.timeCapSeconds
          ? formatSecondsAsClock(p.timeCapSeconds)
          : "",
        amrapDurationInput: p.amrapDurationSeconds
          ? formatSecondsAsClock(p.amrapDurationSeconds)
          : "",
        emomIntervalInput:
          p.emomIntervalSeconds != null
            ? formatSecondsAsClock(p.emomIntervalSeconds)
            : "",
        intervalWorkInput:
          p.intervalWorkSeconds != null
            ? formatSecondsAsClock(p.intervalWorkSeconds)
            : "",
        intervalRestInput:
          p.intervalRestSeconds != null
            ? formatSecondsAsClock(p.intervalRestSeconds)
            : "",
        intervalRounds:
          Array.isArray(p.intervalRounds) && p.intervalRounds.length > 0
            ? p.intervalRounds.map((r) => ({
                workInput: formatSecondsAsClock(r.workSeconds),
                restInput: formatSecondsAsClock(r.restSeconds),
              }))
            : undefined,
        sideCadenceIntervalInput:
          p.sideCadenceIntervalSeconds != null
            ? formatSecondsAsClock(p.sideCadenceIntervalSeconds)
            : "",
        sideCadenceOpenEnded: !!p.sideCadenceOpenEnded,
        repScheme: p.repScheme ?? "",
        rounds: p.rounds ? String(p.rounds) : "",
        structure: p.structure,
        movements: p.movements.map(
          (m): WorkoutBuilderMovement => ({
            tempId: generateTempId(),
            id: m.id,
            movementId: m.movementId,
            movementName: m.movementName,
            category: m.category,
            isWeighted: m.isWeighted,
            metricType: m.metricType,
            prescribedReps: m.prescribedReps ?? "",
            prescribedWeightMale: m.prescribedWeightMale ?? "",
            prescribedWeightFemale: m.prescribedWeightFemale ?? "",
            prescribedCaloriesMale:
              m.prescribedCaloriesMale != null
                ? String(m.prescribedCaloriesMale)
                : "",
            prescribedCaloriesFemale:
              m.prescribedCaloriesFemale != null
                ? String(m.prescribedCaloriesFemale)
                : "",
            prescribedDistanceMale:
              m.prescribedDistanceMale != null
                ? String(m.prescribedDistanceMale)
                : "",
            prescribedDistanceFemale:
              m.prescribedDistanceFemale != null
                ? String(m.prescribedDistanceFemale)
                : "",
            prescribedDurationSecondsMale:
              m.prescribedDurationSecondsMale != null
                ? String(m.prescribedDurationSecondsMale)
                : "",
            prescribedDurationSecondsFemale:
              m.prescribedDurationSecondsFemale != null
                ? String(m.prescribedDurationSecondsFemale)
                : "",
            prescribedHeightInches:
              m.prescribedHeightInches != null
                ? String(m.prescribedHeightInches)
                : "",
            prescribedHeightInchesMale:
              m.prescribedHeightInchesMale != null
                ? String(m.prescribedHeightInchesMale)
                : "",
            prescribedHeightInchesFemale:
              m.prescribedHeightInchesFemale != null
                ? String(m.prescribedHeightInchesFemale)
                : "",
            useBwMultiplier:
              m.prescribedWeightMaleBwMultiplier != null ||
              m.prescribedWeightFemaleBwMultiplier != null,
            prescribedWeightMaleBwMultiplier:
              m.prescribedWeightMaleBwMultiplier != null
                ? String(m.prescribedWeightMaleBwMultiplier)
                : "",
            prescribedWeightFemaleBwMultiplier:
              m.prescribedWeightFemaleBwMultiplier != null
                ? String(m.prescribedWeightFemaleBwMultiplier)
                : "",
            tempo: m.tempo ?? "",
            isMaxReps: !!m.isMaxReps,
            isSideCadence: !!m.isSideCadence,
            equipmentCount: m.equipmentCount,
            rxStandard: m.rxStandard ?? "",
            notes: m.notes ?? "",
            blockId: m.workoutBlockId ?? null,
            blockTempRef: m.workoutBlockId
              ? blockTempRefByDbId.get(m.workoutBlockId) ?? null
              : null,
          })
        ),
        blocks,
      };
    }),
  };
}

// ============================================
// Page
// ============================================

type CrossfitView = "gym" | "personal";

export default function CrossfitPage() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showAddWorkout, setShowAddWorkout] = useState(false);
  const [editingWorkoutId, setEditingWorkoutId] = useState<string | null>(null);
  const [scoringWorkoutId, setScoringWorkoutId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // When the user has an active gym, default to the gym programming view.
  // The toggle lets coaches/members flip to their personal-only list, and
  // their pick is persisted across refreshes (per-page).
  const [storedView, setView] = useStickyTab<CrossfitView>("crossfit");
  const view: CrossfitView = storedView ?? "gym";

  const dateStr = toDateString(selectedDate);
  const { data: gymContext, isPending: gymContextPending } = useGymContext();
  const activeMembership = useActiveMembership();
  const userId = gymContext?.user.id ?? null;
  const isCoach = !!activeMembership && (activeMembership.isAdmin || activeMembership.isCoach);
  const isSuperAdmin = !!gymContext?.user.isSuperAdmin;
  const inGymMode = view === "gym" && !!activeMembership;

  const scope: WorkoutScopeFilter = useMemo(() => {
    if (activeMembership && view === "gym") {
      return { mode: "gym", communityId: activeMembership.communityId };
    }
    if (activeMembership && view === "personal") {
      return { mode: "personal" };
    }
    return { mode: "personal" };
  }, [activeMembership, view]);

  // Wait for gym context to settle before firing the workouts query —
  // otherwise scope falls through to "personal" during the load window and
  // gym-scoped workouts flash as missing.
  const { data: workouts = [], isLoading } = useWorkoutsByDate(dateStr, scope, {
    enabled: !gymContextPending,
  });
  const { data: movementLibrary = [] } = useMovements();
  const createWorkout = useCreateWorkout();
  const updateWorkout = useUpdateWorkout();
  const deleteWorkout = useDeleteWorkout();
  const logScore = useLogScore();
  const updateScore = useUpdateScore();
  const createMovement = useCreateMovement();
  const moveWorkoutToGym = useMoveWorkoutToGym();

  // Temporary helper: lets the gym admin move a personal workout into the
  // gym they admin, so workouts created before multi-gym support don't have
  // to be re-entered. Locked to a single email (mirrored on the server) so
  // it doesn't drift into a general feature.
  const userEmail = gymContext?.user.email ?? null;
  const canMovePersonalToGym =
    !!activeMembership &&
    activeMembership.isAdmin &&
    userEmail?.toLowerCase() === "sarah.dorich@gmail.com";

  const handleMoveToGym = async (workoutId: string) => {
    if (!canMovePersonalToGym || !activeMembership) return;
    try {
      await moveWorkoutToGym.mutateAsync({
        workoutId,
        communityId: activeMembership.communityId,
      });
      toast.success(`Moved to ${activeMembership.communityName}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to move workout"
      );
      throw err;
    }
  };

  const scoringWorkout = useMemo(
    () => workouts.find((w) => w.id === scoringWorkoutId) ?? null,
    [workouts, scoringWorkoutId]
  );

  const editingWorkout = useMemo(
    () => workouts.find((w) => w.id === editingWorkoutId) ?? null,
    [workouts, editingWorkoutId]
  );

  const editingForm = useMemo(
    () => (editingWorkout ? workoutToBuilderForm(editingWorkout) : null),
    [editingWorkout]
  );

  // ============================================
  // Save — Smart Builder
  // ============================================

  const handleSaveFromBuilder = async (form: WorkoutBuilderForm) => {
    setSaveError(null);
    const parts = form.parts
      .map(builderPartToPayload)
      .filter((p): p is CreatePartInput => p !== null);
    if (parts.length === 0) {
      setSaveError("Add at least one part with movements.");
      return;
    }

    try {
      await createWorkout.mutateAsync({
        title: form.title || undefined,
        description: form.description || undefined,
        workoutDate: form.workoutDate || dateStr,
        benchmarkWorkoutId: form.benchmarkWorkoutId ?? undefined,
        // In gym mode (coach view), write the workout into the gym so all
        // active members see it. Personal view stays personal.
        communityId: inGymMode && isCoach ? activeMembership!.communityId : null,
        requiresVest: !!form.requiresVest,
        vestWeightMaleLb: form.vestWeightMaleLb
          ? parseFloat(form.vestWeightMaleLb)
          : undefined,
        vestWeightFemaleLb: form.vestWeightFemaleLb
          ? parseFloat(form.vestWeightFemaleLb)
          : undefined,
        isPartner: !!form.isPartner,
        partnerCount: form.partnerCount
          ? parseInt(form.partnerCount, 10)
          : undefined,
        parts,
      });
      setShowAddWorkout(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save workout");
    }
  };

  // ============================================
  // Save — Paste/Parser flow
  // ============================================
  //
  // The parser returns movements with canonical names (not IDs). Resolve each
  // name against the live movement library; auto-create missing ones as
  // user-scoped custom movements so the save always succeeds.

  const resolveMovementId = async (
    parsed: ParsedMovement
  ): Promise<MovementOption | null> => {
    const targetName = (parsed.matchedCanonicalName || parsed.name).trim();
    if (!targetName) return null;
    const match = movementLibrary.find(
      (m) => m.canonicalName.toLowerCase() === targetName.toLowerCase()
    );
    if (match) return match;
    // Not in the library — create a user-owned custom movement.
    try {
      return await createMovement.mutateAsync({ canonicalName: targetName });
    } catch {
      return null;
    }
  };

  const handleSaveFromParser = async (
    parsed: ParsedWorkout,
    workoutDate: string,
    options: { isPartner: boolean; partnerCount: number | null }
  ) => {
    setSaveError(null);

    const resolved = await Promise.all(
      parsed.movements.map(async (m) => ({
        parsed: m,
        movement: await resolveMovementId(m),
      }))
    );

    const usable = resolved.filter((r) => r.movement !== null);
    if (usable.length === 0) {
      setSaveError("Couldn't resolve any movements. Try the Smart Builder.");
      return;
    }

    try {
      await createWorkout.mutateAsync({
        title: parsed.title,
        description: parsed.description,
        workoutDate: workoutDate || dateStr,
        communityId: inGymMode && isCoach ? activeMembership!.communityId : null,
        isPartner: options.isPartner,
        partnerCount: options.partnerCount ?? undefined,
        parts: [
          {
            workoutType: parsed.workoutType,
            timeCapSeconds: parsed.timeCapSeconds,
            amrapDurationSeconds: parsed.amrapDurationSeconds,
            repScheme: parsed.repScheme,
            movements: usable.map((r, i) => ({
              movementId: r.movement!.id,
              orderIndex: i,
              // For cal/distance movements, the parser populates dedicated
              // fields and leaves `reps` empty so we don't double-write
              // "21 Cal" into prescribedReps for a calorie-typed movement.
              prescribedReps: r.parsed.reps,
              prescribedWeightMale: r.parsed.weightMale,
              prescribedWeightFemale: r.parsed.weightFemale,
              prescribedCaloriesMale: r.parsed.caloriesMale,
              prescribedCaloriesFemale: r.parsed.caloriesFemale,
              prescribedDistanceMale: r.parsed.distanceMaleMeters,
              prescribedDistanceFemale: r.parsed.distanceFemaleMeters,
            })),
          },
        ],
      });
      setShowAddWorkout(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save workout");
    }
  };

  // ============================================
  // Edit — Smart Builder (PUT existing workout)
  // ============================================

  const handleSaveEdit = async (form: WorkoutBuilderForm) => {
    if (!editingWorkoutId) return;
    setSaveError(null);
    const parts = form.parts
      .map(builderPartToPayload)
      .filter((p): p is CreatePartInput => p !== null);
    if (parts.length === 0) {
      setSaveError("Add at least one part with movements.");
      return;
    }

    try {
      await updateWorkout.mutateAsync({
        id: editingWorkoutId,
        input: {
          title: form.title || undefined,
          description: form.description || undefined,
          workoutDate: form.workoutDate || dateStr,
          requiresVest: !!form.requiresVest,
          vestWeightMaleLb: form.vestWeightMaleLb
            ? parseFloat(form.vestWeightMaleLb)
            : undefined,
          vestWeightFemaleLb: form.vestWeightFemaleLb
            ? parseFloat(form.vestWeightFemaleLb)
            : undefined,
          isPartner: !!form.isPartner,
          partnerCount: form.partnerCount
            ? parseInt(form.partnerCount, 10)
            : undefined,
          parts,
        },
      });
      setEditingWorkoutId(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to update workout");
    }
  };

  // ============================================
  // Delete
  // ============================================

  const handleDeleteWorkout = async (workoutId: string) => {
    try {
      await deleteWorkout.mutateAsync(workoutId);
      toast.success("Workout deleted");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete workout";
      toast.error(message);
      throw err;
    }
  };

  // ============================================
  // Score submit
  // ============================================

  const handlePartScoreSubmit = async (partId: string, score: ScoreInput) => {
    if (!scoringWorkout) return;
    const part = scoringWorkout.parts.find((p) => p.id === partId);
    if (!part) return;

    try {
      if (part.score?.id) {
        await updateScore.mutateAsync({ scoreId: part.score.id, score });
      } else {
        await logScore.mutateAsync(score);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save score");
    }
  };

  // ============================================
  // Render
  // ============================================

  // Members of a gym can't add/edit/delete the gym's coach-programmed
  // workouts. We hide the buttons rather than letting the API 403.
  const canAddInCurrentView = !inGymMode || isCoach || isSuperAdmin;
  // Edit/delete are decided per-workout below using role + creator info.
  const canEditWorkout = (w: { createdBy: string; communityId?: string | null }) => {
    if (!userId) return false;
    if (isSuperAdmin) return true;
    if (w.communityId == null) return w.createdBy === userId;
    return isCoach;
  };

  return (
    <div className="flex flex-col gap-5">
      <DateNavigator selectedDate={selectedDate} onDateChange={setSelectedDate} />

      {/* When the user belongs to a gym, surface the gym vs personal toggle.
          Without an active gym there's no toggle — the only view is personal. */}
      {activeMembership && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView("gym")}
            className={`flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              view === "gym"
                ? "border-primary bg-primary/10 text-primary"
                : "border-white/[0.08] text-muted-foreground hover:bg-white/[0.04]"
            }`}
          >
            Gym programming
          </button>
          <button
            onClick={() => setView("personal")}
            className={`flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              view === "personal"
                ? "border-primary bg-primary/10 text-primary"
                : "border-white/[0.08] text-muted-foreground hover:bg-white/[0.04]"
            }`}
          >
            My personal
          </button>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Link href="/crossfit/search">
          <Button variant="outline" size="sm" className="gap-1.5 border-white/[0.08]">
            <Search className="h-4 w-4" />
            Search
          </Button>
        </Link>
        {canAddInCurrentView && (
          <Button
            size="sm"
            onClick={() => {
              setSaveError(null);
              setShowAddWorkout(true);
            }}
            className="gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Add Workout
          </Button>
        )}
      </div>

      {inGymMode && !isCoach && !isSuperAdmin && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] text-muted-foreground">
          Viewing programming from {activeMembership!.communityName}. Switch to{" "}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() => setView("personal")}
          >
            My personal
          </button>{" "}
          to add your own workouts.
        </div>
      )}

      {saveError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {saveError}
        </div>
      )}

      {gymContextPending || isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {workouts.map((workout) => {
            const editable = canEditWorkout({
              createdBy: workout.createdBy,
              communityId: workout.communityId ?? null,
            });
            const isPersonalAndOwn =
              workout.communityId == null && workout.createdBy === userId;
            const showMoveToGym = canMovePersonalToGym && isPersonalAndOwn;
            return (
              <WorkoutCard
                key={workout.id}
                workout={workout}
                onLogScore={() => setScoringWorkoutId(workout.id)}
                onEdit={
                  editable
                    ? () => {
                        setSaveError(null);
                        setEditingWorkoutId(workout.id);
                      }
                    : undefined
                }
                onDelete={editable ? handleDeleteWorkout : undefined}
                onMoveToGym={showMoveToGym ? handleMoveToGym : undefined}
                moveToGymName={
                  showMoveToGym ? activeMembership?.communityName : undefined
                }
              />
            );
          })}

          {workouts.length === 0 && (
            <Card className="border-dashed border-white/[0.06]">
              <CardContent className="flex flex-col items-center gap-4 py-10">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                  <Zap className="h-6 w-6 text-primary/60" />
                </div>
                <div className="text-center">
                  <p className="font-semibold">No workouts for this date</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {inGymMode && !canAddInCurrentView
                      ? "Your coach hasn't programmed anything yet."
                      : "Add a workout or paste one from your gym"}
                  </p>
                </div>
                {canAddInCurrentView && (
                  <Button
                    variant="outline"
                    className="mt-1 border-white/[0.08]"
                    onClick={() => setShowAddWorkout(true)}
                  >
                    <Plus className="h-4 w-4" />
                    Add Workout
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={showAddWorkout} onOpenChange={setShowAddWorkout}>
        <DialogContent className="max-h-[90vh] w-[min(96vw,42rem)] max-w-none overflow-x-hidden overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Workout</DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="build">
            <TabsList className="w-full">
              <TabsTrigger value="paste" className="flex-1 gap-1.5">
                <ClipboardPaste className="h-3.5 w-3.5" />
                Paste
              </TabsTrigger>
              <TabsTrigger value="build" className="flex-1 gap-1.5">
                <Wrench className="h-3.5 w-3.5" />
                Smart Builder
              </TabsTrigger>
              <TabsTrigger value="benchmark" className="flex-1 gap-1.5">
                <Trophy className="h-3.5 w-3.5" />
                Benchmark
              </TabsTrigger>
            </TabsList>
            <TabsContent value="paste" className="mt-4">
              <WorkoutParser
                onSave={handleSaveFromParser}
                onCancel={() => setShowAddWorkout(false)}
                defaultWorkoutDate={dateStr}
              />
            </TabsContent>
            <TabsContent value="build" className="mt-4">
              <SmartBuilder
                defaultWorkoutDate={dateStr}
                onSave={handleSaveFromBuilder}
                onCancel={() => setShowAddWorkout(false)}
              />
            </TabsContent>
            <TabsContent value="benchmark" className="mt-4">
              <BenchmarkPicker
                onWorkoutCreated={() => setShowAddWorkout(false)}
                workoutDate={dateStr}
                communityId={
                  inGymMode && isCoach ? activeMembership!.communityId : null
                }
              />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {scoringWorkout && (
        <ScoreEntry
          open
          onOpenChange={(open) => {
            if (!open) setScoringWorkoutId(null);
          }}
          workoutId={scoringWorkout.id}
          workoutTitle={scoringWorkout.title}
          parts={scoringWorkout.parts}
          workout={scoringWorkout}
          onSubmit={handlePartScoreSubmit}
        />
      )}

      <Dialog
        open={!!editingWorkoutId}
        onOpenChange={(open) => {
          if (!open) setEditingWorkoutId(null);
        }}
      >
        <DialogContent className="max-h-[90vh] w-[min(96vw,42rem)] max-w-none overflow-x-hidden overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Workout</DialogTitle>
          </DialogHeader>
          {editingForm && (
            <SmartBuilder
              initialForm={editingForm}
              saveLabel="Save Changes"
              onSave={handleSaveEdit}
              onCancel={() => setEditingWorkoutId(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
