import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Seo } from "@/components/Seo";
import NotFound from "./NotFound";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate } from "@/lib/format";
import { ArrowLeft } from "lucide-react";
import { Img } from "@/components/ui/Img";

type Article = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  body: string | null;
  cover_url: string | null;
  cover_alt: string | null;
  category: string | null;
  tags: string[] | null;
  published_at: string | null;
  meta_title: string | null;
  meta_description: string | null;
  gallery_images: string[] | null;
  reading_time_minutes: number | null;
};

const renderBody = (body: string) =>
  body
    .split(/\n{2,}/)
    .map((p, i) => (
      <p key={i} className="text-lg leading-relaxed text-foreground/85 mb-6 whitespace-pre-line">
        {p}
      </p>
    ));

const BlogPost = () => {
  const { slug } = useParams();
  const [post, setPost] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [related, setRelated] = useState<Article[]>([]);

  useEffect(() => {
    if (!slug) return;
    window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    (async () => {
      const { data } = await supabase
        .from("articles")
        .select("*")
        .eq("slug", slug)
        .eq("status", "published")
        .maybeSingle();
      if (!data) setNotFound(true);
      setPost(data as Article | null);
      setLoading(false);
      if (data) {
        const { data: rel } = await supabase
          .from("articles")
          .select("id,slug,title,excerpt,cover_url,cover_alt,category,published_at,reading_time_minutes,body,tags,meta_title,meta_description,gallery_images")
          .eq("status", "published")
          .neq("id", (data as any).id)
          .order("published_at", { ascending: false, nullsFirst: false })
          .limit(3);
        setRelated((rel as Article[]) ?? []);
      }
    })();
  }, [slug]);

  if (loading) {
    return (
      <div className="container-app py-20 md:py-28">
        <div className="h-4 w-24 bg-secondary/60 animate-pulse rounded mb-6" />
        <div className="h-12 w-3/4 bg-secondary/60 animate-pulse rounded mb-8" />
        <div className="aspect-[16/9] bg-secondary/60 animate-pulse rounded mb-8" />
        <div className="space-y-3">
          <div className="h-4 w-full bg-secondary/60 animate-pulse rounded" />
          <div className="h-4 w-5/6 bg-secondary/60 animate-pulse rounded" />
          <div className="h-4 w-4/6 bg-secondary/60 animate-pulse rounded" />
        </div>
      </div>
    );
  }

  if (notFound || !post) {
    return <NotFound />;
  }

  const gallery = (post.gallery_images ?? []) as string[];

  return (
    <article>
      <Seo
        title={post.meta_title ?? `${post.title} | lejapon.ma`}
        description={post.meta_description ?? post.excerpt ?? ""}
        canonical={`/blog/${post.slug}`}
        image={post.cover_url ?? undefined}
      />

      {/* Hero */}
      <header className="container-app pt-16 md:pt-24 pb-10">
        <div className="mb-8">
          <Link to="/blog" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Retour au blog
          </Link>
        </div>
        {post.category && (
          <p className="eyebrow mb-4 block">
            {post.category.split(",").map((s) => s.trim()).filter(Boolean).join(" · ")}
          </p>
        )}
        <h1 className="font-display text-4xl md:text-6xl leading-tight mb-6 max-w-4xl">{post.title}</h1>
        <p className="text-sm text-muted-foreground">
          {post.published_at ? fmtDate(post.published_at) : ""}
          {post.reading_time_minutes ? ` · ${post.reading_time_minutes} min de lecture` : ""}
        </p>
      </header>

      {/* Cover */}
      {post.cover_url && (
        <div className="container-app mb-12">
          <div className="aspect-[16/9] overflow-hidden rounded-sm">
            <Img
              src={post.cover_url}
              alt={post.cover_alt || post.title}
              preset="hero"
              priority
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      )}

      {/* Body */}
      <div className="container-app max-w-3xl pb-16">
        {post.excerpt && (
          <p className="text-xl md:text-2xl font-display leading-snug mb-10 text-foreground">
            {post.excerpt}
          </p>
        )}
        {post.body && <div>{renderBody(post.body)}</div>}

        {/* Galerie */}
        {gallery.length > 0 && (
          <section className="mt-16">
            <h2 className="font-display text-2xl mb-6">Galerie</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {gallery.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-sm bg-secondary/40">
                  <Img
                    src={url}
                    alt={`${post.title} — image ${i + 1}`}
                    preset="card"
                    className="w-full h-full object-cover hover:scale-105 transition-transform duration-700 ease-silk"
                  />
                </a>
              ))}
            </div>
          </section>
        )}

        {/* Tags */}
        {post.tags && post.tags.length > 0 && (
          <div className="mt-12 pt-8 border-t border-border flex flex-wrap gap-2">
            {post.tags.map((t) => (
              <span key={t} className="text-xs px-3 py-1 rounded-full bg-secondary/60 text-muted-foreground">
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>

      {related.length > 0 && (
        <section className="container-app mt-16 md:mt-24 pb-20 md:pb-28">
          <div className="border-t border-border pt-12 md:pt-16">
            <p className="eyebrow mb-4">À lire aussi</p>
            <h2 className="font-display text-3xl md:text-4xl mb-10 md:mb-14">Articles similaires</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10">
              {related.slice(0, 3).map((r) => (
                <Link
                  key={r.id}
                  to={`/blog/${r.slug}`}
                  className="group block rounded-md overflow-hidden transition-all duration-500 hover:-translate-y-1"
                >
                  <div className="aspect-[4/3] overflow-hidden rounded-md bg-secondary/40">
                    {r.cover_url && (
                      <Img
                        src={r.cover_url}
                        alt={r.cover_alt || r.title}
                        preset="card"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-silk"
                      />
                    )}
                  </div>
                  <div className="pt-5">
                    {r.category && (
                      <p className="eyebrow mb-3">{r.category.split(",")[0].trim()}</p>
                    )}
                    <h3 className="font-display text-xl md:text-2xl leading-snug mb-3 group-hover:text-accent transition-colors">
                      {r.title}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {r.published_at ? fmtDate(r.published_at) : ""}
                      {r.reading_time_minutes ? ` · ${r.reading_time_minutes} min de lecture` : ""}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}
    </article>
  );
};

export default BlogPost;
