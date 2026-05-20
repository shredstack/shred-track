// React Query wrapper for /api/family endpoints.

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface FamilyMemberDTO {
  familyMemberId: string;
  communityId: string;
  relationship:
    | "spouse"
    | "partner"
    | "child"
    | "parent"
    | "sibling"
    | "other";
  hasOwnLogin: boolean;
  notes: string | null;
  createdAt: string;
  dependent: {
    id: string;
    name: string;
    email: string;
    isShadow: boolean;
    dateOfBirth: string | null;
    gender: string | null;
  };
  age: number | null;
  isMinor: boolean;
  isShadowEmail: boolean;
}

export function familyQueryKey(communityId: string | null | undefined) {
  return ["family", communityId ?? ""];
}

export function useFamily(communityId: string | null | undefined) {
  return useQuery<{ dependents: FamilyMemberDTO[] }>({
    queryKey: familyQueryKey(communityId),
    queryFn: async () => {
      const res = await fetch(`/api/family?communityId=${communityId}`);
      if (!res.ok) throw new Error("Failed to load family");
      return res.json();
    },
    enabled: !!communityId,
  });
}

export interface AddFamilyMemberInput {
  communityId: string;
  firstName: string;
  lastName?: string;
  dateOfBirth?: string;
  gender?: "male" | "female" | "other";
  relationship: FamilyMemberDTO["relationship"];
  email?: string;
  hasOwnLogin: boolean;
  notes?: string;
}

export function useAddFamilyMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddFamilyMemberInput) => {
      const res = await fetch("/api/family", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to add family member");
      }
      return data as
        | { status: "shadow_created"; familyMemberId: string; dependentUserId: string }
        | { status: "consent_invite_sent"; inviteeUserId: string };
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: familyQueryKey(variables.communityId) });
    },
  });
}

export interface EditFamilyMemberInput {
  familyMemberId: string;
  communityId: string;
  firstName?: string;
  lastName?: string | null;
  dateOfBirth?: string | null;
  gender?: "male" | "female" | "other" | null;
  relationship?: FamilyMemberDTO["relationship"];
  email?: string | null;
  notes?: string | null;
}

export function useEditFamilyMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      familyMemberId,
      communityId,
      ...patch
    }: EditFamilyMemberInput) => {
      const res = await fetch(`/api/family/${familyMemberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to update");
      // Touch communityId so onSuccess can invalidate.
      void communityId;
      return data;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: familyQueryKey(variables.communityId) });
    },
  });
}

export function useRemoveFamilyMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      familyMemberId,
      communityId,
    }: {
      familyMemberId: string;
      communityId: string;
    }) => {
      const res = await fetch(`/api/family/${familyMemberId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to remove");
      void communityId;
      return data;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: familyQueryKey(variables.communityId) });
    },
  });
}

export function useSendActivationInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      familyMemberId,
      communityId,
    }: {
      familyMemberId: string;
      communityId: string;
    }) => {
      const res = await fetch(`/api/family/${familyMemberId}/invite`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to send invite");
      void communityId;
      return data as { sentTo: string; expiresAt: string };
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: familyQueryKey(variables.communityId) });
    },
  });
}

export function useLogForCandidates(communityId: string | null | undefined) {
  return useQuery<{
    candidates: Array<{ userId: string; name: string }>;
  }>({
    queryKey: ["family", "log-for-candidates", communityId ?? ""],
    queryFn: async () => {
      const res = await fetch(
        `/api/family/log-for-candidates?communityId=${communityId}`
      );
      if (!res.ok) throw new Error("Failed to load candidates");
      return res.json();
    },
    enabled: !!communityId,
    staleTime: 60_000,
  });
}
