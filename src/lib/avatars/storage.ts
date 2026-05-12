// Server-side helper for the `avatars` storage bucket. Mirrors the
// recovery-videos pattern (service-role client, signed upload URLs) but
// the bucket is public-read so we hand back the public URL after upload
// for direct use in <img>/<AvatarImage>.

import { createClient } from "@supabase/supabase-js";

export const AVATARS_BUCKET = "avatars";

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

// Avatars are stored under `users/<userId>/<timestamp>.jpg`. The timestamp
// suffix prevents the CDN/browser from serving a stale image after the
// user uploads a new one.
export function buildAvatarPath(userId: string, ext = "jpg"): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").slice(0, 5) || "jpg";
  return `users/${userId}/${Date.now()}.${safeExt}`;
}

// Extracts the storage path from a public URL so we can delete the old
// object after a successful re-upload. Returns null if the URL doesn't
// look like one of ours (e.g. a legacy avatar from Google OAuth).
export function pathFromPublicUrl(publicUrl: string): string | null {
  const marker = `/storage/v1/object/public/${AVATARS_BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  return publicUrl.slice(idx + marker.length);
}

export async function createUploadUrl(path: string) {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.storage
    .from(AVATARS_BUCKET)
    .createSignedUploadUrl(path);
  if (error) throw error;
  return data;
}

export function getPublicUrl(path: string): string {
  const supabase = getServiceRoleClient();
  const { data } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function deleteAvatarObject(path: string) {
  const supabase = getServiceRoleClient();
  await supabase.storage.from(AVATARS_BUCKET).remove([path]);
}
