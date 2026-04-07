import { Clock, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "History | ShredTrack" };

export default function HistoryPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">History</h1>
          <p className="text-sm text-muted-foreground">
            Your workout log
          </p>
        </div>
        <Button size="icon" variant="outline" className="rounded-full">
          <Filter className="h-4 w-4" />
        </Button>
      </div>

      {/* Empty state */}
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12">
          <div className="rounded-full bg-muted p-4">
            <Clock className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="font-semibold">No Workouts Yet</p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">
              Your completed workouts and scores will show up here. Head to CrossFit to log your first workout.
            </p>
          </div>
          <a href="/crossfit">
            <Button variant="outline" className="mt-2">
              Go to Today
            </Button>
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
