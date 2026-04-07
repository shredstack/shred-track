"use client";

import { Clock, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

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
      </div>

      {/* Empty state */}
      <Card className="gradient-border overflow-visible">
        <CardContent className="flex flex-col items-center gap-4 py-14 bg-mesh rounded-xl">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <Zap className="h-6 w-6 text-primary/60" />
          </div>
          <div className="text-center">
            <p className="font-bold text-lg">No Workouts Yet</p>
            <p className="mt-2 max-w-xs text-sm text-muted-foreground leading-relaxed">
              Your completed workouts and scores will show up here.
              Head to CrossFit to log your first workout.
            </p>
          </div>
          <a href="/crossfit">
            <Button variant="outline" className="mt-1 border-white/[0.08]">
              Go to Today
            </Button>
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
