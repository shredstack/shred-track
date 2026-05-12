"use client";

// Notification preferences for the morning brief and midday score
// nudge (spec watch_today_view_and_nudges_spec.md §5.4).
//
// Persisted via @capacitor/preferences so they survive app restarts.
// The Watch reads its own settings out of band (it surfaces these
// values for sanity-check, see spec §6.5) — the phone is the source
// of truth.

import { Preferences } from "@capacitor/preferences";

const KEY = "notifications.today.v1";

export interface TodayNotificationPrefs {
  morningBriefEnabled: boolean;
  morningBriefHour: number;       // 0–23
  morningBriefMinute: number;     // 0–59
  middayNudgeEnabled: boolean;
  middayNudgeHour: number;
  middayNudgeMinute: number;
  includeHyrox: boolean;
  includeCrossfit: boolean;
  includeRecovery: boolean;
}

export const DEFAULT_PREFS: TodayNotificationPrefs = {
  morningBriefEnabled: true,
  morningBriefHour: 6,
  morningBriefMinute: 30,
  middayNudgeEnabled: true,
  middayNudgeHour: 13,
  middayNudgeMinute: 0,
  includeHyrox: true,
  includeCrossfit: true,
  includeRecovery: true,
};

export async function getTodayNotificationPrefs(): Promise<TodayNotificationPrefs> {
  try {
    const { value } = await Preferences.get({ key: KEY });
    if (!value) return DEFAULT_PREFS;
    const parsed = JSON.parse(value);
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function setTodayNotificationPrefs(
  prefs: TodayNotificationPrefs,
): Promise<void> {
  await Preferences.set({ key: KEY, value: JSON.stringify(prefs) });
}
