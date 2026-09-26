import { useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";

const SITE = "https://www.lejapon.ma";
const DEFAULT_OG = "https://www.lejapon.ma/og-default.jpg";
const CANONICAL_ALIASES: Record<string, string> = {
  "/prix": "/reserver",
  "/inscription": "/reserver",
  "/paiement": "/reserver",
  "/visa": "/visa-japon-maroc",
  "/visa-japon": "/visa-japon-maroc",
  "/formulaire-visa": "/visa-japon-maroc",
};

export type RobotsDirective = "index,follow" | "noindex,follow" | "noindex,nofollow";
export type SeoLanguage = "fr" | "en" | "ar";

const OG_LOCALES: Record<SeoLanguage, string> = {
  fr: "fr_FR",
  en: "en_GB",
  ar: "ar_MA",
};

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
  /** Explicit robots directive. Takes precedence over the legacy noindex flag. */
  robots?: RobotsDirective;
  /** Page language used for html lang/dir and og:locale. Defaults from the URL. */
  language?: SeoLanguage;
  /** Build-time signal: dynamic pages set this only after their real content is loaded. */
  prerenderReady?: boolean;
};

const absoluteUrl = (value?: string | null) => {
  if (!value) return DEFAULT_OG;
  try {
    return new URL(value, SITE).toString();
  } catch {
    return DEFAULT_OG;
  }
};

const canonicalUrl = (value: string) => {
  const url = new URL(value, SITE);
  url.search = "";
  url.hash = "";
  const normalizedPath = url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");
  url.pathname = CANONICAL_ALIASES[normalizedPath] ?? normalizedPath;
  return url.toString();
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
  robots,
  language,
  prerenderReady = true,
}: SeoProps) => {
  const location = useLocation();
  const path = canonical ?? location.pathname;
  const url = useMemo(() => canonicalUrl(path === "/" ? "/" : path), [path]);
  const absoluteImage = useMemo(() => absoluteUrl(image), [image]);
  const robotsContent = robots ?? (noindex ? "noindex,nofollow" : "index,follow");
  const pageLanguage: SeoLanguage = language ?? (location.pathname.startsWith("/en/") ? "en" : location.pathname.startsWith("/ar/") ? "ar" : "fr");

  useEffect(() => {
    delete document.documentElement.dataset.prerenderReady;
    document.documentElement.lang = pageLanguage;
    document.documentElement.dir = pageLanguage === "ar" ? "rtl" : "ltr";
    document.title = title;
    upsertMeta('meta[name="description"]', "name", "description", description);
    upsertMeta('meta[name="robots"]', "name", "robots", robotsContent);
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
    upsertMeta('meta[property="og:locale"]', "property", "og:locale", OG_LOCALES[pageLanguage]);

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

    if (prerenderReady) document.documentElement.dataset.prerenderReady = "true";
  }, [title, description, url, absoluteImage, type, imageAlt, imageWidth, imageHeight, robotsContent, jsonLd, pageLanguage, prerenderReady]);

  return null;
};

export default Seo;
