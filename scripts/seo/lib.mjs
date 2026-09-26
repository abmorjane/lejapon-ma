import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(scriptsDirectory, "../..");
export const distDirectory = path.join(projectRoot, "dist");
export const registryPath = path.join(projectRoot, "src/config/publicRoutes.json");
export const manifestPath = path.join(distDirectory, "generated-seo-routes.json");

export const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

export const readRouteRegistry = async () => readJson(registryPath);

const parseEnvFile = async (filePath) => {
  try {
    const source = await fs.readFile(filePath, "utf8");
    return Object.fromEntries(
      source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const separator = line.indexOf("=");
          const key = line.slice(0, separator).trim();
          const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
          return [key, value];
        }),
    );
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
};

export const loadPublicEnv = async () => {
  const envFiles = [".env", ".env.local", ".env.production", ".env.production.local"];
  const loaded = {};
  for (const envFile of envFiles) {
    Object.assign(loaded, await parseEnvFile(path.join(projectRoot, envFile)));
  }
  const values = { ...loaded, ...process.env };
  const url = values.VITE_SUPABASE_URL;
  const publishableKey = values.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required for SEO generation.");
  }
  if (values.SUPABASE_SERVICE_ROLE_KEY === publishableKey) {
    throw new Error("SEO generation must never use a Supabase service-role key.");
  }
  return { url: url.replace(/\/+$/, ""), publishableKey };
};

export const fetchPublicRows = async (table, query) => {
  const { url, publishableKey } = await loadPublicEnv();
  const endpoint = new URL(`${url}/rest/v1/${table}`);
  Object.entries(query).forEach(([key, value]) => endpoint.searchParams.set(key, value));
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${publishableKey}`,
      Accept: "application/json",
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Public Supabase read failed for ${table} (${response.status}): ${JSON.stringify(body)}`);
  }
  if (!Array.isArray(body)) throw new Error(`Expected an array from the public ${table} endpoint.`);
  return body;
};

export const fetchPublishedArticles = () =>
  fetchPublicRows("articles", {
    select: "id,slug,title,status,published_at,updated_at",
    status: "eq.published",
    order: "published_at.desc.nullslast,created_at.desc",
  });

export const fetchActiveHotels = () =>
  fetchPublicRows("hotel_catalog", {
    select: "id,slug,name,city,is_active,short_description_fr,full_description_fr,updated_at",
    is_active: "eq.true",
    order: "city.asc,name.asc",
  });

export const normalizeRoutePath = (value) => {
  if (typeof value !== "string" || !value.startsWith("/")) throw new Error(`Invalid route path: ${value}`);
  if (value.includes("?") || value.includes("#")) throw new Error(`Route paths cannot contain query strings or hashes: ${value}`);
  return value === "/" ? "/" : value.replace(/\/+$/, "");
};

export const isSafeArticleSlug = (slug) => typeof slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
export const isSafeHotelSlug = (slug) => typeof slug === "string" && /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(slug);

const plainTextLength = (value) =>
  String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;

export const assessHotelQuality = (hotel) => {
  const reasons = [];
  if (!hotel?.is_active) reasons.push("inactive");
  if (!isSafeHotelSlug(hotel?.slug)) reasons.push("invalid-slug");
  if (String(hotel?.name ?? "").trim().length < 2) reasons.push("missing-name");
  const contentLength = plainTextLength(hotel?.short_description_fr) + plainTextLength(hotel?.full_description_fr);
  if (contentLength < 300) reasons.push("insufficient-french-content");
  return { eligible: reasons.length === 0, reasons, contentLength };
};

export const toIsoLastmod = (value) => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid lastmod value: ${value}`);
  return date.toISOString();
};

export const isExcludedPath = (pathname, registry) => {
  const normalized = normalizeRoutePath(pathname);
  const matchesFamily = (family) => normalized === family || normalized.startsWith(`${family}/`);
  return (
    registry.excludedFamilies.some(({ path: family }) => matchesFamily(family)) ||
    registry.legacyRedirects.some(({ path: legacyPath }) => normalized === legacyPath) ||
    registry.removedFamilies.some(matchesFamily)
  );
};

export const validateUniqueRoutes = (routes, label) => {
  const normalized = routes.map(normalizeRoutePath);
  const duplicates = normalized.filter((route, index) => normalized.indexOf(route) !== index);
  if (duplicates.length) throw new Error(`${label} contains duplicate routes: ${[...new Set(duplicates)].join(", ")}`);
  return normalized;
};

export const xmlEscape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

export const routeToOutputFile = (route) => {
  const normalized = normalizeRoutePath(route);
  return normalized === "/"
    ? path.join(distDirectory, "index.html")
    : path.join(distDirectory, normalized.slice(1), "index.html");
};

export const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
};
