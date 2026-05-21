import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import type {
  MovementOption,
  MovementCategory,
  MovementMetricType,
  RxField,
  RxDefaults,
} from "@/types/crossfit";
import { MOVEMENT_METRIC_TYPES, RX_FIELDS } from "@/types/crossfit";

// ============================================
// API response shape (from /api/movements)
// ============================================

interface MovementRow {
  id: string;
  canonicalName: string;
  category: string;
  isWeighted: boolean;
  is1rmApplicable: boolean;
  metricType: string | null;
  supportedMetricTypes?: string[] | null;
  rxFields?: string[] | null;
  rxDefaults?: Record<string, unknown> | null;
  commonRxWeightMale: string | null;
  commonRxWeightFemale: string | null;
  videoUrl: string | null;
  createdBy: string | null;
}

function toMetricType(value: string | null | undefined): MovementMetricType | null {
  if (!value) return null;
  return (MOVEMENT_METRIC_TYPES as readonly string[]).includes(value)
    ? (value as MovementMetricType)
    : null;
}

function toMovementOption(row: MovementRow): MovementOption {
  const metricType: MovementMetricType = toMetricType(row.metricType) ?? "reps";

  const supportedMetricTypes = (row.supportedMetricTypes ?? [])
    .map(toMetricType)
    .filter((m): m is MovementMetricType => m !== null);

  const rxFields = (row.rxFields ?? []).filter((f): f is RxField =>
    (RX_FIELDS as readonly string[]).includes(f)
  );

  return {
    id: row.id,
    canonicalName: row.canonicalName,
    category: row.category as MovementCategory,
    isWeighted: row.isWeighted,
    is1rmApplicable: row.is1rmApplicable,
    metricType,
    supportedMetricTypes:
      supportedMetricTypes.length > 0 ? supportedMetricTypes : undefined,
    rxFields: rxFields.length > 0 ? rxFields : undefined,
    rxDefaults: (row.rxDefaults as RxDefaults | null) ?? undefined,
    commonRxWeightMale: row.commonRxWeightMale ?? undefined,
    commonRxWeightFemale: row.commonRxWeightFemale ?? undefined,
    videoUrl: row.videoUrl,
  };
}

// ============================================
// useMovements
// ============================================

interface MovementsFilters {
  q?: string;
}

export function useMovements(filters: MovementsFilters = {}) {
  return useQuery({
    queryKey: ["movements", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.q) params.set("q", filters.q);
      const qs = params.toString();
      const res = await fetch(`/api/movements${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed to fetch movements");
      const rows = (await res.json()) as MovementRow[];
      return rows.map(toMovementOption);
    },
    staleTime: 5 * 60 * 1000, // movements change rarely
    // Each distinct `q` is its own cache entry. Without this, every search
    // keystroke drops `data` to `undefined` until the new fetch resolves —
    // leaving the picker with no real movements to offer mid-search. Keeping
    // the previous results means the list always holds saveable rows.
    placeholderData: keepPreviousData,
  });
}

// ============================================
// useRecentMovements — IDs of movements the caller has used in their own
// workouts, most-recent first. Used by the picker to surface frequent picks.
// ============================================

export function useRecentMovements() {
  return useQuery({
    queryKey: ["movements", "recent"],
    queryFn: async () => {
      const res = await fetch("/api/movements/recent");
      if (!res.ok) throw new Error("Failed to fetch recent movements");
      return (await res.json()) as string[];
    },
    staleTime: 60 * 1000,
  });
}

// ============================================
// useCreateMovement — user-scoped custom movement
// ============================================

export interface CreateMovementInput {
  canonicalName: string;
  category?: MovementCategory;
  isWeighted?: boolean;
  metricType?: MovementMetricType;
  supportedMetricTypes?: MovementMetricType[];
  rxFields?: RxField[];
  rxDefaults?: RxDefaults;
}

export function useCreateMovement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateMovementInput): Promise<MovementOption> => {
      const res = await fetch("/api/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      // 409 with a movementId means a system movement already owns the name —
      // unwrap so the caller can reuse the existing row silently. Search every
      // cached movements query (different `q` filters live under different
      // keys) so we still find the row when the picker is filtering.
      if (res.status === 409) {
        const body = await res.json().catch(() => null);
        if (body?.movementId) {
          const cached = queryClient.getQueriesData<MovementOption[]>({
            queryKey: ["movements"],
          });
          for (const [, list] of cached) {
            const existing = list?.find((m) => m.id === body.movementId);
            if (existing) return existing;
          }
        }
        throw new Error(body?.error || "Movement already exists");
      }

      if (!res.ok && res.status !== 200) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to create movement");
      }

      const row = (await res.json()) as MovementRow;
      return toMovementOption(row);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["movements"] });
    },
  });
}
