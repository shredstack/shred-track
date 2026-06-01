"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  TrendingUp,
  Loader2,
  Plus,
  Dumbbell,
  Timer,
  BarChart3,
  ArrowRight,
} from "lucide-react";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTrends } from "@/hooks/useCrossfitInsights";
import type {
  StrengthTrend,
  BenchmarkTrend,
  BenchmarkRetest,
  VolumeTrend,
  TrendsResult,
} from "@/lib/crossfit/insights/trends";
import { formatTime } from "@/lib/hyrox-data";

type Tab = "strength" | "speed" | "volume";

const VOLUME_WEEK_OPTIONS = [12, 26, 52] as const;

export function TrendsCard() {
  const [tab, setTab] = useState<Tab>("strength");
  const [volumeWeeks, setVolumeWeeks] =
    useState<(typeof VOLUME_WEEK_OPTIONS)[number]>(12);

  const { data, isLoading, isError } = useTrends(volumeWeeks);

  return (
    <Card className="gradient-border">
      <CardContent className="p-4 md:p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-500/10">
            <TrendingUp className="h-5 w-5 text-purple-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Trends over time</p>
            <p className="text-xs text-muted-foreground">
              Your strength and speed all-time; volume across recent weeks.
            </p>
          </div>
        </div>

        <TabBar tab={tab} onChange={setTab} />

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {isError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Couldn&apos;t load trends. Try again later.
          </div>
        )}

        {data && (
          <Body
            tab={tab}
            data={data}
            volumeWeeks={volumeWeeks}
            onVolumeWeeksChange={setVolumeWeeks}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ============================================
// Tab bar
// ============================================

const TAB_META: Record<Tab, { label: string; icon: typeof Dumbbell }> = {
  strength: { label: "Strength", icon: Dumbbell },
  speed: { label: "Speed", icon: Timer },
  volume: { label: "Volume", icon: BarChart3 },
};

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <div className="inline-flex w-full rounded-md border border-border/60 bg-muted/30 p-0.5 text-xs">
      {(Object.keys(TAB_META) as Tab[]).map((key) => {
        const Icon = TAB_META[key].icon;
        const active = tab === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={
              "flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 transition-colors " +
              (active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            <Icon className="h-3.5 w-3.5" />
            {TAB_META[key].label}
          </button>
        );
      })}
    </div>
  );
}

// ============================================
// Body switch
// ============================================

function Body({
  tab,
  data,
  volumeWeeks,
  onVolumeWeeksChange,
}: {
  tab: Tab;
  data: TrendsResult;
  volumeWeeks: (typeof VOLUME_WEEK_OPTIONS)[number];
  onVolumeWeeksChange: (n: (typeof VOLUME_WEEK_OPTIONS)[number]) => void;
}) {
  if (tab === "strength") return <StrengthTab trends={data.strength} />;
  if (tab === "speed")
    return (
      <SpeedTab trends={data.benchmarks} retests={data.benchmarkRetests} />
    );
  return (
    <VolumeTab
      volume={data.volume}
      weeks={volumeWeeks}
      onWeeksChange={onVolumeWeeksChange}
    />
  );
}

// ============================================
// Strength tab
// ============================================

function StrengthTab({ trends }: { trends: StrengthTrend[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(
    trends[0]?.movementId ?? null
  );

  if (trends.length === 0) {
    return (
      <EmptyState
        title="No 1RM-applicable sessions yet"
        body="Log a heavy weightlifting session and we'll plot your e1RM over time."
        cta={{ href: "/crossfit", label: "Add a workout" }}
      />
    );
  }

  const selected =
    trends.find((t) => t.movementId === selectedId) ?? trends[0];

  return (
    <div className="space-y-3">
      <MovementPicker
        trends={trends}
        selectedId={selected.movementId}
        onChange={setSelectedId}
      />
      <StrengthChart trend={selected} />
      <StrengthSummary trend={selected} />
    </div>
  );
}

function MovementPicker({
  trends,
  selectedId,
  onChange,
}: {
  trends: StrengthTrend[];
  selectedId: string;
  onChange: (id: string) => void;
}) {
  // Base UI <Select> needs an `items` map so the trigger renders the label,
  // not the raw id. See project memory: project_base_ui_select.
  const items = useMemo(
    () =>
      Object.fromEntries(
        trends.map((t) => [
          t.movementId,
          `${t.movementName} (${t.points.length} session${t.points.length === 1 ? "" : "s"})`,
        ])
      ),
    [trends]
  );

  return (
    <div className="flex items-center gap-2">
      <label className="text-[11px] text-muted-foreground">Movement</label>
      <Select
        value={selectedId}
        items={items}
        onValueChange={(v) => v && onChange(v)}
      >
        <SelectTrigger className="h-7 flex-1 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {trends.map((t) => (
            <SelectItem key={t.movementId} value={t.movementId}>
              {t.movementName} ({t.points.length} session
              {t.points.length === 1 ? "" : "s"})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function StrengthChart({ trend }: { trend: StrengthTrend }) {
  const data = useMemo(
    () =>
      trend.points.map((p) => ({
        date: p.date,
        label: shortDate(p.date),
        e1rm: p.estimatedOneRm,
        weight: p.weight,
        reps: p.reps,
        isDirectTest: p.isDirectTest,
      })),
    [trend]
  );

  if (data.length < 2) {
    return (
      <div className="rounded-md border border-dashed border-white/[0.06] py-5 px-3 text-center">
        <p className="text-xs text-muted-foreground">
          Only one logged session for {trend.movementName} so far. Log another
          heavy day to see trend.
        </p>
      </div>
    );
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 24, left: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(255,255,255,0.05)"
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)" }}
            angle={-30}
            textAnchor="end"
            height={50}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }}
            width={40}
            domain={["auto", "auto"]}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "rgba(0,0,0,0.85)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            labelStyle={{ color: "rgba(255,255,255,0.7)" }}
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const p = payload[0].payload as (typeof data)[number];
              return (
                <div className="rounded-md border border-white/10 bg-black/85 p-2 text-xs">
                  <p className="text-muted-foreground">{shortDate(p.date)}</p>
                  <p className="font-mono">
                    e1RM ~{p.e1rm} lb
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {p.weight} lb × {p.reps}
                    {p.isDirectTest ? " (1RM)" : ""}
                  </p>
                </div>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="e1rm"
            stroke="#a78bfa"
            strokeWidth={2}
            dot={{ r: 3, fill: "#a78bfa" }}
            activeDot={{ r: 5 }}
            name="e1RM"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function StrengthSummary({ trend }: { trend: StrengthTrend }) {
  const direction = trend.deltaLb > 0 ? "↑" : trend.deltaLb < 0 ? "↓" : "→";
  const colorClass =
    trend.deltaLb > 0
      ? "text-emerald-400"
      : trend.deltaLb < 0
        ? "text-orange-400"
        : "text-muted-foreground";

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-xs">
      <div>
        <p className="text-muted-foreground">Best e1RM</p>
        <p className="font-mono text-sm font-semibold">{trend.bestE1rm} lb</p>
      </div>
      <div>
        <p className="text-muted-foreground">Latest</p>
        <p className="font-mono text-sm font-semibold">{trend.latestE1rm} lb</p>
      </div>
      <div className="text-right">
        <p className="text-muted-foreground">Change</p>
        <p className={`font-mono text-sm font-semibold ${colorClass}`}>
          {direction} {trend.deltaLb > 0 ? "+" : ""}
          {trend.deltaLb} lb
        </p>
      </div>
    </div>
  );
}

// ============================================
// Speed tab
// ============================================

function SpeedTab({
  trends,
  retests,
}: {
  trends: BenchmarkTrend[];
  retests: BenchmarkRetest[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    trends[0]?.benchmarkId ?? null
  );

  if (trends.length === 0 && retests.length === 0) {
    return (
      <EmptyState
        title="Log a benchmark twice to see speed trends"
        body="Repeat workouts like Fran or Grace, or any benchmark you've logged before, to start tracking progress."
        cta={{ href: "/crossfit", label: "Add a workout" }}
      />
    );
  }

  // Athletes who've logged 1+ benchmarks but never twice see only retests —
  // skip the picker entirely and surface the CTA list.
  if (trends.length === 0) {
    return (
      <div className="space-y-3">
        <RetestList items={retests} />
      </div>
    );
  }

  const selected =
    trends.find((t) => t.benchmarkId === selectedId) ?? trends[0];

  return (
    <div className="space-y-3">
      <BenchmarkPicker
        trends={trends}
        selectedId={selected.benchmarkId}
        onChange={setSelectedId}
      />
      <BenchmarkTrendDetail trend={selected} />
      {retests.length > 0 && <RetestList items={retests} />}
    </div>
  );
}

function BenchmarkPicker({
  trends,
  selectedId,
  onChange,
}: {
  trends: BenchmarkTrend[];
  selectedId: string;
  onChange: (id: string) => void;
}) {
  // Base UI <Select> needs an `items` map so the trigger renders the label,
  // not the raw id. See project memory: project_base_ui_select.
  const items = useMemo(
    () =>
      Object.fromEntries(
        trends.map((t) => [
          t.benchmarkId,
          `${t.benchmarkName} (${t.points.length} log${t.points.length === 1 ? "" : "s"})`,
        ])
      ),
    [trends]
  );

  return (
    <div className="flex items-center gap-2">
      <label className="text-[11px] text-muted-foreground">Workout</label>
      <Select
        value={selectedId}
        items={items}
        onValueChange={(v) => v && onChange(v)}
      >
        <SelectTrigger className="h-7 flex-1 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {trends.map((t) => (
            <SelectItem key={t.benchmarkId} value={t.benchmarkId}>
              {t.benchmarkName} ({t.points.length} log
              {t.points.length === 1 ? "" : "s"})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function BenchmarkTrendDetail({ trend }: { trend: BenchmarkTrend }) {
  const summary = summarizeBenchmark(trend);

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <p className="font-semibold text-sm">{trend.benchmarkName}</p>
        <Badge
          variant="outline"
          className="text-[10px] text-muted-foreground font-normal"
        >
          {trend.points.length} log{trend.points.length === 1 ? "" : "s"}
        </Badge>
      </div>

      <BenchmarkChart trend={trend} />

      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">Best</span>
        <span className="font-mono font-semibold">
          {summary.best} ·{" "}
          <span className="text-muted-foreground font-normal">
            {shortDate(trend.bestPoint.date)}
          </span>
        </span>
      </div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">Latest</span>
        <span className="font-mono font-semibold">
          {summary.latest} ·{" "}
          <span className="text-muted-foreground font-normal">
            {shortDate(trend.latestPoint.date)}
          </span>
        </span>
      </div>
      {trend.improved != null && (
        <p
          className={
            "text-[11px] font-medium " +
            (trend.improved ? "text-emerald-400" : "text-orange-400")
          }
        >
          {trend.improved ? "↑ Improving" : "↓ Slipping"} since first log
        </p>
      )}
    </div>
  );
}

function BenchmarkChart({ trend }: { trend: BenchmarkTrend }) {
  const yKey = primaryMetricFor(trend.workoutType);

  const data = useMemo(
    () =>
      trend.points.map((p) => ({
        date: p.date,
        label: shortDate(p.date),
        timeSeconds: p.timeSeconds,
        totalReps: p.totalReps,
        weightLbs: p.weightLbs,
        amrapScore:
          (p.rounds ?? 0) * 1000 + (p.remainderReps ?? 0),
        rounds: p.rounds,
        remainderReps: p.remainderReps,
      })),
    [trend]
  );

  if (!yKey) return null;

  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 4, right: 4, bottom: 16, left: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(255,255,255,0.05)"
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)" }}
            angle={-30}
            textAnchor="end"
            height={40}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }}
            width={40}
            tickFormatter={(v: number) =>
              yKey === "timeSeconds" ? formatTime(v) : `${v}`
            }
            // For for_time, lower is better, but recharts always plots low at
            // bottom — that's fine, we just label things clearly.
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const p = payload[0].payload as (typeof data)[number];
              return (
                <div className="rounded-md border border-white/10 bg-black/85 p-2 text-xs">
                  <p className="text-muted-foreground">{shortDate(p.date)}</p>
                  <p className="font-mono">{formatPoint(trend.workoutType, p)}</p>
                </div>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey={yKey}
            stroke="#60a5fa"
            strokeWidth={2}
            dot={{ r: 3, fill: "#60a5fa" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function RetestList({ items }: { items: BenchmarkRetest[] }) {
  return (
    <div className="rounded-md border border-dashed border-white/[0.08] bg-muted/10 p-3">
      <p className="text-xs font-medium">Test again to see trend</p>
      <p className="text-[11px] text-muted-foreground mb-2">
        You&apos;ve only logged these benchmarks once. Re-test to start
        tracking progress.
      </p>
      <div className="space-y-1.5">
        {items.map((r) => (
          <div
            key={r.benchmarkId}
            className="flex items-center justify-between gap-2 text-[11px]"
          >
            <div className="min-w-0 flex-1">
              <span className="font-medium">{r.benchmarkName}</span>
              <span className="text-muted-foreground ml-2">
                last logged {Math.floor(r.daysSinceLast / 30)} mo ago
                {r.lastTimeSeconds != null && ` · ${formatTime(r.lastTimeSeconds)}`}
              </span>
            </div>
            <Link href="/crossfit" className="shrink-0">
              <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]">
                Re-test
                <ArrowRight className="h-3 w-3" />
              </Button>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// Volume tab
// ============================================

function VolumeTab({
  volume,
  weeks,
  onWeeksChange,
}: {
  volume: VolumeTrend;
  weeks: (typeof VOLUME_WEEK_OPTIONS)[number];
  onWeeksChange: (n: (typeof VOLUME_WEEK_OPTIONS)[number]) => void;
}) {
  if (volume.totalWorkouts === 0) {
    return (
      <EmptyState
        title="No workouts logged yet"
        body="Log a few workouts and we'll show you weekly volume by domain."
        cta={{ href: "/crossfit", label: "Add a workout" }}
      />
    );
  }

  const totalHours = Math.round(volume.totalSeconds / 3600);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-muted-foreground">
          {volume.totalWorkouts} workout
          {volume.totalWorkouts === 1 ? "" : "s"}
          {totalHours > 0 ? ` · ${totalHours} hr training` : ""}
        </div>
        <div className="inline-flex rounded-md border border-border/60 bg-muted/30 p-0.5 text-[11px]">
          {VOLUME_WEEK_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onWeeksChange(n)}
              className={
                "rounded px-2 py-1 transition-colors " +
                (weeks === n
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {n}w
            </button>
          ))}
        </div>
      </div>

      <VolumeChart volume={volume} />

      <p className="text-[10px] text-muted-foreground">
        Each workout is counted once per domain it touches. Stacked totals can
        exceed the workout count for cross-domain sessions.
      </p>
    </div>
  );
}

const VOLUME_COLORS: Record<string, string> = {
  weightlifting: "#ef4444",
  gymnastics: "#3b82f6",
  monostructural: "#10b981",
  mixed: "#a78bfa",
};

const VOLUME_LABELS: Record<string, string> = {
  weightlifting: "Weightlifting",
  gymnastics: "Gymnastics",
  monostructural: "Mono",
  mixed: "Mixed",
};

function VolumeChart({ volume }: { volume: VolumeTrend }) {
  const data = useMemo(
    () =>
      volume.weeks.map((w) => ({
        weekStart: w.weekStart,
        label: shortDate(w.weekStart),
        weightlifting: w.weightlifting,
        gymnastics: w.gymnastics,
        monostructural: w.monostructural,
        mixed: w.mixed,
      })),
    [volume]
  );

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 24, left: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(255,255,255,0.05)"
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)" }}
            angle={-30}
            textAnchor="end"
            height={50}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }}
            width={30}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "rgba(0,0,0,0.85)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "8px",
              fontSize: "11px",
            }}
            labelStyle={{ color: "rgba(255,255,255,0.7)" }}
          />
          <Legend
            wrapperStyle={{ fontSize: "10px" }}
            iconSize={8}
          />
          <Area
            type="monotone"
            dataKey="weightlifting"
            name={VOLUME_LABELS.weightlifting}
            stackId="1"
            stroke={VOLUME_COLORS.weightlifting}
            fill={VOLUME_COLORS.weightlifting}
            fillOpacity={0.5}
          />
          <Area
            type="monotone"
            dataKey="gymnastics"
            name={VOLUME_LABELS.gymnastics}
            stackId="1"
            stroke={VOLUME_COLORS.gymnastics}
            fill={VOLUME_COLORS.gymnastics}
            fillOpacity={0.5}
          />
          <Area
            type="monotone"
            dataKey="monostructural"
            name={VOLUME_LABELS.monostructural}
            stackId="1"
            stroke={VOLUME_COLORS.monostructural}
            fill={VOLUME_COLORS.monostructural}
            fillOpacity={0.5}
          />
          <Area
            type="monotone"
            dataKey="mixed"
            name={VOLUME_LABELS.mixed}
            stackId="1"
            stroke={VOLUME_COLORS.mixed}
            fill={VOLUME_COLORS.mixed}
            fillOpacity={0.5}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ============================================
// Helpers
// ============================================

function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function primaryMetricFor(workoutType: string): string | null {
  if (
    workoutType === "for_time" ||
    workoutType === "emom" ||
    workoutType === "tabata"
  ) {
    return "timeSeconds";
  }
  if (workoutType === "amrap") return "amrapScore";
  if (workoutType === "for_reps" || workoutType === "for_calories")
    return "totalReps";
  if (workoutType === "for_load" || workoutType === "max_effort")
    return "weightLbs";
  return null;
}

type ChartPoint = {
  date: string;
  timeSeconds: number | null;
  totalReps: number | null;
  weightLbs: number | null;
  rounds: number | null;
  remainderReps: number | null;
};

function formatPoint(workoutType: string, p: ChartPoint): string {
  if (
    workoutType === "for_time" ||
    workoutType === "emom" ||
    workoutType === "tabata"
  ) {
    return p.timeSeconds != null ? formatTime(p.timeSeconds) : "—";
  }
  if (workoutType === "amrap") {
    if (p.rounds == null && p.remainderReps == null) return "—";
    const r = p.rounds ?? 0;
    const rem = p.remainderReps ?? 0;
    return `${r} + ${rem}`;
  }
  if (workoutType === "for_reps" || workoutType === "for_calories") {
    return p.totalReps != null ? `${p.totalReps}` : "—";
  }
  if (workoutType === "for_load" || workoutType === "max_effort") {
    return p.weightLbs != null ? `${p.weightLbs} lb` : "—";
  }
  return "—";
}

function summarizeBenchmark(trend: BenchmarkTrend): {
  best: string;
  latest: string;
} {
  const fmt = (p: BenchmarkTrend["bestPoint"]) =>
    formatPoint(trend.workoutType, p);
  return {
    best: fmt(trend.bestPoint),
    latest: fmt(trend.latestPoint),
  };
}

// ============================================
// Shared empty state
// ============================================

function EmptyState({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="rounded-md border border-dashed border-white/[0.06] py-5 px-3 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
      {cta && (
        <Link href={cta.href}>
          <Button size="sm" variant="outline" className="mt-3 gap-1">
            <Plus className="h-3 w-3" />
            {cta.label}
          </Button>
        </Link>
      )}
    </div>
  );
}
