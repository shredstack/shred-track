"use client";

// Native Google Sign-In initialization.
//
// In the Capacitor iOS shell we cannot use Supabase's redirect-based
// `signInWithOAuth({ provider: 'google' })` flow: it bounces out to
// Safari, completes there, and the WKWebView's session never updates.
//
// Instead we use the native Google Sign-In SDK (via
// @capgo/capacitor-social-login) to obtain an ID token in-process, then
// exchange it for a Supabase session via `signInWithIdToken({ provider:
// 'google', token })`. The session is created directly inside the
// WKWebView, so the user lands on the authenticated app with no browser
// hop.
//
// Required env vars (NEXT_PUBLIC because they're consumed in the browser
// runtime that the WKWebView loads):
//   NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID    — iOS OAuth 2.0 Client ID from
//     Google Cloud Console (audience = the iOS app, used for native
//     auth).
//   NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID    — Web OAuth 2.0 Client ID, the
//     same one Supabase already has configured for its Google provider.
//     Passed as `iOSServerClientId` so the SDK requests an ID token whose
//     `aud` claim matches what Supabase will verify against.

import { isNativeApp, nativePlatform } from "./is-native";

let initialized = false;
let initPromise: Promise<void> | null = null;

async function doInit(): Promise<void> {
  if (initialized) return;
  if (!isNativeApp()) return;

  const iOSClientId = process.env.NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const webClientId = process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID;

  if (nativePlatform() === "ios" && (!iOSClientId || !webClientId)) {
    // Throw a precise message — without these the underlying GoogleSignIn
    // iOS SDK has no GIDClientID and raises NSException at sign-in time,
    // which closes the app. Caught by the button's try/catch and shown to
    // the user.
    const missing = [
      !iOSClientId && "NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID",
      !webClientId && "NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID",
    ]
      .filter(Boolean)
      .join(" and ");
    throw new Error(
      `Google sign-in is not configured for this build: missing ${missing}. ` +
        `Set both vars in the deploy environment (Vercel) and redeploy.`,
    );
  }

  const { SocialLogin } = await import("@capgo/capacitor-social-login");

  await SocialLogin.initialize({
    google: {
      iOSClientId,
      iOSServerClientId: webClientId,
      // Android wiring is intentionally omitted — when we ship Android,
      // add a webClientId here from the Android OAuth client.
    },
  });

  initialized = true;
}

export function installNativeGoogleAuth(): Promise<void> {
  if (!initPromise) {
    initPromise = doInit().catch((err) => {
      // Clear so the next attempt re-runs init instead of replaying the
      // cached rejection (matters if the failure was transient).
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export async function nativeGoogleSignIn(): Promise<{ idToken: string; rawNonce: string }> {
  await installNativeGoogleAuth();

  const { SocialLogin } = await import("@capgo/capacitor-social-login");

  // Supabase's `signInWithIdToken` rejects with "passed nonce and nonce
  // id_token should either both exist or not" whenever the JWT's `nonce`
  // claim and the `nonce` argument don't agree. GIDSignIn (and its
  // restored-session path) can populate that claim on its own, so we
  // always supply our own nonce to keep the two sides in sync:
  //   - hash → Google (becomes the `nonce` claim verbatim)
  //   - raw  → Supabase (server SHA-256s it and compares to the claim)
  const rawNonce = crypto.randomUUID();
  const hashedNonce = await sha256Hex(rawNonce);

  const result = await SocialLogin.login({
    provider: "google",
    options: {
      scopes: ["email", "profile"],
      nonce: hashedNonce,
      // Without this the plugin takes a `restorePreviousSignIn` +
      // `refreshTokensIfNeeded` fast-path whenever GIDSignIn has a cached
      // session, and that path silently ignores `nonce` — the returned ID
      // token then has no `nonce` claim, so Supabase rejects with "passed
      // nonce and nonce id_token should either both exist or not".
      // `forcePrompt: true` forces a fresh `GIDSignIn.signIn` call that
      // respects the nonce we passed.
      forcePrompt: true,
    },
  });

  // Narrow first to Google, then to the online response — `offline`
  // returns a serverAuthCode instead of an idToken and isn't what we
  // want.
  if (result.provider !== "google") {
    throw new Error("Unexpected sign-in provider response");
  }
  if (result.result.responseType !== "online") {
    throw new Error("Google sign-in returned offline response (expected online)");
  }

  const idToken = result.result.idToken;
  if (!idToken) {
    throw new Error("Google did not return an ID token");
  }

  return { idToken, rawNonce };
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
