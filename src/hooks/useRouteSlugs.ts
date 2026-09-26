import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type RouteKey =
  | "trips" | "experiences" | "about" | "blog"
  | "contact" | "booking" | "programme" | "visa";

export type RouteSlug = {
  route_key: RouteKey;
  label: string;
  slug: string;
  default_slug: string;
  is_editable: boolean;
  sort_order: number;
};

export const DEFAULT_SLUGS: Record<RouteKey, { label: string; slug: string }> = {
  trips:       { label: "Voyages",     slug: "voyages" },
  experiences: { label: "Expériences", slug: "experiences" },
  about:       { label: "À propos",    slug: "a-propos" },
  blog:        { label: "Blog",        slug: "blog" },
  contact:     { label: "Contact",     slug: "contact" },
  booking:     { label: "Réservation", slug: "reserver" },
  programme:   { label: "Programme",   slug: "programme" },
  visa:        { label: "Visa Japon",  slug: "formulaire-visa" },
};

/**
 * Public SEO routes and the private visa base are intentionally immutable.
 * Values stored in route_slugs are kept for backwards-compatible admin data,
 * but they must never change a canonical URL at runtime.
 */
const LOCKED_ROUTE_KEYS = new Set<RouteKey>(Object.keys(DEFAULT_SLUGS) as RouteKey[]);

export const isRouteSlugLocked = (key: string): key is RouteKey =>
  LOCKED_ROUTE_KEYS.has(key as RouteKey);

export const canonicalRouteSlug = (key: RouteKey): string => DEFAULT_SLUGS[key].slug;

export const normalizeRouteSlug = (row: RouteSlug): RouteSlug => {
  if (!isRouteSlugLocked(row.route_key)) return row;
  const slug = canonicalRouteSlug(row.route_key);
  return { ...row, slug, default_slug: slug, is_editable: false };
};

let cache: Record<RouteKey, RouteSlug> | null = null;
let pending: Promise<Record<RouteKey, RouteSlug>> | null = null;
const subscribers = new Set<(v: Record<RouteKey, RouteSlug>) => void>();

function makeFallback(): Record<RouteKey, RouteSlug> {
  const out = {} as Record<RouteKey, RouteSlug>;
  let i = 0;
  for (const k of Object.keys(DEFAULT_SLUGS) as RouteKey[]) {
    out[k] = {
      route_key: k,
      label: DEFAULT_SLUGS[k].label,
      slug: DEFAULT_SLUGS[k].slug,
      default_slug: DEFAULT_SLUGS[k].slug,
      is_editable: false,
      sort_order: ++i,
    };
  }
  return out;
}

async function load(): Promise<Record<RouteKey, RouteSlug>> {
  if (cache) return cache;
  if (pending) return pending;
  pending = (async () => {
    const { data } = await supabase.from("route_slugs").select("*").order("sort_order");
    const map = makeFallback();
    (data ?? []).forEach((value) => {
      const row = value as RouteSlug;
      if (row.route_key in map) map[row.route_key as RouteKey] = normalizeRouteSlug(row);
    });
    cache = map;
    pending = null;
    subscribers.forEach((fn) => fn(map));
    return map;
  })();
  return pending;
}

export function invalidateRouteSlugs() {
  cache = null;
  load();
}

export function useRouteSlugs() {
  const [slugs, setSlugs] = useState<Record<RouteKey, RouteSlug> | null>(cache);
  useEffect(() => {
    const fn = (v: Record<RouteKey, RouteSlug>) => setSlugs(v);
    subscribers.add(fn);
    if (!cache) load().then(fn);
    return () => { subscribers.delete(fn); };
  }, []);
  return slugs;
}

export function pathFor(slugs: Record<RouteKey, RouteSlug> | null, key: RouteKey): string {
  if (isRouteSlugLocked(key)) return "/" + canonicalRouteSlug(key);
  return "/" + (slugs?.[key]?.slug ?? DEFAULT_SLUGS[key].slug);
}
