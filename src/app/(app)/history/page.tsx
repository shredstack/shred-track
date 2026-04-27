"use client";

import Link from "next/link";
import { Trophy, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RaceList } from "@/components/hyrox/race-history/race-list";
import { usePracticeRaces } from "@/hooks/usePracticeRaces";

export default function HistoryPage() {
  const { data: races } = usePracticeRaces();
  const hasRaces = (races?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">History</h1>
          <p className="text-sm text-muted-foreground">Your workout log</p>
        </div>
      </div>

      {hasRaces && (
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Trophy className="h-3.5 w-3.5 text-primary" />
              HYROX Practice Races
            </CardTitle>
            {(races?.length ?? 0) > 5 && (
              <Link
                href="/hyrox/race-tools/races"
                className="text-[11px] text-primary hover:underline"
              >
                View all
              </Link>
            )}
          </CardHeader>
          <CardContent>
            <RaceList limit={5} initialRaces={races} />
          </CardContent>
        </Card>
      )}

      {/* CrossFit empty state — to be replaced when CF logging history lands here */}
      {!hasRaces && (
        <Card className="gradient-border overflow-visible">
          <CardContent className="flex flex-col items-center gap-4 py-14 bg-mesh rounded-xl">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <Zap className="h-6 w-6 text-primary/60" />
            </div>
            <div className="text-center">
              <p className="font-bold text-lg">No Workouts Yet</p>
              <p className="mt-2 max-w-xs text-sm text-muted-foreground leading-relaxed">
                Your completed workouts and scores will show up here. Head to
                CrossFit to log your first workout, or run a HYROX practice
                race to start your history.
              </p>
            </div>
            <a href="/crossfit">
              <Button variant="outline" className="mt-1 border-white/[0.08]">
                Go to Today
              </Button>
            </a>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
