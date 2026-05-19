"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WorkoutCard } from "@/components/crossfit/workout-card";
import type { WorkoutDisplay } from "@/types/crossfit";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workoutId: string | null;
  dateLabel: string;
}

export function WorkoutPreviewDialog({
  open,
  onOpenChange,
  workoutId,
  dateLabel,
}: Props) {
  const [workout, setWorkout] = useState<WorkoutDisplay | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !workoutId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setWorkout(null);
    fetch(`/api/workouts/${workoutId}`)
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? "Failed to load preview");
        }
        return res.json();
      })
      .then((data: WorkoutDisplay) => {
        if (cancelled) return;
        setWorkout(data);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, workoutId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(96vw,42rem)] max-w-none overflow-x-hidden overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Preview — {dateLabel}</DialogTitle>
          <p className="text-[11px] text-muted-foreground">
            How athletes will see this day.
          </p>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : error ? (
          <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        ) : workout ? (
          <WorkoutCard workout={workout} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
