import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "../components/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SupplierCosts() {
  const [trips, setTrips] = useState<any[]>([]);
  const [tripId, setTripId] = useState<string>("");
  const [rows, setRows] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const { data: t } = await supabase.from("trips").select("id,title,duration_days,start_date").order("start_date", { ascending: false });
      setTrips(t ?? []);
      const { data: s } = await supabase.from("suppliers").select("id,name");
      const map: Record<string, string> = {};
      (s ?? []).forEach((r: any) => (map[r.id] = r.name));
      setSuppliers(map);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      if (!tripId) { setRows([]); return; }
      const { data } = await supabase.from("supplier_day_costs")
        .select("*").eq("trip_id", tripId).order("supplier_id").order("day_number");
      setRows(data ?? []);
    })();
  }, [tripId]);

  const grouped = useMemo(() => {
    const g = new Map<string, any[]>();
    rows.forEach((r) => {
      if (!g.has(r.supplier_id)) g.set(r.supplier_id, []);
      g.get(r.supplier_id)!.push(r);
    });
    return Array.from(g.entries());
  }, [rows]);

  const fmt = (n: number, c: string) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n) + " " + c;

  return (
    <div>
      <PageHeader title="Coûts fournisseurs" description="Synthèse des coûts logistiques saisis par les partenaires japonais." />
      <div className="mb-6 max-w-md">
        <Select value={tripId} onValueChange={setTripId}>
          <SelectTrigger><SelectValue placeholder="Choisir un voyage…" /></SelectTrigger>
          <SelectContent>
            {trips.map((t) => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {!tripId && <p className="text-muted-foreground">Sélectionnez un voyage pour afficher les coûts soumis.</p>}

      {grouped.length === 0 && tripId && (
        <p className="text-muted-foreground">Aucun coût saisi pour ce voyage.</p>
      )}

      <div className="space-y-6">
        {grouped.map(([sId, list]) => {
          const total = list.reduce((s, r) => s + Number(r.total_cost), 0);
          const currency = list[0]?.currency ?? "JPY";
          return (
            <Card key={sId}>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">{suppliers[sId] ?? "Fournisseur"}</CardTitle>
                <span className="font-display text-xl text-primary">{fmt(total, currency)}</span>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="pb-2">Jour</th>
                      <th className="pb-2">Ville</th>
                      <th className="pb-2 text-right">Nuits</th>
                      <th className="pb-2 text-right">Hôtel</th>
                      <th className="pb-2 text-right">Transport</th>
                      <th className="pb-2 text-right">Guide</th>
                      <th className="pb-2 text-right">Activités</th>
                      <th className="pb-2 text-right">Repas</th>
                      <th className="pb-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {list.map((r) => (
                      <tr key={r.id}>
                        <td className="py-2">J{r.day_number}</td>
                        <td className="py-2">{r.city ?? "—"}</td>
                        <td className="py-2 text-right">{r.nights}</td>
                        <td className="py-2 text-right">{fmt(+r.hotel_cost, r.currency)}</td>
                        <td className="py-2 text-right">{fmt(+r.transport_cost, r.currency)}</td>
                        <td className="py-2 text-right">{fmt(+r.guide_cost, r.currency)}</td>
                        <td className="py-2 text-right">{fmt(+r.activities_cost, r.currency)}</td>
                        <td className="py-2 text-right">{fmt(+r.meals_cost, r.currency)}</td>
                        <td className="py-2 text-right font-semibold">{fmt(+r.total_cost, r.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}