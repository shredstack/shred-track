import { TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function HyroxInsightsPage() {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12">
          <div className="rounded-full bg-muted p-4">
            <TrendingUp className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="font-semibold">HYROX Insights</p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">
              Training adherence, pace analysis, and race time predictions.
              Coming soon.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
