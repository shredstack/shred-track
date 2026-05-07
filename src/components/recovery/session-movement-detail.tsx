"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Video as VideoIcon } from "lucide-react";
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
          <InlinePlayer key={active.id} movementId={movementId} video={active} />
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
                onClick={() => setActiveId(v.id)}
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
 * Keyed on `video.id` by the parent so React remounts when the user
 * switches videos — that resets all the local state cleanly without
 * needing to setState inside the effect.
 */
function InlinePlayer({
  movementId,
  video,
}: {
  movementId: string;
  video: RecoveryVideo;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [external, setExternal] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const [extId, setExtId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchVideoPlaybackUrl(movementId, video.id)
      .then((res) => {
        if (cancelled) return;
        setExternal(res.external);
        setUrl(res.url);
        if (res.external) {
          setProvider(res.provider ?? null);
          setExtId(res.videoId ?? null);
        }
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [movementId, video.id]);

  const embed = external && provider && extId ? externalEmbedUrl(provider, extId) : null;

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!url) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
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
      key={video.id}
      src={url}
      controls
      playsInline
      preload="metadata"
      className="w-full bg-black"
    />
  );
}
