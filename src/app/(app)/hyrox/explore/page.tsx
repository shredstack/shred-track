"use client";

import { useState, useCallback } from "react";
import { Info, BarChart3 } from "lucide-react";
import { OverviewTab } from "@/components/hyrox/overview-tab";
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

type Tab = "overview" | "insights";

const TABS = [
  { key: "overview" as const, label: "Overview", icon: Info },
  { key: "insights" as const, label: "Insights", icon: BarChart3 },
];

export default function HyroxExplorePage() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  // Insights state
  const [division, setDivision] = useState<DivisionKey>("men_open");
  const [eventId, setEventId] = useState<string | undefined>(undefined);
  const [showOverlay, setShowOverlay] = useState(false);
  const { data: overlay } = useInsightsOverlay(division, showOverlay);

  const handleDivisionChange = useCallback((d: DivisionKey) => setDivision(d), []);
  const handleEventChange = useCallback((id: string | undefined) => setEventId(id), []);

  return (
    <div className="flex flex-col gap-4">
      {/* Sub-tab switcher */}
      <div className="flex rounded-lg bg-white/[0.03] p-1 gap-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-all duration-200 ${
              activeTab === key
                ? "bg-primary/15 text-primary glow-primary-sm"
                : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "overview" && <OverviewTab />}

      {activeTab === "insights" && (
        <div className="flex flex-col gap-4">
          <PredictorCard />

          <InsightsFilterBar
            division={division}
            onDivisionChange={handleDivisionChange}
            eventId={eventId}
            onEventChange={handleEventChange}
          />

          {/* Compare toggle */}
          <div className="flex items-center justify-end gap-2">
            <label className="text-[10px] text-muted-foreground">
              Compare against my times
            </label>
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
      )}
    </div>
  );
}
