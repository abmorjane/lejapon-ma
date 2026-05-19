import { forwardRef, type ImgHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import {
  IMG_WIDTHS,
  RESPONSIVE_WIDTHS,
  getImageUrl,
  getSrcSet,
  isSupabasePublic,
  type ImgPreset,
} from "@/lib/image";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet"> & {
  src: string | null | undefined;
  /**
   * REQUIRED for accessibility & SEO. Pass an empty string only for purely
   * decorative images and also set `aria-hidden`.
   */
  alt: string;
  /** Visual preset — drives default width, srcset and quality. */
  preset?: ImgPreset;
  /** Force eager + high priority (use only for above-the-fold hero images). */
  priority?: boolean;
  /** Override the srcset widths if needed. */
  widths?: number[];
  /** Override the `sizes` attribute (CSS media-conditioned widths). */
  sizes?: string;
};

const DEFAULT_SIZES: Record<ImgPreset, string> = {
  thumb: "(max-width: 640px) 50vw, 200px",
  card: "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw",
  hero: "100vw",
  full: "100vw",
};

/**
 * Drop-in replacement for <img> that:
 *  - rewrites Supabase Storage URLs through the on-the-fly render endpoint
 *  - emits a responsive srcset + sensible default `sizes`
 *  - lazy-loads by default; eager + fetchpriority="high" when `priority`
 *  - falls back to a plain <img> when no transformation is possible
 */
export const Img = forwardRef<HTMLImageElement, Props>(function Img(
  { src, alt, preset = "card", priority, widths, sizes, className, ...rest },
  ref,
) {
  if (!src) {
    return (
      <div
        aria-hidden
        className={cn("bg-secondary", className)}
        style={rest.style}
      />
    );
  }

  const transformable = isSupabasePublic(src);
  const baseWidth = IMG_WIDTHS[preset];
  const finalSrc = transformable ? getImageUrl(src, { preset }) : src;
  const srcSet = transformable
    ? getSrcSet(src, widths ?? RESPONSIVE_WIDTHS[preset])
    : undefined;
  const finalSizes = sizes ?? (transformable ? DEFAULT_SIZES[preset] : undefined);

  return (
    <img
      ref={ref}
      src={finalSrc}
      srcSet={srcSet}
      sizes={finalSizes}
      alt={alt}
      loading={priority ? "eager" : (rest.loading ?? "lazy")}
      decoding={rest.decoding ?? "async"}
      // @ts-expect-error — fetchpriority is a valid HTML attribute, not yet typed
      fetchpriority={priority ? "high" : rest.fetchpriority ?? "auto"}
      width={rest.width ?? baseWidth}
      height={rest.height}
      className={className}
      {...rest}
    />
  );
});