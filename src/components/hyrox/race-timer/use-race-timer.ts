"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CompletedSegment,
  RaceSegment,
  RaceSource,
  TimerState,
  TimerStatus,
  PracticeRaceResult,
} from "./types";

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = "shredtrack-race-timer";

function saveState(state: TimerState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable — non-critical
  }
}

function loadState(): TimerState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as TimerState;
  } catch {
    return null;
  }
}

function clearState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // noop
  }
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

function makeInitialState(segments: RaceSegment[]): TimerState {
  return {
    status: "idle",
    raceId: null,
    source: null,
    raceStartedAt: null,
    segmentStartedAt: null,
    countdownEndsAt: null,
    pausedAt: null,
    totalPausedMs: 0,
    segments,
    completedSegments: [],
    currentSegmentIndex: 0,
  };
}

function newRaceId(): string {
  // Phone-originated race id. Watch uses its own scheme; the two share a
  // single id string per race regardless of who minted it.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface StartOptions {
  /** Countdown duration in seconds. 0 starts the race immediately. */
  countdownSeconds?: number;
  /** Set to "watch" when adopting an in-progress race that originated on
   *  the paired Apple Watch. The phone becomes a live mirror but won't
   *  own the save at the end. */
  source?: RaceSource;
  /** Pre-minted race id (for adopted races). When omitted, a fresh id
   *  is generated locally. */
  raceId?: string;
  /** Pre-determined absolute start time. Used when adopting an in-progress
   *  race so both devices' clocks line up on the same instant. */
  startAt?: number;
}

export interface UseRaceTimerReturn {
  state: TimerState;
  /** Current segment elapsed time in ms (updates via rAF) */
  segmentElapsedMs: number;
  /** Total race elapsed time in ms (updates via rAF) */
  totalElapsedMs: number;
  /** Remaining countdown seconds (integer, 0 when not counting down) */
  countdownRemainingSec: number;
  /** Start the race. With a non-zero countdown, the status flips to
   *  "countdown" first and auto-advances to "running" when it expires. */
  start: (opts?: StartOptions) => void;
  /** Cancel an in-progress countdown and return to idle. No-op outside
   *  of "countdown" status. */
  cancelCountdown: () => void;
  /** Advance to the next segment (split). On iOS native, pass the
   *  HealthKit-measured distance for the just-completed run segment so
   *  it's persisted on the CompletedSegment. */
  split: (opts?: { distanceMeters?: number | null }) => void;
  /** Pause the timer */
  pause: () => void;
  /** Resume from pause */
  resume: () => void;
  /** End the race early. On iOS native, pass the HealthKit-measured
   *  distance for the in-progress run segment if it's a run. */
  endRace: (opts?: { distanceMeters?: number | null }) => PracticeRaceResult;
  /** Reset everything back to idle with new segments */
  reset: (segments: RaceSegment[]) => void;
  /** Whether a saved in-progress race was recovered from localStorage */
  recovered: boolean;
  /** Discard recovered state */
  discardRecovery: () => void;
  // -------------------------------------------------------------------------
  // Bidirectional sync ingress — applied when an event arrives from the
  // paired Apple Watch (or, in principle, any peer device). The "first
  // timestamp wins per segmentOrder" merge keeps phone+watch convergent
  // even if both tap a SPLIT within the same beat. See
  // src/lib/native/watch-race-sync.ts for the transport layer.
  // -------------------------------------------------------------------------
  /** Apply a remote split event. Idempotent: a second event for the
   *  same `segmentOrder` is dropped (first-write-wins) unless it
   *  carries an earlier `completedAt`, in which case the local copy is
   *  replaced. */
  applyRemoteSplit: (event: RemoteSplitEvent) => void;
  /** Backfill a HealthKit distance onto an already-recorded run split.
   *  Used when the watch sees a phone-originated split for a run
   *  segment and reports back the measured distance. */
  applyRemoteEnrichment: (event: RemoteEnrichmentEvent) => void;
  /** Apply a remote pause. Idempotent. */
  applyRemotePause: (event: { raceId: string; at: number }) => void;
  /** Apply a remote resume. Idempotent. */
  applyRemoteResume: (event: { raceId: string; at: number }) => void;
  /** Apply a remote end-race event. Stops the timer locally. */
  applyRemoteFinish: (event: { raceId: string; at: number }) => void;
}

export interface RemoteSplitEvent {
  raceId: string;
  segmentOrder: number;
  completedAt: number;
  /** The originating device, so the receiver can decide whether to
   *  enrich it with HealthKit data (only the watch can do that). */
  originDevice: RaceSource;
  /** Already-attached distance (watch-originated splits carry this). */
  distanceMeters?: number | null;
}

export interface RemoteEnrichmentEvent {
  raceId: string;
  segmentOrder: number;
  distanceMeters: number;
}

export function useRaceTimer(initialSegments: RaceSegment[]): UseRaceTimerReturn {
  const [recovered, setRecovered] = useState(false);
  const [state, setState] = useState<TimerState>(() => {
    const saved = loadState();
    if (saved && saved.status !== "idle" && saved.status !== "complete") {
      // A countdown that was mid-flight when the user closed the tab is
      // ambiguous to resume. Reset it back to idle so they explicitly
      // start fresh.
      if (saved.status === "countdown") {
        return makeInitialState(initialSegments);
      }
      setRecovered(true);
      return saved;
    }
    return makeInitialState(initialSegments);
  });

  // Animated elapsed values (updated via rAF, not React state, for perf)
  const [segmentElapsedMs, setSegmentElapsedMs] = useState(0);
  const [totalElapsedMs, setTotalElapsedMs] = useState(0);
  const [countdownRemainingSec, setCountdownRemainingSec] = useState(0);
  const rafRef = useRef<number>(0);

  // Persist state changes
  useEffect(() => {
    saveState(state);
  }, [state]);

  // ---------------------------------------------------------------------------
  // rAF display loop
  // ---------------------------------------------------------------------------

  useEffect(() => {
    function tick() {
      const {
        status,
        segmentStartedAt,
        raceStartedAt,
        totalPausedMs,
        pausedAt,
        countdownEndsAt,
      } = state;

      if (status === "running" && segmentStartedAt && raceStartedAt) {
        const now = performance.timeOrigin + performance.now();
        setSegmentElapsedMs(now - segmentStartedAt);
        setTotalElapsedMs(now - raceStartedAt - totalPausedMs);
      } else if (status === "paused" && pausedAt && segmentStartedAt && raceStartedAt) {
        // Show frozen values while paused
        setSegmentElapsedMs(pausedAt - segmentStartedAt);
        setTotalElapsedMs(pausedAt - raceStartedAt - totalPausedMs);
      } else if (status === "countdown" && countdownEndsAt) {
        const remainingMs = countdownEndsAt - Date.now();
        // ceil so "0.4s left" reads as 1, matches what the user expects.
        const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
        setCountdownRemainingSec(remaining);
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    if (
      state.status === "running" ||
      state.status === "paused" ||
      state.status === "countdown"
    ) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      setSegmentElapsedMs(0);
      setCountdownRemainingSec(0);
      // Keep totalElapsedMs for complete state
    }

    return () => cancelAnimationFrame(rafRef.current);
  }, [state]);

  // ---------------------------------------------------------------------------
  // Countdown auto-fire
  // ---------------------------------------------------------------------------
  //
  // When status is "countdown", schedule a one-shot timer for the exact
  // `countdownEndsAt` instant. We use `Date.now()` (wall clock) rather
  // than performance.now() so the deadline survives the rAF loop being
  // throttled by the browser when the tab loses focus. If the user
  // navigates away and comes back after the countdown should have
  // fired, the effect will see a negative `delay` and fire immediately.

  useEffect(() => {
    if (state.status !== "countdown" || !state.countdownEndsAt) return;
    const delay = Math.max(0, state.countdownEndsAt - Date.now());
    const id = window.setTimeout(() => {
      setState((prev) => {
        if (prev.status !== "countdown" || !prev.countdownEndsAt) return prev;
        const startAt = prev.countdownEndsAt;
        return {
          ...prev,
          status: "running" as TimerStatus,
          raceStartedAt: startAt,
          segmentStartedAt: startAt,
          countdownEndsAt: null,
          pausedAt: null,
          totalPausedMs: 0,
          completedSegments: [],
          currentSegmentIndex: 0,
        };
      });
    }, delay);
    return () => window.clearTimeout(id);
  }, [state.status, state.countdownEndsAt]);

  // ---------------------------------------------------------------------------
  // Wake Lock
  // ---------------------------------------------------------------------------

  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    async function acquireWakeLock() {
      if ("wakeLock" in navigator) {
        try {
          wakeLockRef.current = await navigator.wakeLock.request("screen");
        } catch {
          // Wake lock failed — non-critical
        }
      }
    }

    if (
      state.status === "running" ||
      state.status === "paused" ||
      state.status === "countdown"
    ) {
      acquireWakeLock();
    } else {
      wakeLockRef.current?.release();
      wakeLockRef.current = null;
    }

    return () => {
      wakeLockRef.current?.release();
      wakeLockRef.current = null;
    };
  }, [state.status]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const start = useCallback((opts?: StartOptions) => {
    const now = Date.now();
    const countdownSeconds = Math.max(0, opts?.countdownSeconds ?? 0);
    const source: RaceSource = opts?.source ?? "phone";
    const raceId = opts?.raceId ?? newRaceId();
    const startAt = opts?.startAt ?? now + countdownSeconds * 1000;

    setState((prev) => {
      if (countdownSeconds > 0 && !opts?.startAt) {
        return {
          ...prev,
          status: "countdown" as TimerStatus,
          raceId,
          source,
          raceStartedAt: null,
          segmentStartedAt: null,
          countdownEndsAt: startAt,
          pausedAt: null,
          totalPausedMs: 0,
          completedSegments: [],
          currentSegmentIndex: 0,
        };
      }

      // Either no countdown, or we're adopting an in-progress race with
      // an absolute `startAt`. In the adoption case `startAt` may be in
      // the past (we joined late), which is fine — the elapsed clock
      // will simply read further into the race.
      const inFuture = startAt > now;
      return {
        ...prev,
        status: inFuture ? ("countdown" as TimerStatus) : ("running" as TimerStatus),
        raceId,
        source,
        raceStartedAt: inFuture ? null : startAt,
        segmentStartedAt: inFuture ? null : startAt,
        countdownEndsAt: inFuture ? startAt : null,
        pausedAt: null,
        totalPausedMs: 0,
        completedSegments: [],
        currentSegmentIndex: 0,
      };
    });
  }, []);

  const cancelCountdown = useCallback(() => {
    setState((prev) => {
      if (prev.status !== "countdown") return prev;
      return makeInitialState(prev.segments);
    });
  }, []);

  // -------------------------------------------------------------------------
  // Split — merges in-place so both local taps and remote events share
  // the same code path. `originDevice` lets the caller (or the merge
  // routine) decide later whether to enrich a run split with HK distance.
  // -------------------------------------------------------------------------

  function mergeSplit(
    prev: TimerState,
    args: {
      segmentOrder: number;
      completedAt: number;
      distanceMeters?: number | null;
    },
  ): TimerState {
    if (prev.status !== "running" || !prev.segmentStartedAt) return prev;
    if (args.segmentOrder !== prev.currentSegmentIndex + 1) {
      // Late / duplicate / out-of-order event — drop it. The "first
      // tap wins" rule means a segment that's already advanced past
      // can't be retroactively re-completed by the slower peer.
      return prev;
    }

    const seg = prev.segments[prev.currentSegmentIndex];
    const segTime = args.completedAt - prev.segmentStartedAt;
    if (segTime < 0) return prev;

    const completed: CompletedSegment = {
      segmentOrder: args.segmentOrder,
      segmentType: seg.segmentType,
      segmentSubtype: seg.segmentSubtype ?? null,
      label: seg.label,
      timeMs: segTime,
      distanceMeters:
        seg.segmentType === "run" && typeof args.distanceMeters === "number"
          ? Math.round(args.distanceMeters)
          : seg.distanceMeters ?? null,
      reps: seg.reps ?? null,
      weightKg: seg.weightKg ?? null,
      weightLabel: seg.weightLabel ?? null,
    };

    const nextIndex = prev.currentSegmentIndex + 1;
    const isLast = nextIndex >= prev.segments.length;

    return {
      ...prev,
      status: isLast ? ("complete" as TimerStatus) : ("running" as TimerStatus),
      completedSegments: [...prev.completedSegments, completed],
      currentSegmentIndex: nextIndex,
      segmentStartedAt: isLast ? null : args.completedAt,
    };
  }

  const split = useCallback((opts?: { distanceMeters?: number | null }) => {
    setState((prev) =>
      mergeSplit(prev, {
        segmentOrder: prev.currentSegmentIndex + 1,
        completedAt: Date.now(),
        distanceMeters: opts?.distanceMeters,
      }),
    );
  }, []);

  const applyRemoteSplit = useCallback((event: RemoteSplitEvent) => {
    setState((prev) => {
      // Stale event for a previous race (or for a race we never adopted).
      if (!prev.raceId || prev.raceId !== event.raceId) return prev;
      return mergeSplit(prev, {
        segmentOrder: event.segmentOrder,
        completedAt: event.completedAt,
        distanceMeters: event.distanceMeters,
      });
    });
  }, []);

  const applyRemoteEnrichment = useCallback((event: RemoteEnrichmentEvent) => {
    setState((prev) => {
      if (!prev.raceId || prev.raceId !== event.raceId) return prev;
      let touched = false;
      const next = prev.completedSegments.map((s) => {
        if (s.segmentOrder !== event.segmentOrder) return s;
        if (s.segmentType !== "run") return s;
        // Don't clobber a distance that's already there.
        if (typeof s.distanceMeters === "number" && s.distanceMeters > 0) {
          return s;
        }
        touched = true;
        return { ...s, distanceMeters: Math.round(event.distanceMeters) };
      });
      if (!touched) return prev;
      return { ...prev, completedSegments: next };
    });
  }, []);

  const pause = useCallback(() => {
    setState((prev) => {
      if (prev.status !== "running") return prev;
      return { ...prev, status: "paused" as TimerStatus, pausedAt: Date.now() };
    });
  }, []);

  const resume = useCallback(() => {
    setState((prev) => {
      if (prev.status !== "paused" || !prev.pausedAt) return prev;
      const pauseDuration = Date.now() - prev.pausedAt;
      return {
        ...prev,
        status: "running" as TimerStatus,
        pausedAt: null,
        segmentStartedAt: (prev.segmentStartedAt ?? 0) + pauseDuration,
        totalPausedMs: prev.totalPausedMs + pauseDuration,
      };
    });
  }, []);

  const applyRemotePause = useCallback(
    (event: { raceId: string; at: number }) => {
      setState((prev) => {
        if (!prev.raceId || prev.raceId !== event.raceId) return prev;
        if (prev.status !== "running") return prev;
        return { ...prev, status: "paused" as TimerStatus, pausedAt: event.at };
      });
    },
    [],
  );

  const applyRemoteResume = useCallback(
    (event: { raceId: string; at: number }) => {
      setState((prev) => {
        if (!prev.raceId || prev.raceId !== event.raceId) return prev;
        if (prev.status !== "paused" || !prev.pausedAt) return prev;
        const pauseDuration = event.at - prev.pausedAt;
        return {
          ...prev,
          status: "running" as TimerStatus,
          pausedAt: null,
          segmentStartedAt: (prev.segmentStartedAt ?? 0) + pauseDuration,
          totalPausedMs: prev.totalPausedMs + pauseDuration,
        };
      });
    },
    [],
  );

  const buildResult = useCallback(
    (s: TimerState): PracticeRaceResult => {
      const totalMs = s.completedSegments.reduce((sum, seg) => sum + seg.timeMs, 0);
      return {
        totalTimeMs: totalMs,
        startedAt: s.raceStartedAt ?? Date.now(),
        completedAt: Date.now(),
        segments: s.completedSegments,
        template: "full",
        divisionKey: "",
      };
    },
    [],
  );

  const endRace = useCallback(
    (opts?: { distanceMeters?: number | null }): PracticeRaceResult => {
      let result: PracticeRaceResult | null = null;

      setState((prev) => {
        // Complete the current segment if running
        const now = Date.now();
        let completed = [...prev.completedSegments];

        if (
          prev.status === "running" &&
          prev.segmentStartedAt &&
          prev.currentSegmentIndex < prev.segments.length
        ) {
          const seg = prev.segments[prev.currentSegmentIndex];
          completed.push({
            segmentOrder: prev.currentSegmentIndex + 1,
            segmentType: seg.segmentType,
            segmentSubtype: seg.segmentSubtype ?? null,
            label: seg.label,
            timeMs: now - prev.segmentStartedAt,
            distanceMeters:
              seg.segmentType === "run" &&
              typeof opts?.distanceMeters === "number"
                ? Math.round(opts.distanceMeters)
                : seg.distanceMeters ?? null,
            reps: seg.reps ?? null,
            weightKg: seg.weightKg ?? null,
            weightLabel: seg.weightLabel ?? null,
          });
        }

        const next: TimerState = {
          ...prev,
          status: "complete",
          completedSegments: completed,
          segmentStartedAt: null,
          pausedAt: null,
        };

        result = buildResult(next);
        return next;
      });

      // result will be set synchronously by the setState callback
      return result!;
    },
    [buildResult],
  );

  const applyRemoteFinish = useCallback(
    (event: { raceId: string; at: number }) => {
      setState((prev) => {
        if (!prev.raceId || prev.raceId !== event.raceId) return prev;
        if (prev.status === "complete") return prev;
        // Implicit close-out of the in-progress segment using the remote
        // wall-clock timestamp so the timing matches the originating
        // device. Run distance is unknown from here — the watch
        // backfills via `applyRemoteEnrichment` if it has HK data.
        const completed = [...prev.completedSegments];
        if (
          prev.status === "running" &&
          prev.segmentStartedAt &&
          prev.currentSegmentIndex < prev.segments.length
        ) {
          const seg = prev.segments[prev.currentSegmentIndex];
          const segTime = Math.max(0, event.at - prev.segmentStartedAt);
          completed.push({
            segmentOrder: prev.currentSegmentIndex + 1,
            segmentType: seg.segmentType,
            segmentSubtype: seg.segmentSubtype ?? null,
            label: seg.label,
            timeMs: segTime,
            distanceMeters: seg.distanceMeters ?? null,
            reps: seg.reps ?? null,
            weightKg: seg.weightKg ?? null,
            weightLabel: seg.weightLabel ?? null,
          });
        }
        return {
          ...prev,
          status: "complete" as TimerStatus,
          completedSegments: completed,
          segmentStartedAt: null,
          pausedAt: null,
        };
      });
    },
    [],
  );

  const reset = useCallback((segments: RaceSegment[]) => {
    clearState();
    setRecovered(false);
    setSegmentElapsedMs(0);
    setTotalElapsedMs(0);
    setCountdownRemainingSec(0);
    setState(makeInitialState(segments));
  }, []);

  const discardRecovery = useCallback(() => {
    clearState();
    setRecovered(false);
    setSegmentElapsedMs(0);
    setTotalElapsedMs(0);
    setCountdownRemainingSec(0);
    setState(makeInitialState(initialSegments));
  }, [initialSegments]);

  return {
    state,
    segmentElapsedMs,
    totalElapsedMs,
    countdownRemainingSec,
    start,
    cancelCountdown,
    split,
    pause,
    resume,
    endRace,
    reset,
    recovered,
    discardRecovery,
    applyRemoteSplit,
    applyRemoteEnrichment,
    applyRemotePause,
    applyRemoteResume,
    applyRemoteFinish,
  };
}
