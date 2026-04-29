"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Search, Dumbbell, Video, ChevronRight, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MOVEMENT_CATEGORY_COLORS,
  type MovementCategory,
  type CategoryFilter,
} from "@/types/crossfit";
import { CategoryPills } from "@/components/shared/category-pills";
import type { MovementLibraryRow } from "@/app/api/movements/library/route";

type LoggedFilter = "all" | "logged" | "untried";

const RECENT_LIMIT = 8;

function useMovementLibrary() {
  return useQuery<MovementLibraryRow[]>({
    queryKey: ["movement-library"],
    queryFn: async () => {
      const res = await fetch("/api/movements/library");
      if (!res.ok) throw new Error("Failed to load movements");
      return res.json();
    },
    staleTime: 60_000,
  });
}

function formatLastLogged(date: string | null): string {
  if (!date) return "Never logged";
  const d = new Date(`${date}T00:00:00`);
  const now = new Date();
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export default function MovementsPage() {
  const { data, isLoading } = useMovementLibrary();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [logged, setLogged] = useState<LoggedFilter>("all");

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.filter((m) => {
      if (category !== "all" && m.category !== category) return false;
      if (logged === "logged" && m.stats.logCount === 0) return false;
      if (logged === "untried" && m.stats.logCount > 0) return false;
      if (q && !m.canonicalName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, search, category, logged]);

  // Surface a "Recent" group only when the user hasn't narrowed the list —
  // grouping while filtering would just duplicate items the filter already
  // surfaces. Recency is driven by the most recent workout the movement
  // appeared in (lastLoggedAt comes from the library endpoint).
  const showGroupedRecent =
    category === "all" && logged === "all" && search.trim().length === 0;

  const { recentItems, restItems } = useMemo(() => {
    if (!showGroupedRecent) {
      return { recentItems: [] as MovementLibraryRow[], restItems: filtered };
    }
    const sorted = filtered
      .filter((m) => m.stats.lastLoggedAt)
      .sort((a, b) =>
        (b.stats.lastLoggedAt ?? "").localeCompare(a.stats.lastLoggedAt ?? ""),
      );
    const recent = sorted.slice(0, RECENT_LIMIT);
    const recentIds = new Set(recent.map((m) => m.id));
    const rest = filtered.filter((m) => !recentIds.has(m.id));
    return { recentItems: recent, restItems: rest };
  }, [filtered, showGroupedRecent]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search movements..."
            className="pl-9"
          />
        </div>
        <CategoryPills
          value={category}
          onChange={setCategory}
          className="-mx-1 px-1"
        />
        <div className="flex gap-2">
          <Select value={logged} onValueChange={(v) => setLogged(v as LoggedFilter)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All movements</SelectItem>
              <SelectItem value="logged">Logged</SelectItem>
              <SelectItem value="untried">Untried</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="gradient-border overflow-visible">
          <CardContent className="flex flex-col items-center gap-3 py-10 bg-mesh rounded-xl">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/10">
              <Dumbbell className="h-5 w-5 text-violet-400" />
            </div>
            <p className="text-sm text-muted-foreground text-center max-w-xs">
              No movements match your filters.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {filtered.length} of {data?.length ?? 0}
          </p>
          {recentItems.length > 0 && (
            <>
              <h2 className="px-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Recent
              </h2>
              {recentItems.map((m) => (
                <MovementRow key={m.id} m={m} />
              ))}
              <h2 className="px-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                All movements
              </h2>
            </>
          )}
          {restItems.map((m) => (
            <MovementRow key={m.id} m={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function MovementRow({ m }: { m: MovementLibraryRow }) {
  const rxPct =
    m.stats.logCount > 0
      ? Math.round((m.stats.rxCount / m.stats.logCount) * 100)
      : null;
  return (
    <Link href={`/crossfit/movements/${m.id}`}>
      <Card className="hover:bg-muted/30 transition-colors">
        <CardContent className="flex items-center gap-3 py-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium truncate">
                {m.canonicalName}
              </span>
              <Badge
                variant="outline"
                className={`text-[10px] ${MOVEMENT_CATEGORY_COLORS[m.category as MovementCategory] || ""}`}
              >
                {m.category}
              </Badge>
              {m.isOwn && (
                <Badge variant="outline" className="text-[10px]">
                  Custom
                </Badge>
              )}
              {m.videoUrl && (
                <Video className="size-3 text-muted-foreground" />
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
              <span>{formatLastLogged(m.stats.lastLoggedAt)}</span>
              {m.stats.logCount > 0 && (
                <>
                  <span>·</span>
                  <span>
                    {m.stats.logCount} log{m.stats.logCount === 1 ? "" : "s"}
                  </span>
                  {rxPct !== null && (
                    <>
                      <span>·</span>
                      <span>{rxPct}% Rx</span>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
          <ChevronRight className="size-4 text-muted-foreground shrink-0" />
        </CardContent>
      </Card>
    </Link>
  );
}
