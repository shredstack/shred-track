import { Dumbbell } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function MovementsPage() {
  return (
    <div className="flex flex-col gap-4">
      <Card className="gradient-border overflow-visible">
        <CardContent className="flex flex-col items-center gap-4 py-14 bg-mesh rounded-xl">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/10">
            <Dumbbell className="h-6 w-6 text-violet-400" />
          </div>
          <div className="text-center">
            <p className="font-bold text-lg">Movement Library</p>
            <p className="mt-2 max-w-xs text-sm text-muted-foreground leading-relaxed">
              Browse movements, track your progression from scaled to Rx, and
              see your weight history. Coming soon.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
