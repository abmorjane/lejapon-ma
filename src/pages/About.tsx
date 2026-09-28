import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { ArrowRight, Heart, MapPin, Users, Sparkles, Compass, ShieldCheck, HandHeart } from "lucide-react";
import { Seo } from "@/components/Seo";
import kyoto from "@/assets/kyoto-alley.jpg";
import torii from "@/assets/torii.jpg";
import tea from "@/assets/tea-ceremony.jpg";
import fuji from "@/assets/hero-fuji.jpg";
import { useSiteContent } from "@/hooks/useSiteContent";

const DEFAULTS = {
  hero_eyebrow: "À propos",
  hero_title_main: "Le Japon, raconté",
  hero_title_accent: "de l'intérieur.",
  hero_intro: "LeJapon.ma est une agence spécialisée dans les voyages au Japon, offrant des expériences immersives uniques.",
  story_eyebrow: "Notre histoire",
  story_title_main: "Une aventure née d'une",
  story_title_accent: "passion sincère.",
  story_p1: "Tout a commencé par l'amour profond du Japon. Créée par des passionnés, lejapon.ma est née d'une envie simple : faire vivre aux voyageurs marocains la magie d'un pays façonné par mille ans de raffinement.",
  story_p2: "Au fil des années, nous avons construit une expertise terrain rare, tissée de partenariats locaux, d'amitiés japonaises, et d'une connaissance intime des lieux qui valent le voyage.",
  story_p3: "Aujourd'hui, nous organisons des voyages de groupe depuis plusieurs années, et chaque départ porte cette même intention : offrir bien plus qu'un circuit — une rencontre.",
  omotenashi_quote: "Nous appliquons le principe japonais d'Omotenashi, une hospitalité sincère, où chaque détail est anticipé pour offrir une expérience fluide et exceptionnelle.",
  omotenashi_subtitle: "C'est l'art japonais de servir sans rien attendre en retour. C'est notre boussole.",
  conclusion_quote: "Notre mission est simple : vous faire vivre le Japon comme si vous y étiez chez vous.",
};

const CONTACT_DEFAULTS = {
  email: "info@lejapon.ma",
  // Never infer an agency address from a departure city. Addresses are shown
  // only when they are supplied by the public site:contact content.
  addresses: [] as Array<{ city: string; line: string }>,
};

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.7, delay, ease: [0.19, 1, 0.22, 1] as const },
});

const About = () => {
  const c = useSiteContent("site:about", DEFAULTS);
  const contact = useSiteContent("site:contact", CONTACT_DEFAULTS);
  return (
    <>
      <Seo
        title="Agence de voyage Japon au Maroc | À propos — LeJapon.ma"
        description="Découvrez LeJapon.ma, marque spécialisée Japon de Moroccan Express Travel & Events : agence marocaine, expertise terrain et accompagnement humain."
        canonical="/a-propos"
      />

      {/* HERO */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 -z-10" style={{ background: "var(--gradient-mesh)" }} />
        <div className="container-app pt-20 md:pt-28 pb-16 md:pb-24 grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          <motion.div {...fade()} className="lg:col-span-7">
            <span className="badge-pill bg-accent/10 text-accent mb-6">
              <Sparkles className="w-3 h-3" /> {c.hero_eyebrow}
            </span>
            <h1 className="font-display text-4xl md:text-6xl lg:text-7xl leading-[1.05] text-balance">
              Une agence marocaine spécialisée dans <span className="italic text-accent">les voyages au Japon.</span>
            </h1>
            <p className="mt-8 text-lg md:text-xl text-muted-foreground leading-relaxed max-w-2xl">
              {c.hero_intro}
            </p>
          </motion.div>
          <motion.div {...fade(0.15)} className="lg:col-span-5">
            <div className="relative">
              <div className="aspect-[4/5] overflow-hidden rounded-3xl shadow-card">
                <img src={fuji} alt="Mont Fuji au lever du soleil" className="w-full h-full object-cover" width={800} height={1000} loading="eager" decoding="async" />
              </div>
              <div className="absolute -bottom-6 -left-6 hidden md:block bg-background border border-border rounded-2xl p-5 shadow-card max-w-[220px]">
                <div className="flex items-center gap-2 text-accent mb-1">
                  <Heart className="w-4 h-4 fill-accent" />
                  <span className="text-xs font-semibold uppercase tracking-wider">LeJapon.ma</span>
                </div>
                <p className="text-sm text-muted-foreground">La marque spécialisée Japon de Moroccan Express Travel &amp; Events.</p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* NOTRE HISTOIRE */}
      <section className="container-app py-20 md:py-28">
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-20 items-center">
          <motion.div {...fade()} className="lg:col-span-5 order-2 lg:order-1">
            <div className="aspect-[4/5] overflow-hidden rounded-3xl shadow-card">
              <img src={kyoto} alt="Ruelle traditionnelle de Kyoto" className="w-full h-full object-cover" width={800} height={1000} loading="lazy" decoding="async" />
            </div>
          </motion.div>
          <motion.div {...fade(0.1)} className="lg:col-span-7 order-1 lg:order-2">
            <p className="eyebrow mb-4">{c.story_eyebrow}</p>
            <h2 className="font-display text-4xl md:text-5xl leading-tight mb-8 text-balance">
              LeJapon.ma, une expertise Japon portée par <span className="italic text-accent">Moroccan Express Travel &amp; Events.</span>
            </h2>
            <div className="space-y-5 text-foreground/80 text-lg leading-relaxed">
              <p>{c.story_p1}</p>
              <p>{c.story_p2}</p>
              <p>{c.story_p3}</p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* OMOTENASHI */}
      <section className="relative overflow-hidden bg-foreground text-background">
        <img src={torii} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover opacity-20" width={1920} height={1280} loading="lazy" decoding="async" />
        <div className="absolute inset-0 bg-gradient-to-b from-foreground/95 via-foreground/85 to-foreground/95" />
        <div className="relative container-app py-24 md:py-36">
          <motion.div {...fade()} className="max-w-3xl mx-auto text-center">
            <span className="badge-pill bg-accent/15 text-accent border border-accent/30 mb-8">
              <Sparkles className="w-3 h-3" /> Notre méthode
            </span>
            <p className="font-display text-5xl md:text-7xl mb-2 text-accent italic">おもてなし</p>
            <h2 className="font-display text-4xl md:text-6xl leading-tight mb-10 text-balance">
              Omotenashi.
            </h2>
            <blockquote className="text-xl md:text-2xl leading-relaxed text-background/85 font-light italic">
              « {c.omotenashi_quote} »
            </blockquote>
            <div className="mt-12 w-16 h-px bg-accent mx-auto" />
            <p className="mt-8 text-background/70 text-base md:text-lg max-w-xl mx-auto">
              {c.omotenashi_subtitle}
            </p>
          </motion.div>
        </div>
      </section>

      {/* NOTRE APPROCHE */}
      <section className="container-app py-20 md:py-28">
        <motion.div {...fade()} className="text-center max-w-2xl mx-auto mb-16">
          <p className="eyebrow mb-4">Notre approche</p>
          <h2 className="font-display text-4xl md:text-5xl leading-tight text-balance">
            Quatre engagements, <span className="italic text-accent">une promesse.</span>
          </h2>
        </motion.div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { icon: ShieldCheck, t: "Une agence marocaine identifiée", d: "LeJapon.ma s'inscrit dans l'activité de Moroccan Express Travel & Events, avec des points de contact au Maroc." },
            { icon: Compass, t: "Une marque spécialisée Japon", d: "Les circuits, hôtels, transports et expériences sont étudiés autour d'une destination unique : le Japon." },
            { icon: HandHeart, t: "Un accompagnement humain", d: "L'équipe répond avant le départ et reste mobilisée pendant le parcours prévu pour le groupe." },
            { icon: MapPin, t: "Une connaissance du terrain", d: "Les programmes s'appuient sur les villes, les usages et les partenaires mobilisés au Japon." },
          ].map((item, i) => (
            <motion.div key={item.t} {...fade(i * 0.08)} className="relative p-7 rounded-2xl border border-border bg-card shadow-soft">
              <div className="w-12 h-12 rounded-xl bg-accent/10 text-accent flex items-center justify-center mb-5">
                <item.icon className="w-5 h-5" />
              </div>
              <h3 className="font-display text-xl mb-2">{item.t}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{item.d}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* NOTRE ÉQUIPE */}
      <section className="bg-secondary/40 border-y border-border">
        <div className="container-app py-20 md:py-28">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-20 items-center">
            <motion.div {...fade()} className="lg:col-span-7">
              <p className="eyebrow mb-4">Notre équipe</p>
              <h2 className="font-display text-4xl md:text-5xl leading-tight mb-8 text-balance">
                Une équipe mobilisée <span className="italic text-accent">au Maroc et au Japon.</span>
              </h2>
              <div className="space-y-6">
                {[
                  { t: "Conseillers au Maroc", d: "L'équipe accompagne le choix du départ, la réservation et la préparation du dossier avant le voyage." },
                  { t: "Accompagnement adapté au programme", d: "Selon le voyage publié, un accompagnateur francophone parlant japonais peut faciliter les échanges et la compréhension des codes locaux." },
                  { t: "Relais et partenaires au Japon", d: "La connaissance du terrain et les contacts locaux soutiennent l'organisation des étapes sur place." },
                ].map((item, i) => (
                  <motion.div key={item.t} {...fade(i * 0.08)} className="flex gap-5">
                    <div className="shrink-0 w-10 h-10 rounded-full bg-accent text-accent-foreground flex items-center justify-center font-display text-sm">
                      {String(i + 1).padStart(2, "0")}
                    </div>
                    <div>
                      <h3 className="font-display text-xl mb-1.5">{item.t}</h3>
                      <p className="text-muted-foreground leading-relaxed">{item.d}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
            <motion.div {...fade(0.15)} className="lg:col-span-5">
              <div className="aspect-square overflow-hidden rounded-3xl shadow-card">
                <img src={tea} alt="Cérémonie du thé japonaise" className="w-full h-full object-cover" width={800} height={800} loading="lazy" decoding="async" />
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* IDENTITÉ ET CONTACT */}
      <section className="container-app py-20 md:py-28">
        <div className="grid gap-10 rounded-3xl border border-border bg-secondary/35 p-7 sm:p-10 lg:grid-cols-[1.05fr_1fr] lg:items-start">
          <div>
            <p className="eyebrow mb-4">Une agence accessible</p>
            <h2 className="font-display text-4xl md:text-5xl leading-tight text-balance">
              Moroccan Express Travel &amp; Events, <span className="italic text-accent">au service de votre projet Japon.</span>
            </h2>
            <p className="mt-5 leading-relaxed text-muted-foreground">
              LeJapon.ma, marque spécialisée Japon de Moroccan Express Travel &amp; Events, vous permet d’échanger avec l’équipe, de vérifier les départs publiés et de demander un accompagnement depuis le Maroc avant toute réservation.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/contact" className="btn-primary">Contacter l’agence</Link>
              <a href="https://maps.app.goo.gl/ineHnJq3o5DqGByH8" target="_blank" rel="noopener noreferrer" className="btn-ghost">Consulter les avis Google</a>
            </div>
          </div>
          <div>
            {(contact.addresses ?? []).length > 0 && (
              <>
                <h3 className="font-display text-2xl">Nos points de contact au Maroc</h3>
                <ul className="mt-5 grid gap-4">
                  {contact.addresses.map((address) => (
                    <li key={`${address.city}-${address.line}`} className="flex gap-3 rounded-2xl border border-border bg-background p-5">
                      <MapPin className="mt-1 h-5 w-5 shrink-0 text-accent" />
                      <div>
                        <p className="font-semibold">{address.city}</p>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">{address.line}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <a href={`mailto:${contact.email}`} className="mt-5 inline-flex font-semibold text-accent hover:underline underline-offset-4">Écrire à {contact.email}</a>
          </div>
        </div>
      </section>

      {/* CONCLUSION CTA */}
      <section className="container-app py-24 md:py-32">
        <motion.div {...fade()} className="max-w-3xl mx-auto text-center">
          <Users className="w-10 h-10 text-accent mx-auto mb-8" />
          <p className="font-display text-3xl md:text-5xl leading-[1.15] text-balance">
            « {c.conclusion_quote} »
          </p>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
            <Link to="/voyages" className="btn-primary text-base">
              Découvrir nos voyages au Japon <ArrowRight className="w-5 h-5" />
            </Link>
            <Link to="/programme" className="btn-ghost text-base">Voir les circuits détaillés</Link>
            <Link to="/contact" className="btn-ghost text-base">
              Nous contacter
            </Link>
          </div>
        </motion.div>
      </section>
    </>
  );
};

export default About;
