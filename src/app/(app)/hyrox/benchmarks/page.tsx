import { Timer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function HyroxBenchmarksPage() {
  return (
    <div className="flex flex-col gap-4">
      <Card className="gradient-border overflow-visible">
        <CardContent className="flex flex-col items-center gap-4 py-14 bg-mesh rounded-xl">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500/10">
            <Timer className="h-6 w-6 text-orange-400" />
          </div>
          <div className="text-center">
            <p className="font-bold text-lg">Station Benchmarks</p>
            <p className="mt-2 max-w-xs text-sm text-muted-foreground leading-relaxed">
              Track your times for each HYROX station — SkiErg, Sled Push, Rowing,
              and more. Benchmark tracking is coming soon.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
