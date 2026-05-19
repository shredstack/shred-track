"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface GymPostListItem {
  id: string;
  kind: string;
  body: string | null;
  workoutId: string | null;
  workoutDate: string | null;
  isPinned: boolean;
  publishedAt: string;
  author: { id: string; name: string; image: string | null };
  attachments: Array<{
    id: string;
    kind: string;
    url: string;
    thumbnailUrl: string | null;
    width: number | null;
    height: number | null;
  }>;
  reactionCount: number;
  commentCount: number;
  viewerReacted: boolean;
}

export function useGymPosts(communityId: string | null) {
  return useQuery<{ posts: GymPostListItem[] }>({
    queryKey: ["gym", communityId, "social", "feed"],
    enabled: !!communityId,
    queryFn: async () => {
      const res = await fetch(`/api/gym/${communityId}/posts`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });
}

export function useCreateGymPost(communityId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      kind: string;
      body?: string;
      workoutId?: string;
      workoutDate?: string;
      attachments?: Array<{
        kind: string;
        url: string;
        thumbnailUrl?: string;
        width?: number;
        height?: number;
      }>;
    }) => {
      const res = await fetch(`/api/gym/${communityId}/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        throw new Error(e?.error || "Failed to post");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["gym", communityId, "social", "feed"],
      });
    },
  });
}

export function useTogglePostReaction(communityId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      postId,
      isOn,
    }: {
      postId: string;
      isOn: boolean;
    }) => {
      if (isOn) {
        await fetch(`/api/gym-posts/${postId}/reactions?reaction=fire`, {
          method: "DELETE",
        });
      } else {
        await fetch(`/api/gym-posts/${postId}/reactions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reaction: "fire" }),
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["gym", communityId, "social", "feed"],
      });
    },
  });
}

export function usePostComments(postId: string | null) {
  return useQuery({
    queryKey: ["gym-post", postId, "comments"],
    enabled: !!postId,
    queryFn: async () => {
      const res = await fetch(`/api/gym-posts/${postId}/comments`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });
}

export function useCreatePostComment(postId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) => {
      const res = await fetch(`/api/gym-posts/${postId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gym-post", postId, "comments"] });
    },
  });
}
