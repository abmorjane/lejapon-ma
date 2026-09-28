import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Seo } from "@/components/Seo";
import { supabase } from "@/integrations/supabase/client";
import hero from "@/assets/hero-fuji.jpg";
import shibuya from "@/assets/tokyo-shibuya.jpg";
import torii from "@/assets/torii.jpg";
import { TripCard, TripCardSkeleton, type TripCardData } from "@/components/trips/TripCard";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslatedTable } from "@/hooks/useTranslated";
import { commercialDateKey } from "@/lib/public-commercial-visibility";

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
        .is("archived_at", null)
        .eq("status", "open")
        .gte("end_date", commercialDateKey())
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
  const availablePrices = localized
    .map((trip) => Number(trip.base_price_mad))
    .filter((price) => Number.isFinite(price) && price > 0);
  const lowestPrice = availablePrices.length ? Math.min(...availablePrices) : null;
  const highestPrice = availablePrices.length ? Math.max(...availablePrices) : null;
  const formatPrice = (price: number) => new Intl.NumberFormat("fr-FR").format(price);

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
    <div className="container-app py-16 md:py-24">
      <Seo
        title="Voyage Japon depuis le Maroc | Départs organisés — LeJapon.ma"
        description="Découvrez nos voyages organisés au Japon depuis le Maroc : départs de Casablanca, dates, circuits, tarifs des départs et accompagnement LeJapon.ma."
        canonical="/voyages"
        prerenderReady={!loading}
      />
      <header className="max-w-4xl">
        <p className="eyebrow mb-4">{t("nav.trips")}</p>
        <h1 className="font-display text-5xl md:text-7xl mb-6 text-balance">
          Voyages organisés au Japon <span className="text-accent">depuis le Maroc.</span>
        </h1>
        <p className="max-w-3xl text-foreground/70 text-lg leading-relaxed">
          LeJapon.ma réunit sur une seule page les prochains départs depuis Casablanca, leurs dates, leur durée et leur tarif publié. Comparez les saisons, consultez le circuit correspondant et choisissez le voyage au Japon qui vous ressemble.
        </p>
      </header>

      <section aria-labelledby="departures-title" className="mt-16 md:mt-20">
        <div className="mb-8 max-w-3xl">
          <p className="eyebrow mb-3">Dates et disponibilités</p>
          <h2 id="departures-title" className="font-display text-3xl md:text-5xl text-balance">Nos prochains départs du Maroc vers le Japon</h2>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            Chaque fiche présente les informations commerciales du départ sélectionné. Les disponibilités, les dates et les prix ci-dessous proviennent directement de notre catalogue de voyages ouvert à la réservation.
          </p>
        </div>

        {trips.length > 0 && (
          <div className="grid sm:grid-cols-3 gap-3 mb-10 max-w-3xl" aria-label="Filtrer les voyages au Japon">
            <Select value={season} onValueChange={setSeason}>
              <SelectTrigger><SelectValue placeholder="Saison" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes les saisons</SelectItem>
                {seasons.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
              </SelectContent>
            </Select>
            <Input aria-label="Filtrer par destination" placeholder="Destination (Tokyo, Kyoto…)" value={destination} onChange={(e) => setDestination(e.target.value)} />
            <Input aria-label="Filtrer par prix maximum" placeholder="Prix max (MAD)" type="number" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
          </div>
        )}

        {loading ? (
          <div className="grid min-h-[650px] gap-6 sm:min-h-[700px] sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <TripCardSkeleton key={index} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex min-h-[420px] items-center rounded-3xl border border-dashed border-border p-8">
            <p className="text-foreground/60">Aucun départ disponible pour ces critères. Modifiez les filtres ou revenez bientôt.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((trip, i) => (
              <TripCard key={trip.id} trip={trip} index={i} fallbackImage={fallbackImgs[i % fallbackImgs.length]} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="price-title" className="mt-20 rounded-3xl border border-border bg-secondary/35 p-6 sm:p-8 md:p-12">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-start">
          <div>
            <p className="eyebrow mb-3">Budget transparent</p>
            <h2 id="price-title" className="font-display text-3xl md:text-4xl text-balance">Quel prix pour un voyage organisé au Japon depuis le Maroc&nbsp;?</h2>
            <p className="mt-4 text-muted-foreground leading-relaxed">
              {lowestPrice !== null ? (
                <>
                  Les départs actuellement ouverts affichent un prix de base {lowestPrice === highestPrice ? `de ${formatPrice(lowestPrice)} MAD` : `compris entre ${formatPrice(lowestPrice)} et ${formatPrice(highestPrice as number)} MAD`}. Ces montants restent liés au voyage choisi et sont mis à jour avec le catalogue.
                </>
              ) : (
                <>Le prix de chaque départ est publié dès que ses conditions commerciales sont ouvertes à la réservation.</>
              )}
            </p>
            <Link to="/reserver" className="btn-primary mt-7 inline-flex">Composer mon voyage et vérifier le prix</Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <article className="rounded-2xl border border-border bg-background p-5">
              <h3 className="font-display text-xl">Ce que comprend le départ</h3>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">Le programme et le récapitulatif de réservation précisent les vols, hôtels, transports, visites et prestations incluses pour le circuit sélectionné.</p>
            </article>
            <article className="rounded-2xl border border-border bg-background p-5">
              <h3 className="font-display text-xl">Ce qui peut faire varier le montant</h3>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">La formule, le type de chambre, les expériences optionnelles, les offres en cours et les disponibilités sont calculés avant confirmation, sans masquer le total final.</p>
            </article>
          </div>
        </div>
      </section>

      <section aria-labelledby="support-title" className="mt-20">
        <div className="max-w-3xl">
          <p className="eyebrow mb-3">Un voyage pensé de bout en bout</p>
          <h2 id="support-title" className="font-display text-3xl md:text-5xl text-balance">L’accompagnement LeJapon.ma, de Casablanca au Japon</h2>
          <p className="mt-4 text-muted-foreground leading-relaxed">Le contenu exact varie selon le départ, mais chaque circuit est présenté avec un cadre lisible avant la réservation.</p>
        </div>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Départ depuis Casablanca", "Les dates, la durée et l’organisation du départ sont indiquées pour chaque voyage ouvert."],
            ["Accompagnement selon le programme", "Le départ précise si un accompagnateur francophone parlant japonais est mobilisé, ainsi que les repères utiles pour voyager sereinement sur place."],
            ["Hôtels et transports", "Consultez les hébergements et les déplacements prévus dans le programme du circuit."],
            ["Journées libres", "Les temps libres apparaissent dans l’itinéraire afin de garder une place à vos découvertes personnelles."],
            ["Expériences au Japon", "Des activités culturelles ou de loisirs peuvent compléter le programme selon vos envies."],
            ["Assistance visa", "Les participants disposent d’un accompagnement pour préparer leur demande, sans garantie de délivrance."],
          ].map(([title, text]) => (
            <article key={title} className="rounded-2xl border border-border bg-card p-6 shadow-soft">
              <h3 className="font-display text-xl">{title}</h3>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="season-title" className="mt-20 grid gap-8 rounded-3xl bg-foreground p-7 text-background sm:p-10 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="max-w-3xl">
          <p className="eyebrow !text-background/60 mb-3">Saisons et itinéraires</p>
          <h2 id="season-title" className="font-display text-3xl md:text-4xl">Choisir son circuit au Japon selon le départ</h2>
          <p className="mt-4 leading-relaxed text-background/75">
            {seasons.length > 0 ? `Les départs disponibles couvrent actuellement ${seasons.join(" et ")}. ` : "Chaque saison révèle un Japon différent. "}
            Comparez le rythme, les villes et les journées libres dans le programme détaillé avant de réserver.
          </p>
          <nav aria-label="Préparer son voyage au Japon" className="mt-6 flex flex-wrap gap-x-5 gap-y-3 text-sm font-semibold">
            <Link to="/programme" className="text-accent hover:underline underline-offset-4">Voir les circuits et itinéraires</Link>
            <Link to="/experiences" className="text-accent hover:underline underline-offset-4">Découvrir les expériences au Japon</Link>
            <Link to="/hotels" className="text-accent hover:underline underline-offset-4">Consulter les hôtels sélectionnés</Link>
            <Link to="/visa-japon-maroc" className="text-accent hover:underline underline-offset-4">Préparer le visa Japon au Maroc</Link>
            <Link to="/a-propos" className="text-accent hover:underline underline-offset-4">Découvrir l’agence LeJapon.ma</Link>
          </nav>
        </div>
        <Link to="/reserver" className="btn-primary whitespace-nowrap">Réserver mon voyage au Japon</Link>
      </section>
    </div>
  );
};
export default Trips;
