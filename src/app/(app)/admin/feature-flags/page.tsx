"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface FlagRow {
  key: string;
  description: string | null;
  defaultValue: unknown;
  isPerGym: boolean;
  isPerUser: boolean;
}

interface Gym {
  id: string;
  name: string;
}

interface FlagsResponse {
  flags: FlagRow[];
  gyms: Gym[];
  overrides: Record<string, Record<string, unknown>>; // gymId → flagKey → value
}

function useFlagMatrix() {
  return useQuery<FlagsResponse>({
    queryKey: ["admin", "feature-flags"],
    queryFn: async () => {
      const res = await fetch("/api/admin/feature-flags");
      if (!res.ok) throw new Error("Failed to load flags");
      return res.json();
    },
  });
}

function cellValue(
  overrides: Record<string, Record<string, unknown>>,
  gymId: string,
  flagKey: string
): "on" | "off" | "default" {
  const override = overrides[gymId]?.[flagKey];
  if (override === undefined) return "default";
  const truthy = override === true || override === "true" || override === 1;
  return truthy ? "on" : "off";
}

function describeDefault(defaultValue: unknown): string {
  if (defaultValue === true) return "default on";
  return "default off";
}

export default function AdminFeatureFlagsPage() {
  const { data, isLoading } = useFlagMatrix();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const [updating, setUpdating] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return data.flags;
    return data.flags.filter(
      (f) =>
        f.key.toLowerCase().includes(q) ||
        (f.description ?? "").toLowerCase().includes(q)
    );
  }, [data, filter]);

  async function setOverride(
    scope: "community" | "user",
    targetId: string,
    flagKey: string,
    value: unknown
  ) {
    const cellId = `${scope}:${targetId}:${flagKey}`;
    setUpdating(cellId);
    try {
      const res = await fetch("/api/admin/feature-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, targetId, flagKey, value }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to update");
      }
      qc.invalidateQueries({ queryKey: ["admin", "feature-flags"] });
      // Other clients should pick up the change on next refetch.
      qc.invalidateQueries({ queryKey: ["feature-flags"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setUpdating(null);
    }
  }

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Feature flags</h1>
        <p className="text-sm text-muted-foreground">
          Toggle features per gym. User-scoped flags are managed separately
          (see the legacy <code className="text-xs">move_to_gym</code> tool
          for an example).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Per-gym overrides</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter flags…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-left text-xs font-medium text-muted-foreground">
                  <th className="py-2 pr-3 min-w-[200px]">Flag</th>
                  <th className="py-2 pr-3 w-[110px]">Default</th>
                  {data.gyms.map((g) => (
                    <th key={g.id} className="py-2 pr-3 min-w-[150px]">
                      {g.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((flag) => (
                  <tr key={flag.key} className="border-b border-white/[0.04]">
                    <td className="py-2 pr-3 align-top">
                      <div className="font-medium text-sm">{flag.key}</div>
                      {flag.description ? (
                        <div className="text-xs text-muted-foreground">
                          {flag.description}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 align-top text-xs text-muted-foreground">
                      {describeDefault(flag.defaultValue)}
                    </td>
                    {data.gyms.map((g) => {
                      const state = cellValue(data.overrides, g.id, flag.key);
                      const cellId = `community:${g.id}:${flag.key}`;
                      const isUpdating = updating === cellId;
                      const disabled = !flag.isPerGym || isUpdating;
                      return (
                        <td key={g.id} className="py-2 pr-3 align-top">
                          <Select
                            value={state}
                            disabled={disabled}
                            onValueChange={(v) => {
                              if (v === "default") {
                                setOverride("community", g.id, flag.key, null);
                              } else {
                                setOverride(
                                  "community",
                                  g.id,
                                  flag.key,
                                  v === "on"
                                );
                              }
                            }}
                          >
                            <SelectTrigger className="h-8 w-[110px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="default">Default</SelectItem>
                              <SelectItem value="on">On</SelectItem>
                              <SelectItem value="off">Off</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
