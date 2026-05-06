"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  Plus,
  Play,
  Trash2,
  ExternalLink,
  Video as VideoIcon,
  CheckCircle2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useRecoveryMovement,
  useAddExternalVideo,
  useDeleteRecoveryVideo,
  useValidateRecoveryMovement,
  fetchVideoPlaybackUrl,
} from "@/hooks/useRecoveryMovements";
import { useGymContext, useActiveMembership } from "@/hooks/useGymContext";
import { formatPrescription, type RecoveryVideo, type RecoveryVisibility } from "@/types/recovery";
import {
  externalEmbedUrl,
  externalThumbnailUrl,
} from "@/lib/recovery/storage";

export default function RecoveryMovementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, isLoading } = useRecoveryMovement(id);
  const { data: ctx } = useGymContext();
  const activeMembership = useActiveMembership();
  const [addOpen, setAddOpen] = useState(false);
  const [playingVideo, setPlayingVideo] = useState<RecoveryVideo | null>(null);
  const validate = useValidateRecoveryMovement();

  const isCoachOrAdmin = !!ctx?.memberships.some(
    (m) => m.isActive && (m.isAdmin || m.isCoach)
  );
  const isSuper = !!ctx?.user.isSuperAdmin;

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <p className="text-sm text-muted-foreground">Not found</p>
          <Link
            href="/recovery/movements"
            className="text-xs underline mt-3 inline-block"
          >
            Back to library
          </Link>
        </CardContent>
      </Card>
    );
  }

  const description = data.notesOverride ?? data.description;
  const videos = data.videos ?? [];

  // Order videos: caller's gym → super-admin canonical → other.
  const myGymId = activeMembership?.communityId ?? null;
  const sortedVideos = [...videos].sort((a, b) => {
    const aTier = videoTier(a, myGymId);
    const bTier = videoTier(b, myGymId);
    if (aTier !== bTier) return aTier - bTier;
    return a.orderIndex - b.orderIndex;
  });

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/recovery/movements"
        className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5 mr-1" />
        Library
      </Link>

      <div>
        <h1 className="text-xl font-bold">{data.canonicalName}</h1>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <Badge variant="outline" className="text-[10px]">{data.category}</Badge>
          {!data.isValidated && (
            <Badge variant="secondary" className="text-[10px]">Pending</Badge>
          )}
          {data.bodyRegion?.map((r) => (
            <span key={r} className="text-[10px] text-muted-foreground">
              #{r.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      </div>

      {!data.isValidated && (isCoachOrAdmin || isSuper) && (
        <Button
          variant="default"
          size="sm"
          onClick={() => {
            validate.mutate(data.id, {
              onSuccess: () => toast.success("Validated"),
              onError: (e) => toast.error(e.message),
            });
          }}
        >
          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
          Validate
        </Button>
      )}

      {description && (
        <Card>
          <CardContent className="py-3">
            <p className="text-sm whitespace-pre-wrap">{description}</p>
            {data.notesOverride && (
              <p className="text-[10px] text-muted-foreground mt-2">
                {activeMembership?.communityName ?? "Gym"}-specific note
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Default prescription chips */}
      {(data.defaultPrescription && Object.keys(data.defaultPrescription).length > 0) && (
        <Card>
          <CardContent className="py-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
              Default prescription
            </p>
            <p className="text-sm font-medium">
              {formatPrescription(data.defaultPrescription, data.isPerSide) || "—"}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Videos */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Videos ({sortedVideos.length})</h2>
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add
          </Button>
        </div>
        {sortedVideos.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No videos yet. Add a YouTube link or upload your own demo.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {sortedVideos.map((v) => (
              <VideoTile
                key={v.id}
                video={v}
                myGymId={myGymId}
                onPlay={() => setPlayingVideo(v)}
                movementId={data.id}
              />
            ))}
          </div>
        )}
      </div>

      <AddVideoDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        movementId={data.id}
      />

      {playingVideo && (
        <PlaybackDialog
          video={playingVideo}
          movementId={data.id}
          onClose={() => setPlayingVideo(null)}
        />
      )}
    </div>
  );
}

function videoTier(v: RecoveryVideo, myGymId: string | null): number {
  if (v.visibility === "gym" && myGymId && v.communityId === myGymId) return 0;
  if (v.visibility === "public") return 1;
  if (v.visibility === "gym") return 2;
  return 3;
}

function VideoTile(props: {
  video: RecoveryVideo;
  myGymId: string | null;
  movementId: string;
  onPlay: () => void;
}) {
  const { video, onPlay } = props;
  const remove = useDeleteRecoveryVideo();
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
              {video.label ?? (isExternal ? video.externalProvider : "Demo")}
            </p>
            <Badge variant="outline" className="text-[9px] mt-0.5">
              {video.visibility}
            </Badge>
          </div>
          <button
            onClick={() =>
              remove.mutate({ movementId: props.movementId, videoId: video.id })
            }
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

function PlaybackDialog({
  video,
  movementId,
  onClose,
}: {
  video: RecoveryVideo;
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

function AddVideoDialog(props: {
  open: boolean;
  onClose: () => void;
  movementId: string;
}) {
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [visibility, setVisibility] = useState<RecoveryVisibility>("gym");
  const [confirmRights, setConfirmRights] = useState(false);
  const activeMembership = useActiveMembership();
  const { data: ctx } = useGymContext();
  const isSuper = !!ctx?.user.isSuperAdmin;
  const isCoachOrAdmin = !!ctx?.memberships.some(
    (m) => m.isActive && (m.isAdmin || m.isCoach)
  );
  const canPublic = isSuper || isCoachOrAdmin;
  const add = useAddExternalVideo();

  const submit = async () => {
    if (!url.trim()) {
      toast.error("URL required");
      return;
    }
    if (!confirmRights) {
      toast.error("Please confirm you have rights to share this content");
      return;
    }
    if (visibility === "gym" && !activeMembership) {
      toast.error("Switch to a gym to add gym-visibility videos");
      return;
    }

    try {
      await add.mutateAsync({
        movementId: props.movementId,
        externalUrl: url.trim(),
        visibility,
        communityId: visibility === "gym" ? activeMembership!.communityId : null,
        label: label || undefined,
        rightsConfirmed: true,
      });
      toast.success("Video added");
      setUrl("");
      setLabel("");
      setConfirmRights(false);
      props.onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={(v) => !v && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a video</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">YouTube or Vimeo URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtube.com/..." />
            <p className="text-[10px] text-muted-foreground mt-1">
              File uploads are coming soon — for now paste an external link.
            </p>
          </div>
          <div>
            <Label className="text-xs">Label (optional)</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder='e.g. "Front view"' />
          </div>
          <div>
            <Label className="text-xs">Visibility</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as RecoveryVisibility)}
            >
              <option value="gym">My gym only{activeMembership ? ` (${activeMembership.communityName})` : ""}</option>
              {canPublic && <option value="public">Public — visible to everyone</option>}
            </select>
            {visibility === "public" && (
              <p className="text-[11px] text-amber-500 mt-1">
                This video will be visible to everyone using ShredTrack, not just your gym.
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
              I have rights to share this content. Avoid copyrighted music and don&apos;t
              show minors who haven&apos;t consented.
            </span>
          </label>
          <Button onClick={submit} disabled={add.isPending} className="w-full">
            {add.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            Add
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
