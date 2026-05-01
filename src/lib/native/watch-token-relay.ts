"use client";

// Watch token relay.
//
// On every Supabase auth state change in the iOS shell, push the current
// access token + expiry to the paired Apple Watch via WatchConnectivity
// (`WCSession.updateApplicationContext`). Per native-app spec §4.2 step 3
// and §5.4: the phone is the source of truth for the session; the Watch
// holds the most recent token in its Keychain so it can attach it to
// `transferUserInfo` payloads as proof-of-user.
//
// The actual `WCSession.updateApplicationContext` call lives in the
// `WatchBridge` Swift Capacitor plugin we ship in
// `ios/App/App/WatchBridge.swift`. This file is the JS companion that
// listens for auth changes and forwards the token to the plugin.

import { createClient } from "@/lib/supabase/client";
import { isNativeApp } from "./is-native";

let installed = false;

interface WatchBridge {
  setToken(opts: {
    accessToken: string;
    expiresAt: number | null;
    userId: string;
  }): Promise<void>;
  clearToken(): Promise<void>;
}

function getWatchBridge(): WatchBridge | null {
  if (typeof window === "undefined") return null;
  // @ts-expect-error - Capacitor injects this global at runtime.
  const cap = window.Capacitor;
  const plugin = cap?.Plugins?.WatchBridge as WatchBridge | undefined;
  return plugin ?? null;
}

export function installWatchTokenRelay(): void {
  if (installed) return;
  if (!isNativeApp()) return;
  installed = true;

  const supabase = createClient();
  const bridge = getWatchBridge();
  if (!bridge) {
    // The native shell is running but the WatchBridge plugin hasn't been
    // wired up yet. Don't throw — the phone still works fine without the
    // Watch sync; this is just a degraded mode for early TestFlight builds.
    console.warn(
      "[watch-relay] WatchBridge plugin not registered — skipping token sync",
    );
    return;
  }

  // Push the current token immediately so the Watch is up-to-date.
  void supabase.auth.getSession().then(({ data }) => {
    const session = data.session;
    if (session?.access_token && session.user?.id) {
      void bridge.setToken({
        accessToken: session.access_token,
        expiresAt: session.expires_at ?? null,
        userId: session.user.id,
      });
    }
  });

  // Forward future auth changes.
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session) {
      void bridge.clearToken();
      return;
    }
    if (session.access_token && session.user?.id) {
      void bridge.setToken({
        accessToken: session.access_token,
        expiresAt: session.expires_at ?? null,
        userId: session.user.id,
      });
    }
  });
}
