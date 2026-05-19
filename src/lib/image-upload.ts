/**
 * Browser-side image optimizer used before uploading to cloud storage.
 *
 *  - Strips EXIF (canvas re-encode does this automatically).
 *  - Resizes images larger than `maxWidth` (default 3000 px) keeping aspect.
 *  - Re-encodes to WebP at a high-quality setting; falls back to JPEG when
 *    WebP is somehow unsupported (rare in modern browsers).
 *  - Skips processing for SVG / GIF (would lose animation / vector data).
 *  - Slugifies filenames to keep URLs SEO-friendly.
 */

import { slugify } from "./format";

export type OptimizeOptions = {
  maxWidth?: number; // default 3000
  quality?: number; // 0..1, default 0.85
  preferredFormat?: "image/webp" | "image/jpeg";
};

const SKIP_TYPES = new Set(["image/gif", "image/svg+xml"]);

const loadImage = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), type, quality),
  );

const buildName = (originalName: string, ext: string) => {
  const dot = originalName.lastIndexOf(".");
  const stem = dot > 0 ? originalName.slice(0, dot) : originalName;
  const safe = slugify(stem) || "image";
  return `${safe}.${ext}`;
};

/**
 * Optimize a single image file. Always returns a `File` ready to upload
 * (the original is returned unchanged when optimization is skipped or fails).
 */
export async function optimizeImage(
  file: File,
  opts: OptimizeOptions = {},
): Promise<File> {
  if (!file.type.startsWith("image/") || SKIP_TYPES.has(file.type)) {
    // Still slugify the filename for SEO-friendly URLs.
    return new File([file], buildName(file.name, file.name.split(".").pop() || "img"), {
      type: file.type,
    });
  }

  const maxWidth = opts.maxWidth ?? 3000;
  const quality = opts.quality ?? 0.85;
  const preferred = opts.preferredFormat ?? "image/webp";

  try {
    const img = await loadImage(file);
    const ratio = img.width > maxWidth ? maxWidth / img.width : 1;
    const w = Math.round(img.width * ratio);
    const h = Math.round(img.height * ratio);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);

    let blob = await canvasToBlob(canvas, preferred, quality);
    let outType = preferred;
    if (!blob) {
      blob = await canvasToBlob(canvas, "image/jpeg", quality);
      outType = "image/jpeg";
    }
    if (!blob) return file;

    // If the "optimized" version is somehow larger than the original
    // (already-compressed small images), keep the original bytes but slugify name.
    if (blob.size >= file.size && ratio === 1) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      return new File([file], buildName(file.name, ext), { type: file.type });
    }

    const ext = outType === "image/webp" ? "webp" : "jpg";
    return new File([blob], buildName(file.name, ext), { type: outType });
  } catch {
    return file;
  }
}

export async function optimizeImages(
  files: File[] | FileList,
  opts: OptimizeOptions = {},
): Promise<File[]> {
  const arr = Array.from(files);
  return Promise.all(arr.map((f) => optimizeImage(f, opts)));
}