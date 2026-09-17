import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarCheck, FileText, Loader2, Plus, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate, fmtDateTime, fmtMAD } from "@/lib/format";
import { useAgencyContext } from "../useAgencyContext";
import type { AgencyBooking, CommissionRule, TripSummary } from "../agencyTypes";
import { AgencyStatusBadge } from "../components/AgencyStatusBadge";
import { commissionRuleColumns, getCommissionScopeLabel } from "../commissionEngine";
import { downloadBytes, generateQuotePdf, generateReceiptPdf } from "@/lib/booking-pdfs";
import {
  HOTEL_SUPPLEMENT,
  PUBLIC_HOTEL_OPTIONS,
  PUBLIC_ROOM_LABELS,
  getRoomAdjustmentPerPerson,
  type PublicHotelKey,
  type PublicRoomKey,
} from "@/lib/booking-options";
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
import { PAYMENT_METHOD_OPTIONS, normalisePaymentMethod, paymentMethodLabel } from "@/lib/payment-methods";

type DbClient = { from: (table: string) => any };
const db = supabase as unknown as DbClient;

const bookingColumns = "id,reference,contact_name,contact_email,contact_phone,status,total_amount_mad,paid_amount_mad,created_at,preferred_dates,trip_id,agency_organization_id,agency_attributed_at,num_adults,num_children";
const requestColumns = "id,organization_id,requested_by,client_full_name,client_email,client_phone,trip_interest,travelers_count,preferred_departure_date,message,status,metadata,created_at";
const tripColumns = "id,title,slug,season,start_date,end_date,destination,destinations,base_price_mad,slots_left,status,label,program_link,programme_id";
const extraColumns = "id,name,description,price_mad,category,city,sort_order";

type PaymentRow = {
  id: string;
  amount_mad: number;
  paid_at: string | null;
  created_at: string | null;
  status: string;
  reference: string | null;
};

type AgencyRequestStatus = "new" | "contacted" | "quoted" | "converted" | "rejected";

type TripOption = {
  id: string;
  title: string;
  slug: string | null;
  season: string | null;
  start_date: string | null;
  end_date: string | null;
  destination: string | null;
  destinations: string[] | null;
  base_price_mad: number | null;
  slots_left: number | null;
  status: string | null;
  label: string | null;
  program_link: string | null;
  programme_id: string | null;
};

type ExtraOption = {
  id: string;
  name: string;
  description: string | null;
  price_mad: number | null;
  category: string | null;
  city: string | null;
  sort_order: number | null;
};

type RequestMetadata = {
  crm_client_id?: string | null;
  trip_id?: string | null;
  trip_title?: string | null;
  destination?: string | null;
  room_type?: PublicRoomKey | string | null;
  hotel_category?: PublicHotelKey | string | null;
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
  payment_status?: "unpaid" | "paid" | null;
  payment_type?: "cash" | "bank_transfer" | "card" | "cheque" | "agency_payment" | "other" | null;
  payment_date?: string | null;
  paid_amount?: number | null;
  payment_reference?: string | null;
  payment_notes?: string | null;
  quote_adjustments?: QuoteAdjustment[];
  payments?: AgencyRequestPayment[];
  audit_timeline?: AgencyAuditEntry[];
};

type AgencyRequestPayment = {
  id: string;
  amount_mad: number;
  method: string;
  paid_at: string;
  reference?: string | null;
  status: "received" | "pending" | "cancelled" | "refunded";
  notes?: string | null;
  created_at: string;
  updated_at?: string | null;
  created_by?: string | null;
};

type AgencyAuditEntry = {
  id: string;
  created_at: string;
  actor_id?: string | null;
  actor_label?: string | null;
  action: string;
  changes?: Array<{ field: string; old_value?: unknown; new_value?: unknown }>;
};

type AgencyBookingRequest = {
  id: string;
  organization_id: string;
  requested_by: string | null;
  client_full_name: string;
  client_email: string | null;
  client_phone: string | null;
  trip_interest: string;
  travelers_count: number;
  preferred_departure_date: string | null;
  message: string | null;
  metadata: RequestMetadata | null;
  status: AgencyRequestStatus;
  created_at: string;
};

const REQUEST_STATUS_LABELS: Record<AgencyRequestStatus, string> = {
  new: "Lead",
  contacted: "Lead contacté",
  quoted: "Devis envoyé",
  converted: "Confirmé",
  rejected: "Rejeté",
};

const ROOM_TYPE_LABELS: Record<string, string> = { ...PUBLIC_ROOM_LABELS, twin: "Twin" };

const HOTEL_CATEGORY_LABELS: Record<string, string> = {
  modern: PUBLIC_HOTEL_OPTIONS.modern.name,
  ryokan: PUBLIC_HOTEL_OPTIONS.ryokan.name,
  standard: "Standard",
  superior: "Supérieur",
  premium: "Premium",
};

const PAYMENT_TYPE_LABELS = Object.fromEntries(PAYMENT_METHOD_OPTIONS.map((option) => [option.value, option.label]));
const PAYMENT_STATUS_LABELS: Record<AgencyRequestPayment["status"], string> = {
  received: "Reçu",
  pending: "En attente",
  cancelled: "Annulé",
  refunded: "Remboursé",
};
const emptyPaymentDraft = () => ({
  amount_mad: "",
  method: "bank_transfer",
  paid_at: new Date().toISOString().slice(0, 10),
  reference: "",
  status: "received" as AgencyRequestPayment["status"],
  notes: "",
});

const formatMaybeMoney = (value: number | null | undefined, fallback = "Prix non renseigné") =>
  value === null || value === undefined ? fallback : fmtMAD(value);

const normalize = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const getTripDestination = (trip: TripOption | null) =>
  trip?.destination || trip?.destinations?.filter(Boolean).join(", ") || null;

const isRuleEffective = (rule: CommissionRule) => {
  const today = new Date().toISOString().slice(0, 10);
  if (rule.starts_at && today < rule.starts_at.slice(0, 10)) return false;
  if (rule.ends_at && today > rule.ends_at.slice(0, 10)) return false;
  return rule.status === "active";
};

const getApplicableRuleForRequest = (rules: CommissionRule[], trip: TripOption | null) => {
  if (!trip) return null;
  const destination = normalize(getTripDestination(trip));
  const title = normalize(trip.title);
  const product = normalize([trip.label, trip.season].filter(Boolean).join(" "));

  return rules
    .filter(isRuleEffective)
    .filter((rule) => {
      if (rule.scope === "agency_default") return true;
      if (rule.scope === "trip_override") return Boolean(rule.trip_id && rule.trip_id === trip.id);
      if (rule.scope === "product") {
        const target = normalize(rule.product_type);
        return Boolean(target && (product.includes(target) || title.includes(target) || destination.includes(target)));
      }
      if (rule.scope === "destination") {
        const target = normalize(rule.destination);
        return Boolean(target && (destination.includes(target) || title.includes(target)));
      }
      return false;
    })
    .sort((a, b) => {
      const scopeWeight = { trip_override: 0, product: 1, destination: 2, agency_default: 3 };
      return scopeWeight[a.scope] - scopeWeight[b.scope];
    })[0] ?? null;
};

const calculateCommission = (total: number | null, rule: CommissionRule | null) => {
  if (!rule || total === null) return null;
  if (rule.rule_type === "fixed_amount") return Number(rule.value || 0);
  return Math.round((total * Number(rule.value || 0)) / 100);
};

const extrasToQuantityMap = (extras: RequestMetadata["selected_extras"]) =>
  (extras ?? []).reduce<Record<string, number>>((acc, extra) => {
    const id = extra.extra_id || extra.id;
    if (id) acc[id] = Math.max(0, Number(extra.quantity ?? 1));
    return acc;
  }, {});

const requestPaymentsFromMetadata = (metadata?: RequestMetadata | null): AgencyRequestPayment[] => {
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

const activePaymentTotal = (payments: AgencyRequestPayment[]) =>
  payments
    .filter((payment) => payment.status !== "cancelled" && payment.status !== "refunded")
    .reduce((sum, payment) => sum + Number(payment.amount_mad || 0), 0);

const makeAuditEntry = (
  action: string,
  changes: AgencyAuditEntry["changes"],
  actorId?: string | null,
  actorLabel = "Agence"
): AgencyAuditEntry => ({
  id: crypto.randomUUID(),
  created_at: new Date().toISOString(),
  actor_id: actorId ?? null,
  actor_label: actorLabel,
  action,
  changes,
});

export default function AgencyBookingDetail() {
  const { id } = useParams();
  const { organization, currentMembership } = useAgencyContext();
  const [booking, setBooking] = useState<AgencyBooking | null>(null);
  const [request, setRequest] = useState<AgencyBookingRequest | null>(null);
  const [requestForm, setRequestForm] = useState({
    client_full_name: "",
    client_email: "",
    client_phone: "",
    trip_id: "",
    travelers_count: "1",
    room_type: "double" as PublicRoomKey,
    hotel_category: "modern" as PublicHotelKey,
    selected_extras: {} as Record<string, number>,
    special_requests: "",
    status: "lead" as "lead" | "confirmed" | "paid",
    payment_type: "bank_transfer",
    payment_date: "",
    paid_amount: "",
    payment_reference: "",
    payment_notes: "",
  });
  const [tripOptions, setTripOptions] = useState<TripOption[]>([]);
  const [extraOptions, setExtraOptions] = useState<ExtraOption[]>([]);
  const [commissionRules, setCommissionRules] = useState<CommissionRule[]>([]);
  const [requestSaving, setRequestSaving] = useState(false);
  const [pdfBusy, setPdfBusy] = useState<"quote" | "receipt" | null>(null);
  const [adjustmentDialogOpen, setAdjustmentDialogOpen] = useState(false);
  const [editingAdjustmentId, setEditingAdjustmentId] = useState<string | null>(null);
  const [adjustmentDraft, setAdjustmentDraft] = useState<QuoteAdjustmentDraft>(emptyQuoteAdjustmentDraft);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [paymentDraft, setPaymentDraft] = useState(emptyPaymentDraft);
  const [trip, setTrip] = useState<TripSummary | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const loadRequestOptions = async () => {
    const [{ data: tripsData }, { data: extrasData }] = await Promise.all([
      db
        .from("trips")
        .select(tripColumns)
        .is("archived_at", null)
        .in("status", ["open", "completed"])
        .order("start_date", { ascending: true, nullsFirst: false }),
      db
        .from("extras")
        .select(extraColumns)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
    ]);
    setTripOptions((tripsData ?? []) as TripOption[]);
    setExtraOptions((extrasData ?? []) as ExtraOption[]);
  };

  const loadCommissionRules = async () => {
    if (!organization) return;
    const { data } = await db
      .from("commission_engine_rules")
      .select(commissionRuleColumns)
      .eq("organization_id", organization.id)
      .eq("status", "active");
    setCommissionRules((data ?? []) as CommissionRule[]);
  };

  useEffect(() => {
    const load = async () => {
      if (!id || !organization) return;
      setLoading(true);
      setNotFound(false);

      const { data, error } = await db
        .from("bookings")
        .select(bookingColumns)
        .eq("id", id)
        .eq("agency_organization_id", organization.id)
        .maybeSingle();

      if (error || !data) {
        const { data: requestData, error: requestError } = await db
          .from("agency_booking_requests")
          .select(requestColumns)
          .eq("id", id)
          .eq("organization_id", organization.id)
          .maybeSingle();

        if (requestError || !requestData) {
          setBooking(null);
          setRequest(null);
          setNotFound(true);
          setLoading(false);
          return;
        }

        const requestRow = requestData as AgencyBookingRequest;
        setBooking(null);
        setRequest(requestRow);
        setRequestForm({
          client_full_name: requestRow.client_full_name ?? "",
          client_email: requestRow.client_email ?? "",
          client_phone: requestRow.client_phone ?? "",
          trip_id: requestRow.metadata?.trip_id ?? "",
          travelers_count: String(requestRow.travelers_count ?? 1),
          room_type: (requestRow.metadata?.room_type === "single" || requestRow.metadata?.room_type === "triple" ? requestRow.metadata.room_type : "double") as PublicRoomKey,
          hotel_category: (requestRow.metadata?.hotel_category === "ryokan" ? "ryokan" : "modern") as PublicHotelKey,
          selected_extras: extrasToQuantityMap(requestRow.metadata?.selected_extras),
          special_requests: requestRow.metadata?.special_requests ?? requestRow.message ?? "",
          status: requestRow.metadata?.payment_status === "paid" ? "paid" : requestRow.status === "converted" ? "confirmed" : "lead",
          payment_type: requestRow.metadata?.payment_type ?? "bank_transfer",
          payment_date: requestRow.metadata?.payment_date ?? "",
          paid_amount: requestRow.metadata?.paid_amount === null || requestRow.metadata?.paid_amount === undefined ? "" : String(requestRow.metadata.paid_amount),
          payment_reference: requestRow.metadata?.payment_reference ?? "",
          payment_notes: requestRow.metadata?.payment_notes ?? "",
        });
        void loadRequestOptions();
        void loadCommissionRules();
        setNotFound(false);
        setLoading(false);
        return;
      }

      const bookingRow = data as AgencyBooking;
      setBooking(bookingRow);
      setRequest(null);

      const requests: Promise<any>[] = [
        db
          .from("payments")
          .select("id,amount_mad,paid_at,created_at,status,reference")
          .eq("booking_id", bookingRow.id)
          .order("paid_at", { ascending: false, nullsFirst: false }),
      ];

      if (bookingRow.trip_id) {
        requests.push(
          db
            .from("trips")
            .select("id,title,start_date,end_date,destination")
            .eq("id", bookingRow.trip_id)
            .maybeSingle()
        );
      }

      const [paymentResult, tripResult] = await Promise.all(requests);
      setPayments(((paymentResult?.data ?? []) as PaymentRow[]).filter((payment) => payment.status !== "cancelled"));
      setTrip((tripResult?.data ?? null) as TripSummary | null);
      setLoading(false);
    };
    load();
  }, [id, organization?.id]);

  const saveRequest = async () => {
    if (!request) return;
    if (!requestForm.client_full_name.trim()) {
      toast.error("Le nom du client est obligatoire.");
      return;
    }
    const selectedTrip = tripOptions.find((tripOption) => tripOption.id === requestForm.trip_id) ?? null;
    const travelersCount = Number(requestForm.travelers_count);
    const safeTravelersCount = Number.isFinite(travelersCount) && travelersCount > 0 ? Math.floor(travelersCount) : 1;
    if (!selectedTrip && requestForm.trip_id && tripOptions.length > 0) {
      toast.error("Le voyage sélectionné n'est plus disponible.");
      return;
    }
    const selectedExtras = extraOptions
      .map((extra) => ({ extra, quantity: Number(requestForm.selected_extras[extra.id] ?? 0) }))
      .filter((item) => item.quantity > 0);
    const shouldRefreshExtras = extraOptions.length > 0;
    const tripBasePrice = selectedTrip?.base_price_mad ?? request.metadata?.base_price ?? null;
    const basePriceTotal = tripBasePrice === null || tripBasePrice === undefined ? null : Number(tripBasePrice) * safeTravelersCount;
    const roomSupplementTotal = getRoomAdjustmentPerPerson(requestForm.room_type) * safeTravelersCount;
    const hotelSupplementTotal = (HOTEL_SUPPLEMENT[requestForm.hotel_category] ?? 0) * safeTravelersCount;
    const extrasTotal = shouldRefreshExtras
      ? selectedExtras.reduce((sum, item) => sum + Number(item.extra.price_mad ?? 0) * item.quantity, 0)
      : Number(request.metadata?.extras_total ?? 0);
    const estimatedTotal = basePriceTotal === null
      ? null
      : basePriceTotal + roomSupplementTotal + hotelSupplementTotal + extrasTotal;
    const applicableCommissionRule = getApplicableRuleForRequest(commissionRules, selectedTrip);
    const estimatedCommission = calculateCommission(estimatedTotal, applicableCommissionRule);
    const nextDbStatus: AgencyRequestStatus = requestForm.status === "lead" ? "new" : "converted";
    const paidAmount = requestForm.paid_amount.trim() ? Number(requestForm.paid_amount) : null;
    setRequestSaving(true);
    const auditChanges = [
      request.client_full_name !== requestForm.client_full_name.trim()
        ? { field: "client_full_name", old_value: request.client_full_name, new_value: requestForm.client_full_name.trim() }
        : null,
      request.client_email !== (requestForm.client_email.trim() || null)
        ? { field: "client_email", old_value: request.client_email, new_value: requestForm.client_email.trim() || null }
        : null,
      request.client_phone !== (requestForm.client_phone.trim() || null)
        ? { field: "client_phone", old_value: request.client_phone, new_value: requestForm.client_phone.trim() || null }
        : null,
      Number(request.travelers_count ?? 1) !== safeTravelersCount
        ? { field: "travelers_count", old_value: request.travelers_count, new_value: safeTravelersCount }
        : null,
      request.metadata?.room_type !== requestForm.room_type
        ? { field: "room_type", old_value: request.metadata?.room_type, new_value: requestForm.room_type }
        : null,
      request.metadata?.hotel_category !== requestForm.hotel_category
        ? { field: "hotel_category", old_value: request.metadata?.hotel_category, new_value: requestForm.hotel_category }
        : null,
      request.metadata?.special_requests !== (requestForm.special_requests.trim() || null)
        ? { field: "special_requests", old_value: request.metadata?.special_requests, new_value: requestForm.special_requests.trim() || null }
        : null,
      request.status !== nextDbStatus
        ? { field: "status", old_value: request.status, new_value: nextDbStatus }
        : null,
    ].filter(Boolean) as AgencyAuditEntry["changes"];
    const nextMetadata = {
      ...(request.metadata ?? {}),
      trip_id: selectedTrip?.id ?? request.metadata?.trip_id ?? null,
      trip_title: selectedTrip?.title ?? request.metadata?.trip_title ?? request.trip_interest,
      destination: selectedTrip ? getTripDestination(selectedTrip) : request.metadata?.destination ?? null,
      room_type: requestForm.room_type,
      hotel_category: requestForm.hotel_category,
      selected_extras: shouldRefreshExtras
        ? selectedExtras.map(({ extra, quantity }) => ({
            extra_id: extra.id,
            id: extra.id,
            name: extra.name,
            unit_price: extra.price_mad,
            price_mad: extra.price_mad,
            quantity,
            total: extra.price_mad === null || extra.price_mad === undefined ? null : Number(extra.price_mad) * quantity,
          }))
        : request.metadata?.selected_extras ?? [],
      base_price: tripBasePrice,
      room_supplement: roomSupplementTotal,
      hotel_supplement: hotelSupplementTotal,
      extras_total: extrasTotal,
      estimated_total: estimatedTotal,
      estimated_commission: estimatedCommission,
      commission_rule_id: applicableCommissionRule?.id ?? request.metadata?.commission_rule_id ?? null,
      commission_rule_label: applicableCommissionRule ? getCommissionScopeLabel(applicableCommissionRule) : request.metadata?.commission_rule_label ?? null,
      special_requests: requestForm.special_requests.trim() || null,
      payment_status: requestForm.status === "paid" ? "paid" : "unpaid",
      payment_type: requestForm.payment_type || null,
      payment_date: requestForm.payment_date || null,
      paid_amount: Number.isFinite(paidAmount) ? paidAmount : null,
      payment_reference: requestForm.payment_reference.trim() || null,
      payment_notes: requestForm.payment_notes.trim() || null,
      audit_timeline: auditChanges.length
        ? [
            makeAuditEntry("reservation_updated", auditChanges, currentMembership?.user_id, "Agence"),
            ...(request.metadata?.audit_timeline ?? []),
          ].slice(0, 80)
        : request.metadata?.audit_timeline ?? [],
    };
    const { data, error } = await db
      .from("agency_booking_requests")
      .update({
        client_full_name: requestForm.client_full_name.trim(),
        client_email: requestForm.client_email.trim() || null,
        client_phone: requestForm.client_phone.trim() || null,
        trip_interest: selectedTrip?.title ?? request.trip_interest,
        travelers_count: safeTravelersCount,
        preferred_departure_date: selectedTrip?.start_date ?? request.preferred_departure_date,
        message: requestForm.special_requests.trim() || null,
        metadata: nextMetadata,
        status: nextDbStatus,
      })
      .eq("id", request.id)
      .eq("organization_id", organization?.id ?? request.organization_id)
      .select(requestColumns)
      .maybeSingle();

    if (error) {
      toast.error(error.message ?? "Impossible d'enregistrer la demande.");
      setRequestSaving(false);
      return;
    }
    setRequest((data ?? { ...request, ...requestForm, metadata: nextMetadata }) as AgencyBookingRequest);
    toast.success("Demande mise à jour.");
    setRequestSaving(false);
  };

  const setRequestExtraQuantity = (extraId: string, quantity: number) => {
    const safeQuantity = Math.max(0, Math.floor(Number.isFinite(quantity) ? quantity : 0));
    setRequestForm((current) => ({
      ...current,
      selected_extras: {
        ...current.selected_extras,
        [extraId]: safeQuantity,
      },
    }));
  };

  const saveRequestAdjustments = async (nextAdjustments: QuoteAdjustment[]) => {
    if (!request) return false;
    const cleaned = nextAdjustments.map((adjustment) => ({
      ...adjustment,
      amount: Number(adjustment.amount || 0),
      visible_on_quote: adjustment.visible_on_quote !== false,
      source: adjustment.source ?? "agency",
    }));
    const nextMetadata = {
      ...(request.metadata ?? {}),
      quote_adjustments: cleaned,
    };
    const { data, error } = await db
      .from("agency_booking_requests")
      .update({ metadata: nextMetadata })
      .eq("id", request.id)
      .eq("organization_id", request.organization_id)
      .select(requestColumns)
      .maybeSingle();

    if (error) {
      toast.error(error.message ?? "Impossible d'enregistrer les ajustements devis.");
      return false;
    }
    setRequest((data ?? { ...request, metadata: nextMetadata }) as AgencyBookingRequest);
    toast.success("Ajustements devis enregistrés.");
    return true;
  };

  const openRequestAdjustmentDialog = (adjustment?: QuoteAdjustment) => {
    setEditingAdjustmentId(adjustment?.id ?? null);
    setAdjustmentDraft(adjustment ? draftFromQuoteAdjustment(adjustment) : emptyQuoteAdjustmentDraft());
    setAdjustmentDialogOpen(true);
  };

  const saveRequestAdjustmentDraft = async () => {
    if (!request) return;
    const amount = Number(adjustmentDraft.amount || 0);
    if (!adjustmentDraft.label.trim()) {
      toast.error("Le libellé est obligatoire.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Le montant doit être supérieur à 0.");
      return;
    }
    const currentAdjustments = quoteAdjustmentsFromRequestMetadata(request.metadata);
    const existing = currentAdjustments.find((adjustment) => adjustment.id === editingAdjustmentId) ?? null;
    const nextAdjustment = makeQuoteAdjustment(adjustmentDraft, currentMembership?.user_id ?? request.requested_by, "agency", existing);
    const nextAdjustments = existing
      ? currentAdjustments.map((adjustment) => adjustment.id === existing.id ? nextAdjustment : adjustment)
      : [...currentAdjustments, nextAdjustment];
    const saved = await saveRequestAdjustments(nextAdjustments);
    if (saved) setAdjustmentDialogOpen(false);
  };

  const deleteRequestAdjustment = async (adjustment: QuoteAdjustment) => {
    if (!request) return;
    if (!confirm(`Supprimer la ligne "${adjustment.label}" ?`)) return;
    const currentAdjustments = quoteAdjustmentsFromRequestMetadata(request.metadata);
    await saveRequestAdjustments(currentAdjustments.filter((item) => item.id !== adjustment.id));
  };

  const openPaymentDialog = (payment?: AgencyRequestPayment) => {
    setEditingPaymentId(payment?.id ?? null);
    setPaymentDraft(payment ? {
      amount_mad: String(payment.amount_mad ?? ""),
      method: normalisePaymentMethod(payment.method),
      paid_at: payment.paid_at ? payment.paid_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
      reference: payment.reference ?? "",
      status: payment.status ?? "received",
      notes: payment.notes ?? "",
    } : emptyPaymentDraft());
    setPaymentDialogOpen(true);
  };

  const saveRequestPayments = async (nextPayments: AgencyRequestPayment[], action: string, changes: AgencyAuditEntry["changes"]) => {
    if (!request) return false;
    const totalPaid = activePaymentTotal(nextPayments);
    const latestPayment = nextPayments.find((payment) => payment.status === "received") ?? nextPayments[0] ?? null;
    const nextMetadata: RequestMetadata = {
      ...(request.metadata ?? {}),
      payments: nextPayments,
      paid_amount: totalPaid,
      payment_status: totalPaid > 0 ? "paid" : "unpaid",
      payment_type: latestPayment?.method ?? request.metadata?.payment_type ?? null,
      payment_date: latestPayment?.paid_at ?? request.metadata?.payment_date ?? null,
      payment_reference: latestPayment?.reference ?? request.metadata?.payment_reference ?? null,
      payment_notes: latestPayment?.notes ?? request.metadata?.payment_notes ?? null,
      audit_timeline: [
        makeAuditEntry(action, changes, currentMembership?.user_id, "Agence"),
        ...(request.metadata?.audit_timeline ?? []),
      ].slice(0, 80),
    };
    const nextStatus: AgencyRequestStatus = totalPaid > 0 ? "converted" : request.status;
    const { data, error } = await db
      .from("agency_booking_requests")
      .update({ metadata: nextMetadata, status: nextStatus })
      .eq("id", request.id)
      .eq("organization_id", request.organization_id)
      .select(requestColumns)
      .maybeSingle();

    if (error) {
      toast.error(error.message ?? "Impossible d'enregistrer le paiement.");
      return false;
    }
    setRequest((data ?? { ...request, metadata: nextMetadata, status: nextStatus }) as AgencyBookingRequest);
    setRequestForm((current) => ({
      ...current,
      status: totalPaid > 0 ? "paid" : current.status,
      paid_amount: totalPaid ? String(totalPaid) : "",
      payment_type: latestPayment?.method ?? current.payment_type,
      payment_date: latestPayment?.paid_at ?? current.payment_date,
      payment_reference: latestPayment?.reference ?? current.payment_reference,
      payment_notes: latestPayment?.notes ?? current.payment_notes,
    }));
    return true;
  };

  const savePaymentDraft = async () => {
    if (!request) return;
    const amount = Number(paymentDraft.amount_mad);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Le montant doit être supérieur à 0.");
      return;
    }
    const currentPayments = requestPaymentsFromMetadata(request.metadata);
    const existing = currentPayments.find((payment) => payment.id === editingPaymentId) ?? null;
    const nextPayment: AgencyRequestPayment = {
      id: existing?.id ?? crypto.randomUUID(),
      amount_mad: amount,
      method: normalisePaymentMethod(paymentDraft.method),
      paid_at: paymentDraft.paid_at || new Date().toISOString().slice(0, 10),
      reference: paymentDraft.reference.trim() || null,
      status: paymentDraft.status,
      notes: paymentDraft.notes.trim() || null,
      created_at: existing?.created_at ?? new Date().toISOString(),
      updated_at: existing ? new Date().toISOString() : null,
      created_by: existing?.created_by ?? currentMembership?.user_id ?? null,
    };
    const nextPayments = existing
      ? currentPayments.map((payment) => payment.id === existing.id ? nextPayment : payment)
      : [nextPayment, ...currentPayments.filter((payment) => payment.id !== "legacy-payment")];
    const saved = await saveRequestPayments(nextPayments, existing ? "payment_updated" : "payment_added", [
      { field: "payment", old_value: existing ?? null, new_value: nextPayment },
    ]);
    if (saved) {
      void supabase.functions.invoke("send-admin-notification", {
        body: { type: "agency_payment", payload: { request_id: saved.id, payment_id: nextPayment.id } },
      }).then(({ data, error }) => {
        if (error || data?.ok === false) console.warn("agency payment notification failed", data ?? error);
      });
      setPaymentDialogOpen(false);
      toast.success(existing ? "Paiement mis à jour." : "Paiement ajouté.");
    }
  };

  const deleteRequestPayment = async (payment: AgencyRequestPayment) => {
    if (!request) return;
    if (!confirm(`Supprimer le paiement de ${fmtMAD(payment.amount_mad)} ?`)) return;
    const currentPayments = requestPaymentsFromMetadata(request.metadata);
    const nextPayments = currentPayments.filter((item) => item.id !== payment.id);
    const saved = await saveRequestPayments(nextPayments, "payment_deleted", [
      { field: "payment", old_value: payment, new_value: null },
    ]);
    if (saved) toast.success("Paiement supprimé.");
  };

  const buildRequestPdfData = () => {
    if (!request) return null;
    const metadata = request.metadata ?? {};
    const quoteAdjustments = quoteAdjustmentsFromRequestMetadata(metadata);
    const requestPayments = requestPaymentsFromMetadata(metadata);
    const paidTotal = activePaymentTotal(requestPayments);
    const extras = (metadata.selected_extras ?? []).map((extra) => ({
      name_snapshot: extra.name || "Extra",
      qty: Number(extra.quantity ?? 1),
      unit_price_mad: Number(extra.unit_price ?? extra.price_mad ?? 0),
    }));
    const adjustedTotal = summarizeQuoteAdjustments(quoteAdjustments, Number(metadata.estimated_total ?? 0)).finalTotal;
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
    };
    const tripLike = {
      title: metadata.trip_title || request.trip_interest,
      season: metadata.destination ?? null,
      start_date: request.preferred_departure_date,
      end_date: null,
    };
    const agency = {
      agency_display_name: organization?.display_name ?? undefined,
      legal_company_name: organization?.legal_name ?? organization?.display_name ?? undefined,
      brand_name: organization?.display_name ?? "Agence partenaire",
      email: organization?.email ?? undefined,
      phone: organization?.phone ?? undefined,
      website: organization?.website ?? undefined,
      address_line_1: organization?.address_line_1 ?? undefined,
      address_line_2: organization?.address_line_2 ?? undefined,
      city: organization?.city ?? undefined,
      postal_code: organization?.postal_code ?? undefined,
      country: organization?.country ?? undefined,
      logo_url: typeof organization?.metadata?.agency_logo_url === "string" ? organization.metadata.agency_logo_url : undefined,
      is_partner_agency: true,
    };
    return { bookingLike, tripLike, extras, agency, quoteAdjustments, adjustedTotal, requestPayments };
  };

  const generateRequestQuote = async () => {
    const pdfData = buildRequestPdfData();
    if (!request || !pdfData) return;
    setPdfBusy("quote");
    try {
      const bytes = await generateQuotePdf({
        booking: pdfData.bookingLike,
        trip: pdfData.tripLike,
        extras: pdfData.extras,
        quote_adjustments: pdfData.quoteAdjustments,
        number: `DEVIS-AG-${request.id.slice(0, 8).toUpperCase()}`,
        agency: pdfData.agency,
      });
      downloadBytes(bytes, `devis-agence-${request.id.slice(0, 8)}.pdf`);
    } catch (error: any) {
      toast.error(error?.message ?? "Impossible de générer le devis.");
    } finally {
      setPdfBusy(null);
    }
  };

  const generateRequestReceipt = async () => {
    const pdfData = buildRequestPdfData();
    if (!request || !pdfData) return;
    const metadata = request.metadata ?? {};
    const latestPayment = pdfData.requestPayments.find((payment) => payment.status === "received") ?? pdfData.requestPayments[0] ?? null;
    if (!latestPayment) {
      toast.error("Ajoutez un paiement avant de générer le reçu.");
      return;
    }
    setPdfBusy("receipt");
    try {
      const bytes = await generateReceiptPdf({
        booking: pdfData.bookingLike,
        trip: pdfData.tripLike,
        extras: pdfData.extras,
        quote_adjustments: pdfData.quoteAdjustments,
        payment: {
          amount_mad: latestPayment.amount_mad,
          method: latestPayment.method,
          paid_at: latestPayment.paid_at ?? new Date().toISOString(),
          reference: latestPayment.reference || `AG-${request.id.slice(0, 8).toUpperCase()}`,
        },
        number: `RECU-AG-${request.id.slice(0, 8).toUpperCase()}`,
        agency: pdfData.agency,
      });
      downloadBytes(bytes, `recu-agence-${request.id.slice(0, 8)}.pdf`);
    } catch (error: any) {
      toast.error(error?.message ?? "Impossible de générer le reçu.");
    } finally {
      setPdfBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Chargement…
      </div>
    );
  }

  if (notFound || (!booking && !request)) {
    return (
      <div className="space-y-6">
        <Button asChild variant="outline">
          <Link to="/agency/bookings"><ArrowLeft className="h-4 w-4" /> Retour</Link>
        </Button>
        <Card className="p-12 text-center">
          <CalendarCheck className="mx-auto h-10 w-10 text-muted-foreground" />
          <h1 className="mt-3 font-display text-2xl">Réservation introuvable</h1>
          <p className="mt-1 text-sm text-muted-foreground">Cette réservation n'est pas attribuée à votre agence.</p>
        </Card>
      </div>
    );
  }

  if (request) {
    const metadata = request.metadata ?? {};
    const selectedTrip = tripOptions.find((tripOption) => tripOption.id === requestForm.trip_id) ?? null;
    const selectedExtras = extraOptions
      .map((extra) => ({ extra, quantity: Number(requestForm.selected_extras[extra.id] ?? 0) }))
      .filter((item) => item.quantity > 0);
    const displayExtras = selectedExtras.length > 0 ? selectedExtras : (metadata.selected_extras ?? []).map((extra) => ({
      extra: {
        id: extra.extra_id || extra.id || extra.name || "extra",
        name: extra.name || "Extra",
        description: null,
        price_mad: extra.unit_price ?? extra.price_mad ?? null,
        category: null,
        city: null,
        sort_order: null,
      },
      quantity: Number(extra.quantity ?? 1),
      total: extra.total ?? null,
    }));
    const travelersCount = Number(requestForm.travelers_count);
    const safeTravelersCount = Number.isFinite(travelersCount) && travelersCount > 0 ? Math.floor(travelersCount) : 1;
    const tripBasePrice = selectedTrip?.base_price_mad ?? metadata.base_price ?? null;
    const basePriceTotal = tripBasePrice === null || tripBasePrice === undefined ? null : Number(tripBasePrice) * safeTravelersCount;
    const roomSupplementTotal = getRoomAdjustmentPerPerson(requestForm.room_type) * safeTravelersCount;
    const hotelSupplementTotal = (HOTEL_SUPPLEMENT[requestForm.hotel_category] ?? 0) * safeTravelersCount;
    const extrasTotal = selectedExtras.length > 0
      ? selectedExtras.reduce((sum, item) => sum + Number(item.extra.price_mad ?? 0) * item.quantity, 0)
      : Number(metadata.extras_total ?? 0);
    const applicableCommissionRule = getApplicableRuleForRequest(commissionRules, selectedTrip);
    const estimatedTotal = basePriceTotal === null ? metadata.estimated_total ?? null : basePriceTotal + roomSupplementTotal + hotelSupplementTotal + extrasTotal;
    const estimatedCommission = selectedTrip ? calculateCommission(estimatedTotal, applicableCommissionRule) : metadata.estimated_commission ?? null;
    const paymentLocked = requestForm.status === "paid";
    const requestAdjustments = quoteAdjustmentsFromRequestMetadata(metadata);
    const requestAdjustmentSummary = summarizeQuoteAdjustments(requestAdjustments, Number(estimatedTotal ?? 0));
    const requestPayments = requestPaymentsFromMetadata(metadata);
    const paidTotal = activePaymentTotal(requestPayments);
    const requestAuditTimeline = metadata.audit_timeline ?? [];
    return (
      <div className="space-y-6">
        <Button asChild variant="outline">
          <Link to="/agency/bookings"><ArrowLeft className="h-4 w-4" /> Réservations</Link>
        </Button>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="font-display text-3xl">Demande agence</h1>
            <p className="mt-1 text-sm text-muted-foreground">Créée le {fmtDateTime(request.created_at)}</p>
            <p className="mt-1 text-sm font-medium">{metadata.trip_title || request.trip_interest}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={generateRequestQuote} disabled={pdfBusy !== null}>
              {pdfBusy === "quote" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              Générer devis
            </Button>
            <Button variant="outline" onClick={generateRequestReceipt} disabled={pdfBusy !== null}>
              {pdfBusy === "receipt" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}
              Générer reçu de paiement
            </Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2">
            <h2 className="font-display text-xl">Client</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Nom</Label>
                <Input value={requestForm.client_full_name} disabled={paymentLocked} onChange={(event) => setRequestForm((current) => ({ ...current, client_full_name: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={requestForm.client_email} disabled={paymentLocked} onChange={(event) => setRequestForm((current) => ({ ...current, client_email: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Téléphone</Label>
                <Input value={requestForm.client_phone} disabled={paymentLocked} onChange={(event) => setRequestForm((current) => ({ ...current, client_phone: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Voyageurs</Label>
                <Input type="number" min={1} value={requestForm.travelers_count} disabled={paymentLocked} onChange={(event) => setRequestForm((current) => ({ ...current, travelers_count: event.target.value }))} />
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="font-display text-xl">Résumé estimatif</h2>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Base voyage</span><span className="font-semibold">{formatMaybeMoney(basePriceTotal)}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Chambre / hôtel</span><span className="font-semibold">{fmtMAD(roomSupplementTotal + hotelSupplementTotal)}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Extras</span><span className="font-semibold">{fmtMAD(extrasTotal)}</span></div>
              <div className="flex justify-between gap-3 border-t border-border pt-3"><span className="text-muted-foreground">Total estimatif</span><span className="font-semibold">{formatMaybeMoney(estimatedTotal)}</span></div>
              {requestAdjustmentSummary.supplementsTotal > 0 && (
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">Suppléments devis</span><span className="font-semibold">+{fmtMAD(requestAdjustmentSummary.supplementsTotal)}</span></div>
              )}
              {requestAdjustmentSummary.discountsTotal > 0 && (
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">Réductions devis</span><span className="font-semibold">-{fmtMAD(requestAdjustmentSummary.discountsTotal)}</span></div>
              )}
              <div className="flex justify-between gap-3 border-t border-border pt-3"><span className="text-muted-foreground">Total devis final</span><span className="font-semibold">{fmtMAD(requestAdjustmentSummary.finalTotal)}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Payé</span><span className="font-semibold">{fmtMAD(paidTotal)}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Reste</span><span className="font-semibold">{formatMaybeMoney(Math.max(0, requestAdjustmentSummary.finalTotal - paidTotal))}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Commission</span><span className="font-semibold">{formatMaybeMoney(estimatedCommission, "Commission non renseignée")}</span></div>
              <p className="text-xs text-muted-foreground">{applicableCommissionRule ? getCommissionScopeLabel(applicableCommissionRule) : metadata.commission_rule_label || "Règle commission non renseignée"}</p>
            </div>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="font-display text-xl">Voyage</h2>
            <div className="mt-4 space-y-4 text-sm">
              <div className="space-y-2">
                <Label>Programme / voyage</Label>
                <Select value={requestForm.trip_id || "none"} disabled={paymentLocked} onValueChange={(value) => setRequestForm((current) => ({ ...current, trip_id: value === "none" ? "" : value }))}>
                  <SelectTrigger><SelectValue placeholder="Sélectionner un voyage" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Aucun voyage sélectionné</SelectItem>
                    {tripOptions.map((tripOption) => (
                      <SelectItem key={tripOption.id} value={tripOption.id}>{tripOption.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><p className="text-xs text-muted-foreground">Destination</p><p className="font-medium">{selectedTrip ? getTripDestination(selectedTrip) || "—" : metadata.destination || "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Départ</p><p className="font-medium">{selectedTrip?.start_date ? fmtDate(selectedTrip.start_date) : request.preferred_departure_date ? fmtDate(request.preferred_departure_date) : "—"}</p></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Chambre</Label>
                  <Select value={requestForm.room_type} disabled={paymentLocked} onValueChange={(value) => setRequestForm((current) => ({ ...current, room_type: value as PublicRoomKey }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(PUBLIC_ROOM_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Hébergement</Label>
                  <Select value={requestForm.hotel_category} disabled={paymentLocked} onValueChange={(value) => setRequestForm((current) => ({ ...current, hotel_category: value as PublicHotelKey }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(PUBLIC_HOTEL_OPTIONS).map(([value, option]) => (
                        <SelectItem key={value} value={value}>{option.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="font-display text-xl">Extras</h2>
            <div className="mt-4 space-y-3 text-sm">
              {extraOptions.length > 0 && !paymentLocked && (
                <div className="space-y-2">
                  {extraOptions.map((extra) => {
                    const quantity = Number(requestForm.selected_extras[extra.id] ?? 0);
                    return (
                      <div key={extra.id} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_120px] sm:items-center">
                        <div>
                          <p className="font-medium">{extra.name}</p>
                          <p className="text-xs text-muted-foreground">{formatMaybeMoney(extra.price_mad, "prix non renseigné")}</p>
                        </div>
                        <Input type="number" min={0} value={quantity} onChange={(event) => setRequestExtraQuantity(extra.id, Number(event.target.value))} />
                      </div>
                    );
                  })}
                </div>
              )}
              {displayExtras.length === 0 ? (
                <p className="text-muted-foreground">Aucun extra sélectionné.</p>
              ) : displayExtras.map((item) => (
                <div key={item.extra.id} className="flex justify-between gap-3">
                  <span>{item.extra.name || "Extra"} x{item.quantity}</span>
                  <span className="font-medium">{formatMaybeMoney("total" in item ? item.total : Number(item.extra.price_mad ?? 0) * item.quantity, "prix non renseigné")}</span>
                </div>
              ))}
              <div className="flex justify-between gap-3 border-t border-border pt-3">
                <span className="text-muted-foreground">Total extras</span>
                <span className="font-semibold">{fmtMAD(extrasTotal)}</span>
              </div>
            </div>
          </Card>
        </div>

        <Card className="p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-xl">Ajustements devis</h2>
              <p className="text-sm text-muted-foreground">Réductions et suppléments spécifiques à cette demande agence.</p>
            </div>
            <Button type="button" onClick={() => openRequestAdjustmentDialog()} className="min-h-11">
              <Plus className="h-4 w-4" />
              Ajouter une ligne
            </Button>
          </div>
          {requestAdjustments.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              Aucune ligne spéciale ajoutée.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[680px] text-sm">
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
                  {requestAdjustments.map((adjustment) => {
                    const value = adjustmentAmount(adjustment, Number(metadata.estimated_total ?? 0));
                    return (
                      <tr key={adjustment.id} className="border-t border-border">
                        <td className="px-3 py-2">{adjustment.type === "discount" ? "Réduction" : "Supplément"}</td>
                        <td className="px-3 py-2">
                          <p className="font-medium">{adjustment.label}</p>
                          {adjustment.reason && <p className="text-xs text-muted-foreground">{adjustment.reason}</p>}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{adjustment.calculation_type === "percentage" ? `${adjustment.amount}%` : "Fixe"}</td>
                        <td className="px-3 py-2 text-right font-medium">{adjustment.type === "discount" ? "-" : "+"}{fmtMAD(value)}</td>
                        <td className="px-3 py-2 text-muted-foreground">{adjustment.visible_on_quote === false ? "Masqué" : "Visible"}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <Button type="button" size="sm" variant="ghost" onClick={() => openRequestAdjustmentDialog(adjustment)}>Modifier</Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => deleteRequestAdjustment(adjustment)}>Supprimer</Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-display text-xl">Statut réservation</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Statut réservation</Label>
              <Select value={requestForm.status} onValueChange={(value) => setRequestForm((current) => ({ ...current, status: value as "lead" | "confirmed" | "paid" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead">Lead</SelectItem>
                  <SelectItem value="confirmed">Confirmé</SelectItem>
                  <SelectItem value="paid">Payé</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 p-3 text-sm">
              <p className="text-xs text-muted-foreground">Total paiements enregistrés</p>
              <p className="mt-1 font-semibold">{fmtMAD(paidTotal)}</p>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-xl">Paiements</h2>
              <p className="text-sm text-muted-foreground">Paiements déclarés par votre agence pour cette réservation.</p>
            </div>
            <Button type="button" onClick={() => openPaymentDialog()}>
              <Plus className="h-4 w-4" /> Ajouter paiement
            </Button>
          </div>
          {requestPayments.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">Aucun paiement enregistré.</p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-secondary/60 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Montant</th>
                    <th className="px-3 py-2 text-left font-medium">Méthode</th>
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-left font-medium">Référence</th>
                    <th className="px-3 py-2 text-left font-medium">Statut</th>
                    <th className="px-3 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requestPayments.map((payment) => (
                    <tr key={payment.id} className="border-t border-border">
                      <td className="px-3 py-2 font-semibold">{fmtMAD(payment.amount_mad)}</td>
                      <td className="px-3 py-2">{paymentMethodLabel(payment.method)}</td>
                      <td className="px-3 py-2">{fmtDate(payment.paid_at)}</td>
                      <td className="px-3 py-2">{payment.reference || "—"}</td>
                      <td className="px-3 py-2">{PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <Button type="button" size="sm" variant="ghost" onClick={() => openPaymentDialog(payment)}>Modifier</Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => deleteRequestPayment(payment)}>Supprimer</Button>
                        </div>
                        {payment.notes && <p className="mt-1 text-right text-xs text-muted-foreground">{payment.notes}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {requestAuditTimeline.length > 0 && (
          <Card className="p-5">
            <h2 className="font-display text-xl">Historique</h2>
            <div className="mt-4 space-y-3">
              {requestAuditTimeline.slice(0, 12).map((entry) => (
                <div key={entry.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{entry.action}</p>
                    <p className="text-xs text-muted-foreground">{fmtDateTime(entry.created_at)}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">{entry.actor_label || "Agence"}</p>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card className="p-5">
          <h2 className="font-display text-xl">Demandes spéciales</h2>
          <Textarea
            className="mt-4"
            rows={5}
            value={requestForm.special_requests}
            onChange={(event) => setRequestForm((current) => ({ ...current, special_requests: event.target.value }))}
          />
          <p className="mt-2 text-xs text-muted-foreground">Les modifications sont visibles par l'administration après actualisation.</p>
          <Button className="mt-4" onClick={saveRequest} disabled={requestSaving}>
            {requestSaving ? "Enregistrement…" : "Enregistrer les modifications"}
          </Button>
        </Card>
        <Dialog open={adjustmentDialogOpen} onOpenChange={setAdjustmentDialogOpen}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>{editingAdjustmentId ? "Modifier une ligne devis" : "Ajouter une ligne devis"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={adjustmentDraft.type} onValueChange={(value) => setAdjustmentDraft((current) => ({ ...current, type: value as QuoteAdjustmentDraft["type"] }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="discount">Réduction</SelectItem>
                      <SelectItem value="supplement">Supplément</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Calcul</Label>
                  <Select value={adjustmentDraft.calculation_type} onValueChange={(value) => setAdjustmentDraft((current) => ({ ...current, calculation_type: value as QuoteAdjustmentDraft["calculation_type"] }))}>
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
              <label className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm">
                <Checkbox checked={adjustmentDraft.visible_on_quote} onCheckedChange={(checked) => setAdjustmentDraft((current) => ({ ...current, visible_on_quote: checked === true }))} />
                Visible sur le devis client
              </label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAdjustmentDialogOpen(false)}>Annuler</Button>
              <Button type="button" onClick={saveRequestAdjustmentDraft}>Enregistrer</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>{editingPaymentId ? "Modifier un paiement" : "Ajouter un paiement"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-2 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Montant</Label>
                <Input type="number" min={0} value={paymentDraft.amount_mad} onChange={(event) => setPaymentDraft((current) => ({ ...current, amount_mad: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Méthode</Label>
                <Select value={paymentDraft.method} onValueChange={(value) => setPaymentDraft((current) => ({ ...current, method: value }))}>
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
                <Select value={paymentDraft.status} onValueChange={(value) => setPaymentDraft((current) => ({ ...current, status: value as AgencyRequestPayment["status"] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Référence</Label>
                <Input value={paymentDraft.reference} onChange={(event) => setPaymentDraft((current) => ({ ...current, reference: event.target.value }))} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Notes</Label>
                <Textarea rows={3} value={paymentDraft.notes} onChange={(event) => setPaymentDraft((current) => ({ ...current, notes: event.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPaymentDialogOpen(false)}>Annuler</Button>
              <Button type="button" onClick={savePaymentDraft}>Enregistrer</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  const remaining = Math.max(0, Number(booking.total_amount_mad || 0) - Number(booking.paid_amount_mad || 0));

  return (
    <div className="space-y-6">
      <Button asChild variant="outline">
        <Link to="/agency/bookings"><ArrowLeft className="h-4 w-4" /> Réservations</Link>
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-3xl">{booking.reference}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Créée le {fmtDateTime(booking.created_at)}</p>
          {trip?.title && <p className="mt-1 text-sm font-medium">{trip.title}</p>}
        </div>
        <AgencyStatusBadge value={booking.status} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="font-display text-xl">Voyageur principal</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div><p className="text-xs text-muted-foreground">Nom</p><p className="font-medium">{booking.contact_name}</p></div>
            <div><p className="text-xs text-muted-foreground">Email</p><p className="font-medium">{booking.contact_email}</p></div>
            <div><p className="text-xs text-muted-foreground">Téléphone</p><p className="font-medium">{booking.contact_phone || "—"}</p></div>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-display text-xl">Résumé financier</h2>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Total</span><span className="font-semibold">{fmtMAD(booking.total_amount_mad)}</span></div>
            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Payé</span><span className="font-semibold">{fmtMAD(booking.paid_amount_mad)}</span></div>
            <div className="flex justify-between gap-3 border-t border-border pt-3"><span className="text-muted-foreground">Reste</span><span className="font-semibold">{fmtMAD(remaining)}</span></div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-display text-xl">Voyage</h2>
          <div className="mt-4 space-y-3 text-sm">
            <div><p className="text-xs text-muted-foreground">Dates préférées</p><p className="font-medium">{booking.preferred_dates || "—"}</p></div>
            <div><p className="text-xs text-muted-foreground">Programme / voyage</p><p className="font-medium">{trip?.title || booking.trip_id || "—"}</p></div>
            <div><p className="text-xs text-muted-foreground">Voyageurs</p><p className="font-medium">{Number(booking.num_adults || 0)} adulte(s) {Number(booking.num_children || 0) > 0 ? `+ ${booking.num_children} enfant(s)` : ""}</p></div>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-display text-xl">Attribution agence</h2>
          <div className="mt-4 space-y-3 text-sm">
            <div><p className="text-xs text-muted-foreground">Agence</p><p className="font-medium">{organization?.display_name}</p></div>
            <div><p className="text-xs text-muted-foreground">Date attribution</p><p className="font-medium">{fmtDateTime(booking.agency_attributed_at)}</p></div>
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="font-display text-xl">Timeline</h2>
        <div className="mt-5 space-y-4">
          <div className="flex gap-3">
            <div className="mt-1 h-2.5 w-2.5 rounded-full bg-accent" />
            <div>
              <p className="font-medium">Réservation créée</p>
              <p className="text-sm text-muted-foreground">{fmtDateTime(booking.created_at)}</p>
            </div>
          </div>
          {booking.agency_attributed_at && (
            <div className="flex gap-3">
              <div className="mt-1 h-2.5 w-2.5 rounded-full bg-accent" />
              <div>
                <p className="font-medium">Attribuée à l'agence</p>
                <p className="text-sm text-muted-foreground">{fmtDateTime(booking.agency_attributed_at)}</p>
              </div>
            </div>
          )}
          {payments.map((payment) => (
            <div key={payment.id} className="flex gap-3">
              <div className="mt-1 h-2.5 w-2.5 rounded-full bg-emerald-500" />
              <div>
                <p className="font-medium">Paiement reçu · {fmtMAD(payment.amount_mad)}</p>
                <p className="text-sm text-muted-foreground">{fmtDateTime(payment.paid_at ?? payment.created_at)} {payment.reference ? `· ${payment.reference}` : ""}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
