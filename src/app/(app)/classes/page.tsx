"use client";

// Member-facing class schedule (spec §2.2). Date-based calendar — pick a day
// and register for the classes running that day, the same way the /crossfit
// tab works. Sparse one-off events stay pinned in a banner above the
// calendar so they aren't missed. When the `classes` flag is off or the user
// has no active gym, the page shows an explanatory empty state.

import { useUpcomingEvents } from "@/hooks/useClasses";
import { useGymContext } from "@/hooks/useGymContext";
import { useFeatureFlagsLoading, useIsFeatureOn } from "@/hooks/useFeatureFlag";
import { ClassCalendar } from "@/components/gym/class-calendar";
import { MemberClassCard } from "@/components/gym/class-card";

export default function ClassesPage() {
  const { data: ctx } = useGymContext();
  const classesOn = useIsFeatureOn("classes");
  const flagsLoading = useFeatureFlagsLoading();
  const activeId = ctx?.activeCommunityId ?? null;

  const { data: eventData } = useUpcomingEvents(activeId);
  const upcomingEvents = (eventData?.instances ?? []).filter(
    (e) => e.status !== "cancelled"
  );

  if (!activeId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Classes</h1>
        <p className="text-sm text-muted-foreground">
          Join a gym to see its class schedule.
        </p>
      </div>
    );
  }
  if (flagsLoading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Classes</h1>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }
  if (!classesOn) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Classes</h1>
        <p className="text-sm text-muted-foreground">
          Class scheduling isn&apos;t turned on for this gym yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Classes</h1>

      {upcomingEvents.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
            Upcoming events
          </h2>
          {upcomingEvents.map((evt) => (
            <MemberClassCard
              key={evt.id}
              instance={evt}
              communityId={activeId}
              showDate
            />
          ))}
        </section>
      ) : null}

      <ClassCalendar mode="member" communityId={activeId} />
    </div>
  );
}
