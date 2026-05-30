import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CrossfitMovementVideo, CrossfitVideoVisibility } from "@/types/crossfit";

export function useMovementVideos(movementId: string | null) {
  return useQuery<CrossfitMovementVideo[]>({
    queryKey: ["movement-videos", movementId],
    queryFn: async () => {
      const res = await fetch(`/api/movements/${movementId}/videos`);
      if (!res.ok) throw new Error("Failed to load videos");
      return res.json();
    },
    enabled: !!movementId,
  });
}

export interface AddExternalMovementVideoInput {
  movementId: string;
  externalUrl: string;
  visibility: CrossfitVideoVisibility;
  communityId?: string | null;
  label?: string;
  rightsConfirmed: boolean;
}

export function useAddExternalMovementVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddExternalMovementVideoInput) => {
      const res = await fetch(`/api/movements/${input.movementId}/videos`, {
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
      qc.invalidateQueries({ queryKey: ["movement-videos", input.movementId] });
    },
  });
}

export interface UploadMovementVideoInput {
  movementId: string;
  file: File;
  visibility: CrossfitVideoVisibility;
  communityId?: string | null;
  label?: string;
  durationSeconds?: number;
  rightsConfirmed: boolean;
}

/**
 * Three-step direct-to-storage upload (issue → PUT → register). Same shape
 * as the recovery flow; see useRecoveryMovements.ts for the rationale.
 */
export function useUploadMovementVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UploadMovementVideoInput) => {
      const ext = input.file.type === "video/quicktime" ? "mov" : "mp4";

      const issueRes = await fetch(`/api/movements/${input.movementId}/videos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "upload",
          visibility: input.visibility,
          communityId: input.communityId ?? null,
          fileExt: ext,
        }),
      });
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

      const { createClient } = await import("@/lib/supabase/client");
      const { CROSSFIT_BUCKET } = await import("@/lib/crossfit/video-storage");
      const supabase = createClient();
      const { error: uploadErr } = await supabase.storage
        .from(CROSSFIT_BUCKET)
        .uploadToSignedUrl(issued.storagePath, issued.token, input.file, {
          contentType: input.file.type,
        });
      if (uploadErr) throw uploadErr;

      const registerRes = await fetch(`/api/movements/${input.movementId}/videos`, {
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
      });
      if (!registerRes.ok) {
        const body = await registerRes.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to register video");
      }
      return registerRes.json();
    },
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: ["movement-videos", input.movementId] });
    },
  });
}

export function useDeleteMovementVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { movementId: string; videoId: string }) => {
      const res = await fetch(
        `/api/movements/${input.movementId}/videos/${input.videoId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to delete video");
    },
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: ["movement-videos", input.movementId] });
    },
  });
}

export async function fetchMovementVideoPlaybackUrl(
  movementId: string,
  videoId: string
) {
  const res = await fetch(`/api/movements/${movementId}/videos/${videoId}`);
  if (!res.ok) throw new Error("Failed to fetch video URL");
  return res.json() as Promise<{
    url: string;
    external: boolean;
    provider?: string;
    videoId?: string;
  }>;
}
