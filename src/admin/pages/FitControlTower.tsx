import { useCallback, useDeferredValue, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Banknote, Building2, CalendarCheck, CheckCircle2, CircleDollarSign, Clock3, FileSearch, Hotel, Loader2, MapPin, Plane, RefreshCw, Search, TrendingUp, Users, WalletCards, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/admin/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FitInput as Input } from "@/components/fit/FitFormControls";
import { supabase } from "@/integrations/supabase/client";
import { fmtMAD } from "@/lib/format";

type ControlTowerAlert = { quote_id: string; type: string; title: string; owner: string; priority: string; deadline?: string | null; href: string; action_label: string };
type ControlTowerResult = { id: string; reference: string; version: number; client: string; agency?: string | null; agent?: string | null; destination: string; booking?: string | null; pnr?: string | null; amount_mad: number; status: string; href: string };
type ControlTowerData = {
  generated_at?: string;
  kpis?: Record<string, number>;
  commercial?: Record<string, number>;
  profitability?: Record<string, number>;
  operations?: Record<string, number>;
  alerts?: ControlTowerAlert[];
  results?: ControlTowerResult[];
};
type RpcError = { message: string };
const db = supabase as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError | null }> };
const kpiConfig = [
  ["new_requests", "Nouvelles demandes", FileSearch], ["preparing", "Devis en préparation", Clock3],
  ["waiting_client", "Attente client", Users], ["revisions", "Révisions", RefreshCw],
  ["accepted", "Acceptés", CheckCircle2], ["awaiting_deposit", "Acompte attendu", WalletCards],
  ["booked", "Réservés", CalendarCheck], ["traveling", "En voyage", Plane],
  ["completed", "Terminés", CheckCircle2], ["lost", "Perdus", AlertTriangle],
] as const;
const operationConfig = [
  ["supplier_replies_pending", "Réponses fournisseurs", Building2], ["hotels_pending", "Hôtels en attente", Hotel],
  ["transport_pending", "Transports en attente", MapPin], ["activities_pending", "Activités en attente", CalendarCheck],
  ["flights_pending", "Vols en attente", Plane], ["documents_missing", "Documents manquants", FileSearch],
  ["payments_due", "Paiements proches", Banknote],
] as const;
const statusLabels: Record<string, string> = { draft: "Brouillon", ready: "Prêt", sent: "Envoyé", viewed: "Consulté", revision_requested: "Révision", accepted: "Accepté", deposit_pending: "Acompte attendu", deposit_paid: "Acompte reçu", converted_to_booking: "Réservé", lost: "Perdu", expired: "Expiré", cancelled: "Annulé" };

export default function FitControlTower() {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [data, setData] = useState<ControlTowerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (search: string, quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    const { data: result, error: loadError } = await db.rpc("get_fit_control_tower_v9", { p_search: search || null, p_limit: 60 });
    setLoading(false); setRefreshing(false);
    if (loadError) { setError(loadError.message); return; }
    setError(""); setData(result as ControlTowerData);
  }, []);
  useEffect(() => { const handle = window.setTimeout(() => void load(deferredQuery), deferredQuery ? 180 : 0); return () => window.clearTimeout(handle); }, [deferredQuery, load]);

  if (loading && !data) return <div className="space-y-5"><PageHeader title="FIT Control Tower" description="Pilotage exécutif du cycle FIT." /><Card className="grid min-h-64 place-items-center rounded-md text-muted-foreground" role="status"><span><Loader2 className="mr-2 inline h-5 w-5 animate-spin" />Consolidation des données FIT…</span></Card></div>;
  if (error && !data) return <div className="space-y-5"><PageHeader title="FIT Control Tower" description="Pilotage exécutif du cycle FIT." /><Card className="rounded-md border-amber-300 p-8 text-center"><AlertTriangle className="mx-auto h-6 w-6 text-amber-700" /><p className="mt-3 font-semibold">La tour de contrôle n’est pas disponible</p><p className="mt-1 text-sm text-muted-foreground">Migration FIT V9 requise : {error}</p><Button className="mt-4" variant="outline" onClick={() => void load(deferredQuery)}><RefreshCw className="h-4 w-4" />Réessayer</Button></Card></div>;

  const kpis = data?.kpis || {}; const commercial = data?.commercial || {}; const profitability = data?.profitability || {}; const operations = data?.operations || {}; const alerts = data?.alerts || []; const results = data?.results || [];
  return <div className="min-w-0 space-y-5 overflow-x-hidden">
    <PageHeader title="FIT Control Tower" description="Une vue consolidée du commercial, de la rentabilité et des opérations FIT." action={<Button variant="outline" onClick={() => void load(deferredQuery, true)} disabled={refreshing}><RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />Actualiser</Button>} />

    <Card className="rounded-md border-slate-800 bg-slate-950 p-4 text-slate-50 md:p-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-slate-400">Recherche globale FIT</p><div className="relative mt-2"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input className="min-h-12 border-slate-700 bg-slate-900 pl-10 text-slate-50 placeholder:text-slate-500 focus-visible:ring-emerald-500" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Référence, client, agence, agent, destination, réservation ou PNR…" aria-label="Rechercher un dossier FIT" /></div></div><div className="text-sm text-slate-400"><strong className="text-slate-100">{results.length}</strong> dossier(s){data?.generated_at && <span className="block text-xs">Mis à jour {formatTime(data.generated_at)}</span>}</div></div>
    </Card>

    <section aria-labelledby="fit-pipeline-title"><h2 id="fit-pipeline-title" className="mb-3 font-display text-xl">Pipeline FIT</h2><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{kpiConfig.map(([key,label,Icon]) => <Card key={key} className="rounded-md p-4"><div className="flex items-center justify-between gap-2"><Icon className="h-4 w-4 text-accent" /><span className="text-2xl font-semibold tabular-nums">{Number(kpis[key] || 0)}</span></div><p className="mt-3 text-xs leading-5 text-muted-foreground">{label}</p></Card>)}</div></section>

    <div className="grid min-w-0 gap-5 xl:grid-cols-[1.15fr_.85fr]">
      <section aria-labelledby="commercial-title" className="min-w-0 space-y-3"><h2 id="commercial-title" className="font-display text-xl">Commercial & rentabilité</h2><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><Metric icon={TrendingUp} label="Valeur du pipeline" value={fmtMAD(commercial.pipeline_value)} /><Metric icon={CheckCircle2} label="Taux de conversion" value={`${Number(commercial.conversion_rate || 0).toLocaleString("fr-FR")}%`} /><Metric icon={CircleDollarSign} label="Valeur FIT moyenne" value={fmtMAD(commercial.average_value)} /><Metric icon={Building2} label="Commissions agences" value={fmtMAD(commercial.agency_commissions)} /><Metric icon={Users} label="Commissions commerciaux" value={fmtMAD(commercial.agent_commissions)} /><Metric icon={WalletCards} label="Marge à risque" value={fmtMAD(profitability.margin_at_risk)} danger={Number(profitability.margin_at_risk) > 0} /></div><Card className="grid rounded-md sm:grid-cols-3"><Profit label="Marge attendue" value={profitability.expected_margin} /><Profit label="Marge confirmée" value={profitability.confirmed_margin} /><Profit label="Érosion à surveiller" value={profitability.margin_at_risk} danger /></Card></section>
      <section aria-labelledby="operations-title" className="min-w-0 space-y-3"><h2 id="operations-title" className="font-display text-xl">Opérations</h2><Card className="grid rounded-md sm:grid-cols-2">{operationConfig.map(([key,label,Icon]) => <Link key={key} to={operationLink(key)} className="flex min-h-16 cursor-pointer items-center justify-between gap-3 border-b border-border p-4 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:odd:border-r"><span className="flex items-center gap-3 text-sm"><Icon className="h-4 w-4 text-accent" />{label}</span><span className={`font-semibold tabular-nums ${Number(operations[key]) > 0 ? "text-amber-700" : "text-muted-foreground"}`}>{Number(operations[key] || 0)}</span></Link>)}</Card></section>
    </div>

    <section aria-labelledby="alerts-title" className="space-y-3"><div className="flex items-end justify-between gap-3"><div><h2 id="alerts-title" className="font-display text-xl">Centre d’alertes</h2><p className="text-sm text-muted-foreground">Uniquement les problèmes nécessitant une action.</p></div><Badge variant={alerts.length ? "destructive" : "secondary"}>{alerts.length} active(s)</Badge></div>{alerts.length ? <div className="space-y-2">{alerts.map((alert, index) => <Card key={`${alert.type}-${alert.quote_id}-${index}`} className={`rounded-md border-l-4 p-4 ${alert.priority === "critical" ? "border-l-destructive" : alert.priority === "high" ? "border-l-amber-500" : "border-l-blue-500"}`}><div className="flex flex-col justify-between gap-3 md:flex-row md:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{alert.title}</p><Badge variant={alert.priority === "critical" ? "destructive" : "outline"}>{priorityLabel(alert.priority)}</Badge></div><p className="mt-1 text-xs text-muted-foreground">Responsable : {alert.owner}{alert.deadline ? ` · Échéance ${formatDate(alert.deadline)}` : " · Sans échéance"}</p></div><Button size="sm" className="w-full shrink-0 md:w-auto" asChild><Link to={alert.href}>{alert.action_label}<ArrowRight className="h-4 w-4" /></Link></Button></div></Card>)} </div> : <Card className="rounded-md p-8 text-center text-muted-foreground"><CheckCircle2 className="mx-auto h-6 w-6 text-emerald-600" /><p className="mt-2 font-medium text-foreground">Aucune alerte actionnable</p><p className="text-sm">Les dossiers FIT prioritaires sont à jour.</p></Card>}</section>

    <section aria-labelledby="results-title" className="space-y-3"><div className="flex items-end justify-between gap-3"><div><h2 id="results-title" className="font-display text-xl">Dossiers FIT</h2><p className="text-sm text-muted-foreground">Versions courantes uniquement.</p></div>{refreshing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Actualisation" />}</div>{results.length ? <div className="grid gap-3 lg:grid-cols-2">{results.map((item) => <Link key={item.id} to={item.href} className="block cursor-pointer rounded-md border border-border bg-background p-4 transition-colors hover:border-accent/50 hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold">{item.reference} <span className="text-xs text-muted-foreground">· V{item.version}</span></p><p className="mt-1 text-sm text-muted-foreground">{item.client} · {item.destination}</p></div><Badge variant={statusVariant(item.status)}>{statusLabels[item.status] || item.status}</Badge></div><div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-muted-foreground sm:grid-cols-4"><span>Valeur<strong className="block text-sm text-foreground">{fmtMAD(item.amount_mad)}</strong></span><span>Agence<strong className="block truncate text-sm text-foreground">{item.agency || "Direct"}</strong></span><span>Réservation<strong className="block text-sm text-foreground">{item.booking || "—"}</strong></span><span>PNR<strong className="block text-sm text-foreground">{item.pnr || "—"}</strong></span></div></Link>)}</div> : <Card className="rounded-md p-8 text-center text-muted-foreground"><Search className="mx-auto h-6 w-6" /><p className="mt-2">Aucun FIT ne correspond à cette recherche.</p></Card>}</section>
  </div>;
}

function Metric({ icon: Icon, label, value, danger = false }: { icon: LucideIcon; label: string; value: string; danger?: boolean }) { return <Card className={`rounded-md p-4 ${danger ? "border-amber-300" : ""}`}><div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className={`h-4 w-4 ${danger ? "text-amber-700" : "text-accent"}`} />{label}</div><p className="mt-2 text-xl font-semibold tabular-nums">{value}</p></Card>; }
function Profit({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) { return <div className="border-b border-border p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-1 text-lg font-semibold tabular-nums ${danger && Number(value) > 0 ? "text-amber-700" : ""}`}>{fmtMAD(value || 0)}</p></div>; }
function priorityLabel(value: string) { return value === "critical" ? "Critique" : value === "high" ? "Haute" : "Normale"; }
function formatDate(value: unknown) { const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }); }
function formatTime(value: unknown) { const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); }
function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" { if (["accepted","deposit_paid","converted_to_booking"].includes(status)) return "default"; if (["lost","expired","cancelled"].includes(status)) return "destructive"; if (["viewed","revision_requested","deposit_pending"].includes(status)) return "secondary"; return "outline"; }
function operationLink(key: string) { if (["supplier_replies_pending","hotels_pending","transport_pending","activities_pending"].includes(key)) return "/admin/fit-supplier-control"; if (key === "flights_pending") return "/admin/flight-tickets"; if (key === "payments_due") return "/admin/international-payments"; return "/admin/operations-center"; }
