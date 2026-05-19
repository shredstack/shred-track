// Server-side helper for the `gym-social` storage bucket (whiteboard photos,
// memes). Mirrors gym-branding/storage.ts: service-role client issues signed
// upload URLs; the bucket is public-read.

import { createClient } from "@supabase/supabase-js";

export const GYM_SOCIAL_BUCKET = "gym-social";

let _client: ReturnType<typeof createClient> | null = null;

function getServiceRoleClient() {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase service role credentials are not configured");
  }
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

export function buildGymSocialPath(
  communityId: string,
  kind: "whiteboard" | "post" | "meme",
  ext = "jpg"
): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").slice(0, 5) || "jpg";
  return `${communityId}/${kind}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.${safeExt}`;
}

export async function createGymSocialUploadUrl(path: string) {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.storage
    .from(GYM_SOCIAL_BUCKET)
    .createSignedUploadUrl(path);
  if (error) throw error;
  return data;
}

export function getGymSocialPublicUrl(path: string): string {
  const supabase = getServiceRoleClient();
  const { data } = supabase.storage
    .from(GYM_SOCIAL_BUCKET)
    .getPublicUrl(path);
  return data.publicUrl;
}
