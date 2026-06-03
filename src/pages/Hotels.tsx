import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, Loader2, MapPin, Phone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Seo } from "@/components/Seo";
import { Img } from "@/components/ui/Img";
import { supabase } from "@/integrations/supabase/client";
import {
  HotelCatalogItem,
  getLocalizedHotelText,
  groupHotelsByCity,
  hotelCatalogColumns,
} from "@/lib/hotel-catalog";

type DbClient = { from: (table: string) => any };
const db = supabase as unknown as DbClient;

const placeholderImage = "/placeholder.svg";

export default function HotelsPage() {
  const { slug } = useParams();
  const { i18n } = useTranslation();
  const [hotels, setHotels] = useState<HotelCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [city, setCity] = useState("all");

  useEffect(() => {
    const loadHotels = async () => {
      setLoading(true);
      setError(null);
      const { data, error } = await db
        .from("hotel_catalog")
        .select(hotelCatalogColumns)
        .eq("is_active", true)
        .order("city", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      if (error) {
        setError(error.message);
        setHotels([]);
      } else {
        setHotels((data ?? []) as HotelCatalogItem[]);
      }
      setLoading(false);
    };
    void loadHotels();
  }, []);

  const activeHotel = slug ? hotels.find((hotel) => hotel.slug === slug || hotel.id === slug) : null;
  const cities = useMemo(() => Array.from(new Set(hotels.map((hotel) => hotel.city).filter(Boolean))).sort(), [hotels]);
  const filteredHotels = city === "all" ? hotels : hotels.filter((hotel) => hotel.city === city);
  const groupedHotels = groupHotelsByCity(filteredHotels);

  if (activeHotel) {
    const shortText = getLocalizedHotelText(activeHotel, "short_description", i18n.language);
    const fullText = getLocalizedHotelText(activeHotel, "full_description", i18n.language) || shortText;
    const gallery = [activeHotel.main_image_url, ...(activeHotel.gallery_urls ?? [])].filter(Boolean) as string[];

    return (
      <main className="min-h-screen bg-background">
        <Seo title={`${activeHotel.name} | Hôtels au Japon`} description={shortText || activeHotel.address || undefined} />
        <section className="container pt-10 pb-16">
          <Button asChild variant="ghost" className="mb-6">
            <Link to="/hotels">
              <ArrowLeft className="h-4 w-4" />
              Retour aux hôtels
            </Link>
          </Button>
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
            <div className="overflow-hidden rounded-2xl border border-border bg-secondary/25">
              <Img src={activeHotel.main_image_url || placeholderImage} alt={activeHotel.name} className="h-[420px] w-full object-cover" />
            </div>
            <div className="space-y-5">
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.16em] text-accent">{activeHotel.city} · {activeHotel.category || "Hôtel"}</p>
                <h1 className="mt-2 font-display text-4xl">{activeHotel.name}</h1>
                {shortText && <p className="mt-4 text-lg text-muted-foreground">{shortText}</p>}
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                {(activeHotel.amenities ?? []).map((amenity) => (
                  <span key={amenity} className="rounded-full border border-border px-3 py-1 text-muted-foreground">{amenity}</span>
                ))}
              </div>
              <div className="space-y-3 rounded-2xl border border-border p-5 text-sm">
                {activeHotel.address && <p className="flex gap-2"><MapPin className="h-4 w-4 text-accent" />{activeHotel.address}</p>}
                {activeHotel.phone && <p className="flex gap-2"><Phone className="h-4 w-4 text-accent" />{activeHotel.phone}</p>}
                <div className="flex flex-wrap gap-2">
                  {activeHotel.website_url && (
                    <Button asChild variant="outline" size="sm">
                      <a href={activeHotel.website_url} target="_blank" rel="noreferrer">
                        Site web <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  )}
                  {activeHotel.google_maps_url && (
                    <Button asChild variant="outline" size="sm">
                      <a href={activeHotel.google_maps_url} target="_blank" rel="noreferrer">
                        Google Maps <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
            <article className="prose prose-stone max-w-none">
              <h2>Présentation</h2>
              <p className="whitespace-pre-line">{fullText || "Description bientôt disponible."}</p>
            </article>
            <Card className="p-5">
              <h2 className="font-display text-xl">Avantages</h2>
              <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                {(activeHotel.advantages ?? []).length > 0
                  ? activeHotel.advantages?.map((advantage) => <li key={advantage}>- {advantage}</li>)
                  : <li>- À compléter</li>}
              </ul>
            </Card>
          </div>

          {gallery.length > 1 && (
            <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {gallery.slice(1).map((image) => (
                <Img key={image} src={image} alt={activeHotel.name} className="h-48 w-full rounded-xl object-cover" />
              ))}
            </div>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <Seo
        title="Notre sélection d’hôtels par ville au Japon"
        description="Découvrez les hôtels recommandés par LeJapon.ma à Tokyo, Kyoto, Osaka et dans les principales villes du Japon."
      />
      <section className="container py-14">
        <div className="max-w-3xl">
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-accent">Hôtels au Japon</p>
          <h1 className="mt-3 font-display text-4xl md:text-5xl">Notre sélection d’hôtels par ville au Japon</h1>
          <p className="mt-4 text-lg text-muted-foreground">Des adresses soigneusement choisies pour préparer un séjour clair, confortable et cohérent avec chaque itinéraire.</p>
        </div>

        <div className="mt-8 flex flex-wrap gap-2">
          <Button variant={city === "all" ? "default" : "outline"} onClick={() => setCity("all")}>Toutes</Button>
          {cities.map((item) => (
            <Button key={item} variant={city === item ? "default" : "outline"} onClick={() => setCity(item)}>
              {item}
            </Button>
          ))}
        </div>

        {error && <Card className="mt-8 border-amber-200 bg-amber-50 p-4 text-amber-950">{error}</Card>}
        {loading ? (
          <div className="mt-12 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement des hôtels…
          </div>
        ) : filteredHotels.length === 0 ? (
          <p className="mt-12 text-muted-foreground">Les hôtels seront bientôt disponibles.</p>
        ) : (
          <div className="mt-10 space-y-12">
            {Object.entries(groupedHotels).map(([groupCity, group]) => (
              <section key={groupCity}>
                <h2 className="font-display text-3xl">{groupCity}</h2>
                <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                  {group.map((hotel) => {
                    const text = getLocalizedHotelText(hotel, "short_description", i18n.language);
                    return (
                      <Card key={hotel.id} className="overflow-hidden">
                        <Img src={hotel.main_image_url || placeholderImage} alt={hotel.name} className="h-56 w-full object-cover" />
                        <div className="p-5">
                          <p className="text-xs font-medium uppercase tracking-[0.12em] text-accent">{hotel.category || "Hôtel"}</p>
                          <h3 className="mt-2 font-display text-2xl">{hotel.name}</h3>
                          <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{text || hotel.address || "Description bientôt disponible."}</p>
                          <Button asChild className="mt-5 w-full">
                            <Link to={`/hotels/${hotel.slug || hotel.id}`}>Voir l'hôtel</Link>
                          </Button>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
