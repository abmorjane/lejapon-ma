import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "../components/PageHeader";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TripArchiveView, tripsForArchiveView } from "@/lib/trip-archiving";
import { adminSupplierQuotePath, groupSupplierQuoteVersions } from "../lib/supplier-admin-review";
import { supplierQuoteSectionTables } from "../lib/supplier-quote-section-loader";
import { calculateQuoteTotals } from "./supplier/SupplierTripCosts";
import { EXECUTION_STATUS_LABELS, type SupplierExecutionStatus } from "../lib/supplier-quote-business-model";
import { tripWorkspacePath } from "../lib/trip-workspace";

const db = supabase as any;
const commercialLabels: Record<string, string> = { draft: "Brouillon", submitted: "Soumis", reviewed: "En revue", revision_requested: "Révision demandée", approved: "Approuvé par LeJapon.ma", rejected: "Rejeté", archived: "Remplacé" };
const fmtJPY = (amount: number) => `${amount.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} JPY`;
const fmtMAD = (amount: number) => `${amount.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} MAD`;
const diagnostic = (error: any) => [error?.code, error?.message, error?.details, error?.hint].filter(Boolean).join(" · ") || String(error);

export default function SupplierCosts() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [trips, setTrips] = useState<any[]>([]);
  const [tripId, setTripId] = useState(() => searchParams.get("tripId") ?? "");
  const [legacyRows, setLegacyRows] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [quoteRows, setQuoteRows] = useState<Record<string, any[]>>({});
  const [suppliers, setSuppliers] = useState<Record<string, string>>({});
  const [archiveView, setArchiveView] = useState<TripArchiveView>("active");
  const [loading, setLoading] = useState(false);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowsAvailable, setRowsAvailable] = useState(false);
  const [retry, setRetry] = useState(0);
  const chooseTrip = (id: string) => { setTripId(id); setSearchParams(id ? { tripId: id } : {}); };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [tripResult, supplierResult] = await Promise.all([
        db.from("trips").select("id,title,duration_days,start_date,archived_at").order("start_date", { ascending: false }),
        db.from("suppliers").select("id,name"),
      ]);
      if (cancelled) return;
      setHeaderError([tripResult.error, supplierResult.error].filter(Boolean).map(diagnostic).join(" | ") || null);
      setTrips(tripResult.data ?? []);
      setSuppliers(Object.fromEntries((supplierResult.data ?? []).map((supplier: any) => [supplier.id, supplier.name])));
      if ((tripResult.data ?? []).find((trip: any) => trip.id === searchParams.get("tripId"))?.archived_at) setArchiveView("archived");
    })();
    return () => { cancelled = true; };
  }, [retry]);

  useEffect(() => {
    let cancelled = false;
    setQuotes([]); setLegacyRows([]); setQuoteRows({}); setRowsAvailable(false); setLoadError(null);
    if (!tripId) { setLoading(false); return; }
    setLoading(true);
    void (async () => {
      try {
        const [quoteResult, legacyResult] = await Promise.all([
          db.from("supplier_trip_quotes").select("*", { count: "exact" }).eq("trip_id", tripId).order("version_number", { ascending: false }),
          db.from("supplier_day_costs").select("*").eq("trip_id", tripId).order("supplier_id").order("day_number"),
        ]);
        if (cancelled) return;
        if (quoteResult.error) throw quoteResult.error;
        if (quoteResult.count == null || quoteResult.count !== quoteResult.data?.length) throw new Error("Liste des versions incomplète.");
        if (!Array.isArray(quoteResult.data)) throw new Error("Liste des devis indisponible.");
        setQuotes(quoteResult.data);
        setLegacyRows(legacyResult.data ?? []);
        if (legacyResult.error) setLoadError(`Anciennes saisies : ${diagnostic(legacyResult.error)}`);
        const ids = quoteResult.data.map((quote: any) => quote.id);
        const entries = Object.entries(supplierQuoteSectionTables);
        const results = ids.length ? await Promise.all(entries.map(([, table]) => db.from(table).select("*", { count: "exact" }).in("quote_id", ids))) : entries.map(() => ({ data: [], error: null, count: 0 }));
        if (cancelled) return;
        const errors = results.flatMap((result: any, index) => result.error ? [`${entries[index][1]} : ${diagnostic(result.error)}`] : !Array.isArray(result.data) ? [`${entries[index][1]} : réponse indisponible`] : result.count == null || result.count !== result.data.length ? [`${entries[index][1]} : lignes incomplètes, total indisponible`] : []);
        if (errors.length) { setLoadError(errors.join(" | ")); return; }
        setQuoteRows(Object.fromEntries(results.map((result: any, index) => [entries[index][0], result.data])));
        setRowsAvailable(true);
      } catch (error) {
        if (!cancelled) setLoadError(diagnostic(error));
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [tripId, retry]);

  const dossiers = useMemo(() => groupSupplierQuoteVersions(quotes), [quotes]);
  const legacyGrouped = useMemo(() => {
    const groups = new Map<string, any[]>();
    legacyRows.forEach(row => groups.set(row.supplier_id, [...(groups.get(row.supplier_id) ?? []), row]));
    return groups;
  }, [legacyRows]);
  const visibleTrips = tripsForArchiveView(trips, archiveView);

  return <div>
    <PageHeader title="Coûts fournisseurs" description="Un dossier par voyage et fournisseur. Les versions historiques restent consultables." />
    {headerError && <p role="alert" className="mb-4 break-words text-sm text-destructive">{headerError}</p>}
    <Tabs value={archiveView} onValueChange={value => { setArchiveView(value as TripArchiveView); chooseTrip(""); }} className="mb-4">
      <TabsList className="grid h-11 w-full grid-cols-2 rounded-xl sm:w-[420px]">
        <TabsTrigger value="active">Voyages actifs ({tripsForArchiveView(trips, "active").length})</TabsTrigger>
        <TabsTrigger value="archived">Voyages archivés ({tripsForArchiveView(trips, "archived").length})</TabsTrigger>
      </TabsList>
    </Tabs>
    <div className="mb-6 max-w-md">
      <Select value={tripId} onValueChange={chooseTrip}>
        <SelectTrigger><SelectValue placeholder="Choisir un voyage…" /></SelectTrigger>
        <SelectContent>{visibleTrips.map(trip => <SelectItem key={trip.id} value={trip.id}>{trip.title}</SelectItem>)}</SelectContent>
      </Select>
      {tripId && <div className="mt-3 flex flex-wrap gap-2"><Button asChild variant="outline"><Link to={tripWorkspacePath(tripId, "supplier")}>Ouvrir le dossier voyage</Link></Button><Button asChild variant="outline"><Link to={adminSupplierQuotePath(tripId)}>Gérer les fournisseurs du voyage</Link></Button></div>}
    </div>
    {!tripId && <p className="text-muted-foreground">Sélectionnez un voyage pour afficher les coûts soumis.</p>}
    {loading && <p role="status">Chargement des dossiers fournisseurs…</p>}
    {loadError && <div className="mb-4 rounded-lg border border-destructive p-4"><p role="alert" className="break-words text-sm text-destructive">Les coûts n’ont pas pu être entièrement chargés. {loadError}</p><Button variant="outline" className="mt-3" onClick={() => setRetry(value => value + 1)}>Réessayer</Button></div>}
    {tripId && !loading && !loadError && !quotes.length && !legacyRows.length && <p className="text-muted-foreground">Aucun coût saisi pour ce voyage.</p>}
    <div className="space-y-6">
      {dossiers.map(({ key, current: quote, versions }) => {
        const rows = Object.fromEntries(Object.keys(supplierQuoteSectionTables).map(section => [section, (quoteRows[section] ?? []).filter(row => row.quote_id === quote.id)])) as Parameters<typeof calculateQuoteTotals>[0];
        const totals = rowsAvailable ? calculateQuoteTotals(rows, Number(quote.commission_percentage ?? quote.commission_percent ?? 10), Number(quote.exchange_rate_jpy_mad ?? 0.068), [], [{ num_adults: quote.participant_count ?? 0, num_children: 0 }], { percentage: Number(quote.supplier_handling_percentage ?? 0), categories: quote.supplier_handling_categories ?? [] }) : null;
        const financialAvailable = totals && !totals.handlingInvalid;
        const unavailable = "Indisponible";
        const oldRows = legacyGrouped.get(quote.supplier_id) ?? [];
        const legacyHandling = Boolean(totals?.legacyHandlingIncludedJpy);
        const percentage = legacyHandling ? quote.validation_metadata?.excel_import?.financial_summary?.supplierHandlingPercentage : quote.supplier_handling_percentage ?? 0;
        return <Card key={key} data-testid="supplier-dossier">
          <CardHeader className="flex flex-wrap flex-row items-start justify-between gap-3 space-y-0">
            <div><CardTitle className="text-base">{suppliers[quote.supplier_id] ?? "Fournisseur non rattaché"}</CardTitle><p className="mt-2 text-sm">V{quote.version_number ?? 1} · {commercialLabels[quote.status] ?? quote.status}</p></div>
            <span className="font-display text-xl text-primary">{financialAvailable ? fmtJPY(totals.supplierTotalJpy) : unavailable}</span>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Sous-total services fournisseur" value={totals ? fmtJPY(totals.grandTotalJpy - totals.legacyHandlingIncludedJpy) : unavailable} />
              <Metric label="Handling fournisseur (%)" value={rowsAvailable ? percentage == null ? "Historique · taux non documenté" : `${percentage} %${legacyHandling ? " · historique" : ""}` : unavailable} />
              <Metric label="Montant handling fournisseur" value={financialAvailable ? fmtJPY(totals.handlingAmountJpy + totals.legacyHandlingIncludedJpy) : unavailable} />
              <Metric label="Total fournisseur" value={financialAvailable ? fmtJPY(totals.supplierTotalJpy) : unavailable} />
              <Metric label="Commission interne office" value={financialAvailable ? `${fmtJPY(totals.commissionAmountJpy)} · ${quote.commission_percentage ?? quote.commission_percent ?? 10} %` : unavailable} />
              <Metric label="Coût total interne JPY" value={financialAvailable ? fmtJPY(totals.finalTotalJpy) : unavailable} />
              <Metric label="Coût total interne MAD" value={financialAvailable && Number(quote.exchange_rate_jpy_mad ?? 0.068) > 0 ? fmtMAD(totals.finalTotalMad) : unavailable} />
              <Metric label="Participants" value={String(quote.participant_count ?? "Non renseigné")} />
              <Metric label="Lignes devis" value={rowsAvailable ? String(Object.values(rows).flat().length) : unavailable} />
              <Metric label="Version courante" value={`V${quote.version_number ?? 1}`} />
              <Metric label="Statut commercial" value={commercialLabels[quote.status] ?? quote.status ?? "Non renseigné"} />
              <Metric label="Statut opérationnel" value={quote.supplier_execution_status ? EXECUTION_STATUS_LABELS[quote.supplier_execution_status as SupplierExecutionStatus] ?? quote.supplier_execution_status : "Non renseigné (historique)"} />
              <Metric label="Dernière mise à jour" value={quote.updated_at ? new Date(quote.updated_at).toLocaleString("fr-FR") : "—"} />
            </div>
            {legacyHandling && <p className="mt-3 text-xs text-muted-foreground">Handling historique conservé dans les lignes source ; son montant est distingué des services sans recalculer ni présumer le périmètre historique.</p>}
            <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="Versions du fournisseur"><span className="text-sm font-medium">Versions :</span>{[...versions].reverse().map(version => <Button key={version.id} asChild variant={version.id === quote.id ? "secondary" : "outline"} size="sm"><Link to={adminSupplierQuotePath(quote.trip_id, version.id)} title={commercialLabels[version.status] ?? version.status}>V{version.version_number ?? 1}</Link></Button>)}</div>
            <Button asChild variant="outline" size="sm" className="mt-4"><Link to={adminSupplierQuotePath(quote.trip_id, quote.id)}>Ouvrir ce devis</Link></Button>
            <Button asChild variant="ghost" size="sm" className="mt-4"><Link to={tripWorkspacePath(quote.trip_id, "supplier")}>Dossier voyage</Link></Button>
            {oldRows.length > 0 && <details className="mt-4"><summary className="cursor-pointer text-sm">Anciennes saisies par jour ({oldRows.length})</summary><LegacyCostsTable rows={oldRows} /></details>}
          </CardContent>
        </Card>;
      })}
      {[...legacyGrouped].filter(([supplierId]) => !dossiers.some(({ current }) => current.supplier_id === supplierId)).map(([supplierId, rows]) => <Card key={`legacy:${supplierId}`} data-testid="supplier-dossier">
        <CardHeader><CardTitle className="text-base">{suppliers[supplierId] ?? "Fournisseur"}</CardTitle><span className="font-display text-xl text-primary">{Number(rows.reduce((sum, row) => sum + Number(row.total_cost ?? 0), 0)).toLocaleString("fr-FR")} {rows[0]?.currency ?? "JPY"}</span><p className="text-sm text-muted-foreground">Ancienne saisie par jour · aucun devis versionné</p></CardHeader>
        <CardContent><LegacyCostsTable rows={rows} /><Button asChild variant="outline" className="mt-4"><Link to={adminSupplierQuotePath(tripId)}>Ouvrir le dossier fournisseur</Link></Button></CardContent>
      </Card>)}
    </div>
  </div>;
}

function LegacyCostsTable({ rows }: { rows: any[] }) {
  const fmt = (amount: unknown, currency: string) => `${Number(amount ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} ${currency}`;
  return <div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-muted-foreground"><tr>{["Jour", "Ville", "Nuits", "Hôtel", "Transport", "Guide", "Activités", "Repas", "Total"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t"><td className="p-2">J{row.day_number}</td><td className="p-2">{row.city ?? "—"}</td><td className="p-2">{row.nights}</td>{["hotel_cost", "transport_cost", "guide_cost", "activities_cost", "meals_cost", "total_cost"].map(field => <td key={field} className="p-2">{fmt(row[field], row.currency ?? "JPY")}</td>)}</tr>)}</tbody></table></div>;
}
function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border bg-secondary/20 px-3 py-2"><p className="text-xs text-muted-foreground">{label}</p><p className="font-semibold">{value}</p></div>;
}
