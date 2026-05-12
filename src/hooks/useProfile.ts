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

// Wraps a step in the avatar upload pipeline so a failure surfaces *which*
// step failed (issue / upload / finalize) instead of a bare "Load failed".
// The original cause is preserved both via `Error.cause` and a console.error
// so we can grab it from Safari Web Inspector on a phone.
async function runStep<T>(step: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[avatar upload] step "${step}" failed`, err);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${step}: ${message}`, { cause: err });
  }
}

export function useUploadAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (blob: Blob) => {
      // Step 1: ask the API for a signed upload URL + the eventual public URL.
      const issued = await runStep("issue signed URL", async () => {
        const res = await fetch("/api/user/profile/avatar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "upload" }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        return (await res.json()) as {
          storagePath: string;
          uploadUrl: string;
          token: string;
          publicUrl: string;
        };
      });

      // Step 2: PUT the compressed JPEG to storage. Lazy-import the
      // browser supabase client so other pages don't pull it in.
      await runStep("upload to storage", async () => {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();
        const { error } = await supabase.storage
          .from("avatars")
          .uploadToSignedUrl(issued.storagePath, issued.token, blob, {
            contentType: "image/jpeg",
          });
        if (error) throw error;
      });

      // Step 3: finalize — writes users.image and deletes the prior object.
      return runStep("finalize", async () => {
        const res = await fetch("/api/user/profile/avatar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "finalize", storagePath: issued.storagePath }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        return (await res.json()) as { image: string };
      });
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
