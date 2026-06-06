"use client";

import { Suspense, useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Plus, Zap, Trophy, Loader2, Search, Sparkles, Pencil, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WorkoutCard } from "@/components/crossfit/workout-card";
import { ProgrammedWorkoutDay } from "@/components/crossfit/programmed-workout-day";
import { GymAdminDayProgrammer } from "@/components/crossfit/gym-admin-day-programmer";
import { SmartBuilder } from "@/components/crossfit/smart-builder";
import { AddWorkoutTabs } from "@/components/crossfit/add-workout-tabs";
import { ScoreEntry } from "@/components/crossfit/score-entry";
import { LeaderboardSheet } from "@/components/crossfit/leaderboard-sheet";
import { DateNavigator } from "@/components/shared/date-navigator";
import { QueryError } from "@/components/shared/query-error";
import { AvailableTracksSheet } from "@/components/crossfit/available-tracks-sheet";
import { TrackDayChallengeInput } from "@/components/crossfit/track-day-challenge-input";
import { TrackDayLeaderboardSheet } from "@/components/crossfit/track-day-leaderboard-sheet";
import { useMyTrackDays } from "@/hooks/useTracks";
import { useIsFeatureOn } from "@/hooks/useFeatureFlag";
import { WORKOUT_SECTION_KIND_LABELS } from "@/db/schema";
import { useHasMounted } from "@/hooks/useHasMounted";
import { useStickyTab } from "@/hooks/useStickyTab";
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
import {
  useActiveMembership,
  useGymContext,
  useSetCrossfitView,
} from "@/hooks/useGymContext";
import { builderPartToPayload } from "@/lib/crossfit/builder-payload";
import { workoutToBuilderForm } from "@/lib/crossfit/workout-to-builder-form";
import { useMovements, useCreateMovement } from "@/hooks/useMovements";
import { useCreateWorkoutFromBenchmark } from "@/hooks/useBenchmarks";
import { resolveParsedToCreatePart } from "@/lib/crossfit/resolve-parsed-movements";
import type {
  WorkoutBuilderForm,
  ParsedWorkout,
  ScoreInput,
  BenchmarkWorkout,
} from "@/types/crossfit";

// Local (not UTC) YYYY-MM-DD. `.toISOString()` yields a UTC date, which
// in positive timezones can roll a selected "Nov 18 local" back to Nov 17.
function toDateString(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Monday of the week containing `d`, returned as a local YYYY-MM-DD. Drives
// the deep-link from the Gym view banner to the matching week in the
// programming admin.
function mondayOfWeek(d: Date): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (copy.getDay() + 6) % 7; // Mon=0, Sun=6
  copy.setDate(copy.getDate() - dow);
  return toDateString(copy);
}

// Parse a YYYY-MM-DD param into a Date in local time (no UTC drift), or
// null when the value is missing/malformed. Used by ?date=... deep links
// from the benchmarks page so the user lands on the day they just added
// a workout to.
function parseLocalDate(s: string | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

// ============================================
// Page
// ============================================

type CrossfitView = "gym" | "personal";

// Wrap the page body in <Suspense> because it calls useSearchParams() to
// honor ?date=... deep links. Without the boundary, Next.js bails out of
// static prerender for the whole route at build time.
export default function CrossfitPage() {
  return (
    <Suspense fallback={null}>
      <CrossfitPageBody />
    </Suspense>
  );
}

function CrossfitPageBody() {
  // Honor ?date=YYYY-MM-DD on first render so deep links from the
  // benchmarks page (e.g. "Log a 3RM") land on the day the new workout
  // was added to. The param is read once on mount — subsequent date
  // navigation is local state.
  const searchParams = useSearchParams();
  // The persisted React Query cache (gym context, feature flags) is restored
  // from localStorage on the client but unavailable to the server, so the
  // first client render would otherwise diverge from the SSR HTML. Gating the
  // body on this keeps the first render in sync; see useHasMounted.
  const hasMounted = useHasMounted();
  const [selectedDate, setSelectedDate] = useState(
    () => parseLocalDate(searchParams.get("date")) ?? new Date()
  );
  // Gym-admin sub-mode within the gym view. "edit" mounts the inline
  // programming editor; "athlete" renders the same read-only day card
  // members see (with Log Score + Leaderboard wired up) so the coach can
  // sanity-check their programming and log their own score without
  // leaving the tab. Same shared cache, so edits in "edit" mode show up
  // immediately after toggling to "athlete" mode. Persisted in
  // localStorage so the coach's last choice survives refreshes; defaults
  // to "athlete" since most visits are to log/check rather than program.
  const [storedProgrammingMode, setProgrammingMode] = useStickyTab<"edit" | "athlete">(
    "crossfit-programming-mode"
  );
  const programmingMode: "edit" | "athlete" = storedProgrammingMode ?? "athlete";
  const [showAddWorkout, setShowAddWorkout] = useState(false);
  const [editingWorkoutId, setEditingWorkoutId] = useState<string | null>(null);
  const [scoringWorkoutId, setScoringWorkoutId] = useState<string | null>(null);
  // When set, the score modal scopes to a single section's parts instead
  // of the full workout. Null = legacy "Log Scores" footer button (all
  // parts at once); set = per-section "Log Score" button on a sectioned
  // workout (only that section's parts).
  const [scoringSectionId, setScoringSectionId] = useState<string | null>(null);
  const [leaderboardWorkoutId, setLeaderboardWorkoutId] = useState<string | null>(null);
  // Section-scoped leaderboard (mirrors scoringSectionId). Null = full
  // workout (legacy non-sectioned). Set = filter leaderboard to that
  // section's parts only.
  const [leaderboardSectionId, setLeaderboardSectionId] = useState<string | null>(null);
  // Standalone track-day cards (monthly challenges / custom tracks) open a
  // separate leaderboard sheet — their scoring lives in track_day_scores
  // rather than the `scores` table the workout leaderboard reads.
  const [trackLeaderboard, setTrackLeaderboard] = useState<{
    trackDayId: string;
    title: string;
    subtitle: string | null;
  } | null>(null);
  // Pre-opens the comments drawer when the leaderboard sheet opens via a
  // notification deep-link (?scoreComment=<id>).
  const [deepLinkScoreCommentId, setDeepLinkScoreCommentId] = useState<
    string | null
  >(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Honor ?leaderboard=<id>&scoreComment=<id> deep links from the
  // notifications inbox. We wait for the workouts list to load so the
  // sheet's WorkoutDisplay lookup finds the row. Once consumed, the
  // params are cleared from React state so a second tap on the same link
  // still re-opens.
  useEffect(() => {
    const lbId = searchParams.get("leaderboard");
    const cmtId = searchParams.get("scoreComment");
    if (lbId) setLeaderboardWorkoutId(lbId);
    if (cmtId) setDeepLinkScoreCommentId(cmtId);
    // We only consume on mount — subsequent navigation is local state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dateStr = toDateString(selectedDate);
  const { data: gymContext, isPending: gymContextPending } = useGymContext();
  const activeMembership = useActiveMembership();
  const userId = gymContext?.user.id ?? null;
  const isCoach = !!activeMembership && (activeMembership.isAdmin || activeMembership.isCoach);
  const isSuperAdmin = !!gymContext?.user.isSuperAdmin;

  // CrossFit view choice — "Gym programming" vs "My personal". Persisted on
  // the user row (see useSetCrossfitView) so it survives app reinstalls and
  // syncs across devices. Null (no choice made yet) defaults to the gym
  // programming view when the user belongs to a gym.
  const view: CrossfitView = gymContext?.user.crossfitView ?? "gym";
  const setCrossfitView = useSetCrossfitView();

  const inGymMode = view === "gym" && !!activeMembership;
  // Admin/coach (or super-admin) on the gym whose programming we're
  // viewing. Drives the inline editable surface below — mirrors the
  // `canManageGym` predicate the API uses.
  const canProgramHere =
    inGymMode && (isCoach || isSuperAdmin);

  const scope: WorkoutScopeFilter = useMemo(() => {
    if (activeMembership && view === "gym") {
      return { mode: "gym", communityId: activeMembership.communityId };
    }
    if (activeMembership && view === "personal") {
      return { mode: "personal" };
    }
    return { mode: "personal" };
  }, [activeMembership, view]);

  // Custom Tracks v2 — opt-in standalone track days for this athlete on
  // the displayed date (spec §1.4). Inline-only tracks already show up
  // via injected workout_sections, so they're filtered out server-side.
  const customTracksV2On = useIsFeatureOn("custom_tracks_v2");
  const [showAvailableTracks, setShowAvailableTracks] = useState(false);
  const { data: myTrackDaysData } = useMyTrackDays(
    customTracksV2On && inGymMode ? activeMembership?.communityId ?? null : null,
    dateStr
  );
  const myTrackDays = myTrackDaysData?.trackDays ?? [];

  // Wait for gym context to settle before firing the workouts query —
  // otherwise scope falls through to "personal" during the load window and
  // gym-scoped workouts flash as missing.
  const {
    data: workouts = [],
    isLoading,
    isError: workoutsFailed,
    isFetching: workoutsFetching,
    refetch: refetchWorkouts,
  } = useWorkoutsByDate(dateStr, scope, {
    enabled: !gymContextPending,
  });
  const { data: movementLibrary = [] } = useMovements();
  const createWorkout = useCreateWorkout();
  const updateWorkout = useUpdateWorkout();
  const deleteWorkout = useDeleteWorkout();
  const logScore = useLogScore();
  const updateScore = useUpdateScore();
  const createMovement = useCreateMovement();
  const createWorkoutFromBenchmark = useCreateWorkoutFromBenchmark();
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

  // When scoped to a section, narrow the modal to that section's parts
  // and use the section's label as the modal title so athletes see
  // "Pre-skill" instead of the full workout title (which usually echoes
  // the WOD). Falls back to the full workout when scoringSectionId is
  // null (legacy non-sectioned workouts or a future "edit all" flow).
  const scoringSection = useMemo(() => {
    if (!scoringWorkout || !scoringSectionId) return null;
    return (
      scoringWorkout.sections?.find((s) => s.id === scoringSectionId) ?? null
    );
  }, [scoringWorkout, scoringSectionId]);

  const scoringParts = useMemo(() => {
    if (!scoringWorkout) return [];
    if (!scoringSection) return scoringWorkout.parts;
    const ids = new Set(scoringSection.partIds);
    return scoringWorkout.parts.filter((p) => ids.has(p.id));
  }, [scoringWorkout, scoringSection]);

  const scoringModalTitle = useMemo(() => {
    if (!scoringWorkout) return undefined;
    if (!scoringSection) return scoringWorkout.title;
    const kindLabel =
      WORKOUT_SECTION_KIND_LABELS[scoringSection.kind] ?? "Section";
    return scoringSection.title?.trim()
      ? `${kindLabel} · ${scoringSection.title.trim()}`
      : kindLabel;
  }, [scoringWorkout, scoringSection]);

  // Leaderboard scope mirrors the scoring scope — when the user opens a
  // leaderboard from a section card, we filter the sheet to just that
  // section's parts and label the header with the section name.
  const leaderboardScope = useMemo(() => {
    if (!leaderboardWorkoutId || !leaderboardSectionId) return null;
    const w = workouts.find((x) => x.id === leaderboardWorkoutId);
    const s = w?.sections?.find((x) => x.id === leaderboardSectionId);
    if (!s) return null;
    const kindLabel = WORKOUT_SECTION_KIND_LABELS[s.kind] ?? "Section";
    const title = s.title?.trim()
      ? `${kindLabel} · ${s.title.trim()}`
      : kindLabel;
    return { partIds: s.partIds, title };
  }, [leaderboardWorkoutId, leaderboardSectionId, workouts]);

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
        vestRequirement: form.vestRequirement ?? "none",
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
  // The parser returns movements with canonical names (not IDs). The
  // shared resolver matches them against the live movement library and
  // auto-creates missing ones as user-scoped custom movements so the save
  // always succeeds.

  const handleSaveFromParser = async (
    parsed: ParsedWorkout,
    workoutDate: string,
    options: { isPartner: boolean; partnerCount: number | null }
  ) => {
    setSaveError(null);

    const resolved = await resolveParsedToCreatePart(parsed, {
      movementLibrary,
      createMovement: (input) => createMovement.mutateAsync(input),
    });
    if (!resolved) {
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
        parts: [resolved.part],
      });
      setShowAddWorkout(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save workout");
    }
  };

  // ============================================
  // Save — Benchmark flow
  // ============================================
  //
  // The picker hands back the selected benchmark + the user's date/partner
  // overrides; the server expands the benchmark into a real workout for
  // the user (or for the gym when communityId is set).

  const handleSaveFromBenchmark = async (
    benchmark: BenchmarkWorkout,
    workoutDate: string,
    options: { isPartner: boolean; partnerCount: number | null }
  ) => {
    setSaveError(null);
    try {
      await createWorkoutFromBenchmark.mutateAsync({
        benchmarkWorkoutId: benchmark.id,
        workoutDate: workoutDate || dateStr,
        communityId:
          inGymMode && isCoach ? activeMembership!.communityId : undefined,
        isPartner: options.isPartner,
        partnerCount: options.partnerCount ?? undefined,
      });
      setShowAddWorkout(false);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to add benchmark"
      );
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
          vestRequirement: form.vestRequirement ?? "none",
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

    // Errors propagate to ScoreEntry's handleSubmit, which surfaces them in
    // the dialog and keeps it open so the failed part can be retried.
    if (part.score?.id) {
      await updateScore.mutateAsync({ scoreId: part.score.id, score });
    } else {
      await logScore.mutateAsync(score);
    }
  };

  // ============================================
  // Render
  // ============================================

  // Add Workout from the CrossFit tab is a personal-scope action. In Gym
  // programming view, coaches manage the day's prescription through the
  // programming admin (which enforces one WOD per day and the section
  // taxonomy); allowing a Smart Builder write here lands a duplicate
  // wod-kind session that the synthetic-workout reader silently shadows.
  // Members in Gym view also can't add — they switch to My personal.
  const canAddInCurrentView = !inGymMode;
  // Edit/delete are decided per-workout below using role + creator info.
  const canEditWorkout = (w: { createdBy: string; communityId?: string | null }) => {
    if (!userId) return false;
    if (isSuperAdmin) return true;
    if (w.communityId == null) return w.createdBy === userId;
    return isCoach;
  };

  // Until the client has mounted, render the SSR-equivalent pending state so
  // the first client render matches the server HTML. Once mounted, the
  // persisted cache is safe to read and the real UI renders below.
  if (!hasMounted) {
    return (
      <div className="flex flex-col gap-5">
        <DateNavigator
          selectedDate={selectedDate}
          onDateChange={setSelectedDate}
        />
        <div className="flex items-center justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <DateNavigator selectedDate={selectedDate} onDateChange={setSelectedDate} />

      {/* When the user belongs to a gym, surface the gym vs personal toggle.
          Without an active gym there's no toggle — the only view is personal. */}
      {activeMembership && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCrossfitView.mutate("gym")}
            className={`flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              view === "gym"
                ? "border-primary bg-primary/10 text-primary"
                : "border-white/[0.08] text-muted-foreground hover:bg-white/[0.04]"
            }`}
          >
            Gym programming
          </button>
          <button
            onClick={() => setCrossfitView.mutate("personal")}
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
        {customTracksV2On && inGymMode && activeMembership && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-white/[0.08]"
            onClick={() => setShowAvailableTracks(true)}
          >
            <Sparkles className="h-4 w-4" />
            Available tracks
          </Button>
        )}
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
            onClick={() => setCrossfitView.mutate("personal")}
          >
            My personal
          </button>{" "}
          to add your own workouts.
        </div>
      )}

      {inGymMode && (isCoach || isSuperAdmin) && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] text-muted-foreground">
          Programming {activeMembership!.communityName} inline. Open the{" "}
          <Link
            href={`/gym/programming/${mondayOfWeek(selectedDate)}`}
            className="underline underline-offset-2 hover:text-foreground"
          >
            week editor
          </Link>{" "}
          to lay out a full week, or switch to{" "}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() => setCrossfitView.mutate("personal")}
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

      {/* Gym admins/coaches get an Edit / View-as-athlete toggle so they
          can drop back to the member's read-only card (with Log Score +
          Leaderboard wired up) when they want to sanity-check their
          programming or log their own score, without leaving the tab.
          Same shared cache, so flipping back to Edit shows the same
          state without a refetch. */}
      {canProgramHere && (
        <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-1">
          <button
            type="button"
            onClick={() => setProgrammingMode("edit")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              programmingMode === "edit"
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-white/[0.04]"
            }`}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            type="button"
            onClick={() => setProgrammingMode("athlete")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              programmingMode === "athlete"
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-white/[0.04]"
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            View as athlete
          </button>
        </div>
      )}

      {/* Inline editable day card — same data model and same endpoints
          the week editor uses, scoped to the selected date. We render
          this *instead of* the read-only `ProgrammedWorkoutDay` for the
          same date when the coach is in edit mode (see spec §1 —
          duplicating the read-only and editable surfaces invites
          out-of-sync UX). The athlete-view toggle below falls back to
          the member layout. */}
      {canProgramHere && programmingMode === "edit" && (
        <GymAdminDayProgrammer
          communityId={activeMembership!.communityId}
          communityName={activeMembership!.communityName}
          communityLogoUrl={activeMembership!.logoUrl}
          weekStart={mondayOfWeek(selectedDate)}
          date={dateStr}
        />
      )}

      {gymContextPending || isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : workoutsFailed ? (
        // A failed fetch must not fall through to "No workouts" — that reads
        // as "your data is gone" when it's really just a connection problem.
        <QueryError
          onRetry={() => refetchWorkouts()}
          retrying={workoutsFetching}
          description="Couldn't load your workouts. Check your connection and try again."
        />
      ) : (
        <>
          {/* Hide the read-only programmed workout cards when the inline
              editor is mounted (edit mode) — they describe the same data
              the day card above already shows. In athlete-view mode the
              coach drops back to the member layout so they get Log Score
              + Leaderboard. Track day cards and the empty state still
              render below in both modes. */}
          {(!canProgramHere || programmingMode === "athlete") && workouts.map((workout) => {
            const editable = canEditWorkout({
              createdBy: workout.createdBy,
              communityId: workout.communityId ?? null,
            });
            const isPersonalAndOwn =
              workout.communityId == null && workout.createdBy === userId;
            const showMoveToGym = canMovePersonalToGym && isPersonalAndOwn;
            // Section layout is for gym programming only. Personal
            // workouts always carry one synthetic section per session in
            // the unified schema, but they're single-card by intent — and
            // ProgrammedWorkoutDay hides Edit for any workout without a
            // communityId (no /gym/programming/[weekStart] link to point
            // at), so it would strand the athlete with no edit path.
            const isSectioned =
              (workout.sections?.length ?? 0) > 0 &&
              workout.communityId != null;
            if (isSectioned) {
              return (
                <ProgrammedWorkoutDay
                  key={workout.id}
                  workout={workout}
                  onLogScore={(workoutId, sectionId) => {
                    setScoringSectionId(sectionId);
                    setScoringWorkoutId(workoutId);
                  }}
                  onViewLeaderboard={
                    inGymMode && workout.communityId
                      ? (workoutId, sectionId) => {
                          setLeaderboardSectionId(sectionId);
                          setLeaderboardWorkoutId(workoutId);
                        }
                      : undefined
                  }
                  onViewTrackDayLeaderboard={
                    inGymMode && workout.communityId
                      ? (trackDayId, title) =>
                          setTrackLeaderboard({
                            trackDayId,
                            title,
                            subtitle: null,
                          })
                      : undefined
                  }
                  onEditInProgramming={
                    editable
                      ? () => {
                          /* link rendered via Link inside the kebab */
                        }
                      : undefined
                  }
                  onDelete={editable ? handleDeleteWorkout : undefined}
                  onMoveToGym={showMoveToGym ? handleMoveToGym : undefined}
                  moveToGymName={
                    showMoveToGym
                      ? activeMembership?.communityName
                      : undefined
                  }
                />
              );
            }
            return (
              <WorkoutCard
                key={workout.id}
                workout={workout}
                onLogScore={(_workoutId, sectionId) => {
                  setScoringSectionId(sectionId ?? null);
                  setScoringWorkoutId(workout.id);
                }}
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
                onViewLeaderboard={
                  // Leaderboards are gym-only in v1. Hide the affordance for
                  // personal workouts and for the personal-view tab.
                  inGymMode && workout.communityId
                    ? (id) => setLeaderboardWorkoutId(id)
                    : undefined
                }
                onViewTrackDayLeaderboard={
                  inGymMode && workout.communityId
                    ? (trackDayId, title) =>
                        setTrackLeaderboard({
                          trackDayId,
                          title,
                          subtitle: null,
                        })
                    : undefined
                }
              />
            );
          })}

          {/* Opted-in standalone-track days (spec §1.4). Render as extra
              cards alongside the CAP workouts — never replacing them. */}
          {customTracksV2On && inGymMode && myTrackDays.length > 0 &&
            myTrackDays
              .filter((td) => !td.workoutId)
              .map((td) => (
                <Card key={td.trackDayId} className="border-white/[0.06]">
                  <CardContent className="space-y-2 py-3">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Sparkles className="size-3" />
                      <span>
                        Track: {td.trackName} — Day {td.dayNumber}
                      </span>
                    </div>
                    {td.body && (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                        {td.body}
                      </p>
                    )}
                    {td.isScored && (
                      <TrackDayChallengeInput
                        trackDayId={td.trackDayId}
                        scoringConfig={td.scoringConfig}
                        prescribedValue={td.prescribedValue ?? null}
                        body={td.body}
                        dayNumber={td.dayNumber}
                      />
                    )}
                    {td.isScored && (
                      <div className="pt-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-white/[0.08]"
                          onClick={() =>
                            setTrackLeaderboard({
                              trackDayId: td.trackDayId,
                              title: `${td.trackName} — Day ${td.dayNumber}`,
                              subtitle: null,
                            })
                          }
                        >
                          <Trophy className="size-3.5" />
                          Leaderboard
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}

          {/* Suppress the "No workouts" card when the inline programmer is
              up (edit mode) — the day card has its own placeholder rows
              (warm-up → stretching), and showing both at once would
              double up on emptiness. In athlete-view mode the coach sees
              the member empty state. */}
          {(!canProgramHere || programmingMode === "athlete") &&
            workouts.length === 0 &&
            myTrackDays.length === 0 && (
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

      {customTracksV2On && inGymMode && activeMembership && (
        <AvailableTracksSheet
          open={showAvailableTracks}
          onOpenChange={setShowAvailableTracks}
          communityId={activeMembership.communityId}
        />
      )}

      <Dialog open={showAddWorkout} onOpenChange={setShowAddWorkout}>
        <DialogContent className="max-h-[90vh] w-[min(96vw,42rem)] max-w-none overflow-x-hidden overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Workout</DialogTitle>
          </DialogHeader>
          <AddWorkoutTabs
            defaultWorkoutDate={dateStr}
            onSaveFromBuilder={handleSaveFromBuilder}
            onSaveFromParser={handleSaveFromParser}
            onSaveFromBenchmark={handleSaveFromBenchmark}
            onCancel={() => setShowAddWorkout(false)}
            isBenchmarkSubmitting={createWorkoutFromBenchmark.isPending}
          />
        </DialogContent>
      </Dialog>

      {scoringWorkout && (
        <ScoreEntry
          open
          onOpenChange={(open) => {
            if (!open) {
              setScoringWorkoutId(null);
              setScoringSectionId(null);
            }
          }}
          workoutId={scoringSection?.id ?? scoringWorkout.id}
          workoutTitle={scoringModalTitle}
          parts={scoringParts}
          workout={scoringWorkout}
          onSubmit={handlePartScoreSubmit}
          communityId={scoringWorkout.communityId ?? null}
        />
      )}

      <LeaderboardSheet
        workout={
          workouts.find((w) => w.id === leaderboardWorkoutId) ?? null
        }
        // For programmed days the synthetic workout.id is the first
        // session in the group (usually the warm-up, no template). Route
        // the fetch through the section's own session id when scoped so
        // the leaderboard route lands on a session that has a template.
        sessionId={leaderboardSectionId}
        commentScoreId={deepLinkScoreCommentId}
        onCommentScoreIdChange={setDeepLinkScoreCommentId}
        scopePartIds={leaderboardScope?.partIds ?? null}
        scopeTitle={leaderboardScope?.title ?? null}
        onOpenChange={(open) => {
          if (!open) {
            setLeaderboardWorkoutId(null);
            setLeaderboardSectionId(null);
            setDeepLinkScoreCommentId(null);
          }
        }}
      />

      <TrackDayLeaderboardSheet
        trackDayId={trackLeaderboard?.trackDayId ?? null}
        title={trackLeaderboard?.title ?? ""}
        subtitle={trackLeaderboard?.subtitle ?? null}
        onOpenChange={(open) => {
          if (!open) setTrackLeaderboard(null);
        }}
      />

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
