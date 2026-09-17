import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "../components/PageHeader";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClipboardList } from "lucide-react";
import { TripArchiveView, tripsForArchiveView } from "@/lib/trip-archiving";

const db = supabase as any;

export default function SupplierCosts() {
  const [trips, setTrips] = useState<any[]>([]);
  const [tripId, setTripId] = useState<string>("");
  const [legacyRows, setLegacyRows] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [quoteRowCounts, setQuoteRowCounts] = useState<Record<string, number>>({});
  const [quoteCalculatedTotals, setQuoteCalculatedTotals] = useState<Record<string, any>>({});
  const [suppliers, setSuppliers] = useState<Record<string, string>>({});
  const [archiveView, setArchiveView] = useState<TripArchiveView>("active");

  useEffect(() => {
    (async () => {
      const { data: t } = await supabase.from("trips").select("id,title,duration_days,start_date,archived_at").order("start_date", { ascending: false });
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
        setQuoteCalculatedTotals({});
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
        setQuoteCalculatedTotals({});
        return;
      }

      const rowTables = [
        { key: "hotels", table: "supplier_quote_hotel_rows" },
        { key: "transport", table: "supplier_quote_transport_rows" },
        { key: "activities", table: "supplier_quote_activity_rows" },
        { key: "guides", table: "supplier_quote_guide_rows" },
        { key: "other", table: "supplier_quote_other_rows" },
      ];
      const results = await Promise.all(rowTables.map(({ table }) => db.from(table).select("*").in("quote_id", quoteIds)));
      const counts: Record<string, number> = {};
      const calculated: Record<string, any> = {};
      results.forEach(({ data }: any, index: number) => {
        const section = rowTables[index].key;
        (data ?? []).forEach((row: any) => {
          counts[row.quote_id] = (counts[row.quote_id] ?? 0) + 1;
          if (!calculated[row.quote_id]) {
            calculated[row.quote_id] = { hotels: 0, transport: 0, activities: 0, guides: 0, other: 0 };
          }
          if (row.included_in_total !== false) calculated[row.quote_id][section] += supplierRowSubtotal(section, row);
        });
      });
      Object.entries(calculated).forEach(([quoteId, totals]: [string, any]) => {
        const quote = (quoteRows ?? []).find((item: any) => item.id === quoteId);
        const grandTotalJpy = ["hotels", "transport", "activities", "guides", "other"].reduce((sum, key) => sum + Number(totals[key] || 0), 0);
        const commissionPct = Number(quote?.commission_percentage ?? quote?.commission_percent ?? 10);
        const commissionAmountJpy = grandTotalJpy * commissionPct / 100;
        const finalTotalJpy = grandTotalJpy + commissionAmountJpy;
        const exchangeRate = Number(quote?.exchange_rate_jpy_mad ?? 0.068);
        const finalTotalMad = finalTotalJpy * exchangeRate;
        const participantCount = Math.max(1, Number(quote?.participant_count || 1));
        calculated[quoteId] = {
          ...totals,
          grand_total_jpy: grandTotalJpy,
          commission_amount_jpy: commissionAmountJpy,
          final_total_jpy: finalTotalJpy,
          final_total_mad: finalTotalMad,
          cost_per_person_mad: finalTotalMad / participantCount,
        };
      });
      setQuoteRowCounts(counts);
      setQuoteCalculatedTotals(calculated);
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
  const visibleTrips = tripsForArchiveView(trips, archiveView);

  return (
    <div>
      <PageHeader title="Coûts fournisseurs" description="Synthèse des coûts logistiques saisis par les partenaires japonais." />
      <Tabs value={archiveView} onValueChange={(value) => { setArchiveView(value as TripArchiveView); setTripId(""); }} className="mb-4">
        <TabsList className="grid h-11 w-full grid-cols-2 rounded-xl sm:w-[420px]">
          <TabsTrigger value="active" className="rounded-lg">Voyages actifs ({tripsForArchiveView(trips, "active").length})</TabsTrigger>
          <TabsTrigger value="archived" className="rounded-lg">Voyages archivés ({tripsForArchiveView(trips, "archived").length})</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="max-w-md flex-1">
          <Select value={tripId} onValueChange={setTripId}>
            <SelectTrigger><SelectValue placeholder="Choisir un voyage…" /></SelectTrigger>
            <SelectContent>
              {visibleTrips.map((t) => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}
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
          const fallbackTotals = quoteCalculatedTotals[quote.id] ?? {};
          const totalHotels = Number(quote.total_hotels_jpy || fallbackTotals.hotels || 0);
          const totalTransport = Number(quote.total_transport_jpy || fallbackTotals.transport || 0);
          const totalActivities = Number(quote.total_activities_jpy || fallbackTotals.activities || 0);
          const totalGuides = Number(quote.total_guides_jpy || fallbackTotals.guides || 0);
          const totalOther = Number(quote.total_other_jpy || fallbackTotals.other || 0);
          const grandTotal = Number(quote.grand_total_jpy || fallbackTotals.grand_total_jpy || 0);
          const finalTotalJpy = Number(quote.final_total_jpy || fallbackTotals.final_total_jpy || grandTotal || 0);
          const finalTotalMad = Number(quote.final_total_mad || fallbackTotals.final_total_mad || 0);
          const hasTotals = [
            totalHotels,
            totalTransport,
            totalActivities,
            totalGuides,
            totalOther,
            grandTotal,
            finalTotalJpy,
            finalTotalMad,
          ].some((value) => Number(value || 0) > 0);
          return (
            <Card key={quote.id}>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">{quote.supplier_id ? suppliers[quote.supplier_id] ?? "Fournisseur" : "Fournisseur non rattaché"}</CardTitle>
                <span className="font-display text-xl text-primary">
                  {hasTotals ? fmtJPY(finalTotalJpy) : "Devis créé"}
                </span>
              </CardHeader>
              <CardContent>
                {!hasTotals && rowCount > 0 && (
                  <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    Devis créé, montants à compléter.
                  </p>
                )}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric label="Total hôtels" value={fmtJPY(totalHotels)} />
                  <Metric label="Total transport" value={fmtJPY(totalTransport)} />
                  <Metric label="Total activités" value={fmtJPY(totalActivities)} />
                  <Metric label="Total guides" value={fmtJPY(totalGuides)} />
                  <Metric label="Total autres" value={fmtJPY(totalOther)} />
                  <Metric label="Total brut" value={fmtJPY(grandTotal)} />
                  <Metric label="Commission" value={`${Number(quote.commission_percentage ?? quote.commission_percent ?? 10)} %`} />
                  <Metric label="Total final JPY" value={fmtJPY(finalTotalJpy)} />
                  <Metric label="Total final MAD" value={fmtMAD(finalTotalMad)} />
                  <Metric label="Coût / personne MAD" value={fmtMAD(quote.cost_per_person_mad || fallbackTotals.cost_per_person_mad)} />
                  <Metric label="Participants" value={String(quote.participant_count ?? "—")} />
                  <Metric label="Lignes devis" value={String(rowCount)} />
                  <Metric label="Dernière mise à jour" value={quote.updated_at ? new Date(quote.updated_at).toLocaleString("fr-FR") : "—"} />
                  <Metric label="Statut fournisseur" value={quote.validation_status || quote.status || "draft"} />
                </div>
                {tripId && (
                  <Button asChild variant="outline" size="sm" className="mt-4">
                    <Link to={`/supplier/trips/${tripId}/quote`}>Ouvrir ce devis</Link>
                  </Button>
                )}
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

const supplierNumeric = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const supplierRowSubtotal = (section: string, row: any) => {
  if (section === "hotels") {
    return supplierNumeric(row.person_count ?? row.rooms_count ?? row.room_count)
      * supplierNumeric(row.nights || 0)
      * supplierNumeric(row.price_per_person_per_night_jpy ?? row.unit_price_jpy ?? row.price_per_room_per_night_jpy);
  }
  if (section === "activities") {
    return supplierNumeric(row.participant_count ?? row.quantity) * supplierNumeric(row.unit_price_jpy);
  }
  if (section === "guides") {
    return supplierNumeric(row.guides_count ?? row.guide_count) * supplierNumeric(row.daily_price_jpy);
  }
  return supplierNumeric(row.quantity) * supplierNumeric(row.unit_price_jpy);
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/20 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}
