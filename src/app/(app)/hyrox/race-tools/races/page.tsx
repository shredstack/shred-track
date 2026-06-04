"use client";

import { RaceList } from "@/components/hyrox/race-history/race-list";
import { BackButton } from "@/components/shared/back-button";

export default function RaceHistoryListPage() {
  return (
    <div className="flex flex-col gap-4">
      <BackButton
        fallbackHref="/hyrox/race-tools?tab=timer"
        label="Race Tools"
      />
      <div>
        <h1 className="text-xl font-bold tracking-tight">Saved Races</h1>
        <p className="text-xs text-muted-foreground">
          Every practice race and timed sim you&apos;ve completed.
        </p>
      </div>

      <RaceList />
    </div>
  );
}
