import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles, MapPin } from "lucide-react";
import { fmtDate } from "@/lib/format";
import { Img } from "@/components/ui/Img";

export type TripCardData = {
  id: string;
  title: string;
  slug: string;
  label?: string | null;
  season?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  duration_days?: number | null;
  base_price_mad: number;
  currency?: string | null;
  cover_url?: string | null;
  cover_alt?: string | null;
  slots_left?: number | null;
  destinations?: string[] | null;
  highlights?: string[] | null;
  badge_type?: string | null;
  badge_text?: string | null;
  promo_percent?: number | null;
  program_link?: string | null;
};

const badgeStyles: Record<string, string> = {
  popular: "bg-gradient-vermillion text-accent-foreground",
  new: "bg-foreground text-background",
  bestseller: "bg-accent text-accent-foreground",
};

const badgeLabels: Record<string, string> = {
  popular: "Plus populaire",
  new: "Nouveau",
  bestseller: "Bestseller",
};

function formatDates(s?: string | null, e?: string | null) {
  if (!s && !e) return "";
  if (s && e) return `${fmtDate(s)} → ${fmtDate(e)}`;
  return fmtDate((s ?? e) as string);
}

export function TripCard({ trip, index = 0, fallbackImage }: { trip: TripCardData; index?: number; fallbackImage?: string }) {
  const href = trip.program_link || `/programme?trip=${trip.slug}`;
  const bookingHref = `/reserver?trip=${encodeURIComponent(trip.slug)}`;
  const cover = trip.cover_url || fallbackImage;
  const dests = (trip.destinations && trip.destinations.length > 0 ? trip.destinations : trip.highlights) ?? [];
  const badgeKey = (trip.badge_type || "").toLowerCase();
  const badgeText = trip.badge_text || badgeLabels[badgeKey];
  const showBadge = !!badgeKey && !!badgeText;
  const currency = trip.currency || "MAD";

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className="h-full"
    >
      <div className="group flex flex-col h-full bg-background rounded-[20px] overflow-hidden border border-border shadow-soft hover:shadow-2xl hover:-translate-y-1 transition-all duration-500">
        {/* IMAGE */}
        <Link to={href} className="relative aspect-[4/5] overflow-hidden block">
          {cover ? (
            <Img
              src={cover}
              alt={trip.cover_alt || trip.title}
              preset="card"
              widths={[400, 600, 800, 1000]}
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-silk"
            />
          ) : (
            <div className="w-full h-full bg-secondary" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />

          {/* Badges - top left */}
          <div className="absolute top-4 left-4 flex flex-col gap-2 items-start">
            {showBadge && (
              <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-full shadow-cta ${badgeStyles[badgeKey] || "bg-foreground text-background"}`}>
                <Sparkles className="w-3 h-3" /> {badgeText}
              </span>
            )}
            {typeof trip.duration_days === "number" && trip.duration_days > 0 && (
              <span className="inline-flex items-center bg-white/95 backdrop-blur-md text-foreground text-xs font-semibold px-3 py-1.5 rounded-full shadow-soft">
                {trip.duration_days} jours
              </span>
            )}
            {typeof trip.slots_left === "number" && trip.slots_left > 0 && trip.slots_left <= 6 && (
              <span className="inline-flex items-center gap-1.5 bg-destructive/95 backdrop-blur-md text-destructive-foreground text-xs font-semibold px-3 py-1.5 rounded-full shadow-soft">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                {trip.slots_left} places
              </span>
            )}
          </div>

          {/* Promo - top right */}
          {typeof trip.promo_percent === "number" && trip.promo_percent > 0 && (
            <div className="absolute top-4 right-4">
              <span className="inline-flex items-center bg-accent text-accent-foreground text-xs font-bold px-3 py-1.5 rounded-full shadow-cta">
                -{trip.promo_percent}%
              </span>
            </div>
          )}

          {/* Text overlay - bottom of image */}
          <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
            {(trip.label || trip.season) && (
              <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-white/85 mb-2">
                {[trip.label, trip.season].filter(Boolean).join(" · ")}
              </p>
            )}
            <h3 className="font-display text-2xl md:text-[1.65rem] leading-tight mb-1.5">{trip.title}</h3>
            {(trip.start_date || trip.end_date) && (
              <p className="text-sm text-white/85">{formatDates(trip.start_date, trip.end_date)}</p>
            )}
          </div>
        </Link>

        {/* BOTTOM - white panel */}
        <div className="p-6 flex flex-col gap-5 flex-1">
          {dests.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {dests.slice(0, 6).map((d) => (
                <span key={d} className="text-xs px-2.5 py-1 rounded-full bg-secondary text-foreground/70 inline-flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> {d}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-end justify-between mt-auto pt-2">
            <div>
              <p className="text-xs text-muted-foreground">À partir de</p>
              <p className="font-display text-3xl font-bold text-accent leading-none mt-1">
                {new Intl.NumberFormat("fr-FR").format(trip.base_price_mad)}{" "}
                <span className="text-sm font-semibold text-accent/80">{currency}</span>
              </p>
            </div>
            <Link
              to={bookingHref}
              aria-label={`S'inscrire au voyage ${trip.title}`}
              className="w-11 h-11 rounded-full bg-foreground text-background flex items-center justify-center group-hover:bg-accent group-hover:rotate-[-45deg] transition-all duration-300"
            >
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
