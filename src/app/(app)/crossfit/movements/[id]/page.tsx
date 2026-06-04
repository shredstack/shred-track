"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Dumbbell,
  ExternalLink,
  Loader2,
  Play,
  Plus,
  Trash2,
  Video as VideoIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BackButton } from "@/components/shared/back-button";
import {
  MOVEMENT_CATEGORY_COLORS,
  type CrossfitMovementVideo,
  type CrossfitVideoVisibility,
  type MovementCategory,
} from "@/types/crossfit";
import type { MovementHistoryEntry } from "@/app/api/movements/[id]/history/route";
import {
  useMovementVideos,
  useAddExternalMovementVideo,
  useUploadMovementVideo,
  useDeleteMovementVideo,
  fetchMovementVideoPlaybackUrl,
} from "@/hooks/useMovementVideos";
import {
  externalEmbedUrl,
  externalThumbnailUrl,
  parseExternalVideo,
} from "@/lib/crossfit/video-storage";
import {
  VIDEO_UPLOAD_ACCEPT,
  VIDEO_UPLOAD_ALLOWED_MIME,
  VIDEO_UPLOAD_MAX_BYTES,
  VIDEO_UPLOAD_MAX_DURATION_SECONDS,
  formatBytes,
} from "@/lib/recovery/video-config";
import { useGymContext, useActiveMembership } from "@/hooks/useGymContext";

interface MovementDetail {
  id: string;
  canonicalName: string;
  category: string;
  isWeighted: boolean;
  is1rmApplicable: boolean;
  metricType: string;
  commonRxWeightMale: string | null;
  commonRxWeightFemale: string | null;
  videoUrl: string | null;
}

interface HistoryResponse {
  movement: MovementDetail;
  logs: MovementHistoryEntry[];
}

function useMovementHistory(id: string) {
  return useQuery<HistoryResponse>({
    queryKey: ["movement-history", id],
    queryFn: async () => {
      const res = await fetch(`/api/movements/${id}/history`);
      if (res.status === 404) throw new Error("Not found");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });
}

function formatDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function summarizeLog(log: MovementHistoryEntry, isWeighted: boolean): string {
  if (isWeighted) {
    if (log.actualWeight) return `${log.actualWeight} lb`;
    if (log.setEntries && log.setEntries.length > 0) {
      const repsVary = log.setEntries.some(
        (e, _i, arr) => e.reps != null && e.reps !== arr[0].reps
      );
      return (
        log.setEntries
          .map((e) =>
            repsVary && e.reps != null
              ? `${e.weight}×${e.reps}`
              : `${e.weight}`
          )
          .join(" / ") + " lb"
      );
    }
    return "—";
  }
  if (log.actualReps) return `${log.actualReps} reps`;
  return "—";
}

export default function MovementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, isLoading, isError } = useMovementHistory(id);
  const { data: videos = [] } = useMovementVideos(id);
  const [addOpen, setAddOpen] = useState(false);
  const [playingVideo, setPlayingVideo] = useState<CrossfitMovementVideo | null>(null);
  const [playingLegacyUrl, setPlayingLegacyUrl] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10">
          <p className="text-sm text-muted-foreground">Movement not found.</p>
          <Link
            href="/crossfit/movements"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ArrowLeft className="size-4" />
            Back to movements
          </Link>
        </CardContent>
      </Card>
    );
  }

  const { movement, logs } = data;
  const totalLogs = logs.length;
  const rxLogs = logs.filter((l) => l.wasRx).length;
  const rxPct = totalLogs > 0 ? Math.round((rxLogs / totalLogs) * 100) : null;

  // Show the legacy videoUrl as an inline tile only when no new-table videos
  // exist yet — keeps existing seeded movements playable without forcing a
  // backfill migration.
  const legacy = movement.videoUrl ? parseExternalVideo(movement.videoUrl) : null;
  const legacyThumb = legacy ? externalThumbnailUrl(legacy.provider, legacy.videoId) : null;
  const showLegacy = videos.length === 0 && !!movement.videoUrl;

  return (
    <div className="flex flex-col gap-4">
      <BackButton fallbackHref="/crossfit/movements" label="Movements" />

      <Card className="gradient-border overflow-visible">
        <CardContent className="flex flex-col gap-3 py-5 bg-mesh rounded-xl">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-violet-500/10">
              <Dumbbell className="h-5 w-5 text-violet-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold leading-tight">
                {movement.canonicalName}
              </h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge
                  variant="outline"
                  className={`text-[10px] ${MOVEMENT_CATEGORY_COLORS[movement.category as MovementCategory] || ""}`}
                >
                  {movement.category}
                </Badge>
                {movement.is1rmApplicable && (
                  <Badge variant="outline" className="text-[10px]">
                    1RM
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {(movement.commonRxWeightMale || movement.commonRxWeightFemale) && (
            <p className="text-xs text-muted-foreground">
              Common Rx: {movement.commonRxWeightMale || "—"}/
              {movement.commonRxWeightFemale || "—"} lb (M/F)
            </p>
          )}
        </CardContent>
      </Card>

      {/* Videos */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            Videos ({videos.length + (showLegacy ? 1 : 0)})
          </h2>
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add
          </Button>
        </div>

        {videos.length === 0 && !showLegacy ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No videos yet. Add a YouTube link or upload your own demo.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {showLegacy && (
              <LegacyVideoTile
                videoUrl={movement.videoUrl!}
                thumb={legacyThumb}
                onPlay={() => setPlayingLegacyUrl(movement.videoUrl)}
              />
            )}
            {videos.map((v) => (
              <VideoTile
                key={v.id}
                video={v}
                onPlay={() => setPlayingVideo(v)}
                movementId={movement.id}
              />
            ))}
          </div>
        )}
      </div>

      <AddVideoDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        movementId={movement.id}
      />

      {playingVideo && (
        <PlaybackDialog
          video={playingVideo}
          movementId={movement.id}
          onClose={() => setPlayingVideo(null)}
        />
      )}

      {playingLegacyUrl && (
        <LegacyPlaybackDialog
          url={playingLegacyUrl}
          onClose={() => setPlayingLegacyUrl(null)}
        />
      )}

      <div className="grid grid-cols-3 gap-2">
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-2xl font-bold">{totalLogs}</p>
            <p className="text-[10px] uppercase text-muted-foreground tracking-wider">
              Logs
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-2xl font-bold">
              {rxPct !== null ? `${rxPct}%` : "—"}
            </p>
            <p className="text-[10px] uppercase text-muted-foreground tracking-wider">
              Rx
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-2xl font-bold">
              {logs[0] ? formatDate(logs[0].workoutDate).split(",")[0] : "—"}
            </p>
            <p className="text-[10px] uppercase text-muted-foreground tracking-wider">
              Last
            </p>
          </CardContent>
        </Card>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          History
        </p>
        {totalLogs === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-8">
              <p className="text-sm text-muted-foreground text-center">
                You haven&apos;t logged this movement yet.
              </p>
              <p className="text-xs text-muted-foreground text-center max-w-xs">
                Log a workout that includes {movement.canonicalName} to start
                tracking your progression.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => (
              <Card key={log.detailId}>
                <CardContent className="flex items-center justify-between gap-2 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">
                        {summarizeLog(log, movement.isWeighted)}
                      </span>
                      <Badge
                        variant={log.wasRx ? "secondary" : "outline"}
                        className="text-[10px]"
                      >
                        {log.wasRx ? "Rx" : "Scaled"}
                      </Badge>
                      {log.modification && (
                        <span className="text-[11px] text-muted-foreground">
                          {log.modification}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {formatDate(log.workoutDate)}
                      {log.workoutTitle ? ` · ${log.workoutTitle}` : ""}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function VideoTile(props: {
  video: CrossfitMovementVideo;
  movementId: string;
  onPlay: () => void;
}) {
  const { video, onPlay } = props;
  const remove = useDeleteMovementVideo();
  const isExternal = video.sourceType === "external";
  const thumb = isExternal
    ? externalThumbnailUrl(video.externalProvider ?? "", video.externalVideoId)
    : null;

  return (
    <Card className="overflow-hidden">
      <button
        onClick={onPlay}
        className="relative block w-full aspect-video bg-muted/40"
      >
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt={video.label ?? "video"} className="w-full h-full object-cover" />
        ) : (
          <div className="flex items-center justify-center w-full h-full">
            <VideoIcon className="h-8 w-8 text-muted-foreground" />
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <Play className="h-6 w-6 text-white" />
        </div>
      </button>
      <CardContent className="py-2">
        <div className="flex items-center justify-between gap-1">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium truncate">
              {video.label ?? (isExternal ? video.externalProvider ?? "Link" : "Demo")}
            </p>
            <Badge variant="outline" className="text-[9px] mt-0.5">
              {video.visibility}
            </Badge>
          </div>
          <button
            onClick={() => {
              if (!window.confirm("Delete this video?")) return;
              remove.mutate(
                { movementId: props.movementId, videoId: video.id },
                {
                  onError: (e) => toast.error(e.message),
                }
              );
            }}
            className="text-muted-foreground hover:text-destructive"
            title="Delete"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

function LegacyVideoTile(props: {
  videoUrl: string;
  thumb: string | null;
  onPlay: () => void;
}) {
  return (
    <Card className="overflow-hidden">
      <button
        onClick={props.onPlay}
        className="relative block w-full aspect-video bg-muted/40"
      >
        {props.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={props.thumb} alt="demo" className="w-full h-full object-cover" />
        ) : (
          <div className="flex items-center justify-center w-full h-full">
            <VideoIcon className="h-8 w-8 text-muted-foreground" />
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <Play className="h-6 w-6 text-white" />
        </div>
      </button>
      <CardContent className="py-2">
        <p className="text-xs font-medium truncate">Demo</p>
        <Badge variant="outline" className="text-[9px] mt-0.5">
          legacy
        </Badge>
      </CardContent>
    </Card>
  );
}

function PlaybackDialog({
  video,
  movementId,
  onClose,
}: {
  video: CrossfitMovementVideo;
  movementId: string;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [external, setExternal] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const [extId, setExtId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMovementVideoPlaybackUrl(movementId, video.id)
      .then((res) => {
        if (cancelled) return;
        setExternal(res.external);
        setUrl(res.url);
        if (res.external) {
          setProvider(res.provider ?? null);
          setExtId(res.videoId ?? null);
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [movementId, video.id]);

  const embed = external && provider && extId ? externalEmbedUrl(provider, extId) : null;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{video.label ?? "Video"}</DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !url ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : embed ? (
          <div className="aspect-video">
            <iframe
              src={embed}
              className="w-full h-full"
              allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : external ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center text-sm text-primary"
          >
            <ExternalLink className="h-4 w-4 mr-1" />
            Open video
          </a>
        ) : (
          <video
            src={url}
            controls
            playsInline
            preload="metadata"
            className="w-full rounded-md"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function LegacyPlaybackDialog({ url, onClose }: { url: string; onClose: () => void }) {
  const parsed = parseExternalVideo(url);
  const embed = externalEmbedUrl(parsed.provider, parsed.videoId);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Demo</DialogTitle>
        </DialogHeader>
        {embed ? (
          <div className="aspect-video">
            <iframe
              src={embed}
              className="w-full h-full"
              allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center text-sm text-primary"
          >
            <ExternalLink className="h-4 w-4 mr-1" />
            Open video
          </a>
        )}
      </DialogContent>
    </Dialog>
  );
}

type AddVideoMode = "external" | "upload";

function AddVideoDialog(props: {
  open: boolean;
  onClose: () => void;
  movementId: string;
}) {
  const [mode, setMode] = useState<AddVideoMode>("external");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [visibility, setVisibility] = useState<CrossfitVideoVisibility>("private");
  const [confirmRights, setConfirmRights] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileDuration, setFileDuration] = useState<number | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [confirmingPublic, setConfirmingPublic] = useState(false);
  const activeMembership = useActiveMembership();
  const { data: ctx } = useGymContext();
  const isSuper = !!ctx?.user.isSuperAdmin;
  const isCoachOrAdmin = !!ctx?.memberships.some(
    (m) => m.isActive && (m.isAdmin || m.isCoach)
  );
  const canPublic = isSuper || isCoachOrAdmin;
  const add = useAddExternalMovementVideo();
  const upload = useUploadMovementVideo();
  const submitting = add.isPending || upload.isPending;

  const reset = () => {
    setMode("external");
    setUrl("");
    setLabel("");
    setFile(null);
    setFileDuration(null);
    setFileError(null);
    setConfirmRights(false);
    setConfirmingPublic(false);
    setVisibility("private");
  };

  const onFilePicked = async (next: File | null) => {
    setFileError(null);
    setFileDuration(null);
    setFile(next);
    if (!next) return;
    if (!VIDEO_UPLOAD_ALLOWED_MIME.has(next.type)) {
      setFileError("Only .mp4 or .mov video files are supported");
      setFile(null);
      return;
    }
    if (next.size > VIDEO_UPLOAD_MAX_BYTES) {
      setFileError(`File is ${formatBytes(next.size)} — max ${formatBytes(VIDEO_UPLOAD_MAX_BYTES)}`);
      setFile(null);
      return;
    }
    const duration = await probeVideoDuration(next).catch(() => null);
    if (duration !== null && duration > VIDEO_UPLOAD_MAX_DURATION_SECONDS) {
      setFileError(
        `Video is ${Math.round(duration)}s long — max ${VIDEO_UPLOAD_MAX_DURATION_SECONDS}s (5 min)`
      );
      setFile(null);
      return;
    }
    setFileDuration(duration);
  };

  const validateBase = () => {
    if (!confirmRights) {
      toast.error("Please confirm you have rights to share this content");
      return false;
    }
    if (visibility === "gym" && !activeMembership) {
      toast.error("Switch to a gym to add gym-visibility videos");
      return false;
    }
    return true;
  };

  const beginSubmit = () => {
    if (!validateBase()) return;
    if (mode === "external" && !url.trim()) {
      toast.error("URL required");
      return;
    }
    if (mode === "upload" && !file) {
      toast.error("Pick a video file");
      return;
    }
    if (visibility === "public") {
      setConfirmingPublic(true);
      return;
    }
    void doSubmit();
  };

  const doSubmit = async () => {
    setConfirmingPublic(false);
    try {
      const communityId =
        visibility === "gym" ? activeMembership!.communityId : null;
      if (mode === "external") {
        await add.mutateAsync({
          movementId: props.movementId,
          externalUrl: url.trim(),
          visibility,
          communityId,
          label: label || undefined,
          rightsConfirmed: true,
        });
      } else {
        await upload.mutateAsync({
          movementId: props.movementId,
          file: file!,
          visibility,
          communityId,
          label: label || undefined,
          durationSeconds: fileDuration ?? undefined,
          rightsConfirmed: true,
        });
      }
      toast.success("Video added");
      reset();
      props.onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <>
      <Dialog open={props.open} onOpenChange={(v) => !v && (reset(), props.onClose())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a video</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-1 rounded-lg bg-muted/30 p-1">
              <button
                type="button"
                onClick={() => setMode("external")}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium ${
                  mode === "external"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground"
                }`}
              >
                External link
              </button>
              <button
                type="button"
                onClick={() => setMode("upload")}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium ${
                  mode === "upload"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground"
                }`}
              >
                Upload file
              </button>
            </div>

            {mode === "external" ? (
              <div>
                <Label className="text-xs">YouTube or Vimeo URL</Label>
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://youtube.com/..."
                />
              </div>
            ) : (
              <div>
                <Label className="text-xs">Video file</Label>
                <input
                  type="file"
                  accept={VIDEO_UPLOAD_ACCEPT}
                  onChange={(e) => onFilePicked(e.target.files?.[0] ?? null)}
                  className="block w-full text-xs file:mr-2 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-xs file:hover:bg-accent"
                />
                {file && !fileError && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {file.name} · {formatBytes(file.size)}
                    {fileDuration !== null && ` · ${Math.round(fileDuration)}s`}
                  </p>
                )}
                {fileError && (
                  <p className="text-[10px] text-destructive mt-1">{fileError}</p>
                )}
                <p className="text-[10px] text-muted-foreground mt-1">
                  .mp4 or .mov, up to {formatBytes(VIDEO_UPLOAD_MAX_BYTES)}, max{" "}
                  {VIDEO_UPLOAD_MAX_DURATION_SECONDS / 60} min.
                </p>
              </div>
            )}

            <div>
              <Label className="text-xs">Label (optional)</Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder='e.g. "Coach Dave demo"'
              />
            </div>
            <div>
              <Label className="text-xs">Visibility</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as CrossfitVideoVisibility)}
              >
                <option value="private">Just me — only visible to me</option>
                {activeMembership && (
                  <option value="gym">
                    My gym only ({activeMembership.communityName})
                  </option>
                )}
                {canPublic && (
                  <option value="public">Public — visible to everyone</option>
                )}
              </select>
              {visibility === "public" && (
                <p className="text-[11px] text-amber-500 mt-1">
                  This video will be visible to everyone using ShredTrack, not
                  just your gym.
                </p>
              )}
            </div>
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={confirmRights}
                onChange={(e) => setConfirmRights(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-muted-foreground">
                I have rights to share this content. Avoid copyrighted music and
                don&apos;t show minors who haven&apos;t consented.
              </span>
            </label>
            <Button
              onClick={beginSubmit}
              disabled={submitting}
              className="w-full"
            >
              {submitting && (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              )}
              {mode === "upload" && submitting ? "Uploading…" : "Add"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmingPublic}
        onOpenChange={(v) => !v && setConfirmingPublic(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share publicly?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This video will be visible to everyone using ShredTrack, not just{" "}
            {activeMembership?.communityName ?? "your gym"}.
          </p>
          <div className="flex gap-2 mt-2">
            <Button
              variant="outline"
              onClick={() => setConfirmingPublic(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button onClick={doSubmit} className="flex-1" disabled={submitting}>
              {submitting && (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              )}
              Publish publicly
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

async function probeVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      const d = video.duration;
      resolve(Number.isFinite(d) ? d : null);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read video metadata"));
    };
    video.src = url;
  });
}
