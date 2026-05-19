import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Seo } from "@/components/Seo";
import { supabase } from "@/integrations/supabase/client";
import hero from "@/assets/hero-fuji.jpg";
import shibuya from "@/assets/tokyo-shibuya.jpg";
import torii from "@/assets/torii.jpg";
import { TripCard, type TripCardData } from "@/components/trips/TripCard";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslatedTable } from "@/hooks/useTranslated";

const fallbackImgs = [hero, torii, shibuya];

type Trip = TripCardData;

const Trips = () => {
  const { t } = useTranslation();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [season, setSeason] = useState<string>("all");
  const [destination, setDestination] = useState<string>("");
  const [maxPrice, setMaxPrice] = useState<string>("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("trips")
        .select("id,title,slug,label,season,start_date,end_date,duration_days,base_price_mad,currency,cover_url,cover_alt,slots_left,highlights,destinations,badge_type,badge_text,promo_percent,program_link,sort_order")
        .in("status", ["open", "completed"])
        .order("sort_order", { ascending: true })
        .order("start_date", { ascending: true, nullsFirst: false });
      setTrips((data ?? []) as Trip[]);
      setLoading(false);
    })();
  }, []);

  const localized = useTranslatedTable("trips", trips, [
    "title",
    "season",
    "label",
    "cover_alt",
  ] as (keyof Trip & string)[]);

  const seasons = Array.from(new Set(localized.map((t) => t.season).filter(Boolean))) as string[];

  const filtered = localized.filter((tr) => {
    if (season !== "all" && tr.season !== season) return false;
    if (destination) {
      const haystack = [...(tr.destinations ?? []), ...(tr.highlights ?? []), tr.title].join(" ").toLowerCase();
      if (!haystack.includes(destination.toLowerCase())) return false;
    }
    if (maxPrice && tr.base_price_mad > Number(maxPrice)) return false;
    return true;
  });

  return (
    <div className="container-app py-20 md:py-28">
      <Seo
        title="Nos voyages au Japon depuis Casablanca — lejapon.ma"
        description="Découvrez nos voyages organisés au Japon depuis Casablanca. Quatre saisons magnifiques, plusieurs départs inoubliables. Vols, hôtels et guides bilingues inclus."
        canonical="/voyages"
      />
      <p className="eyebrow mb-4">{t("nav.trips")}</p>
      <h1 className="font-display text-5xl md:text-7xl mb-6 max-w-4xl">
        Quatre saisons magnifiques,<br />
        <span className="text-accent">plusieurs départs au Japon inoubliables.</span>
      </h1>
      <p className="max-w-2xl text-foreground/70 text-lg mb-12">
        Chacun de nos départs est un univers à part. Choisissez la saison qui vous appelle.
      </p>

      {/* Filters */}
      {trips.length > 0 && (
        <div className="grid sm:grid-cols-3 gap-3 mb-10 max-w-3xl">
          <Select value={season} onValueChange={setSeason}>
            <SelectTrigger><SelectValue placeholder="Saison" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les saisons</SelectItem>
              {seasons.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
            </SelectContent>
          </Select>
          <Input placeholder="Destination (Tokyo, Kyoto…)" value={destination} onChange={(e) => setDestination(e.target.value)} />
          <Input placeholder="Prix max (MAD)" type="number" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
        </div>
      )}

      {loading ? (
        <p className="text-foreground/60">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-foreground/60">Aucun départ disponible pour le moment. Revenez bientôt.</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((trip, i) => (
            <TripCard key={trip.id} trip={trip} index={i} fallbackImage={fallbackImgs[i % fallbackImgs.length]} />
          ))}
        </div>
      )}
    </div>
  );
};
export default Trips;
