import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "../components/PageHeader";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClipboardList } from "lucide-react";

const db = supabase as any;

export default function SupplierCosts() {
  const [trips, setTrips] = useState<any[]>([]);
  const [tripId, setTripId] = useState<string>("");
  const [legacyRows, setLegacyRows] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [quoteRowCounts, setQuoteRowCounts] = useState<Record<string, number>>({});
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
      if (!tripId) {
        setLegacyRows([]);
        setQuotes([]);
        setQuoteRowCounts({});
        return;
      }

      const [{ data: quoteRows }, { data: legacyCosts }] = await Promise.all([
        db
          .from("supplier_trip_quotes")
          .select("*")
          .eq("trip_id", tripId)
          .order("updated_at", { ascending: false, nullsFirst: false }),
        supabase
          .from("supplier_day_costs")
          .select("*")
          .eq("trip_id", tripId)
          .order("supplier_id")
          .order("day_number"),
      ]);

      setQuotes(quoteRows ?? []);
      setLegacyRows(legacyCosts ?? []);

      const quoteIds = (quoteRows ?? []).map((quote: any) => quote.id).filter(Boolean);
      if (!quoteIds.length) {
        setQuoteRowCounts({});
        return;
      }

      const rowTables = [
        "supplier_quote_hotel_rows",
        "supplier_quote_transport_rows",
        "supplier_quote_activity_rows",
        "supplier_quote_guide_rows",
        "supplier_quote_other_rows",
      ];
      const results = await Promise.all(rowTables.map((table) => db.from(table).select("id,quote_id").in("quote_id", quoteIds)));
      const counts: Record<string, number> = {};
      results.forEach(({ data }: any) => {
        (data ?? []).forEach((row: any) => {
          counts[row.quote_id] = (counts[row.quote_id] ?? 0) + 1;
        });
      });
      setQuoteRowCounts(counts);
    })();
  }, [tripId]);

  const grouped = useMemo(() => {
    const g = new Map<string, any[]>();
    legacyRows.forEach((r) => {
      if (!g.has(r.supplier_id)) g.set(r.supplier_id, []);
      g.get(r.supplier_id)!.push(r);
    });
    return Array.from(g.entries());
  }, [legacyRows]);

  const fmt = (n: number, c: string) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n) + " " + c;
  const fmtJPY = (n: number) => fmt(Number(n || 0), "JPY");
  const fmtMAD = (n: number) => fmt(Number(n || 0), "MAD");

  return (
    <div>
      <PageHeader title="Coûts fournisseurs" description="Synthèse des coûts logistiques saisis par les partenaires japonais." />
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="max-w-md flex-1">
          <Select value={tripId} onValueChange={setTripId}>
            <SelectTrigger><SelectValue placeholder="Choisir un voyage…" /></SelectTrigger>
            <SelectContent>
              {trips.map((t) => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {tripId && (
          <Button asChild>
            <Link to={`/supplier/trips/${tripId}/quote`}>
              <ClipboardList className="h-4 w-4" />
              Ouvrir quote engine
            </Link>
          </Button>
        )}
      </div>

      {!tripId && <p className="text-muted-foreground">Sélectionnez un voyage pour afficher les coûts soumis.</p>}

      {quotes.length === 0 && grouped.length === 0 && tripId && (
        <p className="text-muted-foreground">Aucun coût saisi pour ce voyage.</p>
      )}

      <div className="space-y-6">
        {quotes.map((quote) => {
          const rowCount = quoteRowCounts[quote.id] ?? 0;
          const hasTotals = [
            quote.total_hotels_jpy,
            quote.total_transport_jpy,
            quote.total_activities_jpy,
            quote.total_guides_jpy,
            quote.total_other_jpy,
            quote.grand_total_jpy,
            quote.final_total_jpy,
            quote.final_total_mad,
          ].some((value) => Number(value || 0) > 0);
          return (
            <Card key={quote.id}>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">{quote.supplier_id ? suppliers[quote.supplier_id] ?? "Fournisseur" : "Japan office / admin"}</CardTitle>
                <span className="font-display text-xl text-primary">
                  {hasTotals ? fmtJPY(Number(quote.final_total_jpy || quote.grand_total_jpy || 0)) : "Devis créé"}
                </span>
              </CardHeader>
              <CardContent>
                {!hasTotals && rowCount > 0 && (
                  <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    Devis créé, montants à compléter.
                  </p>
                )}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric label="Total hôtels" value={fmtJPY(quote.total_hotels_jpy)} />
                  <Metric label="Total transport" value={fmtJPY(quote.total_transport_jpy)} />
                  <Metric label="Total activités" value={fmtJPY(quote.total_activities_jpy)} />
                  <Metric label="Total guides" value={fmtJPY(quote.total_guides_jpy)} />
                  <Metric label="Total autres" value={fmtJPY(quote.total_other_jpy)} />
                  <Metric label="Total brut" value={fmtJPY(quote.grand_total_jpy)} />
                  <Metric label="Commission" value={`${Number(quote.commission_percentage ?? quote.commission_percent ?? 10)} %`} />
                  <Metric label="Total final JPY" value={fmtJPY(quote.final_total_jpy)} />
                  <Metric label="Total final MAD" value={fmtMAD(quote.final_total_mad)} />
                  <Metric label="Coût / personne MAD" value={fmtMAD(quote.cost_per_person_mad)} />
                  <Metric label="Participants" value={String(quote.participant_count ?? "—")} />
                  <Metric label="Lignes devis" value={String(rowCount)} />
                </div>
              </CardContent>
            </Card>
          );
        })}

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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/20 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}
