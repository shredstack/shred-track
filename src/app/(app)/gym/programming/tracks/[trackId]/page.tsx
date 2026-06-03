"use client";

// Coach admin — single-track calendar editor (spec §1.3).

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GymToolHeader } from "@/components/gym/gym-tool-header";
import { useGymContext } from "@/hooks/useGymContext";
import {
  useTrack,
  useUpdateTrack,
  useDeleteTrack,
  useSeedFromBuilder,
} from "@/hooks/useTracks";
import { TrackCalendar } from "@/components/gym/programming/track-calendar";
import { ProgressionGeneratorDialog } from "@/components/gym/programming/progression-generator-dialog";
import { TrackScoringConfigEditor } from "@/components/gym/programming/track-scoring-config";
import {
  MonthlyChallengeBuilder,
  type BuilderSubmitPayload,
} from "@/components/gym/programming/monthly-challenge-builder";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsFeatureOn } from "@/hooks/useFeatureFlag";
import type { TrackScoringConfig, TrackKind } from "@/types/programming-tracks";

export default function TrackDetailPage({
  params,
}: {
  params: Promise<{ trackId: string }>;
}) {
  const { trackId } = use(params);
  const router = useRouter();
  const { data: ctx } = useGymContext();
  const communityId = ctx?.activeCommunityId ?? null;

  const { data, isLoading } = useTrack(communityId, trackId);
  const update = useUpdateTrack(communityId ?? "", trackId);
  const deleteMutation = useDeleteTrack(communityId ?? "", trackId);
  const seedFromBuilder = useSeedFromBuilder(communityId ?? "", trackId);

  const [showProgression, setShowProgression] = useState(false);
  const [showBuilderSheet, setShowBuilderSheet] = useState(false);
  const [editingHeader, setEditingHeader] = useState(false);
  const [headerName, setHeaderName] = useState("");
  const [headerStart, setHeaderStart] = useState("");
  const [headerEnd, setHeaderEnd] = useState("");

  const track = data?.track;
  const days = useMemo(() => data?.days ?? [], [data?.days]);

  function openHeaderEdit() {
    if (!track) return;
    setHeaderName(track.name);
    setHeaderStart(track.startsOn);
    setHeaderEnd(track.endsOn);
    setEditingHeader(true);
  }

  async function saveHeader() {
    try {
      await update.mutateAsync({
        name: headerName,
        startsOn: headerStart,
        endsOn: headerEnd,
      });
      toast.success("Track updated");
      setEditingHeader(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  async function archiveOrDelete() {
    if (
      !confirm(
        "Archive this track? If athletes have logged scores, the track will be soft-archived instead of deleted."
      )
    ) {
      return;
    }
    try {
      const res = await deleteMutation.mutateAsync();
      toast.success(res.status === "deleted" ? "Track deleted" : "Track archived");
      router.push("/gym/programming/tracks");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  async function setStatus(status: "draft" | "active" | "archived") {
    try {
      await update.mutateAsync({ status });
      toast.success(`Status: ${status}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  async function setInlinePosition(position: string) {
    try {
      await update.mutateAsync({ inlinePosition: position });
      toast.success("Position saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  async function setDisplayMode(mode: string) {
    try {
      await update.mutateAsync({ displayMode: mode });
      toast.success("Display mode saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  async function saveScoringConfig(config: TrackScoringConfig | null) {
    try {
      await update.mutateAsync({ scoringConfig: config });
      toast.success("Scoring saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  const flagOn = useIsFeatureOn("custom_tracks_v2");

  if (!communityId) {
    return <p className="text-sm">Pick a gym first.</p>;
  }
  if (!flagOn) {
    return (
      <p className="text-sm text-muted-foreground">
        Calendar-based track authoring is disabled for this gym.
      </p>
    );
  }
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!track) {
    return (
      <div className="space-y-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/gym/programming/tracks")}
        >
          <ArrowLeft className="size-3.5" /> Back
        </Button>
        <p className="text-sm text-muted-foreground">Track not found.</p>
      </div>
    );
  }

  const inlinePositionLocked = track.kind === "monthly_challenge";
  const isMonthlyChallenge = track.kind === "monthly_challenge";
  const isFreshlyCreated =
    isMonthlyChallenge && (days?.length ?? 0) === 0;

  async function runBuilderSeed(payload: BuilderSubmitPayload) {
    try {
      const res = await seedFromBuilder.mutateAsync(payload);
      toast.success(
        `Builder wrote ${res.written} day${res.written === 1 ? "" : "s"}`
      );
      setShowBuilderSheet(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  async function openRerunBuilder() {
    const loggedCount = days.filter((d) => d.body?.trim()).length;
    if (loggedCount > 0) {
      const confirmed = confirm(
        `Re-run Builder will overwrite ${loggedCount} day prescription${
          loggedCount === 1 ? "" : "s"
        } with the new pattern. Already-logged scores are kept (they're keyed by day, not body), but the body text will change. Proceed?`
      );
      if (!confirmed) return;
    }
    setShowBuilderSheet(true);
  }

  return (
    <div className="space-y-4">
      <Button
        variant="outline"
        size="sm"
        onClick={() => router.push("/gym/programming/tracks")}
      >
        <ArrowLeft className="size-3.5" /> Back to tracks
      </Button>
      <GymToolHeader
        icon={Sparkles}
        label={track.name}
        description={`${track.kind} · ${track.startsOn} → ${track.endsOn}`}
      />

      <Card>
        <CardContent className="space-y-3 py-3">
          {editingHeader ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Name</Label>
                <Input
                  value={headerName}
                  onChange={(e) => setHeaderName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Starts on</Label>
                  <Input
                    type="date"
                    value={headerStart}
                    onChange={(e) => setHeaderStart(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Ends on</Label>
                  <Input
                    type="date"
                    value={headerEnd}
                    onChange={(e) => setHeaderEnd(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={saveHeader}>
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditingHeader(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">{track.kind}</Badge>
                <Badge variant="outline">{track.status}</Badge>
                <Badge variant="outline">{track.displayMode}</Badge>
                {track.inlinePosition && (
                  <Badge variant="outline">{track.inlinePosition}</Badge>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs">Display mode</Label>
                  <select
                    value={track.displayMode}
                    onChange={(e) => setDisplayMode(e.target.value)}
                    disabled={inlinePositionLocked}
                    className="w-full rounded-md border border-white/10 bg-background px-2 py-1 text-sm disabled:opacity-50"
                  >
                    <option value="inline">inline</option>
                    <option value="standalone">standalone</option>
                    <option value="inline_and_standalone">
                      inline + standalone
                    </option>
                  </select>
                  {inlinePositionLocked && (
                    <p className="text-[10px] text-muted-foreground">
                      Monthly challenges are locked to inline.
                    </p>
                  )}
                </div>

                {(track.displayMode === "inline" ||
                  track.displayMode === "inline_and_standalone") && (
                  <div className="space-y-1">
                    <Label className="text-xs">Inline position</Label>
                    <select
                      value={track.inlinePosition ?? "end_of_day"}
                      onChange={(e) => setInlinePosition(e.target.value)}
                      className="w-full rounded-md border border-white/10 bg-background px-2 py-1 text-sm disabled:opacity-50"
                    >
                      <option value="top">top</option>
                      <option value="after_wod">after_wod</option>
                      <option value="before_stretching">
                        before_stretching
                      </option>
                      <option value="before_at_home">before_at_home</option>
                      <option value="end_of_day">end_of_day</option>
                    </select>
                  </div>
                )}

                <div className="space-y-1">
                  <Label className="text-xs">Status</Label>
                  <select
                    value={track.status}
                    onChange={(e) =>
                      setStatus(e.target.value as "draft" | "active" | "archived")
                    }
                    className="w-full rounded-md border border-white/10 bg-background px-2 py-1 text-sm"
                  >
                    <option value="draft">draft</option>
                    <option value="active">active</option>
                    <option value="archived">archived</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={openHeaderEdit}>
                  Edit name &amp; dates
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={archiveOrDelete}
                  className="text-destructive"
                >
                  <Trash2 className="size-3.5" /> Archive
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {isMonthlyChallenge && isFreshlyCreated && (
        <MonthlyChallengeBuilder
          startsOn={track.startsOn}
          endsOn={track.endsOn}
          initial={
            (track.scoringConfig ?? null) as TrackScoringConfig | null
          }
          defaultLabel={track.name.replace(/challenge/i, "").trim() || "Reps"}
          onSubmit={runBuilderSeed}
          submitting={seedFromBuilder.isPending}
          submitLabel="Seed challenge days"
        />
      )}

      <TrackScoringConfigEditor
        initial={(track.scoringConfig ?? null) as TrackScoringConfig | null}
        onSave={saveScoringConfig}
        saving={update.isPending}
      />

      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold">
          <CalendarIcon className="mr-1 inline size-3.5" /> Calendar
        </h3>
        <div className="flex flex-wrap gap-2">
          {isMonthlyChallenge && (
            <Button size="sm" variant="outline" onClick={openRerunBuilder}>
              <Sparkles className="size-3.5" /> Re-run Builder
            </Button>
          )}
          <Button size="sm" onClick={() => setShowProgression(true)}>
            Generate from progression
          </Button>
        </div>
      </div>

      <TrackCalendar
        communityId={communityId}
        trackId={trackId}
        trackKind={track.kind as TrackKind}
        startsOn={track.startsOn}
        endsOn={track.endsOn}
        days={days}
      />

      <ProgressionGeneratorDialog
        open={showProgression}
        onOpenChange={setShowProgression}
        communityId={communityId}
        trackId={trackId}
        startsOn={track.startsOn}
        endsOn={track.endsOn}
      />

      {isMonthlyChallenge && (
        <Sheet open={showBuilderSheet} onOpenChange={setShowBuilderSheet}>
          <SheetContent side="right" className="w-full p-4 sm:max-w-lg overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Re-run Builder</SheetTitle>
              <SheetDescription>
                Overwrites every day in the window. Already-logged scores
                are kept; day bodies are rewritten from the new pattern.
              </SheetDescription>
            </SheetHeader>
            <div className="pt-4">
              <MonthlyChallengeBuilder
                startsOn={track.startsOn}
                endsOn={track.endsOn}
                initial={
                  (track.scoringConfig ?? null) as TrackScoringConfig | null
                }
                defaultLabel={
                  track.name.replace(/challenge/i, "").trim() || "Reps"
                }
                onSubmit={runBuilderSeed}
                submitting={seedFromBuilder.isPending}
                submitLabel="Re-run Builder"
              />
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
