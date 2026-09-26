import routeRegistry from "./publicRoutes.json";

export type RouteClassification = "indexable" | "noindex" | "dynamic" | "private" | "legacy";
export type StaticRouteGroup = "static" | "faq";
export type PublicRouteId = "home" | "trips" | "booking" | "programme" | "visa" | "experiences" | "hotels" | "about" | "blog" | "contact" | "partner" | "faqFr" | "faqEn" | "faqAr";

export type StaticPublicRoute = {
  id: PublicRouteId;
  path: string;
  classification: "indexable";
  group: StaticRouteGroup;
  sitemap: boolean;
  prerender: boolean;
  seoPriority: boolean;
};

export type DynamicPublicRoute = {
  pattern: string;
  classification: "dynamic";
  contentType: "article" | "hotel";
  indexable: boolean;
  sitemap: boolean;
  prerender: boolean;
};

export const publicRouteRegistry = routeRegistry as {
  siteOrigin: string;
  staticRoutes: StaticPublicRoute[];
  dynamicRoutes: DynamicPublicRoute[];
  excludedFamilies: Array<{ path: string; classification: "private" | "noindex"; match: "prefix" }>;
  legacyRedirects: Array<{ path: string; target: string }>;
  removedFamilies: string[];
};

export const sitemapStaticRoutes = publicRouteRegistry.staticRoutes.filter((route) => route.sitemap);
export const prerenderStaticRoutes = publicRouteRegistry.staticRoutes.filter((route) => route.prerender);
export const privateRouteFamilies = publicRouteRegistry.excludedFamilies.filter((route) => route.classification === "private");
export const noindexRouteFamilies = publicRouteRegistry.excludedFamilies.filter((route) => route.classification === "noindex");

export const publicPath = (id: PublicRouteId) => {
  const route = publicRouteRegistry.staticRoutes.find((candidate) => candidate.id === id);
  if (!route) throw new Error(`Unknown public route id: ${id}`);
  return route.path;
};

export const isExcludedFromSitemap = (pathname: string) =>
  publicRouteRegistry.excludedFamilies.some(({ path }) => pathname === path || pathname.startsWith(`${path}/`)) ||
  publicRouteRegistry.legacyRedirects.some(({ path }) => pathname === path) ||
  publicRouteRegistry.removedFamilies.some((path) => pathname === path || pathname.startsWith(`${path}/`));
