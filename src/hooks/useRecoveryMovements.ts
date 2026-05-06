import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  RecoveryMovement,
  RecoveryVideo,
  RecoveryCategory,
  RecoveryBodyRegion,
  RecoveryVisibility,
} from "@/types/recovery";

interface ListFilters {
  q?: string;
  category?: RecoveryCategory;
  pendingOnly?: boolean;
  mineOnly?: boolean;
  bodyRegion?: RecoveryBodyRegion;
}

export function useRecoveryMovements(filters: ListFilters = {}) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.category) params.set("category", filters.category);
  if (filters.pendingOnly) params.set("pending", "true");
  if (filters.mineOnly) params.set("mine", "true");
  if (filters.bodyRegion) params.set("bodyRegion", filters.bodyRegion);

  return useQuery<RecoveryMovement[]>({
    queryKey: ["recovery-movements", filters],
    queryFn: async () => {
      const res = await fetch(`/api/recovery/movements?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load movements");
      return res.json();
    },
    staleTime: 60_000,
  });
}

export function useRecoveryMovement(id: string | null) {
  return useQuery<RecoveryMovement & { videos: RecoveryVideo[] }>({
    queryKey: ["recovery-movement", id],
    queryFn: async () => {
      const res = await fetch(`/api/recovery/movements/${id}`);
      if (!res.ok) throw new Error("Failed to load movement");
      return res.json();
    },
    enabled: !!id,
  });
}

export interface CreateRecoveryMovementInput {
  canonicalName: string;
  category: RecoveryCategory;
  bodyRegion?: RecoveryBodyRegion[];
  description?: string;
  isPerSide?: boolean;
  defaultPrescription?: Record<string, unknown>;
}

export function useCreateRecoveryMovement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateRecoveryMovementInput): Promise<RecoveryMovement> => {
      const res = await fetch("/api/recovery/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok && res.status !== 200) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to create movement");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recovery-movements"] });
    },
  });
}

export function useValidateRecoveryMovement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/recovery/movements/${id}/validate`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to validate");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recovery-movements"] });
      qc.invalidateQueries({ queryKey: ["recovery-movement"] });
    },
  });
}

export function useDeleteRecoveryMovement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/recovery/movements/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Delete failed");
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recovery-movements"] }),
  });
}

// ============================================
// Videos
// ============================================

export function useRecoveryMovementVideos(movementId: string | null) {
  return useQuery<RecoveryVideo[]>({
    queryKey: ["recovery-videos", movementId],
    queryFn: async () => {
      const res = await fetch(`/api/recovery/movements/${movementId}/videos`);
      if (!res.ok) throw new Error("Failed to load videos");
      return res.json();
    },
    enabled: !!movementId,
  });
}

export interface AddExternalVideoInput {
  movementId: string;
  externalUrl: string;
  visibility: RecoveryVisibility;
  communityId?: string | null;
  label?: string;
  rightsConfirmed: boolean;
}

export function useAddExternalVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddExternalVideoInput) => {
      const res = await fetch(`/api/recovery/movements/${input.movementId}/videos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "external", ...input }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to add video");
      }
      return res.json();
    },
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: ["recovery-videos", input.movementId] });
      qc.invalidateQueries({ queryKey: ["recovery-movement", input.movementId] });
      qc.invalidateQueries({ queryKey: ["recovery-movements"] });
    },
  });
}

export interface UploadRecoveryVideoInput {
  movementId: string;
  file: File;
  visibility: RecoveryVisibility;
  communityId?: string | null;
  label?: string;
  durationSeconds?: number;
  rightsConfirmed: boolean;
}

/**
 * Three-step direct-to-storage upload:
 *   1. POST /videos {kind:'upload'} → signed URL + token
 *   2. supabase.storage.uploadToSignedUrl()
 *   3. POST /videos {kind:'register'} → final row
 *
 * Each step is awaited in sequence; if step 2 fails the row is never
 * registered (no orphan DB row). If step 3 fails the storage object is
 * orphaned — the nightly storage GC job sweeps those.
 */
export function useUploadRecoveryVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UploadRecoveryVideoInput) => {
      const ext = input.file.type === "video/quicktime" ? "mov" : "mp4";

      // Step 1: signed upload URL.
      const issueRes = await fetch(
        `/api/recovery/movements/${input.movementId}/videos`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "upload",
            visibility: input.visibility,
            communityId: input.communityId ?? null,
            fileExt: ext,
          }),
        }
      );
      if (!issueRes.ok) {
        const body = await issueRes.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to start upload");
      }
      const issued: {
        videoId: string;
        storagePath: string;
        uploadUrl: string;
        token: string;
      } = await issueRes.json();

      // Step 2: PUT the file. Lazy-import the browser client so the hook
      // doesn't pull supabase into pages that never upload videos.
      const { createClient } = await import("@/lib/supabase/client");
      const { RECOVERY_BUCKET } = await import("@/lib/recovery/storage");
      const supabase = createClient();
      const { error: uploadErr } = await supabase.storage
        .from(RECOVERY_BUCKET)
        .uploadToSignedUrl(issued.storagePath, issued.token, input.file, {
          contentType: input.file.type,
        });
      if (uploadErr) throw uploadErr;

      // Step 3: register the row.
      const registerRes = await fetch(
        `/api/recovery/movements/${input.movementId}/videos`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "register",
            videoId: issued.videoId,
            storagePath: issued.storagePath,
            visibility: input.visibility,
            communityId: input.communityId ?? null,
            label: input.label,
            durationSeconds: input.durationSeconds,
            rightsConfirmed: input.rightsConfirmed,
          }),
        }
      );
      if (!registerRes.ok) {
        const body = await registerRes.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to register video");
      }
      return registerRes.json();
    },
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: ["recovery-videos", input.movementId] });
      qc.invalidateQueries({ queryKey: ["recovery-movement", input.movementId] });
      qc.invalidateQueries({ queryKey: ["recovery-movements"] });
    },
  });
}

export function useDeleteRecoveryVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { movementId: string; videoId: string }) => {
      const res = await fetch(
        `/api/recovery/movements/${input.movementId}/videos/${input.videoId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to delete video");
    },
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: ["recovery-videos", input.movementId] });
      qc.invalidateQueries({ queryKey: ["recovery-movement", input.movementId] });
    },
  });
}

export async function fetchVideoPlaybackUrl(movementId: string, videoId: string) {
  const res = await fetch(`/api/recovery/movements/${movementId}/videos/${videoId}`);
  if (!res.ok) throw new Error("Failed to fetch video URL");
  return res.json() as Promise<{ url: string; external: boolean; provider?: string; videoId?: string }>;
}

// ============================================
// Gym notes overrides
// ============================================

export function useUpsertGymOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      movementId: string;
      communityId: string;
      notesOverride: string;
    }) => {
      const res = await fetch(
        `/api/recovery/movements/${input.movementId}/gym-overrides`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            communityId: input.communityId,
            notesOverride: input.notesOverride,
          }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to save note");
      }
      return res.json();
    },
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: ["recovery-movement", input.movementId] });
    },
  });
}

export function useClearGymOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { movementId: string; communityId: string }) => {
      const res = await fetch(
        `/api/recovery/movements/${input.movementId}/gym-overrides`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ communityId: input.communityId }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to clear note");
      }
      return res.json();
    },
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: ["recovery-movement", input.movementId] });
    },
  });
}
