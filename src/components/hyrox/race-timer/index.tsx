"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { TimerSetup } from "./timer-setup";
import { TimerActive } from "./timer-active";
import { TimerComplete } from "./timer-complete";
import { useRaceTimer } from "./use-race-timer";
import { usePaceFromHealthKit } from "./use-pace-from-healthkit";
import { buildFullRaceSegments } from "./race-segments";
import type { RaceSegment, RaceTemplate, PracticeRaceResult } from "./types";
import type { DivisionKey } from "@/lib/hyrox-data";
import { practiceRaceKeys } from "@/hooks/usePracticeRaces";
import { formatLongTime } from "@/lib/hyrox-data";
import { getCountdownPreference } from "@/hooks/useCountdownPreference";
import {
  sendRaceStartToWatch,
  sendSplitToWatch,
  sendPauseToWatch,
  sendResumeToWatch,
  sendFinishToWatch,
  sendCancelToWatch,
  setRaceSyncHandlers,
} from "@/lib/native/watch-race-sync";
import { onWatchRaceSaved } from "@/lib/native/watch-race-relay";

/// How long the phone waits for the watch's `race.saved` event after
/// the watch taps Finish before falling back to letting the user save
/// the race from the phone. The watch is the canonical saver under
/// watch_finish_owns_save_spec.md §6.2, but if the watch app dies
/// before sync completes the phone needs to be a safety net.
const WATCH_SAVE_FALLBACK_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Pending save queue for offline support
// ---------------------------------------------------------------------------

const PENDING_SAVE_KEY = "shredtrack-pending-race-saves";

interface PendingSave {
  result: PracticeRaceResult;
  title: string;
  notes: string;
  divisionKey: string;
  template: RaceTemplate;
}

function queuePendingSave(save: PendingSave): void {
  try {
    const existing = JSON.parse(
      localStorage.getItem(PENDING_SAVE_KEY) ?? "[]",
    ) as PendingSave[];
    existing.push(save);
    localStorage.setItem(PENDING_SAVE_KEY, JSON.stringify(existing));
  } catch {
    // noop
  }
}

// ---------------------------------------------------------------------------
// Auth check helper — lightweight, no server round-trip if cookie absent
// ---------------------------------------------------------------------------

function useIsLoggedIn(): boolean {
  const [loggedIn, setLoggedIn] = useState(false);
  useEffect(() => {
    // Check for auth session cookie presence
    const hasCookie =
      document.cookie.includes("sb-") ||
      document.cookie.includes("supabase-auth");
    setLoggedIn(hasCookie);
  }, []);
  return loggedIn;
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

type Screen = "setup" | "active" | "complete";

export function RaceTimerFlow() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [divisionKey, setDivisionKey] = useState<DivisionKey>("women_open");
  const [template, setTemplate] = useState<RaceTemplate>("full");
  const [raceResult, setRaceResult] = useState<PracticeRaceResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [personalBests, setPersonalBests] = useState<string[]>([]);
  const [savedRaceId, setSavedRaceId] = useState<string | null>(null);
  // Watch tapped Finish — defer save authority to the watch until the
  // server-side save lands (savedFromWatch) or the fallback timer
  // exposes the phone-side save form. See watch-race spec §6.2.
  const [finishedOnWatch, setFinishedOnWatch] = useState(false);
  const [savedFromWatch, setSavedFromWatch] = useState(false);
  const watchSaveFallbackRef = useRef<number | null>(null);

  const queryClient = useQueryClient();
  const isLoggedIn = useIsLoggedIn();

  const defaultSegments = buildFullRaceSegments("women_open");
  const timer = useRaceTimer(defaultSegments);
  const timerRef = useRef(timer);
  timerRef.current = timer;

  // iOS-only: live pace from HealthKit. Returns nulls on web / non-iOS,
  // which the UI uses to hide the pace block. Per pace spec §5.
  const currentSegment =
    timer.state.segments[timer.state.currentSegmentIndex] ?? null;
  const pace = usePaceFromHealthKit({
    status: timer.state.status,
    segmentStartedAt: timer.state.segmentStartedAt,
    currentSegmentType: currentSegment?.segmentType ?? null,
    segmentElapsedMs: timer.segmentElapsedMs,
    completedSegments: timer.state.completedSegments,
  });
  const completedRunCount = timer.state.completedSegments.filter(
    (s) => s.segmentType === "run" && s.segmentSubtype !== "roxzone",
  ).length;

  // Handle recovery prompt
  useEffect(() => {
    if (timer.recovered) {
      setScreen("active");
    }
  }, [timer.recovered]);

  // -------------------------------------------------------------------------
  // Watch race-sync handlers. Plug remote events from the paired Apple
  // Watch into the local timer state machine. Re-bound on every render
  // so the closures always see the latest action handles, but the
  // outbound listener installation happens once via NativeBootstrap.
  // -------------------------------------------------------------------------
  useEffect(() => {
    setRaceSyncHandlers({
      onSplit: (event) => {
        timerRef.current.applyRemoteSplit(event);
      },
      onSplitEnrichment: (event) => {
        timerRef.current.applyRemoteEnrichment(event);
      },
      onPause: (event) => {
        timerRef.current.applyRemotePause(event);
      },
      onResume: (event) => {
        timerRef.current.applyRemoteResume(event);
      },
      onFinish: (event) => {
        timerRef.current.applyRemoteFinish(event);
        // Watch tapped Finish — defer save authority to the watch.
        // The complete screen will show "Saved on Watch (syncing)…"
        // until either (a) the relay broadcasts savedFromWatch or
        // (b) the fallback timer fires and exposes the phone's save
        // form so the user can save here. Server-side idempotency
        // makes a double-save harmless.
        setFinishedOnWatch(true);
        setSavedFromWatch(false);
        if (watchSaveFallbackRef.current !== null) {
          window.clearTimeout(watchSaveFallbackRef.current);
        }
        watchSaveFallbackRef.current = window.setTimeout(() => {
          setFinishedOnWatch(false);
          watchSaveFallbackRef.current = null;
        }, WATCH_SAVE_FALLBACK_MS);
      },
      onCancel: () => {
        // Watch user discarded the race — bring the phone back to setup.
        const state = timerRef.current.state;
        if (state.status === "countdown") {
          timerRef.current.cancelCountdown();
        } else {
          timerRef.current.reset(state.segments);
        }
        setScreen("setup");
      },
      onDiscard: () => {
        // Watch user tapped Discard on the complete screen. Mirror
        // that locally so the phone doesn't sit on a ghost race.
        if (watchSaveFallbackRef.current !== null) {
          window.clearTimeout(watchSaveFallbackRef.current);
          watchSaveFallbackRef.current = null;
        }
        setFinishedOnWatch(false);
        setSavedFromWatch(false);
        const state = timerRef.current.state;
        timerRef.current.reset(state.segments);
        setScreen("setup");
      },
      onAdoptFromWatch: (event) => {
        // Watch started a race — adopt it so the phone mirrors live.
        // The save authority stays with the watch (source: "watch").
        setDivisionKey(event.divisionKey as DivisionKey);
        const tpl = (event.template as RaceTemplate) ?? "full";
        setTemplate(tpl);
        timerRef.current.reset(event.segments);
        requestAnimationFrame(() => {
          timerRef.current.start({
            raceId: event.raceId,
            source: "watch",
            startAt: event.startAt,
          });
          setScreen("active");
        });
      },
    });
  }, []);

  // The phone's relay POSTs queued watch-races to the server. When
  // that completes, flip the local complete-screen UI out of the
  // pending-Save-on-Watch placeholder into the "Saved from your
  // Watch" success state. Only react if the raceId matches the
  // current timer state — we don't want to flash success for an old
  // race the user already cleared.
  useEffect(() => {
    const unsubscribe = onWatchRaceSaved(({ raceId }) => {
      if (timerRef.current.state.raceId !== raceId) return;
      if (watchSaveFallbackRef.current !== null) {
        window.clearTimeout(watchSaveFallbackRef.current);
        watchSaveFallbackRef.current = null;
      }
      setSavedFromWatch(true);
      setFinishedOnWatch(false);
    });
    return () => {
      unsubscribe();
      if (watchSaveFallbackRef.current !== null) {
        window.clearTimeout(watchSaveFallbackRef.current);
        watchSaveFallbackRef.current = null;
      }
    };
  }, []);

  const handleStart = useCallback(
    (segments: RaceSegment[], dk: DivisionKey, t: RaceTemplate) => {
      setDivisionKey(dk);
      setTemplate(t);
      setSaved(false);
      setPersonalBests([]);
      setSavedRaceId(null);
      timer.reset(segments);
      const countdownSeconds = getCountdownPreference();
      const raceId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `r-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const startAt = Date.now() + countdownSeconds * 1000;
      // Small delay to let reset propagate, then start
      requestAnimationFrame(() => {
        timer.start({ countdownSeconds, raceId, source: "phone" });
        setScreen("active");
        // Push the race to the paired Apple Watch. No-op off native /
        // when the watch app isn't installed. The watch will display
        // the same countdown and start ticking at `startAt`.
        void sendRaceStartToWatch({
          raceId,
          divisionKey: dk,
          template: t,
          simulateRoxzone: segments.some((s) => s.segmentSubtype === "roxzone"),
          startAt,
          segments,
        });
      });
    },
    [timer],
  );

  const handleCancelCountdown = useCallback(() => {
    const raceId = timer.state.raceId;
    timer.cancelCountdown();
    setScreen("setup");
    if (raceId) {
      void sendCancelToWatch({ raceId });
    }
  }, [timer]);

  const handleSplit = useCallback(async () => {
    // On iOS native + run segment, capture the HealthKit-measured
    // distance for the just-completed run before advancing. captureSegmentDistance()
    // returns null on web / stations and the timer falls back to no
    // distance — preserves existing web behavior unchanged.
    const distanceMeters =
      currentSegment?.segmentType === "run"
        ? await pace.captureSegmentDistance()
        : null;
    const completedAt = Date.now();
    const segmentOrder = timer.state.currentSegmentIndex + 1;
    const raceId = timer.state.raceId;
    timer.split({ distanceMeters });
    if (raceId) {
      void sendSplitToWatch({
        raceId,
        segmentOrder,
        completedAt,
        distanceMeters,
      });
    }
  }, [timer, currentSegment, pace]);

  const handlePause = useCallback(() => {
    const at = Date.now();
    const raceId = timer.state.raceId;
    timer.pause();
    if (raceId) void sendPauseToWatch({ raceId, at });
  }, [timer]);

  const handleResume = useCallback(() => {
    const at = Date.now();
    const raceId = timer.state.raceId;
    timer.resume();
    if (raceId) void sendResumeToWatch({ raceId, at });
  }, [timer]);

  // Watch for race completion via the timer state
  useEffect(() => {
    if (timer.state.status === "complete" && screen === "active") {
      setScreen("complete");
    }
  }, [timer.state.status, screen]);

  const handleEndRace = useCallback(async () => {
    const distanceMeters =
      currentSegment?.segmentType === "run"
        ? await pace.captureSegmentDistance()
        : null;
    const raceId = timer.state.raceId;
    const at = Date.now();
    const result = timer.endRace({ distanceMeters });
    setRaceResult(result);
    setScreen("complete");
    if (raceId) void sendFinishToWatch({ raceId, at });
  }, [timer, currentSegment, pace]);

  const handleSave = useCallback(
    async (
      title: string,
      notes: string,
      raceType: "practice" | "actual",
    ) => {
      setIsSaving(true);
      try {
        const segments = timer.state.completedSegments;
        const totalMs = segments.reduce((sum, s) => sum + s.timeMs, 0);

        const payload = {
          // Client-supplied race id, shared with the paired watch.
          // The server dedups against (user_id, raceId) so a race
          // already saved from the watch becomes an idempotent no-op
          // here. Omitted for legacy state that pre-dates raceId
          // tracking — the server falls back to inserting a new row.
          ...(timer.state.raceId ? { raceId: timer.state.raceId } : {}),
          title,
          notes,
          divisionKey,
          template,
          raceType,
          totalTimeSeconds: totalMs / 1000,
          startedAt: timer.state.raceStartedAt
            ? new Date(timer.state.raceStartedAt).toISOString()
            : new Date().toISOString(),
          completedAt: new Date().toISOString(),
          splits: segments.map((s) => ({
            segmentOrder: s.segmentOrder,
            segmentType: s.segmentType,
            segmentLabel: s.label,
            timeSeconds: s.timeMs / 1000,
            ...(s.segmentSubtype ? { segmentSubtype: s.segmentSubtype } : {}),
            ...(typeof s.distanceMeters === "number"
              ? { distanceMeters: s.distanceMeters }
              : {}),
            ...(typeof s.reps === "number" ? { reps: s.reps } : {}),
            ...(typeof s.weightKg === "number" ? { weightKg: s.weightKg } : {}),
            ...(typeof s.weightLabel === "string" && s.weightLabel
              ? { weightLabel: s.weightLabel }
              : {}),
          })),
        };

        const response = await fetch("/api/hyrox/practice-races", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          // If offline or server error, queue for later
          if (!navigator.onLine || response.status >= 500) {
            queuePendingSave({
              result: {
                totalTimeMs: totalMs,
                startedAt: timer.state.raceStartedAt ?? Date.now(),
                completedAt: Date.now(),
                segments,
                template,
                divisionKey,
              },
              title,
              notes,
              divisionKey,
              template,
            });
            setSaved(true);
            return;
          }
          throw new Error("Failed to save");
        }

        const data = await response.json();
        if (data.personalBests) {
          setPersonalBests(data.personalBests);
        }
        if (data.id) {
          setSavedRaceId(data.id);
        }
        setSaved(true);

        // Refresh races + benchmarks lists
        queryClient.invalidateQueries({ queryKey: practiceRaceKeys.lists() });
        queryClient.invalidateQueries({
          queryKey: ["hyrox-station-benchmarks"],
        });
        queryClient.invalidateQueries({
          queryKey: ["plan-recalibration-suggestion"],
        });

        // Surface a PR toast if this finish beat the user's best.
        if (data.isFinishPR && data.id) {
          const seconds = Math.round(totalMs / 1000);
          const priorPart = data.priorBestFinishSeconds
            ? ` (prev ${formatLongTime(data.priorBestFinishSeconds)})`
            : "";
          toast.success(
            `New finish-time PR: ${formatLongTime(seconds)}${priorPart}`,
            {
              description:
                raceType === "actual"
                  ? "Update your profile best time?"
                  : "Update your profile best time? (practice sims also count)",
              duration: 12_000,
              action: {
                label: "Update profile",
                onClick: async () => {
                  try {
                    const res = await fetch(
                      "/api/hyrox/profile/sync-from-race",
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          raceId: data.id,
                          applyFinishPR: true,
                          incrementRaceCount: raceType === "actual",
                          applyDivision: true,
                        }),
                      },
                    );
                    if (!res.ok) throw new Error("Failed");
                    toast.success("Profile updated");
                    queryClient.invalidateQueries({ queryKey: ["profile"] });
                  } catch {
                    toast.error("Couldn't update profile");
                  }
                },
              },
            },
          );
        } else if (data.personalBests && data.personalBests.length > 0) {
          toast.success(
            `Station PR${data.personalBests.length > 1 ? "s" : ""}: ${data.personalBests.join(", ")}`,
          );
        }
      } catch {
        // Queue for offline sync
        const segments = timer.state.completedSegments;
        const totalMs = segments.reduce((sum, s) => sum + s.timeMs, 0);
        queuePendingSave({
          result: {
            totalTimeMs: totalMs,
            startedAt: timer.state.raceStartedAt ?? Date.now(),
            completedAt: Date.now(),
            segments,
            template,
            divisionKey,
          },
          title,
          notes,
          divisionKey,
          template,
        });
        setSaved(true);
      } finally {
        setIsSaving(false);
      }
    },
    [timer, divisionKey, template, queryClient],
  );

  const resetDeferredSaveState = useCallback(() => {
    if (watchSaveFallbackRef.current !== null) {
      window.clearTimeout(watchSaveFallbackRef.current);
      watchSaveFallbackRef.current = null;
    }
    setFinishedOnWatch(false);
    setSavedFromWatch(false);
  }, []);

  const handleNewRace = useCallback(() => {
    timer.reset(buildFullRaceSegments(divisionKey));
    setSaved(false);
    setSavedRaceId(null);
    setPersonalBests([]);
    setRaceResult(null);
    resetDeferredSaveState();
    setScreen("setup");
  }, [timer, divisionKey, resetDeferredSaveState]);

  const handleBack = useCallback(() => {
    timer.reset(buildFullRaceSegments(divisionKey));
    setSaved(false);
    setSavedRaceId(null);
    setPersonalBests([]);
    setRaceResult(null);
    resetDeferredSaveState();
    setScreen("setup");
  }, [timer, divisionKey, resetDeferredSaveState]);

  // Compute total time from completed segments
  const totalTimeMs = timer.state.completedSegments.reduce(
    (sum, s) => sum + s.timeMs,
    0,
  );

  // Save authority follows the Finish tap, not the start. When the
  // watch was the finisher (either watch-origin or phone-origin
  // finished on the watch), defer to the watch's save until either
  // the relay POSTs successfully (savedFromWatch flips on) or the
  // fallback timer fires and exposes the phone-side save form. While
  // pending, the complete screen suppresses save controls. See
  // watch_finish_owns_save_spec.md §6.2.
  const pendingWatchSave = finishedOnWatch && !saved;

  if (screen === "setup") {
    return <TimerSetup onStart={handleStart} />;
  }

  if (screen === "active" && timer.state.status !== "complete") {
    return (
      <TimerActive
        status={timer.state.status}
        segments={timer.state.segments}
        currentSegmentIndex={timer.state.currentSegmentIndex}
        segmentElapsedMs={timer.segmentElapsedMs}
        totalElapsedMs={timer.totalElapsedMs}
        completedCount={timer.state.completedSegments.length}
        countdownRemainingSec={timer.countdownRemainingSec}
        onCancelCountdown={handleCancelCountdown}
        onSplit={handleSplit}
        onPause={handlePause}
        onResume={handleResume}
        onEndRace={handleEndRace}
        currentRunPaceSecPerKm={pace.currentRunPaceSecPerKm}
        avgRunPaceSecPerKm={pace.avgRunPaceSecPerKm}
        completedRunCount={completedRunCount}
      />
    );
  }

  // Complete screen (either via last split or endRace)
  return (
    <TimerComplete
      completedSegments={timer.state.completedSegments}
      totalTimeMs={totalTimeMs}
      template={template}
      divisionKey={divisionKey}
      isLoggedIn={isLoggedIn}
      onSave={handleSave}
      onNewRace={handleNewRace}
      onBack={handleBack}
      personalBests={personalBests}
      isSaving={isSaving}
      saved={saved}
      savedRaceId={savedRaceId}
      pendingWatchSave={pendingWatchSave}
      savedFromWatch={savedFromWatch}
    />
  );
}
