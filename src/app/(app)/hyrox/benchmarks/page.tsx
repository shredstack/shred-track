import { Timer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function HyroxBenchmarksPage() {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12">
          <div className="rounded-full bg-muted p-4">
            <Timer className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="font-semibold">Station Benchmarks</p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">
              Track your times for each HYROX station — SkiErg, Sled Push, Rowing,
              and more. Benchmark tracking is coming soon.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
