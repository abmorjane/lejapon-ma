/* eslint-disable @typescript-eslint/no-explicit-any */
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
import { ArrowLeft, Plus, FileText, Receipt, Download, Eye, Trash2, Pencil, History, ChevronDown, Building2, UserCheck, Save, Upload, Mail, Plane, TicketCheck, FileSearch, CreditCard, SlidersHorizontal, ListChecks, MoreHorizontal, CalendarDays, Users, BedDouble, Hotel, AlertTriangle, FolderOpen } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { generateQuotePdf, generateReceiptPdf, generateInvoicePdf, downloadBytes } from "@/lib/booking-pdfs";
import { PdfPreviewDialog } from "../components/PdfPreviewDialog";
import { EditBookingDialog } from "../components/EditBookingDialog";
import { useNavigate } from "react-router-dom";
import { BookingParticipantsSection } from "../components/BookingParticipantsSection";
import { LinkExistingClientDialog } from "../components/LinkExistingClientDialog";
import { OperationChecklistPanel } from "../components/OperationChecklistPanel";
import { AdminPaymentDialog } from "../components/AdminPaymentDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { motion, useReducedMotion } from "framer-motion";
import {
  getFlightTicketStatus,
  missingFlightReservationRequirements,
  normalizeFlightWorkflowStatus,
  normalizePnr as normalizeFlightPnr,
  participantFullName,
} from "@/admin/lib/flight-tickets";
import { extractFlightTicketText, parseFlightTicketText, type DetectedFlightTicket } from "@/admin/lib/flight-ticket-import";
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
import { tripWorkspacePath } from "@/admin/lib/trip-workspace";
import { publicHotelLabel, publicRoomLabel } from "@/lib/booking-options";

const FINANCIAL_DOCUMENT_TYPES = new Set(["quote", "receipt", "invoice", "payment", "financial"]);

const isFinancialBookingDocument = (value?: string | null, title?: string | null) =>
  FINANCIAL_DOCUMENT_TYPES.has(String(value || "").toLowerCase()) ||
  /(devis|reçu|recu|facture|paiement|payment|receipt|invoice)/i.test(String(title || ""));

const defaultVisibilityScopeForDocument = (type?: string | null, title?: string | null) =>
  isFinancialBookingDocument(type, title) ? "booking_owner_only" : "booking_participants";

const visibilityScopeLabel = (scope?: string | null) =>
  scope === "booking_owner_only" ? "Contact principal uniquement" : "Tous les voyageurs de la réservation";

const FLIGHT_STATUS_LABELS: Record<string, string> = {
  not_booked: "En attente de réservation",
  booked: "Vol réservé",
  ticket_sent: "Billets envoyés",
  pending_booking: "En attente de réservation",
  reserved: "Vol réservé",
  partially_ticketed: "Billets partiellement émis",
  ticketed: "Billets émis",
  delivered: "Billets envoyés",
  incomplete: "Informations incomplètes",
};

const FLIGHT_STATUS_CLASSES: Record<string, string> = {
  not_booked: "bg-red-50 text-red-900 border-red-200",
  booked: "bg-blue-50 text-blue-900 border-blue-200",
  ticket_sent: "bg-emerald-100 text-emerald-950 border-emerald-300",
  pending_booking: "bg-red-50 text-red-900 border-red-200",
  reserved: "bg-blue-50 text-blue-900 border-blue-200",
  partially_ticketed: "bg-orange-50 text-orange-900 border-orange-200",
  ticketed: "bg-emerald-50 text-emerald-900 border-emerald-200",
  delivered: "bg-emerald-100 text-emerald-950 border-emerald-300",
  incomplete: "bg-orange-50 text-orange-900 border-orange-200",
};

const emptyFlightDraft = {
  status: "pending_booking",
  booking_platform: "APG",
  booking_platform_other: "",
  pnr: "",
  e_ticket_number: "",
  fare_amount: "",
  fare_currency: "MAD",
  fare_mad: "",
  booking_class: "",
  baggage: "",
  airline: "",
  flight_number: "",
  departure_at: "",
  return_at: "",
  segments_text: "",
  ticket_document_id: "",
  ticket_storage_path: "",
  ticket_sent_to_customer: false,
  email_sent: false,
  traveler_ids: [] as string[],
};

const toDateTimeLocal = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const fromDateTimeLocal = (value?: string | null) => value ? new Date(value).toISOString() : null;

const segmentsToText = (segments: unknown) => {
  if (!Array.isArray(segments)) return "";
  return segments
    .map((segment: any) => segment?.label || segment?.flight_number || segment?.route || "")
    .filter(Boolean)
    .join("\n");
};

const textToSegments = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((label) => ({ label }));

const normalizePnr = (value: string) => normalizeFlightPnr(value);

const normalizePersonName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

const participantName = (participant: any) => participantFullName(participant);

const flightDraftFromRow = (row?: any) => ({
  ...emptyFlightDraft,
  status: normalizeFlightWorkflowStatus(row?.status),
  booking_platform: row?.booking_platform || "APG",
  booking_platform_other: row?.booking_platform_other || "",
  pnr: row?.pnr || "",
  e_ticket_number: row?.e_ticket_number || "",
  fare_amount: row?.fare_amount != null ? String(row.fare_amount) : row?.fare_mad != null ? String(row.fare_mad) : "",
  fare_currency: row?.fare_currency || "MAD",
  fare_mad: row?.fare_mad != null ? String(row.fare_mad) : "",
  booking_class: row?.booking_class || "",
  baggage: row?.baggage || "",
  airline: row?.airline || "",
  flight_number: row?.flight_number || "",
  departure_at: toDateTimeLocal(row?.departure_at),
  return_at: toDateTimeLocal(row?.return_at),
  segments_text: segmentsToText(row?.segments),
  ticket_document_id: row?.ticket_document_id || "",
  ticket_storage_path: row?.ticket_storage_path || "",
  ticket_sent_to_customer: row?.ticket_sent_to_customer === true,
  email_sent: row?.email_sent === true,
  traveler_ids: [],
});

const missingFlightBookingFields = (draft: typeof emptyFlightDraft, participants: any[] = []) => {
  const missing = missingFlightReservationRequirements({
    ...draft,
    fare_amount: draft.fare_amount,
    linked_traveler_count: draft.traveler_ids.length,
  }, draft.traveler_ids.length);
  if (draft.booking_platform === "Autre" && !draft.booking_platform_other.trim()) missing.push("Nom de la plateforme");
  if (participants.length === 0 && !missing.includes("Voyageurs")) missing.push("Voyageurs");
  return missing;
};

const missingFlightFields = (draft: typeof emptyFlightDraft, participants: any[] = []) => {
  const missing = missingFlightBookingFields(draft, participants);
  if (!draft.ticket_sent_to_customer) missing.push("Billet envoyé au client");
  return missing;
};

export default function BookingDetail() {
  const { id } = useParams();
  const { user, isAdmin, isSuperAdmin, roles } = useAuth();
  const navigate = useNavigate();
  const [b, setB] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [extras, setExtras] = useState<any[]>([]);
  const [participants, setParticipants] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [flightReservation, setFlightReservation] = useState<any>(null);
  const [flightDraft, setFlightDraft] = useState(emptyFlightDraft);
  const [flightTravelers, setFlightTravelers] = useState<any[]>([]);
  const [flightTicketDocuments, setFlightTicketDocuments] = useState<any[]>([]);
  const [flightTicketDocumentTravelers, setFlightTicketDocumentTravelers] = useState<any[]>([]);
  const [flightTravelerTicketNumbers, setFlightTravelerTicketNumbers] = useState<any[]>([]);
  const [flightHistory, setFlightHistory] = useState<any[]>([]);
  const [flightDuplicateWarning, setFlightDuplicateWarning] = useState<string | null>(null);
  const [flightTicketFile, setFlightTicketFile] = useState<File | null>(null);
  const [flightTicketTravelerIds, setFlightTicketTravelerIds] = useState<string[]>([]);
  const [flightTicketReplacingDocId, setFlightTicketReplacingDocId] = useState<string | null>(null);
  const [ticketNumberDrafts, setTicketNumberDrafts] = useState<Record<string, string>>({});
  const [flightImportPreview, setFlightImportPreview] = useState<DetectedFlightTicket | null>(null);
  const [flightImportDialogOpen, setFlightImportDialogOpen] = useState(false);
  const [flightBusy, setFlightBusy] = useState(false);
  const [flightEditMode, setFlightEditMode] = useState(false);
  const [flightDraftBeforeEdit, setFlightDraftBeforeEdit] = useState<typeof emptyFlightDraft | null>(null);
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
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [flightOpen, setFlightOpen] = useState(false);
  const [adjustmentsOpen, setAdjustmentsOpen] = useState(false);
  const [agencyOpen, setAgencyOpen] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [taskSummary, setTaskSummary] = useState({ total: 0, overdue: 0, critical: 0 });
  const [docDraft, setDocDraft] = useState({
    type: "autre",
    title: "",
    notes: "",
    visible_to_client: false,
    visibility_scope: "booking_participants",
    file: null as File | null,
  });
  const canEdit = isAdmin || isSuperAdmin || roles.includes("manager");
  const reduceMotion = useReducedMotion();

  const load = async () => {
    if (!id) return;
    const { data, error } = await supabase.from("bookings").select("*, trips(title, season, destination, start_date, end_date, duration_days, total_trip_days, japan_stay_days, highlights, base_price_mad, promo_percent)").eq("id", id).single();
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
      .select("*")
      .eq("booking_id", id)
      .order("created_at", { ascending: true });
    if (participantError) console.warn("[booking-detail] participants unavailable", participantError);
    setParticipants(participantRows ?? []);
    const { data: checklistRows } = await (supabase as any)
      .from("operation_checklists")
      .select("id")
      .eq("booking_id", id);
    const checklistIds = (checklistRows ?? []).map((row: any) => row.id);
    if (checklistIds.length) {
      const { data: taskRows } = await (supabase as any)
        .from("operation_checklist_items")
        .select("status,priority,deadline")
        .in("checklist_id", checklistIds);
      const activeTasks = (taskRows ?? []).filter((task: any) => !["completed", "cancelled"].includes(String(task.status)));
      setTaskSummary({
        total: activeTasks.length,
        overdue: activeTasks.filter((task: any) => task.deadline && new Date(task.deadline).getTime() < Date.now()).length,
        critical: activeTasks.filter((task: any) => task.priority === "critical").length,
      });
    } else {
      setTaskSummary({ total: 0, overdue: 0, critical: 0 });
    }
    const { data: d, error: docsError } = await supabase.from("booking_documents" as any).select("*").eq("booking_id", id).order("created_at", { ascending: false });
    if (docsError) console.warn("[booking-detail] documents unavailable", docsError);
    setDocs((d as any) ?? []);
    const { data: flightRows, error: flightError } = await (supabase as any)
      .from("booking_flight_reservations")
      .select("*")
      .eq("booking_id", id)
      .neq("status", "cancelled")
      .order("updated_at", { ascending: false })
      .limit(1);
    if (flightError) {
      const missingFlightTable = /booking_flight_reservations|schema cache|Could not find the table/i.test(flightError.message ?? "");
      if (!missingFlightTable) console.warn("[booking-detail] flight reservation unavailable", flightError);
      setFlightReservation(null);
      const defaultTravelerIds = (participantRows ?? []).map((participant: any) => participant.id).filter(Boolean);
      setFlightDraft({ ...emptyFlightDraft, traveler_ids: defaultTravelerIds });
      setFlightTicketTravelerIds(defaultTravelerIds);
      setFlightTravelers([]);
      setFlightTicketDocuments([]);
      setFlightTicketDocumentTravelers([]);
      setFlightTravelerTicketNumbers([]);
      setFlightHistory([]);
    } else {
      const flightRow = flightRows?.[0] ?? null;
      setFlightReservation(flightRow ?? null);
      let travelerRows: any[] = [];
      let ticketDocumentRows: any[] = [];
      let ticketDocumentTravelerRows: any[] = [];
      let ticketNumberRows: any[] = [];
      let historyRows: any[] = [];
      if (flightRow?.id) {
        const [
          { data: loadedTravelers, error: travelersError },
          { data: loadedTicketDocuments, error: ticketDocumentsError },
          { data: loadedTicketDocumentTravelers, error: ticketDocumentTravelersError },
          { data: loadedTicketNumbers, error: ticketNumbersError },
          { data: loadedHistory, error: historyError },
        ] = await Promise.all([
          (supabase as any)
            .from("booking_flight_travelers")
            .select("*")
            .eq("flight_reservation_id", flightRow.id)
            .order("created_at", { ascending: true }),
          (supabase as any)
            .from("booking_flight_ticket_documents")
            .select("*")
            .eq("flight_reservation_id", flightRow.id)
            .is("deleted_at", null)
            .order("created_at", { ascending: false }),
          (supabase as any)
            .from("booking_flight_ticket_document_travelers")
            .select("*")
            .eq("flight_reservation_id", flightRow.id),
          (supabase as any)
            .from("booking_flight_traveler_ticket_numbers")
            .select("*")
            .eq("flight_reservation_id", flightRow.id)
            .order("created_at", { ascending: true }),
          (supabase as any)
            .from("booking_flight_reservation_history")
            .select("*")
            .eq("flight_reservation_id", flightRow.id)
            .order("created_at", { ascending: false })
            .limit(20),
        ]);
        if (travelersError && !/booking_flight_travelers|schema cache|Could not find the table/i.test(travelersError.message ?? "")) {
          console.warn("[booking-detail] flight travelers unavailable", travelersError);
        }
        if (ticketDocumentsError && !/booking_flight_ticket_documents|schema cache|Could not find the table/i.test(ticketDocumentsError.message ?? "")) {
          console.warn("[booking-detail] flight ticket documents unavailable", ticketDocumentsError);
        }
        if (ticketDocumentTravelersError && !/booking_flight_ticket_document_travelers|schema cache|Could not find the table/i.test(ticketDocumentTravelersError.message ?? "")) {
          console.warn("[booking-detail] flight ticket document travelers unavailable", ticketDocumentTravelersError);
        }
        if (ticketNumbersError && !/booking_flight_traveler_ticket_numbers|schema cache|Could not find the table/i.test(ticketNumbersError.message ?? "")) {
          console.warn("[booking-detail] traveler ticket numbers unavailable", ticketNumbersError);
        }
        if (historyError && !/booking_flight_reservation_history|schema cache|Could not find the table/i.test(historyError.message ?? "")) {
          console.warn("[booking-detail] flight history unavailable", historyError);
        }
        travelerRows = loadedTravelers ?? [];
        ticketDocumentRows = loadedTicketDocuments ?? [];
        ticketDocumentTravelerRows = loadedTicketDocumentTravelers ?? [];
        ticketNumberRows = loadedTicketNumbers ?? [];
        historyRows = loadedHistory ?? [];
      }
      const defaultTravelerIds = flightRow?.id
        ? travelerRows.filter((row) => row.traveler_status !== "cancelled").map((row) => row.participant_id).filter(Boolean)
        : (participantRows ?? []).map((participant: any) => participant.id).filter(Boolean);
      setFlightTravelers(travelerRows);
      setFlightTicketDocuments(ticketDocumentRows);
      setFlightTicketDocumentTravelers(ticketDocumentTravelerRows);
      setFlightTravelerTicketNumbers(ticketNumberRows);
      setFlightTicketTravelerIds(defaultTravelerIds);
      setFlightHistory(historyRows);
      setFlightDraft({
        ...flightDraftFromRow(flightRow),
        traveler_ids: defaultTravelerIds,
      });
    }
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setAgencyOpen(false);
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
    if (!confirm(`Supprimer définitivement la réservation ${b.reference} de ${b.contact_name}, ainsi que ses paiements et extras ?`)) return;
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

  const checkFlightDuplicate = async (draft: typeof emptyFlightDraft) => {
    if (!b?.id) return null;
    const pnr = normalizePnr(draft.pnr);
    if (!pnr) return null;
    const { data, error } = await (supabase as any)
      .from("booking_flight_reservations")
      .select("id,status,pnr,updated_at")
      .eq("booking_id", b.id)
      .eq("pnr_normalized", pnr)
      .neq("status", "cancelled")
      .limit(2);
    if (error) {
      const missingColumn = /pnr_normalized|schema cache|column/i.test(error.message ?? "");
      if (!missingColumn) console.warn("[booking-detail] flight duplicate check failed", error);
      return null;
    }
    const duplicate = (data ?? []).find((row: any) => row.id !== flightReservation?.id);
    if (!duplicate) return null;
    return `Un autre dossier vol actif utilise déjà le PNR ${pnr} pour cette réservation.`;
  };

  const syncFlightTravelerLinks = async (flightId: string, draft: typeof emptyFlightDraft) => {
    const selectedIds = Array.from(new Set(draft.traveler_ids.filter(Boolean)));
    const { data: existingRows, error: existingError } = await (supabase as any)
      .from("booking_flight_travelers")
      .select("*")
      .eq("flight_reservation_id", flightId);
    if (existingError) throw existingError;

    const existing = existingRows ?? [];
    const selectedSet = new Set(selectedIds);
    const toDelete = existing.filter((row: any) => !selectedSet.has(row.participant_id)).map((row: any) => row.id);
    if (toDelete.length > 0) {
      const { error } = await (supabase as any).from("booking_flight_travelers").delete().in("id", toDelete);
      if (error) throw error;
    }

    const existingByParticipant = new Map(existing.map((row: any) => [row.participant_id, row]));
    const rowsToInsert = selectedIds
      .filter((participantId) => !existingByParticipant.has(participantId))
      .map((participantId) => ({
        flight_reservation_id: flightId,
        booking_id: b.id,
        participant_id: participantId,
        e_ticket_number: draft.e_ticket_number.trim() || null,
        traveler_status: draft.ticket_sent_to_customer ? "ticketed" : "linked",
        created_by: user?.id ?? null,
        updated_by: user?.id ?? null,
      }));
    if (rowsToInsert.length > 0) {
      const { error } = await (supabase as any).from("booking_flight_travelers").insert(rowsToInsert);
      if (error) throw error;
    }

    const toUpdate = existing
      .filter((row: any) => selectedSet.has(row.participant_id))
      .map((row: any) => row.id);
    if (toUpdate.length > 0) {
      const travelerPatch: any = {
        traveler_status: draft.ticket_sent_to_customer ? "ticketed" : "linked",
        updated_by: user?.id ?? null,
      };
      if (draft.e_ticket_number.trim()) travelerPatch.e_ticket_number = draft.e_ticket_number.trim();
      const { error } = await (supabase as any)
        .from("booking_flight_travelers")
        .update(travelerPatch)
        .in("id", toUpdate);
      if (error) throw error;
    }
  };

  const saveFlightReservation = async (statusOverride?: "pending_booking" | "reserved" | "partially_ticketed" | "ticketed" | "delivered" | "not_booked" | "booked" | "ticket_sent", overrides: Partial<typeof emptyFlightDraft> = {}) => {
    if (!b?.id) return false;
    const finalStatus = statusOverride ? normalizeFlightWorkflowStatus(statusOverride) : normalizeFlightWorkflowStatus(overrides.status || flightDraft.status);
    const nextDraft = { ...flightDraft, ...overrides, status: finalStatus };
    if (finalStatus === "reserved" || finalStatus === "partially_ticketed" || finalStatus === "ticketed" || finalStatus === "delivered") {
      const missing = missingFlightBookingFields(nextDraft, participants);
      if (missing.length > 0) {
        toast.error(`Impossible de marquer le vol réservé. Champs manquants : ${missing.join(", ")}.`);
        return false;
      }
    }
    if (finalStatus === "delivered") {
      const missing = missingFlightFields(nextDraft, participants);
      if (missing.length > 0) {
        toast.error(`Impossible de marquer les billets envoyés. Champs manquants : ${missing.join(", ")}.`);
        return false;
      }
    }

    setFlightBusy(true);
    try {
      const duplicateWarning = await checkFlightDuplicate(nextDraft);
      setFlightDuplicateWarning(duplicateWarning);
      if (duplicateWarning) {
        toast.error(duplicateWarning);
        return false;
      }

      const requiresTravelerSyncBeforeStatus = ["reserved", "partially_ticketed", "ticketed", "delivered"].includes(finalStatus);
      const saveStatus = requiresTravelerSyncBeforeStatus ? "pending_booking" : finalStatus;
      const fareAmount = nextDraft.fare_amount === "" ? null : Number(nextDraft.fare_amount);
      const fareCurrency = nextDraft.fare_currency.trim().toUpperCase() || "MAD";
      const payload: any = {
        booking_id: b.id,
        status: saveStatus,
        pnr: normalizePnr(nextDraft.pnr) || null,
        booking_platform: nextDraft.booking_platform.trim() || null,
        booking_platform_other: nextDraft.booking_platform === "Autre" ? nextDraft.booking_platform_other.trim() || null : null,
        e_ticket_number: nextDraft.e_ticket_number.trim() || null,
        fare_amount: fareAmount,
        fare_currency: fareCurrency,
        fare_mad: fareCurrency === "MAD" ? fareAmount : nextDraft.fare_mad === "" ? null : Number(nextDraft.fare_mad),
        booking_class: nextDraft.booking_class.trim() || null,
        baggage: nextDraft.baggage.trim() || null,
        airline: nextDraft.airline.trim() || null,
        flight_number: nextDraft.flight_number.trim() || null,
        departure_at: fromDateTimeLocal(nextDraft.departure_at),
        return_at: fromDateTimeLocal(nextDraft.return_at),
        segments: textToSegments(nextDraft.segments_text),
        ticket_document_id: nextDraft.ticket_document_id || null,
        ticket_storage_path: nextDraft.ticket_storage_path || null,
        ticket_sent_to_customer: nextDraft.ticket_sent_to_customer,
        email_sent: nextDraft.email_sent,
        flight_completed_by: saveStatus === "delivered" ? user?.id ?? null : flightReservation?.flight_completed_by ?? null,
        updated_by: user?.id ?? null,
        created_by: flightReservation?.created_by ?? user?.id ?? null,
      };
      const saveQuery = flightReservation?.id
        ? (supabase as any).from("booking_flight_reservations").update(payload).eq("id", flightReservation.id).select("*").single()
        : (supabase as any).from("booking_flight_reservations").insert(payload).select("*").single();
      const { data, error } = await saveQuery;
      if (error) throw error;

      await syncFlightTravelerLinks(data.id, nextDraft);

      let savedRow = data;
      if (saveStatus !== finalStatus) {
        const { data: finalizedRow, error: finalizeError } = await (supabase as any)
          .from("booking_flight_reservations")
          .update({
            status: finalStatus,
            ticket_sent_to_customer: finalStatus === "delivered" ? true : nextDraft.ticket_sent_to_customer,
            email_sent: finalStatus === "delivered" ? true : nextDraft.email_sent,
            flight_completed_by: finalStatus === "delivered" ? user?.id ?? null : flightReservation?.flight_completed_by ?? null,
            updated_by: user?.id ?? null,
          })
          .eq("id", data.id)
          .select("*")
          .single();
        if (finalizeError) throw finalizeError;
        savedRow = finalizedRow;
      }

      setFlightReservation(savedRow);
      setFlightDraft({ ...flightDraftFromRow(savedRow), traveler_ids: nextDraft.traveler_ids });
      setFlightEditMode(false);
      setFlightDraftBeforeEdit(null);
      toast.success(finalStatus === "delivered" ? "Billets marqués comme envoyés." : finalStatus === "reserved" ? "Vol réservé enregistré." : "Informations vol enregistrées.");
      load();
      return true;
    } catch (error: any) {
      const missingTable = /booking_flight_reservations|schema cache|Could not find the table/i.test(error?.message ?? "");
      toast.error(missingTable ? "Migration Flight Reservation Workflow requise avant d’enregistrer les vols." : error?.message ?? "Enregistrement vol impossible.");
      return false;
    } finally {
      setFlightBusy(false);
    }
  };

  const sendFlightReminderNow = async () => {
    if (!b?.id) return;
    setFlightBusy(true);
    try {
      const { data, error } = await (supabase as any).rpc("remind_flight_tasks_for_booking", { p_booking_id: b.id });
      if (error) throw error;
      toast.success(Number(data || 0) > 0 ? "Relance opération créée." : "Aucune tâche vol active à relancer.");
    } catch (error: any) {
      toast.error(error?.message ?? "Relance impossible.");
    } finally {
      setFlightBusy(false);
    }
  };

  const uploadFlightTicket = async () => {
    if (!b?.id) return toast.error("Réservation introuvable.");
    if (!flightTicketFile) return toast.error("Choisissez le PDF du billet.");
    if (flightTicketFile.type && flightTicketFile.type !== "application/pdf") return toast.error("Le billet doit être un PDF.");
    if (!flightReservation?.id) return toast.error("Enregistrez d’abord le vol réservé avant d’ajouter un billet.");
    const associatedTravelerIds = Array.from(new Set(flightTicketTravelerIds.filter(Boolean)));
    if (associatedTravelerIds.length === 0) return toast.error("Associez ce billet à au moins un voyageur.");
    setFlightBusy(true);
    try {
      const safeName = flightTicketFile.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9.]+/g, "-");
      const path = `${b.id}/flight-tickets/${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from("booking-docs").upload(path, flightTicketFile, {
        upsert: false,
        contentType: "application/pdf",
      });
      if (uploadError) throw uploadError;
      const { data: insertedDoc, error: docError } = await (supabase as any)
        .from("booking_documents")
        .insert({
          booking_id: b.id,
          kind: "billet_avion",
          document_type: "flight_ticket",
          title: `Billet avion - ${b.reference}`,
          file_name: flightTicketFile.name,
          notes: "Billet avion lié au workflow réservation vol.",
          visible_to_client: true,
          visibility_scope: "booking_participants",
          client_visible_at: new Date().toISOString(),
          number: `FLT-${b.reference}`,
          storage_path: path,
          created_by: user?.id ?? null,
          uploaded_by: user?.id ?? null,
        })
        .select("id, storage_path")
        .single();
      if (docError) throw docError;
      const { data: ticketDocument, error: ticketDocumentError } = await (supabase as any)
        .from("booking_flight_ticket_documents")
        .insert({
          flight_reservation_id: flightReservation.id,
          booking_id: b.id,
          booking_document_id: insertedDoc?.id ?? null,
          storage_path: insertedDoc?.storage_path || path,
          file_name: flightTicketFile.name,
          mime_type: flightTicketFile.type || "application/pdf",
          size_bytes: flightTicketFile.size,
          source: "manual_upload",
          created_by: user?.id ?? null,
          updated_by: user?.id ?? null,
        })
        .select("*")
        .single();
      if (ticketDocumentError) throw ticketDocumentError;

      const replacingDoc = flightTicketReplacingDocId
        ? flightTicketDocuments.find((doc) => doc.id === flightTicketReplacingDocId)
        : null;
      if (replacingDoc) {
        const { error: replaceError } = await (supabase as any)
          .from("booking_flight_ticket_documents")
          .update({
            deleted_at: new Date().toISOString(),
            replaced_by_id: ticketDocument.id,
            updated_by: user?.id ?? null,
          })
          .eq("id", replacingDoc.id)
          .is("deleted_at", null);
        if (replaceError) throw replaceError;

        if (replacingDoc.booking_document_id) {
          const { error: hideOldDocError } = await (supabase as any)
            .from("booking_documents")
            .update({ visible_to_client: false, client_visible_at: null })
            .eq("id", replacingDoc.booking_document_id);
          if (hideOldDocError) throw hideOldDocError;
        }
      }

      const travelerRows = associatedTravelerIds.map((participantId) => ({
        flight_ticket_document_id: ticketDocument.id,
        flight_reservation_id: flightReservation.id,
        booking_id: b.id,
        participant_id: participantId,
        created_by: user?.id ?? null,
      }));
      const { error: travelerDocError } = await (supabase as any)
        .from("booking_flight_ticket_document_travelers")
        .insert(travelerRows);
      if (travelerDocError) throw travelerDocError;

      const legacyPatch: any = {};
      if (!flightDraft.ticket_document_id || replacingDoc?.booking_document_id === flightDraft.ticket_document_id) {
        legacyPatch.ticket_document_id = insertedDoc?.id ?? null;
      }
      if (!flightDraft.ticket_storage_path || replacingDoc?.storage_path === flightDraft.ticket_storage_path) {
        legacyPatch.ticket_storage_path = insertedDoc?.storage_path || path;
      }
      if (Object.keys(legacyPatch).length > 0) {
        const { error: legacyError } = await (supabase as any)
          .from("booking_flight_reservations")
          .update({ ...legacyPatch, updated_by: user?.id ?? null })
          .eq("id", flightReservation.id);
        if (legacyError) throw legacyError;
      }
      await (supabase as any).rpc("recalculate_booking_flight_status", { p_flight_reservation_id: flightReservation.id });
      setFlightTicketFile(null);
      setFlightTicketReplacingDocId(null);
      toast.success(replacingDoc ? "Billet PDF remplacé." : "Billet PDF ajouté.");
      load();
    } catch (error: any) {
      const missingTable = /booking_flight_ticket_documents|booking_flight_ticket_document_travelers|schema cache|Could not find the table/i.test(error?.message ?? "");
      toast.error(missingTable ? "Migration Flight Booking V2 requise pour associer plusieurs billets aux voyageurs." : error?.message ?? "Upload du billet impossible.");
    } finally {
      setFlightBusy(false);
    }
  };

  const openFlightTicket = async (storagePath?: string | null) => {
    const path = storagePath
      || flightDraft.ticket_storage_path
      || docs.find((doc) => ["flight_ticket", "billet_avion"].includes(doc.kind || doc.document_type))?.storage_path;
    if (!path) return toast.error("Aucun billet PDF lié.");
    const { data, error } = await supabase.storage.from("booking-docs").createSignedUrl(path, 60);
    if (error || !data) return toast.error("Lien billet indisponible.");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const startReplaceFlightTicket = (doc: any) => {
    if (flightInputDisabled) return;
    setFlightTicketReplacingDocId(doc.id);
    setFlightTicketTravelerIds(doc.participant_ids ?? []);
    setFlightTicketFile(null);
    toast.info("Choisissez le nouveau PDF, puis cliquez sur Remplacer billet.");
  };

  const deleteFlightTicketDocument = async (doc: any) => {
    if (!canEdit) return toast.error("Modification non autorisée.");
    if (!confirm(`Supprimer l’association du billet "${doc.file_name}" ? Le fichier historique ne sera pas effacé du Storage.`)) return;
    setFlightBusy(true);
    try {
      const { error } = await (supabase as any)
        .from("booking_flight_ticket_documents")
        .update({
          deleted_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        })
        .eq("id", doc.id)
        .is("deleted_at", null);
      if (error) throw error;

      if (doc.booking_document_id) {
        const { error: hideDocError } = await (supabase as any)
          .from("booking_documents")
          .update({ visible_to_client: false, client_visible_at: null })
          .eq("id", doc.booking_document_id);
        if (hideDocError) throw hideDocError;
      }

      if (flightReservation?.id && (doc.booking_document_id === flightDraft.ticket_document_id || doc.storage_path === flightDraft.ticket_storage_path)) {
        const { error: legacyError } = await (supabase as any)
          .from("booking_flight_reservations")
          .update({ ticket_document_id: null, ticket_storage_path: null, updated_by: user?.id ?? null })
          .eq("id", flightReservation.id);
        if (legacyError) throw legacyError;
      }

      await (supabase as any).rpc("recalculate_booking_flight_status", { p_flight_reservation_id: flightReservation.id });
      if (flightTicketReplacingDocId === doc.id) setFlightTicketReplacingDocId(null);
      toast.success("Billet retiré. Aucun montant de réservation n’a été modifié.");
      load();
    } catch (error: any) {
      toast.error(error?.message ?? "Suppression du billet impossible.");
    } finally {
      setFlightBusy(false);
    }
  };

  const markFlightTicketSent = async () => {
    await saveFlightReservation("delivered", {
      ticket_sent_to_customer: true,
      email_sent: true,
    });
  };

  const addTravelerTicketNumber = async (participantId: string) => {
    if (!b?.id || !flightReservation?.id) return toast.error("Enregistrez d’abord le vol réservé.");
    const values = (ticketNumberDrafts[participantId] || "")
      .split(/[,\n;]+/)
      .map((value) => value.replace(/\s+/g, "").trim())
      .filter(Boolean);
    if (values.length === 0) return toast.error("Numéro e-ticket manquant.");
    const travelerRow = flightTravelers.find((row) => row.participant_id === participantId);
    if (!travelerRow) return toast.error("Ce voyageur doit d’abord être associé au PNR.");
    setFlightBusy(true);
    try {
      const { error } = await (supabase as any)
        .from("booking_flight_traveler_ticket_numbers")
        .insert(values.map((value) => ({
          flight_traveler_id: travelerRow.id,
          flight_reservation_id: flightReservation.id,
          booking_id: b.id,
          participant_id: participantId,
          e_ticket_number: value,
          created_by: user?.id ?? null,
          updated_by: user?.id ?? null,
        })));
      if (error) throw error;
      setTicketNumberDrafts((current) => ({ ...current, [participantId]: "" }));
      await (supabase as any).rpc("recalculate_booking_flight_status", { p_flight_reservation_id: flightReservation.id });
      toast.success(values.length > 1 ? "Numéros e-ticket ajoutés." : "Numéro e-ticket ajouté.");
      load();
    } catch (error: any) {
      const duplicate = error?.code === "23505";
      toast.error(duplicate ? "Ce numéro e-ticket existe déjà pour ce voyageur." : error?.message ?? "Impossible d’ajouter le numéro e-ticket.");
    } finally {
      setFlightBusy(false);
    }
  };

  const analyzeFlightTicketPdf = async () => {
    if (!flightTicketFile) return toast.error("Choisissez d’abord un PDF.");
    setFlightBusy(true);
    try {
      const extraction = await extractFlightTicketText(flightTicketFile);
      if (extraction.status !== "ready") {
        toast.error(extraction.warning ?? "Import automatique indisponible pour ce PDF.");
        return;
      }
      const parsed = parseFlightTicketText(extraction.text);
      setFlightImportPreview(parsed);
      setFlightImportDialogOpen(true);
    } catch (error: any) {
      toast.error(error?.message ?? "Impossible d’analyser le PDF.");
    } finally {
      setFlightBusy(false);
    }
  };

  const applyFlightImportPreview = async () => {
    if (!flightImportPreview) return;
    const detectedSegments = flightImportPreview.segments.length > 0
      ? flightImportPreview.segments.map((segment) => `${segment.from} → ${segment.to}${segment.flight_number ? ` · ${segment.flight_number}` : ""}`).join("\n")
      : flightImportPreview.flightNumbers.join("\n");
    setFlightDraft((current) => ({
      ...current,
      pnr: flightImportPreview.pnr || current.pnr,
      booking_platform: flightImportPreview.platform || current.booking_platform,
      airline: flightImportPreview.airline || current.airline,
      booking_class: flightImportPreview.bookingClass || current.booking_class,
      flight_number: flightImportPreview.flightNumbers.join(" / ") || current.flight_number,
      segments_text: detectedSegments || current.segments_text,
    }));

    const nextTicketDrafts: Record<string, string> = {};
    flightImportPreview.travelers.forEach((traveler) => {
      const detectedName = normalizePersonName(traveler.rawName);
      const match = participants.find((participant) => {
        const currentName = normalizePersonName(participantName(participant));
        return currentName === detectedName || currentName.replace(/\s+/g, "") === detectedName.replace(/\s+/g, "");
      });
      if (match && traveler.ticketNumbers.length > 0) {
        nextTicketDrafts[match.id] = traveler.ticketNumbers.join(", ");
      }
    });
    setTicketNumberDrafts((current) => ({ ...current, ...nextTicketDrafts }));
    setFlightImportDialogOpen(false);
    toast.success("Informations détectées préparées. Vérifiez puis enregistrez.");
  };

  const startFlightEdit = () => {
    if (!canEdit) return;
    if (!confirm("Modifier les informations du vol peut affecter les documents visa et les tâches opérationnelles. Continuer ?")) return;
    setFlightDraftBeforeEdit(flightDraft);
    setFlightEditMode(true);
  };

  const cancelFlightEdit = () => {
    if (flightDraftBeforeEdit) setFlightDraft(flightDraftBeforeEdit);
    setFlightTicketFile(null);
    setFlightDuplicateWarning(null);
    setFlightDraftBeforeEdit(null);
    setFlightEditMode(false);
  };

  const clientPortalInvitationMailto = () => {
    if (!b?.contact_email) return toast.error("Email client absent.");
    const loginUrl = "https://www.lejapon.ma/espace-voyage/login";
    const subject = `Votre espace voyage LeJapon.ma est prêt`;
    const body = [
      `Bonjour ${(b.contact_name || "").split(/\s+/)[0] || ""},`,
      "",
      `Votre espace voyage LeJapon.ma est prêt pour la réservation ${b.reference}.`,
      b.trips?.title ? `Voyage : ${b.trips.title}` : "",
      "",
      `Connectez-vous ici : ${loginUrl}`,
      "Utilisez l’email de votre réservation pour vous connecter.",
      "Si vous n’avez pas encore de mot de passe, cliquez sur “Créer mon mot de passe”.",
      "Si vous avez déjà un compte, ce même bouton permet de récupérer votre mot de passe.",
      "",
      "Vous y retrouverez votre réservation, vos documents, votre accord de voyage, votre visa et vos prochaines étapes.",
      "",
      "L'équipe LeJapon.ma",
    ].filter(Boolean).join("\n");
    window.location.href = `mailto:${encodeURIComponent(b.contact_email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const sendClientPortalAccess = async () => {
    if (!b?.id) return toast.error("Réservation introuvable.");
    if (!b?.contact_email) return toast.error("Email client absent.");
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-admin-notification", {
        body: {
          type: "client_portal_invitation",
          payload: { booking_id: b.id },
        },
      });
      if (error) throw error;
      if (data?.ok === false) {
        throw new Error(data.detail || data.error || "Envoi email impossible.");
      }
      toast.success("Accès client envoyé par email.");
    } catch (error: any) {
      toast.error(`Email automatique indisponible. Ouverture du fallback mailto. ${error?.message ? `Détail : ${error.message}` : ""}`);
      clientPortalInvitationMailto();
    } finally {
      setBusy(false);
    }
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
        visible_to_client: docDraft.visible_to_client,
        visibility_scope: defaultVisibilityScopeForDocument(docDraft.type, docDraft.title) === "booking_owner_only"
          ? "booking_owner_only"
          : docDraft.visibility_scope,
        client_visible_at: docDraft.visible_to_client ? new Date().toISOString() : null,
        number: docDraft.title || file.name,
        storage_path: path,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
      setDocDraft({ type: "autre", title: "", notes: "", visible_to_client: false, visibility_scope: "booking_participants", file: null });
      toast.success("Document ajouté.");
      load();
    } catch (error: any) {
      const missingVisibility = /visible_to_client|client_visible_at|visibility_scope|schema cache|column/i.test(error?.message ?? "");
      toast.error(missingVisibility ? "Colonne visible_to_client manquante. Appliquez la migration Client Portal V1." : error?.message ?? "Upload impossible.");
    } finally {
      setBusy(false);
    }
  };

  const toggleClientDocumentVisibility = async (doc: any, visible: boolean) => {
    const { error } = await (supabase as any)
      .from("booking_documents")
      .update({
        visible_to_client: visible,
        visibility_scope: defaultVisibilityScopeForDocument(doc.kind || doc.document_type, doc.title) === "booking_owner_only"
          ? "booking_owner_only"
          : (doc.visibility_scope || "booking_participants"),
        client_visible_at: visible ? new Date().toISOString() : null,
      })
      .eq("id", doc.id);
    if (error) {
      const missingVisibility = /visible_to_client|client_visible_at|visibility_scope|schema cache|column/i.test(error.message ?? "");
      toast.error(missingVisibility ? "Colonne visible_to_client manquante. Appliquez la migration Client Portal V1." : error.message);
      return;
    }
    toast.success(visible ? "Document publié dans l’espace client." : "Document masqué de l’espace client.");
    load();
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
  const adjustmentPreviewValue = Number(adjustmentDraft.amount || 0);
  const adjustmentPreviewRows = quoteAdjustments.filter((adjustment) => adjustment.id !== editingAdjustmentId);
  if (Number.isFinite(adjustmentPreviewValue) && adjustmentPreviewValue > 0) {
    adjustmentPreviewRows.push({
      id: "preview",
      label: adjustmentDraft.label || "Ajustement",
      type: adjustmentDraft.type,
      calculation_type: adjustmentDraft.calculation_type,
      amount: adjustmentPreviewValue,
      visible_on_quote: adjustmentDraft.visible_on_quote,
    });
  }
  const adjustmentPreviewTotal = summarizeQuoteAdjustments(adjustmentPreviewRows, Number(b.total_amount_mad || 0)).finalTotal;
  const paidPercent = displayedQuoteTotal > 0
    ? Math.min(100, Math.round((Number(b.paid_amount_mad || 0) / displayedQuoteTotal) * 100))
    : 0;
  const longMessage = String(b.message || "");
  const visibleMessage = !messageExpanded && longMessage.length > 150 ? `${longMessage.slice(0, 150)}…` : longMessage;
  const flightTicketDocumentsWithTravelers = flightTicketDocuments.map((doc) => ({
    ...doc,
    participant_ids: flightTicketDocumentTravelers
      .filter((row) => row.flight_ticket_document_id === doc.id)
      .map((row) => row.participant_id)
      .filter(Boolean),
  }));
  const flightEvidenceContext = {
    ...flightReservation,
    ...flightDraft,
    status: flightDraft.status,
    linked_traveler_count: flightDraft.traveler_ids.length,
    associated_ticket_document_count: flightTicketDocuments.length,
  };
  const flightStatus = getFlightTicketStatus(flightEvidenceContext);
  const selectedFlightTravelerSet = new Set(flightDraft.traveler_ids);
  const selectedFlightTravelers = flightTravelers.filter((row) => selectedFlightTravelerSet.has(row.participant_id));
  const selectedTravelersMissingTickets = flightDraft.traveler_ids.filter((participantId) => {
    const travelerRow = selectedFlightTravelers.find((row) => row.participant_id === participantId);
    const hasLegacyTicket = Boolean(String(travelerRow?.e_ticket_number ?? flightDraft.e_ticket_number ?? "").trim());
    const hasTicketNumber = flightTravelerTicketNumbers.some((row) => row.participant_id === participantId && String(row.e_ticket_number ?? "").trim());
    const hasDocument = flightTicketDocumentsWithTravelers.some((doc) => doc.participant_ids.includes(participantId));
    return !hasLegacyTicket && !hasTicketNumber && !hasDocument;
  });
  const flightMissingForBookedAction = missingFlightBookingFields(flightDraft, participants);
  const flightMissing = flightMissingForBookedAction;
  const flightMissingForFinalAction = [
    ...missingFlightFields({ ...flightDraft, ticket_sent_to_customer: true }, participants),
    ...selectedTravelersMissingTickets.map((participantId) => `Billet de ${participantName(participants.find((participant) => participant.id === participantId))}`),
  ];
  const flightIsFinalized = ["reserved", "partially_ticketed", "ticketed", "delivered"].includes(flightStatus);
  const flightFieldsReadOnly = flightStatus === "delivered" && !flightEditMode;
  const flightInputDisabled = flightBusy || !canEdit || flightFieldsReadOnly;

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
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-xs text-muted-foreground">{b.reference}</p>
            <StatusBadge value={b.status} />
            {(taskSummary.overdue > 0 || taskSummary.critical > 0) && (
              <button type="button" onClick={() => setTasksOpen(true)} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 text-xs font-semibold text-red-800">
                <AlertTriangle className="h-3.5 w-3.5" />
                {taskSummary.overdue > 0 ? `${taskSummary.overdue} en retard` : `${taskSummary.critical} critique`}
              </button>
            )}
          </div>
          <h1 className="mt-1 font-display text-2xl leading-tight sm:text-3xl">{b.contact_name}</h1>
          <p className="mt-1 text-sm font-medium">{b.trips?.title ?? "Voyage non défini"}</p>
          <p className="truncate text-sm text-muted-foreground">{b.contact_email} · {b.contact_phone || "—"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {b.trip_id && <Button asChild variant="outline" className="min-h-11"><Link to={tripWorkspacePath(b.trip_id, "reservations")}>Voir le voyage</Link></Button>}
          <Select value={b.status} onValueChange={updateStatus}>
            <SelectTrigger className="min-h-11 w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="lead">Lead</SelectItem><SelectItem value="confirmed">Confirmé</SelectItem><SelectItem value="paid">Payé</SelectItem><SelectItem value="cancelled">Annulé</SelectItem><SelectItem value="completed">Terminé</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>

      <Card className="overflow-hidden rounded-2xl border-border shadow-sm">
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
            <div className="col-span-2 rounded-xl bg-muted/50 p-3 sm:col-span-1"><CalendarDays className="mb-2 h-4 w-4 text-muted-foreground" /><p className="text-xs text-muted-foreground">Dates</p><p className="font-medium">{b.trips?.start_date || "—"}<br />{b.trips?.end_date || b.preferred_dates || "—"}</p></div>
            <div className="rounded-xl bg-muted/50 p-3"><Users className="mb-2 h-4 w-4 text-muted-foreground" /><p className="text-xs text-muted-foreground">PAX</p><p className="font-semibold">{totalTravelers}</p></div>
            <div className="rounded-xl bg-muted/50 p-3"><Hotel className="mb-2 h-4 w-4 text-muted-foreground" /><p className="text-xs text-muted-foreground">Hébergement</p><p className="font-medium">{publicHotelLabel(b.formula)}</p></div>
            <div className="rounded-xl bg-muted/50 p-3"><BedDouble className="mb-2 h-4 w-4 text-muted-foreground" /><p className="text-xs text-muted-foreground">Chambre</p><p className="font-semibold">{publicRoomLabel(b.room_type)}</p></div>
            <div className="rounded-xl bg-muted/50 p-3"><FileText className="mb-2 h-4 w-4 text-muted-foreground" /><p className="text-xs text-muted-foreground">Extras</p><p className="font-semibold">{extras.length}</p></div>
          </div>
          {extras.length > 0 && <div className="flex flex-wrap gap-2">{extras.slice(0, 6).map((extra) => <span key={extra.id} className="rounded-full bg-secondary px-2.5 py-1 text-xs">{extra.name_snapshot} × {extra.qty}</span>)}</div>}
          <div className="grid grid-cols-3 gap-2 rounded-2xl border border-accent/20 bg-accent/5 p-3 text-sm">
            <div><p className="text-xs text-muted-foreground">Total</p><p className="font-display text-base sm:text-lg">{fmtMAD(displayedQuoteTotal)}</p></div>
            <div><p className="text-xs text-muted-foreground">Payé</p><p className="font-display text-base text-emerald-700 sm:text-lg">{fmtMAD(b.paid_amount_mad)}</p></div>
            <div><p className="text-xs text-muted-foreground">Reste</p><p className="font-display text-base text-orange-700 sm:text-lg">{fmtMAD(remainingAmount)}</p></div>
            <div className="col-span-3 h-2 overflow-hidden rounded-full bg-background"><div className="h-full rounded-full bg-accent" style={{ width: `${paidPercent}%` }} /></div>
          </div>
        </CardContent>
      </Card>

      <div className="sticky bottom-2 z-20 grid grid-cols-2 gap-2 rounded-2xl border border-border bg-background/95 p-2 shadow-lg backdrop-blur sm:grid-cols-5 lg:static lg:shadow-sm">
        <Button variant="outline" className="min-h-11" onClick={() => setEditing(true)} disabled={!canEdit}><Pencil className="h-4 w-4" /> Modifier</Button>
        <Button className="min-h-11 bg-emerald-700 hover:bg-emerald-800" onClick={() => setPaymentDialogOpen(true)} disabled={!canEdit}><CreditCard className="h-4 w-4" /> Ajouter paiement</Button>
        <Button className="min-h-11 border-orange-200 bg-orange-50 text-orange-900 hover:bg-orange-100" variant="outline" onClick={() => setAdjustmentsOpen(true)}><SlidersHorizontal className="h-4 w-4" /> Ajuster devis</Button>
        <Button variant="outline" className="min-h-11 border-blue-200 bg-blue-50 text-blue-900 hover:bg-blue-100" onClick={() => setFlightOpen(true)}><Plane className="h-4 w-4" /> Vol</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" className="col-span-2 min-h-11 sm:col-span-1"><MoreHorizontal className="h-4 w-4" /> Plus</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem className="min-h-11" onClick={() => setTasksOpen(true)}><ListChecks className="mr-2 h-4 w-4" /> Tâches {taskSummary.total ? `(${taskSummary.total})` : ""}</DropdownMenuItem>
            <DropdownMenuItem className="min-h-11" onClick={() => setPaymentsOpen(true)}><CreditCard className="mr-2 h-4 w-4" /> Historique paiements</DropdownMenuItem>
            <DropdownMenuItem className="min-h-11" onClick={() => setAgencyOpen(true)}><Building2 className="mr-2 h-4 w-4" /> Attribuer agence</DropdownMenuItem>
            <DropdownMenuItem className="min-h-11" onClick={() => setDocumentsOpen(true)}><FolderOpen className="mr-2 h-4 w-4" /> Documents</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="min-h-11 text-destructive focus:text-destructive" onClick={deleteBooking}><Trash2 className="mr-2 h-4 w-4" /> Supprimer réservation</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid gap-5 lg:grid-cols-3 lg:gap-6">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <details className="group order-2 rounded-2xl border border-border bg-background shadow-sm">
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

          <Sheet open={tasksOpen} onOpenChange={(open) => { setTasksOpen(open); if (!open) void load(); }}>
            <SheetContent className="w-full max-w-none p-0 sm:w-[min(760px,94vw)] sm:max-w-none">
              <SheetHeader className="border-b px-4 py-4 pr-12 sm:px-6">
                <SheetTitle>Tâches · {b.reference}</SheetTitle>
                <SheetDescription>Checklist opérationnelle de la réservation.</SheetDescription>
              </SheetHeader>
              <div className="p-3 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:p-6">
                <OperationChecklistPanel
                  title="Checklist opérationnelle réservation"
                  description="Passeport, visa, assurance, vols, hôtels, transferts et documents finaux."
                  bookingId={b.id}
                  tripId={b.trip_id}
                  customerId={b.client_id}
                  compact
                />
              </div>
            </SheetContent>
          </Sheet>

          <Sheet open={paymentsOpen} onOpenChange={setPaymentsOpen}>
            <SheetContent className="w-full max-w-none p-0 sm:w-[min(680px,92vw)] sm:max-w-none">
              <SheetHeader className="border-b px-4 py-4 pr-12 sm:px-6">
                <SheetTitle>Paiements · {b.reference}</SheetTitle>
                <SheetDescription>{fmtMAD(b.paid_amount_mad)} encaissé sur {fmtMAD(displayedQuoteTotal)}.</SheetDescription>
              </SheetHeader>
              <div className="p-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:p-6">
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
              </div>
            </SheetContent>
          </Sheet>

          <Sheet open={flightOpen} onOpenChange={setFlightOpen}>
            <SheetContent className="w-full max-w-none p-0 sm:w-[min(920px,96vw)] sm:max-w-none">
              <SheetHeader className="border-b px-4 py-4 pr-12 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <SheetTitle className="flex items-center gap-2"><Plane className="h-4 w-4 text-accent" /> Vol · {b.reference}</SheetTitle>
                <span className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-xs font-semibold ${FLIGHT_STATUS_CLASSES[flightStatus] ?? FLIGHT_STATUS_CLASSES.not_booked}`}>
                  {FLIGHT_STATUS_LABELS[flightStatus] ?? "Non réservé"}
                </span>
              </div>
                <SheetDescription>Enregistrez un brouillon incomplet ou confirmez le vol avec les informations essentielles.</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 p-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:p-6">
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-relaxed text-blue-950">
                Enregistrez le vol dès que le PNR est réservé. Les numéros e-ticket, les PDF, les segments, les bagages et les détails de vol peuvent être complétés ensuite ou importés depuis le billet.
              </div>
              {flightDuplicateWarning && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-900">
                  {flightDuplicateWarning}
                </div>
              )}

              <div className="rounded-xl border border-border p-3">
                <p className="mb-3 text-sm font-semibold">Informations essentielles</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <Label className="text-xs">Plateforme</Label>
                    <Select
                      value={flightDraft.booking_platform}
                      onValueChange={(value) => setFlightDraft((current) => ({ ...current, booking_platform: value }))}
                      disabled={flightInputDisabled}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="APG">APG</SelectItem>
                        <SelectItem value="Amadeus">Amadeus</SelectItem>
                        <SelectItem value="TopTravel">TopTravel</SelectItem>
                        <SelectItem value="Autre">Autre</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {flightDraft.booking_platform === "Autre" && (
                    <div>
                      <Label className="text-xs">Nom de la plateforme</Label>
                      <Input value={flightDraft.booking_platform_other} onChange={(event) => setFlightDraft((current) => ({ ...current, booking_platform_other: event.target.value }))} disabled={flightInputDisabled} />
                    </div>
                  )}
                  <div>
                    <Label className="text-xs">PNR</Label>
                    <Input value={flightDraft.pnr} onChange={(event) => {
                      setFlightDuplicateWarning(null);
                      setFlightDraft((current) => ({ ...current, pnr: normalizePnr(event.target.value) }));
                    }} placeholder="Ex: SVXYZA" disabled={flightInputDisabled} />
                  </div>
                  <div>
                    <Label className="text-xs">Prix total</Label>
                    <Input type="number" inputMode="decimal" value={flightDraft.fare_amount} onChange={(event) => setFlightDraft((current) => ({ ...current, fare_amount: event.target.value, fare_mad: current.fare_currency === "MAD" ? event.target.value : current.fare_mad }))} disabled={flightInputDisabled} />
                  </div>
                  <div>
                    <Label className="text-xs">Devise</Label>
                    <Input value={flightDraft.fare_currency} onChange={(event) => setFlightDraft((current) => ({ ...current, fare_currency: event.target.value.toUpperCase() }))} placeholder="MAD" disabled={flightInputDisabled} />
                  </div>
                </div>
              </div>

              <details className="rounded-xl border border-border p-3">
                <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold">
                  Détails avancés
                  <ChevronDown className="h-4 w-4" />
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-border bg-muted/30 p-2 text-xs text-muted-foreground sm:col-span-2">
                    Vous pouvez compléter ces informations manuellement ou les importer depuis le billet PDF.
                  </div>
                <div>
                  <Label className="text-xs">N° e-ticket global hérité</Label>
                  <Input value={flightDraft.e_ticket_number} onChange={(event) => setFlightDraft((current) => ({ ...current, e_ticket_number: event.target.value }))} disabled={flightInputDisabled} />
                </div>
                <div>
                  <Label className="text-xs">Compagnie aérienne</Label>
                  <Input value={flightDraft.airline} onChange={(event) => setFlightDraft((current) => ({ ...current, airline: event.target.value }))} placeholder="Ex: Emirates" disabled={flightInputDisabled} />
                </div>
                <div>
                  <Label className="text-xs">Numéro de vol principal</Label>
                  <Input value={flightDraft.flight_number} onChange={(event) => setFlightDraft((current) => ({ ...current, flight_number: event.target.value }))} placeholder="Ex: EK752 / EK312" disabled={flightInputDisabled} />
                </div>
                <div>
                  <Label className="text-xs">Départ</Label>
                  <Input type="datetime-local" value={flightDraft.departure_at} onChange={(event) => setFlightDraft((current) => ({ ...current, departure_at: event.target.value }))} disabled={flightInputDisabled} />
                </div>
                <div>
                  <Label className="text-xs">Retour</Label>
                  <Input type="datetime-local" value={flightDraft.return_at} onChange={(event) => setFlightDraft((current) => ({ ...current, return_at: event.target.value }))} disabled={flightInputDisabled} />
                </div>
                <div>
                  <Label className="text-xs">Classe de réservation</Label>
                  <Input value={flightDraft.booking_class} onChange={(event) => setFlightDraft((current) => ({ ...current, booking_class: event.target.value }))} placeholder="Ex: Economy / V" disabled={flightInputDisabled} />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs">Bagages</Label>
                  <Input value={flightDraft.baggage} onChange={(event) => setFlightDraft((current) => ({ ...current, baggage: event.target.value }))} placeholder="Ex: 2 bagages de 23 kg" disabled={flightInputDisabled} />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs">Segments</Label>
                  <Textarea
                    rows={4}
                    value={flightDraft.segments_text}
                    onChange={(event) => setFlightDraft((current) => ({ ...current, segments_text: event.target.value }))}
                    placeholder={"Un segment par ligne, ex:\nCMN → DXB · EK752 · 10/08 14:45\nDXB → HND · EK312 · 11/08 08:30"}
                    disabled={flightInputDisabled}
                  />
                </div>
                </div>
              </details>

              <div className="rounded-xl border border-border p-3">
                <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold">Voyageurs couverts par ce PNR</p>
                    <p className="text-xs text-muted-foreground">Au moins un voyageur est nécessaire pour enregistrer le vol réservé. Les billets sont ensuite associés par voyageur.</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const ids = participants.map((participant) => participant.id).filter(Boolean);
                      setFlightDraft((current) => ({ ...current, traveler_ids: ids }));
                      setFlightTicketTravelerIds(ids);
                    }}
                    disabled={participants.length === 0 || flightInputDisabled}
                  >
                    Tout sélectionner
                  </Button>
                </div>
                {participants.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Aucun participant n’est renseigné sur cette réservation.</p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {participants.map((participant) => {
                      const name = participantName(participant);
                      const checked = selectedFlightTravelerSet.has(participant.id);
                      const travelerRow = flightTravelers.find((row) => row.participant_id === participant.id);
                      const numbers = [
                        travelerRow?.e_ticket_number,
                        ...flightTravelerTicketNumbers.filter((row) => row.participant_id === participant.id).map((row) => row.e_ticket_number),
                      ].filter(Boolean);
                      const linkedDocs = flightTicketDocumentsWithTravelers.filter((doc) => doc.participant_ids.includes(participant.id));
                      const travelerStatus = checked
                        ? numbers.length > 0 || linkedDocs.length > 0
                          ? "Billet renseigné"
                          : "Billet manquant"
                        : "Non associé au PNR";
                      return (
                        <div key={participant.id} className="rounded-lg border border-border p-2 text-sm">
                          <label className="flex items-start gap-2">
                            <Checkbox
                              checked={checked}
                              disabled={flightInputDisabled}
                              onCheckedChange={(value) => {
                                setFlightDraft((current) => {
                                  const currentIds = new Set(current.traveler_ids);
                                  if (value === true) currentIds.add(participant.id);
                                  else currentIds.delete(participant.id);
                                  return { ...current, traveler_ids: Array.from(currentIds) };
                                });
                                setFlightTicketTravelerIds((current) => {
                                  const next = new Set(current);
                                  if (value === true) next.add(participant.id);
                                  else next.delete(participant.id);
                                  return Array.from(next);
                                });
                              }}
                            />
                            <span>
                              <span className="block font-medium">{name}</span>
                              <span className="block text-xs text-muted-foreground">
                                {[participant.client_type, participant.passport_no, travelerStatus].filter(Boolean).join(" · ") || "Participant"}
                              </span>
                            </span>
                          </label>
                          {checked && (
                            <div className="mt-2 space-y-2 pl-6">
                              {numbers.length > 0 && (
                                <p className="text-xs text-emerald-700">E-ticket : {numbers.join(" · ")}</p>
                              )}
                              {linkedDocs.length > 0 && (
                                <p className="text-xs text-blue-700">PDF associé : {linkedDocs.map((doc) => doc.file_name).join(" · ")}</p>
                              )}
                              <div className="flex flex-col gap-2 sm:flex-row">
                                <Input
                                  value={ticketNumberDrafts[participant.id] || ""}
                                  onChange={(event) => setTicketNumberDrafts((current) => ({ ...current, [participant.id]: event.target.value }))}
                                  placeholder="Ajouter un ou plusieurs e-tickets"
                                  disabled={flightInputDisabled || !flightReservation?.id}
                                  className="h-9 text-xs"
                                />
                                <Button type="button" size="sm" variant="outline" onClick={() => addTravelerTicketNumber(participant.id)} disabled={flightBusy || flightInputDisabled || !ticketNumberDrafts[participant.id]?.trim()}>
                                  Ajouter
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <details className="group rounded-xl border border-border bg-muted/30 p-3">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold">
                  Billets PDF et import avancé
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                </summary>
                <p className="mb-3 text-xs text-muted-foreground">Facultatif. Un fichier peut être associé à un ou plusieurs voyageurs, et l’original reste inchangé.</p>
                {flightTicketDocumentsWithTravelers.length > 0 && (
                  <div className="mb-3 space-y-2">
                    {flightTicketDocumentsWithTravelers.map((doc) => {
                      const names = doc.participant_ids
                        .map((participantId: string) => participantName(participants.find((participant) => participant.id === participantId)))
                        .filter(Boolean);
                      return (
                        <div key={doc.id} className="flex flex-col gap-2 rounded-lg border border-border bg-background p-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="font-medium text-foreground">{doc.file_name}</p>
                            <p className="text-muted-foreground">{names.join(" · ") || "Aucun voyageur associé"} · {fmtDateTime(doc.created_at)}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" size="sm" variant="outline" onClick={() => openFlightTicket(doc.storage_path)}>
                              <Download className="h-4 w-4" />
                              Ouvrir
                            </Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => startReplaceFlightTicket(doc)} disabled={flightBusy || flightInputDisabled}>
                              <Upload className="h-4 w-4" />
                              Remplacer
                            </Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => deleteFlightTicketDocument(doc)} disabled={flightBusy || flightInputDisabled}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                              Supprimer
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="space-y-3">
                  {flightTicketReplacingDocId && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                      Remplacement en cours. Le nouveau PDF reprendra les voyageurs sélectionnés ci-dessous.
                      <Button type="button" variant="link" size="sm" className="h-auto px-2 py-0 text-amber-900" onClick={() => setFlightTicketReplacingDocId(null)}>
                        Annuler
                      </Button>
                    </div>
                  )}
                  <div className="flex-1">
                    <Label className="text-xs">{flightTicketReplacingDocId ? "Nouveau billet PDF" : "Ajouter un autre billet"}</Label>
                    <Input type="file" accept="application/pdf" onChange={(event) => setFlightTicketFile(event.target.files?.[0] ?? null)} disabled={flightInputDisabled} />
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium">Voyageurs associés à ce fichier</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {participants.map((participant) => (
                        <label key={participant.id} className="flex items-center gap-2 rounded-lg border border-border bg-background p-2 text-xs">
                          <Checkbox
                            checked={flightTicketTravelerIds.includes(participant.id)}
                            disabled={flightInputDisabled || !selectedFlightTravelerSet.has(participant.id)}
                            onCheckedChange={(value) => {
                              setFlightTicketTravelerIds((current) => {
                                const next = new Set(current);
                                if (value === true) next.add(participant.id);
                                else next.delete(participant.id);
                                return Array.from(next);
                              });
                            }}
                          />
                          {participantName(participant)}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <Button type="button" variant="outline" onClick={analyzeFlightTicketPdf} disabled={flightBusy || flightInputDisabled || !flightTicketFile} className="min-h-10">
                      <FileSearch className="h-4 w-4" />
                      Importer les informations depuis le PDF
                    </Button>
                    <Button type="button" variant="outline" onClick={uploadFlightTicket} disabled={flightBusy || flightInputDisabled || !flightTicketFile || flightTicketTravelerIds.length === 0} className="min-h-10">
                      <Upload className="h-4 w-4" />
                      {flightTicketReplacingDocId ? "Remplacer billet" : "Ajouter billet"}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => openFlightTicket()} disabled={!flightDraft.ticket_storage_path && !flightDraft.ticket_document_id && flightTicketDocumentsWithTravelers.length === 0} className="min-h-10">
                      <Download className="h-4 w-4" />
                      Ouvrir PDF historique
                    </Button>
                  </div>
                </div>
              </details>

              <div className="grid gap-2 rounded-xl bg-secondary/40 p-3 text-sm sm:grid-cols-3">
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={flightDraft.ticket_sent_to_customer}
                    disabled={flightInputDisabled}
                    onCheckedChange={(checked) => setFlightDraft((current) => ({ ...current, ticket_sent_to_customer: checked === true }))}
                  />
                  Billet envoyé au client
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={flightDraft.email_sent}
                    disabled={flightInputDisabled}
                    onCheckedChange={(checked) => setFlightDraft((current) => ({ ...current, email_sent: checked === true }))}
                  />
                  Email envoyé
                </label>
                <div className="text-xs text-muted-foreground">
                  {flightMissing.length > 0 ? `${flightMissing.length} élément(s) requis pour l’étape demandée.` : "Le vol peut être enregistré avec les informations essentielles."}
                </div>
              </div>

              <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
                <Button type="button" variant="ghost" onClick={sendFlightReminderNow} disabled={flightBusy || !canEdit} className="min-h-10">
                  <Mail className="h-4 w-4" />
                  Relancer maintenant
                </Button>
                {flightFieldsReadOnly ? (
                  <Button type="button" variant="outline" onClick={startFlightEdit} disabled={flightBusy || !canEdit} className="min-h-10">
                    <Pencil className="h-4 w-4" />
                    Modifier
                  </Button>
                ) : (
                  <>
                    {flightEditMode && (
                      <Button type="button" variant="ghost" onClick={cancelFlightEdit} disabled={flightBusy} className="min-h-10">
                        Annuler
                      </Button>
                    )}
                    <Button type="button" variant="outline" onClick={() => saveFlightReservation()} disabled={flightBusy || !canEdit} className="min-h-10">
                      <Save className="h-4 w-4" />
                      Enregistrer
                    </Button>
                    <Button type="button" variant="outline" onClick={() => saveFlightReservation("reserved")} disabled={flightBusy || !canEdit || flightMissingForBookedAction.length > 0} className="min-h-10">
                      <Plane className="h-4 w-4" />
                      Enregistrer le vol réservé
                    </Button>
                    <Button type="button" onClick={markFlightTicketSent} disabled={flightBusy || !canEdit || flightMissingForFinalAction.length > 0} className="min-h-10">
                      <TicketCheck className="h-4 w-4" />
                      Marquer billet envoyé
                    </Button>
                  </>
                )}
              </div>
              {flightHistory.length > 0 && (
                <div className="rounded-xl border border-border bg-secondary/20 p-3">
                  <p className="mb-2 text-sm font-semibold">Historique vol</p>
                  <div className="space-y-1">
                    {flightHistory.slice(0, 6).map((event) => (
                      <p key={event.id} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{event.event_type}</span>
                        {" · "}
                        {fmtDateTime(event.created_at)}
                        {event.new_status ? ` · ${FLIGHT_STATUS_LABELS[event.new_status] ?? event.new_status}` : ""}
                      </p>
                    ))}
                  </div>
                </div>
              )}
              </div>
            </SheetContent>
          </Sheet>

          <Dialog open={flightImportDialogOpen} onOpenChange={setFlightImportDialogOpen}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Vérifier les informations détectées</DialogTitle>
              </DialogHeader>
              {flightImportPreview ? (
                <div className="space-y-4 text-sm">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-xs text-muted-foreground">PNR détecté</p>
                      <p className="font-semibold">{flightImportPreview.pnr || "Non détecté"}</p>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-xs text-muted-foreground">Compagnie</p>
                      <p className="font-semibold">{flightImportPreview.airline || "Non détectée"}</p>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-xs text-muted-foreground">Plateforme</p>
                      <p className="font-semibold">{flightImportPreview.platform || "Non détectée"}</p>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-xs text-muted-foreground">Classe</p>
                      <p className="font-semibold">{flightImportPreview.bookingClass || "Non détectée"}</p>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Segments / vols</p>
                    {flightImportPreview.segments.length > 0 ? (
                      <div className="space-y-1">
                        {flightImportPreview.segments.map((segment, index) => (
                          <p key={`${segment.from}-${segment.to}-${index}`} className="font-medium">
                            {segment.from} → {segment.to}{segment.flight_number ? ` · ${segment.flight_number}` : ""}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">{flightImportPreview.flightNumbers.join(" · ") || "Aucun segment structuré détecté"}</p>
                    )}
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Voyageurs et e-tickets proposés</p>
                    {flightImportPreview.travelers.length > 0 ? (
                      <div className="space-y-2">
                        {flightImportPreview.travelers.map((traveler) => (
                          <div key={traveler.rawName} className="rounded-md bg-muted/40 p-2">
                            <p className="font-medium">{traveler.rawName}</p>
                            <p className="text-xs text-muted-foreground">{traveler.ticketNumbers.join(" · ") || "Aucun numéro détecté"}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">Aucun voyageur reconnu automatiquement. La correspondance reste manuelle.</p>
                    )}
                  </div>
                  {flightImportPreview.warnings.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      {flightImportPreview.warnings.map((warning) => (
                        <p key={warning}>{warning}</p>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Aucune information détectée.</p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setFlightImportDialogOpen(false)}>Annuler</Button>
                <Button type="button" onClick={applyFlightImportPreview} disabled={!flightImportPreview}>Appliquer au brouillon</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Sheet open={adjustmentsOpen} onOpenChange={setAdjustmentsOpen}>
            <SheetContent className="w-full max-w-none p-0 sm:w-[min(760px,94vw)] sm:max-w-none">
              <SheetHeader className="border-b px-4 py-4 pr-12 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <SheetTitle>Ajustements devis · {b.reference}</SheetTitle>
                <Button type="button" size="sm" onClick={() => openAdjustmentDialog()} className="min-h-10">
                  <Plus className="h-4 w-4" />
                  Ajouter une ligne
                </Button>
              </div>
                <SheetDescription>Suppléments et réductions audités sans écraser le prix de base.</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 p-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:p-6">
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
              </div>
            </SheetContent>
          </Sheet>
        </div>

        <aside className="space-y-5 lg:space-y-6">
          <Sheet open={agencyOpen} onOpenChange={setAgencyOpen}>
            <SheetContent className="w-full max-w-none p-0 sm:w-[min(560px,92vw)] sm:max-w-none">
              <SheetHeader className="border-b px-4 py-4 pr-12 sm:px-6">
                <SheetTitle className="flex items-center gap-2"><Building2 className="h-4 w-4 text-accent" /> Attribuer agence</SheetTitle>
                <SheetDescription>Organisation, utilisateur et notes internes.</SheetDescription>
              </SheetHeader>
              <div className="space-y-3 p-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:p-6">
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
              </div>
            </SheetContent>
          </Sheet>

          <Sheet open={documentsOpen} onOpenChange={setDocumentsOpen}>
            <SheetContent className="w-full max-w-none p-0 sm:w-[min(680px,92vw)] sm:max-w-none">
              <SheetHeader className="border-b px-4 py-4 pr-12 sm:px-6">
                <SheetTitle>Documents · {b.reference}</SheetTitle>
                <SheetDescription>Documents commerciaux et pièces partagées avec le client.</SheetDescription>
              </SheetHeader>
              <div className="p-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:p-6">
            <div className="grid grid-cols-2 gap-2 mb-4">
              <Button size="sm" className="min-h-11" onClick={() => saveAndDownload("quote")} disabled={busy}>
                <FileText className="w-4 h-4" /> Devis PDF
              </Button>
              <Button size="sm" variant="outline" className="min-h-11" onClick={sendClientPortalAccess} disabled={busy}>
                <Mail className="w-4 h-4" /> Envoyer accès client
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
                <Select
                  value={docDraft.type}
                  onValueChange={(value) => setDocDraft((current) => ({
                    ...current,
                    type: value,
                    visibility_scope: defaultVisibilityScopeForDocument(value, current.title),
                  }))}
                >
                  <SelectTrigger className="min-h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="billet_avion">Billet avion</SelectItem>
                    <SelectItem value="voucher_hotel">Voucher hôtel</SelectItem>
                    <SelectItem value="qr_code_japon">QR code Japon</SelectItem>
                    <SelectItem value="reservation_activite_extra">Réservation activité extra</SelectItem>
                    <SelectItem value="visa">Visa</SelectItem>
                    <SelectItem value="assurance">Assurance</SelectItem>
                    <SelectItem value="travel_agreement">Accord de voyage</SelectItem>
                    <SelectItem value="receipt">Reçu paiement</SelectItem>
                    <SelectItem value="programme">Programme</SelectItem>
                    <SelectItem value="passeport">Passeport</SelectItem>
                    <SelectItem value="autre">Autre</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Titre</Label>
                <Input
                  value={docDraft.title}
                  onChange={(event) => setDocDraft((current) => {
                    const title = event.target.value;
                    return {
                      ...current,
                      title,
                      visibility_scope: defaultVisibilityScopeForDocument(current.type, title) === "booking_owner_only"
                        ? "booking_owner_only"
                        : current.visibility_scope,
                    };
                  })}
                  placeholder="Titre visible"
                />
              </div>
              <div><Label className="text-xs">Notes</Label><Textarea rows={2} value={docDraft.notes} onChange={(event) => setDocDraft((current) => ({ ...current, notes: event.target.value }))} /></div>
              <label className="flex items-center gap-2 rounded-lg border border-border bg-background p-3 text-sm">
                <Checkbox
                  checked={docDraft.visible_to_client}
                  onCheckedChange={(checked) => setDocDraft((current) => ({ ...current, visible_to_client: checked === true }))}
                />
                Visible dans l’espace client
              </label>
              <div>
                <Label className="text-xs">Portée visibilité client</Label>
                <Select
                  value={defaultVisibilityScopeForDocument(docDraft.type, docDraft.title) === "booking_owner_only" ? "booking_owner_only" : docDraft.visibility_scope}
                  onValueChange={(value) => setDocDraft((current) => ({ ...current, visibility_scope: value }))}
                  disabled={defaultVisibilityScopeForDocument(docDraft.type, docDraft.title) === "booking_owner_only"}
                >
                  <SelectTrigger className="min-h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="booking_participants">Tous les voyageurs de la réservation</SelectItem>
                    <SelectItem value="booking_owner_only">Contact principal uniquement</SelectItem>
                  </SelectContent>
                </Select>
                {defaultVisibilityScopeForDocument(docDraft.type, docDraft.title) === "booking_owner_only" && (
                  <p className="mt-1 text-[10px] text-muted-foreground">Les documents financiers sont toujours réservés au contact principal.</p>
                )}
              </div>
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
                    <p className="text-[10px] text-muted-foreground">{visibilityScopeLabel(d.visibility_scope)}</p>
                    <label className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <Checkbox
                        className="h-3.5 w-3.5"
                        checked={d.visible_to_client === true}
                        onCheckedChange={(checked) => toggleClientDocumentVisibility(d, checked === true)}
                      />
                      Visible client
                    </label>
                    {d.notes && <p className="truncate text-[10px] text-muted-foreground">{d.notes}</p>}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => openDoc(d)} title="Télécharger"><Download className="w-3.5 h-3.5" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => deleteBookingDocument(d)} title="Supprimer"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                </div>
              ))}
            </div>
              </div>
            </SheetContent>
          </Sheet>

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
            <div className="flex items-center justify-between rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-950">
              <span>Nouveau total du devis</span>
              <strong className="font-display text-lg">{fmtMAD(adjustmentPreviewTotal)}</strong>
            </div>
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

      <AdminPaymentDialog
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        bookingId={b.id}
        onSaved={load}
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
