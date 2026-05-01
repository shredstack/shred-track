"use client";

// Sign in with Apple — native iOS only.
//
// Apple rejects WebView-based "Sign in with Apple" flows; the prompt has
// to come from `ASAuthorizationController` on the device. Capacitor's
// `@capacitor-community/apple-sign-in` plugin wraps that, returns an
// identity token (a JWT), and we hand it to Supabase via
// `signInWithIdToken({ provider: 'apple', ... })`.
//
// On the web, this component renders nothing — Google + email/password
// stay the only web options. On iOS, it renders Apple's button below the
// Google button per Apple's HIG.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { isNativeApp, nativePlatform } from "@/lib/native/is-native";

interface AppleAuthResult {
  response: {
    user?: string;
    email?: string;
    givenName?: string;
    familyName?: string;
    identityToken: string;
    authorizationCode?: string;
  };
}

interface AppleSignInPlugin {
  authorize(opts?: {
    clientId?: string;
    redirectURI?: string;
    scopes?: string;
    state?: string;
    nonce?: string;
  }): Promise<AppleAuthResult>;
}

function getApplePlugin(): AppleSignInPlugin | null {
  if (typeof window === "undefined") return null;
  // @ts-expect-error - Capacitor injects this global at runtime.
  const cap = window.Capacitor;
  return (cap?.Plugins?.SignInWithApple as AppleSignInPlugin | undefined) ?? null;
}

export function SignInWithAppleButton({
  redirectTo = "/crossfit",
  onError,
}: {
  redirectTo?: string;
  onError?: (message: string) => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  // Server and first client render must match. Capacitor's `window`
  // globals only exist post-mount, so we gate the native check on a
  // mounted flag — otherwise SSR ('null') and hydrated client (button)
  // disagree and React tears down the tree.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Hide on web and on Android. Apple sign-in is iOS-only by Apple
  // policy; Android has its own sign-in story (Google) which we already
  // expose via the Google OAuth button.
  if (!mounted || !isNativeApp() || nativePlatform() !== "ios") {
    return null;
  }

  const onClick = async () => {
    const plugin = getApplePlugin();
    if (!plugin) {
      onError?.("Apple sign-in plugin not available. Please rebuild the iOS app.");
      return;
    }
    setLoading(true);
    try {
      const result = await plugin.authorize({
        // The redirectURI / clientId fields are only required on web; on
        // iOS the system uses the app's bundle ID.
        scopes: "email name",
      });

      const idToken = result.response.identityToken;
      if (!idToken) throw new Error("Apple did not return an identity token");

      const supabase = createClient();
      const { error } = await supabase.auth.signInWithIdToken({
        provider: "apple",
        token: idToken,
      });
      if (error) throw error;

      router.push(redirectTo);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Apple sign-in failed";
      onError?.(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="w-full gap-2 h-11 bg-white text-black hover:bg-white/90"
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.49 0-2.534-1.27-3.504-2.61-1.6-2.23-2.83-6.34-1.198-9.13.81-1.39 2.265-2.27 3.83-2.29 1.466-.03 2.85.99 3.736.99.85 0 2.529-1.22 4.357-1.04.726.03 2.846.3 4.21 2.25-.111.07-2.499 1.44-2.471 4.31.038 3.42 3.029 4.55 3.058 4.56z" />
        </svg>
      )}
      Continue with Apple
    </Button>
  );
}
