import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, MapPin, Clock, Loader2, FileText, ChevronRight, MessageCircle, Check, Info } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Seo } from "@/components/Seo";
import { cn } from "@/lib/utils";
import { DayIcon } from "@/components/programmes/DayIcon";
import { Img } from "@/components/ui/Img";

type LegacyDay = { day: number; title: string; city?: string; description?: string };
type ScheduleItem = { time: string; title: string; description?: string };
type IncludedItem = { icon?: string; label: string };
type ProgrammeDay = {
  id: string;
  day_number: number;
  city: string;
  badge?: string | null;
  title: string;
  description: string;
  main_image_url: string | null;
  gallery_images: string[];
  schedule_items: ScheduleItem[];
  included_items: IncludedItem[];
  icons: string[];
  special_note?: string | null;
  is_optional: boolean;
  is_active: boolean;
  sort_order: number;
};
type Programme = {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  introduction: string;
  hero_image_url: string | null;
  hero_alt: string | null;
  cta_label: string;
  cta_url: string;
  meta_description: string | null;
  duration: string;
  cities: string[];
  description: string;
  days: LegacyDay[];
  pdf_url: string | null;
  sort_order: number;
  rich_days: ProgrammeDay[];
};

const WHATSAPP = "212711449838";

export default function ProgrammePage() {
  const [rows, setRows] = useState<Programme[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: progs } = await supabase
        .from("programmes")
        .select("*")
        .eq("is_published", true)
        .order("sort_order");
      const ids = (progs ?? []).map((r: any) => r.id);
      const { data: days } = ids.length
        ? await supabase
            .from("programme_days")
            .select("*")
            .in("programme_id", ids)
            .eq("is_active", true)
            .order("sort_order")
        : { data: [] as any[] };
      const list = (progs ?? []).map((r: any) => ({
        ...r,
        cities: r.cities ?? [],
        days: Array.isArray(r.days) ? r.days : [],
        rich_days: (days ?? [])
          .filter((d: any) => d.programme_id === r.id)
          .map((d: any) => ({
            ...d,
            gallery_images: Array.isArray(d.gallery_images) ? d.gallery_images : [],
            schedule_items: Array.isArray(d.schedule_items) ? d.schedule_items : [],
            included_items: Array.isArray(d.included_items) ? d.included_items : [],
            icons: Array.isArray(d.icons) ? d.icons : [],
          })),
      })) as Programme[];
      setRows(list);
      if (list.length) setActiveId(list[0].id);
      setLoading(false);
    })();
  }, []);

  const active = useMemo(
    () => rows.find((r) => r.id === activeId) ?? rows[0],
    [rows, activeId],
  );

  return (
    <>
      <Seo
        title={active ? `${active.title} — lejapon.ma` : "Programme — Voyages Japon | lejapon.ma"}
        description={active?.meta_description || active?.introduction || "Découvrez nos programmes de voyage au Japon : itinéraires détaillés, villes traversées et PDF téléchargeable."}
        canonical="/programme"
      />

      <div className="programme-page w-full max-w-full overflow-x-hidden">
      <ProgrammeHero active={active} loading={loading} />

      <section className="container-app w-full max-w-full [overflow:clip] box-border px-4 sm:px-5 md:px-8 lg:px-12 py-10 md:py-14">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Chargement des programmes…
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            Les programmes seront bientôt disponibles.
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="flex justify-start sm:justify-center mb-10 md:mb-12 -mx-4 px-4 sm:-mx-5 sm:px-5 md:mx-0 md:px-0 overflow-x-auto overflow-y-hidden max-w-[100vw]">
              <div className="inline-flex max-w-full p-1.5 bg-secondary rounded-full border border-border shadow-soft">
                {rows.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setActiveId(r.id)}
                    className={cn(
                      "px-4 sm:px-7 py-2.5 rounded-full text-sm font-semibold transition-all min-h-[44px]",
                      r.id === active?.id
                        ? "bg-foreground text-background shadow-md"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {r.title}
                  </button>
                ))}
              </div>
            </div>

            <AnimatePresence mode="wait">
              {active && (
                <motion.div
                  key={active.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.35 }}
                >
                  {active.rich_days.length > 0 ? (
                    <RichDays programme={active} />
                  ) : (
                    <SimpleSummary active={active} />
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </section>
      </div>

      {/* Floating WhatsApp */}
      <a
        href={`https://wa.me/${WHATSAPP}?text=${encodeURIComponent("Bonjour, je souhaite des informations sur le programme Japon.")}`}
        target="_blank"
        rel="noreferrer"
        aria-label="WhatsApp"
        className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40 w-14 h-14 rounded-full bg-[#25D366] text-white shadow-2xl flex items-center justify-center hover:scale-105 transition-transform"
      >
        <MessageCircle className="w-6 h-6" />
      </a>
    </>
  );
}

function ProgrammeHero({ active, loading }: { active?: Programme; loading: boolean }) {
  const hero = active?.hero_image_url;
  return (
    <section className="relative w-full max-w-full overflow-hidden border-b border-border">
      {hero ? (
        <>
          <Img
            src={hero}
            alt={active?.hero_alt || (active?.title ? `${active.title} — Japon` : "")}
            preset="hero"
            priority
            className="absolute inset-0 w-full max-w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-background/20" />
        </>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-secondary/40 via-background to-background" />
      )}
      <div className="container-app relative w-full max-w-full overflow-hidden box-border px-4 sm:px-5 md:px-8 lg:px-12 py-14 sm:py-20 md:py-32 text-center">
        <motion.span
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="inline-block text-xs uppercase tracking-[0.25em] text-accent font-semibold mb-4"
        >
          {active?.duration || "Itinéraires"}
        </motion.span>
        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="font-display text-3xl sm:text-4xl md:text-6xl tracking-tight leading-tight max-w-full break-words"
        >
          {active?.title || "Nos programmes au Japon"}
        </motion.h1>
        {active?.subtitle && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.12 }}
            className="text-foreground/80 mt-3 text-base sm:text-lg md:text-xl max-w-full break-words"
          >
            {active.subtitle}
          </motion.p>
        )}
        {active?.introduction && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.18 }}
            className="text-muted-foreground mt-5 max-w-2xl mx-auto leading-relaxed text-[15px] sm:text-base px-0 sm:px-2 break-words"
          >
            {active.introduction}
          </motion.p>
        )}
        {!loading && active && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.24 }}
            className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-center gap-3 mt-8 w-full max-w-full"
          >
            <a href="#jour-1" className="btn-primary inline-flex items-center gap-2 w-full sm:w-auto max-w-full min-h-[44px] px-5 sm:px-7 text-center">
              Voir le programme jour par jour <ChevronRight className="w-4 h-4" />
            </a>
            <Link to={active.cta_url || "/contact"} className="btn-outline inline-flex items-center justify-center gap-2 w-full sm:w-auto max-w-full min-h-[44px] px-5 sm:px-7 text-center">
              {active.cta_label || "Demander un devis"}
            </Link>
          </motion.div>
        )}
      </div>
    </section>
  );
}

function SimpleSummary({ active }: { active: Programme }) {
  return (
    <div className="space-y-12 w-full max-w-full [overflow:clip]">
      <div className="bg-background rounded-3xl border border-border p-4 sm:p-6 md:p-10 shadow-soft w-full max-w-full [overflow:clip] box-border">
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground mb-4 max-w-full">
          {active.duration && (
            <span className="inline-flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-accent" /> {active.duration}
            </span>
          )}
          {active.cities.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-accent" /> {active.cities.length} étapes
            </span>
          )}
        </div>
        <h2 className="font-display text-3xl md:text-4xl mb-3 max-w-full break-words">{active.title}</h2>
        {active.description && (
          <p className="text-muted-foreground leading-relaxed max-w-3xl break-words">{active.description}</p>
        )}
        {active.cities.length > 0 && (
          <div className="mt-8">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">
              Itinéraire
            </p>
            <div className="flex flex-wrap items-center gap-2 max-w-full">
              {active.cities.map((c, i) => (
                <div key={`${c}-${i}`} className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className="px-3 py-1.5 bg-secondary rounded-full text-sm font-medium">{c}</span>
                  {i < active.cities.length - 1 && <span className="text-muted-foreground">→</span>}
                </div>
              ))}
            </div>
          </div>
        )}
        {active.pdf_url && (
          <div className="mt-8">
            <a href={active.pdf_url} target="_blank" rel="noreferrer" className="btn-primary inline-flex items-center gap-2">
              <Download className="w-4 h-4" /> Télécharger le PDF
            </a>
          </div>
        )}
      </div>
      {active.days.length > 0 && (
        <div>
          <h3 className="font-display text-2xl md:text-3xl mb-6">Programme jour par jour</h3>
          <ol className="space-y-4">
            {active.days.map((d, i) => (
              <li key={i} className="bg-background rounded-2xl border border-border p-4 sm:p-5 md:p-6 flex gap-4 sm:gap-5 w-full max-w-full overflow-hidden box-border">
                <div className="shrink-0 w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-accent text-accent-foreground font-display text-lg md:text-xl flex items-center justify-center">
                  {d.day}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h4 className="font-medium text-lg break-words min-w-0">{d.title}</h4>
                    {d.city && (
                      <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> {d.city}
                      </span>
                    )}
                  </div>
                  {d.description && (
                    <p className="mt-2 text-sm text-muted-foreground leading-relaxed whitespace-pre-line break-words">{d.description}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function RichDays({ programme }: { programme: Programme }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 w-full max-w-full [overflow:clip] box-border">
      {/* Sticky day nav */}
      <aside className="lg:col-span-3 order-2 lg:order-1 min-w-0 w-full max-w-full">
        <div className="lg:sticky lg:top-[100px] lg:max-h-[calc(100vh-120px)] lg:overflow-y-auto lg:pr-2 lg:pb-6 space-y-3 w-full max-w-full programme-toc-scroll">
          <details className="lg:open:[&>summary]:cursor-default group lg:[&]:open" open>
            <summary className="lg:list-none lg:cursor-default flex items-center justify-between gap-2 cursor-pointer select-none [&::-webkit-details-marker]:hidden">
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Sommaire</p>
              <ChevronRight className="w-4 h-4 lg:hidden transition-transform group-open:rotate-90 text-muted-foreground" />
            </summary>
            <nav className="mt-3 flex flex-col gap-2 w-full max-w-full">
            {programme.rich_days.map((d) => (
              <a
                key={d.id}
                href={`#jour-${d.day_number}`}
                className="min-w-0 max-w-full px-3 py-2 rounded-xl text-sm bg-secondary/60 hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-2 min-h-[44px]"
              >
                <span className="font-display text-accent group-hover:text-accent-foreground">J{d.day_number}</span>
                <span className="min-w-0 text-foreground/80 break-words">{d.city || d.title}</span>
              </a>
            ))}
            </nav>
          </details>
          {programme.pdf_url && (
            <a
              href={programme.pdf_url}
              target="_blank"
              rel="noreferrer"
              className="hidden lg:inline-flex items-center gap-2 mt-4 text-sm text-accent underline underline-offset-4 font-medium"
            >
              <FileText className="w-4 h-4" /> Télécharger le PDF
            </a>
          )}
        </div>
      </aside>

      {/* Days */}
      <div className="lg:col-span-9 order-1 lg:order-2 space-y-12 sm:space-y-16 md:space-y-24 min-w-0 w-full max-w-full [overflow:clip] box-border">
        {programme.rich_days.map((d, idx) => (
          <DaySection key={d.id} day={d} reverse={idx % 2 === 1} programme={programme} showCta={(idx + 1) % 4 === 0} />
        ))}

        {/* Final CTA */}
        <div className="rounded-3xl bg-foreground text-background p-5 sm:p-8 md:p-12 text-center w-full max-w-full overflow-hidden box-border">
          <h3 className="font-display text-2xl sm:text-3xl md:text-4xl mb-3 leading-tight">Prêt à partir au Japon ?</h3>
          <p className="text-background/70 max-w-xl mx-auto mb-6">
            Notre équipe vous accompagne du premier devis à votre retour. Réservez votre place ou demandez un devis personnalisé.
          </p>
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-center gap-3">
            <Link to={programme.cta_url || "/contact"} className="btn-primary">
              {programme.cta_label || "Demander un devis"}
            </Link>
            {programme.pdf_url && (
              <a href={programme.pdf_url} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full border border-background/30 text-background hover:bg-background/10 text-sm font-medium min-h-[44px]">
                <Download className="w-4 h-4" /> Télécharger le PDF
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DaySection({ day, reverse, programme, showCta }: { day: ProgrammeDay; reverse: boolean; programme: Programme; showCta: boolean }) {
  return (
    <article id={`jour-${day.day_number}`} className="scroll-mt-20 md:scroll-mt-24 w-full max-w-full overflow-hidden box-border">
      <div className={cn("grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6 md:gap-10 items-start w-full max-w-full min-w-0 overflow-hidden box-border")}>
        {/* Image + galerie */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
          className={cn("space-y-3 min-w-0 w-full max-w-full overflow-hidden box-border", reverse && "md:order-2")}
        >
          <div className="relative w-full max-w-full rounded-2xl sm:rounded-3xl overflow-hidden bg-secondary aspect-[16/11] sm:aspect-[4/3] max-h-[58vh] box-border">
            {day.main_image_url ? (
              <Img
                src={day.main_image_url}
                alt={day.title}
                preset="card"
                sizes="(max-width: 767px) 100vw, 50vw"
                className="block w-full max-w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                <MapPin className="w-12 h-12 opacity-30" />
              </div>
            )}
            <div className="absolute top-3 left-3 right-3 sm:top-4 sm:left-4 sm:right-auto inline-flex flex-wrap items-center gap-2 max-w-[calc(100%-1.5rem)] sm:max-w-[calc(100%-2rem)]">
              <span className="px-3 py-1.5 rounded-full bg-accent text-accent-foreground text-xs font-display font-semibold shadow">
                Jour {day.day_number}
              </span>
              {day.is_optional && (
                <span className="px-3 py-1.5 rounded-full bg-background/90 text-foreground text-xs font-medium shadow">Optionnel</span>
              )}
            </div>
          </div>
          {day.gallery_images.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:gap-3 w-full max-w-full overflow-hidden box-border">
              {day.gallery_images.map((g, i) => (
                <div key={i} className="relative min-w-0 w-full max-w-full rounded-xl sm:rounded-2xl overflow-hidden bg-secondary aspect-[16/11] sm:aspect-[4/3] max-h-[28vh] box-border">
                  <Img
                    src={g}
                    alt={`${day.title} — photo ${i + 1}`}
                    preset="thumb"
                    className="block w-full max-w-full h-full object-cover hover:scale-105 transition-transform duration-500"
                    sizes="(max-width: 767px) 50vw, 25vw"
                  />
                </div>
              ))}
            </div>
          )}
        </motion.div>

        {/* Content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, delay: 0.05 }}
          className="min-w-0 w-full max-w-full overflow-hidden box-border"
        >
          {(day.city || day.badge) && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-accent font-semibold mb-2 max-w-full">
              <MapPin className="w-4 h-4" />
              {day.badge || day.city}
            </div>
          )}
          <h3 className="font-display text-2xl sm:text-[1.75rem] md:text-3xl mb-3 leading-tight break-words hyphens-auto">{day.title}</h3>
          {day.description && (
            <p className="text-muted-foreground leading-relaxed whitespace-pre-line text-[15px] sm:text-base break-words max-w-full">{day.description}</p>
          )}

          {/* Icons */}
          {day.icons.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-5 w-full max-w-full">
              {day.icons.map((id) => (
                <span key={id} className="inline-flex min-w-0 max-w-full items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-xs font-medium">
                  <DayIcon id={id} className="w-3.5 h-3.5 text-accent" />
                  {iconLabel(id)}
                </span>
              ))}
            </div>
          )}

          {/* Schedule timeline */}
          {day.schedule_items.length > 0 && (
            <div className="mt-6 w-full max-w-full overflow-hidden">
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">Programme de la journée</p>
              <ol className="relative border-l-2 border-accent/30 pl-5 space-y-5 sm:space-y-4 w-full max-w-full box-border">
                {day.schedule_items.map((s, i) => (
                  <li key={i} className="relative min-w-0 w-full max-w-full">
                    <span className="absolute -left-[27px] top-1 w-3 h-3 rounded-full bg-accent ring-4 ring-background" />
                    <div className="text-sm min-w-0 w-full max-w-full">
                      <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2 min-w-0 w-full max-w-full">
                        <span className="font-display text-accent font-semibold min-w-0 max-w-full">{s.time}</span>
                        <span className="font-medium text-foreground break-words min-w-0 max-w-full">{s.title}</span>
                      </div>
                      {s.description && <p className="text-muted-foreground mt-1 leading-relaxed break-words max-w-full">{s.description}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Included */}
          {day.included_items.length > 0 && (
            <div className="mt-6 rounded-2xl border border-border bg-secondary/40 p-4 sm:p-5 w-full max-w-full overflow-hidden box-border">
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Inclus ce jour-là</p>
              <ul className="flex flex-wrap gap-2 w-full max-w-full">
                {day.included_items.map((it, i) => (
                  <li key={i} className="flex min-w-0 w-full sm:w-[calc(50%-0.25rem)] max-w-full items-start gap-2 text-sm leading-snug">
                    {it.icon ? (
                      <DayIcon id={it.icon} className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                    ) : (
                      <Check className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                    )}
                    <span className="break-words min-w-0 max-w-full">{it.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {day.special_note && (
            <div className="mt-5 flex gap-2 text-sm bg-accent/10 text-foreground rounded-xl p-3 w-full max-w-full overflow-hidden box-border">
              <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
              <p className="min-w-0 max-w-full break-words">{day.special_note}</p>
            </div>
          )}
        </motion.div>
      </div>

      {showCta && (
        <div className="mt-10 text-center">
          <Link to={programme.cta_url || "/contact"} className="btn-primary inline-flex items-center gap-2">
            {programme.cta_label || "Demander un devis"} <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      )}
    </article>
  );
}

function iconLabel(id: string) {
  const map: Record<string, string> = {
    bus: "Bus privé", train: "Train", shinkansen: "Shinkansen", plane: "Vol",
    guide: "Guide", meal: "Repas", hotel: "Hôtel", free: "Journée libre",
    option: "Option", walk: "À pied", boat: "Bateau",
  };
  return map[id] ?? id;
}