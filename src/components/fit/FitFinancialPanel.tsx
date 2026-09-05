import { useEffect, useState } from "react";
import { AlertTriangle, Calculator, ChevronDown, Save, TrendingDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmtMAD } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FitInput as Input } from "@/components/fit/FitFormControls";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const db = supabase as any;
const sourceTables: Record<string, string> = { day_cost: "fit_quote_day_cost_lines", cost_line: "fit_quote_cost_lines", hotel: "fit_quote_hotel_lines", flight: "fit_quote_flight_lines" };
const componentLabels: Record<string, string> = { hotels: "Hôtel", flights: "Vol", transport: "Transport", guide: "Guide", activities: "Activité", restaurants: "Restaurant", tickets: "Billet", insurance: "Assurance", other: "Autre service" };
const paymentLabels: Record<string, string> = { not_due: "Non dû", pending: "À payer", partially_paid: "Partiellement payé", paid: "Payé", cancelled: "Annulé" };

export function FitFinancialPanel({ quoteId, readOnly = false }: { quoteId: string; readOnly?: boolean }) {
  const [summary, setSummary] = useState<any>(null);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    const [{ data, error: summaryError }, { data: supplierRows }] = await Promise.all([
      db.rpc("get_fit_financial_summary_v4", { p_quote_id: quoteId }),
      db.from("suppliers").select("id,name").order("name"),
    ]);
    setLoading(false);
    if (summaryError) { setError(summaryError.message); return; }
    setError(""); setSummary(data); setSuppliers(supplierRows || []);
    setDrafts(Object.fromEntries((data?.components || []).map((line: any) => [line.source_id, { ...line }])));
  };
  useEffect(() => { void load(); }, [quoteId]);

  const save = async (line: any) => {
    const draft = drafts[line.source_id];
    const table = sourceTables[line.source_type];
    if (!table || !draft) return;
    const numberOrNull = (value: unknown) => value === "" || value == null ? null : Number(value);
    const { error: saveError } = await db.from(table).update({
      supplier_id: draft.supplier_id || null,
      estimated_cost: Number(draft.estimated_cost || 0),
      supplier_quoted_cost: numberOrNull(draft.supplier_quoted_cost),
      confirmed_cost: numberOrNull(draft.confirmed_cost),
      final_cost: numberOrNull(draft.final_cost),
      component_selling_price: Number(draft.selling_price || 0),
      cost_currency: draft.currency,
      exchange_rate_to_mad: Number(draft.exchange_rate || 1),
      supplier_payment_status: draft.payment_status,
      supplier_quote_id: draft.supplier_quote_id || null,
      supplier_confirmation_document_id: draft.supplier_confirmation_document_id || null,
      supplier_invoice_id: draft.supplier_invoice_id || null,
      supplier_payment_id: draft.supplier_payment_id || null,
      financial_updated_at: new Date().toISOString(),
    }).eq("id", line.source_id).eq("quote_id", quoteId);
    if (saveError) return toast.error(saveError.message);
    toast.success("Coût fournisseur enregistré."); void load();
  };
  const update = (id: string, key: string, value: unknown) => setDrafts((current) => ({ ...current, [id]: { ...current[id], [key]: value } }));

  if (loading) return <Card className="p-5 text-sm text-muted-foreground" role="status">Chargement de la rentabilité…</Card>;
  if (error) return <Card className="border-amber-200 p-5 text-sm text-amber-900"><AlertTriangle className="mr-2 inline h-4 w-4" />Migration FIT V4 requise : {error}</Card>;
  const alerts = summary?.alerts || {};
  return <section className="space-y-4" aria-labelledby="fit-finance-title">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 id="fit-finance-title" className="font-display text-xl">Coûts & rentabilité</h3><p className="text-sm text-muted-foreground">Vue financière consolidée en MAD, avec montants source conservés.</p></div><Badge variant={alerts.negative_margin || alerts.below_threshold ? "destructive" : "secondary"}>{alerts.negative_margin ? "Marge négative" : alerts.below_threshold ? "Marge sous seuil" : "Marge saine"}</Badge></div>
    {(alerts.cost_increase_after_acceptance || alerts.exchange_rate_erosion || alerts.negative_margin || alerts.below_threshold) && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><TrendingDown className="mr-2 inline h-4 w-4" />{alerts.exchange_rate_erosion ? "Le taux de change s’est écarté du snapshot d’acceptation et peut éroder la marge." : alerts.cost_increase_after_acceptance ? "Un coût fournisseur a augmenté après acceptation. Vérifiez l’érosion de marge." : "La rentabilité est sous le seuil configuré."}</div>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Prix client" value={summary.selling_price_mad} />
      <Metric label="Coûts estimés" value={summary.estimated_supplier_cost_mad} />
      <Metric label="Coûts confirmés" value={summary.confirmed_supplier_cost_mad} />
      <Metric label="Coûts payés" value={summary.supplier_paid_cost_mad} />
      <Metric label="Marge brute" value={summary.gross_margin_mad} suffix={`${summary.gross_margin_percent}%`} />
      <Metric label="Commission agence" value={summary.agency_gross_commission_mad} />
      <Metric label="Commission commercial" value={summary.sales_agent_commission_mad} />
      <Metric label="Marge LeJapon.ma" value={summary.lejapon_gross_margin_mad} />
      <Metric label="Profit attendu" value={summary.expected_profit_mad} />
      <Metric label="Profit confirmé" value={summary.confirmed_profit_mad} />
      <Metric label="Profit final" value={summary.final_profit_mad} />
      <Metric label="Net agence" value={summary.agency_net_commission_mad} />
    </div>
    <div className="space-y-2">
      {(summary.components || []).map((line: any) => { const d = drafts[line.source_id] || line; const variance = Number(line.variance || 0); return <details key={`${line.source_type}-${line.source_id}`} className="group rounded-md border border-border bg-background">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 p-3"><div className="min-w-0"><p className="truncate font-medium">{line.label || componentLabels[line.component_type]}</p><p className="text-xs text-muted-foreground">{componentLabels[line.component_type] || line.component_type} · {line.currency} · {paymentLabels[line.payment_status] || line.payment_status}</p></div><div className="flex items-center gap-3 text-right"><div><p className="font-semibold">{fmtMAD(line.final_mad || line.confirmed_mad || line.estimated_mad)}</p><p className={`text-xs ${variance > 0 ? "text-destructive" : "text-muted-foreground"}`}>Écart {variance > 0 ? "+" : ""}{variance.toLocaleString("fr-FR")} {line.currency}</p></div><ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></div></summary>
        <div className="grid gap-3 border-t p-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Fournisseur"><Select disabled={readOnly} value={d.supplier_id || "none"} onValueChange={(value) => update(line.source_id,"supplier_id",value === "none" ? "" : value)}><SelectTrigger><SelectValue placeholder="Non assigné" /></SelectTrigger><SelectContent><SelectItem value="none">Non assigné</SelectItem>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Devise"><Select disabled={readOnly} value={d.currency} onValueChange={(v) => update(line.source_id,"currency",v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["JPY","MAD","EUR","USD"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></Field>
          <Numeric label="Taux vers MAD" value={d.exchange_rate} onChange={(v) => update(line.source_id,"exchange_rate",v)} disabled={readOnly} />
          <Numeric label="Coût estimé" value={d.estimated_cost} onChange={(v) => update(line.source_id,"estimated_cost",v)} disabled={readOnly} />
          <Numeric label="Devis fournisseur" value={d.supplier_quoted_cost ?? ""} onChange={(v) => update(line.source_id,"supplier_quoted_cost",v)} disabled={readOnly} />
          <Numeric label="Coût confirmé" value={d.confirmed_cost ?? ""} onChange={(v) => update(line.source_id,"confirmed_cost",v)} disabled={readOnly} />
          <Numeric label="Coût final" value={d.final_cost ?? ""} onChange={(v) => update(line.source_id,"final_cost",v)} disabled={readOnly} />
          <Numeric label="Prix de vente" value={d.selling_price} onChange={(v) => update(line.source_id,"selling_price",v)} disabled={readOnly} />
          <Field label="Paiement fournisseur"><Select disabled={readOnly} value={d.payment_status} onValueChange={(v) => update(line.source_id,"payment_status",v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(paymentLabels).map(([v,l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></Field>
          <TextField label="Devis fournisseur (ID)" value={d.supplier_quote_id || ""} onChange={(v) => update(line.source_id,"supplier_quote_id",v)} disabled={readOnly} />
          <TextField label="Confirmation (document ID)" value={d.supplier_confirmation_document_id || ""} onChange={(v) => update(line.source_id,"supplier_confirmation_document_id",v)} disabled={readOnly} />
          <TextField label="Facture fournisseur (ID)" value={d.supplier_invoice_id || ""} onChange={(v) => update(line.source_id,"supplier_invoice_id",v)} disabled={readOnly} />
          <TextField label="Paiement fournisseur (ID)" value={d.supplier_payment_id || ""} onChange={(v) => update(line.source_id,"supplier_payment_id",v)} disabled={readOnly} />
          {!readOnly && <div className="flex items-end"><Button className="w-full" onClick={() => save(line)}><Save className="h-4 w-4" /> Enregistrer</Button></div>}
        </div>
      </details>; })}
      {!summary.components?.length && <Card className="p-8 text-center text-sm text-muted-foreground"><Calculator className="mx-auto mb-2 h-5 w-5" />Ajoutez des prestations au devis pour commencer le suivi financier.</Card>}
    </div>
  </section>;
}

function Metric({ label, value, suffix }: { label: string; value: number; suffix?: string }) { return <Card className="rounded-md p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{fmtMAD(value || 0)}</p>{suffix && <p className="text-xs text-muted-foreground">{suffix}</p>}</Card>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>; }
function Numeric({ label, value, onChange, disabled }: { label: string; value: string | number; onChange: (value: string) => void; disabled: boolean }) { const id=`fit-fin-${label.replace(/\s/g,"-")}`; return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} /></div>; }
function TextField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean }) { return <div className="space-y-1.5"><Label>{label}</Label><Input value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} /></div>; }
