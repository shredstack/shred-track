"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle } from "lucide-react";
import { useWorkoutDeleteImpact } from "@/hooks/useWorkouts";

interface DeleteWorkoutDialogProps {
  workoutId: string | null;
  workoutTitle?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isDeleting?: boolean;
}

export function DeleteWorkoutDialog({
  workoutId,
  workoutTitle,
  open,
  onOpenChange,
  onConfirm,
  isDeleting = false,
}: DeleteWorkoutDialogProps) {
  const { data: impact, isLoading, error } = useWorkoutDeleteImpact(
    open ? workoutId : null
  );

  const otherAthletes = impact?.otherAthletes ?? 0;
  const hasOtherScores = otherAthletes > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {hasOtherScores && (
              <AlertTriangle className="size-4 text-amber-400" />
            )}
            Delete workout?
          </DialogTitle>
          <DialogDescription>
            {workoutTitle ? `"${workoutTitle}"` : "This workout"} will be
            permanently removed.
          </DialogDescription>
        </DialogHeader>

        <div className="text-sm">
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Checking for other scores…
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Couldn&apos;t check for other scores. You can still proceed,
              but any logged scores will be deleted along with the workout.
            </div>
          ) : hasOtherScores ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              <strong className="font-semibold">
                {otherAthletes} other {otherAthletes === 1 ? "athlete has" : "athletes have"}
              </strong>{" "}
              already logged a score for this workout. Deleting the workout
              will permanently wipe their scores too.
            </div>
          ) : (
            <p className="text-muted-foreground">
              No other athletes have logged scores for this workout. Your
              own score (if any) will also be deleted.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isDeleting || isLoading}
          >
            {isDeleting ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Deleting…
              </>
            ) : hasOtherScores ? (
              "Delete anyway"
            ) : (
              "Delete"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
