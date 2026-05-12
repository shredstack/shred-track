// Client-side helpers for the profile-picture upload flow. The pipeline is:
//
//   File (HEIC/JPEG/PNG, up to ~50 MP on modern iPhones)
//     → prepareImageForCrop()  — decode once, downscale to ≤ MAX_DECODE_DIM,
//                                 hand back an object-URL the cropper renders
//     → cropAndCompress()      — crop the chosen square at 512×512, JPEG q=0.85
//     → uploadToSignedUrl()    — typically 30–80 KB on the wire
//
// We deliberately do NOT use readAsDataURL/data URLs: a 48-MP iPhone photo is
// ~25 MB, which inflates to ~33 MB as base64 and frequently exhausts mobile
// Safari's per-image memory budget. Object URLs share the underlying File
// bytes and decode through the normal image pipeline.
//
// HEIC/HEIF support is patchy across iOS Safari versions; the caller should
// reject those MIME types up front rather than relying on Image to fail.

export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

const OUTPUT_SIZE = 512;
const JPEG_QUALITY = 0.85;
// Largest dimension we keep before cropping. Bounding a 48-MP source to
// 2048×~1536 cuts in-memory bitmap size from ~190 MB to ~13 MB while still
// leaving plenty of resolution for a 512px final crop at any zoom.
const MAX_DECODE_DIM = 2048;

export interface PreparedImage {
  // Object URL to feed into <img>/react-easy-crop. Caller is responsible for
  // revoking it via URL.revokeObjectURL when done.
  url: string;
  width: number;
  height: number;
}

function loadImageFromUrl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode image"));
    img.src = src;
  });
}

// Decode the source file once, downscale if it exceeds MAX_DECODE_DIM, and
// return an object URL the cropper can render cheaply. For images already
// within the budget we hand back the original file's object URL.
export async function prepareImageForCrop(file: File): Promise<PreparedImage> {
  const sourceUrl = URL.createObjectURL(file);
  let img: HTMLImageElement;
  try {
    img = await loadImageFromUrl(sourceUrl);
  } catch (err) {
    URL.revokeObjectURL(sourceUrl);
    throw err;
  }

  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  if (longest <= MAX_DECODE_DIM) {
    return { url: sourceUrl, width: img.naturalWidth, height: img.naturalHeight };
  }

  const scale = MAX_DECODE_DIM / longest;
  const width = Math.round(img.naturalWidth * scale);
  const height = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    URL.revokeObjectURL(sourceUrl);
    throw new Error("Canvas 2D context unavailable");
  }
  ctx.drawImage(img, 0, 0, width, height);
  URL.revokeObjectURL(sourceUrl);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.92)
  );
  if (!blob) throw new Error("Failed to downscale image");
  return { url: URL.createObjectURL(blob), width, height };
}

export async function cropAndCompress(
  imageUrl: string,
  cropPixels: CropArea
): Promise<Blob> {
  const img = await loadImageFromUrl(imageUrl);

  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.drawImage(
    img,
    cropPixels.x,
    cropPixels.y,
    cropPixels.width,
    cropPixels.height,
    0,
    0,
    OUTPUT_SIZE,
    OUTPUT_SIZE
  );

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error("Failed to encode image"));
        resolve(blob);
      },
      "image/jpeg",
      JPEG_QUALITY
    );
  });
}
