import Link from "next/link";
import { ArrowRight, Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export interface ChallengeCardData {
  trackId: string;
  name: string;
  dayNumber: number;
  totalDays: number;
  todayBody: string | null;
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
          </div>
          <ArrowRight className="size-4 text-muted-foreground shrink-0" />
        </CardContent>
      </Card>
    </Link>
  );
}
