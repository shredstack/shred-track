"use client";

// Native bearer-token fetch interceptor.
//
// In the Capacitor iOS shell, the app loads from
// `https://shredtrack.shredstack.net` but the WKWebView's cookie store is
// not reliable across launches. So instead of cookie auth, the native
// shell uses a SPA-style supabase-js client and injects
// `Authorization: Bearer <access_token>` on every same-origin `fetch`.
//
// Server-side, `getSessionUser()` accepts the bearer header (see
// src/lib/session.ts), so every existing API route works unchanged. On
// the web (cookie session), the interceptor is a no-op — fetch behaves
// normally.
//
// 401 handling: one refresh attempt via `supabase.auth.refreshSession()`
// then retry. If still 401, sign the user out (the WebView will re-render
// the login screen on the Next.js side).

import { createClient } from "@/lib/supabase/client";
import { isNativeApp } from "./is-native";

let installed = false;

function isSameOrigin(input: RequestInfo | URL): boolean {
  const origin = window.location.origin;
  if (typeof input === "string") {
    return input.startsWith("/") || input.startsWith(origin);
  }
  if (input instanceof URL) {
    return input.origin === origin;
  }
  try {
    return new URL(input.url).origin === origin;
  } catch {
    return false;
  }
}

async function getAccessToken(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function refreshAccessToken(): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.refreshSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}

async function signOut(): Promise<void> {
  const supabase = createClient();
  await supabase.auth.signOut();
}

function withBearer(
  init: RequestInit | undefined,
  token: string,
): RequestInit {
  const headers = new Headers(init?.headers ?? {});
  headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}

/**
 * Install a wrapper around the global `fetch` that:
 *   - injects `Authorization: Bearer <token>` on same-origin requests
 *   - on 401, refreshes the token once and retries
 *   - if still 401, signs the user out
 *
 * Idempotent — safe to call multiple times.
 *
 * No-op when running on the web (cookie session works fine there).
 */
export function installNativeAuthFetch(): void {
  if (installed) return;
  if (typeof window === "undefined") return;
  if (!isNativeApp()) return;

  installed = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    if (!isSameOrigin(input)) {
      return originalFetch(input, init);
    }

    const urlForLog =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    console.log("[auth-fetch] getSession start", urlForLog);
    const tokenStart = Date.now();
    let token: string | null = null;
    try {
      token = await Promise.race([
        getAccessToken(),
        new Promise<null>((resolve) =>
          setTimeout(() => {
            console.warn(
              "[auth-fetch] getSession timed out after 5s — proceeding without bearer",
              urlForLog,
            );
            resolve(null);
          }, 5000),
        ),
      ]);
    } catch (err) {
      console.error("[auth-fetch] getSession threw", err);
    }
    console.log(
      `[auth-fetch] getSession done in ${Date.now() - tokenStart}ms (hasToken=${!!token})`,
      urlForLog,
    );

    if (!token) {
      console.log("[auth-fetch] no token — calling originalFetch unbearered");
      return originalFetch(input, init);
    }

    console.log("[auth-fetch] originalFetch start (bearer attached)", urlForLog);
    const fetchStart = Date.now();
    let response = await originalFetch(input, withBearer(init, token));
    console.log(
      `[auth-fetch] originalFetch done in ${Date.now() - fetchStart}ms status=${response.status}`,
      urlForLog,
    );

    if (response.status === 401) {
      console.log("[auth-fetch] 401 — attempting refresh");
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        response = await originalFetch(input, withBearer(init, refreshed));
        if (response.status === 401) {
          console.log("[auth-fetch] still 401 after refresh — signing out");
          await signOut();
        }
      } else {
        console.log("[auth-fetch] refresh failed — signing out");
        await signOut();
      }
    }

    return response;
  };
}
