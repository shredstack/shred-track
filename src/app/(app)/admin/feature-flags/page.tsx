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

// Base UI's <Select.Value> renders the raw value unless the root <Select> is
// given an `items` map from value → label. Without it the trigger shows the
// stored value ("on"/"off"/"default") verbatim.
const FLAG_STATE_LABELS: Record<string, string> = {
  default: "Default",
  on: "On",
  off: "Off",
};

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
        <SuperFlagPanel data={data} />
      ) : (
        <GymFlagList data={data} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Super admin: pick one gym, configure all its flags in a single column.
// A flags × gyms matrix can't fit on a phone once there are more than a
// couple of gyms, so the gym is a picker and the flag list is the page.
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

/** Number of flags a gym has explicitly overridden away from the default. */
function gymOverrideCount(
  overrides: Record<string, Record<string, unknown>>,
  gymId: string
): number {
  const map = overrides[gymId];
  if (!map) return 0;
  return Object.values(map).filter((v) => v !== undefined && v !== null).length;
}

function SuperFlagPanel({
  data,
}: {
  data: Extract<FlagsResponse, { scope: "super" }>;
}) {
  const { setOverride, updating } = useSetOverride();
  const [filter, setFilter] = useState("");
  const [gymId, setGymId] = useState<string>(data.gyms[0]?.id ?? "");

  const selectedGym = useMemo(
    () => data.gyms.find((g) => g.id === gymId) ?? null,
    [data.gyms, gymId]
  );

  // Maps gym id → name so the Base UI <Select> trigger shows the gym name
  // instead of the raw id value.
  const gymLabels = useMemo(
    () => Object.fromEntries(data.gyms.map((g) => [g.id, g.name])),
    [data.gyms]
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return data.flags;
    return data.flags.filter(
      (f) =>
        f.key.toLowerCase().includes(q) ||
        (f.description ?? "").toLowerCase().includes(q)
    );
  }, [data.flags, filter]);

  if (data.gyms.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No gyms yet. Create a gym to manage its feature flags.
        </CardContent>
      </Card>
    );
  }

  const overrideCount = selectedGym
    ? gymOverrideCount(data.overrides, selectedGym.id)
    : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Per-gym overrides</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Pick one gym — keeps the flag list a single, scrollable column. */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Gym
          </label>
          <Select
            value={gymId}
            items={gymLabels}
            onValueChange={(v) => setGymId(v ?? "")}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a gym" />
            </SelectTrigger>
            <SelectContent>
              {data.gyms.map((g) => {
                const count = gymOverrideCount(data.overrides, g.id);
                return (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                    {count > 0
                      ? ` · ${count} override${count === 1 ? "" : "s"}`
                      : ""}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {overrideCount === 0
              ? "Every flag is using its default for this gym."
              : `${overrideCount} flag${
                  overrideCount === 1 ? "" : "s"
                } overridden for this gym.`}
          </p>
        </div>

        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter flags…"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />

        {/* Every flag for the selected gym, one row each. */}
        <div>
          {filtered.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No flags match “{filter}”.
            </p>
          ) : (
            filtered.map((flag) => {
              const state = selectedGym
                ? cellValue(data.overrides, selectedGym.id, flag.key)
                : "default";
              const cellId = selectedGym
                ? `community:${selectedGym.id}:${flag.key}`
                : "";
              const disabled = !flag.isPerGym || updating === cellId;
              return (
                <div
                  key={flag.key}
                  className="flex items-start justify-between gap-3 border-b border-white/[0.04] py-3 last:border-0"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-sm font-medium">{flag.key}</p>
                      {flag.isGymAdminConfigurable ? (
                        <span className="inline-block rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          Gym-configurable
                        </span>
                      ) : null}
                      {!flag.isPerGym ? (
                        <span className="inline-block rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          Not per-gym
                        </span>
                      ) : null}
                    </div>
                    {flag.description ? (
                      <p className="text-xs text-muted-foreground">
                        {flag.description}
                      </p>
                    ) : null}
                    <p className="text-[11px] text-muted-foreground">
                      {describeDefault(flag.defaultValue)}
                    </p>
                  </div>
                  <Select
                    value={state}
                    items={FLAG_STATE_LABELS}
                    disabled={disabled}
                    onValueChange={(v) => {
                      if (!selectedGym) return;
                      if (v === "default") {
                        setOverride(
                          "community",
                          selectedGym.id,
                          flag.key,
                          null
                        );
                      } else {
                        setOverride(
                          "community",
                          selectedGym.id,
                          flag.key,
                          v === "on"
                        );
                      }
                    }}
                  >
                    <SelectTrigger className="h-8 w-[110px] shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default</SelectItem>
                      <SelectItem value="on">On</SelectItem>
                      <SelectItem value="off">Off</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              );
            })
          )}
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
