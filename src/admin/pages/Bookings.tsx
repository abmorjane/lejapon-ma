import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronDown, FileText, Pencil, Plus, Receipt, Save, Search, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { LoyaltyBadge } from "../components/LoyaltyBadge";
import { QuickActions } from "../components/QuickActions";
import { CreateBookingDialog } from "../components/CreateBookingDialog";
import { useAuth } from "@/hooks/useAuth";
import { hasAnyRole } from "../lib/permissions";
import { fmtDateTime, fmtMAD } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  HOTEL_SUPPLEMENT,
  PUBLIC_HOTEL_OPTIONS,
  PUBLIC_ROOM_LABELS,
  getRoomAdjustmentPerPerson,
  type PublicHotelKey,
  type PublicRoomKey,
} from "@/lib/booking-options";
import { PAYMENT_METHOD_OPTIONS, normalisePaymentMethod, paymentMethodLabel } from "@/lib/payment-methods";
import {
  adjustmentAmount,
  draftFromQuoteAdjustment,
  emptyQuoteAdjustmentDraft,
  makeQuoteAdjustment,
  quoteAdjustmentsFromRequestMetadata,
  summarizeQuoteAdjustments,
  type QuoteAdjustment,
  type QuoteAdjustmentDraft,
} from "@/lib/quote-adjustments";
import { downloadBytes, generateQuotePdf, generateReceiptPdf } from "@/lib/booking-pdfs";

type DbClient = { from: (table: string) => any };
const db = supabase as unknown as DbClient;

type AgencyRequestStatus = "new" | "contacted" | "quoted" | "converted" | "rejected";
type VisualAgencyStatus = "lead" | "confirmed" | "paid" | "cancelled" | "rejected";
type ReservationOrigin = "all" | "lejapon" | "agency";
type UnifiedStatus = "all" | "lead" | "confirmed" | "paid" | "cancelled" | "completed" | "rejected";

type AgencyRequestMetadata = {
  crm_client_id?: string | null;
  agency_organization_id?: string | null;
  agency_name?: string | null;
  trip_id?: string | null;
  trip_title?: string | null;
  destination?: string | null;
  room_type?: string | null;
  hotel_category?: string | null;
  selected_extras?: Array<{ extra_id?: string; id?: string; name?: string; unit_price?: number | null; price_mad?: number | null; quantity?: number; total?: number | null }>;
  base_price?: number | null;
  room_supplement?: number | null;
  hotel_supplement?: number | null;
  extras_total?: number | null;
  estimated_total?: number | null;
  estimated_commission?: number | null;
  commission_rule_id?: string | null;
  commission_rule_label?: string | null;
  special_requests?: string | null;
  internal_notes?: string | null;
  payment_status?: "unpaid" | "paid" | null;
  payment_type?: "cash" | "bank_transfer" | "card" | "cheque" | "agency_payment" | "other" | null;
  payment_date?: string | null;
  payment_reference?: string | null;
  paid_amount?: number | null;
  payment_notes?: string | null;
  admin_notes?: string | null;
  reservation_status?: VisualAgencyStatus | null;
  quote_adjustments?: QuoteAdjustment[];
  payments?: Array<{
    id: string;
    amount_mad: number;
    method: string;
    paid_at: string;
    reference?: string | null;
    status: string;
    notes?: string | null;
    created_at: string;
    updated_at?: string | null;
    created_by?: string | null;
  }>;
  audit_timeline?: Array<{
    id: string;
    created_at: string;
    actor_label?: string | null;
    action: string;
    changes?: Array<{ field: string; old_value?: unknown; new_value?: unknown }>;
  }>;
};

type OrganizationSummary = {
  id: string;
  display_name: string | null;
  legal_name: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  postal_code?: string | null;
  country?: string | null;
  status?: string | null;
  metadata?: Record<string, any> | null;
};

type AgencyBookingRequest = {
  id: string;
  organization_id: string;
  agency_name?: string | null;
  agency?: OrganizationSummary | null;
  client_full_name: string;
  client_email: string | null;
  client_phone: string | null;
  trip_interest: string;
  travelers_count: number;
  preferred_departure_date: string | null;
  message: string | null;
  metadata: AgencyRequestMetadata | null;
  status: AgencyRequestStatus;
  created_at: string;
};

type NormalBookingRow = {
  id: string;
  reference: string;
  contact_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  status: string;
  num_adults: number | null;
  num_children: number | null;
  total_amount_mad: number | null;
  paid_amount_mad: number | null;
  created_at: string;
  source?: string | null;
  trips?: { title?: string | null } | null;
  clients?: { loyalty_tier?: string | null; is_returning?: boolean | null; trips_completed?: number | null } | null;
};

type UnifiedReservation =
  | { kind: "booking"; id: string; created_at: string; status: string; booking: NormalBookingRow }
  | { kind: "agency_request"; id: string; created_at: string; status: VisualAgencyStatus; request: AgencyBookingRequest };

const agencyRequestColumns = "id,organization_id,client_full_name,client_email,client_phone,trip_interest,travelers_count,preferred_departure_date,message,metadata,status,created_at";
const tripColumns = "id,title,slug,season,start_date,end_date,destination,destinations,base_price_mad,slots_left,status,label,program_link,programme_id";
const extraColumns = "id,name,description,price_mad,category,city,sort_order";

const AGENCY_REQUEST_STATUS_LABELS: Record<AgencyRequestStatus, string> = {
  new: "Nouvelle",
  contacted: "Contacté",
  quoted: "Devis envoyé",
  converted: "Convertie",
  rejected: "Rejetée",
};

const VISUAL_AGENCY_STATUS_LABELS: Record<VisualAgencyStatus, string> = {
  lead: "Lead",
  confirmed: "Confirmé",
  paid: "Payé",
  cancelled: "Annulé",
  rejected: "Rejeté",
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  received: "Reçu",
  pending: "En attente",
  cancelled: "Annulé",
  refunded: "Remboursé",
};

const activeAgencyPaymentTotal = (payments: AgencyRequestMetadata["payments"] = []) =>
  payments
    .filter((payment) => payment.status !== "cancelled" && payment.status !== "refunded")
    .reduce((sum, payment) => sum + Number(payment.amount_mad || 0), 0);

const ROOM_TYPE_LABELS: Record<string, string> = {
  ...PUBLIC_ROOM_LABELS,
  twin: "Twin",
};

const HOTEL_CATEGORY_LABELS: Record<string, string> = {
  modern: PUBLIC_HOTEL_OPTIONS.modern.name,
  ryokan: PUBLIC_HOTEL_OPTIONS.ryokan.name,
  standard: "Standard",
  superior: "Supérieur",
  premium: "Premium",
};

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  cash: "Espèces",
  bank_transfer: "Virement",
  card: "Carte",
  cheque: "Chèque",
  other: "Autre",
};

const formatMaybeMoney = (value: number | null | undefined, fallback = "Prix non renseigné") =>
  value === null || value === undefined ? fallback : fmtMAD(value);

const getAgencyVisualStatus = (status: AgencyRequestStatus, metadata?: AgencyRequestMetadata | null): VisualAgencyStatus => {
  if (metadata?.reservation_status === "cancelled") return "cancelled";
  if (metadata?.reservation_status === "paid") return "paid";
  if (metadata?.reservation_status === "confirmed") return "confirmed";
  if (metadata?.payment_status === "paid") return "paid";
  if (status === "rejected") return "rejected";
  if (status === "converted") return "confirmed";
  return "lead";
};

const getAgencyRequestVisualStatus = (request: AgencyBookingRequest): VisualAgencyStatus => {
  return getAgencyVisualStatus(request.status, request.metadata);
};

const agencyVisualBadgeClass = (status: VisualAgencyStatus) => {
  if (status === "confirmed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "paid") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "cancelled") return "border-slate-200 bg-slate-50 text-slate-700";
  if (status === "rejected") return "border-red-200 bg-red-50 text-red-700";
  return "border-amber-200 bg-amber-50 text-amber-800";
};

const mapVisualStatusToDb = (status: VisualAgencyStatus): AgencyRequestStatus => {
  if (status === "rejected" || status === "cancelled") return "rejected";
  if (status === "confirmed" || status === "paid") return "converted";
  return "new";
};

const normalize = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const getTripDestination = (trip: any) =>
  trip?.destination || (Array.isArray(trip?.destinations) ? trip.destinations.filter(Boolean).join(", ") : null);

const requestPaymentsFromMetadata = (metadata?: AgencyRequestMetadata | null) => {
  if (Array.isArray(metadata?.payments)) return metadata.payments;
  const amount = Number(metadata?.paid_amount ?? 0);
  if (!amount) return [];
  return [{
    id: "legacy-payment",
    amount_mad: amount,
    method: normalisePaymentMethod(metadata?.payment_type),
    paid_at: metadata?.payment_date || new Date().toISOString().slice(0, 10),
    reference: metadata?.payment_reference ?? null,
    status: metadata?.payment_status === "paid" ? "received" : "pending",
    notes: metadata?.payment_notes ?? null,
    created_at: metadata?.payment_date || new Date().toISOString(),
    created_by: null,
  }];
};

const makeAgencyAuditEntry = (
  action: string,
  changes: Array<{ field: string; old_value?: unknown; new_value?: unknown }> = [],
  actorLabel = "Admin",
  actorId?: string | null,
) => ({
  id: crypto.randomUUID(),
  created_at: new Date().toISOString(),
  actor_id: actorId ?? null,
  actor_label: actorLabel,
  action,
  changes,
});

const bookingSourceLabel = (booking: NormalBookingRow) =>
  normalize(booking.source).includes("admin")
    ? "Admin"
    : "Site LeJapon.ma";

const getAgencyRequestSearchText = (request: AgencyBookingRequest) => {
  const metadata = request.metadata ?? {};
  return [
    request.agency_name,
    request.client_full_name,
    request.client_email,
    request.client_phone,
    metadata.trip_title,
    request.trip_interest,
    metadata.destination,
  ].filter(Boolean).join(" ").toLowerCase();
};

const getBookingSearchText = (booking: NormalBookingRow) =>
  [
    booking.reference,
    booking.contact_name,
    booking.contact_email,
    booking.contact_phone,
    booking.trips?.title,
  ].filter(Boolean).join(" ").toLowerCase();

export default function Bookings() {
  const [rows, setRows] = useState<NormalBookingRow[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(true);
  const [bookingsError, setBookingsError] = useState<string | null>(null);
  const [agencyRequests, setAgencyRequests] = useState<AgencyBookingRequest[]>([]);
  const [agencyRequestsLoading, setAgencyRequestsLoading] = useState(true);
  const [agencyRequestsError, setAgencyRequestsError] = useState<string | null>(null);
  const [agencyRequestBusy, setAgencyRequestBusy] = useState<string | null>(null);
  const [selectedAgencyRequest, setSelectedAgencyRequest] = useState<AgencyBookingRequest | null>(null);
  const [selectedAgencyOrg, setSelectedAgencyOrg] = useState<OrganizationSummary | null>(null);
  const [internalNotesDraft, setInternalNotesDraft] = useState("");
  const [adminStatusDraft, setAdminStatusDraft] = useState<VisualAgencyStatus>("lead");
  const [notesSaving, setNotesSaving] = useState(false);
  const [adminRequestForm, setAdminRequestForm] = useState({
    client_full_name: "",
    client_email: "",
    client_phone: "",
    trip_id: "",
    travelers_count: "1",
    room_type: "double" as PublicRoomKey,
    hotel_category: "modern" as PublicHotelKey,
    selected_extras: {} as Record<string, number>,
    special_requests: "",
    status: "lead" as VisualAgencyStatus,
    admin_notes: "",
    agency_notes: "",
  });
  const [tripOptions, setTripOptions] = useState<any[]>([]);
  const [extraOptions, setExtraOptions] = useState<any[]>([]);
  const [agencyRequestSaving, setAgencyRequestSaving] = useState(false);
  const [adjustmentDialogOpen, setAdjustmentDialogOpen] = useState(false);
  const [editingAdjustmentId, setEditingAdjustmentId] = useState<string | null>(null);
  const [adjustmentDraft, setAdjustmentDraft] = useState<QuoteAdjustmentDraft>(emptyQuoteAdjustmentDraft);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [paymentDraft, setPaymentDraft] = useState({
    amount_mad: "",
    method: "bank_transfer",
    paid_at: new Date().toISOString().slice(0, 10),
    reference: "",
    status: "received",
    notes: "",
  });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<UnifiedStatus>("all");
  const [originFilter, setOriginFilter] = useState<ReservationOrigin>("all");
  const [agencyFilter, setAgencyFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const { roles, user } = useAuth();
  const canCreate = hasAnyRole(roles, ["super_admin", "admin", "manager"]);
  const canManageAgencyReservations = hasAnyRole(roles, ["super_admin", "admin"]);
  const reduceMotion = useReducedMotion();

  const load = async () => {
    setBookingsLoading(true);
    setBookingsError(null);
    const { data, error } = await supabase
      .from("bookings")
      .select("id, reference, contact_name, contact_email, contact_phone, status, num_adults, num_children, total_amount_mad, paid_amount_mad, created_at, source, trips(title), clients(loyalty_tier, is_returning, trips_completed)")
      .order("created_at", { ascending: false })
      .limit(160);
    if (error) {
      console.warn("[admin-reservations] bookings load failed", error);
      setRows([]);
      setBookingsError(error.message ?? "Impossible de charger les réservations LeJapon.ma.");
      setBookingsLoading(false);
      return;
    }
    setRows((data ?? []) as NormalBookingRow[]);
    setBookingsLoading(false);
  };

  const loadAgencyRequests = async () => {
    setAgencyRequestsLoading(true);
    setAgencyRequestsError(null);

    const { data, error } = await db
      .from("agency_booking_requests")
      .select(agencyRequestColumns)
      .order("created_at", { ascending: false })
      .limit(160);

    if (error) {
      setAgencyRequests([]);
      setAgencyRequestsError(error.message);
      setAgencyRequestsLoading(false);
      return;
    }

    const requests = (data ?? []) as AgencyBookingRequest[];
    const organizationIds = Array.from(new Set(requests.map((request) => request.organization_id).filter(Boolean)));
    const organizationById = new Map<string, OrganizationSummary>();
    if (organizationIds.length) {
      const { data: organizations } = await db
        .from("organizations")
        .select("id,display_name,legal_name,email,phone,website,address_line_1,address_line_2,city,postal_code,country,status,metadata")
        .in("id", organizationIds);
      ((organizations ?? []) as OrganizationSummary[]).forEach((organization) => {
        organizationById.set(organization.id, organization);
      });
    }

    setAgencyRequests(requests.map((request) => {
      const organization = organizationById.get(request.organization_id) ?? null;
      return {
        ...request,
        agency: organization,
        agency_name: organization?.display_name || organization?.legal_name || request.metadata?.agency_name || request.organization_id,
      };
    }));
    setAgencyRequestsLoading(false);
  };

  const loadAgencyRequestOptions = async () => {
    const [{ data: tripsData, error: tripsError }, { data: extrasData, error: extrasError }] = await Promise.all([
      db
        .from("trips")
        .select(tripColumns)
        .in("status", ["open", "completed"])
        .order("start_date", { ascending: true, nullsFirst: false }),
      db
        .from("extras")
        .select(extraColumns)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
    ]);
    if (tripsError) console.warn("[admin-agency-reservation] trips unavailable", tripsError);
    if (extrasError) console.warn("[admin-agency-reservation] extras unavailable", extrasError);
    setTripOptions((tripsData ?? []) as any[]);
    setExtraOptions((extrasData ?? []) as any[]);
  };

  const updateAgencyRequestStatus = async (request: AgencyBookingRequest, nextStatus: AgencyRequestStatus) => {
    setAgencyRequestBusy(request.id);
    const { data, error } = await db
      .from("agency_booking_requests")
      .update({ status: nextStatus })
      .eq("id", request.id)
      .select(agencyRequestColumns)
      .maybeSingle();

    if (error) {
      toast.error(error.message ?? "Impossible de mettre à jour la demande.");
      setAgencyRequestBusy(null);
      return;
    }

    const updated = (data ?? { ...request, status: nextStatus }) as AgencyBookingRequest;
    const nextRequest = { ...updated, agency_name: request.agency_name, agency: request.agency };
    setAgencyRequests((current) => current.map((item) => (item.id === request.id ? nextRequest : item)));
    setSelectedAgencyRequest((current) => (current?.id === request.id ? nextRequest : current));
    toast.success("Statut de la demande mis à jour.");
    setAgencyRequestBusy(null);
  };

  const saveInternalNotes = async () => {
    if (!selectedAgencyRequest) return;
    setNotesSaving(true);
    const nextStatus: AgencyRequestStatus = mapVisualStatusToDb(adminStatusDraft);
    const nextMetadata = {
      ...(selectedAgencyRequest.metadata ?? {}),
      internal_notes: internalNotesDraft.trim() || null,
      admin_notes: internalNotesDraft.trim() || null,
      reservation_status: adminStatusDraft,
      payment_status: adminStatusDraft === "paid" ? "paid" : selectedAgencyRequest.metadata?.payment_status === "paid" && adminStatusDraft !== "paid" ? "unpaid" : selectedAgencyRequest.metadata?.payment_status ?? null,
      audit_timeline: [
        makeAgencyAuditEntry("admin_followup_updated", [
          { field: "status", old_value: getAgencyRequestVisualStatus(selectedAgencyRequest), new_value: adminStatusDraft },
          { field: "admin_notes", old_value: selectedAgencyRequest.metadata?.admin_notes ?? null, new_value: internalNotesDraft.trim() || null },
        ], user?.email || "Admin", user?.id),
        ...(selectedAgencyRequest.metadata?.audit_timeline ?? []),
      ].slice(0, 80),
    };
    const { data, error } = await db
      .from("agency_booking_requests")
      .update({ metadata: nextMetadata, status: nextStatus })
      .eq("id", selectedAgencyRequest.id)
      .select(agencyRequestColumns)
      .maybeSingle();

    if (error) {
      toast.error(error.message ?? "Impossible d'enregistrer les notes.");
      setNotesSaving(false);
      return;
    }

    const updated = {
      ...((data ?? selectedAgencyRequest) as AgencyBookingRequest),
      agency: selectedAgencyRequest.agency,
      agency_name: selectedAgencyRequest.agency_name,
    };
    setAgencyRequests((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setSelectedAgencyRequest(updated);
    toast.success("Notes internes enregistrées.");
    setNotesSaving(false);
  };

  const syncSelectedAgencyRequest = (updated: AgencyBookingRequest) => {
    const nextRequest = {
      ...updated,
      agency: selectedAgencyRequest?.agency ?? updated.agency ?? null,
      agency_name: selectedAgencyRequest?.agency_name ?? updated.agency_name ?? updated.metadata?.agency_name ?? updated.organization_id,
    };
    setAgencyRequests((current) => current.map((item) => (item.id === nextRequest.id ? nextRequest : item)));
    setSelectedAgencyRequest(nextRequest);
  };

  const setAdminRequestExtraQuantity = (extraId: string, quantity: number) => {
    const safeQuantity = Math.max(0, Math.floor(Number.isFinite(quantity) ? quantity : 0));
    setAdminRequestForm((current) => ({
      ...current,
      selected_extras: {
        ...current.selected_extras,
        [extraId]: safeQuantity,
      },
    }));
  };

  const saveAgencyReservationDetails = async () => {
    if (!selectedAgencyRequest) return;
    if (!canManageAgencyReservations) {
      toast.error("Vous n'avez pas l'autorisation de modifier cette réservation agence.");
      return;
    }
    if (!adminRequestForm.client_full_name.trim()) {
      toast.error("Le nom du client est obligatoire.");
      return;
    }

    const selectedTrip = tripOptions.find((trip) => trip.id === adminRequestForm.trip_id) ?? null;
    const travelersCount = Number(adminRequestForm.travelers_count);
    const safeTravelersCount = Number.isFinite(travelersCount) && travelersCount > 0 ? Math.floor(travelersCount) : 1;
    const selectedExtras = extraOptions
      .map((extra) => ({ extra, quantity: Number(adminRequestForm.selected_extras[extra.id] ?? 0) }))
      .filter((item) => item.quantity > 0);
    const tripBasePrice = selectedTrip?.base_price_mad ?? selectedAgencyRequest.metadata?.base_price ?? null;
    const basePriceTotal = tripBasePrice === null || tripBasePrice === undefined ? null : Number(tripBasePrice) * safeTravelersCount;
    const roomSupplementTotal = getRoomAdjustmentPerPerson(adminRequestForm.room_type) * safeTravelersCount;
    const hotelSupplementTotal = (HOTEL_SUPPLEMENT[adminRequestForm.hotel_category] ?? 0) * safeTravelersCount;
    const extrasTotal = extraOptions.length > 0
      ? selectedExtras.reduce((sum, item) => sum + Number(item.extra.price_mad ?? 0) * item.quantity, 0)
      : Number(selectedAgencyRequest.metadata?.extras_total ?? 0);
    const estimatedTotal = basePriceTotal === null
      ? selectedAgencyRequest.metadata?.estimated_total ?? null
      : basePriceTotal + roomSupplementTotal + hotelSupplementTotal + extrasTotal;

    const oldMetadata = selectedAgencyRequest.metadata ?? {};
    const changes = [
      selectedAgencyRequest.client_full_name !== adminRequestForm.client_full_name.trim()
        ? { field: "client_full_name", old_value: selectedAgencyRequest.client_full_name, new_value: adminRequestForm.client_full_name.trim() }
        : null,
      selectedAgencyRequest.client_email !== (adminRequestForm.client_email.trim() || null)
        ? { field: "client_email", old_value: selectedAgencyRequest.client_email, new_value: adminRequestForm.client_email.trim() || null }
        : null,
      selectedAgencyRequest.client_phone !== (adminRequestForm.client_phone.trim() || null)
        ? { field: "client_phone", old_value: selectedAgencyRequest.client_phone, new_value: adminRequestForm.client_phone.trim() || null }
        : null,
      Number(selectedAgencyRequest.travelers_count ?? 1) !== safeTravelersCount
        ? { field: "travelers_count", old_value: selectedAgencyRequest.travelers_count, new_value: safeTravelersCount }
        : null,
      oldMetadata.trip_id !== (selectedTrip?.id ?? oldMetadata.trip_id ?? null)
        ? { field: "trip_id", old_value: oldMetadata.trip_id ?? null, new_value: selectedTrip?.id ?? null }
        : null,
      oldMetadata.room_type !== adminRequestForm.room_type
        ? { field: "room_type", old_value: oldMetadata.room_type ?? null, new_value: adminRequestForm.room_type }
        : null,
      oldMetadata.hotel_category !== adminRequestForm.hotel_category
        ? { field: "hotel_category", old_value: oldMetadata.hotel_category ?? null, new_value: adminRequestForm.hotel_category }
        : null,
      oldMetadata.special_requests !== (adminRequestForm.special_requests.trim() || null)
        ? { field: "special_requests", old_value: oldMetadata.special_requests ?? null, new_value: adminRequestForm.special_requests.trim() || null }
        : null,
      getAgencyRequestVisualStatus(selectedAgencyRequest) !== adminRequestForm.status
        ? { field: "status", old_value: getAgencyRequestVisualStatus(selectedAgencyRequest), new_value: adminRequestForm.status }
        : null,
      oldMetadata.admin_notes !== (adminRequestForm.admin_notes.trim() || null)
        ? { field: "admin_notes", old_value: oldMetadata.admin_notes ?? null, new_value: adminRequestForm.admin_notes.trim() || null }
        : null,
    ].filter(Boolean) as Array<{ field: string; old_value?: unknown; new_value?: unknown }>;

    const nextMetadata: AgencyRequestMetadata = {
      ...oldMetadata,
      trip_id: selectedTrip?.id ?? oldMetadata.trip_id ?? null,
      trip_title: selectedTrip?.title ?? oldMetadata.trip_title ?? selectedAgencyRequest.trip_interest,
      destination: selectedTrip ? getTripDestination(selectedTrip) : oldMetadata.destination ?? null,
      room_type: adminRequestForm.room_type,
      hotel_category: adminRequestForm.hotel_category,
      selected_extras: extraOptions.length > 0
        ? selectedExtras.map(({ extra, quantity }) => ({
            extra_id: extra.id,
            id: extra.id,
            name: extra.name,
            unit_price: extra.price_mad,
            price_mad: extra.price_mad,
            quantity,
            total: extra.price_mad === null || extra.price_mad === undefined ? null : Number(extra.price_mad) * quantity,
          }))
        : oldMetadata.selected_extras ?? [],
      base_price: tripBasePrice,
      room_supplement: roomSupplementTotal,
      hotel_supplement: hotelSupplementTotal,
      extras_total: extrasTotal,
      estimated_total: estimatedTotal,
      special_requests: adminRequestForm.special_requests.trim() || null,
      admin_notes: adminRequestForm.admin_notes.trim() || null,
      internal_notes: adminRequestForm.admin_notes.trim() || null,
      agency_notes: adminRequestForm.agency_notes.trim() || (oldMetadata.agency_notes ?? null),
      reservation_status: adminRequestForm.status,
      payment_status: adminRequestForm.status === "paid" ? "paid" : (oldMetadata.payment_status ?? null),
      audit_timeline: changes.length
        ? [
            makeAgencyAuditEntry("admin_reservation_updated", changes, user?.email || "Admin", user?.id),
            ...(oldMetadata.audit_timeline ?? []),
          ].slice(0, 80)
        : oldMetadata.audit_timeline ?? [],
    };

    setAgencyRequestSaving(true);
    const { data, error } = await db
      .from("agency_booking_requests")
      .update({
        client_full_name: adminRequestForm.client_full_name.trim(),
        client_email: adminRequestForm.client_email.trim() || null,
        client_phone: adminRequestForm.client_phone.trim() || null,
        trip_interest: selectedTrip?.title ?? oldMetadata.trip_title ?? selectedAgencyRequest.trip_interest,
        travelers_count: safeTravelersCount,
        preferred_departure_date: selectedTrip?.start_date ?? selectedAgencyRequest.preferred_departure_date,
        message: adminRequestForm.special_requests.trim() || null,
        metadata: nextMetadata,
        status: mapVisualStatusToDb(adminRequestForm.status),
      })
      .eq("id", selectedAgencyRequest.id)
      .select(agencyRequestColumns)
      .maybeSingle();

    setAgencyRequestSaving(false);
    if (error) {
      toast.error(error.message ?? "Impossible de modifier la réservation agence.");
      return;
    }
    syncSelectedAgencyRequest((data ?? { ...selectedAgencyRequest, metadata: nextMetadata }) as AgencyBookingRequest);
    toast.success("Réservation agence mise à jour.");
  };

  const saveAgencyRequestAdjustments = async (nextAdjustments: QuoteAdjustment[], action = "quote_adjustments_updated", changes: Array<{ field: string; old_value?: unknown; new_value?: unknown }> = []) => {
    if (!selectedAgencyRequest) return false;
    const cleaned = nextAdjustments.map((adjustment) => ({
      ...adjustment,
      amount: Number(adjustment.amount || 0),
      visible_on_quote: adjustment.visible_on_quote !== false,
      source: adjustment.source ?? "admin",
    }));
    const nextMetadata: AgencyRequestMetadata = {
      ...(selectedAgencyRequest.metadata ?? {}),
      quote_adjustments: cleaned,
      audit_timeline: [
        makeAgencyAuditEntry(action, changes, user?.email || "Admin", user?.id),
        ...(selectedAgencyRequest.metadata?.audit_timeline ?? []),
      ].slice(0, 80),
    };
    const { data, error } = await db
      .from("agency_booking_requests")
      .update({ metadata: nextMetadata })
      .eq("id", selectedAgencyRequest.id)
      .select(agencyRequestColumns)
      .maybeSingle();
    if (error) {
      toast.error(error.message ?? "Impossible d'enregistrer les ajustements devis.");
      return false;
    }
    syncSelectedAgencyRequest((data ?? { ...selectedAgencyRequest, metadata: nextMetadata }) as AgencyBookingRequest);
    toast.success("Ajustements devis enregistrés.");
    return true;
  };

  const openAdjustmentDialog = (adjustment?: QuoteAdjustment) => {
    setEditingAdjustmentId(adjustment?.id ?? null);
    setAdjustmentDraft(adjustment ? draftFromQuoteAdjustment(adjustment) : emptyQuoteAdjustmentDraft());
    setAdjustmentDialogOpen(true);
  };

  const saveAdjustmentDraft = async () => {
    if (!selectedAgencyRequest) return;
    const amount = Number(adjustmentDraft.amount || 0);
    if (!adjustmentDraft.label.trim()) return toast.error("Le libellé est obligatoire.");
    if (!Number.isFinite(amount) || amount <= 0) return toast.error("Le montant doit être supérieur à 0.");
    const currentAdjustments = quoteAdjustmentsFromRequestMetadata(selectedAgencyRequest.metadata);
    const existing = currentAdjustments.find((adjustment) => adjustment.id === editingAdjustmentId) ?? null;
    const nextAdjustment = makeQuoteAdjustment(adjustmentDraft, user?.id, "admin", existing);
    const nextAdjustments = existing
      ? currentAdjustments.map((adjustment) => adjustment.id === existing.id ? nextAdjustment : adjustment)
      : [...currentAdjustments, nextAdjustment];
    const saved = await saveAgencyRequestAdjustments(nextAdjustments, existing ? "quote_adjustment_updated" : "quote_adjustment_added", [
      { field: "quote_adjustment", old_value: existing ?? null, new_value: nextAdjustment },
    ]);
    if (saved) setAdjustmentDialogOpen(false);
  };

  const deleteAdjustment = async (adjustment: QuoteAdjustment) => {
    if (!selectedAgencyRequest) return;
    if (!confirm(`Supprimer la ligne "${adjustment.label}" ?`)) return;
    const currentAdjustments = quoteAdjustmentsFromRequestMetadata(selectedAgencyRequest.metadata);
    await saveAgencyRequestAdjustments(
      currentAdjustments.filter((item) => item.id !== adjustment.id),
      "quote_adjustment_deleted",
      [{ field: "quote_adjustment", old_value: adjustment, new_value: null }],
    );
  };

  const openPaymentDialog = (payment?: NonNullable<AgencyRequestMetadata["payments"]>[number]) => {
    setEditingPaymentId(payment?.id ?? null);
    setPaymentDraft(payment ? {
      amount_mad: String(payment.amount_mad ?? ""),
      method: normalisePaymentMethod(payment.method),
      paid_at: payment.paid_at ? payment.paid_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
      reference: payment.reference ?? "",
      status: payment.status ?? "received",
      notes: payment.notes ?? "",
    } : {
      amount_mad: "",
      method: "bank_transfer",
      paid_at: new Date().toISOString().slice(0, 10),
      reference: "",
      status: "received",
      notes: "",
    });
    setPaymentDialogOpen(true);
  };

  const saveAgencyRequestPayments = async (
    nextPayments: NonNullable<AgencyRequestMetadata["payments"]>,
    action: string,
    changes: Array<{ field: string; old_value?: unknown; new_value?: unknown }>,
  ) => {
    if (!selectedAgencyRequest) return false;
    const totalPaid = activeAgencyPaymentTotal(nextPayments);
    const latestPayment = nextPayments.find((payment) => payment.status === "received") ?? nextPayments[0] ?? null;
    const nextMetadata: AgencyRequestMetadata = {
      ...(selectedAgencyRequest.metadata ?? {}),
      payments: nextPayments,
      paid_amount: totalPaid,
      payment_status: totalPaid > 0 ? "paid" : "unpaid",
      payment_type: latestPayment?.method as AgencyRequestMetadata["payment_type"] ?? null,
      payment_date: latestPayment?.paid_at ?? null,
      payment_reference: latestPayment?.reference ?? null,
      payment_notes: latestPayment?.notes ?? null,
      reservation_status: totalPaid > 0 ? "paid" : selectedAgencyRequest.metadata?.reservation_status ?? getAgencyRequestVisualStatus(selectedAgencyRequest),
      audit_timeline: [
        makeAgencyAuditEntry(action, changes, user?.email || "Admin", user?.id),
        ...(selectedAgencyRequest.metadata?.audit_timeline ?? []),
      ].slice(0, 80),
    };
    const nextStatus = totalPaid > 0 ? "converted" : selectedAgencyRequest.status;
    const { data, error } = await db
      .from("agency_booking_requests")
      .update({ metadata: nextMetadata, status: nextStatus })
      .eq("id", selectedAgencyRequest.id)
      .select(agencyRequestColumns)
      .maybeSingle();
    if (error) {
      toast.error(error.message ?? "Impossible d'enregistrer le paiement.");
      return false;
    }
    syncSelectedAgencyRequest((data ?? { ...selectedAgencyRequest, metadata: nextMetadata, status: nextStatus }) as AgencyBookingRequest);
    return true;
  };

  const savePaymentDraft = async () => {
    if (!selectedAgencyRequest) return;
    const amount = Number(paymentDraft.amount_mad);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Le montant doit être supérieur à 0.");
      return;
    }
    const currentPayments = requestPaymentsFromMetadata(selectedAgencyRequest.metadata);
    const existing = currentPayments.find((payment) => payment.id === editingPaymentId) ?? null;
    const nextPayment = {
      id: existing?.id ?? crypto.randomUUID(),
      amount_mad: amount,
      method: normalisePaymentMethod(paymentDraft.method),
      paid_at: paymentDraft.paid_at || new Date().toISOString().slice(0, 10),
      reference: paymentDraft.reference.trim() || null,
      status: paymentDraft.status,
      notes: paymentDraft.notes.trim() || null,
      created_at: existing?.created_at ?? new Date().toISOString(),
      updated_at: existing ? new Date().toISOString() : null,
      created_by: existing?.created_by ?? user?.id ?? null,
    };
    const nextPayments = existing
      ? currentPayments.map((payment) => payment.id === existing.id ? nextPayment : payment)
      : [nextPayment, ...currentPayments.filter((payment) => payment.id !== "legacy-payment")];
    const saved = await saveAgencyRequestPayments(nextPayments, existing ? "payment_updated_by_admin" : "payment_added_by_admin", [
      { field: "payment", old_value: existing ?? null, new_value: nextPayment },
    ]);
    if (saved) {
      setPaymentDialogOpen(false);
      toast.success(existing ? "Paiement mis à jour." : "Paiement ajouté.");
    }
  };

  const deletePayment = async (payment: NonNullable<AgencyRequestMetadata["payments"]>[number]) => {
    if (!selectedAgencyRequest) return;
    if (!confirm(`Supprimer le paiement de ${fmtMAD(payment.amount_mad)} ?`)) return;
    const currentPayments = requestPaymentsFromMetadata(selectedAgencyRequest.metadata);
    const nextPayments = currentPayments.filter((item) => item.id !== payment.id);
    const saved = await saveAgencyRequestPayments(nextPayments, "payment_deleted_by_admin", [
      { field: "payment", old_value: payment, new_value: null },
    ]);
    if (saved) toast.success("Paiement supprimé.");
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { loadAgencyRequests(); }, []);
  useEffect(() => { loadAgencyRequestOptions(); }, []);

  useEffect(() => {
    setInternalNotesDraft(selectedAgencyRequest?.metadata?.internal_notes ?? "");
    const nextStatus = selectedAgencyRequest ? getAgencyRequestVisualStatus(selectedAgencyRequest) : "lead";
    setAdminStatusDraft(nextStatus);
    if (!selectedAgencyRequest) return;
    const metadata = selectedAgencyRequest.metadata ?? {};
    const extrasMap = (metadata.selected_extras ?? []).reduce<Record<string, number>>((acc, extra) => {
      const id = extra.extra_id || extra.id;
      if (id) acc[id] = Math.max(0, Number(extra.quantity ?? 1));
      return acc;
    }, {});
    setAdminRequestForm({
      client_full_name: selectedAgencyRequest.client_full_name ?? "",
      client_email: selectedAgencyRequest.client_email ?? "",
      client_phone: selectedAgencyRequest.client_phone ?? "",
      trip_id: metadata.trip_id ?? "",
      travelers_count: String(selectedAgencyRequest.travelers_count ?? 1),
      room_type: (metadata.room_type === "single" || metadata.room_type === "triple" ? metadata.room_type : "double") as PublicRoomKey,
      hotel_category: (metadata.hotel_category === "ryokan" ? "ryokan" : "modern") as PublicHotelKey,
      selected_extras: extrasMap,
      special_requests: metadata.special_requests ?? selectedAgencyRequest.message ?? "",
      status: nextStatus,
      admin_notes: metadata.admin_notes ?? metadata.internal_notes ?? "",
      agency_notes: metadata.agency_notes ?? "",
    });
  }, [selectedAgencyRequest?.id]);

  const agencyOptions = useMemo(() => {
    const agencies = new Map<string, string>();
    agencyRequests.forEach((request) => {
      agencies.set(request.organization_id, request.agency_name || request.organization_id);
    });
    return Array.from(agencies.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [agencyRequests]);

  const unifiedReservations = useMemo<UnifiedReservation[]>(() => {
    const needle = q.trim().toLowerCase();
    const normalItems: UnifiedReservation[] = rows.map((booking) => ({
      kind: "booking",
      id: booking.id,
      created_at: booking.created_at,
      status: booking.status,
      booking,
    }));
    const agencyItems: UnifiedReservation[] = agencyRequests.map((request) => ({
      kind: "agency_request",
      id: request.id,
      created_at: request.created_at,
      status: getAgencyRequestVisualStatus(request),
      request,
    }));

    return [...normalItems, ...agencyItems]
      .filter((item) => {
        if (originFilter === "lejapon" && item.kind !== "booking") return false;
        if (originFilter === "agency" && item.kind !== "agency_request") return false;
        if (agencyFilter !== "all" && (item.kind !== "agency_request" || item.request.organization_id !== agencyFilter)) return false;
        if (status !== "all" && item.status !== status) return false;
        if (!needle) return true;
        return item.kind === "booking"
          ? getBookingSearchText(item.booking).includes(needle)
          : getAgencyRequestSearchText(item.request).includes(needle);
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [agencyFilter, agencyRequests, originFilter, q, rows, status]);

  const displayedNormalCount = unifiedReservations.filter((item) => item.kind === "booking").length;
  const displayedAgencyCount = unifiedReservations.filter((item) => item.kind === "agency_request").length;

  const openAgencyRequest = async (request: AgencyBookingRequest) => {
    setSelectedAgencyRequest(request);
    const { data, error } = await db
      .from("agency_booking_requests")
      .select(agencyRequestColumns)
      .eq("id", request.id)
      .maybeSingle();
    if (!error && data) {
      setSelectedAgencyRequest({
        ...(data as AgencyBookingRequest),
        agency: request.agency,
        agency_name: request.agency_name,
      });
    }
  };

  const buildAgencyRequestPdfData = (request: AgencyBookingRequest) => {
    const metadata = request.metadata ?? {};
    const requestAdjustments = quoteAdjustmentsFromRequestMetadata(metadata);
    const requestPayments = requestPaymentsFromMetadata(metadata);
    const paidTotal = activeAgencyPaymentTotal(requestPayments);
    const extras = (metadata.selected_extras ?? []).map((extra) => ({
      name_snapshot: extra.name || "Extra",
      qty: Number(extra.quantity ?? 1),
      unit_price_mad: Number(extra.unit_price ?? extra.price_mad ?? 0),
    }));
    const bookingLike = {
      reference: `AG-${request.id.slice(0, 8).toUpperCase()}`,
      contact_name: request.client_full_name,
      contact_email: request.client_email,
      contact_phone: request.client_phone,
      contact_city: "",
      num_adults: request.travelers_count,
      num_children: 0,
      room_type: metadata.room_type ? ROOM_TYPE_LABELS[metadata.room_type] ?? metadata.room_type : "",
      formula: metadata.hotel_category ? HOTEL_CATEGORY_LABELS[metadata.hotel_category] ?? metadata.hotel_category : "",
      total_amount_mad: Number(metadata.estimated_total ?? 0),
      paid_amount_mad: paidTotal,
      source: `Agence ${request.agency_name || ""}`.trim(),
    };
    const tripLike = {
      title: metadata.trip_title || request.trip_interest,
      season: metadata.destination ?? null,
      start_date: request.preferred_departure_date,
      end_date: null,
    };
    const agency = {
      agency_display_name: request.agency_name ?? request.agency?.display_name ?? undefined,
      legal_company_name: request.agency?.legal_name ?? request.agency_name ?? undefined,
      brand_name: request.agency_name ?? request.agency?.display_name ?? "Agence partenaire",
      email: request.agency?.email ?? undefined,
      phone: request.agency?.phone ?? undefined,
      website: request.agency?.website ?? undefined,
      address_line_1: (request.agency as any)?.address_line_1 ?? undefined,
      address_line_2: (request.agency as any)?.address_line_2 ?? undefined,
      city: (request.agency as any)?.city ?? undefined,
      postal_code: (request.agency as any)?.postal_code ?? undefined,
      country: (request.agency as any)?.country ?? undefined,
      logo_url: typeof request.agency?.metadata?.agency_logo_url === "string" ? request.agency.metadata.agency_logo_url : undefined,
      is_partner_agency: true,
    };
    return { bookingLike, tripLike, extras, agency, requestAdjustments, requestPayments };
  };

  const downloadAgencyRequestQuote = async () => {
    if (!selectedAgencyRequest) return;
    try {
      const pdfData = buildAgencyRequestPdfData(selectedAgencyRequest);
      const bytes = await generateQuotePdf({
        booking: pdfData.bookingLike,
        trip: pdfData.tripLike,
        extras: pdfData.extras,
        quote_adjustments: pdfData.requestAdjustments,
        agency: pdfData.agency,
        number: `DEVIS-AG-${selectedAgencyRequest.id.slice(0, 8).toUpperCase()}`,
      });
      downloadBytes(bytes, `devis-agence-${selectedAgencyRequest.id.slice(0, 8)}.pdf`);
    } catch (error: any) {
      toast.error(error?.message ?? "Impossible de générer le devis agence.");
    }
  };

  const downloadAgencyRequestReceipt = async () => {
    if (!selectedAgencyRequest) return;
    const pdfData = buildAgencyRequestPdfData(selectedAgencyRequest);
    const latestPayment = pdfData.requestPayments.find((payment) => payment.status === "received") ?? pdfData.requestPayments[0] ?? null;
    if (!latestPayment) {
      toast.error("Ajoutez un paiement avant de générer un reçu.");
      return;
    }
    try {
      const bytes = await generateReceiptPdf({
        booking: pdfData.bookingLike,
        trip: pdfData.tripLike,
        extras: pdfData.extras,
        quote_adjustments: pdfData.requestAdjustments,
        agency: pdfData.agency,
        payment: {
          amount_mad: latestPayment.amount_mad,
          method: latestPayment.method,
          paid_at: latestPayment.paid_at,
          reference: latestPayment.reference || `AG-${selectedAgencyRequest.id.slice(0, 8).toUpperCase()}`,
        },
        number: `RECU-AG-${selectedAgencyRequest.id.slice(0, 8).toUpperCase()}`,
      });
      downloadBytes(bytes, `recu-agence-${selectedAgencyRequest.id.slice(0, 8)}.pdf`);
    } catch (error: any) {
      toast.error(error?.message ?? "Impossible de générer le reçu agence.");
    }
  };

  const metadata = selectedAgencyRequest?.metadata ?? {};
  const selectedExtras = metadata.selected_extras ?? [];
  const selectedTrip = tripOptions.find((trip) => trip.id === adminRequestForm.trip_id) ?? null;
  const adminSelectedExtras = extraOptions
    .map((extra) => ({ extra, quantity: Number(adminRequestForm.selected_extras[extra.id] ?? 0) }))
    .filter((item) => item.quantity > 0);
  const adminDisplayExtras = adminSelectedExtras.length > 0 ? adminSelectedExtras : selectedExtras.map((extra) => ({
    extra: {
      id: extra.extra_id || extra.id || extra.name || "extra",
      name: extra.name || "Extra",
      price_mad: extra.unit_price ?? extra.price_mad ?? null,
    },
    quantity: Number(extra.quantity ?? 1),
    total: extra.total ?? null,
  }));
  const adminTravelersCount = Number(adminRequestForm.travelers_count);
  const safeAdminTravelersCount = Number.isFinite(adminTravelersCount) && adminTravelersCount > 0 ? Math.floor(adminTravelersCount) : 1;
  const adminTripBasePrice = selectedTrip?.base_price_mad ?? metadata.base_price ?? null;
  const adminBasePriceTotal = adminTripBasePrice === null || adminTripBasePrice === undefined ? null : Number(adminTripBasePrice) * safeAdminTravelersCount;
  const adminRoomSupplementTotal = getRoomAdjustmentPerPerson(adminRequestForm.room_type) * safeAdminTravelersCount;
  const adminHotelSupplementTotal = (HOTEL_SUPPLEMENT[adminRequestForm.hotel_category] ?? 0) * safeAdminTravelersCount;
  const adminExtrasTotal = adminSelectedExtras.length > 0
    ? adminSelectedExtras.reduce((sum, item) => sum + Number(item.extra.price_mad ?? 0) * item.quantity, 0)
    : Number(metadata.extras_total ?? 0);
  const adminEstimatedTotal = adminBasePriceTotal === null ? metadata.estimated_total ?? null : adminBasePriceTotal + adminRoomSupplementTotal + adminHotelSupplementTotal + adminExtrasTotal;
  const adminQuoteAdjustments = quoteAdjustmentsFromRequestMetadata(metadata);
  const adminQuoteSummary = summarizeQuoteAdjustments(adminQuoteAdjustments, Number(adminEstimatedTotal ?? 0));
  const adminPayments = requestPaymentsFromMetadata(metadata);
  const adminPaidTotal = activeAgencyPaymentTotal(adminPayments);
  const adminRemainingTotal = Math.max(0, adminQuoteSummary.finalTotal - adminPaidTotal);
  const adminAuditTimeline = metadata.audit_timeline ?? [];

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-4"
    >
      <PageHeader
        title="Réservations"
        description="Vue unifiée des réservations LeJapon.ma et des demandes agences."
        action={canCreate ? (
          <Button className="min-h-11 w-full rounded-xl sm:w-auto" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" /> Nouvelle réservation
          </Button>
        ) : undefined}
      />

      <Card className="rounded-2xl shadow-sm">
        <CardContent className="p-3 sm:p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_170px_190px_220px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-9 min-h-11"
                type="search"
                enterKeyHint="search"
                placeholder="Client, agence, email, référence…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <Select value={originFilter} onValueChange={(value) => setOriginFilter(value as ReservationOrigin)}>
              <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="lejapon">LeJapon.ma</SelectItem>
                <SelectItem value="agency">Agences partenaires</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(value) => setStatus(value as UnifiedStatus)}>
              <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous statuts</SelectItem>
                <SelectItem value="lead">Lead</SelectItem>
                <SelectItem value="confirmed">Confirmé</SelectItem>
                <SelectItem value="paid">Payé</SelectItem>
                <SelectItem value="cancelled">Annulé</SelectItem>
                <SelectItem value="completed">Terminé</SelectItem>
                <SelectItem value="rejected">Rejeté</SelectItem>
              </SelectContent>
            </Select>
            <Select value={agencyFilter} onValueChange={setAgencyFilter}>
              <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes agences</SelectItem>
                {agencyOptions.map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {unifiedReservations.length} reservation(s) affichée(s) · {displayedNormalCount} LeJapon.ma · {displayedAgencyCount} agences
          </p>
        </CardContent>
      </Card>

      {canCreate && <CreateBookingDialog open={createOpen} onOpenChange={setCreateOpen} />}

      {bookingsError ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          Réservations LeJapon.ma: {bookingsError}
        </div>
      ) : null}

      {agencyRequestsError ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          Réservations agences: {agencyRequestsError}
        </div>
      ) : null}

      <div className="space-y-3 md:hidden">
        {(bookingsLoading || agencyRequestsLoading) && unifiedReservations.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground bg-background rounded-2xl border border-border">
            Chargement des réservations…
          </p>
        )}
        {unifiedReservations.length === 0 && !bookingsLoading && !agencyRequestsLoading && (
          <p className="p-6 text-center text-sm text-muted-foreground bg-background rounded-2xl border border-border">
            Aucune réservation.
          </p>
        )}
        {unifiedReservations.map((item, index) => {
          if (item.kind === "agency_request") {
            const request = item.request;
            const requestMetadata = request.metadata ?? {};
            return (
              <motion.details
                key={`agency-${request.id}`}
                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                transition={{ duration: 0.18, delay: Math.min(index, 8) * 0.025 }}
                className="group overflow-hidden rounded-2xl border border-border bg-background shadow-sm"
              >
                <summary className="list-none p-4 cursor-pointer min-h-[96px]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Badge variant="outline" className="mb-2">Agence: {request.agency_name || "Agence"}</Badge>
                      <p className="font-semibold text-accent">{request.client_full_name}</p>
                      <p className="text-xs text-muted-foreground truncate">{requestMetadata.trip_title || request.trip_interest}</p>
                      <button
                        type="button"
                        className="mt-1 text-left text-xs text-muted-foreground underline-offset-2 hover:underline"
                        onClick={(event) => {
                          event.preventDefault();
                          setSelectedAgencyOrg(request.agency ?? null);
                        }}
                      >
                        {request.agency_name || "Agence"}
                      </button>
                    </div>
                    <div className="shrink-0 text-right">
                      <Badge variant="outline" className={agencyVisualBadgeClass(getAgencyRequestVisualStatus(request))}>
                        {VISUAL_AGENCY_STATUS_LABELS[getAgencyRequestVisualStatus(request)]}
                      </Badge>
                      <ChevronDown className="w-4 h-4 ml-auto mt-2 text-muted-foreground transition-transform group-open:rotate-180" />
                    </div>
                  </div>
                  <QuickActions phone={request.client_phone} email={request.client_email} compact className="mt-3" />
                </summary>
                <div className="grid grid-cols-2 gap-3 border-t border-border bg-muted/20 p-4 text-sm">
                  <div><p className="text-xs text-muted-foreground">Voyageurs</p><p className="font-medium">{request.travelers_count}</p></div>
                  <div><p className="text-xs text-muted-foreground">Créée le</p><p className="font-medium">{fmtDateTime(request.created_at)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Total estimé</p><p className="font-medium">{formatMaybeMoney(requestMetadata.estimated_total)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Commission</p><p className="font-medium">{formatMaybeMoney(requestMetadata.estimated_commission, "Non renseignée")}</p></div>
                  <Button type="button" className="col-span-2" onClick={() => openAgencyRequest(request)}>
                    Ouvrir la demande
                  </Button>
                </div>
              </motion.details>
            );
          }

          const b = item.booking;
          const remaining = Number(b.total_amount_mad || 0) - Number(b.paid_amount_mad || 0);
          return (
            <motion.details
              key={`booking-${b.id}`}
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: Math.min(index, 8) * 0.025 }}
              className="group overflow-hidden rounded-2xl border border-border bg-background shadow-sm"
            >
              <summary className="list-none p-4 cursor-pointer min-h-[96px]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Badge variant="outline" className="mb-2">{bookingSourceLabel(b)}</Badge>
                    <Link to={`/admin/bookings/${b.id}`} className="font-semibold text-accent" onClick={(e) => e.stopPropagation()}>{b.reference}</Link>
                    <div className="flex items-center gap-2 flex-wrap mt-1">
                      <p className="truncate font-medium">{b.contact_name}</p>
                      <LoyaltyBadge tier={b.clients?.loyalty_tier} isReturning={b.clients?.is_returning} trips={b.clients?.trips_completed} />
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{b.trips?.title ?? "—"}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <StatusBadge value={b.status} />
                    <ChevronDown className="w-4 h-4 ml-auto mt-2 text-muted-foreground transition-transform group-open:rotate-180" />
                  </div>
                </div>
                <QuickActions phone={b.contact_phone} email={b.contact_email} compact className="mt-3" />
              </summary>
              <div className="grid grid-cols-2 gap-3 border-t border-border bg-muted/20 p-4 text-sm">
                <div><p className="text-xs text-muted-foreground">Pax</p><p className="font-medium">{b.num_adults}A {Number(b.num_children || 0) > 0 && `+ ${b.num_children}E`}</p></div>
                <div><p className="text-xs text-muted-foreground">Reçu le</p><p className="font-medium">{fmtDateTime(b.created_at)}</p></div>
                <div><p className="text-xs text-muted-foreground">Total</p><p className="font-medium">{fmtMAD(b.total_amount_mad)}</p></div>
                <div><p className="text-xs text-muted-foreground">Payé</p><p className="font-medium">{fmtMAD(b.paid_amount_mad)}</p></div>
                <div className="col-span-2 rounded-xl bg-background p-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Reste</span>
                    <span className="font-semibold text-foreground">{fmtMAD(Math.max(0, remaining))}</span>
                  </div>
                </div>
                <Link to={`/admin/bookings/${b.id}`} className="col-span-2 inline-flex h-11 items-center justify-center rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground">
                  Ouvrir la réservation
                </Link>
              </div>
            </motion.details>
          );
        })}
      </div>

      <div className="hidden overflow-hidden rounded-2xl border border-border bg-background shadow-sm md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1320px] text-sm">
            <thead className="bg-secondary/50">
              <tr className="text-left">
                <th className="p-4 font-semibold">Origine</th>
                <th className="p-4 font-semibold">Référence / agence</th>
                <th className="p-4 font-semibold">Client</th>
                <th className="p-4 font-semibold">Contact</th>
                <th className="p-4 font-semibold">Voyage</th>
                <th className="p-4 font-semibold">Pax</th>
                <th className="p-4 font-semibold">Options</th>
                <th className="p-4 font-semibold">Total</th>
                <th className="p-4 font-semibold">Commission</th>
                <th className="p-4 font-semibold">Statut</th>
                <th className="p-4 font-semibold">Créée le</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(bookingsLoading || agencyRequestsLoading) && unifiedReservations.length === 0 && (
                <tr><td colSpan={11} className="p-8 text-center text-muted-foreground">Chargement des réservations…</td></tr>
              )}
              {unifiedReservations.length === 0 && !bookingsLoading && !agencyRequestsLoading && (
                <tr><td colSpan={11} className="p-8 text-center text-muted-foreground">Aucune réservation.</td></tr>
              )}
              {unifiedReservations.map((item) => {
                if (item.kind === "agency_request") {
                  const request = item.request;
                  const requestMetadata = request.metadata ?? {};
                  const extras = requestMetadata.selected_extras ?? [];
                  const visualStatus = getAgencyRequestVisualStatus(request);
                  return (
                    <tr key={`agency-${request.id}`} className="cursor-pointer align-top hover:bg-secondary/30" onClick={() => openAgencyRequest(request)}>
                      <td className="p-4"><Badge variant="outline">Agence: {request.agency_name || "Agence"}</Badge></td>
                      <td className="p-4">
                        <button
                          type="button"
                          className="text-left font-medium text-accent underline-offset-2 hover:underline"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedAgencyOrg(request.agency ?? null);
                          }}
                        >
                          {request.agency_name || "Agence"}
                        </button>
                        <p className="text-xs text-muted-foreground">{request.id.slice(0, 8)}</p>
                      </td>
                      <td className="p-4">
                        {request.metadata?.crm_client_id ? (
                          <Link
                            to={`/admin/clients/${request.metadata.crm_client_id}`}
                            className="font-medium text-accent hover:underline"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {request.client_full_name}
                          </Link>
                        ) : (
                          <button type="button" className="font-medium text-accent hover:underline" onClick={() => openAgencyRequest(request)}>
                            {request.client_full_name}
                          </button>
                        )}
                      </td>
                      <td className="p-4">
                        <p>{request.client_email || "—"}</p>
                        <p className="text-xs text-muted-foreground">{request.client_phone || "—"}</p>
                      </td>
                      <td className="p-4">
                        <p className="font-medium">{requestMetadata.trip_title || request.trip_interest}</p>
                        <p className="text-xs text-muted-foreground">{requestMetadata.destination || request.preferred_departure_date || "—"}</p>
                      </td>
                      <td className="p-4">{request.travelers_count}</td>
                      <td className="p-4 text-xs">
                        <p>Chambre: {requestMetadata.room_type ? ROOM_TYPE_LABELS[requestMetadata.room_type] ?? requestMetadata.room_type : "—"}</p>
                        <p className="text-muted-foreground">Hôtel: {requestMetadata.hotel_category ? HOTEL_CATEGORY_LABELS[requestMetadata.hotel_category] ?? requestMetadata.hotel_category : "—"}</p>
                        <p className="mt-1 max-w-[220px] text-muted-foreground">
                          {extras.length ? extras.map((extra) => `${extra.name ?? "Extra"} x${extra.quantity ?? 1}`).join(" · ") : "Aucun extra"}
                        </p>
                      </td>
                      <td className="p-4">
                        <p className="font-medium">{formatMaybeMoney(requestMetadata.estimated_total)}</p>
                        <p className="text-xs text-muted-foreground">Extras: {formatMaybeMoney(requestMetadata.extras_total)}</p>
                      </td>
                      <td className="p-4">
                        <p className="font-medium">{formatMaybeMoney(requestMetadata.estimated_commission, "Commission non renseignée")}</p>
                        <p className="text-xs text-muted-foreground">{requestMetadata.commission_rule_label || "—"}</p>
                      </td>
                      <td className="p-4">
                        <Badge variant="outline" className={agencyVisualBadgeClass(visualStatus)}>
                          {VISUAL_AGENCY_STATUS_LABELS[visualStatus]}
                        </Badge>
                        <p className="mt-1 text-xs text-muted-foreground">DB: {AGENCY_REQUEST_STATUS_LABELS[request.status]}</p>
                      </td>
                      <td className="p-4 text-xs text-muted-foreground">{fmtDateTime(request.created_at)}</td>
                    </tr>
                  );
                }

                const b = item.booking;
                return (
                  <tr key={`booking-${b.id}`} className="hover:bg-secondary/30">
                    <td className="p-4"><Badge variant="outline">{bookingSourceLabel(b)}</Badge></td>
                    <td className="p-4"><Link to={`/admin/bookings/${b.id}`} className="text-accent font-medium">{b.reference}</Link></td>
                    <td className="p-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium">{b.contact_name}</p>
                        <LoyaltyBadge tier={b.clients?.loyalty_tier} isReturning={b.clients?.is_returning} trips={b.clients?.trips_completed} />
                      </div>
                    </td>
                    <td className="p-4">
                      <p>{b.contact_email || "—"}</p>
                      <p className="text-xs text-muted-foreground">{b.contact_phone || "—"}</p>
                    </td>
                    <td className="p-4">{b.trips?.title ?? "—"}</td>
                    <td className="p-4">{b.num_adults}A {Number(b.num_children || 0) > 0 && `+ ${b.num_children}E`}</td>
                    <td className="p-4 text-xs text-muted-foreground">—</td>
                    <td className="p-4">{fmtMAD(b.total_amount_mad)}</td>
                    <td className="p-4">—</td>
                    <td className="p-4"><StatusBadge value={b.status} /></td>
                    <td className="p-4 text-xs text-muted-foreground">{fmtDateTime(b.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={Boolean(selectedAgencyRequest)} onOpenChange={(open) => !open && setSelectedAgencyRequest(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Demande agence · {selectedAgencyRequest?.client_full_name ?? "Client"}</DialogTitle>
          </DialogHeader>
          {selectedAgencyRequest && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Agence: {selectedAgencyRequest.agency_name || "Agence"}</Badge>
                <Badge variant="outline" className={agencyVisualBadgeClass(getAgencyRequestVisualStatus(selectedAgencyRequest))}>
                  {VISUAL_AGENCY_STATUS_LABELS[getAgencyRequestVisualStatus(selectedAgencyRequest)]}
                </Badge>
                <span className="text-xs text-muted-foreground">Créée le {fmtDateTime(selectedAgencyRequest.created_at)}</span>
              </div>

              <Card className="border-accent/20 bg-accent/5 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="font-display text-lg">Édition admin de la réservation agence</h3>
                    <p className="text-sm text-muted-foreground">
                      Les modifications sont enregistrées dans la même demande que l'agence voit dans son extranet.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={downloadAgencyRequestQuote}>
                      <FileText className="h-4 w-4" /> Devis
                    </Button>
                    <Button type="button" variant="outline" onClick={downloadAgencyRequestReceipt}>
                      <Receipt className="h-4 w-4" /> Reçu
                    </Button>
                    <Button type="button" onClick={saveAgencyReservationDetails} disabled={agencyRequestSaving || !canManageAgencyReservations}>
                      <Save className="h-4 w-4" />
                      {agencyRequestSaving ? "Enregistrement…" : "Enregistrer"}
                    </Button>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-3">
                  <div className="space-y-3 rounded-xl border border-border bg-background p-4 lg:col-span-2">
                    <h4 className="font-semibold">Client</h4>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label>Nom client</Label>
                        <Input value={adminRequestForm.client_full_name} onChange={(event) => setAdminRequestForm((current) => ({ ...current, client_full_name: event.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <Label>Email</Label>
                        <Input type="email" value={adminRequestForm.client_email} onChange={(event) => setAdminRequestForm((current) => ({ ...current, client_email: event.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <Label>Téléphone</Label>
                        <Input value={adminRequestForm.client_phone} onChange={(event) => setAdminRequestForm((current) => ({ ...current, client_phone: event.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <Label>Voyageurs</Label>
                        <Input type="number" min={1} value={adminRequestForm.travelers_count} onChange={(event) => setAdminRequestForm((current) => ({ ...current, travelers_count: event.target.value }))} />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-xl border border-border bg-background p-4">
                    <h4 className="font-semibold">Statut</h4>
                    <Select value={adminRequestForm.status} onValueChange={(value) => setAdminRequestForm((current) => ({ ...current, status: value as VisualAgencyStatus }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lead">Lead</SelectItem>
                        <SelectItem value="confirmed">Confirmé</SelectItem>
                        <SelectItem value="paid">Payé</SelectItem>
                        <SelectItem value="cancelled">Annulé</SelectItem>
                        <SelectItem value="rejected">Rejeté</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="rounded-lg bg-secondary/60 p-3 text-sm">
                      <div className="flex justify-between gap-3"><span className="text-muted-foreground">Total devis</span><span className="font-semibold">{fmtMAD(adminQuoteSummary.finalTotal)}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-muted-foreground">Payé</span><span className="font-semibold">{fmtMAD(adminPaidTotal)}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-muted-foreground">Reste</span><span className="font-semibold">{fmtMAD(adminRemainingTotal)}</span></div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div className="space-y-3 rounded-xl border border-border bg-background p-4">
                    <h4 className="font-semibold">Voyage et hébergement</h4>
                    <div className="space-y-2">
                      <Label>Voyage sélectionné</Label>
                      <Select value={adminRequestForm.trip_id || "none"} onValueChange={(value) => setAdminRequestForm((current) => ({ ...current, trip_id: value === "none" ? "" : value }))}>
                        <SelectTrigger><SelectValue placeholder="Sélectionner un voyage" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Aucun voyage sélectionné</SelectItem>
                          {tripOptions.map((trip) => (
                            <SelectItem key={trip.id} value={trip.id}>{trip.title}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label>Chambre</Label>
                        <Select value={adminRequestForm.room_type} onValueChange={(value) => setAdminRequestForm((current) => ({ ...current, room_type: value as PublicRoomKey }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(PUBLIC_ROOM_LABELS).map(([value, label]) => (
                              <SelectItem key={value} value={value}>{label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label>Option hôtel</Label>
                        <Select value={adminRequestForm.hotel_category} onValueChange={(value) => setAdminRequestForm((current) => ({ ...current, hotel_category: value as PublicHotelKey }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(PUBLIC_HOTEL_OPTIONS).map(([value, option]) => (
                              <SelectItem key={value} value={value}>{option.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid gap-2 rounded-lg bg-secondary/50 p-3 text-sm sm:grid-cols-2">
                      <div><span className="text-muted-foreground">Destination</span><p className="font-medium">{selectedTrip ? getTripDestination(selectedTrip) || "—" : metadata.destination || "—"}</p></div>
                      <div><span className="text-muted-foreground">Départ</span><p className="font-medium">{selectedTrip?.start_date || selectedAgencyRequest.preferred_departure_date || "—"}</p></div>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-xl border border-border bg-background p-4">
                    <h4 className="font-semibold">Notes</h4>
                    <div className="space-y-1">
                      <Label>Demandes agence / client</Label>
                      <Textarea rows={3} value={adminRequestForm.special_requests} onChange={(event) => setAdminRequestForm((current) => ({ ...current, special_requests: event.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Notes internes admin</Label>
                      <Textarea rows={3} value={adminRequestForm.admin_notes} onChange={(event) => setAdminRequestForm((current) => ({ ...current, admin_notes: event.target.value }))} />
                      <p className="text-xs text-muted-foreground">Ces notes restent côté admin et ne sont pas affichées à l'agence.</p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-border bg-background p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h4 className="font-semibold">Extras et quantités</h4>
                      <p className="text-sm text-muted-foreground">Modifie les extras stockés dans la demande agence.</p>
                    </div>
                    <span className="text-sm font-semibold">Total extras: {fmtMAD(adminExtrasTotal)}</span>
                  </div>
                  {extraOptions.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">Catalogue extras indisponible ou vide.</p>
                  ) : (
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {extraOptions.map((extra) => {
                        const quantity = Number(adminRequestForm.selected_extras[extra.id] ?? 0);
                        return (
                          <div key={extra.id} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_100px] sm:items-center">
                            <div>
                              <p className="font-medium">{extra.name}</p>
                              <p className="text-xs text-muted-foreground">{formatMaybeMoney(extra.price_mad, "prix non renseigné")}</p>
                            </div>
                            <Input type="number" min={0} value={quantity} onChange={(event) => setAdminRequestExtraQuantity(extra.id, Number(event.target.value))} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {adminDisplayExtras.length > 0 && (
                    <div className="mt-3 rounded-lg bg-secondary/50 p-3 text-sm">
                      {adminDisplayExtras.map((item) => (
                        <div key={item.extra.id} className="flex justify-between gap-3 py-1">
                          <span>{item.extra.name || "Extra"} x{item.quantity}</span>
                          <span className="font-medium">{formatMaybeMoney("total" in item ? item.total : Number(item.extra.price_mad ?? 0) * item.quantity, "prix non renseigné")}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-xl border border-border bg-background p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="font-semibold">Ajustements devis</h4>
                      <Button type="button" size="sm" onClick={() => openAdjustmentDialog()}>
                        <Plus className="h-4 w-4" /> Ajouter
                      </Button>
                    </div>
                    {adminQuoteAdjustments.length === 0 ? (
                      <p className="mt-3 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">Aucune ligne spéciale.</p>
                    ) : (
                      <div className="mt-3 overflow-x-auto rounded-lg border border-border">
                        <table className="w-full min-w-[620px] text-sm">
                          <thead className="bg-secondary/60 text-xs text-muted-foreground">
                            <tr>
                              <th className="px-3 py-2 text-left">Type</th>
                              <th className="px-3 py-2 text-left">Libellé</th>
                              <th className="px-3 py-2 text-right">Montant</th>
                              <th className="px-3 py-2 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {adminQuoteAdjustments.map((adjustment) => (
                              <tr key={adjustment.id} className="border-t border-border">
                                <td className="px-3 py-2">{adjustment.type === "discount" ? "Réduction" : "Supplément"}</td>
                                <td className="px-3 py-2">
                                  <p className="font-medium">{adjustment.label}</p>
                                  {adjustment.reason && <p className="text-xs text-muted-foreground">{adjustment.reason}</p>}
                                </td>
                                <td className="px-3 py-2 text-right font-medium">{adjustment.type === "discount" ? "-" : "+"}{fmtMAD(adjustmentAmount(adjustment, Number(adminEstimatedTotal ?? 0)))}</td>
                                <td className="px-3 py-2">
                                  <div className="flex justify-end gap-1">
                                    <Button type="button" size="sm" variant="ghost" onClick={() => openAdjustmentDialog(adjustment)}><Pencil className="h-4 w-4" /></Button>
                                    <Button type="button" size="sm" variant="ghost" onClick={() => deleteAdjustment(adjustment)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-border bg-background p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="font-semibold">Paiements</h4>
                      <Button type="button" size="sm" onClick={() => openPaymentDialog()}>
                        <Plus className="h-4 w-4" /> Ajouter
                      </Button>
                    </div>
                    {adminPayments.length === 0 ? (
                      <p className="mt-3 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">Aucun paiement déclaré.</p>
                    ) : (
                      <div className="mt-3 overflow-x-auto rounded-lg border border-border">
                        <table className="w-full min-w-[680px] text-sm">
                          <thead className="bg-secondary/60 text-xs text-muted-foreground">
                            <tr>
                              <th className="px-3 py-2 text-left">Montant</th>
                              <th className="px-3 py-2 text-left">Méthode</th>
                              <th className="px-3 py-2 text-left">Date</th>
                              <th className="px-3 py-2 text-left">Statut</th>
                              <th className="px-3 py-2 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {adminPayments.map((payment) => (
                              <tr key={payment.id} className="border-t border-border">
                                <td className="px-3 py-2 font-semibold">{fmtMAD(payment.amount_mad)}</td>
                                <td className="px-3 py-2">{paymentMethodLabel(payment.method)}</td>
                                <td className="px-3 py-2">{payment.paid_at || "—"}</td>
                                <td className="px-3 py-2">{PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}</td>
                                <td className="px-3 py-2">
                                  <div className="flex justify-end gap-1">
                                    <Button type="button" size="sm" variant="ghost" onClick={() => openPaymentDialog(payment)}><Pencil className="h-4 w-4" /></Button>
                                    <Button type="button" size="sm" variant="ghost" onClick={() => deletePayment(payment)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-border bg-background p-4">
                  <h4 className="font-semibold">Historique visible admin</h4>
                  {adminAuditTimeline.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">Aucun événement enregistré.</p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {adminAuditTimeline.slice(0, 30).map((entry) => (
                        <div key={entry.id} className="rounded-lg border border-border p-3 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-medium">{entry.action}</p>
                            <p className="text-xs text-muted-foreground">{fmtDateTime(entry.created_at)}</p>
                          </div>
                          <p className="text-xs text-muted-foreground">{entry.actor_label || "Utilisateur"}</p>
                          {entry.changes?.length ? (
                            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                              {entry.changes.map((change, index) => (
                                <p key={`${entry.id}-${change.field}-${index}`}>
                                  {change.field}: {String(change.old_value ?? "—")} → {String(change.new_value ?? "—")}
                                </p>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Card>

              <Dialog open={adjustmentDialogOpen} onOpenChange={setAdjustmentDialogOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{editingAdjustmentId ? "Modifier la ligne devis" : "Ajouter une ligne devis"}</DialogTitle>
                  </DialogHeader>
                  <div className="grid gap-4 py-2">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Type</Label>
                        <Select value={adjustmentDraft.type} onValueChange={(value) => setAdjustmentDraft((current) => ({ ...current, type: value as QuoteAdjustment["type"] }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="discount">Réduction</SelectItem>
                            <SelectItem value="supplement">Supplément</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Calcul</Label>
                        <Select value={adjustmentDraft.calculation_type} onValueChange={(value) => setAdjustmentDraft((current) => ({ ...current, calculation_type: value as QuoteAdjustment["calculation_type"] }))}>
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
                      <Input value={adjustmentDraft.label} onChange={(event) => setAdjustmentDraft((current) => ({ ...current, label: event.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label>Montant</Label>
                      <Input type="number" min={0} value={adjustmentDraft.amount} onChange={(event) => setAdjustmentDraft((current) => ({ ...current, amount: event.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label>Notes</Label>
                      <Textarea rows={3} value={adjustmentDraft.reason} onChange={(event) => setAdjustmentDraft((current) => ({ ...current, reason: event.target.value }))} />
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={adjustmentDraft.visible_on_quote} onCheckedChange={(checked) => setAdjustmentDraft((current) => ({ ...current, visible_on_quote: checked === true }))} />
                      Visible sur le devis client
                    </label>
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setAdjustmentDialogOpen(false)}>Annuler</Button>
                    <Button type="button" onClick={saveAdjustmentDraft}>Enregistrer</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{editingPaymentId ? "Modifier le paiement agence" : "Ajouter un paiement agence"}</DialogTitle>
                  </DialogHeader>
                  <div className="grid gap-4 py-2">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Montant</Label>
                        <Input type="number" min={0} value={paymentDraft.amount_mad} onChange={(event) => setPaymentDraft((current) => ({ ...current, amount_mad: event.target.value }))} />
                      </div>
                      <div className="space-y-2">
                        <Label>Méthode</Label>
                        <Select value={normalisePaymentMethod(paymentDraft.method)} onValueChange={(value) => setPaymentDraft((current) => ({ ...current, method: value }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {PAYMENT_METHOD_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Date paiement</Label>
                        <Input type="date" value={paymentDraft.paid_at} onChange={(event) => setPaymentDraft((current) => ({ ...current, paid_at: event.target.value }))} />
                      </div>
                      <div className="space-y-2">
                        <Label>Statut</Label>
                        <Select value={paymentDraft.status} onValueChange={(value) => setPaymentDraft((current) => ({ ...current, status: value }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="received">Reçu</SelectItem>
                            <SelectItem value="pending">En attente</SelectItem>
                            <SelectItem value="cancelled">Annulé</SelectItem>
                            <SelectItem value="refunded">Remboursé</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Référence</Label>
                      <Input value={paymentDraft.reference} onChange={(event) => setPaymentDraft((current) => ({ ...current, reference: event.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label>Notes paiement</Label>
                      <Textarea rows={3} value={paymentDraft.notes} onChange={(event) => setPaymentDraft((current) => ({ ...current, notes: event.target.value }))} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setPaymentDialogOpen(false)}>Annuler</Button>
                    <Button type="button" onClick={savePaymentDraft}>Enregistrer</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <div className="grid gap-4 lg:grid-cols-3">
                <Card className="p-4 lg:col-span-2">
                  <h3 className="font-display text-lg">Client</h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div><p className="text-xs text-muted-foreground">Nom</p><p className="font-medium">{selectedAgencyRequest.client_full_name}</p></div>
                    <div><p className="text-xs text-muted-foreground">Email</p><p className="font-medium">{selectedAgencyRequest.client_email || "—"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Téléphone</p><p className="font-medium">{selectedAgencyRequest.client_phone || "—"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Voyageurs</p><p className="font-medium">{selectedAgencyRequest.travelers_count}</p></div>
                  </div>
                </Card>
                <Card className="p-4">
                  <h3 className="font-display text-lg">Agence</h3>
                  <button
                    type="button"
                    className="mt-3 text-left font-medium text-accent underline-offset-2 hover:underline"
                    onClick={() => setSelectedAgencyOrg(selectedAgencyRequest.agency ?? null)}
                  >
                    {selectedAgencyRequest.agency_name || "Agence"}
                  </button>
                  <p className="mt-1 text-xs text-muted-foreground">{selectedAgencyRequest.agency?.email || selectedAgencyRequest.agency?.phone || "Contact agence non renseigné"}</p>
                </Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="p-4">
                  <h3 className="font-display text-lg">Voyage et options</h3>
                  <div className="mt-3 space-y-3 text-sm">
                    <div><p className="text-xs text-muted-foreground">Voyage</p><p className="font-medium">{metadata.trip_title || selectedAgencyRequest.trip_interest}</p></div>
                    <div><p className="text-xs text-muted-foreground">Destination</p><p className="font-medium">{metadata.destination || "—"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Départ</p><p className="font-medium">{selectedAgencyRequest.preferred_departure_date || "—"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Chambre / hôtel</p><p className="font-medium">{metadata.room_type ? ROOM_TYPE_LABELS[metadata.room_type] ?? metadata.room_type : "—"} · {metadata.hotel_category ? HOTEL_CATEGORY_LABELS[metadata.hotel_category] ?? metadata.hotel_category : "—"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Extras</p><p className="font-medium">{selectedExtras.length ? selectedExtras.map((extra) => `${extra.name ?? "Extra"} x${extra.quantity ?? 1} (${formatMaybeMoney(extra.total ?? Number(extra.price_mad ?? extra.unit_price ?? 0) * Number(extra.quantity ?? 1), "prix non renseigné")})`).join(" · ") : "—"}</p></div>
                  </div>
                </Card>
                <Card className="p-4">
                  <h3 className="font-display text-lg">Prix et commission</h3>
                  <div className="mt-3 space-y-3 text-sm">
                    <div className="flex justify-between gap-3"><span className="text-muted-foreground">Prix base</span><span className="font-medium">{formatMaybeMoney(metadata.base_price)}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-muted-foreground">Suppl. chambre</span><span className="font-medium">{formatMaybeMoney(metadata.room_supplement)}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-muted-foreground">Suppl. hôtel</span><span className="font-medium">{formatMaybeMoney(metadata.hotel_supplement)}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-muted-foreground">Extras</span><span className="font-medium">{formatMaybeMoney(metadata.extras_total)}</span></div>
                    <div className="flex justify-between gap-3 border-t border-border pt-3"><span className="text-muted-foreground">Total estimé</span><span className="font-semibold">{formatMaybeMoney(metadata.estimated_total)}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-muted-foreground">Payé</span><span className="font-semibold">{fmtMAD(activeAgencyPaymentTotal(metadata.payments) || Number(metadata.paid_amount || 0))}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-muted-foreground">Reste</span><span className="font-semibold">{formatMaybeMoney(Math.max(0, Number(metadata.estimated_total || 0) - (activeAgencyPaymentTotal(metadata.payments) || Number(metadata.paid_amount || 0))))}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-muted-foreground">Commission</span><span className="font-semibold">{formatMaybeMoney(metadata.estimated_commission, "Commission non renseignée")}</span></div>
                    <p className="text-xs text-muted-foreground">{metadata.commission_rule_label || "Aucune règle commission renseignée"}</p>
                  </div>
                </Card>
              </div>

              <Card className="p-4">
                <h3 className="font-display text-lg">Paiement agence</h3>
                {(metadata.payments ?? []).length === 0 ? (
                  <div className="mt-3 grid gap-3 text-sm sm:grid-cols-4">
                    <div><p className="text-xs text-muted-foreground">Statut paiement</p><p className="font-medium">{metadata.payment_status === "paid" ? "Payé" : "Non payé"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Type</p><p className="font-medium">{metadata.payment_type ? PAYMENT_TYPE_LABELS[metadata.payment_type] ?? metadata.payment_type : "—"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Date</p><p className="font-medium">{metadata.payment_date || "—"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Montant</p><p className="font-medium">{formatMaybeMoney(metadata.paid_amount, "0 MAD")}</p></div>
                    <div className="sm:col-span-4"><p className="text-xs text-muted-foreground">Notes paiement</p><p className="font-medium whitespace-pre-wrap">{metadata.payment_notes || "—"}</p></div>
                  </div>
                ) : (
                  <div className="mt-3 overflow-x-auto rounded-xl border border-border">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead className="bg-secondary/60 text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Montant</th>
                          <th className="px-3 py-2 text-left font-medium">Méthode</th>
                          <th className="px-3 py-2 text-left font-medium">Date</th>
                          <th className="px-3 py-2 text-left font-medium">Référence</th>
                          <th className="px-3 py-2 text-left font-medium">Statut</th>
                          <th className="px-3 py-2 text-left font-medium">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metadata.payments.map((payment) => (
                          <tr key={payment.id} className="border-t border-border">
                            <td className="px-3 py-2 font-semibold">{fmtMAD(payment.amount_mad)}</td>
                            <td className="px-3 py-2">{paymentMethodLabel(payment.method)}</td>
                            <td className="px-3 py-2">{payment.paid_at || "—"}</td>
                            <td className="px-3 py-2">{payment.reference || "—"}</td>
                            <td className="px-3 py-2">{payment.status}</td>
                            <td className="px-3 py-2">{payment.notes || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card className="p-4">
                <h3 className="font-display text-lg">Historique modifications</h3>
                {(metadata.audit_timeline ?? []).length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">Aucun historique agence enregistré.</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {(metadata.audit_timeline ?? []).slice(0, 20).map((entry) => (
                      <div key={entry.id} className="rounded-lg border border-border p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-medium">{entry.action}</p>
                          <p className="text-xs text-muted-foreground">{fmtDateTime(entry.created_at)}</p>
                        </div>
                        <p className="text-xs text-muted-foreground">{entry.actor_label || "Agence"}</p>
                        {entry.changes?.length ? (
                          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                            {entry.changes.map((change, index) => (
                              <p key={`${entry.id}-${change.field}-${index}`}>
                                {change.field}: {String(change.old_value ?? "—")} → {String(change.new_value ?? "—")}
                              </p>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card className="p-4">
                <h3 className="font-display text-lg">Suivi admin</h3>
                <div className="mt-3 grid gap-4 lg:grid-cols-[220px_1fr]">
                  <div className="space-y-2">
                    <Label>Statut</Label>
                    <Select
                      value={adminStatusDraft}
                      onValueChange={(value) => setAdminStatusDraft(value as VisualAgencyStatus)}
                      disabled={agencyRequestBusy === selectedAgencyRequest.id}
                    >
                      <SelectTrigger className="min-h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lead">Lead</SelectItem>
                        <SelectItem value="confirmed">Confirmé</SelectItem>
                        <SelectItem value="paid">Payé</SelectItem>
                        <SelectItem value="cancelled">Annulé</SelectItem>
                        <SelectItem value="rejected">Rejeté</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Lead/confirmé/payé sont mappés sur le statut SQL existant + metadata.</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Notes internes</Label>
                    <Textarea rows={5} value={internalNotesDraft} onChange={(event) => setInternalNotesDraft(event.target.value)} />
                  </div>
                </div>
                <div className="mt-4">
                  <Button variant="outline" onClick={saveInternalNotes} disabled={notesSaving}>
                    {notesSaving ? "Enregistrement…" : "Enregistrer les notes"}
                  </Button>
                </div>
              </Card>

              <Card className="p-4">
                <h3 className="font-display text-lg">Demandes / message</h3>
                <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{metadata.special_requests || selectedAgencyRequest.message || "—"}</p>
              </Card>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedAgencyRequest(null)}>Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedAgencyOrg)} onOpenChange={(open) => !open && setSelectedAgencyOrg(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Profil agence · {selectedAgencyOrg?.display_name || selectedAgencyOrg?.legal_name || "Agence"}</DialogTitle>
          </DialogHeader>
          {selectedAgencyOrg ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {typeof selectedAgencyOrg.metadata?.agency_logo_url === "string" && selectedAgencyOrg.metadata.agency_logo_url && (
                <div className="sm:col-span-2">
                  <img src={selectedAgencyOrg.metadata.agency_logo_url} alt="Logo agence" className="max-h-20 max-w-[220px] rounded border border-border object-contain p-2" />
                </div>
              )}
              <div><p className="text-xs text-muted-foreground">Nom</p><p className="font-medium">{selectedAgencyOrg.display_name || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Raison sociale</p><p className="font-medium">{selectedAgencyOrg.legal_name || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Email</p><p className="font-medium">{selectedAgencyOrg.email || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Téléphone</p><p className="font-medium">{selectedAgencyOrg.phone || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Site web</p><p className="font-medium">{selectedAgencyOrg.website || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Statut</p><p className="font-medium">{selectedAgencyOrg.status || "—"}</p></div>
              <div className="sm:col-span-2">
                <Button asChild variant="outline">
                  <Link to="/admin/organizations">Ouvrir la gestion organisations / commissions</Link>
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Profil agence indisponible.</p>
          )}
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
