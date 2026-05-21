"use client";

// Date-based class calendar shared by the member (`/classes`) and coach
// (`/gym/classes`) views. Pick a date with the same DateNavigator the
// /crossfit tab uses, then see every class/event for that day. The `mode`
// prop swaps the per-card actions: members register, coaches manage.

import { useMemo, useState } from "react";
import { CalendarX2 } from "lucide-react";

import { DateNavigator } from "@/components/shared/date-navigator";
import { Card, CardContent } from "@/components/ui/card";
import { useGymClasses, useGymCoaches } from "@/hooks/useClasses";
import { CoachClassCard, MemberClassCard } from "@/components/gym/class-card";

// Local (not UTC) YYYY-MM-DD — matches DateNavigator's date handling.
function toDateString(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, days: number) {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

interface ClassCalendarProps {
  communityId: string;
  mode: "member" | "coach";
}

export function ClassCalendar({ communityId, mode }: ClassCalendarProps) {
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const dateStr = toDateString(selectedDate);

  // The instances API filters on a UTC date window, but a class belongs to
  // the day it starts in *local* time. Fetch the day plus its neighbours so
  // an evening class near the UTC boundary is never dropped, then narrow to
  // the selected local date below.
  const fromStr = toDateString(addDays(selectedDate, -1));
  const toStr = toDateString(addDays(selectedDate, 1));

  const { data, isLoading } = useGymClasses(communityId, fromStr, toStr);
  // Coaches are only needed for the coach view's per-class coach picker.
  const { data: coachData } = useGymCoaches(
    mode === "coach" ? communityId : null
  );
  const coaches = coachData?.coaches ?? [];

  const instances = useMemo(
    () =>
      (data?.instances ?? []).filter(
        (i) => toDateString(new Date(i.startAt)) === dateStr
      ),
    [data?.instances, dateStr]
  );

  return (
    <div className="space-y-4">
      <DateNavigator selectedDate={selectedDate} onDateChange={setSelectedDate} />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : instances.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <CalendarX2 className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {mode === "coach"
                ? "No classes scheduled for this day."
                : "No classes on this day."}
            </p>
            {mode === "coach" ? (
              <p className="text-xs text-muted-foreground">
                Add or edit recurring classes under Schedules.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {instances.map((inst) =>
            mode === "coach" ? (
              <CoachClassCard
                key={inst.id}
                instance={inst}
                communityId={communityId}
                coaches={coaches}
              />
            ) : (
              <MemberClassCard
                key={inst.id}
                instance={inst}
                communityId={communityId}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}
