import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { ArrowRight, Star, Check, Sparkles, Shield, Users, MapPin, Calendar, Plane, Heart, Zap } from "lucide-react";
import { Seo } from "@/components/Seo";
import { supabase } from "@/integrations/supabase/client";
import { useExtras, fmtExtraPrice } from "@/hooks/useExtras";
import { Img } from "@/components/ui/Img";
import { NewsletterSection } from "@/components/site/NewsletterSection";
import { TripCard, type TripCardData } from "@/components/trips/TripCard";
import { useSiteContent } from "@/hooks/useSiteContent";
import hero from "@/assets/hero-fuji.jpg";
import kyoto from "@/assets/kyoto-alley.jpg";
import shibuya from "@/assets/tokyo-shibuya.jpg";
import torii from "@/assets/torii.jpg";
import tea from "@/assets/tea-ceremony.jpg";
import ramen from "@/assets/ramen.jpg";
import shiba from "@/assets/shiba-mascot.png";
import shibaPointing from "@/assets/shiba-pointing.png";
import expDisneyland from "@/assets/exp-disneyland.jpg";
import expTeamlab from "@/assets/exp-teamlab.jpg";
import expUniversal from "@/assets/exp-universal.jpg";
import expGeishaDinner from "@/assets/exp-geisha-dinner.jpg";
import expTeaCeremony from "@/assets/exp-tea-ceremony.jpg";
import expGeishaMakeup from "@/assets/exp-geisha-makeup.jpg";

const extraFallbackImgs = [expDisneyland, expTeamlab, expUniversal, expGeishaDinner, expTeaCeremony, expGeishaMakeup];

const truncateWords = (text: string | null | undefined, max: number) => {
  if (!text) return "";
  const words = text.trim().split(/\s+/);
  if (words.length <= max) return text;
  return words.slice(0, max).join(" ") + "…";
};

const statIcons = [Plane, Users, Calendar, Star];

const fallbackImgs = [hero, torii, shibuya];

type Trip = TripCardData & { is_featured?: boolean };

const expImages = [tea, shibuya, ramen, kyoto, torii, tea];

const whyIcons = [Shield, Users, Heart, Zap];

const DEFAULT_TESTIMONIALS = [
  { name: "Kawtar B.", city: "Casablanca", quote: "Topissime ! Organisation juste parfaite. Une équipe passionnée, professionnelle et disponible. Je recommande vivement !" },
  { name: "Hanaa El.", city: "Casablanca", quote: "Un voyage hors normes du début à la fin. La qualité du programme et des guides dépassait nos attentes." },
  { name: "Ghita A.", city: "Casablanca", quote: "Pour profiter pleinement d'un séjour inoubliable au Japon, faites-leur confiance. Programme riche et varié." },
  { name: "Fatima Z.", city: "Casablanca", quote: "Voyage extraordinaire, organisation au top. La bienveillance et le professionnalisme de l'équipe y sont pour beaucoup." },
];

const HOME_DEFAULTS = {
  hero_badge: "Sakura 2026 · 4 places restantes",
  hero_title_l1: "Vivez le Japon comme",
  hero_title_l2: "vous l'avez rêvé.",
  hero_subtitle: "Voyages premium pensé au moindre détail, jusqu'à 17 jours au japon, équipe maroco-japonaise, prix imbattables.",
  hero_cta_primary: "Composer mon voyage",
  hero_cta_secondary: "Voir les voyages",
  hero_trust_count: "500+",
  hero_trust_text: "voyageurs heureux",
  hero_rating_value: "4.9/5",
  hero_rating_text: "sur Google",
  hero_scroll: "Découvrir",
  stat1_v: "+30", stat1_k: "Voyages organisés",
  stat2_v: "+500", stat2_k: "Voyageurs satisfaits",
  stat3_v: "+10", stat3_k: "Départs / an",
  stat4_v: "4.9/5", stat4_k: "Note moyenne",
  trips_eyebrow: "Nos prochains départs",
  trips_title_main: "Quatre saisons magnifiques,",
  trips_title_accent: "plusieurs départs au Japon inoubliables.",
  trips_link: "Voir tous les voyages",
  trips_empty: "Aucun départ disponible pour le moment. Revenez bientôt.",
  why_eyebrow: "Pourquoi nous choisir",
  why_title_main: "Le premier site web au Maroc",
  why_title_accent: "dédié aux voyages organisés au Japon.",
  why_intro: "Une expertise unique, une équipe passionnée, et la garantie d'un voyage inoubliable.",
  why1_t: "Un programme complet", why1_d: "Tout est pensé dans les moindres détails : hôtels, transports, guides, accompagnateur… aucune surprise.",
  why2_t: "Équipe maroco-japonaise", why2_d: "Une vraie connaissance du terrain et la chaleur de l'accueil marocain.",
  why3_t: "Immersion totale", why3_d: "Des programmes de 13 à 18 jours selon la saison, pour vivre le Japon pleinement.",
  why4_t: "Réservation simple", why4_d: "Composez votre voyage en 2 minutes avec prix instantané.",
  how_eyebrow: "Comment ça marche",
  how_title_main: "Réservez en 3 étapes",
  how_title_accent: "ultra simples.",
  step1_t: "Composez votre voyage", step1_d: "Choisissez vos dates, formule et options. Prix en temps réel, sans engagement.",
  step2_t: "Confirmez avec acompte", step2_d: "Un acompte de 25 000 MAD par personne garantit votre place et lance votre demande de visa.",
  step3_t: "Préparez vos valises", step3_d: "Visa reçu, solde réglé, et nous nous retrouvons à l'aéroport de Casablanca.",
  exp_eyebrow: "Plans extra",
  exp_title_l1: "Ajoutez un peu de magie",
  exp_title_l2: "à votre séjour.",
  exp_link: "Voir toutes les expériences",
  exp_empty: "Aucune activité disponible pour l'instant.",
  test_eyebrow: "Témoignages",
  test_title_main: "Ils ont vécu le voyage",
  test_title_accent: "de leur vie.",
  testimonials: DEFAULT_TESTIMONIALS,
  gua1_t: "Transparence totale", gua1_d: "Petits-déjeuners et prestations du programme inclus, sans mauvaise surprise",
  gua2_t: "Visa assisté", gua2_d: "Nous gérons toute la procédure",
  gua3_t: "Guide bilingue", gua3_d: "Marocain + japonais sur place",
  gua4_t: "Paiement flexible", gua4_d: "Acompte de 25 000 MAD par personne, solde avant départ",
  cta_badge: "Offre limitée",
  cta_title: "Votre Japon vous attend.",
  cta_subtitle: "Composez votre voyage en 2 minutes et découvrez votre prix instantanément.",
  cta_primary: "Composer mon voyage",
  cta_secondary: "Parler à un conseiller",
};

const Index = () => {
  const { t } = useTranslation();
  const c = useSiteContent("site:home", HOME_DEFAULTS);
  const [trips, setTrips] = useState<Trip[]>([]);
  const { extras } = useExtras();

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("trips")
        .select("id,title,slug,label,season,start_date,end_date,duration_days,base_price_mad,currency,cover_url,cover_alt,slots_left,highlights,destinations,badge_type,badge_text,promo_percent,program_link,is_featured,sort_order")
        .in("status", ["open", "completed"])
        .eq("is_featured", true)
        .order("sort_order", { ascending: true })
        .order("is_featured", { ascending: false })
        .order("start_date", { ascending: true, nullsFirst: false })
        .limit(6);
      setTrips((data ?? []) as Trip[]);
    })();
  }, []);

  return (
    <>
      <Seo
        title="lejapon.ma — Voyages d'immersion au Japon depuis Casablanca"
        description="Lejapon.ma organise deux voyages par an au Japon depuis Casablanca : programme complet de 14 jours, vols, hôtels, transports JR, guide bilingue et prix tout inclus."
        canonical="/"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "TravelAgency",
          name: "lejapon.ma",
          url: "https://lejapon.ma",
          areaServed: "MA",
          description: "Agence de voyage premium spécialisée Japon, départs garantis depuis Casablanca.",
          address: { "@type": "PostalAddress", addressLocality: "Casablanca", addressCountry: "MA" },
          aggregateRating: { "@type": "AggregateRating", ratingValue: "4.9", reviewCount: "150" },
        }}
      />
      {/* HERO */}
      <section className="relative min-h-[88vh] flex items-center overflow-hidden">
        <div className="absolute inset-0">
          <img
            src={hero}
            alt="Mont Fuji et pagode au lever du soleil"
            className="w-full h-full object-cover"
            width={1920}
            height={1280}
            loading="eager"
            decoding="async"
            // @ts-expect-error fetchpriority is a valid HTML attribute
            fetchpriority="high"
          />
          <div className="absolute inset-0 bg-gradient-hero" />
        </div>

        <div className="relative container-app z-10 py-20">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }} className="max-w-3xl">
            <span className="badge-pill bg-white/15 backdrop-blur-md text-white border border-white/20 mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              {c.hero_badge}
            </span>
            <h1 className="font-display text-6xl md:text-7xl lg:text-[5.5rem] leading-[1] text-white text-balance">
              {(c.hero_title_l1 || "").split(",").map((part, i, arr) => (
                <span key={i} className="text-6xl">
                  {part.trim()}{i < arr.length - 1 ? "," : ""}
                  <br/>
                </span>
              ))}
              <span className="text-gradient text-6xl">{c.hero_title_l2}</span>
            </h1>
            <p className="mt-8 text-lg md:text-xl max-w-2xl text-white/90 leading-relaxed">
              {c.hero_subtitle}
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Link to="/reserver" className="btn-primary text-base">
                {c.hero_cta_primary} <ArrowRight className="w-5 h-5" />
              </Link>
              <Link to="/voyages" className="btn-ghost text-base !bg-white/10 !backdrop-blur-md !text-white !border-white/30 hover:!bg-white hover:!text-foreground">
                {c.hero_cta_secondary}
              </Link>
            </div>

            {/* trust badges */}
            <div className="mt-12 flex flex-wrap items-center gap-6 text-white/80 text-sm">
              <div className="flex items-center gap-2">
                <div className="flex -space-x-2">
                  {[1,2,3,4].map(i => <div key={i} className="w-8 h-8 rounded-full bg-gradient-sunset border-2 border-white" />)}
                </div>
                <span><strong className="text-white">{c.hero_trust_count}</strong> {c.hero_trust_text}</span>
              </div>
              <a
                href="https://maps.app.goo.gl/MY3hSdMrbv6pVZLm7?g_st=ac"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 hover:text-white transition-colors"
              >
                <div className="flex text-accent">{[1,2,3,4,5].map(i => <Star key={i} className="w-4 h-4 fill-current" />)}</div>
                <span><strong className="text-white">{c.hero_rating_value}</strong> {c.hero_rating_text}</span>
              </a>
            </div>
          </motion.div>

          {/* Shiba mascot floating */}
          <motion.img
            src={shiba}
            alt="Mascotte Shiba lejapon.ma"
            initial={{ opacity: 0, x: 60, y: 20 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="hidden lg:block absolute right-8 xl:right-20 bottom-8 w-64 xl:w-80 drop-shadow-2xl pointer-events-none"
            style={{ animation: "fade-up 0.8s both, slow-zoom 6s ease-in-out infinite alternate" }}
            width={768} height={768}
          />
        </div>

        {/* scroll hint */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/60 text-xs flex flex-col items-center gap-2">
          <span>{c.hero_scroll}</span>
          <div className="w-px h-8 bg-white/40" />
        </div>
      </section>

      {/* STATS BAR */}
      <section className="bg-foreground text-background">
        <div className="container-app grid grid-cols-2 md:grid-cols-4 gap-6 py-10">
          {[
            { v: c.stat1_v, k: c.stat1_k },
            { v: c.stat2_v, k: c.stat2_k },
            { v: c.stat3_v, k: c.stat3_k },
            { v: c.stat4_v, k: c.stat4_k },
          ].map((s, i) => {
            const Icon = statIcons[i];
            return (
              <div key={i} className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-accent/15 text-accent flex items-center justify-center">
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-display text-2xl">{s.v}</div>
                  <div className="text-xs text-background/60">{s.k}</div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* TRIPS — featured cards */}
      <section className="container-app py-24 md:py-32">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-14">
          <div className="max-w-2xl">
            <span className="eyebrow mb-3">{c.trips_eyebrow}</span>
            <h2 className="font-display md:text-5xl mt-3 text-balance text-3xl">{c.trips_title_main} <span className="text-accent">{c.trips_title_accent}</span></h2>
          </div>
          <Link to="/voyages" className="text-sm font-semibold inline-flex items-center gap-2 hover:text-accent">
            {c.trips_link} <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {trips.length === 0 ? (
          <p className="text-foreground/60">{c.trips_empty}</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {trips.map((trip, i) => (
              <TripCard key={trip.id} trip={trip} index={i} fallbackImage={fallbackImgs[i % fallbackImgs.length]} />
            ))}
          </div>
        )}
      </section>

      {/* WHY US */}
      <section className="bg-secondary/50 py-24 md:py-32 relative overflow-hidden">
        <div className="absolute inset-0 bg-mesh opacity-60" />
        <div className="container-app relative">
          <div className="max-w-2xl mb-16 text-center mx-auto">
            <span className="eyebrow mb-3">{c.why_eyebrow}</span>
            <h2 className="font-display md:text-5xl mt-3 text-balance text-3xl">{c.why_title_main} <span className="text-gradient">{c.why_title_accent}</span></h2>
            <p className="mt-5 text-foreground/70 text-lg">{c.why_intro}</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { t: c.why1_t, d: c.why1_d },
              { t: c.why2_t, d: c.why2_d },
              { t: c.why3_t, d: c.why3_d },
              { t: c.why4_t, d: c.why4_d },
            ].map((w, i) => {
              const Icon = whyIcons[i];
              return (
                <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.4, delay: i * 0.08 }}
                  className="card-modern p-7">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-vermillion text-accent-foreground flex items-center justify-center mb-5 shadow-cta">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-display text-xl mb-2">{w.t}</h3>
                  <p className="text-sm text-foreground/70 leading-relaxed">{w.d}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="container-app py-24 md:py-32">
        <div className="max-w-2xl mb-16">
          <span className="eyebrow mb-3">{c.how_eyebrow}</span>
          <h2 className="font-display md:text-5xl mt-3 text-balance text-3xl">{c.how_title_main} <span className="text-gradient">{c.how_title_accent}</span></h2>
        </div>
        <div className="grid md:grid-cols-3 gap-8 relative">
          {[
            { n: "01", t: c.step1_t, d: c.step1_d },
            { n: "02", t: c.step2_t, d: c.step2_d },
            { n: "03", t: c.step3_t, d: c.step3_d },
          ].map((s, i) => (
            <div key={i} className="relative">
              <div className="font-display text-7xl text-accent/20 mb-3">{s.n}</div>
              <h3 className="font-display text-2xl mb-3">{s.t}</h3>
              <p className="text-foreground/70 leading-relaxed">{s.d}</p>
              {i < 2 && <ArrowRight className="hidden md:block absolute top-12 -right-4 w-6 h-6 text-accent/40" />}
            </div>
          ))}
        </div>
      </section>

      {/* EXPERIENCES */}
      <section className="bg-foreground text-background py-24 md:py-32">
        <div className="container-app">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-14">
            <div className="max-w-2xl">
              <span className="eyebrow mb-3 !text-accent">{c.exp_eyebrow}</span>
              <h2 className="font-display md:text-5xl mt-3 text-balance text-3xl">{c.exp_title_l1}<br/>{c.exp_title_l2}</h2>
            </div>
            <Link to="/experiences" className="text-sm font-semibold inline-flex items-center gap-2 hover:text-accent text-background/80">
              {c.exp_link} <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {extras.slice(0, 6).map((e, i) => (
              <article key={e.id} className="group rounded-3xl overflow-hidden bg-background/5 hover:bg-background/10 transition-all">
                <div className="aspect-[16/10] overflow-hidden">
                  <Img
                    src={e.image_url || extraFallbackImgs[i % extraFallbackImgs.length]}
                    alt={e.alt_text || e.name}
                    preset="card"
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-silk"
                  />
                </div>
                <div className="p-6">
                  <div className="flex items-baseline justify-between mb-2 gap-3">
                    <h3 className="font-display text-xl">{e.name}</h3>
                    <span className="text-accent font-semibold whitespace-nowrap">{fmtExtraPrice(e.price_mad)}</span>
                  </div>
                  <p className="text-sm text-background/70">{truncateWords(e.description, 15)}</p>
                </div>
              </article>
            ))}
            {extras.length === 0 && (
              <p className="text-background/60 text-sm col-span-full">{c.exp_empty}</p>
            )}
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="container-app py-24 md:py-32">
        <div className="max-w-2xl mb-14 text-center mx-auto">
          <span className="eyebrow mb-3">{c.test_eyebrow}</span>
          <h2 className="font-display md:text-5xl mt-3 text-balance text-3xl">{c.test_title_main} <span className="text-gradient">{c.test_title_accent}</span></h2>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {(c.testimonials ?? DEFAULT_TESTIMONIALS).map((tm: any, i: number) => (
            <motion.figure key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.4, delay: i * 0.08 }}
              className="card-modern p-6 flex flex-col">
              <div className="flex gap-0.5 text-accent mb-4">
                {Array.from({ length: 5 }).map((_, j) => <Star key={j} className="w-4 h-4 fill-current" />)}
              </div>
              <blockquote className="text-foreground/80 leading-relaxed mb-5 text-sm flex-1">« {tm.quote} »</blockquote>
              <figcaption className="flex items-center gap-3 pt-4 border-t border-border">
                <div className="w-10 h-10 rounded-full bg-gradient-sunset flex items-center justify-center text-white font-semibold text-sm">
                  {(tm.name || "?")[0]}
                </div>
                <div>
                  <div className="font-semibold text-sm">{tm.name}</div>
                  <div className="text-xs text-muted-foreground">{tm.city}</div>
                </div>
              </figcaption>
            </motion.figure>
          ))}
        </div>
      </section>

      {/* GUARANTEES */}
      <section className="container-app pb-24 md:pb-32">
        <div className="rounded-3xl bg-secondary/60 p-8 md:p-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { t: c.gua1_t, d: c.gua1_d },
            { t: c.gua2_t, d: c.gua2_d },
            { t: c.gua3_t, d: c.gua3_d },
            { t: c.gua4_t, d: c.gua4_d },
          ].map((g, i) => (
            <div key={i} className="flex gap-3">
              <Check className="w-5 h-5 text-accent shrink-0 mt-0.5" />
              <div>
                <h4 className="font-semibold text-sm">{g.t}</h4>
                <p className="text-xs text-muted-foreground mt-0.5">{g.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* NEWSLETTER */}
      <NewsletterSection />

      {/* FINAL CTA */}
      <section className="container-app pb-24 md:pb-32">
        <div className="relative overflow-hidden rounded-3xl">
          <img src={torii} alt="Torii vermillion" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
          <div className="absolute inset-0 bg-gradient-to-r from-foreground/95 via-foreground/80 to-foreground/40" />
          <div className="relative px-8 md:px-16 py-20 md:py-28 text-background max-w-2xl">
            <span className="badge-pill bg-accent text-accent-foreground mb-6">
              <Sparkles className="w-3 h-3" /> {c.cta_badge}
            </span>
            <h2 className="font-display text-4xl md:text-6xl text-balance leading-[1.05]">{c.cta_title}</h2>
            <p className="mt-5 text-background/85 text-lg max-w-md">{c.cta_subtitle}</p>
            <div className="mt-10 flex flex-wrap gap-4">
              <Link to="/reserver" className="btn-primary text-base">
                {c.cta_primary} <ArrowRight className="w-5 h-5" />
              </Link>
              <Link to="/contact" className="btn-ghost text-base !bg-white/10 !text-white !border-white/30 hover:!bg-white hover:!text-foreground">
                {c.cta_secondary}
              </Link>
            </div>
          </div>
          <img
            src={shibaPointing}
            alt=""
            aria-hidden="true"
            loading="lazy"
            width={768} height={768}
            className="hidden md:block absolute right-6 lg:right-16 bottom-0 w-56 lg:w-72 drop-shadow-2xl pointer-events-none"
          />
        </div>
      </section>
    </>
  );
};

export default Index;
