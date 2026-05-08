"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, Play, Video as VideoIcon } from "lucide-react";
import { fetchVideoPlaybackUrl } from "@/hooks/useRecoveryMovements";
import {
  externalEmbedUrl,
  externalThumbnailUrl,
} from "@/lib/recovery/storage";
import type { RecoveryVideo } from "@/types/recovery";

/**
 * Inline description + video player rendered under a session row when the
 * row is expanded. Stays in-place (no modal) so the movement name above
 * remains visible as the athlete follows along.
 */
export function SessionMovementDetail({
  movementId,
  description,
  videos,
}: {
  movementId: string;
  description: string | null | undefined;
  videos: RecoveryVideo[];
}) {
  const [activeId, setActiveId] = useState<string | null>(videos[0]?.id ?? null);
  // Once the user has tapped a thumbnail to switch videos, treat that as a
  // play intent — subsequent player mounts skip the tap-to-load placeholder.
  const [hasInteracted, setHasInteracted] = useState(false);
  const active = videos.find((v) => v.id === activeId) ?? videos[0] ?? null;

  if (!description && videos.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        No description or videos for this movement yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {description && (
        <p className="text-xs text-muted-foreground whitespace-pre-wrap">
          {description}
        </p>
      )}

      {/* Video breaks out of CardContent's px-4 to span the card edge-to-edge
          so it's actually big enough to follow along on a phone. The Card has
          `overflow-hidden rounded-xl` so the corners stay clean. */}
      {active && (
        <div className="-mx-4">
          <InlinePlayer
            key={active.id}
            movementId={movementId}
            video={active}
            autoStart={hasInteracted}
          />
        </div>
      )}

      {videos.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          {videos.map((v) => {
            const isActive = v.id === active?.id;
            const thumb =
              v.sourceType === "external"
                ? externalThumbnailUrl(v.externalProvider ?? "", v.externalVideoId)
                : null;
            return (
              <button
                key={v.id}
                onClick={() => {
                  setActiveId(v.id);
                  setHasInteracted(true);
                }}
                className={`flex-shrink-0 w-20 rounded-md border overflow-hidden text-left ${
                  isActive ? "border-primary" : "border-border/50"
                }`}
              >
                <div className="aspect-video bg-muted/40 relative">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumb}
                      alt={v.label ?? "video"}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="flex items-center justify-center w-full h-full">
                      <VideoIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <p className="text-[10px] truncate px-1 py-0.5">
                  {v.label ?? (v.sourceType === "external" ? v.externalProvider : "Demo")}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Plays a single video inline. External (YouTube/Vimeo) videos use an
 * embed iframe; uploaded videos hit the playback-URL endpoint to mint a
 * short-lived signed URL and render in a native <video> element.
 *
 * Lazy-mounts on tap. iOS WKWebView limits concurrent native video
 * decoders, so when several rows are expanded we leave each one as a
 * static placeholder until the athlete actually wants to watch — only
 * one decoder gets used at a time.
 *
 * Keyed on `video.id` by the parent so React remounts when the user
 * switches videos — that resets all the local state cleanly without
 * needing to setState inside the effect.
 */
function InlinePlayer({
  movementId,
  video,
  autoStart = false,
}: {
  movementId: string;
  video: RecoveryVideo;
  autoStart?: boolean;
}) {
  const [playRequested, setPlayRequested] = useState(autoStart);
  const [url, setUrl] = useState<string | null>(null);
  const [external, setExternal] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const [extId, setExtId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const retriedRef = useRef(false);

  const loadUrl = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setError(null);
    try {
      const res = await fetchVideoPlaybackUrl(movementId, video.id);
      setExternal(res.external);
      setUrl(res.url);
      if (res.external) {
        setProvider(res.provider ?? null);
        setExtId(res.videoId ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load video");
    } finally {
      inFlightRef.current = false;
    }
  }, [movementId, video.id]);

  useEffect(() => {
    if (autoStart && !url && !error) void loadUrl();
  }, [autoStart, url, error, loadUrl]);

  const handlePlay = () => {
    setPlayRequested(true);
    if (!url) void loadUrl();
  };

  // Native <video> playback failed — most often a stale signed URL. Mint a
  // fresh one and let React swap the src on the next render. Retry only
  // once so a genuinely broken video doesn't loop forever.
  const handleVideoError = () => {
    if (retriedRef.current) {
      setError("Video failed to load. Tap to try again.");
      setPlayRequested(false);
      setUrl(null);
      retriedRef.current = false;
      return;
    }
    retriedRef.current = true;
    setUrl(null);
    void loadUrl();
  };

  if (!playRequested) {
    const thumb =
      video.sourceType === "external"
        ? externalThumbnailUrl(video.externalProvider ?? "", video.externalVideoId)
        : null;
    return (
      <button
        type="button"
        onClick={handlePlay}
        className="relative w-full aspect-video bg-black flex items-center justify-center group"
        aria-label="Play video"
      >
        {thumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt={video.label ?? "video"}
            className="absolute inset-0 w-full h-full object-cover opacity-80"
          />
        )}
        <div className="relative flex items-center justify-center h-12 w-12 rounded-full bg-black/70 group-active:scale-95 transition-transform">
          <Play className="h-5 w-5 text-white fill-white ml-0.5" />
        </div>
        {error && (
          <p className="absolute bottom-2 left-0 right-0 text-center text-[11px] text-rose-300 px-3">
            {error}
          </p>
        )}
      </button>
    );
  }

  if (error) return <p className="text-xs text-destructive px-4 py-3">{error}</p>;
  if (!url) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const baseEmbed =
    external && provider && extId ? externalEmbedUrl(provider, extId) : null;
  const embed = baseEmbed
    ? `${baseEmbed}${baseEmbed.includes("?") ? "&" : "?"}autoplay=1`
    : null;

  if (embed) {
    return (
      <div className="aspect-video bg-black">
        <iframe
          src={embed}
          className="w-full h-full"
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }
  if (external) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center text-xs text-primary px-4"
      >
        <ExternalLink className="h-3.5 w-3.5 mr-1" />
        Open video
      </a>
    );
  }
  return (
    <video
      src={url}
      controls
      autoPlay
      playsInline
      preload="metadata"
      onError={handleVideoError}
      className="w-full bg-black"
    />
  );
}
