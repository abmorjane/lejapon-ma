import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Img } from "@/components/ui/Img";
import { supabase } from "@/integrations/supabase/client";
import { HotelCatalogItem, getLocalizedHotelText, hotelCatalogColumns } from "@/lib/hotel-catalog";

type DbClient = { from: (table: string) => any };
const db = supabase as unknown as DbClient;

export default function AgencyHotels() {
  const [hotels, setHotels] = useState<HotelCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [city, setCity] = useState("all");

  useEffect(() => {
    const loadHotels = async () => {
      setLoading(true);
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
        setError(null);
        setHotels((data ?? []) as HotelCatalogItem[]);
      }
      setLoading(false);
    };
    void loadHotels();
  }, []);

  const cities = useMemo(() => Array.from(new Set(hotels.map((hotel) => hotel.city).filter(Boolean))).sort(), [hotels]);
  const visibleHotels = city === "all" ? hotels : hotels.filter((hotel) => hotel.city === city);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Hôtels</h1>
        <p className="mt-1 text-sm text-muted-foreground">Catalogue recommandé pour préparer vos propositions clients.</p>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap gap-2">
          <Button variant={city === "all" ? "default" : "outline"} onClick={() => setCity("all")}>Toutes les villes</Button>
          {cities.map((item) => (
            <Button key={item} variant={city === item ? "default" : "outline"} onClick={() => setCity(item)}>{item}</Button>
          ))}
        </div>
      </Card>

      {error && <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{error}</Card>}
      {loading ? (
        <Card className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement des hôtels…
        </Card>
      ) : visibleHotels.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">Aucun hôtel actif disponible.</Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {visibleHotels.map((hotel) => (
            <Card key={hotel.id} className="overflow-hidden">
              <Img src={hotel.main_image_url || "/placeholder.svg"} alt={hotel.name} className="h-52 w-full object-cover" />
              <div className="space-y-4 p-5">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.12em] text-accent">{hotel.city} · {hotel.category || "Hôtel"}</p>
                  <h2 className="mt-2 font-display text-2xl">{hotel.name}</h2>
                  <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                    {getLocalizedHotelText(hotel, "short_description", "fr") || hotel.address || "Description bientôt disponible."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {hotel.website_url && (
                    <Button asChild variant="outline" size="sm">
                      <a href={hotel.website_url} target="_blank" rel="noreferrer">
                        Site <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  )}
                  {hotel.brochure_pdf_url && (
                    <Button asChild size="sm">
                      <a href={hotel.brochure_pdf_url} target="_blank" rel="noreferrer">
                        Brochure <Download className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
