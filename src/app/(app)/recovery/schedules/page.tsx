"use client";

import Link from "next/link";
import { Plus, Loader2, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRecoverySchedules } from "@/hooks/useRecoverySchedules";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function formatDays(days: number[]): string {
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => DAY_SHORT[d])
    .join(" · ");
}

export default function RecoverySchedulesPage() {
  const { data, isLoading } = useRecoverySchedules();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Schedules</h1>
        <Link href="/recovery/schedules/new">
          <Button size="sm">
            <Plus className="h-3.5 w-3.5 mr-1" />
            New
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : !data || data.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No schedules yet. Build your first one to start logging.
          </CardContent>
        </Card>
      ) : (
        data.map((s) => (
          <Link key={s.id} href={`/recovery/schedules/${s.id}`}>
            <Card className={`hover:bg-muted/30 transition-colors ${s.isActive === false ? "opacity-60" : ""}`}>
              <CardContent className="flex items-center gap-3 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{s.name}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <Badge variant="outline" className="text-[10px]">
                      {s.kind === "day_keyed"
                        ? `Day-keyed (${s.rotationDays}d)`
                        : `${s.weeklyTarget}×/week`}
                    </Badge>
                    {s.communityId && (
                      <Badge variant="secondary" className="text-[10px]">Gym</Badge>
                    )}
                    {s.isActive === false && (
                      <Badge variant="outline" className="text-[10px]">
                        Inactive
                      </Badge>
                    )}
                    {s.activeDaysOfWeek && s.activeDaysOfWeek.length > 0 && s.activeDaysOfWeek.length < 7 && (
                      <Badge variant="outline" className="text-[10px]">
                        {formatDays(s.activeDaysOfWeek)}
                      </Badge>
                    )}
                    {s.intervalDays && s.intervalDays >= 1 && (
                      <Badge variant="outline" className="text-[10px]">
                        Every {s.intervalDays} day{s.intervalDays === 1 ? "" : "s"}
                      </Badge>
                    )}
                    {s.isArchived && (
                      <Badge variant="outline" className="text-[10px]">
                        Archived
                      </Badge>
                    )}
                  </div>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        ))
      )}
    </div>
  );
}
