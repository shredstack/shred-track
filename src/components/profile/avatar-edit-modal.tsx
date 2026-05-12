"use client";

import { useCallback, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Camera, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cropAndCompress, fileToDataUrl } from "@/lib/avatars/compress";
import { useUploadAvatar, useDeleteAvatar } from "@/hooks/useProfile";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Current avatar URL (used to show the Remove button when present).
  currentImage: string | null;
}

export function AvatarEditModal({ open, onOpenChange, currentImage }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedPixels, setCroppedPixels] = useState<Area | null>(null);

  const uploadAvatar = useUploadAvatar();
  const deleteAvatar = useDeleteAvatar();
  const busy = uploadAvatar.isPending || deleteAvatar.isPending;

  const reset = useCallback(() => {
    setImageSrc(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedPixels(null);
  }, []);

  const handleClose = useCallback(
    (next: boolean) => {
      if (busy) return; // don't let the user dismiss mid-upload
      if (!next) reset();
      onOpenChange(next);
    },
    [busy, onOpenChange, reset]
  );

  const onCropComplete = useCallback((_: Area, areaPixels: Area) => {
    setCroppedPixels(areaPixels);
  }, []);

  const onFilePick = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file twice still fires onChange.
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setImageSrc(dataUrl);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    } catch {
      toast.error("Could not read that image. Try a different file.");
    }
  }, []);

  const onSave = useCallback(async () => {
    if (!imageSrc || !croppedPixels) return;
    try {
      const blob = await cropAndCompress(imageSrc, croppedPixels);
      await uploadAvatar.mutateAsync(blob);
      toast.success("Profile picture updated");
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to upload");
    }
  }, [imageSrc, croppedPixels, uploadAvatar, reset, onOpenChange]);

  const onRemove = useCallback(async () => {
    try {
      await deleteAvatar.mutateAsync();
      toast.success("Profile picture removed");
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove");
    }
  }, [deleteAvatar, reset, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Profile picture</DialogTitle>
          <DialogDescription>
            {imageSrc
              ? "Drag to reposition and pinch or use the slider to zoom."
              : "Upload a photo from your device. We'll resize and compress it for you."}
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onFilePick}
        />

        {imageSrc ? (
          <div className="space-y-4">
            <div className="relative h-64 w-full overflow-hidden rounded-lg bg-muted">
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                restrictPosition={false}
                objectFit="cover"
                minZoom={0.5}
                maxZoom={4}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Zoom</span>
                <span>{zoom.toFixed(1)}×</span>
              </div>
              <Slider
                min={0.5}
                max={4}
                step={0.05}
                value={[zoom]}
                onValueChange={(v) => setZoom(Array.isArray(v) ? v[0] : v)}
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Camera className="h-7 w-7 text-muted-foreground" />
            </div>
            <Button
              onClick={() => fileInputRef.current?.click()}
              className="gap-2"
              disabled={busy}
            >
              <Upload className="h-4 w-4" />
              Choose photo
            </Button>
          </div>
        )}

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <div>
            {currentImage && !imageSrc && (
              <Button
                variant="ghost"
                onClick={onRemove}
                disabled={busy}
                className="gap-2 text-destructive hover:text-destructive"
              >
                {deleteAvatar.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Remove
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => handleClose(false)} disabled={busy}>
              Cancel
            </Button>
            {imageSrc && (
              <Button onClick={onSave} disabled={busy || !croppedPixels} className="gap-2">
                {uploadAvatar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Save
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
