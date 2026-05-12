"use client";

// install-reschedule-on-foreground.ts — runs `rescheduleTodayNotifications`
// whenever the WebView comes to the foreground (spec §5.3, §7.2).
//
// This is the only path that upgrades notification bodies from the
// generic fallback ("Tap to see what's on the schedule.") to specifics
// like "HYROX: Compromised Run + Wall Balls (Wk 7 Build) • WOD: Fran".
// If the user never opens the app, the generic body keeps firing — by
// design.

import { App } from "@capacitor/app";
import { isNativeApp } from "../is-native";
import { rescheduleTodayNotifications } from "./today-notifications";

let installed = false;

export function installRescheduleOnForeground(): void {
  if (installed) return;
  if (!isNativeApp()) return;
  installed = true;

  // Re-schedule on initial bootstrap.
  void rescheduleTodayNotifications();

  // And every time the app becomes active.
  void App.addListener("appStateChange", ({ isActive }) => {
    if (isActive) {
      void rescheduleTodayNotifications();
    }
  });
}
