"use client";

import { useState, useCallback } from "react";
import type { DivisionKey } from "@/lib/hyrox-data";
import {
  InsightsFilterBar,
  PaceProfileCard,
  DistributionsCard,
  ComparisonsCard,
  FeatureImportanceCard,
  PredictorCard,
} from "@/components/insights/hyrox";
import { useInsightsOverlay } from "@/hooks/useInsights";

export default function HyroxInsightsPage() {
  const [division, setDivision] = useState<DivisionKey>("men_open");
  const [eventId, setEventId] = useState<string | undefined>(undefined);
  const [showOverlay, setShowOverlay] = useState(false);

  const { data: overlay } = useInsightsOverlay(division, showOverlay);

  const handleDivisionChange = useCallback((d: DivisionKey) => setDivision(d), []);
  const handleEventChange = useCallback((id: string | undefined) => setEventId(id), []);

  return (
    <div className="flex flex-col gap-4">
      {/* Predictor card — auth only */}
      <PredictorCard />

      <InsightsFilterBar
        division={division}
        onDivisionChange={handleDivisionChange}
        eventId={eventId}
        onEventChange={handleEventChange}
      />

      {/* Compare toggle */}
      <div className="flex items-center justify-end gap-2">
        <label className="text-[10px] text-muted-foreground">Compare against my times</label>
        <button
          onClick={() => setShowOverlay(!showOverlay)}
          className={`relative h-5 w-9 rounded-full transition-colors ${
            showOverlay ? "bg-primary" : "bg-white/[0.1]"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
              showOverlay ? "translate-x-4" : ""
            }`}
          />
        </button>
      </div>

      <PaceProfileCard
        division={division}
        eventId={eventId}
        userOverlay={showOverlay ? overlay : null}
      />

      <DistributionsCard division={division} eventId={eventId} />

      <ComparisonsCard division={division} eventId={eventId} />

      <FeatureImportanceCard division={division} />
    </div>
  );
}
