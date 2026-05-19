import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export interface TodaysClassCardData {
  classInstanceId: string;
  name: string;
  startAt: string; // ISO
  coachName?: string | null;
}

export function TodaysClassCard({ data }: { data: TodaysClassCardData | null }) {
  if (!data) return null;
  const t = new Date(data.startAt);
  const timeLabel = t.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <Link href={`/classes#class-${data.classInstanceId}`}>
      <Card className="hover:bg-muted/30 transition-colors">
        <CardContent className="flex items-center gap-3 py-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15">
            <Clock className="size-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{data.name}</p>
            <p className="text-xs text-muted-foreground">
              {timeLabel}
              {data.coachName ? ` · ${data.coachName}` : null}
            </p>
          </div>
          <ArrowRight className="size-4 text-muted-foreground shrink-0" />
        </CardContent>
      </Card>
    </Link>
  );
}
