import { TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function HyroxInsightsPage() {
  return (
    <div className="flex flex-col gap-4">
      <Card className="gradient-border overflow-visible">
        <CardContent className="flex flex-col items-center gap-4 py-14 bg-mesh rounded-xl">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10">
            <TrendingUp className="h-6 w-6 text-emerald-400" />
          </div>
          <div className="text-center">
            <p className="font-bold text-lg">HYROX Insights</p>
            <p className="mt-2 max-w-xs text-sm text-muted-foreground leading-relaxed">
              Training adherence, pace analysis, and race time predictions.
              Coming soon.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
