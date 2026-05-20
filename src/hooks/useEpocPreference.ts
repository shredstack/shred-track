import { useQuery } from "@tanstack/react-query";
import { useUserProfile } from "./useProfile";

interface CommunityCaloriePrefs {
  epocDefaultEnabled: boolean;
  epocMultiplier: number;
}

function useCommunityCaloriePrefs(communityId: string | null | undefined) {
  return useQuery({
    queryKey: ["community", communityId, "calorie-preferences"],
    enabled: !!communityId,
    queryFn: async () => {
      const res = await fetch(
        `/api/communities/${communityId}/calorie-preferences`
      );
      if (!res.ok) throw new Error("Failed to fetch calorie preferences");
      return (await res.json()) as CommunityCaloriePrefs;
    },
  });
}

/**
 * Resolves the effective EPOC display preference per the spec cascade:
 *   1. user.epocEnabled if non-null → community's epocDefaultEnabled
 *      (true = community's multiplier > 1, false = strip EPOC)
 *   2. user.epocEnabled === null → community's epocDefaultEnabled
 *   3. solo (no community) → user pref, defaulting to enabled
 *
 * Returns `true` when the UI should display the `*WithEpoc` flavor.
 */
export function useEffectiveEpocEnabled(
  communityId: string | null | undefined
): boolean {
  const { data: profile } = useUserProfile();
  const { data: communityPrefs } = useCommunityCaloriePrefs(communityId);

  if (profile?.epocEnabled === true) return true;
  if (profile?.epocEnabled === false) return false;
  if (communityId) return communityPrefs?.epocDefaultEnabled ?? true;
  return true;
}
