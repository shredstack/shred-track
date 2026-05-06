// Client-side limits for recovery video uploads. Configurable here so we
// can ratchet them up/down without hunting through component code.

export const VIDEO_UPLOAD_MAX_BYTES = 100 * 1024 * 1024; // 100 MB
export const VIDEO_UPLOAD_MAX_DURATION_SECONDS = 5 * 60; // 5 min
export const VIDEO_UPLOAD_ACCEPT = "video/mp4,video/quicktime";
export const VIDEO_UPLOAD_ALLOWED_MIME = new Set<string>([
  "video/mp4",
  "video/quicktime",
]);

export function videoExtFromMime(mime: string): string {
  if (mime === "video/quicktime") return "mov";
  return "mp4";
}

export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}
