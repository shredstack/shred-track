"use client";

// Per-day editor sheet for the track calendar (spec §1.3).
//
// Three tabs:
//   - Free text: writes `programming_track_days.body`.
//   - Smart Builder: creates a workout via POST /…/days/[date]/workout.
//   - CAP paste: parses single-day text via the same parser the CAP
//     paste dialog uses and writes the result as a free-form body
//     (single-day variant — re-use rather than re-implement).

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { SmartBuilder } from "@/components/crossfit/smart-builder";
import { builderPartToPayload } from "@/lib/crossfit/builder-payload";
import { workoutToBuilderForm } from "@/lib/crossfit/workout-to-builder-form";
import { useUpdateWorkout } from "@/hooks/useWorkouts";
import type { WorkoutBuilderForm, WorkoutDisplay } from "@/types/crossfit";
import {
  useTrackDayCreateWorkout,
  useTrackDayUpsert,
  useTrackDayDelete,
  type TrackDayRow,
} from "@/hooks/useTracks";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  communityId: string;
  trackId: string;
  date: string;
  existingDay: TrackDayRow | null;
}

export function TrackDayEditorSheet({
  open,
  onOpenChange,
  communityId,
  trackId,
  date,
  existingDay,
}: Props) {
  const [bodyText, setBodyText] = useState<string>(existingDay?.body ?? "");
  const [isScored, setIsScored] = useState<boolean>(existingDay?.isScored ?? true);
  const [pasteText, setPasteText] = useState("");

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setBodyText(existingDay?.body ?? "");
    setIsScored(existingDay?.isScored ?? true);
    setPasteText("");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [existingDay, date]);

  const upsert = useTrackDayUpsert(communityId, trackId);
  const deleteDay = useTrackDayDelete(communityId, trackId);
  const createWorkout = useTrackDayCreateWorkout(communityId, trackId);
  const updateWorkout = useUpdateWorkout();
  const queryClient = useQueryClient();

  // Linked workout — fetched only when the day has one so the Smart Builder
  // tab can pre-populate from the existing prescription. Without this, the
  // builder always opens empty and Save creates a new session, silently
  // replacing the one already there.
  const linkedWorkoutId = existingDay?.workoutSessionId ?? null;
  const linkedWorkoutQuery = useQuery<WorkoutDisplay>({
    queryKey: ["workouts", "by-id", linkedWorkoutId],
    enabled: open && !!linkedWorkoutId,
    queryFn: async () => {
      const res = await fetch(`/api/workouts/${linkedWorkoutId}`);
      if (!res.ok) throw new Error("Failed to load workout");
      return res.json();
    },
  });

  const builderInitialForm = useMemo<WorkoutBuilderForm | null>(() => {
    if (!linkedWorkoutQuery.data) return null;
    return workoutToBuilderForm(linkedWorkoutQuery.data);
  }, [linkedWorkoutQuery.data]);

  async function saveBody() {
    try {
      await upsert.mutateAsync({
        date,
        input: { body: bodyText.trim() || null, isScored },
      });
      toast.success("Day saved");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  async function clearDay() {
    if (!existingDay) return onOpenChange(false);
    try {
      await deleteDay.mutateAsync(date);
      toast.success("Day cleared");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  async function savePaste() {
    if (!pasteText.trim()) {
      toast.error("Paste some text first");
      return;
    }
    try {
      await upsert.mutateAsync({
        date,
        input: { body: pasteText.trim(), isScored },
      });
      toast.success("Day saved");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  async function saveBuilder(form: WorkoutBuilderForm) {
    const parts = form.parts
      .map(builderPartToPayload)
      .filter((p): p is NonNullable<ReturnType<typeof builderPartToPayload>> => !!p);
    if (parts.length === 0) {
      toast.error("Add at least one part with movements");
      return;
    }
    try {
      if (linkedWorkoutId) {
        await updateWorkout.mutateAsync({
          id: linkedWorkoutId,
          input: {
            title: form.title || undefined,
            description: form.description || undefined,
            workoutDate: form.workoutDate || date,
            requiresVest: !!form.requiresVest,
            vestWeightMaleLb: form.vestWeightMaleLb
              ? parseFloat(form.vestWeightMaleLb)
              : undefined,
            vestWeightFemaleLb: form.vestWeightFemaleLb
              ? parseFloat(form.vestWeightFemaleLb)
              : undefined,
            isPartner: !!form.isPartner,
            partnerCount: form.partnerCount
              ? parseInt(form.partnerCount, 10)
              : undefined,
            parts,
          },
        });
        // useUpdateWorkout only invalidates ["workouts"]; the tracks query
        // caches the day row separately, so nudge it too.
        queryClient.invalidateQueries({
          queryKey: ["gym", communityId, "tracks", trackId],
        });
        queryClient.invalidateQueries({
          queryKey: ["workouts", "by-id", linkedWorkoutId],
        });
        toast.success("Workout updated");
      } else {
        await createWorkout.mutateAsync({
          date,
          title: form.title || undefined,
          parts,
        });
        toast.success("Workout saved");
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  const hasLinkedWorkout =
    !!existingDay?.workoutSessionId || !!existingDay?.workoutId;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto p-4 sm:max-w-2xl"
      >
        <SheetHeader>
          <SheetTitle>Day editor — {date}</SheetTitle>
          <SheetDescription>
            Free text, Smart Builder, or paste CAP-style text. A linked
            workout takes precedence over body text on the athlete view.
          </SheetDescription>
        </SheetHeader>

        {existingDay && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs">
            <span className="text-muted-foreground">
              {hasLinkedWorkout
                ? "This day has a linked workout."
                : "This day has free-text content."}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={clearDay}
              disabled={deleteDay.isPending}
              className="text-destructive"
            >
              {deleteDay.isPending ? "Deleting…" : "Delete day"}
            </Button>
          </div>
        )}

        <Tabs defaultValue={hasLinkedWorkout ? "builder" : "text"} className="mt-4">
          <TabsList className="w-full">
            <TabsTrigger value="text" className="flex-1">
              Free text
            </TabsTrigger>
            <TabsTrigger value="builder" className="flex-1">
              Smart Builder
            </TabsTrigger>
            <TabsTrigger value="paste" className="flex-1">
              Paste
            </TabsTrigger>
          </TabsList>

          <TabsContent value="text" className="space-y-3 pt-3">
            <div className="space-y-1">
              <Label className="text-xs">Prescription</Label>
              <Textarea
                rows={6}
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                placeholder="30 sit-ups"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={isScored}
                  onChange={(e) => setIsScored(e.target.checked)}
                />
                Athletes can log a score for this day
              </label>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={saveBody}
                disabled={upsert.isPending}
              >
                {upsert.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="builder" className="pt-3">
            {linkedWorkoutId && linkedWorkoutQuery.isLoading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
              </div>
            ) : linkedWorkoutId && linkedWorkoutQuery.isError ? (
              <div className="space-y-2 py-6 text-sm">
                <p className="text-destructive">
                  {linkedWorkoutQuery.error instanceof Error
                    ? linkedWorkoutQuery.error.message
                    : "Failed to load workout"}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => linkedWorkoutQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : (
              <SmartBuilder
                onSave={saveBuilder}
                onCancel={() => onOpenChange(false)}
                defaultWorkoutDate={date}
                initialForm={builderInitialForm ?? undefined}
                saveLabel={
                  linkedWorkoutId
                    ? updateWorkout.isPending
                      ? "Saving…"
                      : "Save changes"
                    : createWorkout.isPending
                      ? "Saving…"
                      : "Save workout"
                }
              />
            )}
          </TabsContent>

          <TabsContent value="paste" className="space-y-3 pt-3">
            <div className="space-y-1">
              <Label className="text-xs">Paste raw text for this day</Label>
              <Textarea
                rows={10}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                className="font-mono text-xs"
                placeholder={"WOD\nFor time:\n21-15-9 thrusters / pull-ups"}
              />
            </div>
            <Button
              size="sm"
              onClick={savePaste}
              disabled={upsert.isPending}
            >
              Save as body
            </Button>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
