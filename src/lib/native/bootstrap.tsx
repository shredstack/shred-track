"use client";

// NativeBootstrap mounts the Capacitor-side initialization that the
// WebView shell needs. Safe to render on the web — every step short-circuits
// when isNativeApp() is false.
//
// What it does on iOS (and later Android):
//   1. Installs the bearer-token fetch interceptor so every same-origin
//      `fetch` injects `Authorization: Bearer <token>` (auth-fetch.ts).
//   2. Wires the Apple Watch token relay so the phone pushes the latest
//      Supabase access token to the Watch on every onAuthStateChange
//      (watch-token-relay.ts).
//   3. Reserves a hook for future native bootstrapping (push notifications,
//      app-resume token refresh, deep links).

import { useEffect } from "react";
import { isNativeApp } from "./is-native";
import { installNativeAuthFetch } from "./auth-fetch";
import { installWatchTokenRelay } from "./watch-token-relay";
import { installWatchRaceRelay } from "./watch-race-relay";
import { installWatchRaceSyncListener } from "./watch-race-sync";
import { installWatchOpenItemListener } from "./watch-open-item";
import { installNativeGoogleAuth } from "./google-auth";
import { installRescheduleOnForeground } from "./notifications/install-reschedule-on-foreground";
import { installPushRegistration } from "./push-registration";

export function NativeBootstrap() {
  useEffect(() => {
    if (!isNativeApp()) return;
    installNativeAuthFetch();
    installWatchTokenRelay();
    installWatchRaceRelay();
    installWatchRaceSyncListener();
    installWatchOpenItemListener();
    installRescheduleOnForeground();
    void installNativeGoogleAuth();
    void installPushRegistration();
  }, []);

  return null;
}
