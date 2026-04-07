import { BarChart3 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function CrossfitInsightsPage() {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12">
          <div className="rounded-full bg-muted p-4">
            <BarChart3 className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="font-semibold">CrossFit Insights</p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">
              Scaling trends, strength progression, and personalized analysis
              of your training. Coming soon.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
