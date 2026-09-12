import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, CircleDollarSign, ExternalLink, FileCheck2, Landmark, Loader2, LockKeyhole, Plus, Receipt, RefreshCw, Save, WalletCards, type LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmtMAD } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FitInput as Input, FitTextarea as Textarea } from "@/components/fit/FitFormControls";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

type RpcError = { message: string };
type SupplierDraft = { total: string; depositPercent: string; paid: string; dueDate: string; invoice: string; reference: string; exchangeRate: string };
type ClientPayment = { id: string; purpose: string; amount_mad: number; reference?: string | null; method?: string | null; due_date?: string | null; status: string };
type SupplierItem = {
  source_id: string; source_type: string; supplier_name?: string | null; label: string; confirmed_amount: number;
  deposit_percent: number; amount_paid: number; payment_deadline?: string | null; invoice_number?: string | null;
  payment_reference?: string | null; settlement_exchange_rate?: number | null; exchange_rate?: number | null;
  currency: string; balance: number; invoice_received: boolean; payment_proof_received: boolean;
};
type ClosureData = {
  financial_status: string; can_close: boolean; cash_exposure_mad: number; final_margin_mad: number;
  expected_margin_mad: number; confirmed_margin_mad: number; confirmed_complete?: boolean; final_complete?: boolean; closed_at?: string | null;
  client?: { balance_mad: number; selling_price_mad: number; deposit_required_mad: number; deposit_received_mad: number; additional_payments_mad: number; refunds_mad: number; received_mad: number; payments?: ClientPayment[] };
  suppliers?: { payable_mad: number; paid_mad: number; incomplete_count: number; items?: SupplierItem[] };
  alerts?: { client_payment_overdue?: boolean; client_balance_due?: number; supplier_payment_due?: boolean; cancellation_deadline?: boolean; unpaid_supplier?: boolean; missing_invoice?: boolean; commission_not_finalized?: boolean };
};
const db = supabase as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError | null }> };
const emptyTransaction = { kind: "payment", amount: "", method: "bank_transfer", reference: "", dueDate: "", notes: "" };
const statusLabels: Record<string, string> = { financially_open: "Financièrement ouvert", ready_for_closure: "Prêt à clôturer", closed: "Clôturé" };
const transactionLabels: Record<string, string> = { fit_deposit: "Acompte", fit_payment: "Paiement", fit_refund: "Remboursement", fit_schedule: "Échéance" };

export function FitFinancialClosurePanel({ quoteId, readOnly = false }: { quoteId: string; readOnly?: boolean }) {
  const [data, setData] = useState<ClosureData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [transactionOpen, setTransactionOpen] = useState(false);
  const [transaction, setTransaction] = useState(emptyTransaction);
  const [supplierDrafts, setSupplierDrafts] = useState<Record<string, SupplierDraft>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data: result, error: loadError } = await db.rpc("get_fit_financial_closure_v8", { p_quote_id: quoteId });
    setLoading(false);
    if (loadError) { setError(loadError.message); return; }
    setError("");
    const closure = result as ClosureData;
    setData(closure);
    setSupplierDrafts(Object.fromEntries((closure?.suppliers?.items || []).map((item) => [item.source_id, {
      total: String(item.confirmed_amount || ""),
      depositPercent: String(item.deposit_percent || ""),
      paid: String(item.amount_paid || ""),
      dueDate: item.payment_deadline || "",
      invoice: item.invoice_number || "",
      reference: item.payment_reference || "",
      exchangeRate: String(item.settlement_exchange_rate || item.exchange_rate || 1),
    }])));
  }, [quoteId]);
  useEffect(() => { void load(); }, [load]);

  const saveTransaction = async () => {
    const amount = Number(transaction.amount);
    if (!Number.isFinite(amount) || amount <= 0) return toast.error("Saisissez un montant positif.");
    setBusy("transaction");
    const { error: saveError } = await db.rpc("record_fit_client_transaction_v8", {
      p_quote_id: quoteId,
      p_amount_mad: amount,
      p_kind: transaction.kind,
      p_method: transaction.kind === "schedule" ? null : transaction.method,
      p_reference: transaction.reference || null,
      p_due_date: transaction.dueDate || null,
      p_idempotency_key: `fit-client:${quoteId}:${transaction.kind}:${transaction.reference || transaction.dueDate || amount}`,
      p_notes: transaction.notes || null,
    });
    setBusy("");
    if (saveError) return toast.error(saveError.message);
    setTransactionOpen(false); setTransaction(emptyTransaction); toast.success("Mouvement client enregistré."); void load();
  };

  const confirmScheduledPayment = async (paymentId: string) => {
    setBusy(paymentId);
    const { error: confirmError } = await db.rpc("confirm_fit_client_payment_v8", { p_payment_id: paymentId, p_method: null, p_reference: null });
    setBusy("");
    if (confirmError) return toast.error(confirmError.message);
    toast.success("Échéance marquée comme reçue."); void load();
  };

  const updateSupplier = (id: string, key: string, value: string) => setSupplierDrafts((current) => ({ ...current, [id]: { ...current[id], [key]: value } }));
  const saveSupplier = async (item: SupplierItem) => {
    const draft = supplierDrafts[item.source_id];
    if (!draft) return;
    const total = Number(draft.total); const paid = Number(draft.paid || 0); const rate = Number(draft.exchangeRate || 1); const deposit = Number(draft.depositPercent || 0);
    if (![total, paid, rate, deposit].every(Number.isFinite) || total < 0 || paid < 0 || rate <= 0 || deposit < 0 || deposit > 100) return toast.error("Vérifiez les montants fournisseur.");
    setBusy(item.source_id);
    const { error: saveError } = await db.rpc("upsert_fit_supplier_settlement_v8", {
      p_quote_id: quoteId, p_source_type: item.source_type, p_source_id: item.source_id,
      p_total_amount: total, p_deposit_percent: deposit, p_amount_paid: paid,
      p_due_date: draft.dueDate || null, p_invoice_number: draft.invoice || null,
      p_payment_reference: draft.reference || null, p_exchange_rate_to_mad: rate,
    });
    setBusy("");
    if (saveError) return toast.error(saveError.message);
    toast.success("Règlement fournisseur enregistré."); void load();
  };

  const closeFinance = async () => {
    setBusy("closure");
    const { error: closeError } = await db.rpc("close_fit_finance_v8", { p_quote_id: quoteId });
    setBusy("");
    if (closeError) return toast.error(closeError.message);
    toast.success("Dossier FIT clôturé financièrement."); void load();
  };

  if (loading) return <Card className="rounded-md p-5 text-sm text-muted-foreground" role="status"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Chargement des flux financiers…</Card>;
  if (error) return <Card className="rounded-md border-amber-300 p-5 text-sm text-amber-900"><AlertTriangle className="mr-2 inline h-4 w-4" />Migration FIT V8 requise : {error}</Card>;
  if (!data) return null;
  const client = data.client || {}; const suppliers = data.suppliers || {}; const alerts = data.alerts || {};
  const alertItems = [
    alerts.client_payment_overdue && "Une échéance client est dépassée.",
    alerts.client_balance_due && `Solde client restant : ${fmtMAD(alerts.client_balance_due)}.`,
    alerts.supplier_payment_due && "Un paiement fournisseur arrive à échéance sous 7 jours.",
    alerts.cancellation_deadline && "Une date limite d’annulation fournisseur approche.",
    alerts.unpaid_supplier && `Fournisseurs restant à payer : ${fmtMAD(suppliers.payable_mad)}.`,
    alerts.missing_invoice && "Une ou plusieurs factures fournisseur sont manquantes.",
    alerts.commission_not_finalized && "Les commissions ne sont pas finalisées.",
  ].filter(Boolean) as string[];

  return <section className="space-y-4" aria-labelledby="fit-closure-title">
    <Dialog open={transactionOpen} onOpenChange={setTransactionOpen}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>Ajouter un mouvement client</DialogTitle></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type"><Select value={transaction.kind} onValueChange={(kind) => setTransaction((current) => ({ ...current, kind }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="payment">Paiement reçu</SelectItem><SelectItem value="schedule">Échéance à venir</SelectItem><SelectItem value="refund">Remboursement</SelectItem></SelectContent></Select></Field>
          <TextField id="fit-client-amount" label="Montant (MAD)" inputMode="decimal" value={transaction.amount} onChange={(amount) => setTransaction((current) => ({ ...current, amount }))} />
          <TextField id="fit-client-due" label="Date d’échéance" type="date" value={transaction.dueDate} onChange={(dueDate) => setTransaction((current) => ({ ...current, dueDate }))} />
          <Field label="Moyen de paiement"><Select disabled={transaction.kind === "schedule"} value={transaction.method} onValueChange={(method) => setTransaction((current) => ({ ...current, method }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bank_transfer">Virement</SelectItem><SelectItem value="card">Carte</SelectItem><SelectItem value="cash">Espèces</SelectItem><SelectItem value="cheque">Chèque</SelectItem><SelectItem value="other">Autre</SelectItem></SelectContent></Select></Field>
          <TextField id="fit-client-reference" label="Référence" value={transaction.reference} onChange={(reference) => setTransaction((current) => ({ ...current, reference }))} />
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="fit-client-note">Note</Label><Textarea id="fit-client-note" value={transaction.notes} onChange={(event) => setTransaction((current) => ({ ...current, notes: event.target.value }))} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setTransactionOpen(false)}>Annuler</Button><Button onClick={saveTransaction} disabled={busy === "transaction"}>{busy === "transaction" && <Loader2 className="h-4 w-4 animate-spin" />}Enregistrer</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 id="fit-closure-title" className="font-display text-xl">Paiements & clôture</h3><p className="text-sm text-muted-foreground">Encaissements client, engagements fournisseurs et exposition de trésorerie.</p></div>
      <div className="flex items-center gap-2"><Badge variant={data.financial_status === "closed" ? "default" : data.can_close ? "secondary" : "outline"}>{statusLabels[data.financial_status] || data.financial_status}</Badge><Button size="icon" variant="ghost" onClick={() => void load()} aria-label="Actualiser"><RefreshCw className="h-4 w-4" /></Button></div>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric icon={CircleDollarSign} label="Créance client" value={client.balance_mad} />
      <Metric icon={Landmark} label="Dettes fournisseurs" value={suppliers.payable_mad} />
      <Metric icon={WalletCards} label="Exposition de trésorerie" value={data.cash_exposure_mad} />
      <Metric icon={Receipt} label="Marge finale" value={data.final_margin_mad} available={Boolean(data.final_complete)} helper={data.final_complete ? undefined : "Coûts finaux incomplets"} />
      <Metric icon={Receipt} label="Marge attendue" value={data.expected_margin_mad} />
      <Metric icon={Receipt} label="Marge confirmée" value={data.confirmed_margin_mad} available={Boolean(data.confirmed_complete)} helper={data.confirmed_complete ? undefined : "Engagements incomplets"} />
      <Metric icon={FileCheck2} label="Fournisseurs payés" value={suppliers.paid_mad} />
      <Metric icon={CheckCircle2} label="Paiements client" value={client.received_mad} />
    </div>

    {alertItems.length > 0 && <Card className="rounded-md border-amber-300 bg-amber-50 p-4 text-amber-950"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-semibold">Points à traiter</p><ul className="mt-2 space-y-1 text-sm">{alertItems.map((item) => <li key={item}>• {item}</li>)}</ul></div></div></Card>}

    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <Card className="min-w-0 rounded-md p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">Client → LeJapon.ma</p><p className="text-sm text-muted-foreground">Acompte, règlements, remboursements et solde.</p></div>{!readOnly && data.financial_status !== "closed" && <Button size="sm" onClick={() => setTransactionOpen(true)}><Plus className="h-4 w-4" />Mouvement</Button>}</div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3"><Amount label="Prix total" value={client.selling_price_mad} /><Amount label="Acompte requis" value={client.deposit_required_mad} /><Amount label="Acompte reçu" value={client.deposit_received_mad} /><Amount label="Autres paiements" value={client.additional_payments_mad} /><Amount label="Remboursements" value={client.refunds_mad} /><Amount label="Reste à recevoir" value={client.balance_mad} strong /></div>
        <div className="mt-4 space-y-2">{(client.payments || []).map((payment) => <div key={payment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm"><div><p className="font-medium">{transactionLabels[payment.purpose] || "Paiement"} · {fmtMAD(payment.amount_mad)}</p><p className="text-xs text-muted-foreground">{payment.reference || payment.method || "Sans référence"}{payment.due_date ? ` · Échéance ${formatDate(payment.due_date)}` : ""}</p></div><div className="flex items-center gap-2"><Badge variant={payment.status === "received" ? "default" : payment.status === "refunded" ? "destructive" : "outline"}>{payment.status === "received" ? "Reçu" : payment.status === "refunded" ? "Remboursé" : "À recevoir"}</Badge>{payment.status === "pending" && !readOnly && <Button size="sm" variant="outline" onClick={() => confirmScheduledPayment(payment.id)} disabled={busy === payment.id}>{busy === payment.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Confirmer</Button>}</div></div>)}{!client.payments?.length && <p className="py-6 text-center text-sm text-muted-foreground">Aucun mouvement client enregistré.</p>}</div>
      </Card>

      <Card className="min-w-0 rounded-md p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">LeJapon.ma → Fournisseurs</p><p className="text-sm text-muted-foreground">{suppliers.incomplete_count || 0} obligation(s) à compléter.</p></div><Button size="sm" variant="outline" asChild><a href="/admin/international-payments"><ExternalLink className="h-4 w-4" />Pièces comptables</a></Button></div>
        <div className="mt-4 space-y-2">{(suppliers.items || []).map((item) => { const draft = supplierDrafts[item.source_id]; return <details key={`${item.source_type}-${item.source_id}`} className="group rounded-md border border-border">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 p-3"><div className="min-w-0"><p className="truncate font-medium">{item.supplier_name || item.label}</p><p className="text-xs text-muted-foreground">{item.label} · {money(item.confirmed_amount,item.currency)}</p></div><div className="flex items-center gap-2"><Badge variant={item.balance <= 0 && item.invoice_received && item.payment_proof_received ? "default" : "outline"}>{item.balance <= 0 ? "Payé" : money(item.balance,item.currency)}</Badge><ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></div></summary>
          <div className="grid gap-3 border-t border-border p-3 sm:grid-cols-2">
            <TextField id={`supplier-total-${item.source_id}`} label={`Montant confirmé (${item.currency})`} inputMode="decimal" value={draft.total || ""} onChange={(value) => updateSupplier(item.source_id,"total",value)} disabled={readOnly || data.financial_status === "closed"} />
            <TextField id={`supplier-deposit-${item.source_id}`} label="Acompte requis (%)" inputMode="decimal" value={draft.depositPercent || ""} onChange={(value) => updateSupplier(item.source_id,"depositPercent",value)} disabled={readOnly || data.financial_status === "closed"} />
            <TextField id={`supplier-paid-${item.source_id}`} label={`Total payé (${item.currency})`} inputMode="decimal" value={draft.paid || ""} onChange={(value) => updateSupplier(item.source_id,"paid",value)} disabled={readOnly || data.financial_status === "closed"} />
            <TextField id={`supplier-rate-${item.source_id}`} label="Taux vers MAD" inputMode="decimal" value={draft.exchangeRate || ""} onChange={(value) => updateSupplier(item.source_id,"exchangeRate",value)} disabled={readOnly || data.financial_status === "closed"} />
            <TextField id={`supplier-due-${item.source_id}`} label="Échéance paiement" type="date" value={draft.dueDate || ""} onChange={(value) => updateSupplier(item.source_id,"dueDate",value)} disabled={readOnly || data.financial_status === "closed"} />
            <TextField id={`supplier-invoice-${item.source_id}`} label="N° facture" value={draft.invoice || ""} onChange={(value) => updateSupplier(item.source_id,"invoice",value)} disabled={readOnly || data.financial_status === "closed"} />
            <TextField id={`supplier-ref-${item.source_id}`} label="Référence paiement" value={draft.reference || ""} onChange={(value) => updateSupplier(item.source_id,"reference",value)} disabled={readOnly || data.financial_status === "closed"} />
            <div className="flex flex-wrap items-end gap-2"><Badge variant={item.invoice_received ? "secondary" : "outline"}>{item.invoice_received ? "Facture reçue" : "Facture manquante"}</Badge><Badge variant={item.payment_proof_received ? "secondary" : "outline"}>{item.payment_proof_received ? "Preuve reçue" : "Preuve manquante"}</Badge></div>
            {!readOnly && data.financial_status !== "closed" && <div className="sm:col-span-2"><Button className="w-full sm:w-auto" onClick={() => saveSupplier(item)} disabled={busy === item.source_id}>{busy === item.source_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Enregistrer le règlement</Button></div>}
          </div>
        </details>; })}{!suppliers.items?.length && <p className="py-6 text-center text-sm text-muted-foreground">Aucune obligation fournisseur confirmée.</p>}</div>
      </Card>
    </div>

    <Card className={`rounded-md border p-4 md:p-5 ${data.can_close ? "border-emerald-300 bg-emerald-50" : "border-border"}`}>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div className="flex items-start gap-3">{data.financial_status === "closed" ? <LockKeyhole className="mt-0.5 h-5 w-5 text-emerald-700" /> : <FileCheck2 className="mt-0.5 h-5 w-5" />}<div><p className="font-semibold">Clôture financière</p><p className="text-sm text-muted-foreground">{data.financial_status === "closed" ? `Clôturé le ${formatDate(data.closed_at)}.` : data.can_close ? "Tous les encaissements, règlements, justificatifs et commissions sont complets." : "La clôture sera disponible une fois tous les points financiers régularisés."}</p></div></div>{!readOnly && data.financial_status !== "closed" && <Button onClick={closeFinance} disabled={!data.can_close || busy === "closure"}>{busy === "closure" ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}Clôturer financièrement</Button>}</div>
    </Card>
  </section>;
}

function Metric({ icon: Icon, label, value, available = true, helper }: { icon: LucideIcon; label: string; value: number; available?: boolean; helper?: string }) { return <Card className="rounded-md p-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="h-4 w-4" />{label}</div><p className="mt-2 text-lg font-semibold tabular-nums">{available ? fmtMAD(value || 0) : "—"}</p>{helper && <p className="mt-1 text-xs text-muted-foreground">{helper}</p>}</Card>; }
function Amount({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) { return <div className="rounded-md bg-secondary/60 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-1 tabular-nums ${strong ? "font-bold text-foreground" : "font-medium"}`}>{fmtMAD(value || 0)}</p></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>; }
function TextField({ id, label, value, onChange, type = "text", inputMode, disabled = false }: { id: string; label: string; value: string; onChange: (value: string) => void; type?: string; inputMode?: "decimal"; disabled?: boolean }) { return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><Input id={id} type={type} inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} /></div>; }
function formatDate(value: unknown) { if (!value) return "—"; const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("fr-FR"); }
function money(value: unknown, currency = "MAD") { return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(Number(value || 0))} ${currency}`; }
