import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { pushTodaySnapshotToWatch } from "@/lib/native/today-snapshot";
import type { RecoverySession, RecoverySessionItem } from "@/types/recovery";
import type { RecoveryToday } from "@/lib/recovery/today-resolver";

export interface RecoveryTodayEntry extends RecoveryToday {
  session: {
    id: string;
    status: string;
    items: Array<RecoverySessionItem & { movementName?: string; isPerSide?: boolean }>;
  } | null;
}

export function useRecoveryToday(date: string, prefer: "personal" | "gym" = "personal") {
  return useQuery<RecoveryTodayEntry[]>({
    queryKey: ["recovery-today", date, prefer],
    queryFn: async () => {
      const res = await fetch(`/api/recovery/sessions?date=${date}&prefer=${prefer}`);
      if (!res.ok) throw new Error("Failed to load today");
      return res.json();
    },
  });
}

export function useStartRecoverySession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { date: string; prefer?: "personal" | "gym"; scheduleId?: string }) => {
      const res = await fetch("/api/recovery/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to start session");
      }
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recovery-today"] }),
  });
}

export function useUpdateRecoverySession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      status?: "in_progress" | "complete" | "skipped";
      notes?: string | null;
      items?: Array<{
        id: string;
        status?: "pending" | "done" | "skipped";
        actual?: Record<string, unknown>;
        notes?: string | null;
      }>;
    }) => {
      const res = await fetch(`/api/recovery/sessions/${input.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error("Failed to update session");
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["recovery-today"] });
      qc.invalidateQueries({ queryKey: ["recovery-history"] });
      // Only push to Watch when the session was completed — partial
      // updates (item-level toggles) don't move the Today "logged" pill.
      if (vars.status === "complete") {
        void pushTodaySnapshotToWatch();
      }
    },
  });
}

export function useCancelRecoverySession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/recovery/sessions/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to cancel session");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recovery-today"] });
      qc.invalidateQueries({ queryKey: ["recovery-history"] });
    },
  });
}

export function useRecoveryHistory(startDate: string, endDate: string) {
  return useQuery<RecoverySession[]>({
    queryKey: ["recovery-history", startDate, endDate],
    queryFn: async () => {
      const res = await fetch(
        `/api/recovery/sessions?startDate=${startDate}&endDate=${endDate}`
      );
      if (!res.ok) throw new Error("Failed to load history");
      return res.json();
    },
  });
}
