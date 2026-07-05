import { useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";

const SITE = "https://www.lejapon.ma";
const DEFAULT_OG = "https://www.lejapon.ma/og-default.jpg";

type SeoProps = {
  title: string;
  description: string;
  /** Canonical path, defaults to current pathname */
  canonical?: string;
  image?: string;
  type?: "website" | "article";
  imageAlt?: string;
  imageWidth?: number;
  imageHeight?: number;
  /** Optional JSON-LD structured data object(s) */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
  /** noindex flag for utility pages */
  noindex?: boolean;
};

const absoluteUrl = (value?: string | null) => {
  if (!value) return DEFAULT_OG;
  try {
    return new URL(value, SITE).toString();
  } catch {
    return DEFAULT_OG;
  }
};

const upsertMeta = (selector: string, attr: "name" | "property", key: string, content: string) => {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
};

const upsertLink = (rel: string, href: string) => {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
};

/**
 * Lightweight SEO helper — sets <title>, meta description, canonical,
 * OpenGraph/Twitter tags and optional JSON-LD without external deps.
 */
export const Seo = ({
  title,
  description,
  canonical,
  image = DEFAULT_OG,
  type = "website",
  imageAlt,
  imageWidth = 1200,
  imageHeight = 630,
  jsonLd,
  noindex,
}: SeoProps) => {
  const location = useLocation();
  const path = canonical ?? location.pathname;
  const url = useMemo(() => absoluteUrl(path === "/" ? "/" : path), [path]);
  const absoluteImage = useMemo(() => absoluteUrl(image), [image]);

  useEffect(() => {
    document.title = title;
    upsertMeta('meta[name="description"]', "name", "description", description);
    upsertMeta('meta[name="robots"]', "name", "robots", noindex ? "noindex,nofollow" : "index,follow");
    upsertLink("canonical", url);

    upsertMeta('meta[property="og:title"]', "property", "og:title", title);
    upsertMeta('meta[property="og:description"]', "property", "og:description", description);
    upsertMeta('meta[property="og:url"]', "property", "og:url", url);
    upsertMeta('meta[property="og:type"]', "property", "og:type", type);
    upsertMeta('meta[property="og:site_name"]', "property", "og:site_name", "LeJapon.ma");
    upsertMeta('meta[property="og:image"]', "property", "og:image", absoluteImage);
    upsertMeta('meta[property="og:image:secure_url"]', "property", "og:image:secure_url", absoluteImage);
    upsertMeta('meta[property="og:image:alt"]', "property", "og:image:alt", imageAlt || title);
    upsertMeta('meta[property="og:image:width"]', "property", "og:image:width", String(imageWidth));
    upsertMeta('meta[property="og:image:height"]', "property", "og:image:height", String(imageHeight));
    upsertMeta('meta[property="og:locale"]', "property", "og:locale", "fr_FR");

    upsertMeta('meta[name="twitter:card"]', "name", "twitter:card", "summary_large_image");
    upsertMeta('meta[name="twitter:title"]', "name", "twitter:title", title);
    upsertMeta('meta[name="twitter:description"]', "name", "twitter:description", description);
    upsertMeta('meta[name="twitter:image"]', "name", "twitter:image", absoluteImage);

    // JSON-LD
    const existing = document.head.querySelectorAll('script[data-seo-jsonld="true"]');
    existing.forEach((n) => n.remove());
    if (jsonLd) {
      const arr = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
      arr.forEach((obj) => {
        const s = document.createElement("script");
        s.type = "application/ld+json";
        s.dataset.seoJsonld = "true";
        s.text = JSON.stringify(obj);
        document.head.appendChild(s);
      });
    }
  }, [title, description, url, absoluteImage, type, imageAlt, imageWidth, imageHeight, noindex, jsonLd]);

  return null;
};

export default Seo;
