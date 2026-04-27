"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RaceList } from "@/components/hyrox/race-history/race-list";

export default function RaceHistoryListPage() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Saved Races</h1>
          <p className="text-xs text-muted-foreground">
            Every practice race and timed sim you&apos;ve completed.
          </p>
        </div>
        <Link href="/hyrox/race-tools?tab=timer">
          <Button variant="outline" size="sm" className="gap-1 h-8">
            <ArrowLeft className="h-3.5 w-3.5" />
            Race Tools
          </Button>
        </Link>
      </div>

      <RaceList />
    </div>
  );
}
