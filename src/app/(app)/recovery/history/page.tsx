"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Loader2, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useRecoveryHistory } from "@/hooks/useRecoverySessions";

function dateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function RecoveryHistoryPage() {
  const { startDate, endDate } = useMemo(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 56); // 8 weeks
    return { startDate: dateKey(start), endDate: dateKey(end) };
  }, []);

  const { data, isLoading } = useRecoveryHistory(startDate, endDate);

  // Adherence: 8-week sparkline.
  const weeks = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of data ?? []) {
      if (s.status !== "complete") continue;
      const d = new Date(`${s.sessionDate}T00:00:00`);
      const day = d.getDay();
      const diff = (day + 6) % 7;
      const monday = new Date(d);
      monday.setDate(monday.getDate() - diff);
      const key = dateKey(monday);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    const buckets: { key: string; count: number }[] = [];
    const today = new Date();
    const dayOfWeek = (today.getDay() + 6) % 7;
    const thisMonday = new Date(today);
    thisMonday.setDate(thisMonday.getDate() - dayOfWeek);
    for (let i = 7; i >= 0; i--) {
      const d = new Date(thisMonday);
      d.setDate(d.getDate() - i * 7);
      const key = dateKey(d);
      buckets.push({ key, count: map.get(key) ?? 0 });
    }
    return buckets;
  }, [data]);

  const maxWeek = Math.max(1, ...weeks.map((w) => w.count));

  // Frequently skipped this month.
  const skipCounts = useMemo(() => {
    const counts = new Map<string, { name: string; count: number; movementId: string }>();
    const monthAgo = new Date();
    monthAgo.setDate(monthAgo.getDate() - 30);
    const cutoff = dateKey(monthAgo);
    for (const s of data ?? []) {
      if (s.sessionDate < cutoff) continue;
      for (const it of (s as { items?: Array<{ status: string; movementName?: string; movementId: string }> }).items ?? []) {
        if (it.status !== "skipped") continue;
        const cur = counts.get(it.movementId);
        if (cur) cur.count++;
        else counts.set(it.movementId, { name: it.movementName ?? "Movement", count: 1, movementId: it.movementId });
      }
    }
    return Array.from(counts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">History</h1>

      {/* Adherence */}
      <Card>
        <CardContent className="py-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
            8-week adherence
          </p>
          <div className="flex items-end gap-1 h-16">
            {weeks.map((w) => (
              <div
                key={w.key}
                className="flex-1 rounded-sm bg-emerald-500/30 hover:bg-emerald-500/50 transition-colors"
                style={{
                  height: w.count > 0 ? `${(w.count / maxWeek) * 100}%` : "4px",
                  minHeight: "4px",
                }}
                title={`${w.key}: ${w.count}`}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Frequently skipped */}
      {skipCounts.length > 0 && (
        <Card>
          <CardContent className="py-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
              Frequently skipped this month
            </p>
            <div className="space-y-1">
              {skipCounts.map((s) => (
                <Link
                  key={s.movementId}
                  href={`/recovery/movements/${s.movementId}`}
                  className="flex items-center justify-between text-sm hover:bg-muted/30 rounded px-2 py-1.5"
                >
                  <span>{s.name}</span>
                  <Badge variant="outline" className="text-[10px]">
                    skipped {s.count}×
                  </Badge>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Session list */}
      <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
        Recent sessions
      </h2>
      {!data || data.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No sessions logged yet.
          </CardContent>
        </Card>
      ) : (
        data.map((s) => {
          const items = (s as { items?: Array<{ status: string }> }).items ?? [];
          const done = items.filter((i) => i.status === "done").length;
          const skipped = items.filter((i) => i.status === "skipped").length;
          return (
            <Card key={s.id}>
              <CardContent className="py-3 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    {new Date(`${s.sessionDate}T00:00:00`).toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge
                      variant={s.status === "complete" ? "default" : "secondary"}
                      className="text-[10px]"
                    >
                      {s.status}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      {done}/{items.length} · {skipped} skipped
                    </span>
                  </div>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
