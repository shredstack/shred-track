import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { NotificationDisplay } from "@/types/social";

interface NotificationsPage {
  items: NotificationDisplay[];
  nextCursor: string | null;
}

export function useNotifications(options?: { enabled?: boolean }) {
  return useInfiniteQuery<NotificationsPage>({
    queryKey: ["notifications", "list"],
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (typeof pageParam === "string") params.set("cursor", pageParam);
      const res = await fetch(
        `/api/notifications${params.size > 0 ? `?${params.toString()}` : ""}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to load notifications");
      }
      return res.json() as Promise<NotificationsPage>;
    },
    enabled: options?.enabled ?? true,
  });
}

// Polls every 60s (only when this hook is mounted — the header bell is
// the only consumer right now, and it stays mounted across the app).
export function useUnreadNotificationCount() {
  return useQuery<{ count: number }>({
    queryKey: ["notifications", "unread-count"],
    queryFn: async () => {
      const res = await fetch("/api/notifications/unread-count");
      if (!res.ok) return { count: 0 };
      return res.json();
    },
    refetchInterval: 60_000,
    // Don't burn cycles when the tab is hidden.
    refetchIntervalInBackground: false,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/notifications/${id}/read`, {
        method: "PATCH",
      });
      if (!res.ok && res.status !== 204) {
        throw new Error("Failed to mark read");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications", "unread-count"] });
      qc.invalidateQueries({ queryKey: ["notifications", "list"] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/notifications/read-all`, {
        method: "PATCH",
      });
      if (!res.ok && res.status !== 204) {
        throw new Error("Failed to mark all read");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications", "unread-count"] });
      qc.invalidateQueries({ queryKey: ["notifications", "list"] });
    },
  });
}
