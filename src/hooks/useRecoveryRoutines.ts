import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { RecoveryRoutine, RecoveryPrescription } from "@/types/recovery";

export function useRecoveryRoutines() {
  return useQuery<RecoveryRoutine[]>({
    queryKey: ["recovery-routines"],
    queryFn: async () => {
      const res = await fetch("/api/recovery/routines");
      if (!res.ok) throw new Error("Failed to load routines");
      return res.json();
    },
    staleTime: 60_000,
  });
}

export function useRecoveryRoutine(id: string | null) {
  return useQuery<RecoveryRoutine>({
    queryKey: ["recovery-routine", id],
    queryFn: async () => {
      const res = await fetch(`/api/recovery/routines/${id}`);
      if (!res.ok) throw new Error("Failed to load routine");
      return res.json();
    },
    enabled: !!id,
  });
}

export interface CreateRoutineInput {
  name: string;
  description?: string;
  communityId?: string | null;
  movements: Array<{
    movementId: string;
    orderIndex?: number;
    prescription?: RecoveryPrescription;
    notes?: string;
  }>;
}

export function useCreateRecoveryRoutine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateRoutineInput): Promise<RecoveryRoutine> => {
      const res = await fetch("/api/recovery/routines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error("Failed to create routine");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recovery-routines"] }),
  });
}

export function useUpdateRecoveryRoutine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      data: Partial<CreateRoutineInput>;
    }) => {
      const res = await fetch(`/api/recovery/routines/${input.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input.data),
      });
      if (!res.ok) throw new Error("Failed to update routine");
      return res.json();
    },
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: ["recovery-routines"] });
      qc.invalidateQueries({ queryKey: ["recovery-routine", input.id] });
    },
  });
}

export function useDeleteRecoveryRoutine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/recovery/routines/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recovery-routines"] }),
  });
}
