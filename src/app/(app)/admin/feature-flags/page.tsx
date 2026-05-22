"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Flag } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AdminToolHeader } from "@/components/admin/admin-tool-header";
import { getAdminTool } from "@/lib/admin/tools";

interface FlagRow {
  key: string;
  description: string | null;
  defaultValue: unknown;
  isPerGym: boolean;
  isPerUser: boolean;
  isGymAdminConfigurable: boolean;
}

interface Gym {
  id: string;
  name: string;
}

// Super admins see the full per-gym matrix; gym admins/coaches see a limited
// view scoped to their active gym + the flags they're allowed to toggle.
type FlagsResponse =
  | {
      scope: "super";
      flags: FlagRow[];
      gyms: Gym[];
      overrides: Record<string, Record<string, unknown>>; // gymId → flagKey → value
    }
  | {
      scope: "gym";
      gym: Gym | null;
      flags: FlagRow[];
      overrides: Record<string, unknown>; // flagKey → value
    };

function isTruthy(v: unknown): boolean {
  return v === true || v === "true" || v === 1;
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

/** Shared mutation: upsert/clear an override, then refresh affected caches. */
function useSetOverride() {
  const qc = useQueryClient();
  const [updating, setUpdating] = useState<string | null>(null);

  const setOverride = useCallback(
    async (
      scope: "community" | "user",
      targetId: string,
      flagKey: string,
      value: unknown
    ) => {
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
        // Other clients pick up the change on their next refetch.
        qc.invalidateQueries({ queryKey: ["feature-flags"] });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed");
      } finally {
        setUpdating(null);
      }
    },
    [qc]
  );

  return { setOverride, updating };
}

export default function AdminFeatureFlagsPage() {
  const { data, isLoading } = useFlagMatrix();

  const tool = getAdminTool("feature-flags");
  const header = tool ? (
    <AdminToolHeader
      label={tool.label}
      description={tool.description}
      icon={tool.icon}
    />
  ) : (
    <AdminToolHeader
      label="Feature flags"
      description="Toggle features per gym."
      icon={Flag}
    />
  );

  if (isLoading || !data) {
    return (
      <div className="space-y-5">
        {header}
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {header}
      {data.scope === "super" ? (
        <SuperFlagMatrix data={data} />
      ) : (
        <GymFlagList data={data} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Super admin: full per-gym matrix.
// ---------------------------------------------------------------------------

function cellValue(
  overrides: Record<string, Record<string, unknown>>,
  gymId: string,
  flagKey: string
): "on" | "off" | "default" {
  const override = overrides[gymId]?.[flagKey];
  if (override === undefined) return "default";
  return isTruthy(override) ? "on" : "off";
}

function describeDefault(defaultValue: unknown): string {
  return isTruthy(defaultValue) ? "default on" : "default off";
}

function SuperFlagMatrix({
  data,
}: {
  data: Extract<FlagsResponse, { scope: "super" }>;
}) {
  const { setOverride, updating } = useSetOverride();
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return data.flags;
    return data.flags.filter(
      (f) =>
        f.key.toLowerCase().includes(q) ||
        (f.description ?? "").toLowerCase().includes(q)
    );
  }, [data.flags, filter]);

  return (
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
                    {flag.isGymAdminConfigurable ? (
                      <span className="mt-1 inline-block rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        Gym-configurable
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 align-top text-xs text-muted-foreground">
                    {describeDefault(flag.defaultValue)}
                  </td>
                  {data.gyms.map((g) => {
                    const state = cellValue(data.overrides, g.id, flag.key);
                    const cellId = `community:${g.id}:${flag.key}`;
                    const disabled = !flag.isPerGym || updating === cellId;
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
  );
}

// ---------------------------------------------------------------------------
// Gym admin/coach: limited toggle list for the active gym.
// ---------------------------------------------------------------------------

function GymFlagList({
  data,
}: {
  data: Extract<FlagsResponse, { scope: "gym" }>;
}) {
  const { setOverride, updating } = useSetOverride();
  const { gym, flags, overrides } = data;

  if (!gym) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Switch to a gym you administer to manage its features.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Features for {gym.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {flags.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            No gym-configurable features right now.
          </p>
        ) : (
          flags.map((flag) => {
            const raw =
              flag.key in overrides ? overrides[flag.key] : flag.defaultValue;
            const on = isTruthy(raw);
            const cellId = `community:${gym.id}:${flag.key}`;
            return (
              <div
                key={flag.key}
                className="flex items-center justify-between gap-3 border-b border-white/[0.04] py-3 last:border-0"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">{flag.key}</p>
                  {flag.description ? (
                    <p className="text-[11px] text-muted-foreground">
                      {flag.description}
                    </p>
                  ) : null}
                </div>
                <Switch
                  checked={on}
                  disabled={updating === cellId}
                  onCheckedChange={(checked) =>
                    setOverride("community", gym.id, flag.key, checked)
                  }
                />
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
