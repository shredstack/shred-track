import Link from "next/link";
import { Flame, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export interface CommittedClubWidgetData {
  classesAttended: number;
  threshold: number;
  qualified: boolean;
}

export function CommittedClubWidget({
  data,
}: {
  data: CommittedClubWidgetData | null;
}) {
  if (!data) return null;
  const remaining = Math.max(0, data.threshold - data.classesAttended);
  return (
    <Link href="/gym/committed-club">
      <Card className="hover:bg-muted/30 transition-colors">
        <CardContent className="flex items-center gap-3 py-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500/15">
            <Flame className="size-4 text-orange-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              {data.qualified
                ? `🏆 In the Club · ${data.classesAttended}/${data.threshold}`
                : `Committed Club · ${data.classesAttended}/${data.threshold}`}
            </p>
            <p className="text-xs text-muted-foreground">
              {data.qualified
                ? "You're in for the month."
                : `${remaining} more class${remaining === 1 ? "" : "es"} to qualify.`}
            </p>
          </div>
          <ArrowRight className="size-4 text-muted-foreground shrink-0" />
        </CardContent>
      </Card>
    </Link>
  );
}
