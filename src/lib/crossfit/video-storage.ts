// Server-side helper for the crossfit-videos storage bucket. Mirrors the
// recovery storage helper — all access goes through the service-role
// client so the bucket can stay locked down and playback URLs are signed
// per request.

import { createClient } from "@supabase/supabase-js";

export const CROSSFIT_BUCKET = "crossfit-videos";
export const SIGNED_URL_TTL_SECONDS = 60 * 30;

let _client: ReturnType<typeof createClient> | null = null;

export function getServiceRoleClient() {
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

export function buildStoragePath(opts: {
  visibility: "public" | "gym" | "private";
  communityId: string | null;
  uploadedBy: string;
  movementId: string;
  videoId: string;
  ext: string;
}): string {
  const safeExt = opts.ext.replace(/[^a-z0-9]/gi, "").slice(0, 5) || "mp4";
  if (opts.visibility === "public") {
    return opts.communityId
      ? `public/community/${opts.communityId}/${opts.movementId}/${opts.videoId}.${safeExt}`
      : `public/canonical/${opts.movementId}/${opts.videoId}.${safeExt}`;
  }
  if (opts.visibility === "private") {
    return `private/${opts.uploadedBy}/${opts.movementId}/${opts.videoId}.${safeExt}`;
  }
  return `gym/${opts.communityId}/${opts.movementId}/${opts.videoId}.${safeExt}`;
}

export async function createUploadUrl(path: string) {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.storage
    .from(CROSSFIT_BUCKET)
    .createSignedUploadUrl(path);
  if (error) throw error;
  return data;
}

export async function createPlaybackUrl(path: string) {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.storage
    .from(CROSSFIT_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteStorageObject(path: string) {
  const supabase = getServiceRoleClient();
  await supabase.storage.from(CROSSFIT_BUCKET).remove([path]);
}

// External URL parsing — provider + id so we can build embed URLs and
// deterministic thumbnails without a metadata fetch.
export function parseExternalVideo(url: string): {
  provider: "youtube" | "vimeo" | "other";
  videoId: string | null;
} {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = u.searchParams.get("v");
      if (v) return { provider: "youtube", videoId: v };
      const m = u.pathname.match(/^\/embed\/([\w-]+)/);
      if (m) return { provider: "youtube", videoId: m[1] };
      const s = u.pathname.match(/^\/shorts\/([\w-]+)/);
      if (s) return { provider: "youtube", videoId: s[1] };
    }
    if (host === "youtu.be") {
      const m = u.pathname.match(/^\/([\w-]+)/);
      if (m) return { provider: "youtube", videoId: m[1] };
    }
    if (host === "vimeo.com" || host === "player.vimeo.com") {
      const m = u.pathname.match(/(\d+)$/);
      if (m) return { provider: "vimeo", videoId: m[1] };
    }
  } catch {
    // fall through
  }
  return { provider: "other", videoId: null };
}

export function externalThumbnailUrl(provider: string, videoId: string | null) {
  if (!videoId) return null;
  if (provider === "youtube") {
    return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  }
  return null;
}

export function externalEmbedUrl(provider: string, videoId: string | null) {
  if (!videoId) return null;
  if (provider === "youtube") {
    return `https://www.youtube.com/embed/${videoId}?playsinline=1&rel=0`;
  }
  if (provider === "vimeo") {
    return `https://player.vimeo.com/video/${videoId}?playsinline=1`;
  }
  return null;
}
