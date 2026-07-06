import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "../components/StatusBadge";
import { fmtDateTime, fmtMAD } from "@/lib/format";
import { toast } from "sonner";
import { ArrowLeft, Plus, FileText, Receipt, Download, Eye, Trash2, Pencil, History, ChevronDown, Building2, UserCheck, Save, Upload } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { generateQuotePdf, generateReceiptPdf, generateInvoicePdf, downloadBytes } from "@/lib/booking-pdfs";
import { PdfPreviewDialog } from "../components/PdfPreviewDialog";
import { EditBookingDialog } from "../components/EditBookingDialog";
import { useNavigate } from "react-router-dom";
import { BookingParticipantsSection } from "../components/BookingParticipantsSection";
import { LinkExistingClientDialog } from "../components/LinkExistingClientDialog";
import { QuickActions } from "../components/QuickActions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { motion, useReducedMotion } from "framer-motion";
import { fetchAgencySettings, type AgencySettings } from "@/lib/agency-settings";
import { PAYMENT_METHOD_OPTIONS, normalisePaymentMethod, paymentMethodLabel } from "@/lib/payment-methods";
import {
  adjustmentAmount,
  draftFromQuoteAdjustment,
  emptyQuoteAdjustmentDraft,
  makeQuoteAdjustment,
  quoteAdjustmentsFromBooking,
  summarizeQuoteAdjustments,
  type QuoteAdjustment,
  type QuoteAdjustmentDraft,
} from "@/lib/quote-adjustments";
import { getBookingPricingBreakdown } from "@/lib/booking-pricing";
import { calculateCommercialDocumentTotals, invoiceTypeLabel } from "@/lib/commercial-documents";

export default function BookingDetail() {
  const { id } = useParams();
  const { user, isAdmin, isSuperAdmin, roles } = useAuth();
  const navigate = useNavigate();
  const [b, setB] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [extras, setExtras] = useState<any[]>([]);
  const [participants, setParticipants] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [newPay, setNewPay] = useState({ amount_mad: "", method: "bank_transfer", status: "received", reference: "" });
  const [quoteAdjustments, setQuoteAdjustments] = useState<QuoteAdjustment[]>([]);
  const [adjustmentDialogOpen, setAdjustmentDialogOpen] = useState(false);
  const [editingAdjustmentId, setEditingAdjustmentId] = useState<string | null>(null);
  const [adjustmentDraft, setAdjustmentDraft] = useState<QuoteAdjustmentDraft>(emptyQuoteAdjustmentDraft);
  const [preview, setPreview] = useState<null | { kind: "quote" | "receipt" | "invoice"; payment?: any }>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [linkClientOpen, setLinkClientOpen] = useState(false);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [messageExpanded, setMessageExpanded] = useState(false);
  const [agency, setAgency] = useState<AgencySettings | null>(null);
  const [agencyOrganizations, setAgencyOrganizations] = useState<any[]>([]);
  const [agencyMembers, setAgencyMembers] = useState<any[]>([]);
  const [selectedAgencyOrgId, setSelectedAgencyOrgId] = useState("");
  const [selectedAgencyUserId, setSelectedAgencyUserId] = useState("");
  const [assignmentNotes, setAssignmentNotes] = useState("");
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  const [docDraft, setDocDraft] = useState({ type: "autre", title: "", notes: "", file: null as File | null });
  const canEdit = isAdmin || isSuperAdmin || roles.includes("manager");
  const reduceMotion = useReducedMotion();

  const load = async () => {
    if (!id) return;
    const { data, error } = await supabase.from("bookings").select("*, trips(title, season, destination, start_date, end_date, duration_days, highlights, base_price_mad, promo_percent)").eq("id", id).single();
    if (error || !data) {
      console.error("[booking-detail] booking load failed", error);
      toast.error("Impossible de charger la réservation.");
      return;
    }
    setB(data);
    setQuoteAdjustments(quoteAdjustmentsFromBooking(data));
    setSelectedAgencyOrgId(data?.agency_organization_id ?? "");
    setSelectedAgencyUserId(data?.assigned_to ?? "");
    setAssignmentNotes(data?.agency_attribution_notes ?? "");
    const { data: p, error: paymentsError } = await supabase.from("payments").select("*").eq("booking_id", id).order("created_at", { ascending: false });
    if (paymentsError) console.warn("[booking-detail] payments unavailable", paymentsError);
    setPayments(p ?? []);
    const { data: e, error: extrasError } = await supabase.from("booking_extras").select("*").eq("booking_id", id);
    if (extrasError) console.warn("[booking-detail] extras unavailable", extrasError);
    setExtras(e ?? []);
    const { data: participantRows, error: participantError } = await (supabase as any)
      .from("booking_participants")
      .select("id,first_name,last_name,client_type,room_type,passport_no")
      .eq("booking_id", id)
      .order("created_at", { ascending: true });
    if (participantError) console.warn("[booking-detail] participants unavailable", participantError);
    setParticipants(participantRows ?? []);
    const { data: d, error: docsError } = await supabase.from("booking_documents" as any).select("*").eq("booking_id", id).order("created_at", { ascending: false });
    if (docsError) console.warn("[booking-detail] documents unavailable", docsError);
    setDocs((d as any) ?? []);
    const { data: log, error: logError } = await supabase.from("booking_audit_log" as any).select("*").eq("booking_id", id).order("created_at", { ascending: false }).limit(50);
    if (logError) console.warn("[booking-detail] audit log unavailable", logError);
    setAuditLog((log as any) ?? []);
    const { data: orgs, error: orgError } = await (supabase as any)
      .from("organizations")
      .select("id,type,status,display_name,legal_name,email,phone")
      .eq("type", "agency")
      .neq("status", "archived")
      .order("display_name", { ascending: true });
    if (orgError) {
      console.warn("[booking-agency-assignment] organizations unavailable", orgError);
      setAgencyOrganizations([]);
    } else {
      setAgencyOrganizations(orgs ?? []);
    }
    fetchAgencySettings().then(setAgency);
  };
  useEffect(() => { load(); }, [id]);

  const loadAgencyMembers = useCallback(async (organizationId: string) => {
    if (!organizationId) {
      setAgencyMembers([]);
      return;
    }

    const { data: members, error } = await (supabase as any)
      .from("organization_members")
      .select("id,user_id,role,status,created_at")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .order("created_at", { ascending: true });

    if (error) {
      console.warn("[booking-agency-assignment] organization members unavailable", error);
      setAgencyMembers([]);
      return;
    }

    const userIds = Array.from(new Set((members ?? []).map((member: any) => member.user_id).filter(Boolean)));
    let profileMap = new Map<string, any>();
    if (userIds.length > 0) {
      const { data: profiles, error: profileError } = await (supabase as any)
        .from("profiles")
        .select("id,full_name,phone")
        .in("id", userIds);
      if (profileError) {
        console.warn("[booking-agency-assignment] profiles unavailable", profileError);
      } else {
        profileMap = new Map((profiles ?? []).map((profile: any) => [profile.id, profile]));
      }
    }

    setAgencyMembers((members ?? []).map((member: any) => ({
      ...member,
      full_name: profileMap.get(member.user_id)?.full_name ?? null,
      phone: profileMap.get(member.user_id)?.phone ?? null,
    })));
  }, []);

  useEffect(() => {
    void loadAgencyMembers(selectedAgencyOrgId);
  }, [loadAgencyMembers, selectedAgencyOrgId]);

  const buildQuote = useCallback(
    () => generateQuotePdf({
      booking: b,
      trip: b?.trips ?? null,
      extras: extras as any,
      quote_adjustments: quoteAdjustments,
      payments,
      participants,
      agency,
      number: `DEV-${b?.reference ?? ""}-${String(docs.filter((x) => x.kind === "quote").length + 1).padStart(2, "0")}`,
    }),
    [b, extras, docs, agency, quoteAdjustments, payments, participants]
  );

  const buildReceipt = useCallback(
    () => generateReceiptPdf({
      booking: b,
      trip: b?.trips ?? null,
      payment: preview?.payment ?? payments[0] ?? { amount_mad: 0 },
      extras: extras as any,
      quote_adjustments: quoteAdjustments,
      payments,
      participants,
      agency,
      number: `REC-${b?.reference ?? ""}-${String(docs.filter((x) => x.kind === "receipt").length + 1).padStart(2, "0")}`,
    }),
    [b, payments, preview, docs, extras, agency, quoteAdjustments, participants]
  );

  const buildInvoice = useCallback(
    () => {
      const totals = calculateCommercialDocumentTotals({
        booking: b,
        trip: b?.trips ?? null,
        extras: extras as any,
        quoteAdjustments,
        payments,
      });
      return generateInvoicePdf({
        booking: b,
        trip: b?.trips ?? null,
        extras: extras as any,
        quote_adjustments: quoteAdjustments,
        payments,
        participants,
        agency,
        invoiceType: totals.invoiceType,
        number: `FAC-${b?.reference ?? ""}-${String(docs.filter((x) => x.kind === "invoice").length + 1).padStart(2, "0")}`,
      });
    },
    [b, extras, quoteAdjustments, payments, participants, agency, docs]
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

  const saveAgencyAssignment = async () => {
    if (!b) return;
    if (selectedAgencyUserId && !selectedAgencyOrgId) {
      toast.error("Sélectionnez une organisation avant un utilisateur agence.");
      return;
    }

    const currentOrg = agencyOrganizations.find((org) => org.id === b.agency_organization_id);
    const nextOrg = agencyOrganizations.find((org) => org.id === selectedAgencyOrgId);
    const currentMember = agencyMembers.find((member) => member.user_id === b.assigned_to);
    const nextMember = agencyMembers.find((member) => member.user_id === selectedAgencyUserId);

    const oldValue = [
      currentOrg?.display_name || currentOrg?.legal_name || b.agency_organization_id || "Aucune organisation",
      currentMember?.full_name || b.assigned_to || "Aucun utilisateur agence",
    ].join(" / ");
    const newValue = [
      nextOrg?.display_name || nextOrg?.legal_name || selectedAgencyOrgId || "Aucune organisation",
      nextMember?.full_name || selectedAgencyUserId || "Aucun utilisateur agence",
    ].join(" / ");

    setAssignmentBusy(true);
    try {
      const patch: any = {
        agency_organization_id: selectedAgencyOrgId || null,
        assigned_to: selectedAgencyUserId || null,
        agency_attributed_at: selectedAgencyOrgId ? new Date().toISOString() : null,
        agency_attributed_by: selectedAgencyOrgId ? user?.id ?? null : null,
        agency_attribution_notes: assignmentNotes.trim() || null,
      };
      const { error } = await (supabase as any).from("bookings").update(patch).eq("id", b.id);
      if (error) throw error;

      const auditValue = assignmentNotes.trim() ? `${newValue} · ${assignmentNotes.trim()}` : newValue;
      const { error: auditError } = await (supabase as any).from("booking_audit_log").insert({
        booking_id: b.id,
        field: "Attribution agence V2",
        old_value: oldValue,
        new_value: auditValue,
        user_id: user?.id ?? null,
        user_email: user?.email ?? null,
      });
      if (auditError) console.warn("[booking-agency-assignment] audit log failed", auditError);

      toast.success(selectedAgencyOrgId ? "Réservation attribuée à l’agence." : "Attribution agence retirée.");
      load();
    } catch (error: any) {
      toast.error(error?.message ?? "Impossible d’enregistrer l’attribution agence.");
    } finally {
      setAssignmentBusy(false);
    }
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
        void supabase.functions.invoke("send-admin-notification", {
          body: notificationPayload,
        }).then(({ data, error }) => {
          if (error || data?.ok === false) console.warn("admin payment notification failed", data ?? error);
        });
      }
    }
    setNewPay({ amount_mad: "", method: "bank_transfer", status: "received", reference: "" });
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

  const saveAndDownload = async (kind: "quote" | "receipt" | "invoice", payment?: any) => {
    if (!b) return;
    setBusy(true);
    try {
      const number = kind === "quote"
        ? `DEV-${b.reference}-${String(docs.filter((x) => x.kind === "quote").length + 1).padStart(2, "0")}`
        : kind === "invoice"
          ? `FAC-${b.reference}-${String(docs.filter((x) => x.kind === "invoice").length + 1).padStart(2, "0")}`
          : `REC-${b.reference}-${String(docs.filter((x) => x.kind === "receipt").length + 1).padStart(2, "0")}`;
      const commercialTotals = calculateCommercialDocumentTotals({
        booking: b,
        trip: b.trips,
        extras: extras as any,
        quoteAdjustments,
        payments,
      });
      const bytes = kind === "quote"
        ? await generateQuotePdf({
            booking: b,
            trip: b.trips,
            extras: extras as any,
            agency,
            number,
            quote_adjustments: quoteAdjustments,
            payments,
            participants,
          })
        : kind === "invoice"
          ? await generateInvoicePdf({
              booking: b,
              trip: b.trips,
              extras: extras as any,
              agency,
              number,
              quote_adjustments: quoteAdjustments,
              payments,
              participants,
              invoiceType: commercialTotals.invoiceType,
            })
          : await generateReceiptPdf({ booking: b, trip: b.trips, payment: payment ?? payments[0] ?? { amount_mad: 0 }, extras: extras as any, quote_adjustments: quoteAdjustments, payments, participants, agency, number });
      const path = `${b.id}/${number}.pdf`;
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const { error: upErr } = await supabase.storage.from("booking-docs").upload(path, new Blob([ab], { type: "application/pdf" }), { upsert: true, contentType: "application/pdf" });
      if (upErr) throw upErr;
      const documentPayload: any = {
        booking_id: b.id,
        kind,
        document_type: kind === "invoice" ? commercialTotals.invoiceType : kind,
        invoice_type: kind === "invoice" ? commercialTotals.invoiceType : null,
        title: kind === "invoice" ? invoiceTypeLabel(commercialTotals.invoiceType) : kind === "quote" ? "Devis" : "Reçu",
        number,
        storage_path: path,
        total_mad: commercialTotals.totalTTC,
        paid_mad: commercialTotals.paidAmount,
        remaining_mad: commercialTotals.remainingAmount,
        payment_id: payment?.id ?? null,
        created_by: user?.id ?? null,
        meta: kind === "invoice" ? { invoice_type: commercialTotals.invoiceType, remaining_mad: commercialTotals.remainingAmount } : { remaining_mad: commercialTotals.remainingAmount },
      };
      const documentInsert = await supabase.from("booking_documents" as any).insert(documentPayload);
      if (documentInsert.error) {
        const missingAccountingColumn = /invoice_type|remaining_mad|issued_at|schema cache|column/i.test(documentInsert.error.message ?? "");
        if (!missingAccountingColumn || kind === "invoice") throw documentInsert.error;
        const { invoice_type, remaining_mad, ...fallbackPayload } = documentPayload;
        const fallbackInsert = await supabase.from("booking_documents" as any).insert(fallbackPayload);
        if (fallbackInsert.error) throw fallbackInsert.error;
      }
      downloadBytes(bytes, `${number}.pdf`);
      toast.success(kind === "quote" ? "Devis généré" : kind === "invoice" ? `${invoiceTypeLabel(commercialTotals.invoiceType)} générée` : "Reçu généré");
      load();
    } catch (e: any) {
      toast.error(e.message ?? "Erreur lors de la génération");
    } finally {
      setBusy(false);
    }
  };

  const saveQuoteAdjustments = async (nextAdjustments: QuoteAdjustment[]) => {
    const cleaned = nextAdjustments.map((adjustment) => ({
      ...adjustment,
      amount: Number(adjustment.amount || 0),
      visible_on_quote: adjustment.visible_on_quote !== false,
    }));
    const { error } = await (supabase as any)
      .from("bookings")
      .update({ quote_adjustments: cleaned })
      .eq("id", b.id);
    if (error) {
      const missingColumn = error.code === "42703" || error.code === "PGRST204" || /quote_adjustments|schema cache|column/i.test(error.message ?? "");
      if (missingColumn) {
        toast.error("Colonne quote_adjustments manquante. Migration SQL requise pour enregistrer plusieurs lignes devis.");
      } else {
        toast.error(error.message);
      }
      return false;
    }
    setQuoteAdjustments(cleaned);
    toast.success("Ajustements devis enregistrés");
    load();
    return true;
  };

  const openAdjustmentDialog = (adjustment?: QuoteAdjustment) => {
    setEditingAdjustmentId(adjustment?.id ?? null);
    setAdjustmentDraft(adjustment ? draftFromQuoteAdjustment(adjustment) : emptyQuoteAdjustmentDraft());
    setAdjustmentDialogOpen(true);
  };

  const saveAdjustmentDraft = async () => {
    const amount = Number(adjustmentDraft.amount || 0);
    if (!adjustmentDraft.label.trim()) {
      toast.error("Le libellé est obligatoire.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Le montant doit être supérieur à 0.");
      return;
    }
    const existing = quoteAdjustments.find((adjustment) => adjustment.id === editingAdjustmentId) ?? null;
    const nextAdjustment = makeQuoteAdjustment(adjustmentDraft, user?.id, "admin", existing);
    const nextAdjustments = existing
      ? quoteAdjustments.map((adjustment) => adjustment.id === existing.id ? nextAdjustment : adjustment)
      : [...quoteAdjustments, nextAdjustment];
    const saved = await saveQuoteAdjustments(nextAdjustments);
    if (saved) setAdjustmentDialogOpen(false);
  };

  const deleteAdjustment = async (adjustment: QuoteAdjustment) => {
    if (!confirm(`Supprimer la ligne "${adjustment.label}" ?`)) return;
    await saveQuoteAdjustments(quoteAdjustments.filter((item) => item.id !== adjustment.id));
  };

  const openDoc = async (doc: any) => {
    const { data, error } = await supabase.storage.from("booking-docs").createSignedUrl(doc.storage_path, 60);
    if (error || !data) return toast.error("Lien indisponible");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const uploadBookingDocument = async () => {
    if (!b || !docDraft.file) return toast.error("Choisissez un fichier.");
    setBusy(true);
    try {
      const file = docDraft.file;
      const safeName = file.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9.]+/g, "-");
      const path = `${b.id}/documents/${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from("booking-docs").upload(path, file, {
        upsert: false,
        contentType: file.type || "application/octet-stream",
      });
      if (uploadError) throw uploadError;
      const { error } = await (supabase as any).from("booking_documents").insert({
        booking_id: b.id,
        kind: docDraft.type,
        document_type: docDraft.type,
        title: docDraft.title || file.name,
        file_name: file.name,
        notes: docDraft.notes || null,
        number: docDraft.title || file.name,
        storage_path: path,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
      setDocDraft({ type: "autre", title: "", notes: "", file: null });
      toast.success("Document ajouté.");
      load();
    } catch (error: any) {
      toast.error(error?.message ?? "Upload impossible.");
    } finally {
      setBusy(false);
    }
  };

  const deleteBookingDocument = async (doc: any) => {
    if (!confirm("Supprimer ce document ?")) return;
    const { error } = await (supabase as any).from("booking_documents").delete().eq("id", doc.id);
    if (error) return toast.error(error.message);
    if (doc.storage_path) void supabase.storage.from("booking-docs").remove([doc.storage_path]);
    toast.success("Document supprimé.");
    load();
  };

  const totalTravelers = Number(b.num_adults || 0) + Number(b.num_children || 0);
  const pricing = getBookingPricingBreakdown({
    booking: b,
    trip: b.trips,
    extras,
    quoteAdjustments,
  });
  const commercialTotals = calculateCommercialDocumentTotals({
    booking: b,
    trip: b.trips,
    extras,
    quoteAdjustments,
    payments,
  });
  const quoteSummary = pricing.enteredAdjustmentSummary;
  const displayedQuoteTotal = commercialTotals.totalTTC;
  const remainingAmount = commercialTotals.remainingAmount;
  const paidPercent = displayedQuoteTotal > 0
    ? Math.min(100, Math.round((Number(b.paid_amount_mad || 0) / displayedQuoteTotal) * 100))
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
              <div className="mt-2 flex flex-wrap gap-2">
                {b.client_id ? (
                  <Button asChild size="sm" variant="outline" className="h-8">
                    <Link to={`/admin/clients/${b.client_id}`}>Fiche client liée</Link>
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="h-8" onClick={() => setLinkClientOpen(true)}>
                    Associer à un client
                  </Button>
                )}
              </div>
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
              <p className="truncate font-semibold">{fmtMAD(displayedQuoteTotal)}</p>
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
            <div className="mt-4 grid gap-2 border-t border-border pt-4 text-sm sm:grid-cols-2">
              <div className="rounded-xl bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Prix voyage / personne</p>
                <p className="font-semibold">{fmtMAD(pricing.tripUnitPrice)}</p>
              </div>
              <div className="rounded-xl bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Nombre de personnes</p>
                <p className="font-semibold">{totalTravelers}</p>
              </div>
              <div className="rounded-xl bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Total voyage</p>
                <p className="font-semibold">{fmtMAD(pricing.tripTotal)}</p>
              </div>
              <div className="rounded-xl bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Extras</p>
                <p className="font-semibold">{fmtMAD(pricing.extrasTotal)}</p>
              </div>
              <div className="rounded-xl bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Total calculé</p>
                <p className="font-semibold">{fmtMAD(pricing.calculatedFinalTotal)}</p>
              </div>
              <div className="rounded-xl bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Total saisi</p>
                <p className="font-semibold">{fmtMAD(displayedQuoteTotal)}</p>
              </div>
              <div className="rounded-xl bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Montant payé</p>
                <p className="font-semibold">{fmtMAD(b.paid_amount_mad)}</p>
              </div>
              <div className="rounded-xl bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Reste à payer</p>
                <p className="font-semibold">{fmtMAD(remainingAmount)}</p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-border flex justify-between">
              <span className="font-semibold">Total final</span>
              <span className="font-display text-xl">{fmtMAD(displayedQuoteTotal)}</span>
            </div>
            </div>
          </details>

          <BookingParticipantsSection
            bookingId={b.id}
            tripId={b.trip_id}
            expectedTravelers={Number(b.num_adults || 0) + Number(b.num_children || 0)}
            onChanged={load}
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
                    <p className="font-medium">{fmtMAD(p.amount_mad)} <span className="text-muted-foreground font-normal">· {paymentMethodLabel(p.method)}</span></p>
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
              <div>
                <Label className="text-xs">Méthode</Label>
                <Select value={normalisePaymentMethod(newPay.method)} onValueChange={(value) => setNewPay({ ...newPay, method: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHOD_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
              <span className="font-semibold">{fmtMAD(b.paid_amount_mad)} / {fmtMAD(displayedQuoteTotal)}</span>
            </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="font-display text-lg">Ajustements devis</CardTitle>
                <Button type="button" size="sm" onClick={() => openAdjustmentDialog()} className="min-h-10">
                  <Plus className="h-4 w-4" />
                  Ajouter une ligne
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 p-4 pt-0 sm:p-6 sm:pt-0">
              {quoteAdjustments.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Aucune réduction ou supplément spécial ajouté au devis.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="bg-secondary/60 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Type</th>
                        <th className="px-3 py-2 text-left font-medium">Libellé</th>
                        <th className="px-3 py-2 text-left font-medium">Calcul</th>
                        <th className="px-3 py-2 text-right font-medium">Montant</th>
                        <th className="px-3 py-2 text-left font-medium">Devis</th>
                        <th className="px-3 py-2 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quoteAdjustments.map((adjustment) => {
                        const value = adjustmentAmount(adjustment, Number(b.total_amount_mad || 0));
                        return (
                          <tr key={adjustment.id} className="border-t border-border">
                            <td className="px-3 py-2">
                              <span className={adjustment.type === "discount" ? "text-emerald-700" : "text-amber-700"}>
                                {adjustment.type === "discount" ? "Réduction" : "Supplément"}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <p className="font-medium">{adjustment.label}</p>
                              {adjustment.reason && <p className="text-xs text-muted-foreground">{adjustment.reason}</p>}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {adjustment.calculation_type === "percentage" ? `${adjustment.amount}%` : "Fixe"}
                            </td>
                            <td className="px-3 py-2 text-right font-medium">
                              {adjustment.type === "discount" ? "-" : "+"}{fmtMAD(value)}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{adjustment.visible_on_quote === false ? "Masqué" : "Visible"}</td>
                            <td className="px-3 py-2">
                              <div className="flex justify-end gap-1">
                                <Button type="button" size="sm" variant="ghost" onClick={() => openAdjustmentDialog(adjustment)} title="Modifier">
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button type="button" size="sm" variant="ghost" onClick={() => deleteAdjustment(adjustment)} title="Supprimer">
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="grid gap-2 rounded-xl bg-secondary/40 p-3 text-sm sm:grid-cols-4">
                <div><span className="text-muted-foreground">Base</span><p className="font-semibold">{fmtMAD(b.total_amount_mad)}</p></div>
                <div><span className="text-muted-foreground">Suppléments</span><p className="font-semibold">+{fmtMAD(quoteSummary.supplementsTotal)}</p></div>
                <div><span className="text-muted-foreground">Réductions</span><p className="font-semibold">-{fmtMAD(quoteSummary.discountsTotal)}</p></div>
                <div><span className="text-muted-foreground">Total devis</span><p className="font-display text-lg">{fmtMAD(displayedQuoteTotal)}</p></div>
              </div>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-5 lg:space-y-6">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 font-display text-lg">
                <Building2 className="h-4 w-4 text-accent" />
                Attribution agence V2
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0 sm:p-6 sm:pt-0">
              <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-950">
                Lecture seule côté agence. Aucune commission ni paiement n’est calculé ici.
              </p>
              <div>
                <Label className="text-xs">Organisation agence</Label>
                <Select
                  value={selectedAgencyOrgId || "none"}
                  onValueChange={(value) => {
                    const nextValue = value === "none" ? "" : value;
                    setSelectedAgencyOrgId(nextValue);
                    setSelectedAgencyUserId("");
                  }}
                >
                  <SelectTrigger className="min-h-11">
                    <SelectValue placeholder="Sélectionner une agence" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Aucune agence</SelectItem>
                    {agencyOrganizations.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.display_name || org.legal_name || org.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Utilisateur agence assigné</Label>
                <Select
                  value={selectedAgencyUserId || "none"}
                  onValueChange={(value) => setSelectedAgencyUserId(value === "none" ? "" : value)}
                  disabled={!selectedAgencyOrgId}
                >
                  <SelectTrigger className="min-h-11">
                    <SelectValue placeholder="Sélectionner un utilisateur" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Aucun utilisateur spécifique</SelectItem>
                    {agencyMembers.map((member) => (
                      <SelectItem key={member.id} value={member.user_id}>
                        {member.full_name || member.user_id} · {member.role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedAgencyOrgId && agencyMembers.length === 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">Aucun membre actif trouvé pour cette agence.</p>
                )}
              </div>

              <div>
                <Label className="text-xs">Notes d’attribution</Label>
                <Textarea
                  rows={3}
                  value={assignmentNotes}
                  onChange={(event) => setAssignmentNotes(event.target.value)}
                  placeholder="Contexte interne pour cette attribution"
                />
              </div>

              <Button className="min-h-11 w-full" onClick={saveAgencyAssignment} disabled={assignmentBusy || !canEdit}>
                <UserCheck className="h-4 w-4" />
                {assignmentBusy ? "Enregistrement…" : "Enregistrer l’attribution"}
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="font-display text-lg">Documents réservation</CardTitle>
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
              <Button size="sm" className="min-h-11" onClick={() => saveAndDownload("invoice")} disabled={busy}>
                <FileText className="w-4 h-4" /> Créer facture
              </Button>
              <Button size="sm" className="min-h-11" variant="outline" onClick={() => setPreview({ kind: "invoice" })} disabled={busy}>
                <Eye className="w-4 h-4" /> Aperçu facture
              </Button>
              <p className="col-span-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                Type automatique : <span className="font-medium text-foreground">{invoiceTypeLabel(commercialTotals.invoiceType)}</span>
              </p>
            </div>
            <div className="mb-4 space-y-2 rounded-xl border border-border bg-muted/30 p-3">
              <div>
                <Label className="text-xs">Type document</Label>
                <Select value={docDraft.type} onValueChange={(value) => setDocDraft((current) => ({ ...current, type: value }))}>
                  <SelectTrigger className="min-h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="billet_avion">Billet avion</SelectItem>
                    <SelectItem value="reservation_hotel_extra">Réservation hôtel extra</SelectItem>
                    <SelectItem value="reservation_activite_extra">Réservation activité extra</SelectItem>
                    <SelectItem value="assurance">Assurance</SelectItem>
                    <SelectItem value="visa">Visa</SelectItem>
                    <SelectItem value="passeport">Passeport</SelectItem>
                    <SelectItem value="autre">Autre</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Titre</Label><Input value={docDraft.title} onChange={(event) => setDocDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Titre visible" /></div>
              <div><Label className="text-xs">Notes</Label><Textarea rows={2} value={docDraft.notes} onChange={(event) => setDocDraft((current) => ({ ...current, notes: event.target.value }))} /></div>
              <Input type="file" onChange={(event) => setDocDraft((current) => ({ ...current, file: event.target.files?.[0] ?? null }))} />
              <Button className="w-full min-h-10" onClick={uploadBookingDocument} disabled={busy || !docDraft.file}>
                <Upload className="h-4 w-4" /> Ajouter document
              </Button>
            </div>
            <div className="space-y-1.5 max-h-72 overflow-auto">
              {docs.length === 0 && <p className="text-xs text-muted-foreground">Aucun document généré.</p>}
              {docs.map((d) => (
                <div key={d.id} className="flex w-full items-center gap-2 rounded border border-border p-2 text-left">
                  {d.kind === "receipt" ? <Receipt className="w-4 h-4 text-muted-foreground shrink-0" /> : <FileText className="w-4 h-4 text-muted-foreground shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{d.title || d.number || d.file_name || d.kind}</p>
                    <p className="text-[10px] text-muted-foreground">{d.document_type || d.kind} · {fmtDateTime(d.created_at)}</p>
                    {d.notes && <p className="truncate text-[10px] text-muted-foreground">{d.notes}</p>}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => openDoc(d)} title="Télécharger"><Download className="w-3.5 h-3.5" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => deleteBookingDocument(d)} title="Supprimer"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                </div>
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
      <Dialog open={adjustmentDialogOpen} onOpenChange={setAdjustmentDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingAdjustmentId ? "Modifier une ligne devis" : "Ajouter une ligne devis"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={adjustmentDraft.type}
                  onValueChange={(value) => setAdjustmentDraft((current) => ({ ...current, type: value as QuoteAdjustmentDraft["type"] }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="discount">Réduction</SelectItem>
                    <SelectItem value="supplement">Supplément</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Calcul</Label>
                <Select
                  value={adjustmentDraft.calculation_type}
                  onValueChange={(value) => setAdjustmentDraft((current) => ({ ...current, calculation_type: value as QuoteAdjustmentDraft["calculation_type"] }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed_amount">Montant fixe</SelectItem>
                    <SelectItem value="percentage">Pourcentage</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Libellé</Label>
              <Input
                value={adjustmentDraft.label}
                onChange={(event) => setAdjustmentDraft((current) => ({ ...current, label: event.target.value }))}
                placeholder="Réduction famille, Deux sièges devant…"
              />
            </div>
            <div className="space-y-2">
              <Label>Montant</Label>
              <Input
                type="number"
                min={0}
                inputMode="decimal"
                value={adjustmentDraft.amount}
                onChange={(event) => setAdjustmentDraft((current) => ({ ...current, amount: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Notes internes</Label>
              <Textarea
                rows={3}
                value={adjustmentDraft.reason}
                onChange={(event) => setAdjustmentDraft((current) => ({ ...current, reason: event.target.value }))}
                placeholder="Raison commerciale, demande spéciale, contexte interne"
              />
            </div>
            <label className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm">
              <Checkbox
                checked={adjustmentDraft.visible_on_quote}
                onCheckedChange={(checked) => setAdjustmentDraft((current) => ({ ...current, visible_on_quote: checked === true }))}
              />
              Visible sur le devis client
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAdjustmentDialogOpen(false)}>Annuler</Button>
            <Button type="button" onClick={saveAdjustmentDraft}>
              <Save className="h-4 w-4" />
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PdfPreviewDialog
        open={preview?.kind === "receipt"}
        onOpenChange={(v) => !v && setPreview(null)}
        title="Aperçu du reçu"
        filename={`recu-${b?.reference ?? ""}.pdf`}
        generate={buildReceipt}
      />
      <PdfPreviewDialog
        open={preview?.kind === "invoice"}
        onOpenChange={(v) => !v && setPreview(null)}
        title={`Aperçu ${invoiceTypeLabel(commercialTotals.invoiceType)}`}
        filename={`facture-${b?.reference ?? ""}.pdf`}
        generate={buildInvoice}
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
      <LinkExistingClientDialog
        open={linkClientOpen}
        onOpenChange={setLinkClientOpen}
        bookingId={b.id}
        tripId={b.trip_id}
        onSaved={load}
      />
    </motion.div>
  );
}
