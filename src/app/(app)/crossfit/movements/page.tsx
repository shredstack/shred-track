import { Dumbbell } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function MovementsPage() {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12">
          <div className="rounded-full bg-muted p-4">
            <Dumbbell className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="font-semibold">Movement Library</p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">
              Browse movements, track your progression from scaled to Rx, and
              see your weight history. Coming soon.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
