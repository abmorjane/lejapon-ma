import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Home, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Seo from "@/components/Seo";
import torii from "@/assets/notfound-torii.jpg";

const COPY: Record<string, {
  eyebrow: string; title: string; subtitle: string;
  home: string; trips: string; blog: string;
  searchLabel: string; searchPlaceholder: string; searchSubmit: string;
  reassure: string;
}> = {
  fr: {
    eyebrow: "Erreur 404",
    title: "Page introuvable",
    subtitle: "Désolé, la page que vous recherchez n’existe pas ou a été déplacée.",
    home: "Retour à l’accueil",
    trips: "Voir nos voyages",
    blog: "Lire le blog",
    searchLabel: "Vous cherchiez autre chose ?",
    searchPlaceholder: "Rechercher un voyage, un article…",
    searchSubmit: "Rechercher",
    reassure: "Pas d’inquiétude — votre prochain voyage commence ici.",
  },
  en: {
    eyebrow: "Error 404",
    title: "Page not found",
    subtitle: "Sorry, the page you’re looking for doesn’t exist or has been moved.",
    home: "Back to home",
    trips: "See our trips",
    blog: "Read the blog",
    searchLabel: "Looking for something else?",
    searchPlaceholder: "Search a trip, an article…",
    searchSubmit: "Search",
    reassure: "Don’t worry — your next journey starts here.",
  },
  ar: {
    eyebrow: "خطأ 404",
    title: "الصفحة غير موجودة",
    subtitle: "عذراً، الصفحة التي تبحث عنها غير موجودة أو تم نقلها.",
    home: "العودة إلى الرئيسية",
    trips: "اطلع على رحلاتنا",
    blog: "اقرأ المدونة",
    searchLabel: "هل تبحث عن شيء آخر ؟",
    searchPlaceholder: "ابحث عن رحلة أو مقال…",
    searchSubmit: "بحث",
    reassure: "لا تقلق — رحلتك القادمة تبدأ هنا.",
  },
};

const NotFound = () => {
  const { i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const lang = (["fr", "en", "ar"].includes(i18n.language) ? i18n.language : "fr") as "fr" | "en" | "ar";
  const t = COPY[lang];
  const [q, setQ] = useState("");

  useEffect(() => {
    console.warn("404:", location.pathname);
  }, [location.pathname]);

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    navigate(`/blog?q=${encodeURIComponent(term)}`);
  };

  return (
    <>
      <Seo
        title={`${t.title} — lejapon.ma`}
        description={t.subtitle}
        noindex
      />
      <section className="container-app py-20 md:py-28">
        <div className="grid md:grid-cols-2 gap-12 md:gap-16 items-center min-h-[60vh]">
          <div className="order-2 md:order-1">
            <p className="eyebrow mb-4 text-accent">{t.eyebrow}</p>
            <h1 className="text-4xl md:text-6xl font-display tracking-tight mb-5 leading-[1.05]">
              {t.title}
            </h1>
            <p className="text-lg text-muted-foreground max-w-md mb-3">{t.subtitle}</p>
            <p className="text-sm text-muted-foreground/80 max-w-md mb-10">{t.reassure}</p>

            <div className="flex flex-wrap gap-3 mb-10">
              <Button asChild size="lg">
                <Link to="/">
                  <Home className="w-4 h-4" />
                  {t.home}
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/voyages">
                  {t.trips}
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="ghost">
                <Link to="/blog">{t.blog}</Link>
              </Button>
            </div>

            <form onSubmit={onSearch} className="max-w-md">
              <label htmlFor="nf-search" className="block text-sm font-medium mb-2">
                {t.searchLabel}
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="nf-search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={t.searchPlaceholder}
                    className="ps-9"
                  />
                </div>
                <Button type="submit" variant="secondary">{t.searchSubmit}</Button>
              </div>
            </form>
          </div>

          <div className="order-1 md:order-2">
            <div className="relative aspect-[4/5] md:aspect-[4/5] rounded-2xl overflow-hidden bg-secondary/40">
              <img
                src={torii}
                alt=""
                width={1280}
                height={896}
                loading="lazy"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background/40 via-transparent to-transparent" />
            </div>
          </div>
        </div>
      </section>
    </>
  );
};

export default NotFound;