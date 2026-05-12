import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  CommentAttachment,
  CommentDisplay,
  MentionMember,
} from "@/types/social";

export interface CommentsResponse {
  comments: CommentDisplay[];
}

export function useScoreComments(
  scoreId: string | null,
  options?: { enabled?: boolean }
) {
  return useQuery<CommentsResponse>({
    queryKey: ["comments", scoreId],
    queryFn: async () => {
      const res = await fetch(`/api/scores/${scoreId}/comments`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to load comments");
      }
      return res.json();
    },
    enabled: !!scoreId && (options?.enabled ?? true),
  });
}

export interface CreateCommentInput {
  scoreId: string;
  workoutId: string;
  body: string;
  mentionedUserIds: string[];
  attachment?: CommentAttachment | null;
}

export function useCreateComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCommentInput) => {
      const res = await fetch(`/api/scores/${input.scoreId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: input.body,
          mentionedUserIds: input.mentionedUserIds,
          attachment: input.attachment ?? undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to post comment");
      }
      return (await res.json()) as { commentId: string };
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["comments", vars.scoreId] });
      qc.invalidateQueries({ queryKey: ["leaderboard", vars.workoutId] });
    },
  });
}

export function useDeleteComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      scoreId: string;
      workoutId: string;
      commentId: string;
    }) => {
      const res = await fetch(
        `/api/scores/${input.scoreId}/comments/${input.commentId}`,
        { method: "DELETE" }
      );
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to delete comment");
      }
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["comments", vars.scoreId] });
      qc.invalidateQueries({ queryKey: ["leaderboard", vars.workoutId] });
    },
  });
}

export interface MentionSearchResponse {
  members: MentionMember[];
}

export function useMentionSearch(
  communityId: string | null,
  query: string,
  options?: { enabled?: boolean }
) {
  return useQuery<MentionSearchResponse>({
    queryKey: ["mention-search", communityId, query],
    queryFn: async () => {
      const params = new URLSearchParams({ q: query, limit: "10" });
      const res = await fetch(
        `/api/communities/${communityId}/mention-search?${params.toString()}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to search members");
      }
      const json = await res.json();
      // Server returns { members: [...] } with `userId, name, username, image`.
      return {
        members: (json.members as Array<{
          userId: string;
          name: string;
          username: string | null;
          image: string | null;
        }>).map((m) => ({
          userId: m.userId,
          name: m.name,
          username: m.username,
        })),
      };
    },
    enabled:
      !!communityId &&
      (options?.enabled ?? true),
    staleTime: 30_000,
  });
}
