"use client";

// Athlete-facing "Available tracks" sheet (spec §1.4). Lists every active
// standalone-capable track for the active gym and lets the athlete
// join / leave.

import { toast } from "sonner";
import { Loader2, Users } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  useAvailableTracks,
  useTrackParticipation,
  type AvailableTrack,
} from "@/hooks/useTracks";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  communityId: string;
}

export function AvailableTracksSheet({
  open,
  onOpenChange,
  communityId,
}: Props) {
  const { data, isLoading } = useAvailableTracks(open ? communityId : null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full p-4 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Available tracks</SheetTitle>
          <SheetDescription>
            Opt into extra programming (Murph Prep, strength cycles, etc.).
            Joined tracks render alongside today&apos;s WOD — they never
            replace it.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          {isLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {!isLoading && data && data.tracks.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No active tracks to join right now.
            </p>
          )}
          {data?.tracks.map((t) => (
            <TrackRow
              key={t.id}
              communityId={communityId}
              track={t}
            />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TrackRow({
  communityId,
  track,
}: {
  communityId: string;
  track: AvailableTrack;
}) {
  const part = useTrackParticipation(communityId, track.id);

  async function toggle() {
    try {
      await part.mutateAsync(track.isJoined ? "leave" : "join");
      toast.success(track.isJoined ? "Left track" : "Joined track");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <Card>
      <CardContent className="space-y-2 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-sm font-medium">{track.name}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="text-[10px]">
                {track.kind}
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                {track.startsOn} → {track.endsOn}
              </span>
              {track.memberCount > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Users className="size-3" />
                  {track.memberCount}
                </span>
              )}
            </div>
            {track.description && (
              <p className="text-xs text-muted-foreground line-clamp-2">
                {track.description}
              </p>
            )}
          </div>
          <Button
            size="sm"
            variant={track.isJoined ? "outline" : "default"}
            onClick={toggle}
            disabled={part.isPending}
          >
            {part.isPending
              ? "…"
              : track.isJoined
                ? "Leave"
                : "Join"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
