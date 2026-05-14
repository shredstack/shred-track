"use client";

import { useSyncExternalStore } from "react";
import { isNativeApp } from "@/lib/native/is-native";

// Capacitor's `isNativePlatform()` doesn't change at runtime — there's
// nothing to subscribe to, so the subscribe function returns a no-op.
const subscribe = () => () => {};

// SSR-safe client-only check for whether we're running inside the Capacitor
// native shell. Returns false on the server and on the first client render
// (Capacitor globals are runtime-only), then flips to the real value after
// hydration. Use this anywhere we need to conditionally hide UI on native to
// comply with Apple App Store IAP rules — the personalized HYROX plan is
// a web-only purchase for the initial iOS release.
export function useIsNative(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isNativeApp(),
    () => false,
  );
}
