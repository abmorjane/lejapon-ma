import { useEffect, useState } from "react";
import { useTranslatedTable } from "@/hooks/useTranslated";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Seo } from "@/components/Seo";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate } from "@/lib/format";
import { Img } from "@/components/ui/Img";
import { plainText } from "@/lib/plain-text";

type Article = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  cover_url: string | null;
  cover_alt: string | null;
  category: string | null;
  meta_title: string | null;
  meta_description: string | null;
  published_at: string | null;
  reading_time_minutes: number | null;
  body: string | null;
};

const estimateRead = (a: Article) => {
  if (a.reading_time_minutes) return a.reading_time_minutes;
  const words = (a.body ?? a.excerpt ?? "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
};

const parseCategories = (value: string | null): string[] =>
  (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const Blog = () => {
  const { t } = useTranslation();
  const [posts, setPosts] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("articles")
        .select("id,slug,title,excerpt,cover_url,cover_alt,category,meta_title,meta_description,published_at,reading_time_minutes,body")
        .eq("status", "published")
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      setPosts((data as Article[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const localized = useTranslatedTable("articles", posts, [
    "title",
    "excerpt",
    "category",
    "meta_title",
    "meta_description",
  ] as (keyof Article & string)[]);

  return (
    <div className="container-app py-20 md:py-28">
      <Seo
        title={t("blog.seoTitle")}
        description={t("blog.seoDescription")}
        canonical="/blog"
      />
      <p className="eyebrow mb-4">{t("blog.eyebrow")}</p>
      <h1 className="font-display text-5xl md:text-7xl mb-16">{t("blog.title")}</h1>

      {loading ? (
        <div className="grid md:grid-cols-3 gap-px bg-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-background">
              <div className="aspect-[4/3] min-h-[230px] animate-pulse bg-secondary/40" />
              <div className="flex h-[245px] flex-col space-y-3 p-8">
                <div className="h-3 w-24 bg-secondary/60 animate-pulse rounded" />
                <div className="h-6 w-3/4 bg-secondary/60 animate-pulse rounded" />
                <div className="h-4 w-full bg-secondary/50 animate-pulse rounded" />
                <div className="h-4 w-5/6 bg-secondary/50 animate-pulse rounded" />
                <div className="mt-auto h-3 w-32 bg-secondary/60 animate-pulse rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : localized.length === 0 ? (
        <p className="text-muted-foreground">{t("blog.empty")}</p>
      ) : (
        <div className="grid md:grid-cols-3 gap-px bg-border">
          {localized.map((p) => {
            const title = plainText(p.title, { maxLength: 140 });
            const excerpt = plainText(p.excerpt, { maxLength: 220 });
            const categories = parseCategories(plainText(p.category, { maxLength: 120 }));
            const imageAlt = plainText(p.cover_alt || p.title, { maxLength: 160 });

            return (
              <Link key={p.id} to={`/blog/${p.slug}`} className="bg-background group cursor-pointer block">
                <div className="aspect-[4/3] min-h-[230px] overflow-hidden bg-secondary/40">
                  {p.cover_url && (
                    <Img
                      src={p.cover_url}
                      alt={imageAlt}
                      preset="card"
                      width={800}
                      height={600}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-silk"
                    />
                  )}
                </div>
                <div className="flex h-[245px] flex-col p-8">
                  <p className="eyebrow mb-3 min-h-4">{categories.join(" · ")}</p>
                  <h2 className="font-display mb-3 line-clamp-2 text-2xl leading-snug transition-colors group-hover:text-accent">
                    {title}
                  </h2>
                  <p className="mb-4 min-h-[4.5rem] line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                    {excerpt}
                  </p>
                  <p className="mt-auto text-xs text-muted-foreground">
                    {p.published_at ? fmtDate(p.published_at) : ""} · {t("blog.readTime", { count: estimateRead(p) })}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Blog;
