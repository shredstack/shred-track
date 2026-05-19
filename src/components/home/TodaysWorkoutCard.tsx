import Link from "next/link";
import { ArrowRight, Dumbbell } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export interface TodaysWorkoutCardData {
  workoutId: string;
  title: string | null;
  summary: string | null;
}

export function TodaysWorkoutCard({
  data,
}: {
  data: TodaysWorkoutCardData | null;
}) {
  return (
    <Link href="/crossfit">
      <Card className="hover:bg-muted/30 transition-colors">
        <CardContent className="flex items-center gap-3 py-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15">
            <Dumbbell className="size-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              {data?.title || "Today's WOD"}
            </p>
            <p className="text-xs text-muted-foreground line-clamp-1">
              {data?.summary || "Open the CrossFit tab to see today's programming."}
            </p>
          </div>
          <ArrowRight className="size-4 text-muted-foreground shrink-0" />
        </CardContent>
      </Card>
    </Link>
  );
}
