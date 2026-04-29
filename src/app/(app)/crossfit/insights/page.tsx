import { BarChart3 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Predicted1RMCard } from "@/components/crossfit/insights/predicted-1rm-card";
import { RxGapCard } from "@/components/crossfit/insights/rx-gap-card";
import { DomainProfileCard } from "@/components/crossfit/insights/domain-profile-card";
import { TrendsCard } from "@/components/crossfit/insights/trends-card";
import { NotesInsightsCard } from "@/components/crossfit/insights/notes-insights-card";

export default function CrossfitInsightsPage() {
  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden border-blue-500/20 bg-gradient-to-br from-blue-500/[0.06] to-transparent">
        <CardContent className="flex items-center gap-3 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
            <BarChart3 className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <p className="font-semibold">CrossFit Insights</p>
            <p className="text-xs text-muted-foreground">
              Personalized analytics on your training.
            </p>
          </div>
        </CardContent>
      </Card>

      <Predicted1RMCard />
      <RxGapCard />
      <DomainProfileCard />
      <TrendsCard />
      <NotesInsightsCard />
    </div>
  );
}
