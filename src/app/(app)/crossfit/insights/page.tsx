import { BarChart3 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function CrossfitInsightsPage() {
  return (
    <div className="flex flex-col gap-4">
      <Card className="gradient-border overflow-visible">
        <CardContent className="flex flex-col items-center gap-4 py-14 bg-mesh rounded-xl">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/10">
            <BarChart3 className="h-6 w-6 text-blue-400" />
          </div>
          <div className="text-center">
            <p className="font-bold text-lg">CrossFit Insights</p>
            <p className="mt-2 max-w-xs text-sm text-muted-foreground leading-relaxed">
              Scaling trends, strength progression, and personalized analysis
              of your training. Coming soon.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
