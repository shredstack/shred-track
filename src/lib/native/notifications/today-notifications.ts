"use client";

// today-notifications.ts — scheduler for the morning brief, midday
// score nudge, and (opt-in) CrossFit log-by-deadline nudge.
//
// Honest constraint we live with: notification bodies are baked at
// schedule time, and the iPhone only re-schedules while the WebView is
// foregrounded. If the user doesn't open the app for several days, the
// notification still fires, but the body is whatever was current the
// last time they opened it. That's why both notifications default to
// generic bodies — they don't go stale. We upgrade to specific
// bodies on foreground.
//
// The CrossFit log nudge is also a *daily* repeat; it fires at the
// user's expected log-by deadline, computed from their registered
// class for today (if any) or their preference fallback. Like the
// midday nudge it only fires when there's an unlogged WOD.

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
import {
  arnoldBriefBody,
  arnoldBriefTitle,
  arnoldCrossfitLogNudgeBody,
  arnoldCrossfitLogNudgeTitle,
  arnoldMiddayNudgeBody,
  arnoldMiddayNudgeTitle,
} from "./arnold-copy";

const MORNING_BRIEF_ID = 1001;
const MIDDAY_NUDGE_ID = 1002;
const CROSSFIT_LOG_NUDGE_ID = 1003;

const GENERIC_MORNING_TITLE = "Today's training";
const GENERIC_MORNING_BODY = "Tap to see what's on the schedule.";
const GENERIC_NUDGE_TITLE = "Don't forget to log";
const GENERIC_NUDGE_BODY = "Open ShredTrack to log today's training.";
const GENERIC_CROSSFIT_LOG_TITLE = "Log your WOD";

interface ClassRegistration {
  classInstanceId: string;
  communityId: string;
  communityName: string | null;
  name: string;
  startAt: string; // ISO
  endAt: string;
  status: string;
  kind: string;
}

interface WodRow {
  title?: string | null;
  loggedByUser?: boolean;
}

interface TodayState {
  hyrox: any;
  crossfit: any;
  recovery: any;
  classes: { date: string; registrations: ClassRegistration[] } | null;
}

/// Fetches today's three endpoints + class registrations. Used only
/// while the WebView is foregrounded — see header. Returns null on any
/// error; caller falls back to generic bodies.
async function fetchTodayState(): Promise<TodayState | null> {
  try {
    const date = todayLocalDateString();
    const tz = new Date().getTimezoneOffset();
    const [hyrox, crossfit, recovery, classes] = await Promise.all([
      fetch(`/api/hyrox/plan/today?date=${date}`).then((r) =>
        r.ok ? r.json() : null,
      ),
      fetch(`/api/crossfit/wod/today?date=${date}`).then((r) =>
        r.ok ? r.json() : null,
      ),
      fetch(`/api/recovery/sessions?date=${date}`).then((r) =>
        r.ok ? r.json() : null,
      ),
      fetch(`/api/classes/today?date=${date}&tzOffsetMinutes=${tz}`).then(
        (r) => (r.ok ? r.json() : null),
      ),
    ]);
    return { hyrox, crossfit, recovery, classes };
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

interface BuiltBrief {
  title: string;
  body: string | null;
}

function buildMorningBrief(
  state: TodayState | null,
  prefs: TodayNotificationPrefs,
): BuiltBrief {
  if (!state) {
    return {
      title: prefs.arnoldVoice ? arnoldBriefTitle() : GENERIC_MORNING_TITLE,
      body: prefs.arnoldVoice
        ? "Get up. Train. No excuses."
        : GENERIC_MORNING_BODY,
    };
  }

  // Resolve session strings
  let hyroxLabel: string | undefined;
  let hyroxRest = false;
  if (prefs.includeHyrox && state.hyrox?.plan) {
    hyroxRest = !!state.hyrox.rest;
    const session = (state.hyrox.sessions ?? [])[0];
    const week = state.hyrox.week;
    if (!hyroxRest && session?.title) {
      const phase = state.hyrox.phase?.name ?? state.hyrox.phase?.phase;
      const weekPart = week ? `Wk ${week}` : "";
      const phasePart = phase ? `${weekPart} ${phase}`.trim() : weekPart;
      hyroxLabel = phasePart
        ? `${session.title} (${phasePart})`
        : session.title;
    }
  }

  let wodLabel: string | undefined;
  if (prefs.includeCrossfit) {
    const wod = (state.crossfit?.workouts ?? [])[0];
    if (wod?.title) wodLabel = wod.title;
  }

  let recoveryLabel: string | undefined;
  if (prefs.includeRecovery) {
    const items = Array.isArray(state.recovery) ? state.recovery : [];
    if (items.length > 0) {
      const first = items[0];
      recoveryLabel = first?.schedule?.name ?? "Recovery";
    }
  }

  if (prefs.arnoldVoice) {
    const body = arnoldBriefBody({
      hyrox: hyroxLabel,
      hyroxRest: hyroxRest && prefs.includeHyrox,
      crossfit: wodLabel,
      recovery: recoveryLabel,
    });
    return {
      title: arnoldBriefTitle(),
      body: body ? truncate(body) : null,
    };
  }

  const parts: string[] = [];
  if (prefs.includeHyrox) {
    if (hyroxRest) parts.push("Rest day");
    else if (hyroxLabel) parts.push(`HYROX: ${hyroxLabel}`);
  }
  if (wodLabel) parts.push(`WOD: ${wodLabel}`);
  if (recoveryLabel) parts.push(`Mobility: ${recoveryLabel}`);

  if (parts.length === 0) return { title: GENERIC_MORNING_TITLE, body: null };
  return { title: GENERIC_MORNING_TITLE, body: truncate(parts.join(" • ")) };
}

interface NudgeDecision {
  shouldFire: boolean;
  title: string;
  body: string;
}

function buildMiddayNudge(
  state: TodayState | null,
  prefs: TodayNotificationPrefs,
): NudgeDecision {
  const title = prefs.arnoldVoice
    ? arnoldMiddayNudgeTitle()
    : GENERIC_NUDGE_TITLE;
  if (!state) {
    return {
      shouldFire: true,
      title,
      body: prefs.arnoldVoice
        ? arnoldMiddayNudgeBody({ primary: "today's training" })
        : GENERIC_NUDGE_BODY,
    };
  }

  const hyroxRest = !!state.hyrox?.rest;
  const hyroxSessions = (state.hyrox?.sessions ?? []) as any[];
  const wods = (state.crossfit?.workouts ?? []) as any[];
  const recoveryItems = (Array.isArray(state.recovery)
    ? state.recovery
    : []) as any[];

  const unloggedHyrox = prefs.includeHyrox
    ? hyroxSessions.find((s) => !s.log)
    : undefined;
  const unloggedWod = prefs.includeCrossfit
    ? wods.find((w) => !w.loggedByUser)
    : undefined;
  const incompleteRecovery = prefs.includeRecovery
    ? recoveryItems.find((r) => r?.session?.status !== "complete")
    : undefined;

  // Nothing programmed → no nudge.
  if (
    !unloggedHyrox &&
    !unloggedWod &&
    !incompleteRecovery &&
    (hyroxRest || hyroxSessions.length === 0) &&
    wods.length === 0 &&
    recoveryItems.length === 0
  ) {
    return { shouldFire: false, title, body: "" };
  }
  // Everything logged → no nudge.
  if (!unloggedHyrox && !unloggedWod && !incompleteRecovery) {
    return { shouldFire: false, title, body: "" };
  }

  let primary = "today's training";
  if (unloggedHyrox?.title) primary = unloggedHyrox.title;
  else if (unloggedWod?.title) primary = unloggedWod.title;
  else if (incompleteRecovery?.schedule?.name) {
    primary = incompleteRecovery.schedule.name;
  }
  const body = prefs.arnoldVoice
    ? arnoldMiddayNudgeBody({ primary })
    : `You haven't logged ${primary} yet. Open ShredTrack to log it.`;
  return { shouldFire: true, title, body: truncate(body) };
}

interface CrossfitLogPlan {
  shouldFire: boolean;
  title: string;
  body: string;
  hour: number;
  minute: number;
  source: "class-registration" | "preference" | "none";
}

/// Computes the CrossFit log-by-deadline plan. Time source priority:
/// 1) Earliest registered class today (start time + offset hours).
/// 2) User's preference (crossfitClassTimeHour/Minute + offset).
///
/// Only fires when there's at least one unlogged WOD today.
function buildCrossfitLogPlan(
  state: TodayState | null,
  prefs: TodayNotificationPrefs,
): CrossfitLogPlan {
  const fallback: CrossfitLogPlan = {
    shouldFire: false,
    title: prefs.arnoldVoice
      ? arnoldCrossfitLogNudgeTitle()
      : GENERIC_CROSSFIT_LOG_TITLE,
    body: "",
    hour: prefs.crossfitClassTimeHour,
    minute: prefs.crossfitClassTimeMinute,
    source: "none",
  };
  if (!prefs.crossfitLogNudgeEnabled || !prefs.includeCrossfit) return fallback;

  const wods = (state?.crossfit?.workouts ?? []) as WodRow[];
  const unloggedWod = wods.find((w) => !w.loggedByUser);
  if (!unloggedWod) return fallback; // nothing to nudge about

  // 1) Class registration — earliest of today.
  let source: CrossfitLogPlan["source"] = "preference";
  let hour = prefs.crossfitClassTimeHour;
  let minute = prefs.crossfitClassTimeMinute;
  const earliest = (state?.classes?.registrations ?? [])[0];
  if (earliest) {
    const startLocal = new Date(earliest.startAt);
    hour = startLocal.getHours();
    minute = startLocal.getMinutes();
    source = "class-registration";
  }

  // 2) Add the offset, clamped to today (24h wrap).
  const totalMinutes =
    (hour * 60 + minute + prefs.crossfitLogByOffsetHours * 60) % (24 * 60);
  const fireHour = Math.floor(totalMinutes / 60);
  const fireMinute = totalMinutes % 60;

  // 3) Don't fire if it would land in the past today — let the daily
  // repeat catch tomorrow. We can't know "now" at iOS schedule fire
  // time, but at schedule *creation* time, schedule for tomorrow if
  // we're already past it; the `every: "day"` repeat handles ongoing.
  // Capacitor's `on` schedule fires at the next matching local time
  // automatically, so we don't need an explicit guard here.

  const primary = unloggedWod.title ?? "your CrossFit session";
  const body = prefs.arnoldVoice
    ? arnoldCrossfitLogNudgeBody({ primary })
    : truncate(
        `${primary} is still unlogged. Tap to log it before you forget.`,
      );

  return {
    shouldFire: true,
    title: prefs.arnoldVoice
      ? arnoldCrossfitLogNudgeTitle()
      : GENERIC_CROSSFIT_LOG_TITLE,
    body,
    hour: fireHour,
    minute: fireMinute,
    source,
  };
}

async function cancelById(id: number): Promise<void> {
  try {
    await LocalNotifications.cancel({ notifications: [{ id }] });
  } catch {
    // Cancel is idempotent in spirit — swallow.
  }
}

/// Re-schedules notifications based on current preferences and (if
/// available) today's training data. Safe to call from any foreground
/// transition — it cancels then re-schedules, so duplicates can't
/// accumulate.
export async function rescheduleTodayNotifications(): Promise<void> {
  if (!isNativeApp()) return;
  await rescheduleTodayNotificationsRaw();
}

async function rescheduleTodayNotificationsRaw(): Promise<void> {
  const prefs = await getTodayNotificationPrefs();
  const state = await fetchTodayState();
  const toSchedule: ScheduleOptions["notifications"] = [];

  // --- Morning brief
  await cancelById(MORNING_BRIEF_ID);
  if (prefs.morningBriefEnabled) {
    const brief = buildMorningBrief(state, prefs);
    if (brief.body !== null) {
      toSchedule.push({
        id: MORNING_BRIEF_ID,
        title: brief.title,
        body: brief.body,
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
    const decision = buildMiddayNudge(state, prefs);
    if (decision.shouldFire) {
      toSchedule.push({
        id: MIDDAY_NUDGE_ID,
        title: decision.title,
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

  // --- CrossFit log-by-deadline nudge (opt-in)
  await cancelById(CROSSFIT_LOG_NUDGE_ID);
  if (prefs.crossfitLogNudgeEnabled) {
    const plan = buildCrossfitLogPlan(state, prefs);
    if (plan.shouldFire) {
      toSchedule.push({
        id: CROSSFIT_LOG_NUDGE_ID,
        title: plan.title,
        body: plan.body,
        schedule: {
          on: { hour: plan.hour, minute: plan.minute },
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
/// page. Returns whether we got "granted".
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

/// Cancels all three notifications. Used by the settings UI when the
/// user disables everything.
export async function cancelAllTodayNotifications(): Promise<void> {
  if (!isNativeApp()) return;
  await cancelById(MORNING_BRIEF_ID);
  await cancelById(MIDDAY_NUDGE_ID);
  await cancelById(CROSSFIT_LOG_NUDGE_ID);
}

// ============================================================
// Diagnostic snapshot — used by the /settings/native debug panel
// to show the user exactly what the scheduler would do right now,
// without actually scheduling anything.
// ============================================================

export interface NotificationDiagnostic {
  prefs: TodayNotificationPrefs;
  state: TodayState | null;
  morningBrief: {
    enabled: boolean;
    wouldSchedule: boolean;
    title: string;
    body: string | null;
    at: string; // "HH:MM"
  };
  middayNudge: {
    enabled: boolean;
    wouldSchedule: boolean;
    title: string;
    body: string;
    at: string;
  };
  crossfitLogNudge: {
    enabled: boolean;
    wouldSchedule: boolean;
    title: string;
    body: string;
    at: string;
    source: "class-registration" | "preference" | "none";
  };
  wodCount: number;
  unloggedWodCount: number;
  registrationCount: number;
  isNative: boolean;
  fetchedAt: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export async function buildNotificationDiagnostic(): Promise<NotificationDiagnostic> {
  const prefs = await getTodayNotificationPrefs();
  const state = await fetchTodayState();
  const brief = buildMorningBrief(state, prefs);
  const midday = buildMiddayNudge(state, prefs);
  const cfLog = buildCrossfitLogPlan(state, prefs);

  const wods = (state?.crossfit?.workouts ?? []) as WodRow[];
  return {
    prefs,
    state,
    morningBrief: {
      enabled: prefs.morningBriefEnabled,
      wouldSchedule: prefs.morningBriefEnabled && brief.body !== null,
      title: brief.title,
      body: brief.body,
      at: `${pad2(prefs.morningBriefHour)}:${pad2(prefs.morningBriefMinute)}`,
    },
    middayNudge: {
      enabled: prefs.middayNudgeEnabled,
      wouldSchedule: prefs.middayNudgeEnabled && midday.shouldFire,
      title: midday.title,
      body: midday.body,
      at: `${pad2(prefs.middayNudgeHour)}:${pad2(prefs.middayNudgeMinute)}`,
    },
    crossfitLogNudge: {
      enabled: prefs.crossfitLogNudgeEnabled,
      wouldSchedule: prefs.crossfitLogNudgeEnabled && cfLog.shouldFire,
      title: cfLog.title,
      body: cfLog.body,
      at: `${pad2(cfLog.hour)}:${pad2(cfLog.minute)}`,
      source: cfLog.source,
    },
    wodCount: wods.length,
    unloggedWodCount: wods.filter((w) => !w.loggedByUser).length,
    registrationCount: state?.classes?.registrations?.length ?? 0,
    isNative: isNativeApp(),
    fetchedAt: new Date().toISOString(),
  };
}

export { DEFAULT_PREFS };
