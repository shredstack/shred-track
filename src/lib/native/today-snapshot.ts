"use client";

// today-snapshot.ts — opportunistic Today push from the phone to the
// Watch (spec watch_today_view_and_nudges_spec.md §5.1, §3.2 step 5).
//
// After a score-log mutation succeeds in the WebView, we assemble the
// same denormalized snapshot shape the Watch builds locally and push it
// via `WCSession.updateApplicationContext` (through the WatchBridge
// Capacitor plugin). The Watch picks it up immediately and flips the
// "logged ✓" checkmark — no HTTP round-trip on the Watch side.
//
// This is **strictly a UX optimization**. The Watch's own pull-to-
// refresh / TodayView-onAppear paths produce the same result a few
// seconds later. Errors are swallowed.
//
// Trigger points (called from mutation onSuccess in their respective
// hooks):
//   - useLogScore (CrossFit)
//   - useLogSession (HYROX)
//   - useUpdateRecoverySession (recovery)
//
// Do NOT call on app open, app resume, or on a timer — duplicating the
// Watch's own fetch burns the iPhone's bearer-token rate-limit for no
// gain.

import { isNativeApp } from "./is-native";

interface WatchBridge {
  pushTodaySnapshot(opts: { json: string }): Promise<void>;
}

function getWatchBridge(): WatchBridge | null {
  if (typeof window === "undefined") return null;
  // @ts-expect-error - Capacitor injects this global at runtime.
  const cap = window.Capacitor;
  const plugin = cap?.Plugins?.WatchBridge as WatchBridge | undefined;
  return plugin ?? null;
}

function todayLocalDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

interface HyroxSessionRow {
  sessionId: string;
  sessionType: string;
  title: string;
  summary: string;
  logged: boolean;
}

interface CrossfitWorkoutRow {
  workoutId: string;
  title: string;
  summary: string;
  communityName: string;
  logged: boolean;
}

interface RecoveryItemRow {
  scheduleId: string;
  scheduleName: string;
  slotsSummary: string;
  status: string;
}

interface TodaySnapshot {
  date: string;
  generatedAt: number;
  hyrox: {
    planTitle: string | null;
    phase: string | null;
    week: number | null;
    dayLabel: string | null;
    rest: boolean;
    sessions: HyroxSessionRow[];
  };
  crossfit: {
    workouts: CrossfitWorkoutRow[];
  };
  recovery: {
    items: RecoveryItemRow[];
  };
}

function firstLine(text: string | null | undefined): string {
  if (!text) return "";
  const trimmed = String(text).trim();
  const newlineIdx = trimmed.search(/\r?\n/);
  return newlineIdx === -1 ? trimmed : trimmed.slice(0, newlineIdx);
}

function buildSnapshot(
  date: string,
  hyrox: any,
  crossfit: any,
  recovery: any,
): TodaySnapshot {
  const hyroxSection = (() => {
    if (!hyrox?.plan) {
      return {
        planTitle: null,
        phase: null,
        week: null,
        dayLabel: null,
        rest: false,
        sessions: [] as HyroxSessionRow[],
      };
    }
    const sessions: HyroxSessionRow[] = (hyrox.sessions ?? [])
      .map((s: any) => ({
        sessionId: String(s.id),
        sessionType: String(s.sessionType ?? "session"),
        title: String(s.title ?? ""),
        summary: firstLine(s.description),
        logged: !!s.log,
      }));
    return {
      planTitle: hyrox.plan?.title ?? null,
      phase:
        (hyrox.phase?.name as string | undefined)
        ?? (hyrox.phase?.phase as string | undefined)
        ?? null,
      week: typeof hyrox.week === "number" ? hyrox.week : null,
      dayLabel: hyrox.dayLabel ?? null,
      rest: !!hyrox.rest,
      sessions,
    };
  })();

  const crossfitSection = {
    workouts: (crossfit?.workouts ?? []).map((w: any) => ({
      workoutId: String(w.id),
      title: String(w.title ?? ""),
      summary: firstLine(w.description ?? w.rawText),
      communityName: String(w.community?.name ?? ""),
      logged: !!w.loggedByUser,
    })) as CrossfitWorkoutRow[],
  };

  const recoveryItems: RecoveryItemRow[] = (Array.isArray(recovery) ? recovery : [])
    .map((row: any) => {
      const schedule = row?.schedule;
      if (!schedule?.id) return null;
      const slotCount = Array.isArray(row.slots) ? row.slots.length : 0;
      const slotsSummary =
        slotCount === 0
          ? "—"
          : slotCount === 1
            ? "1 movement"
            : `${slotCount} movements`;
      const rawStatus: string | undefined = row?.session?.status;
      const status =
        rawStatus === undefined
          ? "scheduled"
          : rawStatus === "complete"
            ? "completed"
            : rawStatus;
      return {
        scheduleId: String(schedule.id),
        scheduleName: String(schedule.name ?? "Recovery"),
        slotsSummary,
        status,
      } satisfies RecoveryItemRow;
    })
    .filter((x: RecoveryItemRow | null): x is RecoveryItemRow => x !== null);

  return {
    date,
    generatedAt: Math.floor(Date.now() / 1000),
    hyrox: hyroxSection,
    crossfit: crossfitSection,
    recovery: { items: recoveryItems },
  };
}

let inflight: Promise<void> | null = null;

export async function pushTodaySnapshotToWatch(): Promise<void> {
  if (!isNativeApp()) return;
  const bridge = getWatchBridge();
  if (!bridge) return;

  // Collapse concurrent calls — three mutations finishing in the same
  // tick should produce one push, not three.
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const date = todayLocalDateString();
      const [hyroxRes, crossfitRes, recoveryRes] = await Promise.all([
        fetch("/api/hyrox/plan/today").then((r) =>
          r.ok ? r.json() : null,
        ),
        fetch("/api/crossfit/wod/today").then((r) =>
          r.ok ? r.json() : null,
        ),
        fetch(`/api/recovery/sessions?date=${date}`).then((r) =>
          r.ok ? r.json() : null,
        ),
      ]);
      const snapshot = buildSnapshot(date, hyroxRes, crossfitRes, recoveryRes);
      await bridge.pushTodaySnapshot({ json: JSON.stringify(snapshot) });
    } catch (err) {
      // Strictly best-effort — the Watch's own fetch reconciles on next
      // pull or appear.
      console.warn("[today-snapshot] push failed", err);
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
