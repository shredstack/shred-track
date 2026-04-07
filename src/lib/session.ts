import { createClient } from "@/lib/supabase/server";

/**
 * Get the current authenticated user from Supabase.
 * Returns { id, email, name } or null if unauthenticated.
 */
export async function getSessionUser() {
  const supabase = await createClient();
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
