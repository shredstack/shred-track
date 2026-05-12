"use client";

// today-notifications.ts — scheduler for the morning brief and midday
// score nudge (spec watch_today_view_and_nudges_spec.md §5.3, §7).
//
// Honest constraint we live with: notification bodies are baked at
// schedule time, and the iPhone only re-schedules while the WebView is
// foregrounded. If the user doesn't open the app for several days, the
// notification still fires, but the body is whatever was current the
// last time they opened it. That's why both notifications default to
// generic bodies (§5.3) — they don't go stale. We upgrade to specific
// bodies on foreground.

import {
  LocalNotifications,
  type ScheduleOptions,
} from "@capacitor/local-notifications";
import { isNativeApp } from "../is-native";
import {
  DEFAULT_PREFS,
  getTodayNotificationPrefs,
  type TodayNotificationPrefs,
} from "./preferences";

const MORNING_BRIEF_ID = 1001;
const MIDDAY_NUDGE_ID = 1002;

const GENERIC_MORNING_TITLE = "Today's training";
const GENERIC_MORNING_BODY = "Tap to see what's on the schedule.";
const GENERIC_NUDGE_TITLE = "Don't forget to log";
const GENERIC_NUDGE_BODY = "Open ShredTrack to log today's training.";

interface TodayState {
  hyrox: any;
  crossfit: any;
  recovery: any;
}

/// Fetches today's three endpoints. Used only while the WebView is
/// foregrounded — see header. Returns null on any error; caller falls
/// back to generic bodies.
async function fetchTodayState(): Promise<TodayState | null> {
  try {
    const date = todayLocalDateString();
    const [hyrox, crossfit, recovery] = await Promise.all([
      fetch("/api/hyrox/plan/today").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/crossfit/wod/today").then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/recovery/sessions?date=${date}`).then((r) =>
        r.ok ? r.json() : null,
      ),
    ]);
    return { hyrox, crossfit, recovery };
  } catch {
    return null;
  }
}

function todayLocalDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function truncate(s: string, max = 100): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

function morningBriefBody(
  state: TodayState | null,
  prefs: TodayNotificationPrefs,
): string | null {
  if (!state) return GENERIC_MORNING_BODY;

  const parts: string[] = [];

  // HYROX
  if (prefs.includeHyrox && state.hyrox?.plan) {
    const rest = !!state.hyrox.rest;
    const session = (state.hyrox.sessions ?? [])[0];
    const week = state.hyrox.week;
    if (rest) {
      parts.push("Rest day");
    } else if (session?.title) {
      const phase = state.hyrox.phase?.name ?? state.hyrox.phase?.phase;
      const weekPart = week ? `Wk ${week}` : "";
      const phasePart = phase ? `${weekPart} ${phase}`.trim() : weekPart;
      parts.push(
        phasePart
          ? `HYROX: ${session.title} (${phasePart})`
          : `HYROX: ${session.title}`,
      );
    }
  }

  // CrossFit
  if (prefs.includeCrossfit) {
    const wod = (state.crossfit?.workouts ?? [])[0];
    if (wod?.title) {
      parts.push(`WOD: ${wod.title}`);
    }
  }

  // Recovery
  if (prefs.includeRecovery) {
    const items = Array.isArray(state.recovery) ? state.recovery : [];
    if (items.length > 0) {
      const first = items[0];
      const name = first?.schedule?.name ?? "Recovery";
      parts.push(`Mobility: ${name}`);
    }
  }

  if (parts.length === 0) return null; // nothing programmed — skip the brief
  return truncate(parts.join(" • "));
}

interface NudgeDecision {
  shouldFire: boolean;
  body: string;
}

function nudgeDecision(
  state: TodayState | null,
  prefs: TodayNotificationPrefs,
): NudgeDecision {
  if (!state) {
    return { shouldFire: true, body: GENERIC_NUDGE_BODY };
  }

  // Rest day + nothing else → no nudge.
  const hyroxRest = !!state.hyrox?.rest;
  const hyroxSessions = (state.hyrox?.sessions ?? []) as any[];
  const wods = (state.crossfit?.workouts ?? []) as any[];
  const recoveryItems = (Array.isArray(state.recovery) ? state.recovery : []) as any[];

  const includeHyrox = prefs.includeHyrox;
  const includeCrossfit = prefs.includeCrossfit;
  const includeRecovery = prefs.includeRecovery;

  const unloggedHyrox = includeHyrox
    ? hyroxSessions.find((s) => !s.log)
    : undefined;
  const unloggedWod = includeCrossfit
    ? wods.find((w) => !w.loggedByUser)
    : undefined;
  const incompleteRecovery = includeRecovery
    ? recoveryItems.find((r) => r?.session?.status !== "complete")
    : undefined;

  // Nothing programmed AND/OR everything done.
  if (
    !unloggedHyrox &&
    !unloggedWod &&
    !incompleteRecovery &&
    (hyroxRest || hyroxSessions.length === 0) &&
    wods.length === 0 &&
    recoveryItems.length === 0
  ) {
    return { shouldFire: false, body: "" };
  }
  if (!unloggedHyrox && !unloggedWod && !incompleteRecovery) {
    return { shouldFire: false, body: "" };
  }

  // Specific body — prefer HYROX > CrossFit > Recovery (§7.2).
  let primary = "today's training";
  if (unloggedHyrox?.title) primary = unloggedHyrox.title;
  else if (unloggedWod?.title) primary = unloggedWod.title;
  else if (incompleteRecovery?.schedule?.name) {
    primary = incompleteRecovery.schedule.name;
  }
  return {
    shouldFire: true,
    body: truncate(
      `You haven't logged ${primary} yet. Open ShredTrack to log it.`,
    ),
  };
}

async function cancelById(id: number): Promise<void> {
  try {
    await LocalNotifications.cancel({ notifications: [{ id }] });
  } catch {
    // Cancel is idempotent in spirit — swallow.
  }
}

/// Re-schedules both notifications based on current preferences and
/// (if available) today's training data. Safe to call from any
/// foreground transition — it cancels then re-schedules, so duplicates
/// can't accumulate.
export async function rescheduleTodayNotifications(): Promise<void> {
  if (!isNativeApp()) return;

  const prefs = await getTodayNotificationPrefs();

  // Snapshot today's data once (cheap, the user is foregrounded).
  const state = await fetchTodayState();

  const toSchedule: ScheduleOptions["notifications"] = [];

  // --- Morning brief
  await cancelById(MORNING_BRIEF_ID);
  if (prefs.morningBriefEnabled) {
    const body = morningBriefBody(state, prefs);
    if (body !== null) {
      toSchedule.push({
        id: MORNING_BRIEF_ID,
        title: GENERIC_MORNING_TITLE,
        body,
        schedule: {
          on: {
            hour: prefs.morningBriefHour,
            minute: prefs.morningBriefMinute,
          },
          allowWhileIdle: true,
          every: "day",
        },
      });
    }
  }

  // --- Midday nudge
  await cancelById(MIDDAY_NUDGE_ID);
  if (prefs.middayNudgeEnabled) {
    const decision = nudgeDecision(state, prefs);
    if (decision.shouldFire) {
      toSchedule.push({
        id: MIDDAY_NUDGE_ID,
        title: GENERIC_NUDGE_TITLE,
        body: decision.body,
        schedule: {
          on: {
            hour: prefs.middayNudgeHour,
            minute: prefs.middayNudgeMinute,
          },
          allowWhileIdle: true,
          every: "day",
        },
      });
    }
  }

  if (toSchedule.length > 0) {
    try {
      await LocalNotifications.schedule({ notifications: toSchedule });
    } catch (err) {
      console.warn("[today-notifications] schedule failed", err);
    }
  }
}

/// Ensures the OS notification permission is requested. Used by the
/// pre-prompt screen on first sign-in / first visit to the settings
/// page (spec §7.3). Returns whether we got "granted".
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const status = await LocalNotifications.checkPermissions();
    if (status.display === "granted") return true;
    if (status.display === "denied") return false;
    const next = await LocalNotifications.requestPermissions();
    return next.display === "granted";
  } catch {
    return false;
  }
}

/// Cancels both notifications. Used by the settings UI when the user
/// disables everything.
export async function cancelAllTodayNotifications(): Promise<void> {
  if (!isNativeApp()) return;
  await cancelById(MORNING_BRIEF_ID);
  await cancelById(MIDDAY_NUDGE_ID);
}

export { DEFAULT_PREFS };
