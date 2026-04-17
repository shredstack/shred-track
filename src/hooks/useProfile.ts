import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// General user profile
// ---------------------------------------------------------------------------

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  gender: string | null;
  unitPreference: string;
  createdAt: string;
}

export function useUserProfile() {
  return useQuery({
    queryKey: ["user-profile"],
    queryFn: async () => {
      const res = await fetch("/api/user/profile");
      if (!res.ok) throw new Error("Failed to fetch user profile");
      return res.json() as Promise<UserProfile>;
    },
  });
}

export function useUpdateUserProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string }) => {
      const res = await fetch("/api/user/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update profile");
      return res.json() as Promise<UserProfile>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-profile"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Full HYROX profile (all onboarding fields + assessments)
// ---------------------------------------------------------------------------

export interface StationAssessment {
  station: string;
  completionConfidence: number;
  currentTimeSeconds: number | null;
  goalTimeSeconds: number | null;
}

export interface FullHyroxProfile {
  id: string;
  name: string | null;
  gender: string | null;
  preferredUnits: string | null;
  targetDivision: string;
  nextRaceDate: string | null;
  goalFinishTimeSeconds: number | null;
  easyPaceSecondsPerUnit: number | null;
  moderatePaceSecondsPerUnit: number | null;
  fastPaceSecondsPerUnit: number | null;
  recent5kTimeSeconds: number | null;
  recent800mRepeatSeconds: number | null;
  paceUnit: string;
  previousRaceCount: number;
  bestFinishTimeSeconds: number | null;
  bestDivision: string | null;
  bestTimeNotes: string | null;
  crossfitDaysPerWeek: number | null;
  crossfitGymName: string | null;
  availableEquipment: string[];
  injuriesNotes: string | null;
  trainingPhilosophy: string | null;
  assessments: StationAssessment[];
}

export function useFullHyroxProfile() {
  return useQuery({
    queryKey: ["hyrox-profile-full"],
    queryFn: async () => {
      const res = await fetch("/api/hyrox/profile");
      if (!res.ok) throw new Error("Failed to fetch HYROX profile");
      return res.json() as Promise<FullHyroxProfile | null>;
    },
  });
}

export function useUpdateHyroxProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<Omit<FullHyroxProfile, "id" | "assessments">>) => {
      const res = await fetch("/api/hyrox/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update HYROX profile");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hyrox-profile-full"] });
      queryClient.invalidateQueries({ queryKey: ["hyrox-profile"] });
    },
  });
}

export function useUpdateStationAssessments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (assessments: StationAssessment[]) => {
      const res = await fetch("/api/hyrox/profile/assessments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assessments }),
      });
      if (!res.ok) throw new Error("Failed to update assessments");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hyrox-profile-full"] });
    },
  });
}
