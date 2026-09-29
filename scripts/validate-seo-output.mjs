import fs from "node:fs/promises";
import { JSDOM } from "jsdom";
import {
  isExcludedPath,
  manifestPath,
  normalizeRoutePath,
  readJson,
  readRouteRegistry,
  routeToOutputFile,
  validateUniqueRoutes,
} from "./seo/lib.mjs";

const manifest = await readJson(manifestPath);
const registry = await readRouteRegistry();
const sitemapSource = await fs.readFile(new URL("../dist/sitemap.xml", import.meta.url), "utf8");
const sitemapDocument = new JSDOM(sitemapSource, { contentType: "text/xml" }).window.document;
if (sitemapDocument.querySelector("parsererror")) throw new Error("dist/sitemap.xml is not valid XML.");

const sitemapUrls = [...sitemapDocument.querySelectorAll("url")].map((entry) => ({
  loc: entry.querySelector("loc")?.textContent?.trim() ?? "",
  lastmod: entry.querySelector("lastmod")?.textContent?.trim() || undefined,
}));
const sitemapPaths = sitemapUrls.map(({ loc }) => {
  const url = new URL(loc);
  if (url.protocol !== "https:") throw new Error(`Sitemap contains a non-HTTPS URL: ${loc}`);
  if (url.hostname !== "www.lejapon.ma") throw new Error(`Sitemap contains a non-www URL: ${loc}`);
  if (url.search || url.hash) throw new Error(`Sitemap URL contains a query string or hash: ${loc}`);
  const pathname = normalizeRoutePath(url.pathname);
  if (isExcludedPath(pathname, registry)) throw new Error(`Sitemap contains a forbidden route: ${pathname}`);
  return pathname;
});
validateUniqueRoutes(sitemapPaths, "Generated sitemap");

const manifestSitemapPaths = manifest.sitemapEntries.map((entry) => normalizeRoutePath(entry.path));
if (JSON.stringify(sitemapPaths) !== JSON.stringify(manifestSitemapPaths)) {
  throw new Error("Sitemap XML routes do not match generated-seo-routes.json.");
}
for (const { lastmod } of sitemapUrls) {
  if (lastmod && Number.isNaN(new Date(lastmod).getTime())) throw new Error(`Sitemap contains an invalid lastmod: ${lastmod}`);
}
if (sitemapPaths.some((pathname) => /^\/(en|ar)\/blog(?:\/|$)/.test(pathname))) {
  throw new Error("Untranslated EN/AR blog route entered the sitemap.");
}

const articlePaths = manifest.articles.map((article) => article.path);
validateUniqueRoutes(articlePaths, "Published article manifest");
for (const articlePath of articlePaths) {
  if (sitemapPaths.filter((route) => route === articlePath).length !== 1) {
    throw new Error(`Published article must appear exactly once in the sitemap: ${articlePath}`);
  }
}

const loadHtml = async (route) => {
  const html = await fs.readFile(routeToOutputFile(route), "utf8");
  const document = new JSDOM(html).window.document;
  return { html, document };
};

const prerenderTitles = new Map();
for (const route of manifest.prerenderRoutes) {
  const { document } = await loadHtml(route);
  const title = document.title.trim();
  const description = document.querySelector('meta[name="description"]')?.getAttribute("content")?.trim();
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href")?.trim();
  const robots = document.querySelector('meta[name="robots"]')?.getAttribute("content")?.replace(/\s+/g, "");
  const h1 = document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim();
  const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim();
  const ogUrl = document.querySelector('meta[property="og:url"]')?.getAttribute("content")?.trim();
  const ogLocale = document.querySelector('meta[property="og:locale"]')?.getAttribute("content")?.trim();
  const root = document.querySelector("#root");
  if (!title || !description || !canonical || !h1 || !ogTitle || !ogUrl || !ogLocale) {
    throw new Error(`Prerendered SEO head/body is incomplete for ${route}`);
  }
  if (robots !== "index,follow") throw new Error(`Prerendered route is not indexable: ${route} (${robots})`);
  const canonicalUrl = new URL(canonical);
  if (canonicalUrl.origin !== registry.siteOrigin || normalizeRoutePath(canonicalUrl.pathname) !== normalizeRoutePath(route)) {
    throw new Error(`Prerendered canonical is not self-referencing for ${route}: ${canonical}`);
  }
  if (!root?.hasAttribute("data-prerendered")) throw new Error(`Prerender marker is missing for ${route}`);
  if ((root.textContent?.replace(/\s+/g, " ").trim().length ?? 0) < 80) throw new Error(`Prerendered body is too short for ${route}`);
  if (ogTitle !== title || ogUrl !== canonical) throw new Error(`OpenGraph title/URL mismatch for ${route}`);
  prerenderTitles.set(route, title);
}

const homepage = await loadHtml("/");
const homepageText = homepage.document.body.textContent?.replace(/\s+/g, " ") ?? "";
if (/prix imbattables|deux voyages par an|4 places restantes|\+500 voyageurs|4[,.]9\/5|150 avis/i.test(homepageText)) {
  throw new Error("Homepage contains an expired or unverified sales claim.");
}
const voyages = await loadHtml("/voyages");
if (voyages.document.title === homepage.document.title) throw new Error("Voyages retained the homepage title.");
if (new URL(voyages.document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "").pathname !== "/voyages") {
  throw new Error("Voyages canonical is invalid.");
}

const assertPillarPage = (route, page, { title, h1, text, links }) => {
  const headings = [...page.document.querySelectorAll("h1")];
  if (headings.length !== 1) throw new Error(`${route} must contain exactly one H1; found ${headings.length}.`);
  const h1Text = headings[0].textContent?.replace(/\s+/g, " ").trim() ?? "";
  const bodyText = page.document.body.textContent?.replace(/\s+/g, " ").trim() ?? "";
  if (!title.test(page.document.title)) throw new Error(`${route} title does not match its pillar intent.`);
  if (!h1.test(h1Text)) throw new Error(`${route} H1 does not match its pillar intent: ${h1Text}`);
  for (const expected of text) {
    if (!bodyText.includes(expected)) throw new Error(`${route} is missing expected commercial copy: ${expected}`);
  }
  const hrefs = new Set([...page.document.querySelectorAll("a[href]")].map((link) => link.getAttribute("href")));
  for (const href of links) {
    if (!hrefs.has(href)) throw new Error(`${route} is missing its internal link to ${href}`);
  }
};

assertPillarPage("/voyages", voyages, {
  title: /Voyage Japon depuis le Maroc/i,
  h1: /Voyages organisés au Japon.*depuis le Maroc/i,
  text: ["Plus de Japon pour votre budget", "L’accompagnement LeJapon.ma"],
  links: ["/programme", "/visa-japon-maroc", "/a-propos", "/reserver"],
});

const programme = await loadHtml("/programme");
assertPillarPage("/programme", programme, {
  title: /Programme voyage Japon/i,
  h1: /Programmes et itinéraires.*circuits au Japon/i,
  text: ["Votre itinéraire", "La suite de votre voyage commence ici"],
  links: ["/voyages", "/experiences", "/hotels", "/reserver"],
});
if (programme.document.body.textContent?.includes("Choisissez votre programme de voyage au Japon")) {
  throw new Error("Programme reintroduced the redundant introduction before the selectors.");
}
if (/13\s*(?:et|ou|\/)\s*17\s*jours/i.test(programme.document.title)) {
  throw new Error("Programme title must not hardcode current circuit durations.");
}
for (const [route, title] of prerenderTitles) {
  if (route !== "/" && title === homepage.document.title) throw new Error(`${route} retained the homepage title.`);
}

const visa = await loadHtml("/visa-japon-maroc");
if (!/visa/i.test(visa.document.querySelector("h1")?.textContent ?? "")) throw new Error("Visa H1 is missing.");
const visaJsonLd = [...visa.document.querySelectorAll('script[type="application/ld+json"]')].map((script) => JSON.parse(script.textContent || "{}"));
if (!visaJsonLd.some((value) => value["@type"] === "FAQPage")) throw new Error("Visa FAQPage JSON-LD is missing.");
assertPillarPage("/visa-japon-maroc", visa, {
  title: /Visa Japon Maroc/i,
  h1: /Visa Japon au Maroc/i,
  text: ["Règles officielles du visa Japon", "Informations vérifiées le 26 septembre 2026 auprès de l’Ambassade du Japon au Maroc."],
  links: ["/voyages", "/reserver", "/mon-voyage-questions-reponses"],
});
if (!visa.document.querySelector('a[href^="https://www.ma.emb-japan.go.jp/"]')) {
  throw new Error("Visa page is missing its official Embassy source.");
}

const about = await loadHtml("/a-propos");
assertPillarPage("/a-propos", about, {
  title: /Agence de voyage Japon au Maroc/i,
  h1: /agence marocaine spécialisée.*voyages au Japon/i,
  text: ["LeJapon.ma, marque spécialisée Japon de Moroccan Express Travel & Events", "Nos points de contact au Maroc"],
  links: ["/voyages", "/programme", "/contact"],
});
const aboutText = about.document.body.textContent?.replace(/\s+/g, " ") ?? "";
if (/\+500|\+30|\+10 ans|150 avis|4[,.]9\/5/i.test(aboutText)) {
  throw new Error("About page contains an unverified commercial figure.");
}
const contactPage = await loadHtml("/contact");
for (const [route, page] of [["/a-propos", about], ["/contact", contactPage]]) {
  const text = page.document.body.textContent?.replace(/\s+/g, " ") ?? "";
  if (/4 Rue de Vimy|4 شارع فيمي|٤ زنقة فيمي/i.test(text)) {
    throw new Error(`${route} presents a Casablanca departure as an agency address.`);
  }
  if (!/Rue Annour/i.test(text)) {
    throw new Error(`${route} is missing the confirmed Temara agency address.`);
  }
}

const blog = await loadHtml("/blog");
if (!blog.document.querySelector("h1")?.textContent?.trim()) throw new Error("Blog H1 is missing.");

const firstArticle = manifest.articles[0];
if (!firstArticle) throw new Error("No published French article was generated.");
const article = await loadHtml(firstArticle.path);
if (article.document.title === homepage.document.title) throw new Error("Article retained the homepage title.");
if (!article.document.body.textContent?.includes(firstArticle.title)) throw new Error("Article body does not contain its title.");
const articleJsonLd = [...article.document.querySelectorAll('script[type="application/ld+json"]')].map((script) => JSON.parse(script.textContent || "{}"));
if (!articleJsonLd.some((value) => ["Article", "BlogPosting"].includes(value["@type"]))) throw new Error("Article JSON-LD is missing.");

const englishFaq = await loadHtml("/en/faq");
if (englishFaq.document.documentElement.lang !== "en") throw new Error("English FAQ must use html lang=en.");
const arabicFaq = await loadHtml("/ar/faq");
if (arabicFaq.document.documentElement.lang !== "ar" || arabicFaq.document.documentElement.dir !== "rtl") {
  throw new Error("Arabic FAQ must use html lang=ar and dir=rtl.");
}

const expectedCounts = {
  static: registry.staticRoutes.filter((route) => route.sitemap && route.group === "static").length,
  faq: registry.staticRoutes.filter((route) => route.sitemap && route.group === "faq").length,
  articles: manifest.articles.length,
  hotels: manifest.hotels.length,
};
for (const [key, value] of Object.entries(expectedCounts)) {
  if (manifest.counts[key] !== value) throw new Error(`Manifest count mismatch for ${key}: ${manifest.counts[key]} !== ${value}`);
}
if (manifest.counts.total !== sitemapUrls.length) throw new Error("Sitemap total does not match the manifest.");

console.log(
  `SEO output valid: ${manifest.counts.static} static + ${manifest.counts.faq} FAQ + ${manifest.counts.articles} articles + ${manifest.counts.hotels} hotels = ${manifest.counts.total} URLs; ${manifest.prerenderRoutes.length} prerendered routes.`,
);
