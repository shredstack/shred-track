import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  RecoverySchedule,
  RecoveryScheduleKind,
  RecoveryAssignment,
  RecoveryPrescription,
} from "@/types/recovery";

export function useRecoverySchedules() {
  return useQuery<RecoverySchedule[]>({
    queryKey: ["recovery-schedules"],
    queryFn: async () => {
      const res = await fetch("/api/recovery/schedules");
      if (!res.ok) throw new Error("Failed to load schedules");
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useRecoverySchedule(id: string | null) {
  return useQuery<RecoverySchedule>({
    queryKey: ["recovery-schedule", id],
    queryFn: async () => {
      const res = await fetch(`/api/recovery/schedules/${id}`);
      if (!res.ok) throw new Error("Failed to load schedule");
      return res.json();
    },
    enabled: !!id,
  });
}

export interface CreateScheduleInput {
  name: string;
  kind: RecoveryScheduleKind;
  rotationDays?: number;
  weeklyTarget?: number;
  description?: string;
  communityId?: string | null;
  rotationStrategy?: "progress" | "calendar";
  isActive?: boolean;
  activeDaysOfWeek?: number[] | null;
  intervalDays?: number | null;
  intervalStartsOn?: string | null;
  slots: Array<{
    dayIndex?: number | null;
    orderIndex?: number;
    movementId?: string | null;
    routineId?: string | null;
    prescription?: RecoveryPrescription;
    notes?: string | null;
  }>;
}

export function useCreateRecoverySchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateScheduleInput): Promise<RecoverySchedule> => {
      const res = await fetch("/api/recovery/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to create schedule");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recovery-schedules"] });
      qc.invalidateQueries({ queryKey: ["recovery-today"] });
    },
  });
}

export function useUpdateRecoverySchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; data: Partial<CreateScheduleInput> & { isArchived?: boolean; isActive?: boolean; activeDaysOfWeek?: number[] | null } }) => {
      const res = await fetch(`/api/recovery/schedules/${input.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input.data),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: ["recovery-schedules"] });
      qc.invalidateQueries({ queryKey: ["recovery-schedule", input.id] });
      // Active/days toggle changes which schedules show in the today view.
      qc.invalidateQueries({ queryKey: ["recovery-today"] });
    },
  });
}

export function useDeleteRecoverySchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/recovery/schedules/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recovery-schedules"] });
      qc.invalidateQueries({ queryKey: ["recovery-today"] });
    },
  });
}

// ============================================
// Assignments
// ============================================

export function useRecoveryAssignments(scheduleId: string | null) {
  return useQuery<RecoveryAssignment[]>({
    queryKey: ["recovery-assignments", scheduleId],
    queryFn: async () => {
      const res = await fetch(`/api/recovery/schedules/${scheduleId}/assignments`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: !!scheduleId,
  });
}

export interface CreateAssignmentInput {
  scheduleId: string;
  userId?: string | null;
  communityId?: string | null;
  startsOn: string;
  endsOn?: string | null;
  durationLabel?: string | null;
}

export function useCreateAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateAssignmentInput) => {
      const res = await fetch(`/api/recovery/schedules/${input.scheduleId}/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to assign");
      }
      return res.json();
    },
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: ["recovery-assignments", input.scheduleId] });
      qc.invalidateQueries({ queryKey: ["recovery-today"] });
    },
  });
}

export function useDeleteAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { scheduleId: string; assignmentId: string }) => {
      const res = await fetch(
        `/api/recovery/schedules/${input.scheduleId}/assignments/${input.assignmentId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: ["recovery-assignments", input.scheduleId] });
    },
  });
}

export function useUpdateMyOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      assignmentId: string;
      startsOn?: string | null;
      endsOn?: string | null;
      isDismissed?: boolean;
    }) => {
      const res = await fetch(`/api/recovery/assignments/${input.assignmentId}/my-override`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recovery-today"] });
      qc.invalidateQueries({ queryKey: ["recovery-dismissed-assignments"] });
    },
  });
}

export interface DismissedAssignment {
  assignmentId: string;
  scheduleId: string;
  scheduleName: string | null;
  communityId: string | null;
  communityName: string | null;
  startsOn: string;
  endsOn: string | null;
  durationLabel: string | null;
  isGymWide: boolean;
  dismissedAt: string;
}

export function useDismissedAssignments() {
  return useQuery<DismissedAssignment[]>({
    queryKey: ["recovery-dismissed-assignments"],
    queryFn: async () => {
      const res = await fetch("/api/recovery/assignments/dismissed");
      if (!res.ok) throw new Error("Failed to load dismissed assignments");
      return res.json();
    },
    staleTime: 30_000,
  });
}
