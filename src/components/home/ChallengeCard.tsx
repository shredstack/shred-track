import Link from "next/link";
import { ArrowRight, Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export interface ChallengeCardData {
  trackId: string;
  name: string;
  dayNumber: number;
  totalDays: number;
  todayBody: string | null;
  /** Cumulative log (Custom Tracks v2 §3.6). Null when the track has no
   *  per-day scoring or the athlete hasn't logged anything yet. */
  rollup?: {
    sum: number;
    unitLabel: string;
    daysLogged: number;
  } | null;
}

export function ChallengeCard({ data }: { data: ChallengeCardData | null }) {
  if (!data) return null;
  return (
    <Link href={`/gym/tracks/${data.trackId}`}>
      <Card className="hover:bg-muted/30 transition-colors">
        <CardContent className="flex items-center gap-3 py-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500/15">
            <Trophy className="size-4 text-orange-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              {data.name} · Day {data.dayNumber} of {data.totalDays}
            </p>
            {data.todayBody ? (
              <p className="text-xs text-muted-foreground line-clamp-1">
                Today: {data.todayBody}
              </p>
            ) : null}
            {data.rollup && data.rollup.sum > 0 ? (
              <p className="text-[11px] text-emerald-300/90">
                Total: {data.rollup.sum} {data.rollup.unitLabel} (
                {data.rollup.daysLogged} day
                {data.rollup.daysLogged === 1 ? "" : "s"})
              </p>
            ) : null}
          </div>
          <ArrowRight className="size-4 text-muted-foreground shrink-0" />
        </CardContent>
      </Card>
    </Link>
  );
}
