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
  hero_card_label: "Depuis Casablanca",
  hero_card_text: "Une équipe maroco-japonaise à votre service.",
  story_eyebrow: "Notre histoire",
  story_title_main: "Une aventure née d'une",
  story_title_accent: "passion sincère.",
  story_p1: "Tout a commencé par l'amour profond du Japon. Créée par des passionnés, lejapon.ma est née d'une envie simple : faire vivre aux voyageurs marocains la magie d'un pays façonné par mille ans de raffinement.",
  story_p2: "Au fil des années, nous avons construit une expertise terrain rare, tissée de partenariats locaux, d'amitiés japonaises, et d'une connaissance intime des lieux qui valent le voyage.",
  story_p3: "Aujourd'hui, nous organisons des voyages de groupe depuis plusieurs années, et chaque départ porte cette même intention : offrir bien plus qu'un circuit — une rencontre.",
  stat1_value: "+30", stat1_label: "Voyages",
  stat2_value: "+500", stat2_label: "Voyageurs",
  stat3_value: "10 ans", stat3_label: "D'expertise",
  omotenashi_quote: "Nous appliquons le principe japonais d'Omotenashi, une hospitalité sincère, où chaque détail est anticipé pour offrir une expérience fluide et exceptionnelle.",
  omotenashi_subtitle: "C'est l'art japonais de servir sans rien attendre en retour. C'est notre boussole.",
  conclusion_quote: "Notre mission est simple : vous faire vivre le Japon comme si vous y étiez chez vous.",
};

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.7, delay, ease: [0.19, 1, 0.22, 1] as const },
});

const About = () => {
  const c = useSiteContent("site:about", DEFAULTS);
  return (
    <>
      <Seo
        title="À propos — lejapon.ma · Agence de voyage spécialisée Japon"
        description="LeJapon.ma est une agence spécialisée dans les voyages au Japon. Découvrez notre histoire, notre méthode Omotenashi et notre équipe de passionnés."
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
              {c.hero_title_main} <span className="italic text-accent">{c.hero_title_accent}</span>
            </h1>
            <p className="mt-8 text-lg md:text-xl text-muted-foreground leading-relaxed max-w-2xl">
              {c.hero_intro}
            </p>
          </motion.div>
          <motion.div {...fade(0.15)} className="lg:col-span-5">
            <div className="relative">
              <div className="aspect-[4/5] overflow-hidden rounded-3xl shadow-card">
                <img src={fuji} alt="Mont Fuji au lever du soleil" className="w-full h-full object-cover" loading="eager" />
              </div>
              <div className="absolute -bottom-6 -left-6 hidden md:block bg-background border border-border rounded-2xl p-5 shadow-card max-w-[220px]">
                <div className="flex items-center gap-2 text-accent mb-1">
                  <Heart className="w-4 h-4 fill-accent" />
                  <span className="text-xs font-semibold uppercase tracking-wider">{c.hero_card_label}</span>
                </div>
                <p className="text-sm text-muted-foreground">{c.hero_card_text}</p>
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
              <img src={kyoto} alt="Ruelle traditionnelle de Kyoto" className="w-full h-full object-cover" loading="lazy" />
            </div>
          </motion.div>
          <motion.div {...fade(0.1)} className="lg:col-span-7 order-1 lg:order-2">
            <p className="eyebrow mb-4">{c.story_eyebrow}</p>
            <h2 className="font-display text-4xl md:text-5xl leading-tight mb-8 text-balance">
              {c.story_title_main} <span className="italic text-accent">{c.story_title_accent}</span>
            </h2>
            <div className="space-y-5 text-foreground/80 text-lg leading-relaxed">
              <p>{c.story_p1}</p>
              <p>{c.story_p2}</p>
              <p>{c.story_p3}</p>
            </div>
            <div className="mt-10 grid grid-cols-3 gap-4">
              {[[c.stat1_value, c.stat1_label], [c.stat2_value, c.stat2_label], [c.stat3_value, c.stat3_label]].map(([v, l]) => (
                <div key={l} className="text-center p-5 border border-border rounded-2xl bg-card">
                  <div className="font-display text-2xl md:text-3xl text-accent">{v}</div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground mt-1">{l}</div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* OMOTENASHI */}
      <section className="relative overflow-hidden bg-foreground text-background">
        <img src={torii} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover opacity-20" loading="lazy" />
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
            { icon: Compass, t: "Organisation complète", d: "Vols, hôtels, transports, visas, repas — chaque étape est orchestrée pour vous." },
            { icon: HandHeart, t: "Accompagnement humain", d: "Un guide bilingue à vos côtés, du décollage au retour. Jamais seul." },
            { icon: MapPin, t: "Expériences authentiques", d: "Geishas, cérémonie du thé, ryokans, marchés cachés — le Japon des Japonais." },
            { icon: ShieldCheck, t: "Aucun stress", d: "Vous n'avez qu'à profiter. On s'occupe de tout, dans les moindres détails." },
          ].map((item, i) => (
            <motion.div key={item.t} {...fade(i * 0.08)} className="group relative p-7 rounded-2xl border border-border bg-card hover:shadow-card hover:-translate-y-1 transition-all duration-500">
              <div className="w-12 h-12 rounded-xl bg-accent/10 text-accent flex items-center justify-center mb-5 group-hover:bg-accent group-hover:text-accent-foreground transition-colors">
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
                Des passionnés, <span className="italic text-accent">avant tout.</span>
              </h2>
              <div className="space-y-6">
                {[
                  { t: "Passionnés du Japon", d: "Nous y vivons, nous y retournons sans cesse, nous en parlons comme d'une seconde maison." },
                  { t: "Experts terrain", d: "Une connaissance fine des villes, des saisons, des hôtels, des trains et des secrets bien gardés." },
                  { t: "Présents avant, pendant, après", d: "De votre première question au retour à Casablanca — et bien après — nous restons à vos côtés." },
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
                <img src={tea} alt="Cérémonie du thé japonaise" className="w-full h-full object-cover" loading="lazy" />
              </div>
            </motion.div>
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
              Découvrir nos voyages <ArrowRight className="w-5 h-5" />
            </Link>
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
