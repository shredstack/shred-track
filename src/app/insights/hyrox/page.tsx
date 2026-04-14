"use client";

import { useState, useCallback } from "react";
import type { DivisionKey } from "@/lib/hyrox-data";
import {
  InsightsFilterBar,
  PaceProfileCard,
  DistributionsCard,
  ComparisonsCard,
  FeatureImportanceCard,
} from "@/components/insights/hyrox";

export default function PublicHyroxInsightsPage() {
  const [division, setDivision] = useState<DivisionKey>("men_open");
  const [eventId, setEventId] = useState<string | undefined>(undefined);

  const handleDivisionChange = useCallback((d: DivisionKey) => setDivision(d), []);
  const handleEventChange = useCallback((id: string | undefined) => setEventId(id), []);

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center mb-2">
        <h1 className="text-xl font-bold">HYROX Field Insights</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Real race data from thousands of HYROX finishers
        </p>
      </div>

      <InsightsFilterBar
        division={division}
        onDivisionChange={handleDivisionChange}
        eventId={eventId}
        onEventChange={handleEventChange}
      />

      <PaceProfileCard division={division} eventId={eventId} />

      <DistributionsCard division={division} eventId={eventId} />

      {/* CTA banner */}
      <div className="rounded-xl bg-primary/10 border border-primary/20 p-4 text-center">
        <p className="text-sm font-medium">Want to see how you stack up?</p>
        <p className="text-xs text-muted-foreground mt-1">
          Sign up to overlay your own times and get a personalized finish time prediction.
        </p>
        <a
          href="/signup"
          className="inline-block mt-3 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Get started free
        </a>
      </div>

      <ComparisonsCard division={division} eventId={eventId} />

      <FeatureImportanceCard division={division} />
    </div>
  );
}
