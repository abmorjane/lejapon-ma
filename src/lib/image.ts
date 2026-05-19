/**
 * Image utilities — single source of truth for all <img> URLs in the app.
 *
 * Strategy
 * --------
 * 1. Bundled assets (imported by Vite) and external URLs are returned as-is.
 * 2. Images stored in our cloud storage (public buckets) are routed
 *    through the on-the-fly render endpoint:
 *      /storage/v1/render/image/public/<bucket>/<path>?width=…&quality=…
 *    which serves a resized, optimized variant (modern format negotiation,
 *    EXIF stripped) without re-uploading anything.
 * 3. If the transform endpoint is unavailable on the current plan, the
 *    original URL still works as a fallback because we keep the same path.
 *
 * Sizes used across the site (kept in one place for cache-friendliness):
 *   thumb = 400, card = 800, hero = 1600, full = 1920
 */

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const PUBLIC_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/`;
const RENDER_PREFIX = `${SUPABASE_URL}/storage/v1/render/image/public/`;

export type ImgPreset = "thumb" | "card" | "hero" | "full";

export const IMG_WIDTHS: Record<ImgPreset, number> = {
  thumb: 400,
  card: 800,
  hero: 1600,
  full: 1920,
};

const DEFAULT_QUALITY: Record<ImgPreset, number> = {
  thumb: 70,
  card: 75,
  hero: 80,
  full: 82,
};

/** True if the URL points to a public file in our Supabase storage. */
export function isSupabasePublic(url?: string | null): boolean {
  if (!url) return false;
  return url.startsWith(PUBLIC_PREFIX);
}

/**
 * Build a transformed URL for a Supabase-stored image.
 * Falls through to the original URL for bundled / external assets.
 */
export function getImageUrl(
  url: string | null | undefined,
  opts: { width?: number; quality?: number; preset?: ImgPreset } = {},
): string {
  if (!url) return "";
  const preset = opts.preset ?? "card";
  const width = opts.width ?? IMG_WIDTHS[preset];
  const quality = opts.quality ?? DEFAULT_QUALITY[preset];

  if (!isSupabasePublic(url)) return url;

  const path = url.slice(PUBLIC_PREFIX.length);
  const params = new URLSearchParams({
    width: String(Math.round(width)),
    quality: String(quality),
    resize: "cover",
  });
  return `${RENDER_PREFIX}${path}?${params.toString()}`;
}

/** Generate a srcset string for responsive delivery. */
export function getSrcSet(
  url: string | null | undefined,
  widths: number[],
  quality?: number,
): string {
  if (!url || !isSupabasePublic(url)) return "";
  return widths
    .map((w) => `${getImageUrl(url, { width: w, quality })} ${w}w`)
    .join(", ");
}

export const RESPONSIVE_WIDTHS: Record<ImgPreset, number[]> = {
  thumb: [200, 400],
  card: [400, 600, 800, 1200],
  hero: [640, 960, 1280, 1600, 1920],
  full: [800, 1280, 1600, 1920],
};