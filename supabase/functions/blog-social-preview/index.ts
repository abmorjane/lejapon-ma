import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

type Article = {
  slug: string;
  title: string;
  excerpt: string | null;
  body: string | null;
  cover_url: string | null;
  cover_alt: string | null;
  meta_title: string | null;
  meta_description: string | null;
  published_at: string | null;
  updated_at: string | null;
};

const SITE_URL = (Deno.env.get("PUBLIC_SITE_URL") || "https://www.lejapon.ma").replace(/\/$/, "");
const DEFAULT_IMAGE = `${SITE_URL}/og-default.jpg`;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const stripHtml = (value: string) =>
  value
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#*_>`~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const truncate = (value: string, max = 180) => {
  if (value.length <= max) return value;
  const sliced = value.slice(0, max - 1);
  const lastSpace = sliced.lastIndexOf(" ");
  return `${sliced.slice(0, lastSpace > 80 ? lastSpace : sliced.length).trim()}…`;
};

const absoluteUrl = (value?: string | null) => {
  if (!value) return DEFAULT_IMAGE;
  try {
    return new URL(value, SITE_URL).toString();
  } catch {
    return DEFAULT_IMAGE;
  }
};

const html = (article: Article) => {
  const title = article.meta_title || article.title;
  const description = truncate(article.meta_description || article.excerpt || stripHtml(article.body || ""));
  const canonical = `${SITE_URL}/blog/${encodeURIComponent(article.slug)}`;
  const image = absoluteUrl(article.cover_url);
  const imageAlt = article.cover_alt || article.title;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    description,
    image: [image],
    datePublished: article.published_at || undefined,
    dateModified: article.updated_at || article.published_at || undefined,
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    publisher: {
      "@type": "Organization",
      name: "LeJapon.ma",
      logo: { "@type": "ImageObject", url: `${SITE_URL}/icon-512.png` },
    },
  };

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="LeJapon.ma" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:image" content="${escapeHtml(image)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(image)}" />
    <meta property="og:image:alt" content="${escapeHtml(imageAlt)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(image)}" />
    <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>
    <meta http-equiv="refresh" content="0;url=${escapeHtml(canonical)}" />
  </head>
  <body>
    <p><a href="${escapeHtml(canonical)}">Lire l'article sur LeJapon.ma</a></p>
  </body>
</html>`;
};

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const slugFromQuery = url.searchParams.get("slug");
  const slugFromPath = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
  const slug = (slugFromQuery || slugFromPath).trim();

  if (!slug) {
    return new Response("Missing article slug", { status: 400 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const key = anonKey || serviceRoleKey;

  if (!supabaseUrl || !key) {
    return new Response("Server configuration error", { status: 500 });
  }

  const supabase = createClient(supabaseUrl, key);
  const { data, error } = await supabase
    .from("articles")
    .select("slug,title,excerpt,body,cover_url,cover_alt,meta_title,meta_description,published_at,updated_at")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();

  if (error) {
    console.error("blog-social-preview lookup failed", { slug, error });
    return new Response("Article lookup failed", { status: 500 });
  }

  if (!data) {
    return new Response("Article not found", { status: 404 });
  }

  return new Response(req.method === "HEAD" ? null : html(data as Article), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=600",
      "X-Robots-Tag": "index, follow",
    },
  });
});
