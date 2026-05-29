import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "../components/StatusBadge";
import { fmtDateTime, fmtMAD } from "@/lib/format";
import { toast } from "sonner";
import { ArrowLeft, Plus, FileText, Receipt, Download, Eye, Trash2, Pencil, History, ChevronDown } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { generateQuotePdf, generateReceiptPdf, downloadBytes } from "@/lib/booking-pdfs";
import { PdfPreviewDialog } from "../components/PdfPreviewDialog";
import { EditBookingDialog } from "../components/EditBookingDialog";
import { useNavigate } from "react-router-dom";
import { BookingParticipantsSection } from "../components/BookingParticipantsSection";
import { QuickActions } from "../components/QuickActions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { motion, useReducedMotion } from "framer-motion";
import { fetchAgencySettings, type AgencySettings } from "@/lib/agency-settings";

export default function BookingDetail() {
  const { id } = useParams();
  const { user, isAdmin, isSuperAdmin, roles } = useAuth();
  const navigate = useNavigate();
  const [b, setB] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [extras, setExtras] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [newPay, setNewPay] = useState({ amount_mad: "", method: "virement", status: "received", reference: "" });
  const [preview, setPreview] = useState<null | { kind: "quote" | "receipt"; payment?: any }>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [messageExpanded, setMessageExpanded] = useState(false);
  const [agency, setAgency] = useState<AgencySettings | null>(null);
  const canEdit = isAdmin || isSuperAdmin || roles.includes("manager");
  const reduceMotion = useReducedMotion();

  const load = async () => {
    if (!id) return;
    const { data } = await supabase.from("bookings").select("*, trips(title, season)").eq("id", id).single();
    setB(data);
    const { data: p } = await supabase.from("payments").select("*").eq("booking_id", id).order("created_at", { ascending: false });
    setPayments(p ?? []);
    const { data: e } = await supabase.from("booking_extras").select("*").eq("booking_id", id);
    setExtras(e ?? []);
    const { data: d } = await supabase.from("booking_documents" as any).select("*").eq("booking_id", id).order("created_at", { ascending: false });
    setDocs((d as any) ?? []);
    const { data: log } = await supabase.from("booking_audit_log" as any).select("*").eq("booking_id", id).order("created_at", { ascending: false }).limit(50);
    setAuditLog((log as any) ?? []);
    fetchAgencySettings().then(setAgency);
  };
  useEffect(() => { load(); }, [id]);

  const buildQuote = useCallback(
    () => generateQuotePdf({
      booking: b,
      trip: b?.trips ?? null,
      extras: extras as any,
      agency,
      number: `DEV-${b?.reference ?? ""}-${String(docs.filter((x) => x.kind === "quote").length + 1).padStart(2, "0")}`,
    }),
    [b, extras, docs, agency]
  );

  const buildReceipt = useCallback(
    () => generateReceiptPdf({
      booking: b,
      trip: b?.trips ?? null,
      payment: preview?.payment ?? payments[0] ?? { amount_mad: 0 },
      extras: extras as any,
      agency,
      number: `REC-${b?.reference ?? ""}-${String(docs.filter((x) => x.kind === "receipt").length + 1).padStart(2, "0")}`,
    }),
    [b, payments, preview, docs, extras, agency]
  );

  if (!b) return <p className="text-muted-foreground">Chargement…</p>;

  const updateStatus = async (status: string) => {
    const { error } = await supabase.from("bookings").update({ status: status as any }).eq("id", b.id);
    if (error) return toast.error(error.message);
    toast.success("Statut mis à jour");
    load();
  };

  const saveField = async (field: string, value: any) => {
    const { error } = await supabase.from("bookings").update({ [field]: value } as any).eq("id", b.id);
    if (error) return toast.error(error.message);
    toast.success("Enregistré");
  };

  const addPayment = async () => {
    if (!newPay.amount_mad) return;
    const { data: insertedPayment, error } = await supabase.from("payments").insert({
      booking_id: b.id,
      amount_mad: Number(newPay.amount_mad),
      method: newPay.method,
      status: newPay.status as any,
      reference: newPay.reference || null,
      paid_at: newPay.status === "received" ? new Date().toISOString() : null,
    }).select("id").single();
    if (error) return toast.error(error.message);
    if (newPay.status === "received") {
      const newPaid = Number(b.paid_amount_mad || 0) + Number(newPay.amount_mad);
      await supabase.from("bookings").update({ paid_amount_mad: newPaid }).eq("id", b.id);
      if (insertedPayment?.id) {
        const notificationPayload = { type: "payment", payload: { payment_id: insertedPayment.id } };
        if (import.meta.env.DEV) {
          console.info("[admin-email] invoke", { function: "send-admin-notification", payload: notificationPayload });
        }
        void supabase.functions.invoke("send-admin-notification", {
          body: notificationPayload,
        }).then(({ data, error }) => {
          if (import.meta.env.DEV) {
            console.info("[admin-email] invoke response", { function: "send-admin-notification", data, error });
          }
          if (error || data?.ok === false) console.warn("admin payment notification failed", data ?? error);
        });
      }
    }
    setNewPay({ amount_mad: "", method: "virement", status: "received", reference: "" });
    toast.success("Paiement enregistré");
    load();
  };

  const deletePayment = async (p: any) => {
    if (!confirm(`Supprimer ce ${p.status === "refunded" ? "remboursement" : "paiement"} de ${fmtMAD(p.amount_mad)} ?`)) return;
    const { error } = await supabase.from("payments").delete().eq("id", p.id);
    if (error) return toast.error(error.message);
    if (p.status === "received") {
      const newPaid = Math.max(0, Number(b.paid_amount_mad || 0) - Number(p.amount_mad));
      await supabase.from("bookings").update({ paid_amount_mad: newPaid }).eq("id", b.id);
    }
    toast.success("Paiement supprimé");
    load();
  };

  const deleteBooking = async () => {
    if (!confirm("Supprimer définitivement cette inscription ainsi que ses paiements et extras ?")) return;
    await supabase.from("payments").delete().eq("booking_id", b.id);
    await supabase.from("booking_extras").delete().eq("booking_id", b.id);
    const { error } = await supabase.from("bookings").delete().eq("id", b.id);
    if (error) return toast.error(error.message);
    toast.success("Inscription supprimée");
    navigate("/admin/bookings");
  };

  const saveAndDownload = async (kind: "quote" | "receipt", payment?: any) => {
    if (!b) return;
    setBusy(true);
    try {
      const number = kind === "quote"
        ? `DEV-${b.reference}-${String(docs.filter((x) => x.kind === "quote").length + 1).padStart(2, "0")}`
        : `REC-${b.reference}-${String(docs.filter((x) => x.kind === "receipt").length + 1).padStart(2, "0")}`;
      const bytes = kind === "quote"
        ? await generateQuotePdf({ booking: b, trip: b.trips, extras: extras as any, agency, number })
        : await generateReceiptPdf({ booking: b, trip: b.trips, payment: payment ?? payments[0] ?? { amount_mad: 0 }, extras: extras as any, agency, number });
      const path = `${b.id}/${number}.pdf`;
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const { error: upErr } = await supabase.storage.from("booking-docs").upload(path, new Blob([ab], { type: "application/pdf" }), { upsert: true, contentType: "application/pdf" });
      if (upErr) throw upErr;
      await supabase.from("booking_documents" as any).insert({
        booking_id: b.id, kind, number, storage_path: path,
        total_mad: b.total_amount_mad, paid_mad: b.paid_amount_mad,
        payment_id: payment?.id ?? null, created_by: user?.id ?? null,
      } as any);
      downloadBytes(bytes, `${number}.pdf`);
      toast.success(kind === "quote" ? "Devis généré" : "Reçu généré");
      load();
    } catch (e: any) {
      toast.error(e.message ?? "Erreur lors de la génération");
    } finally {
      setBusy(false);
    }
  };

  const openDoc = async (doc: any) => {
    const { data, error } = await supabase.storage.from("booking-docs").createSignedUrl(doc.storage_path, 60);
    if (error || !data) return toast.error("Lien indisponible");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const totalTravelers = Number(b.num_adults || 0) + Number(b.num_children || 0);
  const remainingAmount = Math.max(0, Number(b.total_amount_mad || 0) - Number(b.paid_amount_mad || 0));
  const paidPercent = Number(b.total_amount_mad || 0) > 0
    ? Math.min(100, Math.round((Number(b.paid_amount_mad || 0) / Number(b.total_amount_mad || 0)) * 100))
    : 0;
  const longMessage = String(b.message || "");
  const visibleMessage = !messageExpanded && longMessage.length > 150 ? `${longMessage.slice(0, 150)}…` : longMessage;

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-5 sm:space-y-6"
    >
      <Link to="/admin/bookings" className="inline-flex min-h-11 items-center gap-2 rounded-full px-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="w-4 h-4" /> Retour</Link>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground font-mono">{b.reference}</p>
          <h1 className="mt-1 truncate font-display text-xl leading-tight sm:text-2xl">{b.contact_name}</h1>
          <p className="truncate text-sm text-muted-foreground">{b.contact_email} · {b.contact_phone || "—"}</p>
          <QuickActions
            phone={b.contact_phone}
            email={b.contact_email}
            onPdf={() => setPreview({ kind: "quote" })}
            className="mt-3 sm:hidden"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-3">
          <StatusBadge value={b.status} />
          <Select value={b.status} onValueChange={updateStatus}>
            <SelectTrigger className="w-full sm:w-[160px] min-h-11"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="lead">Lead</SelectItem>
              <SelectItem value="confirmed">Confirmé</SelectItem>
              <SelectItem value="paid">Payé</SelectItem>
              <SelectItem value="cancelled">Annulé</SelectItem>
              <SelectItem value="completed">Terminé</SelectItem>
            </SelectContent>
          </Select>
          {canEdit && (
            <Button variant="outline" size="sm" className="min-h-11" onClick={() => setEditing(true)}>
              <Pencil className="w-4 h-4" /> Modifier
            </Button>
          )}
          <Button variant="destructive" size="sm" className="min-h-11" onClick={deleteBooking}>
            <Trash2 className="w-4 h-4" /> Supprimer
          </Button>
        </div>
      </header>

      <Card className="overflow-hidden rounded-2xl border-border shadow-sm">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Résumé réservation</p>
              <h2 className="mt-1 truncate font-display text-xl">{b.contact_name}</h2>
              <p className="truncate text-xs text-muted-foreground">{b.reference} · {b.trips?.title ?? "Voyage non défini"}</p>
            </div>
            <StatusBadge value={b.status} />
          </div>
          <div className="mt-4 rounded-2xl border border-accent/20 bg-accent/10 p-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">Paiement</p>
                <p className="font-display text-lg">{fmtMAD(b.paid_amount_mad)} encaissé</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-muted-foreground">Reste</p>
                <p className="font-semibold">{fmtMAD(remainingAmount)}</p>
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-background">
              <div className="h-full rounded-full bg-accent" style={{ width: `${paidPercent}%` }} />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
            <div className="rounded-xl bg-muted/60 p-3">
              <p className="text-[11px] text-muted-foreground">Total</p>
              <p className="truncate font-semibold">{fmtMAD(b.total_amount_mad)}</p>
            </div>
            <div className="rounded-xl bg-muted/60 p-3">
              <p className="text-[11px] text-muted-foreground">Voyageurs</p>
              <p className="truncate font-semibold">{totalTravelers}</p>
            </div>
            <div className="rounded-xl bg-muted/60 p-3">
              <p className="text-[11px] text-muted-foreground">Reçu</p>
              <p className="truncate font-semibold">{fmtDateTime(b.created_at)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3 lg:gap-6">
        <div className="lg:col-span-2 space-y-6">
          <details className="group rounded-2xl border border-border bg-background shadow-sm">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <h2 className="font-display text-lg">Détails du voyage</h2>
                <p className="truncate text-xs text-muted-foreground">{b.trips?.title ?? "—"} · {b.formula ?? "—"} · {b.room_type ?? "—"}</p>
              </div>
              <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-4 pb-4 sm:px-6 sm:pb-6">
            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div><p className="text-muted-foreground text-xs">Voyage</p><p className="font-medium">{b.trips?.title ?? "—"}</p></div>
              <div><p className="text-muted-foreground text-xs">Saison</p><p>{b.trips?.season ?? "—"}</p></div>
              <div><p className="text-muted-foreground text-xs">Adultes</p><p>{b.num_adults}</p></div>
              <div><p className="text-muted-foreground text-xs">Enfants</p><p>{b.num_children}</p></div>
              <div><p className="text-muted-foreground text-xs">Formule</p><p>{b.formula ?? "—"}</p></div>
              <div><p className="text-muted-foreground text-xs">Chambre</p><p>{b.room_type ?? "—"}</p></div>
              <div className="sm:col-span-2"><p className="text-muted-foreground text-xs">Dates souhaitées</p><p className="break-words">{b.preferred_dates ?? "—"}</p></div>
              <div className="sm:col-span-2">
                <p className="text-muted-foreground text-xs">Message</p>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{visibleMessage || "—"}</p>
                {longMessage.length > 150 && (
                  <Button type="button" variant="link" className="h-auto min-h-0 px-0 py-1 text-xs" onClick={() => setMessageExpanded((v) => !v)}>
                    {messageExpanded ? "Voir moins" : "Voir plus"}
                  </Button>
                )}
              </div>
            </div>
            {extras.length > 0 && (
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Extras</p>
                {extras.map((e) => <div key={e.id} className="flex justify-between text-sm py-1"><span>{e.name_snapshot} × {e.qty}</span><span>{fmtMAD(e.unit_price_mad * e.qty)}</span></div>)}
              </div>
            )}
            <div className="mt-4 pt-4 border-t border-border flex justify-between">
              <span className="font-semibold">Total</span>
              <span className="font-display text-xl">{fmtMAD(b.total_amount_mad)}</span>
            </div>
            </div>
          </details>

          <BookingParticipantsSection
            bookingId={b.id}
            tripId={b.trip_id}
            expectedTravelers={Number(b.num_adults || 0) + Number(b.num_children || 0)}
          />

          <Card className="rounded-2xl shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="font-display text-lg">Paiement</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            <div className="space-y-2 mb-4">
              {payments.length === 0 && <p className="text-sm text-muted-foreground">Aucun paiement enregistré.</p>}
              {payments.map((p) => (
                <div key={p.id} className="flex flex-col gap-3 rounded-xl border border-border p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">{fmtMAD(p.amount_mad)} <span className="text-muted-foreground font-normal">· {p.method}</span></p>
                    <p className="text-xs text-muted-foreground">{p.reference || "—"} · {fmtDateTime(p.paid_at || p.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2 justify-between sm:justify-end">
                    <StatusBadge value={p.status} />
                    {p.status === "received" && (
                      <Button size="sm" variant="ghost" onClick={() => saveAndDownload("receipt", p)} disabled={busy} title="Reçu pour ce paiement">
                        <Receipt className="w-4 h-4" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => deletePayment(p)} title="Supprimer">
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-2 border-t border-border pt-4 sm:grid-cols-2 md:grid-cols-5">
              <div><Label className="text-xs">Montant</Label><Input type="number" inputMode="decimal" value={newPay.amount_mad} onChange={(e) => setNewPay({ ...newPay, amount_mad: e.target.value })} /></div>
              <div><Label className="text-xs">Méthode</Label><Input value={newPay.method} onChange={(e) => setNewPay({ ...newPay, method: e.target.value })} /></div>
              <div><Label className="text-xs">Référence</Label><Input value={newPay.reference} onChange={(e) => setNewPay({ ...newPay, reference: e.target.value })} /></div>
              <div><Label className="text-xs">Statut</Label>
                <Select value={newPay.status} onValueChange={(v) => setNewPay({ ...newPay, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">En attente</SelectItem>
                    <SelectItem value="received">Reçu</SelectItem>
                    <SelectItem value="refunded">Remboursé</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button className="min-h-11" onClick={addPayment}><Plus className="w-4 h-4" /> Ajouter</Button>
            </div>
            <div className="mt-4 flex justify-between text-sm pt-4 border-t border-border">
              <span className="text-muted-foreground">Encaissé</span>
              <span className="font-semibold">{fmtMAD(b.paid_amount_mad)} / {fmtMAD(b.total_amount_mad)}</span>
            </div>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-5 lg:space-y-6">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="font-display text-lg">Documents PDF</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            <div className="grid grid-cols-2 gap-2 mb-4">
              <Button size="sm" className="min-h-11" onClick={() => saveAndDownload("quote")} disabled={busy}>
                <FileText className="w-4 h-4" /> Devis PDF
              </Button>
              <Button size="sm" className="min-h-11" variant="outline" onClick={() => setPreview({ kind: "quote" })} disabled={busy}>
                <Eye className="w-4 h-4" /> Aperçu
              </Button>
              <Button size="sm" className="min-h-11" onClick={() => saveAndDownload("receipt", payments[0])} disabled={busy || payments.length === 0} title={payments.length === 0 ? "Ajoutez d'abord un paiement" : undefined}>
                <Receipt className="w-4 h-4" /> Reçu PDF
              </Button>
              <Button size="sm" className="min-h-11" variant="outline" onClick={() => setPreview({ kind: "receipt", payment: payments[0] })} disabled={busy || payments.length === 0}>
                <Eye className="w-4 h-4" /> Aperçu
              </Button>
            </div>
            <div className="space-y-1.5 max-h-72 overflow-auto">
              {docs.length === 0 && <p className="text-xs text-muted-foreground">Aucun document généré.</p>}
              {docs.map((d) => (
                <button key={d.id} onClick={() => openDoc(d)} className="w-full flex items-center gap-2 p-2 border border-border rounded hover:bg-secondary text-left">
                  {d.kind === "quote" ? <FileText className="w-4 h-4 text-muted-foreground shrink-0" /> : <Receipt className="w-4 h-4 text-muted-foreground shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{d.number}</p>
                    <p className="text-[10px] text-muted-foreground">{fmtDateTime(d.created_at)}</p>
                  </div>
                  <Download className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              ))}
            </div>
            </CardContent>
          </Card>

          <details className="group rounded-2xl border border-border bg-background shadow-sm lg:block" open>
            <summary className="flex list-none items-center justify-between p-4 font-display text-lg cursor-pointer lg:cursor-default">
              Édition rapide
              <span className="text-xs text-muted-foreground group-open:hidden lg:hidden">ouvrir</span>
            </summary>
            <div className="px-4 pb-4 sm:px-6 sm:pb-6">
            <div className="space-y-3">
              <div><Label className="text-xs">Total (MAD)</Label><Input type="number" inputMode="decimal" defaultValue={b.total_amount_mad} onBlur={(e) => saveField("total_amount_mad", +e.target.value)} /></div>
              <div><Label className="text-xs">Notes internes</Label><Textarea rows={4} defaultValue={b.message ?? ""} onBlur={(e) => saveField("message", e.target.value)} /></div>
            </div>
            </div>
          </details>

          <details className="group rounded-2xl border border-border bg-background shadow-sm lg:block">
            <summary className="flex list-none items-center justify-between p-4 font-display text-lg cursor-pointer">
              <span className="flex items-center gap-2"><History className="w-4 h-4" /> Historique</span>
              <span className="text-xs text-muted-foreground group-open:hidden">ouvrir</span>
            </summary>
            <div className="px-4 pb-4 sm:px-6 sm:pb-6">
            {auditLog.length === 0 && <p className="text-xs text-muted-foreground">Aucune modification enregistrée.</p>}
            <ul className="space-y-2 max-h-72 overflow-auto">
              {auditLog.map((h) => (
                <li key={h.id} className="text-xs border border-border rounded p-2">
                  <p className="font-medium">{h.field}</p>
                  <p className="text-muted-foreground truncate">"{h.old_value}" → "{h.new_value}"</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{h.user_email || "—"} · {fmtDateTime(h.created_at)}</p>
                </li>
              ))}
            </ul>
            </div>
          </details>
        </aside>
      </div>

      <PdfPreviewDialog
        open={preview?.kind === "quote"}
        onOpenChange={(v) => !v && setPreview(null)}
        title="Aperçu du devis"
        filename={`devis-${b?.reference ?? ""}.pdf`}
        generate={buildQuote}
      />
      <PdfPreviewDialog
        open={preview?.kind === "receipt"}
        onOpenChange={(v) => !v && setPreview(null)}
        title="Aperçu du reçu"
        filename={`recu-${b?.reference ?? ""}.pdf`}
        generate={buildReceipt}
      />

      {canEdit && (
        <EditBookingDialog
          open={editing}
          onOpenChange={setEditing}
          booking={b}
          extras={extras}
          onSaved={load}
        />
      )}
    </motion.div>
  );
}
