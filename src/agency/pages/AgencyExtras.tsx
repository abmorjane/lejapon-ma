import { useEffect, useMemo, useState } from "react";
import { Loader2, MapPin, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Img } from "@/components/ui/Img";
import { supabase } from "@/integrations/supabase/client";
import { fmtMAD } from "@/lib/format";

type DbClient = { from: (table: string) => any };
const db = supabase as unknown as DbClient;

export default function AgencyExtras() {
  const [extras, setExtras] = useState<any[]>([]);
  const [city, setCity] = useState("all");
  const [category, setCategory] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data, error } = await db
        .from("extras")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) {
        setError(error.message);
        setExtras([]);
      } else {
        setError(null);
        setExtras(data ?? []);
      }
      setLoading(false);
    };
    void load();
  }, []);

  const cities = useMemo(() => Array.from(new Set(extras.map((extra) => extra.city).filter(Boolean))).sort(), [extras]);
  const categories = useMemo(() => Array.from(new Set(extras.map((extra) => extra.category).filter(Boolean))).sort(), [extras]);
  const visible = extras.filter((extra) => (city === "all" || extra.city === city) && (category === "all" || extra.category === category));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Activités extras</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Catalogue des activités visibles pour préparer vos propositions. Lecture seule pour les agences.
        </p>
      </div>

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          <Button variant={city === "all" ? "default" : "outline"} onClick={() => setCity("all")}>Toutes les villes</Button>
          {cities.map((item) => (
            <Button key={item} variant={city === item ? "default" : "outline"} onClick={() => setCity(item)}>{item}</Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant={category === "all" ? "default" : "outline"} onClick={() => setCategory("all")}>Toutes catégories</Button>
          {categories.map((item) => (
            <Button key={item} variant={category === item ? "default" : "outline"} onClick={() => setCategory(item)}>{item}</Button>
          ))}
        </div>
      </Card>

      {error && <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{error}</Card>}
      {loading ? (
        <Card className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement des activités…
        </Card>
      ) : visible.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">Aucune activité active disponible.</Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((extra) => (
            <Card key={extra.id} className="overflow-hidden">
              <Img src={extra.image_url || "/placeholder.svg"} alt={extra.alt_text || extra.name} className="h-52 w-full object-cover" />
              <div className="space-y-4 p-5">
                <div>
                  <div className="flex flex-wrap gap-2">
                    {extra.category && <Badge variant="outline">{extra.category}</Badge>}
                    <Badge variant="secondary">Optionnel</Badge>
                  </div>
                  <h2 className="mt-3 font-display text-2xl">{extra.name}</h2>
                  <p className="mt-2 line-clamp-4 text-sm leading-6 text-muted-foreground">
                    {extra.description || "Description bientôt disponible."}
                  </p>
                </div>
                <div className="grid gap-2 text-sm">
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    {extra.city || "Ville à confirmer"}
                  </p>
                  <p className="flex items-center gap-2 font-semibold">
                    <Sparkles className="h-4 w-4 text-accent" />
                    {extra.price_mad ? fmtMAD(extra.price_mad) : "Prix à confirmer"}
                  </p>
                  {extra.trip_id && <p className="text-xs text-muted-foreground">Disponibilité liée à un voyage spécifique.</p>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
