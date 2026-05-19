import Link from "next/link";
import { ArrowRight, Target } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export interface MurphPrepCardData {
  trackId: string;
  name: string;
  dayNumber: number | null;
  totalDays: number;
  joined: boolean;
  todayBody?: string | null;
}

export function MurphPrepCard({ data }: { data: MurphPrepCardData | null }) {
  if (!data) return null;
  return (
    <Link href={`/gym/tracks/${data.trackId}`}>
      <Card className="hover:bg-muted/30 transition-colors">
        <CardContent className="flex items-center gap-3 py-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/15">
            <Target className="size-4 text-red-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{data.name}</p>
            <p className="text-xs text-muted-foreground">
              {data.joined && data.dayNumber
                ? `Day ${data.dayNumber} of ${data.totalDays}${
                    data.todayBody ? ` · ${data.todayBody}` : ""
                  }`
                : "Tap to join the prep block."}
            </p>
          </div>
          <ArrowRight className="size-4 text-muted-foreground shrink-0" />
        </CardContent>
      </Card>
    </Link>
  );
}
