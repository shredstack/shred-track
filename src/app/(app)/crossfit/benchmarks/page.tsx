import { Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function BenchmarksPage() {
  return (
    <div className="flex flex-col gap-4">
      <Card className="gradient-border overflow-visible">
        <CardContent className="flex flex-col items-center gap-4 py-14 bg-mesh rounded-xl">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10">
            <Trophy className="h-6 w-6 text-amber-400" />
          </div>
          <div className="text-center">
            <p className="font-bold text-lg">Benchmark WODs</p>
            <p className="mt-2 max-w-xs text-sm text-muted-foreground leading-relaxed">
              Track your times on classic workouts like Fran, Murph, and Grace.
              Benchmark tracking is coming soon.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
