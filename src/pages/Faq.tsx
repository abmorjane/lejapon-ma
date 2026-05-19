import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Search, MessageCircle, Plane, Wallet, Stamp, Compass, Lightbulb } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Seo } from "@/components/Seo";
import { cn } from "@/lib/utils";

type Lang = "fr" | "en" | "ar";
type Category = "voyage" | "prix_reservation" | "visa" | "organisation" | "conseils_pratiques";

type FaqRow = {
  id: string;
  category: Category;
  question_fr: string; answer_fr: string;
  question_en: string | null; answer_en: string | null;
  question_ar: string | null; answer_ar: string | null;
  sort_order: number;
};

const CATEGORY_META: Record<Category, { icon: any; fr: string; en: string; ar: string }> = {
  voyage:             { icon: Plane,    fr: "Voyage",            en: "Trip",                ar: "الرحلة" },
  prix_reservation:   { icon: Wallet,   fr: "Prix & réservation", en: "Pricing & booking",   ar: "السعر والحجز" },
  visa:               { icon: Stamp,    fr: "Visa",              en: "Visa",                ar: "التأشيرة" },
  organisation:       { icon: Compass,  fr: "Organisation",      en: "Logistics",           ar: "التنظيم" },
  conseils_pratiques: { icon: Lightbulb,fr: "Conseils pratiques", en: "Practical tips",      ar: "نصائح عملية" },
};

const PAGE_COPY = {
  fr: {
    eyebrow: "FAQ",
    title: "Questions fréquentes",
    subtitle: "Tout ce que vous devez savoir avant de réserver votre voyage au Japon. Une question manque ? Notre équipe vous répond en moins de 24 h.",
    searchPlaceholder: "Rechercher une question…",
    all: "Toutes",
    empty: "Aucune question ne correspond à votre recherche.",
    ctaTitle: "Vous avez une autre question ?",
    ctaText: "Notre équipe à Casablanca est à votre écoute pour préparer votre voyage avec vous.",
    ctaButton: "Contactez-nous",
    seoTitle: "FAQ — Questions / Réponses sur le voyage au Japon | lejapon.ma",
    seoDescription: "Toutes les réponses sur nos voyages au Japon : dates, prix, visa, hôtels, transport, réservation et annulation. L'équipe lejapon.ma vous éclaire.",
  },
  en: {
    eyebrow: "FAQ",
    title: "Frequently asked questions",
    subtitle: "Everything you need to know before booking your trip to Japan. Can't find your answer? Our team replies within 24 hours.",
    searchPlaceholder: "Search a question…",
    all: "All",
    empty: "No question matches your search.",
    ctaTitle: "Still have a question?",
    ctaText: "Our team in Casablanca is happy to help you plan your trip.",
    ctaButton: "Contact us",
    seoTitle: "FAQ — Travel to Japan with lejapon.ma",
    seoDescription: "All answers about our trips to Japan: dates, pricing, visa, hotels, transport, booking and cancellation.",
  },
  ar: {
    eyebrow: "الأسئلة الشائعة",
    title: "الأسئلة الأكثر تكراراً",
    subtitle: "كل ما تحتاج معرفته قبل حجز رحلتك إلى اليابان. لم تجد جوابك؟ فريقنا يجيبك في أقل من 24 ساعة.",
    searchPlaceholder: "ابحث عن سؤال…",
    all: "الكل",
    empty: "لا يوجد سؤال يطابق بحثك.",
    ctaTitle: "هل لديك سؤال آخر؟",
    ctaText: "فريقنا في الدار البيضاء سعيد بمساعدتك في تنظيم رحلتك.",
    ctaButton: "تواصل معنا",
    seoTitle: "الأسئلة الشائعة — السفر إلى اليابان | lejapon.ma",
    seoDescription: "كل الأجوبة حول رحلاتنا إلى اليابان: التواريخ، الأسعار، التأشيرة، الفنادق، النقل، الحجز والإلغاء.",
  },
} as const;

const URLS: Record<Lang, string> = {
  fr: "/mon-voyage-questions-reponses",
  en: "/en/faq",
  ar: "/ar/faq",
};

type Props = { lang: Lang };

const pickQ = (row: FaqRow, lang: Lang) =>
  (lang === "en" ? row.question_en : lang === "ar" ? row.question_ar : null) || row.question_fr;
const pickA = (row: FaqRow, lang: Lang) =>
  (lang === "en" ? row.answer_en : lang === "ar" ? row.answer_ar : null) || row.answer_fr;

const FaqPage = ({ lang }: Props) => {
  const { i18n } = useTranslation();
  const [rows, setRows] = useState<FaqRow[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);

  // Sync i18n language with the page lang
  useEffect(() => {
    if (i18n.language !== lang) i18n.changeLanguage(lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    return () => { document.documentElement.dir = "ltr"; };
  }, [lang, i18n]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("faqs")
        .select("id,category,question_fr,answer_fr,question_en,answer_en,question_ar,answer_ar,sort_order")
        .eq("is_published", true)
        .order("sort_order", { ascending: true });
      setRows((data ?? []) as FaqRow[]);
    })();
  }, []);

  const copy = PAGE_COPY[lang];
  const isRtl = lang === "ar";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (category !== "all" && r.category !== category) return false;
      if (!q) return true;
      return (
        pickQ(r, lang).toLowerCase().includes(q) ||
        pickA(r, lang).toLowerCase().includes(q)
      );
    });
  }, [rows, query, category, lang]);

  const grouped = useMemo(() => {
    const map = new Map<Category, FaqRow[]>();
    filtered.forEach((r) => {
      if (!map.has(r.category)) map.set(r.category, []);
      map.get(r.category)!.push(r);
    });
    return Array.from(map.entries());
  }, [filtered]);

  const faqJsonLd = useMemo(() => ({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: rows.map((r) => ({
      "@type": "Question",
      name: pickQ(r, lang),
      acceptedAnswer: { "@type": "Answer", text: pickA(r, lang) },
    })),
  }), [rows, lang]);

  // Inject hreflang alternates
  useEffect(() => {
    const SITE = "https://lejapon.ma";
    const tags = [
      { hl: "fr", url: SITE + URLS.fr },
      { hl: "en", url: SITE + URLS.en },
      { hl: "ar", url: SITE + URLS.ar },
      { hl: "x-default", url: SITE + URLS.fr },
    ];
    document.head.querySelectorAll('link[data-hreflang="faq"]').forEach((n) => n.remove());
    tags.forEach((t) => {
      const el = document.createElement("link");
      el.setAttribute("rel", "alternate");
      el.setAttribute("hreflang", t.hl);
      el.setAttribute("href", t.url);
      el.setAttribute("data-hreflang", "faq");
      document.head.appendChild(el);
    });
    return () => { document.head.querySelectorAll('link[data-hreflang="faq"]').forEach((n) => n.remove()); };
  }, []);

  return (
    <div className={cn("relative", isRtl && "text-right")} dir={isRtl ? "rtl" : "ltr"}>
      <Seo
        title={copy.seoTitle}
        description={copy.seoDescription}
        canonical={URLS[lang]}
        jsonLd={faqJsonLd}
      />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border bg-gradient-to-b from-secondary/40 via-background to-background">
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-accent/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-accent/5 blur-3xl pointer-events-none" />
        <div className="container-app relative pt-20 pb-16 md:pt-28 md:pb-20 max-w-4xl text-center">
          <p className="eyebrow text-accent mb-4">{copy.eyebrow}</p>
          <h1 className="font-display text-4xl md:text-6xl leading-tight mb-6">{copy.title}</h1>
          <p className="text-foreground/70 text-lg max-w-2xl mx-auto leading-relaxed">{copy.subtitle}</p>

          {/* Search */}
          <div className="mt-10 max-w-xl mx-auto relative">
            <Search className={cn("w-4 h-4 absolute top-1/2 -translate-y-1/2 text-muted-foreground", isRtl ? "right-4" : "left-4")} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={copy.searchPlaceholder}
              className={cn(
                "w-full bg-background border border-border h-12 rounded-full focus:outline-none focus:border-accent transition-colors text-sm",
                isRtl ? "pr-11 pl-5 text-right" : "pl-11 pr-5"
              )}
            />
          </div>

          {/* Categories */}
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button
              onClick={() => setCategory("all")}
              className={cn(
                "text-xs uppercase tracking-widest px-4 py-2 rounded-full border transition-all",
                category === "all" ? "bg-foreground text-background border-foreground" : "border-border hover:border-foreground/40"
              )}
            >
              {copy.all}
            </button>
            {(Object.keys(CATEGORY_META) as Category[]).map((k) => {
              const Icon = CATEGORY_META[k].icon;
              return (
                <button
                  key={k}
                  onClick={() => setCategory(k)}
                  className={cn(
                    "inline-flex items-center gap-1.5 text-xs uppercase tracking-widest px-4 py-2 rounded-full border transition-all",
                    category === k ? "bg-foreground text-background border-foreground" : "border-border hover:border-foreground/40"
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {CATEGORY_META[k][lang]}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="container-app py-16 md:py-24 max-w-3xl">
        {filtered.length === 0 ? (
          <p className="text-center text-foreground/60 py-20">{copy.empty}</p>
        ) : (
          <div className="space-y-14">
            {grouped.map(([cat, items]) => {
              const Icon = CATEGORY_META[cat].icon;
              return (
                <div key={cat}>
                  <div className={cn("flex items-center gap-3 mb-6", isRtl && "flex-row-reverse")}>
                    <span className="w-10 h-10 rounded-full bg-accent-soft/60 text-accent flex items-center justify-center">
                      <Icon className="w-4 h-4" />
                    </span>
                    <h2 className="font-display text-2xl">{CATEGORY_META[cat][lang]}</h2>
                  </div>
                  <div className="border-t border-border">
                    {items.map((r) => {
                      const isOpen = openId === r.id;
                      return (
                        <div key={r.id} className="border-b border-border">
                          <button
                            onClick={() => setOpenId(isOpen ? null : r.id)}
                            className={cn(
                              "w-full flex items-center justify-between gap-6 py-5 group",
                              isRtl ? "text-right" : "text-left"
                            )}
                            aria-expanded={isOpen}
                          >
                            <span className={cn(
                              "font-display text-base md:text-lg leading-snug transition-colors",
                              isOpen ? "text-accent" : "group-hover:text-accent"
                            )}>
                              {pickQ(r, lang)}
                            </span>
                            <ChevronDown className={cn(
                              "w-5 h-5 shrink-0 text-muted-foreground transition-all duration-300",
                              isOpen && "rotate-180 text-accent"
                            )} />
                          </button>
                          <AnimatePresence initial={false}>
                            {isOpen && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.25, ease: "easeOut" }}
                                className="overflow-hidden"
                              >
                                <p className={cn(
                                  "pb-6 text-foreground/75 leading-relaxed whitespace-pre-line",
                                  isRtl ? "pr-1" : "pl-1"
                                )}>
                                  {pickA(r, lang)}
                                </p>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* CTA */}
      <section className="container-app pb-24">
        <div className="relative overflow-hidden border border-border bg-gradient-to-br from-secondary via-background to-secondary/40 p-10 md:p-14 text-center max-w-3xl mx-auto">
          <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-accent/10 blur-3xl pointer-events-none" />
          <div className="w-12 h-12 mx-auto mb-6 rounded-full bg-accent text-accent-foreground flex items-center justify-center">
            <MessageCircle className="w-5 h-5" />
          </div>
          <h2 className="font-display text-3xl md:text-4xl mb-3">{copy.ctaTitle}</h2>
          <p className="text-foreground/70 mb-8 max-w-lg mx-auto">{copy.ctaText}</p>
          <Link
            to="/contact"
            className="inline-flex items-center gap-2 bg-foreground text-background px-7 py-3.5 hover:bg-accent transition-all text-sm font-medium"
          >
            {copy.ctaButton}
          </Link>
        </div>
      </section>
    </div>
  );
};

export default FaqPage;