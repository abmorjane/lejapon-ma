import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import { Button } from "@/components/ui/button";
import { ArrowRight, Plane } from "lucide-react";
import { fmtDate } from "@/lib/format";

export default function SupplierTrips() {
  const { user } = useAuth();
  const [trips, setTrips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!user) return;
      // Get supplier_ids the user belongs to
      const { data: members } = await supabase
        .from("supplier_members").select("supplier_id").eq("user_id", user.id);
      const supplierIds = (members ?? []).map((m: any) => m.supplier_id);
      if (supplierIds.length === 0) { setTrips([]); setLoading(false); return; }

      const { data: ts } = await supabase
        .from("trip_suppliers").select("trip_id, supplier_id").in("supplier_id", supplierIds);
      const tripIds = Array.from(new Set((ts ?? []).map((r: any) => r.trip_id)));
      if (tripIds.length === 0) { setTrips([]); setLoading(false); return; }

      const { data: tripRows } = await supabase
        .from("trips").select("*").in("id", tripIds).order("start_date", { ascending: true });
      setTrips(tripRows ?? []);
      setLoading(false);
    })();
  }, [user]);

  return (
    <div>
      <PageHeader title="Mes voyages assignés" description="Saisissez les coûts logistiques pour chaque départ qui vous est confié." />
      {loading ? (
        <p className="text-muted-foreground">Chargement…</p>
      ) : trips.length === 0 ? (
        <div className="bg-background border border-border rounded-2xl p-10 text-center">
          <Plane className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="font-medium">Aucun voyage assigné</p>
          <p className="text-sm text-muted-foreground mt-1">Contactez l'équipe lejapon.ma pour être rattaché à un départ.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {trips.map((t) => (
            <Link key={t.id} to={`/supplier/trips/${t.id}`}
              className="bg-background border border-border rounded-2xl p-5 flex items-center justify-between hover:border-primary transition-colors">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-display text-lg">{t.title}</h3>
                  <StatusBadge value={t.status} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {t.season ? `${t.season} • ` : ""}{fmtDate(t.start_date)} → {fmtDate(t.end_date)} • {t.duration_days ?? "?"} jours
                </p>
              </div>
              <Button variant="outline" size="sm">Saisir les coûts <ArrowRight className="w-4 h-4" /></Button>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}