import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// General user profile
// ---------------------------------------------------------------------------

export interface UserProfile {
  id: string;
  name: string;
  username: string | null;
  email: string;
  gender: string | null;
  unitPreference: string;
  // Pounds. Used to resolve "1.5× BW" Rx prescriptions to a concrete
  // weight; null means BW prescriptions display symbolically.
  bodyWeightLb: number | null;
  image: string | null;
  isAdmin: boolean;
  isVip: boolean;
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
    mutationFn: async (data: {
      name?: string;
      username?: string | null;
      gender?: "male" | "female" | "other" | null;
      bodyWeightLb?: number | null;
    }) => {
      const res = await fetch("/api/user/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to update profile");
      }
      return res.json() as Promise<UserProfile>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-profile"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Avatar upload / delete
// ---------------------------------------------------------------------------

export function useUploadAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (blob: Blob) => {
      // Step 1: ask the API for a signed upload URL + the eventual public URL.
      const issueRes = await fetch("/api/user/profile/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "upload" }),
      });
      if (!issueRes.ok) {
        const body = await issueRes.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to start avatar upload");
      }
      const issued: {
        storagePath: string;
        uploadUrl: string;
        token: string;
        publicUrl: string;
      } = await issueRes.json();

      // Step 2: PUT the compressed JPEG to storage. Lazy-import the
      // browser supabase client so other pages don't pull it in.
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { error: uploadErr } = await supabase.storage
        .from("avatars")
        .uploadToSignedUrl(issued.storagePath, issued.token, blob, {
          contentType: "image/jpeg",
        });
      if (uploadErr) throw uploadErr;

      // Step 3: finalize — writes users.image and deletes the prior object.
      const finalizeRes = await fetch("/api/user/profile/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "finalize", storagePath: issued.storagePath }),
      });
      if (!finalizeRes.ok) {
        const body = await finalizeRes.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to finalize avatar");
      }
      return (await finalizeRes.json()) as { image: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-profile"] });
    },
  });
}

export function useDeleteAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/user/profile/avatar", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove avatar");
      return (await res.json()) as { image: null };
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
