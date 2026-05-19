// Capacitor PushNotifications registration (spec §1.10).
//
// On native app launch we:
//   1. Request permission (iOS only — Android grants implicitly pre-13).
//   2. Register, which causes APNS to call back with a device token.
//   3. POST that token to /api/me/push-tokens so the server can dispatch.
//   4. Listen for foreground notifications and deep-link taps.
//
// Web no-ops via the isNativeApp() guard.

import { isNativeApp } from "./is-native";

export async function installPushRegistration() {
  if (!isNativeApp()) return;

  // Dynamic imports so the web bundle doesn't try to resolve native plugins.
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const { App } = await import("@capacitor/app");
  const { Capacitor } = await import("@capacitor/core");

  // 1. Permission
  const perm = await PushNotifications.checkPermissions();
  if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
    const req = await PushNotifications.requestPermissions();
    if (req.receive !== "granted") return;
  } else if (perm.receive !== "granted") {
    return;
  }

  // 2. Register — APNS callback comes via 'registration' event
  PushNotifications.addListener("registration", async (token) => {
    const platform = Capacitor.getPlatform();
    try {
      await fetch("/api/me/push-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token.value,
          platform: platform === "ios" ? "ios" : "android",
        }),
      });
    } catch {
      // Best-effort — next launch will retry.
    }
  });

  PushNotifications.addListener("registrationError", () => {
    // Swallow; APNS errors usually come from sandbox/prod cert mismatches
    // that an env update fixes. Logging would just spam Sentry.
  });

  // 3. Deep linking — on tap, the payload's targetUrl drives navigation.
  //    Gym-scoped targets carry ?community=<id> so we can flip the active
  //    gym before navigating; otherwise the destination page (which keys
  //    off activeCommunityId) would render the wrong gym.
  PushNotifications.addListener(
    "pushNotificationActionPerformed",
    async (event) => {
      const targetUrl =
        typeof event.notification.data?.targetUrl === "string"
          ? event.notification.data.targetUrl
          : null;
      if (!targetUrl) return;
      try {
        const community = new URL(
          targetUrl,
          window.location.origin
        ).searchParams.get("community");
        if (community) {
          await fetch("/api/me/active-community", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ communityId: community }),
          });
        }
      } catch {
        // Best-effort — fall through and navigate either way.
      }
      try {
        window.location.href = targetUrl;
      } catch {
        // ignore
      }
    }
  );

  // Foreground notifications: by default iOS shows nothing in-app. The
  // recipient app re-fetches the in-app notifications list via React Query
  // on focus, so we don't need to do anything here.

  await PushNotifications.register();

  // App URL deep links — Capacitor 'appUrlOpen' fires when a universal link
  // routes through the app shell. Surface ShredTrack URLs to the router.
  App.addListener("appUrlOpen", (event) => {
    try {
      const u = new URL(event.url);
      if (u.pathname && u.pathname.startsWith("/")) {
        window.location.href = u.pathname + u.search;
      }
    } catch {
      // not a URL we can route
    }
  });
}
