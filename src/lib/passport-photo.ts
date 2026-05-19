/**
 * Passport photo helper.
 * Resizes & crops an uploaded image to the Japan visa photo standard:
 *   - 35 mm × 45 mm (portrait)
 *   - White background, sRGB JPEG
 *   - Rendered at 600 DPI → 827 × 1063 px
 *
 * The image is center-cropped to the target aspect ratio, scaled with
 * smoothing, then composited onto a white background to remove
 * transparency. Output: a JPEG `File` ready to upload.
 */

const TARGET_W = 827; // 35 mm @ ~600 DPI
const TARGET_H = 1063; // 45 mm @ ~600 DPI
const TARGET_RATIO = TARGET_W / TARGET_H;

export type PassportPhotoResult = {
  file: File;
  previewUrl: string;
  widthPx: number;
  heightPx: number;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image illisible"));
    img.src = src;
  });
}

export async function resizePassportPhoto(file: File): Promise<PassportPhotoResult> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Veuillez sélectionner une image (JPG ou PNG).");
  }

  const url = URL.createObjectURL(file);
  let img: HTMLImageElement;
  try {
    img = await loadImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }

  // Compute center crop to match target aspect ratio
  const srcRatio = img.naturalWidth / img.naturalHeight;
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (srcRatio > TARGET_RATIO) {
    // too wide → crop sides
    sw = Math.round(img.naturalHeight * TARGET_RATIO);
    sx = Math.round((img.naturalWidth - sw) / 2);
  } else if (srcRatio < TARGET_RATIO) {
    // too tall → crop top/bottom (slight bias toward top to keep face)
    sh = Math.round(img.naturalWidth / TARGET_RATIO);
    sy = Math.round((img.naturalHeight - sh) / 3); // bias toward top
  }

  const canvas = document.createElement("canvas");
  canvas.width = TARGET_W;
  canvas.height = TARGET_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas non supporté par ce navigateur.");

  // White background to flatten transparency
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, TARGET_W, TARGET_H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, TARGET_W, TARGET_H);

  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Échec de génération de la photo."))),
      "image/jpeg",
      0.92,
    ),
  );

  const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
  const out = new File([blob], `${baseName}-passport-35x45.jpg`, { type: "image/jpeg" });
  return {
    file: out,
    previewUrl: URL.createObjectURL(blob),
    widthPx: TARGET_W,
    heightPx: TARGET_H,
  };
}