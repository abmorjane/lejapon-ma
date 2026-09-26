import { describe, expect, it } from "vitest";
import {
  isExcludedFromSitemap,
  noindexRouteFamilies,
  prerenderStaticRoutes,
  publicRouteRegistry,
  sitemapStaticRoutes,
} from "./publicRoutes";

describe("public route registry", () => {
  it("keeps canonical static routes unique", () => {
    const paths = publicRouteRegistry.staticRoutes.map((route) => route.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("keeps /reserver indexable and in the sitemap without making it a prerender priority", () => {
    const booking = publicRouteRegistry.staticRoutes.find((route) => route.path === "/reserver");
    expect(booking).toMatchObject({ classification: "indexable", sitemap: true, prerender: false, seoPriority: false });
    expect(sitemapStaticRoutes.some((route) => route.path === "/reserver")).toBe(true);
    expect(prerenderStaticRoutes.some((route) => route.path === "/reserver")).toBe(false);
  });

  it("excludes private, untranslated and legacy routes from sitemap candidates", () => {
    expect(isExcludedFromSitemap("/admin/login")).toBe(true);
    expect(isExcludedFromSitemap("/devis-fit/private-token")).toBe(true);
    expect(isExcludedFromSitemap("/en/blog/example")).toBe(true);
    expect(isExcludedFromSitemap("/prix")).toBe(true);
    expect(noindexRouteFamilies.map((route) => route.path)).toEqual(["/en/blog", "/ar/blog"]);
  });
});
