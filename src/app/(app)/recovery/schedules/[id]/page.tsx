"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Pencil, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRecoverySchedule, useDeleteRecoverySchedule } from "@/hooks/useRecoverySchedules";
import { useGymContext } from "@/hooks/useGymContext";
import { formatPrescription } from "@/types/recovery";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function formatDays(days: number[]): string {
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => DAY_SHORT[d])
    .join(" · ");
}

export default function ScheduleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, isLoading } = useRecoverySchedule(id);
  const remove = useDeleteRecoverySchedule();
  const { data: ctx } = useGymContext();
  const router = useRouter();

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!data) return null;

  const isOwner = ctx?.user.id === data.createdBy;
  const isGymCoach = !!(
    data.communityId &&
    ctx?.memberships.some(
      (m) =>
        m.communityId === data.communityId &&
        m.isActive &&
        (m.isAdmin || m.isCoach)
    )
  );
  const canEdit = !!ctx?.user.isSuperAdmin || isOwner || isGymCoach;

  const slotsByDay = new Map<string, typeof data.slots>();
  (data.slots ?? []).forEach((s) => {
    const key = s.dayIndex == null ? "all" : `Day ${s.dayIndex}`;
    const arr = slotsByDay.get(key) ?? [];
    arr.push(s);
    slotsByDay.set(key, arr);
  });

  const onDelete = async () => {
    if (!confirm("Delete this schedule? This cannot be undone.")) return;
    try {
      await remove.mutateAsync(id);
      toast.success("Schedule deleted");
      router.push("/recovery/schedules");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/recovery/schedules"
        className="inline-flex items-center text-xs text-muted-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5 mr-1" />
        Back
      </Link>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{data.name}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant="outline" className="text-[10px]">
              {data.kind === "day_keyed"
                ? `Day-keyed (${data.rotationDays}d)`
                : `${data.weeklyTarget}× per week`}
            </Badge>
            {data.communityId && <Badge variant="secondary" className="text-[10px]">Gym</Badge>}
            {data.isActive === false && (
              <Badge variant="outline" className="text-[10px]">Inactive</Badge>
            )}
            {data.activeDaysOfWeek && data.activeDaysOfWeek.length > 0 && data.activeDaysOfWeek.length < 7 && (
              <Badge variant="outline" className="text-[10px]">
                {formatDays(data.activeDaysOfWeek)}
              </Badge>
            )}
          </div>
          {data.description && (
            <p className="text-sm text-muted-foreground mt-2">{data.description}</p>
          )}
        </div>
        {canEdit && (
          <Link href={`/recovery/schedules/${id}/edit`}>
            <Button size="sm" variant="outline">
              <Pencil className="h-3.5 w-3.5 mr-1" />
              Edit
            </Button>
          </Link>
        )}
      </div>

      {data.communityId && (
        <Link href={`/recovery/schedules/${id}/assign`}>
          <Button variant="outline" size="sm" className="w-full">
            <Users className="h-3.5 w-3.5 mr-1" />
            Assignments
          </Button>
        </Link>
      )}

      {[...slotsByDay.entries()].map(([dayLabel, slots]) => (
        <div key={dayLabel} className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {dayLabel}
          </h2>
          {(slots ?? []).map((s) => (
            <Card key={s.id}>
              <CardContent className="py-3">
                <p className="text-sm font-medium">
                  {s.movementName ?? s.routineName}
                  {s.routineName && (
                    <Badge variant="secondary" className="text-[9px] ml-2">Routine</Badge>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatPrescription(s.prescription, !!s.isPerSide) || "—"}
                </p>
                {s.notes && (
                  <p className="text-[11px] italic text-muted-foreground mt-1">{s.notes}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ))}

      <Button variant="outline" size="sm" onClick={onDelete}>
        Delete schedule
      </Button>
    </div>
  );
}
