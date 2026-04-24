import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  MovementOption,
  MovementCategory,
} from "@/types/crossfit";

// ============================================
// API response shape (from /api/movements)
// ============================================

interface MovementRow {
  id: string;
  canonicalName: string;
  category: string;
  isWeighted: boolean;
  is1rmApplicable: boolean;
  commonRxWeightMale: string | null;
  commonRxWeightFemale: string | null;
  videoUrl: string | null;
  createdBy: string | null;
}

function toMovementOption(row: MovementRow): MovementOption {
  return {
    id: row.id,
    canonicalName: row.canonicalName,
    category: row.category as MovementCategory,
    isWeighted: row.isWeighted,
    is1rmApplicable: row.is1rmApplicable,
    commonRxWeightMale: row.commonRxWeightMale ?? undefined,
    commonRxWeightFemale: row.commonRxWeightFemale ?? undefined,
    videoUrl: row.videoUrl,
  };
}

// ============================================
// useMovements
// ============================================

export function useMovements() {
  return useQuery({
    queryKey: ["movements"],
    queryFn: async () => {
      const res = await fetch("/api/movements");
      if (!res.ok) throw new Error("Failed to fetch movements");
      const rows = (await res.json()) as MovementRow[];
      return rows.map(toMovementOption);
    },
    staleTime: 5 * 60 * 1000, // movements change rarely
  });
}

// ============================================
// useCreateMovement — user-scoped custom movement
// ============================================

export interface CreateMovementInput {
  canonicalName: string;
  category?: MovementCategory;
  isWeighted?: boolean;
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
      // unwrap so the caller can reuse the existing row silently.
      if (res.status === 409) {
        const body = await res.json().catch(() => null);
        if (body?.movementId) {
          const list = queryClient.getQueryData<MovementOption[]>(["movements"]);
          const existing = list?.find((m) => m.id === body.movementId);
          if (existing) return existing;
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
