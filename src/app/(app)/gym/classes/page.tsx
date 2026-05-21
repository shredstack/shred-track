"use client";

// Coach/admin classes view (spec §2.2). Date-based calendar — the same
// DateNavigator the /crossfit tab uses — listing every class/event for the
// selected day with per-class manage actions (view roster, cancel, reassign
// coach). Recurring schedule + slot management lives at /gym/classes/schedules.

import Link from "next/link";
import { CalendarDays, Settings } from "lucide-react";

import { useGymContext } from "@/hooks/useGymContext";
import { Button } from "@/components/ui/button";
import { GymToolHeader } from "@/components/gym/gym-tool-header";
import { ClassCalendar } from "@/components/gym/class-calendar";

export default function GymClassesAdminPage() {
  const { data: ctx } = useGymContext();
  const activeId = ctx?.activeCommunityId ?? null;

  if (!activeId) return <p className="text-sm">Pick a gym.</p>;

  return (
    <div className="space-y-4">
      <GymToolHeader
        icon={CalendarDays}
        label="Classes"
        description="Browse the schedule by date — roster, attendance, and per-class actions"
      />
      <div className="flex items-center justify-end">
        <Link href="/gym/classes/schedules">
          <Button size="sm" variant="outline">
            <Settings className="mr-1 size-4" />
            Schedules
          </Button>
        </Link>
      </div>
      <ClassCalendar mode="coach" communityId={activeId} />
    </div>
  );
}
