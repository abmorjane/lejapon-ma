import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Calculator, ChevronDown, Eye, Loader2, Save, TrendingDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmtMAD } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FitInput as Input } from "@/components/fit/FitFormControls";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

type RpcError = { message: string };
type Supplier = { id: string; name: string };
type CostLine = {
  source_type: "day_cost" | "cost_line" | "hotel" | "flight";
  source_id: string;
  component_type: string;
  label?: string | null;
  supplier_id?: string | null;
  supplier_name?: string | null;
  day_number?: number | null;
  day_date?: string | null;
  city?: string | null;
  estimated_cost: number;
  supplier_quoted_cost?: number | null;
  confirmed_cost?: number | null;
  final_cost?: number | null;
  selling_price: number;
  currency: string;
  exchange_rate: number;
  payment_status: string;
  supplier_quote_id?: string | null;
  supplier_confirmation_document_id?: string | null;
  supplier_invoice_id?: string | null;
  supplier_payment_id?: string | null;
  estimated_mad: number;
  quoted_mad?: number | null;
  confirmed_mad?: number | null;
  final_mad?: number | null;
  paid_mad: number;
  latest_cost_mad: number;
  variance_mad: number;
};
type CostDraft = CostLine & {
  estimated_cost: number | string;
  supplier_quoted_cost?: number | string | null;
  confirmed_cost?: number | string | null;
  final_cost?: number | string | null;
  selling_price: number | string;
  exchange_rate: number | string;
};
type Reconciliation = {
  stored_ground_cost_mad?: number;
  previous_v4_estimated_mad?: number;
  corrected_estimated_mad?: number;
  previous_v4_difference_mad?: number;
  stored_ground_difference_mad?: number;
  excluded_from_financial_total_mad?: number;
  excluded_breakdown?: { day_lines?: number; global_lines?: number; hotel_lines?: number; flight_lines?: number };
  excluded_lines?: Array<{ source_type: string; source_id: string; label?: string | null; category: string; reason: string; estimated_mad: number }>;
};
type FinanceSummary = {
  selling_price_mad: number;
  estimated_supplier_cost_mad: number;
  quoted_supplier_cost_mad: number;
  confirmed_supplier_cost_mad: number;
  final_supplier_cost_mad: number;
  supplier_paid_cost_mad: number;
  estimated_margin_mad: number;
  confirmed_margin_mad: number;
  final_margin_mad: number;
  agency_gross_commission_mad: number;
  sales_agent_commission_mad: number;
  agency_net_commission_mad: number;
  eligible_line_count: number;
  quoted_line_count: number;
  confirmed_line_count: number;
  final_line_count: number;
  confirmed_complete: boolean;
  final_complete: boolean;
  components: CostLine[];
  reconciliation?: Reconciliation;
  alerts?: {
    negative_estimated_margin?: boolean;
    negative_confirmed_margin?: boolean;
    negative_final_margin?: boolean;
    below_estimated_threshold?: boolean;
    cost_increase_after_acceptance?: boolean;
    exchange_rate_erosion?: boolean;
  };
};
type SourceTable = "fit_quote_day_cost_lines" | "fit_quote_cost_lines" | "fit_quote_hotel_lines" | "fit_quote_flight_lines";
type FinanceDb = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError | null }>;
  from: (table: string) => {
    select: (columns: string) => { order: (column: string) => Promise<{ data: unknown; error: RpcError | null }> };
    update: (values: Record<string, unknown>) => { eq: (column: string, value: string) => { eq: (column: string, value: string) => Promise<{ error: RpcError | null }> } };
  };
};

const db = supabase as unknown as FinanceDb;
const sourceTables: Record<CostLine["source_type"], SourceTable> = {
  day_cost: "fit_quote_day_cost_lines",
  cost_line: "fit_quote_cost_lines",
  hotel: "fit_quote_hotel_lines",
  flight: "fit_quote_flight_lines",
};
const categoryOrder = ["hotels", "guides", "transport", "tickets_activities", "luggage", "meals", "flights", "insurance", "agency_fees", "other"] as const;
type CostGroupKey = (typeof categoryOrder)[number];
const groupLabels: Record<CostGroupKey, string> = {
  hotels: "Hôtels",
  guides: "Guides",
  transport: "Transport",
  tickets_activities: "Billets & activités",
  luggage: "Bagages",
  meals: "Repas",
  flights: "Vols",
  insurance: "Assurance",
  agency_fees: "Frais agence",
  other: "Autres",
};
const paymentLabels: Record<string, string> = { not_due: "Non dû", pending: "À payer", partially_paid: "Partiellement payé", paid: "Payé", cancelled: "Annulé" };

function groupFor(componentType: string): CostGroupKey {
  const value = componentType.toLowerCase();
  if (["hotel", "hotels", "accommodation"].includes(value)) return "hotels";
  if (["guide", "guides"].includes(value)) return "guides";
  if (["transport", "transfer", "transfers", "train", "bus"].includes(value)) return "transport";
  if (["ticket", "tickets", "activity", "activities", "visit", "visits", "optional_extra"].includes(value)) return "tickets_activities";
  if (["luggage", "baggage", "bagages"].includes(value)) return "luggage";
  if (["meal", "meals", "restaurant", "restaurants"].includes(value)) return "meals";
  if (["flight", "flights"].includes(value)) return "flights";
  if (value === "insurance") return "insurance";
  if (value === "agency_fee") return "agency_fees";
  return "other";
}

export function FitFinancialPanel({ quoteId, readOnly = false }: { quoteId: string; readOnly?: boolean }) {
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [drafts, setDrafts] = useState<Record<string, CostDraft>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data, error: summaryError }, { data: supplierRows }] = await Promise.all([
      db.rpc("get_fit_financial_summary_v4", { p_quote_id: quoteId }),
      db.from("suppliers").select("id,name").order("name"),
    ]);
    setLoading(false);
    if (summaryError) { setError(summaryError.message); return; }
    const nextSummary = data as FinanceSummary;
    setError("");
    setSummary(nextSummary);
    setSuppliers((supplierRows || []) as Supplier[]);
    setDrafts(Object.fromEntries((nextSummary.components || []).map((line) => [line.source_id, { ...line }])));
  }, [quoteId]);
  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => {
    const result = new Map<CostGroupKey, CostLine[]>();
    for (const key of categoryOrder) result.set(key, []);
    for (const line of summary?.components || []) result.get(groupFor(line.component_type))?.push(line);
    return categoryOrder.map((key) => ({ key, label: groupLabels[key], lines: result.get(key) || [] })).filter((group) => group.lines.length > 0);
  }, [summary]);

  const save = async (line: CostLine) => {
    const draft = drafts[line.source_id];
    if (!draft) return;
    const numberOrNull = (value: unknown) => value === "" || value == null ? null : Number(value);
    const requiredNumber = (value: unknown, fallback: number) => value === "" || value == null ? fallback : Number(value);
    const values = [requiredNumber(draft.estimated_cost, 0), requiredNumber(draft.selling_price, 0), requiredNumber(draft.exchange_rate, 1), numberOrNull(draft.supplier_quoted_cost), numberOrNull(draft.confirmed_cost), numberOrNull(draft.final_cost)];
    if (values.some((value) => value !== null && !Number.isFinite(value))) return toast.error("Vérifiez les montants et le taux de change.");
    setSavingId(line.source_id);
    const { error: saveError } = await db.from(sourceTables[line.source_type]).update({
      supplier_id: draft.supplier_id || null,
      estimated_cost: requiredNumber(draft.estimated_cost, 0),
      supplier_quoted_cost: numberOrNull(draft.supplier_quoted_cost),
      confirmed_cost: numberOrNull(draft.confirmed_cost),
      final_cost: numberOrNull(draft.final_cost),
      component_selling_price: requiredNumber(draft.selling_price, 0),
      cost_currency: draft.currency,
      exchange_rate_to_mad: requiredNumber(draft.exchange_rate, 1),
      supplier_payment_status: draft.payment_status,
      supplier_quote_id: draft.supplier_quote_id || null,
      supplier_confirmation_document_id: draft.supplier_confirmation_document_id || null,
      supplier_invoice_id: draft.supplier_invoice_id || null,
      supplier_payment_id: draft.supplier_payment_id || null,
      financial_updated_at: new Date().toISOString(),
    }).eq("id", line.source_id).eq("quote_id", quoteId);
    setSavingId("");
    if (saveError) return toast.error(saveError.message);
    toast.success("Coût fournisseur enregistré.");
    void load();
  };
  const update = (id: string, key: keyof CostDraft, value: unknown) => setDrafts((current) => ({ ...current, [id]: { ...current[id], [key]: value } }));

  if (loading) return <Card className="rounded-md p-5 text-sm text-muted-foreground" role="status"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Chargement de la rentabilité…</Card>;
  if (error) return <Card className="rounded-md border-amber-300 p-5 text-sm text-amber-900"><AlertTriangle className="mr-2 inline h-4 w-4" />Migration financière V10 requise : {error}</Card>;
  if (!summary) return null;

  const alerts = summary.alerts || {};
  const hasNegativeMargin = alerts.negative_estimated_margin || alerts.negative_confirmed_margin || alerts.negative_final_margin;
  const alertItems = [
    alerts.negative_estimated_margin && "La marge estimée est négative.",
    alerts.negative_confirmed_margin && "La marge confirmée est négative.",
    alerts.negative_final_margin && "La marge finale est négative.",
    alerts.cost_increase_after_acceptance && "Un coût confirmé a augmenté après l’acceptation client.",
    alerts.exchange_rate_erosion && "Le taux de change s’est écarté du snapshot d’acceptation.",
    alerts.below_estimated_threshold && !alerts.negative_estimated_margin && "La marge estimée est sous le seuil configuré.",
  ].filter(Boolean) as string[];

  return <section className="min-w-0 space-y-4" aria-labelledby="fit-finance-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 id="fit-finance-title" className="font-display text-xl">Coûts & rentabilité</h3><p className="text-sm text-muted-foreground">Synthèse commerciale en MAD. Les engagements et paiements restent gérés dans la section suivante.</p></div>
      <Badge variant={hasNegativeMargin ? "destructive" : alerts.below_estimated_threshold ? "outline" : "secondary"}>{hasNegativeMargin ? "Marge à corriger" : alerts.below_estimated_threshold ? "Sous le seuil" : "Rentabilité suivie"}</Badge>
    </div>

    {alertItems.length > 0 && <Card className="rounded-md border-amber-300 bg-amber-50 p-4 text-amber-950"><div className="flex items-start gap-3"><TrendingDown className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-semibold">Alertes de rentabilité</p><ul className="mt-1 space-y-1 text-sm">{alertItems.map((item) => <li key={item}>• {item}</li>)}</ul></div></div></Card>}

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Metric label="Prix client" value={summary.selling_price_mad} emphasized />
      <Metric label="Coût estimé" value={summary.estimated_supplier_cost_mad} />
      <Metric label="Coût devisé fournisseurs" value={summary.quoted_supplier_cost_mad} helper={`${summary.quoted_line_count}/${summary.eligible_line_count} ligne(s)`} />
      <Metric label="Coût confirmé" value={summary.confirmed_supplier_cost_mad} helper={`${summary.confirmed_line_count}/${summary.eligible_line_count} ligne(s)`} />
      <Metric label="Coût payé" value={summary.supplier_paid_cost_mad} />
      <Metric label="Marge estimée" value={summary.estimated_margin_mad} danger={alerts.negative_estimated_margin} />
      <Metric label="Marge confirmée" value={summary.confirmed_margin_mad} available={summary.confirmed_line_count > 0} helper={summary.confirmed_complete ? "Toutes les lignes confirmées" : "Confirmation partielle"} danger={alerts.negative_confirmed_margin} />
      <Metric label="Marge finale" value={summary.final_margin_mad} available={summary.final_line_count > 0} helper={summary.final_complete ? "Toutes les lignes finalisées" : "Coûts finaux incomplets"} danger={alerts.negative_final_margin} />
      <Metric label="Commission agence" value={summary.agency_gross_commission_mad} />
      <Metric label="Commission commercial" value={summary.sales_agent_commission_mad} />
    </div>

    <div className="flex justify-start">
      <Button type="button" variant="outline" onClick={() => setDetailsOpen((open) => !open)} aria-expanded={detailsOpen} aria-controls="fit-cost-details">
        <Eye className="h-4 w-4" />{detailsOpen ? "Masquer le détail des coûts" : "Voir le détail des coûts"}<ChevronDown className={`h-4 w-4 transition-transform ${detailsOpen ? "rotate-180" : ""}`} />
      </Button>
    </div>

    {detailsOpen && <div id="fit-cost-details" className="space-y-4">
      <ReconciliationCard reconciliation={summary.reconciliation} />
      <div className="space-y-3">
        {groups.map((group) => <CostGroup key={group.key} label={group.label} lines={group.lines} drafts={drafts} suppliers={suppliers} readOnly={readOnly} savingId={savingId} onUpdate={update} onSave={save} />)}
        {!summary.components?.length && <Card className="rounded-md p-8 text-center text-sm text-muted-foreground"><Calculator className="mx-auto mb-2 h-5 w-5" />Aucune prestation active n’entre dans le calcul financier.</Card>}
      </div>
    </div>}
  </section>;
}

function CostGroup({ label, lines, drafts, suppliers, readOnly, savingId, onUpdate, onSave }: {
  label: string; lines: CostLine[]; drafts: Record<string, CostDraft>; suppliers: Supplier[]; readOnly: boolean; savingId: string;
  onUpdate: (id: string, key: keyof CostDraft, value: unknown) => void; onSave: (line: CostLine) => Promise<void>;
}) {
  const total = (key: "estimated_mad" | "quoted_mad" | "confirmed_mad" | "paid_mad") => lines.reduce((sum, line) => sum + Number(line[key] || 0), 0);
  const variance = lines.reduce((sum, line) => sum + Number(line.variance_mad || 0), 0);
  return <details className="group min-w-0 rounded-md border border-border bg-background">
    <summary className="flex min-h-16 cursor-pointer list-none flex-col gap-3 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3"><ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" /><div><p className="font-semibold">{label}</p><p className="text-xs text-muted-foreground">{lines.length} ligne{lines.length > 1 ? "s" : ""}</p></div></div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-1 text-xs sm:flex sm:flex-wrap sm:justify-end sm:gap-5">
        <SmallAmount label="Estimé" value={total("estimated_mad")} />
        <SmallAmount label="Devisé" value={total("quoted_mad")} />
        <SmallAmount label="Confirmé" value={total("confirmed_mad")} />
        <SmallAmount label="Payé" value={total("paid_mad")} />
        <SmallAmount label="Écart actuel" value={variance} danger={variance > 0} signed />
      </div>
    </summary>
    <div className="space-y-2 border-t border-border p-3 md:p-4">
      {lines.map((line) => <CostLineEditor key={`${line.source_type}-${line.source_id}`} line={line} draft={drafts[line.source_id] || line} suppliers={suppliers} readOnly={readOnly} saving={savingId === line.source_id} onUpdate={onUpdate} onSave={onSave} />)}
    </div>
  </details>;
}

function CostLineEditor({ line, draft, suppliers, readOnly, saving, onUpdate, onSave }: {
  line: CostLine; draft: CostDraft; suppliers: Supplier[]; readOnly: boolean; saving: boolean;
  onUpdate: (id: string, key: keyof CostDraft, value: unknown) => void; onSave: (line: CostLine) => Promise<void>;
}) {
  const context = [line.day_number ? `Jour ${line.day_number}` : null, formatDate(line.day_date), line.city].filter(Boolean).join(" — ");
  const variance = Number(line.variance_mad || 0);
  return <details className="group/line min-w-0 rounded-md border border-border/80 bg-muted/20">
    <summary className="flex min-h-16 cursor-pointer list-none flex-col gap-2 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0"><p className="break-words font-medium">{line.label || groupLabels[groupFor(line.component_type)]}</p><p className="text-xs text-muted-foreground">{context || groupLabels[groupFor(line.component_type)]} · {line.supplier_name || "Fournisseur non assigné"}</p></div>
      <div className="flex items-center justify-between gap-3 sm:justify-end"><div className="text-left text-xs sm:text-right"><p>Estimé {fmtMAD(line.estimated_mad || 0)}</p><p className="text-muted-foreground">Confirmé {line.confirmed_mad == null ? "—" : fmtMAD(line.confirmed_mad)}</p></div><Badge variant={line.paid_mad > 0 ? "secondary" : "outline"}>{paymentLabels[line.payment_status] || line.payment_status}</Badge><ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open/line:rotate-180" /></div>
    </summary>
    <div className="border-t border-border p-3">
      <div className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <StageAmount label="Estimé" value={line.estimated_mad} />
        <StageAmount label="Devisé" value={line.quoted_mad} />
        <StageAmount label="Confirmé" value={line.confirmed_mad} />
        <StageAmount label="Final" value={line.final_mad} />
        <StageAmount label="Payé" value={line.paid_mad} />
        <StageAmount label="Écart" value={variance} danger={variance > 0} signed />
      </div>
      <p className="mb-3 text-xs text-muted-foreground">Devise source : {line.currency} · Taux utilisé : {Number(line.exchange_rate || 1).toLocaleString("fr-FR", { maximumFractionDigits: 6 })} vers MAD</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Fournisseur"><Select disabled={readOnly} value={draft.supplier_id || "none"} onValueChange={(value) => onUpdate(line.source_id, "supplier_id", value === "none" ? "" : value)}><SelectTrigger><SelectValue placeholder="Non assigné" /></SelectTrigger><SelectContent><SelectItem value="none">Non assigné</SelectItem>{suppliers.map((supplier) => <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Devise"><Select disabled={readOnly} value={draft.currency} onValueChange={(value) => onUpdate(line.source_id, "currency", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["JPY", "MAD", "EUR", "USD"].map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}</SelectContent></Select></Field>
        <Numeric id={`rate-${line.source_id}`} label="Taux vers MAD" value={draft.exchange_rate} onChange={(value) => onUpdate(line.source_id, "exchange_rate", value)} disabled={readOnly} />
        <Numeric id={`estimate-${line.source_id}`} label="Coût estimé" value={draft.estimated_cost} onChange={(value) => onUpdate(line.source_id, "estimated_cost", value)} disabled={readOnly} />
        <Numeric id={`quote-${line.source_id}`} label="Devis fournisseur" value={draft.supplier_quoted_cost ?? ""} onChange={(value) => onUpdate(line.source_id, "supplier_quoted_cost", value)} disabled={readOnly} />
        <Numeric id={`confirmed-${line.source_id}`} label="Coût confirmé" value={draft.confirmed_cost ?? ""} onChange={(value) => onUpdate(line.source_id, "confirmed_cost", value)} disabled={readOnly} />
        <Numeric id={`final-${line.source_id}`} label="Coût final" value={draft.final_cost ?? ""} onChange={(value) => onUpdate(line.source_id, "final_cost", value)} disabled={readOnly} />
        <Numeric id={`selling-${line.source_id}`} label="Prix de vente composant" value={draft.selling_price} onChange={(value) => onUpdate(line.source_id, "selling_price", value)} disabled={readOnly} />
        <Field label="Paiement fournisseur"><Select disabled={readOnly} value={draft.payment_status} onValueChange={(value) => onUpdate(line.source_id, "payment_status", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(paymentLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Field>
        <TextField id={`supplier-quote-${line.source_id}`} label="Devis fournisseur (ID)" value={draft.supplier_quote_id || ""} onChange={(value) => onUpdate(line.source_id, "supplier_quote_id", value)} disabled={readOnly} />
        <TextField id={`confirmation-${line.source_id}`} label="Confirmation (document ID)" value={draft.supplier_confirmation_document_id || ""} onChange={(value) => onUpdate(line.source_id, "supplier_confirmation_document_id", value)} disabled={readOnly} />
        <TextField id={`invoice-${line.source_id}`} label="Facture fournisseur (ID)" value={draft.supplier_invoice_id || ""} onChange={(value) => onUpdate(line.source_id, "supplier_invoice_id", value)} disabled={readOnly} />
        <TextField id={`payment-${line.source_id}`} label="Paiement fournisseur (ID)" value={draft.supplier_payment_id || ""} onChange={(value) => onUpdate(line.source_id, "supplier_payment_id", value)} disabled={readOnly} />
        {!readOnly && <div className="flex items-end sm:col-span-2 lg:col-span-4"><Button className="w-full sm:w-auto" onClick={() => void onSave(line)} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Enregistrer la ligne</Button></div>}
      </div>
    </div>
  </details>;
}

function ReconciliationCard({ reconciliation }: { reconciliation?: Reconciliation }) {
  if (!reconciliation) return null;
  const excluded = Number(reconciliation.excluded_from_financial_total_mad || 0);
  return <Card className="rounded-md border-dashed p-4"><div className="flex items-start gap-3"><Calculator className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="font-semibold">Réconciliation avec l’ancien résumé</p><p className="text-sm text-muted-foreground">Aucune donnée n’est supprimée : les lignes non actives, non fournisseur ou hors calcul sont conservées mais exclues du total.</p><div className="mt-3 grid gap-3 sm:grid-cols-3"><Amount label="Coût terrain mémorisé" value={reconciliation.stored_ground_cost_mad} /><Amount label="Ancien agrégat V4" value={reconciliation.previous_v4_estimated_mad} /><Amount label="Coût estimé corrigé" value={reconciliation.corrected_estimated_mad} /></div>{excluded > 0 && <div className="mt-3 text-sm"><p><span className="font-medium">Écart exclu : {fmtMAD(excluded)}</span><span className="text-muted-foreground"> · journées {fmtMAD(reconciliation.excluded_breakdown?.day_lines || 0)} · lignes globales {fmtMAD(reconciliation.excluded_breakdown?.global_lines || 0)} · hôtels {fmtMAD(reconciliation.excluded_breakdown?.hotel_lines || 0)} · vols {fmtMAD(reconciliation.excluded_breakdown?.flight_lines || 0)}</span></p>{Boolean(reconciliation.excluded_lines?.length) && <details className="group/reconciliation mt-2 rounded-md bg-muted/50 p-3"><summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span>Voir les lignes à l’origine de l’écart</span><ChevronDown className="h-4 w-4 transition-transform group-open/reconciliation:rotate-180" /></summary><ul className="mt-2 divide-y divide-border">{reconciliation.excluded_lines?.map((line) => <li key={`${line.source_type}-${line.source_id}`} className="flex flex-wrap justify-between gap-2 py-2"><span>{line.label || line.category} <span className="text-xs text-muted-foreground">({reasonLabel(line.reason)})</span></span><span className="font-medium tabular-nums">{fmtMAD(line.estimated_mad)}</span></li>)}</ul></details>}</div>}</div></div></Card>;
}

function Metric({ label, value, available = true, helper, emphasized = false, danger = false }: { label: string; value?: number; available?: boolean; helper?: string; emphasized?: boolean; danger?: boolean }) {
  return <Card className={`rounded-md p-4 ${danger ? "border-destructive/50 bg-destructive/5" : ""}`}><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-1 text-lg font-semibold tabular-nums ${emphasized ? "text-primary" : danger ? "text-destructive" : ""}`}>{available ? fmtMAD(value || 0) : "—"}</p>{helper && <p className="mt-1 text-xs text-muted-foreground">{helper}</p>}</Card>;
}
function SmallAmount({ label, value, danger = false, signed = false }: { label: string; value: number; danger?: boolean; signed?: boolean }) { return <div><p className="text-muted-foreground">{label}</p><p className={`font-medium tabular-nums ${danger ? "text-destructive" : ""}`}>{signed && value > 0 ? "+" : ""}{fmtMAD(value)}</p></div>; }
function StageAmount({ label, value, danger = false, signed = false }: { label: string; value?: number | null; danger?: boolean; signed?: boolean }) { return <div className="rounded-md bg-background p-2.5"><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-0.5 font-medium tabular-nums ${danger ? "text-destructive" : ""}`}>{value == null ? "—" : `${signed && value > 0 ? "+" : ""}${fmtMAD(value)}`}</p></div>; }
function Amount({ label, value }: { label: string; value?: number }) { return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-medium tabular-nums">{fmtMAD(value || 0)}</p></div>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>; }
function Numeric({ id, label, value, onChange, disabled }: { id: string; label: string; value: string | number; onChange: (value: string) => void; disabled: boolean }) { return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><Input id={id} inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} /></div>; }
function TextField({ id, label, value, onChange, disabled }: { id: string; label: string; value: string; onChange: (value: string) => void; disabled: boolean }) { return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><Input id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} /></div>; }
function formatDate(value?: string | null) { if (!value) return ""; const date = new Date(`${value}T00:00:00`); return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("fr-FR"); }
function reasonLabel(reason: string) { return ({ not_included: "hors calcul", not_supplier_cost: "pas un coût fournisseur", agency_fee: "frais agence", commercial_adjustment: "ajustement commercial", financially_excluded: "exclusion financière" } as Record<string, string>)[reason] || reason; }
