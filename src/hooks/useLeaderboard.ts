import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LeaderboardEntry } from "@/types/crossfit";

export interface LeaderboardResponse {
  parts: Record<string, LeaderboardEntry[]>;
}

export function useLeaderboard(
  workoutId: string | null,
  options?: { enabled?: boolean }
) {
  return useQuery<LeaderboardResponse>({
    queryKey: ["leaderboard", workoutId],
    queryFn: async () => {
      const res = await fetch(`/api/workouts/${workoutId}/leaderboard`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to load leaderboard");
      }
      return res.json();
    },
    enabled: !!workoutId && (options?.enabled ?? true),
    // 30s refetchInterval gives a real-time-ish feel without a websocket.
    // The sheet only mounts when a workout is selected, so this isn't
    // hot anywhere else.
    refetchInterval: 30_000,
  });
}

// Toggle the 🔥 reaction on a score. Optimistic: flips viewerReacted and
// nudges reactionCount in every cached leaderboard so the UI feels instant.
// Variables include `workoutId` so we know which cache entry to patch
// without scanning every leaderboard query.
export function useToggleReaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      scoreId,
      currentlyReacted,
    }: {
      scoreId: string;
      workoutId: string;
      currentlyReacted: boolean;
    }) => {
      const method = currentlyReacted ? "DELETE" : "POST";
      const url = currentlyReacted
        ? `/api/scores/${scoreId}/reactions?reaction=fire`
        : `/api/scores/${scoreId}/reactions`;
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: currentlyReacted
          ? undefined
          : JSON.stringify({ reaction: "fire" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to update reaction");
      }
    },
    onMutate: async ({ scoreId, workoutId, currentlyReacted }) => {
      await qc.cancelQueries({ queryKey: ["leaderboard", workoutId] });
      const prev = qc.getQueryData<LeaderboardResponse>([
        "leaderboard",
        workoutId,
      ]);
      if (prev) {
        const next: LeaderboardResponse = {
          parts: Object.fromEntries(
            Object.entries(prev.parts).map(([partId, entries]) => [
              partId,
              entries.map((e) =>
                e.scoreId === scoreId
                  ? {
                      ...e,
                      viewerReacted: !currentlyReacted,
                      reactionCount: Math.max(
                        e.reactionCount + (currentlyReacted ? -1 : 1),
                        0
                      ),
                    }
                  : e
              ),
            ])
          ),
        };
        qc.setQueryData(["leaderboard", workoutId], next);
      }
      return { prev };
    },
    onError: (_err, vars, context) => {
      if (context?.prev) {
        qc.setQueryData(["leaderboard", vars.workoutId], context.prev);
      }
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: ["leaderboard", vars.workoutId] });
    },
  });
}
