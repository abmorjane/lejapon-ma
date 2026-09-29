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
          Le Japon se savoure autant dans ses grandes villes que dans ses instants plus calmes. Découvrez nos départs depuis Casablanca, choisissez la saison qui vous attire et avancez avec une équipe qui connaît la destination. Dates, itinéraires et tarifs sont présentés avant votre réservation.
        </p>
      </header>

      <section aria-labelledby="departures-title" className="mt-16 md:mt-20">
        <div className="mb-8 max-w-3xl">
          <p className="eyebrow mb-3">Dates et disponibilités</p>
          <h2 id="departures-title" className="font-display text-3xl md:text-5xl text-balance">Nos prochains départs du Maroc vers le Japon</h2>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            Printemps, été ou automne : chaque départ a son rythme. Retrouvez ici les voyages actuellement ouverts, avec leurs dates et leurs prix, puis explorez le programme qui vous donne envie de partir.
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
            <p className="text-foreground/60">Aucun voyage ne correspond à ces critères pour le moment. Essayez une autre saison ou <Link to="/contact" className="font-semibold text-accent underline underline-offset-4">parlez-nous de votre projet</Link>.</p>
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
            <p className="eyebrow mb-3">Le prix, en toute clarté</p>
            <h2 id="price-title" className="font-display text-3xl md:text-4xl text-balance">Plus de Japon pour votre budget</h2>
            <p className="mt-4 text-foreground/80 leading-relaxed">
              Avant de comparer deux prix, regardez aussi la saison, la durée, les hôtels, les transports, les visites incluses et l’accompagnement. Nos circuits relient ces éléments pour vous offrir un vrai voyage au Japon, pas seulement un billet d’avion.
            </p>
            <p className="mt-4 text-muted-foreground leading-relaxed">
              {lowestPrice !== null ? (
                <>
                  Pour les départs ouverts aujourd’hui, les prix de base commencent à {formatPrice(lowestPrice)} MAD{lowestPrice !== highestPrice ? ` et vont jusqu’à ${formatPrice(highestPrice as number)} MAD` : ""}. Choisissez votre voyage pour voir le détail des prestations et le montant estimé avec vos options.
                </>
              ) : (
                <>Les tarifs apparaissent avec les prochains départs ouverts. Vous pouvez déjà découvrir les circuits et nous parler de votre projet.</>
              )}
            </p>
            <Link to="/reserver" className="btn-primary mt-7 inline-flex">Voir le prix de mon voyage</Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <article className="rounded-2xl border border-border bg-background p-5">
              <h3 className="font-display text-xl">Voyagez l’esprit plus libre</h3>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">Sur les circuits proposés, les vols, les hôtels, les transports et plusieurs visites figurent dans les prestations prévues selon le programme. Déjeuners et dîners libres, lorsqu’ils sont prévus, deviennent une occasion de goûter le Japon à votre façon plutôt que de suivre un menu de groupe.</p>
            </article>
            <article className="rounded-2xl border border-border bg-background p-5">
              <h3 className="font-display text-xl">Personnalisez sans mauvaise surprise</h3>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">Chambre individuelle, formule ou expérience supplémentaire : ces choix enrichissent votre séjour, ils ne servent pas à compléter un prix d’appel. Le montant estimé apparaît avant l’envoi de votre demande, puis notre équipe confirme les disponibilités et les conditions.</p>
            </article>
          </div>
        </div>
      </section>

      <section aria-labelledby="support-title" className="mt-20">
        <div className="max-w-3xl">
          <p className="eyebrow mb-3">Un voyage pensé de bout en bout</p>
          <h2 id="support-title" className="font-display text-3xl md:text-5xl text-balance">L’accompagnement LeJapon.ma, de Casablanca au Japon</h2>
          <p className="mt-4 text-muted-foreground leading-relaxed">Vous savez où vous allez, tout en gardant de la place pour la découverte. Les prestations et la présence de l’équipe sont précisées pour chaque départ.</p>
        </div>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Le voyage commence à Casablanca", "Selon le départ, retrouvez le groupe et votre accompagnement dès les premières étapes de l’aventure."],
            ["Des échanges plus simples au Japon", "Selon le programme, un accompagnateur francophone parlant japonais facilite les échanges et vous aide à comprendre les usages locaux."],
            ["Moins de trajets à organiser", "Les hôtels et les transports prévus au programme vous évitent de construire seuls chaque étape du circuit."],
            ["Du temps pour votre propre Japon", "Quand le programme le prévoit, profitez d’une journée ou d’un repas libre pour explorer un quartier, un café ou une spécialité qui vous tente."],
            ["Des souvenirs qui vous ressemblent", "Cérémonie du thé, art immersif ou autres activités disponibles : ajoutez les expériences qui vous font vraiment envie."],
            ["Un dossier de visa moins intimidant", "Nous vous aidons à réunir les pièces adaptées à votre situation. La délivrance du visa reste décidée par l’ambassade."],
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
          <h2 id="season-title" className="font-display text-3xl md:text-4xl">Quel Japon avez-vous envie de découvrir&nbsp;?</h2>
          <p className="mt-4 leading-relaxed text-background/75">
            Cerisiers au printemps, festivals en été ou couleurs d’automne : chaque saison révèle un autre Japon. Imaginez les moments que vous voulez vivre, puis plongez dans le <Link to="/programme" className="underline underline-offset-4">programme de chaque circuit</Link>.
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
