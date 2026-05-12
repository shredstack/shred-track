// Client-side helper: given a source image + a crop rectangle (from
// react-easy-crop), draw the cropped region to a canvas at a fixed
// output size and export as JPEG. The result is small enough (~30–80 KB
// for a 512px square at q=0.85) that a phone photo never hits the
// "image too large" wall.

export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

const OUTPUT_SIZE = 512;
const JPEG_QUALITY = 0.85;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}

export async function cropAndCompress(
  imageDataUrl: string,
  cropPixels: CropArea
): Promise<Blob> {
  const img = await loadImage(imageDataUrl);

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

// Reads a File from <input type="file"> into a data URL so react-easy-crop
// can display it. We do this in-memory rather than uploading the raw file
// — even a 10 MB phone photo decodes fine in the browser, and the user
// only ever uploads the compressed result.
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
