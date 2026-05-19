import { useEffect, useState } from "react";
import { useTranslatedTable } from "@/hooks/useTranslated";
import { Link } from "react-router-dom";
import { Seo } from "@/components/Seo";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate } from "@/lib/format";
import { Img } from "@/components/ui/Img";

type Article = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  cover_url: string | null;
  cover_alt: string | null;
  category: string | null;
  published_at: string | null;
  reading_time_minutes: number | null;
  body: string | null;
};

const estimateRead = (a: Article) => {
  if (a.reading_time_minutes) return `${a.reading_time_minutes} min`;
  const words = (a.body ?? a.excerpt ?? "").trim().split(/\s+/).filter(Boolean).length;
  const min = Math.max(1, Math.round(words / 200));
  return `${min} min`;
};

const parseCategories = (value: string | null): string[] =>
  (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const Blog = () => {
  const [posts, setPosts] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("articles")
        .select("id,slug,title,excerpt,cover_url,cover_alt,category,published_at,reading_time_minutes,body")
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
    "cover_alt",
  ] as (keyof Article & string)[]);

  return (
    <div className="container-app py-20 md:py-28">
      <Seo
        title="Blog — Infos & astuces voyage Japon | lejapon.ma"
        description="Articles, conseils et astuces pour préparer votre voyage au Japon : culture nippone, gastronomie, Tokyo, Kyoto, Osaka, Mont Fuji et bien plus."
        canonical="/blog"
      />
      <p className="eyebrow mb-4">Blog</p>
      <h1 className="font-display text-5xl md:text-7xl mb-16">Infos & astuces.</h1>

      {loading ? (
        <div className="grid md:grid-cols-3 gap-px bg-border">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-background">
              <div className="aspect-[4/3] bg-secondary/40 animate-pulse" />
              <div className="p-8 space-y-3">
                <div className="h-3 w-24 bg-secondary/60 animate-pulse rounded" />
                <div className="h-6 w-3/4 bg-secondary/60 animate-pulse rounded" />
                <div className="h-3 w-32 bg-secondary/60 animate-pulse rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : localized.length === 0 ? (
        <p className="text-muted-foreground">Aucun article publié pour le moment.</p>
      ) : (
        <div className="grid md:grid-cols-3 gap-px bg-border">
          {localized.map((p) => (
            <Link key={p.id} to={`/blog/${p.slug}`} className="bg-background group cursor-pointer block">
              <div className="aspect-[4/3] overflow-hidden bg-secondary/40">
                {p.cover_url && (
                  <Img
                    src={p.cover_url}
                    alt={p.cover_alt || p.title}
                    preset="card"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-silk"
                  />
                )}
              </div>
              <div className="p-8">
                {parseCategories(p.category).length > 0 && (
                  <p className="eyebrow mb-3">{parseCategories(p.category).join(" · ")}</p>
                )}
                <h2 className="font-display text-2xl mb-4 leading-snug group-hover:text-accent transition-colors">
                  {p.title}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {p.published_at ? fmtDate(p.published_at) : ""} · {estimateRead(p)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default Blog;
