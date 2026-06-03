"use client";

// ---------------------------------------------------------------------------
// GymAdminDayProgrammer — the inline programming surface on the CrossFit tab.
//
// Mounts the same `ProgrammingDayCard` the week editor uses, but scoped to a
// single date with the publish-status bar + a slim athlete-style chrome strip
// so admins on the CrossFit tab can scope out a day's WOD without leaving the
// athlete-shaped view. Same data, same endpoints, same React Query cache —
// the only thing distinctive about this surface is *which day* is visible at
// a time.
//
// Gated on `canManageGym` at the call site (see `src/app/(app)/crossfit/
// page.tsx`); this component assumes the caller has already cleared that
// check.
// ---------------------------------------------------------------------------

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { QueryError } from "@/components/shared/query-error";
import { ProgrammingDayCard } from "@/components/gym/programming/programming-day-card";
import { DayPublishStatusBar } from "@/components/crossfit/day-publish-status-bar";
import { useGymProgrammingWeek } from "@/hooks/useGymProgrammingWeek";

interface Props {
  communityId: string;
  // Gym name + logo for the small chrome strip above the card. Lifted from
  // the active membership in the parent so we don't refetch.
  communityName: string;
  communityLogoUrl: string | null;
  // Monday-of-week (YYYY-MM-DD) the selected `date` falls in. Drives the
  // week-payload fetch and is forwarded to the day card for shared
  // invalidation.
  weekStart: string;
  // Selected date on the CrossFit tab (YYYY-MM-DD). Only this day's
  // workout + manual-workout banner is rendered — the other six days in
  // the week payload are ignored here; the coach uses the existing date
  // navigator to scroll between them.
  date: string;
}

export function GymAdminDayProgrammer({
  communityId,
  communityName,
  communityLogoUrl,
  weekStart,
  date,
}: Props) {
  const qc = useQueryClient();
  const {
    data,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useGymProgrammingWeek(communityId, weekStart);

  // Edits on this surface also need to refresh the admin's own gym-mode
  // workouts query so the read-only chrome strip and any downstream
  // surfaces (Insights, etc.) pick up the change without a hard reload.
  // The week-editor mount doesn't pass this — it has no athlete-side
  // cache to refresh.
  const onAfterMutate = useCallback(() => {
    qc.invalidateQueries({
      queryKey: ["workouts", "by-date", date, `gym:${communityId}`],
    });
  }, [qc, date, communityId]);

  // The week payload contains all 7 days; filter to the one the user is
  // looking at. Manual workouts are matched by date too so a coach who
  // logged a personal workout in the morning sees the amber banner on
  // the day card.
  const dayWorkout =
    data?.workouts.find(
      (w) => w.workoutDate === date && !!w.programmingReleaseId
    ) ?? null;
  const dayManualWorkouts =
    data?.workouts.filter(
      (w) => w.workoutDate === date && !w.programmingReleaseId
    ) ?? [];

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <QueryError
        onRetry={() => refetch()}
        retrying={isFetching}
        description="Couldn't load programming for this week."
      />
    );
  }

  // Slim header strip: gym name + logo. Mirrors what `ProgrammedWorkoutDay`
  // shows above the section stack for members so the admin's editable card
  // doesn't lose the gym branding when the read-only card is replaced.
  const headerChrome = (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {communityLogoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={communityLogoUrl}
          alt=""
          className="h-4 w-4 rounded object-contain"
        />
      ) : (
        <Building2 className="h-3.5 w-3.5" />
      )}
      <span className="truncate">{communityName}</span>
    </div>
  );

  return (
    <div className="space-y-3">
      <DayPublishStatusBar
        communityId={communityId}
        release={data?.release ?? null}
        onAfterMutate={onAfterMutate}
      />
      <ProgrammingDayCard
        communityId={communityId}
        weekStart={weekStart}
        date={date}
        workout={dayWorkout}
        manualWorkouts={dayManualWorkouts}
        headerChrome={headerChrome}
        onAfterMutate={onAfterMutate}
      />
    </div>
  );
}
