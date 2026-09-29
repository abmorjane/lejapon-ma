import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { ArrowRight, Star, Check, Sparkles, Shield, Users, Plane, Heart, Zap, Languages, Headphones, Building2, Hotel, Route, PhoneCall, Award, CheckCircle } from "lucide-react";
import { Seo } from "@/components/Seo";
import { supabase } from "@/integrations/supabase/client";
import { useExtras, fmtExtraPrice } from "@/hooks/useExtras";
import { Img } from "@/components/ui/Img";
import { NewsletterSection } from "@/components/site/NewsletterSection";
import { TripCard, TripCardSkeleton, type TripCardData } from "@/components/trips/TripCard";
import { useSiteContent } from "@/hooks/useSiteContent";
import { trackEvent } from "@/lib/analytics";
import { commercialDateKey } from "@/lib/public-commercial-visibility";
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

const HOME_DEFAULTS = {
  hero_badge: "Voyages au Japon depuis le Maroc",
  hero_title_l1: "Vivez le Japon comme",
  hero_title_l2: "vous l'avez rêvé.",
  hero_subtitle: "Des itinéraires pensés avec soin, une équipe attentive et la liberté de vivre le Japon à votre façon.",
  hero_cta_primary: "Composer mon voyage",
  hero_cta_secondary: "Voir les voyages",
  hero_scroll: "Découvrir",
  trips_eyebrow: "Nos prochains départs",
  trips_title_main: "Le Japon vous appelle,",
  trips_title_accent: "choisissez votre départ.",
  trips_link: "Voir tous les voyages",
  trips_empty: "Aucun départ disponible pour le moment. Revenez bientôt.",
  why_eyebrow: "Pourquoi nous choisir",
  why_title_main: "Votre voyage au Japon,",
  why_title_accent: "pensé avec attention.",
  why_intro: "Une équipe qui connaît le Japon, des itinéraires pour le découvrir et du temps pour le vivre à votre façon.",
  why1_t: "Un itinéraire clair", why1_d: "Les étapes et les prestations de chaque départ sont précisées avant votre choix.",
  why2_t: "Équipe maroco-japonaise", why2_d: "Une vraie connaissance du terrain et la chaleur de l'accueil marocain.",
  why3_t: "Vos propres découvertes", why3_d: "Les temps libres indiqués dans le programme laissent de la place à vos envies.",
  why4_t: "Choix serein", why4_d: "Comparez les départs puis personnalisez votre demande.",
  how_eyebrow: "Comment ça marche",
  how_title_main: "Réservez en 3 étapes",
  how_title_accent: "ultra simples.",
  step1_t: "Composez votre voyage", step1_d: "Choisissez vos dates, formule et options. Prix en temps réel, sans engagement.",
  step2_t: "Parlons des détails", step2_d: "Notre équipe confirme les disponibilités et les conditions avec vous.",
  step3_t: "Préparez vos valises", step3_d: "Profitez de nos conseils pour préparer le départ et votre dossier de visa.",
  exp_eyebrow: "Plans extra",
  exp_title_l1: "Ajoutez un peu de magie",
  exp_title_l2: "à votre séjour.",
  exp_link: "Voir toutes les expériences",
  exp_empty: "Aucune activité disponible pour l'instant.",
  gua1_t: "Un programme lisible", gua1_d: "Prestations et temps libres précisés pour chaque départ",
  gua2_t: "Visa accompagné", gua2_d: "Aide à la préparation sans garantie de délivrance",
  gua3_t: "Présence adaptée", gua3_d: "Accompagnement précisé selon le programme",
  gua4_t: "Des choix personnels", gua4_d: "Formule et expériences optionnelles selon le voyage",
  cta_badge: "À vous le Japon",
  cta_title: "Votre Japon vous attend.",
  cta_subtitle: "Choisissez le départ qui vous inspire et préparons ensemble la suite.",
  cta_primary: "Composer mon voyage",
  cta_secondary: "Parler à un conseiller",
};

// Public sales promises stay in code until the site:home CMS copy is reviewed.
// The CMS still supplies non-critical content, but cannot reintroduce expired
// departure badges, unverified numbers or unconditional service guarantees.
const HOME_BRAND_COPY = {
  fr: {
    hero_badge: "Voyages au Japon depuis le Maroc",
    hero_title_l1: "Le Japon,",
    hero_title_l2: "à vivre pleinement.",
    hero_subtitle: "Des circuits pensés avec soin, des découvertes à partager et la liberté de savourer le Japon à votre rythme.",
    hero_cta_primary: "Imaginer mon voyage",
    hero_cta_secondary: "Découvrir les départs",
    trips_title_main: "Le Japon vous appelle,",
    trips_title_accent: "choisissez votre départ.",
    why_title_main: "Votre Japon,",
    why_title_accent: "avec le plaisir de se laisser guider.",
    why_intro: "Une équipe attentive vous aide à choisir le bon départ et à profiter de chaque étape, sans renoncer à vos envies personnelles.",
    why1_t: "Un itinéraire qui a du sens", why1_d: "Les villes, les visites et le rythme de chaque circuit sont présentés avant votre choix.",
    why2_t: "Le Japon vu de près", why2_d: "Notre connaissance de la destination nourrit les étapes et les conseils que nous partageons.",
    why3_t: "Du temps pour vous", why3_d: "Les moments libres prévus au programme laissent place à vos propres découvertes.",
    why4_t: "Un choix en toute clarté", why4_d: "Comparez les départs, puis personnalisez votre demande selon vos envies.",
    step1_t: "Choisissez votre départ", step1_d: "Choisissez votre départ et les options qui vous plaisent ; le montant estimé apparaît avant l'envoi.",
    step2_t: "Parlons des détails",
    step2_d: "Notre équipe confirme avec vous les disponibilités et les conditions de réservation.",
    step3_t: "Préparez le départ",
    step3_d: "Préparez votre départ avec nos conseils, notamment pour votre dossier de visa.",
    gua1_t: "Un programme lisible", gua1_d: "Prestations et moments libres sont précisés pour le départ choisi.",
    gua2_t: "Visa accompagné", gua2_d: "Une aide à la préparation du dossier, sans garantie de délivrance.",
    gua3_t: "Une présence adaptée", gua3_d: "L'accompagnement est précisé pour chaque programme.",
    gua4_t: "Vos envies comptent", gua4_d: "Formule et expériences optionnelles selon le voyage.",
    cta_badge: "À vous le Japon",
    cta_primary: "Préparer mon voyage",
    cta_subtitle: "Choisissez le départ qui vous inspire ; nous vous aiderons à préparer la suite.",
  },
  en: {
    hero_badge: "Japan journeys from Morocco",
    hero_title_l1: "Japan,",
    hero_title_l2: "yours to discover.",
    hero_subtitle: "Thoughtfully planned routes, discoveries to share and room to enjoy Japan at your own pace.",
    hero_cta_primary: "Plan my journey", hero_cta_secondary: "Explore departures",
    trips_title_main: "Japan is calling,",
    trips_title_accent: "choose your departure.",
    why_title_main: "Your Japan,", why_title_accent: "with thoughtful support.",
    why_intro: "Our team helps you choose the right departure and enjoy every stage while making room for your own interests.",
    why1_t: "A meaningful route", why1_d: "Explore the cities, visits and pace of each trip before choosing.",
    why2_t: "Japan up close", why2_d: "Our destination knowledge shapes the routes and advice we share.",
    why3_t: "Time for yourself", why3_d: "Free moments in the programme make room for your discoveries.",
    why4_t: "A clear choice", why4_d: "Compare departures and tailor your request to your preferences.",
    step1_t: "Choose your departure", step1_d: "Choose a departure and optional experiences; see the estimate before sending your request.",
    step2_t: "Let's discuss the details",
    step2_d: "Our team confirms availability and booking conditions with you.",
    step3_t: "Get ready to go",
    step3_d: "Prepare to leave with our advice, including support for your visa file.",
    gua1_t: "A clear programme", gua1_d: "Services and free time are detailed for each departure.",
    gua2_t: "Visa support", gua2_d: "Help preparing the file, with no guarantee of approval.",
    gua3_t: "Support that fits", gua3_d: "Accompaniment is specified for each programme.",
    gua4_t: "Your preferences matter", gua4_d: "Formula and optional experiences vary by trip.",
    cta_badge: "Japan awaits", cta_primary: "Plan my journey", cta_subtitle: "Choose the departure that inspires you; we will help with the next steps.",
  },
  ar: {
    hero_badge: "رحلات إلى اليابان من المغرب",
    hero_title_l1: "اليابان،",
    hero_title_l2: "اكتشفها بطريقتك.",
    hero_subtitle: "مسارات مدروسة وتجارب تتشاركها مع الآخرين ووقت للاستمتاع باليابان على إيقاعك.",
    hero_cta_primary: "خطط لرحلتي", hero_cta_secondary: "اكتشف الرحلات",
    trips_title_main: "اليابان تناديك،",
    trips_title_accent: "اختر موعد رحلتك.",
    why_title_main: "رحلتك إلى اليابان،", why_title_accent: "برفقة فريق يهتم بالتفاصيل.",
    why_intro: "نساعدك في اختيار الرحلة المناسبة والاستمتاع بكل محطة مع مساحة لرغباتك الخاصة.",
    why1_t: "مسار واضح", why1_d: "تعرف على المدن والزيارات ووتيرة كل رحلة قبل الاختيار.",
    why2_t: "معرفة باليابان", why2_d: "توجه خبرتنا بالوجهة البرامج والنصائح التي نقدمها.",
    why3_t: "وقت لنفسك", why3_d: "تترك الفترات الحرة في البرنامج مساحة لاكتشافاتك.",
    why4_t: "اختيار بكل وضوح", why4_d: "قارن الرحلات وخصص طلبك حسب رغباتك.",
    step1_t: "اختر رحلتك", step1_d: "اختر موعد الرحلة والخيارات التي تناسبك واطلع على السعر التقديري قبل الإرسال.",
    step2_t: "لنتحدث عن التفاصيل",
    step2_d: "يؤكد فريقنا معك التوفر وشروط الحجز.",
    step3_t: "استعد للسفر",
    step3_d: "استعد للسفر مع نصائحنا، بما في ذلك المساعدة في ملف التأشيرة.",
    gua1_t: "برنامج واضح", gua1_d: "تفاصيل الخدمات والوقت الحر لكل رحلة.",
    gua2_t: "مساعدة في التأشيرة", gua2_d: "مساعدة في إعداد الملف دون ضمان القبول.",
    gua3_t: "مرافقة حسب البرنامج", gua3_d: "توضح تفاصيل المرافقة في كل رحلة.",
    gua4_t: "رغباتك مهمة", gua4_d: "الصيغة والتجارب الاختيارية تختلف حسب الرحلة.",
    cta_badge: "اليابان بانتظارك", cta_primary: "خطط لرحلتي", cta_subtitle: "اختر الرحلة التي تلهمك وسنساعدك في الخطوات التالية.",
  },
} as const;

const MARKETING_COPY = {
  fr: {
    advantagesTitle: "Pourquoi voyager au Japon avec LeJapon.ma ?",
    advantagesIntro: "Des voyages pensés pour partir du Maroc avec des repères clairs, une connaissance du Japon et la place de vivre vos propres découvertes.",
    reserve: "Réserver mon voyage",
    advisor: "Parler à un conseiller",
    advantages: [
      ["Départs depuis Casablanca", "Les dates et les informations de chaque départ sont indiquées avant la réservation."],
      ["Accompagnement selon le voyage", "Un accompagnateur francophone parlant japonais peut être prévu selon le programme choisi."],
      ["Une équipe à votre écoute", "Posez vos questions avant de partir et retrouvez le cadre du voyage dans le programme."],
      ["Une connaissance du Japon", "Nos itinéraires s'appuient sur l'expérience de la destination et de ses étapes."],
      ["Des hôtels à découvrir", "Consultez les hébergements présentés avec votre itinéraire."],
      ["Un rythme à choisir", "Comparez les circuits proposés pour trouver celui qui vous ressemble."],
      ["Des moments libres", "Selon le programme, du temps pour explorer à votre façon."],
      ["Des avis publics", "Vous pouvez consulter directement les retours publiés sur Google."],
      ["Un prix à comprendre", "Le tarif et les options de chaque départ sont présentés avant votre demande."],
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
      ["Departures from Casablanca", "Dates and departure details are shown for each trip."],
      ["Support that fits the trip", "A French-speaking leader who speaks Japanese may be included, depending on the programme."],
      ["A team to talk to", "Ask questions before you go and check the details of your chosen programme."],
      ["Knowledge of Japan", "Our routes draw on experience of the destination and its many stages."],
      ["Hotels to explore", "See the accommodation presented with your route."],
      ["A pace to choose", "Compare the available circuits to find one that suits you."],
      ["Free moments", "Depending on the programme, time to explore your own way."],
      ["Public reviews", "Read feedback directly on Google."],
      ["Clear pricing", "Each departure shows its price and options before you enquire."],
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
      ["رحلات من الدار البيضاء", "تظهر المواعيد وتفاصيل الانطلاق لكل رحلة."],
      ["مرافقة حسب البرنامج", "قد يرافق الرحلة شخص يتحدث الفرنسية واليابانية حسب البرنامج المختار."],
      ["فريق يصغي إليك", "اطرح أسئلتك قبل السفر وتعرف على تفاصيل البرنامج."],
      ["معرفة باليابان", "تستند مساراتنا إلى تجربة الوجهة ومحطاتها."],
      ["فنادق للاكتشاف", "تعرف على أماكن الإقامة المقدمة مع رحلتك."],
      ["إيقاع تختاره", "قارن البرامج المتاحة لتجد ما يناسبك."],
      ["أوقات حرة", "حسب البرنامج، وقت للاستكشاف بطريقتك."],
      ["آراء منشورة", "اقرأ التقييمات المنشورة مباشرة على Google."],
      ["سعر واضح", "تظهر أسعار وخيارات كل رحلة قبل إرسال طلبك."],
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
  const cms = useSiteContent("site:home", HOME_DEFAULTS);
  const language = i18n.language === "en" || i18n.language === "ar" ? i18n.language : "fr";
  const c = { ...cms, ...HOME_BRAND_COPY[language] };
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
          .eq("status", "open")
          .gte("end_date", commercialDateKey())
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
        title="LeJapon.ma | Découvrez le Japon depuis le Maroc"
        description="Découvrez LeJapon.ma, marque spécialisée Japon de Moroccan Express Travel & Events : des itinéraires pensés avec soin et le plaisir de voyager à votre rythme."
        canonical="/"
        prerenderReady={!tripsLoading && !extrasLoading}
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "TravelAgency",
          name: "lejapon.ma",
          url: "https://www.lejapon.ma",
          areaServed: "MA",
          description: "LeJapon.ma, marque spécialisée Japon de Moroccan Express Travel & Events, propose des voyages depuis le Maroc.",
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
                    {part.trim()}{i < arr.length - 1 ? "," : ""}{" "}
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

          <a href="https://maps.app.goo.gl/ineHnJq3o5DqGByH8" target="_blank" rel="noopener noreferrer" className="relative z-30 mt-5 inline-flex text-sm text-white/85 underline underline-offset-4 hover:text-white">
            Découvrir les avis publics sur Google
          </a>
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

      {/* Only link to public reviews until individual quotations are verified. */}
      <section className="container-app py-24 md:py-32">
        <div className="mt-10 flex min-h-[190px] flex-col items-center justify-center rounded-3xl border border-border bg-background p-6 text-center shadow-soft">
          <h2 className="font-display text-2xl">{m.reviewsTitle}</h2>
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
