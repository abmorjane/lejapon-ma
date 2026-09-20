import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { ArrowRight, Star, Check, Sparkles, Shield, Users, MapPin, Calendar, Plane, Heart, Zap, Languages, Headphones, Building2, Hotel, Route, Smile, PhoneCall, Award, CheckCircle } from "lucide-react";
import { Seo } from "@/components/Seo";
import { supabase } from "@/integrations/supabase/client";
import { useExtras, fmtExtraPrice } from "@/hooks/useExtras";
import { Img } from "@/components/ui/Img";
import { NewsletterSection } from "@/components/site/NewsletterSection";
import { TripCard, TripCardSkeleton, type TripCardData } from "@/components/trips/TripCard";
import { useSiteContent } from "@/hooks/useSiteContent";
import { trackEvent } from "@/lib/analytics";
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
const advantageIcons = [Plane, Languages, Headphones, Building2, Hotel, Route, Heart, Star, Award];

const ExperienceSkeleton = ({ dark = false }: { dark?: boolean }) => (
  <article className={`overflow-hidden rounded-3xl ${dark ? "bg-background/5" : "bg-background"}`}>
    <div className={`aspect-[16/10] min-h-[190px] animate-pulse ${dark ? "bg-white/10" : "bg-secondary"}`} />
    <div className="min-h-[145px] space-y-4 p-6">
      <div className={`h-6 w-3/5 rounded ${dark ? "bg-white/10" : "bg-secondary"}`} />
      <div className={`h-4 w-24 rounded ${dark ? "bg-white/10" : "bg-secondary"}`} />
      <div className={`h-4 w-full rounded ${dark ? "bg-white/10" : "bg-secondary"}`} />
      <div className={`h-4 w-2/3 rounded ${dark ? "bg-white/10" : "bg-secondary"}`} />
    </div>
  </article>
);

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

const MARKETING_COPY = {
  fr: {
    advantagesTitle: "Pourquoi voyager au Japon avec LeJapon.ma ?",
    advantagesIntro: "Un circuit pensé pour les voyageurs marocains: présence humaine, expertise Japon et assistance concrète avant, pendant et après le séjour.",
    reserve: "Réserver mon voyage",
    advisor: "Parler à un conseiller",
    advantages: [
      ["Accompagnement depuis Casablanca", "Vous partez avec un cadre clair dès l'aéroport, pas une simple convocation impersonnelle."],
      ["Accompagnateur parlant japonais", "Un accompagnateur francophone qui parle japonais et comprend les codes culturels sur place."],
      ["Présence pendant tout le voyage", "Le groupe est accompagné au quotidien pour limiter le stress et fluidifier les étapes."],
      ["Bureau/partenaire au Japon", "Un relais maroco-japonais facilite l'aide locale et les ajustements de dernière minute."],
      ["Hôtels bien placés", "Des adresses choisies pour simplifier les visites, les transports et les temps libres."],
      ["Circuit plus long et plus complet", "Plus de jours pour découvrir le Japon sans transformer le voyage en course."],
      ["Journées libres", "Du temps pour vivre votre propre Japon: shopping, cafés, temples, quartiers ou expériences."],
      ["Avis clients vérifiés", "Des retours Google très positifs de voyageurs qui ont réellement vécu l'expérience."],
      ["Prix compétitif", "Une proposition claire, dense et compétitive au regard de l'accompagnement inclus."],
    ],
    comparisonTitle: "Comparez avant de réserver votre voyage au Japon",
    comparisonEyebrow: "Comparatif",
    criteria: "Critères",
    classic: "Voyage classique",
    lejapon: "LeJapon.ma",
    rows: [
      ["Durée du circuit", "Souvent plus courte", "Circuit plus long et plus complet"],
      ["Accompagnement depuis Casablanca", "Variable", "Inclus selon départ"],
      ["Accompagnateur parlant japonais", "Rare", "Oui, francophone et japonisant"],
      ["Assistance sur place au Japon", "Limitée", "Présence avec le groupe"],
      ["Bureau/partenaire local", "Pas toujours visible", "Relais maroco-japonais"],
      ["Hôtels bien placés", "Variable", "Sélection axée emplacement"],
      ["Journées libres", "Peu ou mal intégrées", "Prévues pour l'immersion"],
      ["Extras réservables sur place", "Souvent rigide", "Aide pour options de dernière minute"],
      ["Avis clients vérifiés", "À vérifier", "Lien Google public"],
      ["Prix compétitif", "Variable", "Positionnement clair et compétitif"],
    ],
    reviewsTitle: "Nos voyageurs parlent de nous",
    reviewsText: "Consultez les avis Google et les retours de voyageurs accompagnés par LeJapon.ma.",
    reviewsCta: "Voir les avis Google",
    omotenashiTitle: "Notre approche Omotenashi",
    omotenashiText: "L'Omotenashi, c'est l'attention portée aux détails: une présence humaine, une assistance avant, pendant et après le voyage, et un circuit pensé pour éviter le stress inutile.",
    omotenashiSteps: [["Avant", "Conseils, préparation et réponses concrètes."], ["Pendant", "Présence humaine et aide sur place."], ["Après", "Suivi clair en cas de besoin."]],
  },
  en: {
    advantagesTitle: "Why travel to Japan with LeJapon.ma?",
    advantagesIntro: "A journey designed for Moroccan travelers: human support, Japan expertise and practical assistance before, during and after the trip.",
    reserve: "Book my trip",
    advisor: "Talk to an advisor",
    advantages: [
      ["Support from Casablanca", "A clear departure experience from the airport."],
      ["Japanese-speaking tour leader", "A French-speaking leader who understands Japanese culture."],
      ["Present throughout the trip", "Daily support to reduce stress and keep the journey smooth."],
      ["Local partner in Japan", "A Morocco-Japan relay for local help and last-minute adjustments."],
      ["Well-located hotels", "Hotels selected to simplify visits, transport and free time."],
      ["Longer, fuller itinerary", "More days to discover Japan without rushing."],
      ["Free days", "Time to experience your own Japan."],
      ["Verified client reviews", "Positive public Google feedback from real travelers."],
      ["Competitive price", "A clear, dense and competitive offer for the support included."],
    ],
    comparisonTitle: "Compare before booking your Japan trip",
    comparisonEyebrow: "Comparison",
    criteria: "Criteria",
    classic: "Classic trip",
    lejapon: "LeJapon.ma",
    rows: [
      ["Itinerary duration", "Often shorter", "Longer and fuller"],
      ["Support from Casablanca", "Variable", "Included depending on departure"],
      ["Japanese-speaking leader", "Rare", "Yes"],
      ["On-site assistance in Japan", "Limited", "Present with the group"],
      ["Local partner", "Not always visible", "Morocco-Japan relay"],
      ["Well-located hotels", "Variable", "Location-focused selection"],
      ["Free days", "Limited", "Planned for immersion"],
      ["Bookable extras on site", "Often rigid", "Help with last-minute options"],
      ["Verified reviews", "To be checked", "Public Google link"],
      ["Competitive price", "Variable", "Clear competitive positioning"],
    ],
    reviewsTitle: "Our travelers talk about us",
    reviewsText: "Read Google reviews from travelers supported by LeJapon.ma.",
    reviewsCta: "See Google reviews",
    omotenashiTitle: "Our Omotenashi approach",
    omotenashiText: "Omotenashi means attention to detail: human presence, assistance before, during and after the trip, and a journey designed to reduce unnecessary stress.",
    omotenashiSteps: [["Before", "Advice, preparation and clear answers."], ["During", "Human presence and help on site."], ["After", "Clear follow-up when needed."]],
  },
  ar: {
    advantagesTitle: "لماذا تسافر إلى اليابان مع LeJapon.ma؟",
    advantagesIntro: "رحلة مصممة للمسافرين من المغرب: مرافقة إنسانية، معرفة باليابان، ومساعدة قبل وأثناء وبعد السفر.",
    reserve: "أحجز رحلتي",
    advisor: "تحدث مع مستشار",
    advantages: [
      ["مرافقة من الدار البيضاء", "انطلاقة واضحة ومنظمة منذ المطار."],
      ["مرافق يتحدث اليابانية", "مرافق فرنكوفوني يعرف اللغة والثقافة اليابانية."],
      ["حضور طوال الرحلة", "مساعدة يومية لتقليل التوتر وتنظيم التنقلات."],
      ["شريك محلي في اليابان", "دعم مغربي ياباني للمساعدة في عين المكان."],
      ["فنادق بمواقع مناسبة", "اختيار فنادق يسهل الزيارات والتنقلات."],
      ["برنامج أطول وأكمل", "أيام أكثر لاكتشاف اليابان بدون استعجال."],
      ["أيام حرة", "وقت لتعيش اليابان بطريقتك الخاصة."],
      ["آراء عملاء موثقة", "تقييمات Google إيجابية من مسافرين حقيقيين."],
      ["سعر تنافسي", "عرض واضح ومتكامل مقارنة بالمرافقة المقدمة."],
    ],
    comparisonTitle: "قارن قبل حجز رحلتك إلى اليابان",
    comparisonEyebrow: "مقارنة",
    criteria: "المعايير",
    classic: "رحلة كلاسيكية",
    lejapon: "LeJapon.ma",
    rows: [
      ["مدة البرنامج", "غالبا أقصر", "أطول وأكثر اكتمالا"],
      ["المرافقة من الدار البيضاء", "متغيرة", "متوفرة حسب الرحلة"],
      ["مرافق يتحدث اليابانية", "نادر", "نعم"],
      ["المساعدة في اليابان", "محدودة", "حضور مع المجموعة"],
      ["شريك محلي", "غير واضح دائما", "دعم مغربي ياباني"],
      ["فنادق بمواقع مناسبة", "متغيرة", "اختيار يركز على الموقع"],
      ["أيام حرة", "قليلة", "مدمجة للاندماج الشخصي"],
      ["إضافات في عين المكان", "غالبا جامدة", "مساعدة للحجوزات الأخيرة"],
      ["آراء موثقة", "تحتاج تحقق", "رابط Google علني"],
      ["سعر تنافسي", "متغير", "تموقع واضح وتنافسي"],
    ],
    reviewsTitle: "مسافرونا يتحدثون عنا",
    reviewsText: "اطلع على آراء Google وتجارب المسافرين مع LeJapon.ma.",
    reviewsCta: "مشاهدة آراء Google",
    omotenashiTitle: "منهجية Omotenashi",
    omotenashiText: "Omotenashi تعني الاهتمام بالتفاصيل: حضور إنساني، مساعدة قبل وأثناء وبعد الرحلة، وبرنامج مصمم لتجنب التوتر.",
    omotenashiSteps: [["قبل السفر", "نصائح وتحضير وإجابات واضحة."], ["أثناء السفر", "حضور إنساني ومساعدة في عين المكان."], ["بعد السفر", "متابعة واضحة عند الحاجة."]],
  },
} as const;

const Index = () => {
  const { t, i18n } = useTranslation();
  const c = useSiteContent("site:home", HOME_DEFAULTS);
  const m = MARKETING_COPY[(i18n.language as keyof typeof MARKETING_COPY) || "fr"] ?? MARKETING_COPY.fr;
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripsLoading, setTripsLoading] = useState(true);
  const { extras, loading: extrasLoading } = useExtras();

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase
          .from("trips")
          .select("id,title,slug,label,season,start_date,end_date,duration_days,base_price_mad,currency,cover_url,cover_alt,slots_left,highlights,destinations,badge_type,badge_text,promo_percent,program_link,is_featured,sort_order")
          .is("archived_at", null)
          .in("status", ["open", "completed"])
          .eq("is_featured", true)
          .order("sort_order", { ascending: true })
          .order("is_featured", { ascending: false })
          .order("start_date", { ascending: true, nullsFirst: false })
          .limit(6);
        setTrips((data ?? []) as Trip[]);
      } finally {
        setTripsLoading(false);
      }
    })();
  }, []);

  return (
    <>
      <Seo
        title="lejapon.ma — Voyages d'immersion au Japon depuis Casablanca"
        description="LeJapon.ma organise deux voyages par an au Japon depuis Casablanca : programme complet de 14 jours, vols, hôtels, transports JR, guide bilingue et prix tout inclus."
        canonical="/"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "TravelAgency",
          name: "lejapon.ma",
          url: "https://www.lejapon.ma",
          areaServed: "MA",
          description: "Agence de voyage premium spécialisée Japon, départs garantis depuis Casablanca.",
          address: { "@type": "PostalAddress", addressLocality: "Casablanca", addressCountry: "MA" },
          aggregateRating: { "@type": "AggregateRating", ratingValue: "4.9", reviewCount: "150" },
        }}
      />
      {/* HERO */}
      <section className="relative flex min-h-[620px] items-center overflow-hidden sm:min-h-[660px] md:min-h-[720px] lg:min-h-[88vh]">
        <div className="absolute inset-0">
          <picture className="block h-full w-full">
            <source
              type="image/webp"
              media="(max-width: 640px)"
              srcSet="/optimized/hero-fuji-mobile.webp"
            />
            <source
              type="image/webp"
              media="(max-width: 1024px)"
              srcSet="/optimized/hero-fuji-tablet.webp"
            />
            <source
              type="image/webp"
              srcSet="/optimized/hero-fuji-desktop.webp"
            />
            <img
              src="/optimized/hero-fuji-desktop.webp"
              alt="Mont Fuji et pagode au lever du soleil"
              className="h-full w-full object-cover"
              width={1920}
              height={1080}
              loading="eager"
              decoding="async"
              // @ts-expect-error fetchpriority is a valid HTML attribute
              fetchpriority="high"
            />
          </picture>
          <div className="absolute inset-0 bg-gradient-hero" />
        </div>

        <div className="container-app relative z-10 py-9 sm:py-12 md:py-20 lg:py-20">
          <div className="grid items-center lg:grid-cols-[minmax(0,38rem)_minmax(180px,1fr)] lg:gap-8 xl:grid-cols-[minmax(0,50rem)_minmax(280px,1fr)]">
            <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }} className="relative z-20 max-w-3xl lg:max-w-[46rem] xl:max-w-3xl">
              <span className="badge-pill mb-4 border border-white/20 bg-white/15 text-white backdrop-blur-md sm:mb-5 md:mb-6">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                {c.hero_badge}
              </span>
              <h1 className="text-balance font-display text-[clamp(2.55rem,11.5vw,3.8rem)] leading-[0.98] tracking-[-0.025em] text-white sm:text-6xl md:text-7xl lg:text-[4rem] xl:text-[5.5rem]">
                {(c.hero_title_l1 || "").split(",").map((part, i, arr) => (
                  <span key={i} className="block">
                    {part.trim()}{i < arr.length - 1 ? "," : ""}
                  </span>
                ))}
                <span className="block text-gradient">{c.hero_title_l2}</span>
              </h1>
              <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/90 sm:mt-5 sm:text-lg md:mt-7 md:text-xl">
                {c.hero_subtitle}
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 44, y: 12 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              transition={{ duration: 0.8, delay: 0.28 }}
              className="relative z-20 hidden min-h-[330px] items-center justify-start lg:flex xl:min-h-[390px]"
              aria-hidden
            >
              <img
                src={shiba}
                alt=""
                className="pointer-events-none block w-[200px] max-w-none drop-shadow-2xl xl:w-[285px]"
                style={{ animation: "fade-up 0.8s both, slow-zoom 6s ease-in-out infinite alternate" }}
                width={768}
                height={768}
                loading="eager"
                decoding="async"
              />
            </motion.div>
          </div>

          <div className="relative z-30 mt-6 grid grid-cols-[minmax(0,1fr)_5.25rem] items-end gap-2.5 sm:mt-7 sm:grid-cols-[minmax(0,auto)_6rem] sm:justify-start sm:gap-4 lg:mt-2 lg:block">
            <div className="flex min-w-0 flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:gap-4">
              <Link
                to="/reserver"
                className="btn-primary w-full justify-center text-sm sm:w-auto sm:text-base"
                onClick={() => trackEvent("reservation_cta_clicked", { placement: "home_hero_primary" })}
              >
                {c.hero_cta_primary} <ArrowRight className="h-5 w-5" />
              </Link>
              <Link to="/voyages" className="btn-ghost w-full justify-center text-sm !border-white/30 !bg-white/10 !text-white !backdrop-blur-md hover:!bg-white hover:!text-foreground sm:w-auto sm:text-base">
                {c.hero_cta_secondary}
              </Link>
            </div>
            <motion.img
              initial={{ opacity: 0, x: 16, y: 8 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              transition={{ duration: 0.65, delay: 0.2 }}
              src={shiba}
              alt=""
              aria-hidden="true"
              className="pointer-events-none block w-[5.25rem] self-end drop-shadow-2xl sm:w-24 lg:hidden"
              width={768}
              height={768}
              loading="eager"
              decoding="async"
            />
          </div>

          {/* trust badges */}
          <div className="relative z-30 mt-5 flex flex-col items-start gap-3 text-xs text-white/80 sm:mt-7 sm:flex-row sm:flex-wrap sm:items-center sm:gap-6 sm:text-sm lg:mt-10">
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
        </div>

        {/* scroll hint */}
        <a
          href="#prochains-departs"
          className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-xs text-white/60 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-foreground md:flex"
          aria-label="Découvrir les prochains départs"
        >
          <span>{c.hero_scroll}</span>
          <div className="w-px h-8 bg-white/40" />
        </a>
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

      {/* COMPETITIVE ADVANTAGES */}
      <section className="container-app py-20 md:py-28">
        <div className="mb-12 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="max-w-3xl">
            <span className="eyebrow mb-3">LeJapon.ma</span>
            <h2 className="font-display text-3xl text-balance md:text-5xl">{m.advantagesTitle}</h2>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-foreground/70">{m.advantagesIntro}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/reserver"
              className="btn-primary"
              onClick={() => trackEvent("reservation_cta_clicked", { placement: "home_advantages" })}
            >
              {m.reserve} <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/contact" className="btn-ghost">
              {m.advisor} <PhoneCall className="h-4 w-4" />
            </Link>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {m.advantages.map(([title, description], index) => {
            const Icon = advantageIcons[index] ?? CheckCircle;
            return (
              <article key={title} className="min-h-[210px] rounded-2xl border border-border bg-background p-5 shadow-soft">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/12 text-accent">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="font-display text-xl">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
              </article>
            );
          })}
        </div>
      </section>

      {/* TRIPS — featured cards */}
      <section id="prochains-departs" className="container-app scroll-mt-28 py-24 md:py-32">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-14">
          <div className="max-w-2xl">
            <span className="eyebrow mb-3">{c.trips_eyebrow}</span>
            <h2 className="font-display md:text-5xl mt-3 text-balance text-3xl">{c.trips_title_main} <span className="text-accent">{c.trips_title_accent}</span></h2>
          </div>
          <Link to="/voyages" className="text-sm font-semibold inline-flex items-center gap-2 hover:text-accent">
            {c.trips_link} <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {tripsLoading ? (
          <div className="grid min-h-[650px] gap-6 sm:min-h-[700px] sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <TripCardSkeleton key={index} />
            ))}
          </div>
        ) : trips.length === 0 ? (
          <div className="flex min-h-[420px] items-center rounded-3xl border border-dashed border-border p-8">
            <p className="text-foreground/60">{c.trips_empty}</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {trips.map((trip, i) => (
              <TripCard key={trip.id} trip={trip} index={i} fallbackImage={fallbackImgs[i % fallbackImgs.length]} />
            ))}
          </div>
        )}
      </section>

      {/* COMPARISON */}
      <section className="bg-foreground py-20 text-background md:py-28">
        <div className="container-app">
          <div className="mb-10 max-w-3xl">
            <span className="eyebrow mb-3 !text-accent">{m.comparisonEyebrow}</span>
            <h2 className="font-display text-3xl text-balance md:text-5xl">{m.comparisonTitle}</h2>
          </div>
          <div className="overflow-x-auto rounded-3xl border border-white/10 bg-white/[0.04]">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-background/70">
                  <th className="p-4 font-medium">{m.criteria}</th>
                  <th className="p-4 font-medium">{m.classic}</th>
                  <th className="p-4 font-medium">{m.lejapon}</th>
                </tr>
              </thead>
              <tbody>
                {m.rows.map(([criterion, classic, lejapon]) => (
                  <tr key={criterion} className="border-b border-white/10 last:border-0">
                    <td className="p-4 font-semibold">{criterion}</td>
                    <td className="p-4 text-background/65">{classic}</td>
                    <td className="p-4">
                      <span className="inline-flex items-start gap-2 font-medium">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                        {lejapon}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
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

      {/* OMOTENASHI */}
      <section className="container-app py-20 md:py-28">
        <div className="grid gap-8 rounded-3xl border border-border bg-secondary/45 p-8 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] md:p-12">
          <div>
            <span className="eyebrow mb-3">Omotenashi</span>
            <h2 className="font-display text-3xl md:text-5xl">{m.omotenashiTitle}</h2>
          </div>
          <div className="space-y-5">
            <p className="text-lg leading-relaxed text-foreground/75">{m.omotenashiText}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {m.omotenashiSteps.map(([step, text]) => (
                <div key={step} className="rounded-2xl bg-background p-4 text-sm shadow-soft">
                  <p className="font-semibold">{step}</p>
                  <p className="mt-1 text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
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
          <div className="grid min-h-[380px] gap-6 md:grid-cols-2 lg:grid-cols-3">
            {extrasLoading ? (
              Array.from({ length: 6 }).map((_, index) => <ExperienceSkeleton key={index} dark />)
            ) : extras.slice(0, 6).map((e, i) => (
              <article key={e.id} className="overflow-hidden rounded-3xl bg-background/5">
                <div className="aspect-[16/10] min-h-[190px] overflow-hidden">
                  <Img
                    src={e.image_url || extraFallbackImgs[i % extraFallbackImgs.length]}
                    alt={e.alt_text || e.name}
                    preset="card"
                    width={800}
                    height={500}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="min-h-[145px] p-6">
                  <div className="flex items-baseline justify-between mb-2 gap-3">
                    <h3 className="font-display text-xl">{e.name}</h3>
                    <span className="text-accent font-semibold whitespace-nowrap">{fmtExtraPrice(e.price_mad)}</span>
                  </div>
                  <p className="text-sm text-background/70">{truncateWords(e.description, 15)}</p>
                </div>
              </article>
            ))}
            {!extrasLoading && extras.length === 0 && (
              <div className="col-span-full flex min-h-[260px] items-center rounded-3xl border border-white/10 bg-white/[0.03] p-8">
                <p className="text-sm text-background/60">{c.exp_empty}</p>
              </div>
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
              className="card-modern flex min-h-[260px] flex-col p-6">
              <div className="flex gap-0.5 text-accent mb-4">
                {Array.from({ length: 5 }).map((_, j) => <Star key={j} className="w-4 h-4 fill-current" />)}
              </div>
              <blockquote className="mb-5 min-h-[6.5rem] flex-1 overflow-hidden text-sm leading-relaxed text-foreground/80">« {tm.quote} »</blockquote>
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
        <div className="mt-10 flex min-h-[190px] flex-col items-center justify-center rounded-3xl border border-border bg-background p-6 text-center shadow-soft">
          <h3 className="font-display text-2xl">{m.reviewsTitle}</h3>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">{m.reviewsText}</p>
          <a
            href="https://maps.app.goo.gl/ineHnJq3o5DqGByH8"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary mt-5 inline-flex"
          >
            {m.reviewsCta} <Star className="h-4 w-4 fill-current" />
          </a>
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
        <div className="relative min-h-[520px] overflow-hidden rounded-3xl">
          <img src={torii} alt="Torii vermillion" className="absolute inset-0 w-full h-full object-cover" width={1920} height={1280} loading="lazy" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-r from-foreground/95 via-foreground/80 to-foreground/40" />
          <div className="relative px-8 md:px-16 py-20 md:py-28 text-background max-w-2xl">
            <span className="badge-pill bg-accent text-accent-foreground mb-6">
              <Sparkles className="w-3 h-3" /> {c.cta_badge}
            </span>
            <h2 className="font-display text-4xl md:text-6xl text-balance leading-[1.05]">{c.cta_title}</h2>
            <p className="mt-5 text-background/85 text-lg max-w-md">{c.cta_subtitle}</p>
            <div className="mt-10 flex flex-wrap gap-4">
              <Link
                to="/reserver"
                className="btn-primary text-base"
                onClick={() => trackEvent("reservation_cta_clicked", { placement: "home_final_cta" })}
              >
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
