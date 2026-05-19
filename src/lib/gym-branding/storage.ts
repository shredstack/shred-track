// Server-side helper for the `gym-branding` storage bucket. Mirrors the
// avatars storage pattern: service-role client issues signed upload URLs,
// the bucket is public-read for direct <img> embed.

import { createClient } from "@supabase/supabase-js";

export const GYM_BRANDING_BUCKET = "gym-branding";

export type GymAssetKind = "logo" | "hero" | "splash" | "header_bg";

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

// Assets are stored under `<communityId>/<kind>-<timestamp>.<ext>`. The
// timestamp suffix prevents stale CDN serving after an admin re-uploads.
export function buildGymAssetPath(
  communityId: string,
  kind: GymAssetKind,
  ext = "png"
): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").slice(0, 5) || "png";
  return `${communityId}/${kind}-${Date.now()}.${safeExt}`;
}

export async function createGymAssetUploadUrl(path: string) {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.storage
    .from(GYM_BRANDING_BUCKET)
    .createSignedUploadUrl(path);
  if (error) throw error;
  return data;
}

export function getGymAssetPublicUrl(path: string): string {
  const supabase = getServiceRoleClient();
  const { data } = supabase.storage
    .from(GYM_BRANDING_BUCKET)
    .getPublicUrl(path);
  return data.publicUrl;
}

export async function deleteGymAsset(path: string) {
  const supabase = getServiceRoleClient();
  await supabase.storage.from(GYM_BRANDING_BUCKET).remove([path]);
}

export function pathFromPublicUrl(publicUrl: string): string | null {
  const marker = `/storage/v1/object/public/${GYM_BRANDING_BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  return publicUrl.slice(idx + marker.length);
}
