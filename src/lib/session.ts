import { headers } from "next/headers";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Get the current authenticated user from Supabase.
 *
 * Dual-mode: prefers `Authorization: Bearer <access_token>` (used by the
 * Capacitor iOS app, the Apple Watch via the phone relay, and any other
 * non-browser client) and falls back to the Next.js cookie session
 * (used by the web app) when no bearer token is present.
 *
 * Both modes return the same `{ id, email, name }` shape so every API
 * route picks up bearer support for free without per-route changes.
 *
 * Returns null if unauthenticated.
 */
export async function getSessionUser() {
  const headerList = await headers();
  const authHeader = headerList.get("authorization");

  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token.length > 0) {
      const supabase = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const {
        data: { user },
      } = await supabase.auth.getUser(token);
      if (user) {
        return {
          id: user.id,
          email: user.email!,
          name: user.user_metadata?.name || user.email!.split("@")[0],
        };
      }
      // Bearer token was supplied but invalid — fall through to cookie path
      // so a stale token doesn't lock out a still-authenticated cookie session.
    }
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  return {
    id: user.id,
    email: user.email!,
    name: user.user_metadata?.name || user.email!.split("@")[0],
  };
}
