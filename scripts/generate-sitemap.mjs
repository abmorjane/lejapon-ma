import fs from "node:fs/promises";
import {
  assessHotelQuality,
  distDirectory,
  fetchActiveHotels,
  fetchPublishedArticles,
  isExcludedPath,
  isSafeArticleSlug,
  manifestPath,
  normalizeRoutePath,
  readRouteRegistry,
  toIsoLastmod,
  validateUniqueRoutes,
  xmlEscape,
} from "./seo/lib.mjs";

const registry = await readRouteRegistry();
const [rawArticles, rawHotels] = await Promise.all([fetchPublishedArticles(), fetchActiveHotels()]);

const articles = rawArticles.map((article) => {
  if (!isSafeArticleSlug(article.slug)) throw new Error(`Published article has an invalid canonical slug: ${article.slug}`);
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    path: `/blog/${article.slug}`,
    lastmod: toIsoLastmod(article.updated_at || article.published_at),
  };
});

const hotelAssessments = rawHotels.map((hotel) => ({ hotel, quality: assessHotelQuality(hotel) }));
const hotels = hotelAssessments
  .filter(({ quality }) => quality.eligible)
  .map(({ hotel, quality }) => ({
    id: hotel.id,
    slug: hotel.slug,
    name: hotel.name,
    city: hotel.city,
    path: `/hotels/${hotel.slug}`,
    lastmod: toIsoLastmod(hotel.updated_at),
    contentLength: quality.contentLength,
    preservesHistoricalCase: hotel.slug !== hotel.slug.toLowerCase(),
  }));

const excludedHotels = hotelAssessments
  .filter(({ quality }) => !quality.eligible)
  .map(({ hotel, quality }) => ({ id: hotel.id, slug: hotel.slug, name: hotel.name, reasons: quality.reasons }));

const staticEntries = registry.staticRoutes
  .filter((route) => route.classification === "indexable" && route.sitemap)
  .map((route) => ({ path: normalizeRoutePath(route.path), type: route.group === "faq" ? "faq" : "static" }));
const articleEntries = articles.map((article) => ({ path: article.path, type: "article", lastmod: article.lastmod }));
const hotelEntries = hotels.map((hotel) => ({ path: hotel.path, type: "hotel", lastmod: hotel.lastmod }));
const sitemapEntries = [...staticEntries, ...articleEntries, ...hotelEntries];
const sitemapRoutes = validateUniqueRoutes(sitemapEntries.map((entry) => entry.path), "Sitemap");

for (const route of sitemapRoutes) {
  if (isExcludedPath(route, registry)) throw new Error(`Forbidden route entered the sitemap: ${route}`);
}

const prerenderStatic = registry.staticRoutes.filter((route) => route.prerender).map((route) => route.path);
const prerenderRoutes = validateUniqueRoutes(
  [...prerenderStatic, ...articles.map((article) => article.path), ...hotels.map((hotel) => hotel.path)],
  "Prerender manifest",
);

const sitemapXml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...sitemapEntries.map((entry) => {
    const loc = `${registry.siteOrigin}${entry.path === "/" ? "/" : entry.path}`;
    const lastmod = entry.lastmod ? `\n    <lastmod>${xmlEscape(entry.lastmod)}</lastmod>` : "";
    return `  <url>\n    <loc>${xmlEscape(loc)}</loc>${lastmod}\n  </url>`;
  }),
  "</urlset>",
  "",
].join("\n");

const manifest = {
  generatedAt: new Date().toISOString(),
  siteOrigin: registry.siteOrigin,
  counts: {
    static: staticEntries.filter((entry) => entry.type === "static").length,
    faq: staticEntries.filter((entry) => entry.type === "faq").length,
    articles: articles.length,
    hotels: hotels.length,
    total: sitemapEntries.length,
    prerendered: prerenderRoutes.length,
  },
  sitemapEntries,
  prerenderRoutes,
  articles,
  hotels,
  excludedHotels,
};

await fs.mkdir(distDirectory, { recursive: true });
await Promise.all([
  fs.writeFile(`${distDirectory}/sitemap.xml`, sitemapXml, "utf8"),
  fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
]);

console.log(
  `SEO data generated: ${manifest.counts.static} static + ${manifest.counts.faq} FAQ + ${manifest.counts.articles} articles + ${manifest.counts.hotels} hotels = ${manifest.counts.total} sitemap URLs.`,
);
if (excludedHotels.length) console.log(`Hotels excluded by quality gate: ${excludedHotels.length}.`);
