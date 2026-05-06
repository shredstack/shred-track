import { useQuery } from "@tanstack/react-query";

export interface GymMemberRow {
  membershipId: string;
  userId: string;
  isAdmin: boolean;
  isCoach: boolean;
  isActive: boolean;
  joinedAt: string;
  deactivatedAt: string | null;
  name: string;
  email: string;
}

/**
 * Fetches the membership list for a community. Server gates the call to
 * coaches/admins (`canProgramForGym`), so this hook will 403 for anyone
 * else — render conditionally.
 */
export function useGymMembers(communityId: string | null) {
  return useQuery<GymMemberRow[]>({
    queryKey: ["gym-members", communityId],
    enabled: !!communityId,
    queryFn: async () => {
      const res = await fetch(`/api/communities/${communityId}/members`);
      if (!res.ok) throw new Error("Failed to fetch members");
      return res.json();
    },
  });
}
