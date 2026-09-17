import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate, fmtDateTime, fmtMAD } from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";
import { useAgencyContext } from "../useAgencyContext";
import type { AgencyBooking, CommissionRule } from "../agencyTypes";
import { AgencyStatusBadge } from "../components/AgencyStatusBadge";
import { commissionRuleColumns, getCommissionScopeLabel } from "../commissionEngine";
import {
  HOTEL_SUPPLEMENT,
  PUBLIC_HOTEL_OPTIONS,
  PUBLIC_ROOM_LABELS,
  getRoomAdjustmentPerPerson,
  type PublicHotelKey,
  type PublicRoomKey,
} from "@/lib/booking-options";
import { trackEvent } from "@/lib/analytics";

type DbClient = { from: (table: string) => any };
const db = supabase as unknown as DbClient;

const PAGE_SIZE = 20;
const bookingColumns = "id,reference,contact_name,contact_email,contact_phone,status,total_amount_mad,paid_amount_mad,created_at,preferred_dates,trip_id,agency_organization_id,assigned_to,agency_attributed_at,trips:trip_id(id,title,start_date,end_date,destination)";
const requestColumns = "id,organization_id,requested_by,client_full_name,client_email,client_phone,trip_interest,travelers_count,preferred_departure_date,message,status,metadata,created_at";
const tripColumns = "id,title,slug,season,start_date,end_date,destination,destinations,base_price_mad,slots_left,status,label,program_link,programme_id";
const extraColumns = "id,name,description,price_mad,category,city,sort_order";

const ROOM_TYPE_LABELS = PUBLIC_ROOM_LABELS;
const HOTEL_CATEGORY_LABELS = Object.fromEntries(
  Object.entries(PUBLIC_HOTEL_OPTIONS).map(([key, value]) => [key, value.name])
) as Record<HotelCategory, string>;

type AgencyBookingRequestStatus = "new" | "contacted" | "quoted" | "converted" | "rejected";

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
  status: AgencyBookingRequestStatus;
  created_at: string;
};

type RoomType = PublicRoomKey;
type HotelCategory = PublicHotelKey;

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

type SelectedExtraMetadata = {
  extra_id?: string;
  id?: string;
  name: string;
  unit_price?: number | null;
  price_mad: number | null;
  quantity?: number;
  total?: number | null;
};

type RequestMetadata = {
  crm_client_id?: string | null;
  agency_organization_id?: string | null;
  agency_name?: string | null;
  trip_id?: string | null;
  trip_title?: string | null;
  destination?: string | null;
  room_type?: RoomType | null;
  hotel_category?: HotelCategory | null;
  selected_extras?: SelectedExtraMetadata[];
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
  payment_type?: "cash" | "bank_transfer" | "card" | "cheque" | "other" | null;
  payment_date?: string | null;
  paid_amount?: number | null;
  payment_notes?: string | null;
};

type RequestForm = {
  client_full_name: string;
  client_email: string;
  client_phone: string;
  trip_id: string;
  travelers_count: string;
  room_type: RoomType;
  hotel_category: HotelCategory;
  selected_extras: Record<string, number>;
  special_requests: string;
};

const emptyRequestForm = (): RequestForm => ({
  client_full_name: "",
  client_email: "",
  client_phone: "",
  trip_id: "",
  travelers_count: "1",
  room_type: "double",
  hotel_category: "modern",
  selected_extras: {},
  special_requests: "",
});

const REQUEST_STATUS_LABELS: Record<AgencyBookingRequestStatus, string> = {
  new: "Nouvelle",
  contacted: "Contacté",
  quoted: "Devis envoyé",
  converted: "Convertie",
  rejected: "Rejetée",
};

const getVisualAgencyRequestStatus = (request: AgencyBookingRequest) => {
  if (request.metadata?.payment_status === "paid") return "paid";
  if (request.status === "converted") return "confirmed";
  return "lead";
};

const VISUAL_REQUEST_STATUS_LABELS: Record<"lead" | "confirmed" | "paid", string> = {
  lead: "Lead",
  confirmed: "Confirmé",
  paid: "Payé",
};

const normalize = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const formatTripDates = (trip: Pick<TripOption, "start_date" | "end_date" | "season"> | null) => {
  if (!trip) return "—";
  if (trip.start_date && trip.end_date) return `${fmtDate(trip.start_date)} → ${fmtDate(trip.end_date)}`;
  if (trip.start_date || trip.end_date) return fmtDate(trip.start_date ?? trip.end_date);
  return trip.season || "—";
};

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

const mergeClientAgencyMetadata = async (
  clientId: string,
  organization: { id: string; display_name?: string | null }
) => {
  try {
    const { data } = await db.from("clients").select("metadata").eq("id", clientId).maybeSingle();
    const currentMetadata = data?.metadata && typeof data.metadata === "object" ? data.metadata : {};
    await db
      .from("clients")
      .update({
        source: "agency",
        metadata: {
          ...currentMetadata,
          agency_origin: true,
          agency_organization_id: organization.id,
          agency_name: organization.display_name ?? null,
        },
      })
      .eq("id", clientId);
  } catch (error) {
    console.warn("[agency-booking-request] CRM agency metadata update failed", error);
  }
};

export default function AgencyBookings() {
  const { user } = useAuth();
  const { organization, isActiveAgency } = useAgencyContext();
  const [rows, setRows] = useState<AgencyBooking[]>([]);
  const [requests, setRequests] = useState<AgencyBookingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [travelFrom, setTravelFrom] = useState("");
  const [travelTo, setTravelTo] = useState("");
  const [destination, setDestination] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestForm, setRequestForm] = useState<RequestForm>(emptyRequestForm);
  const [requestSaving, setRequestSaving] = useState(false);
  const [tripOptions, setTripOptions] = useState<TripOption[]>([]);
  const [tripsLoading, setTripsLoading] = useState(false);
  const [tripsError, setTripsError] = useState<string | null>(null);
  const [extraOptions, setExtraOptions] = useState<ExtraOption[]>([]);
  const [extrasLoading, setExtrasLoading] = useState(false);
  const [extrasError, setExtrasError] = useState<string | null>(null);
  const [commissionRules, setCommissionRules] = useState<CommissionRule[]>([]);
  const [commissionRulesError, setCommissionRulesError] = useState<string | null>(null);

  const load = async () => {
    if (!organization) return;
    setLoading(true);
    setError(null);

    let tripIds: string[] | null = null;
    const destinationNeedle = destination.trim().replace(/,/g, " ");
    if (travelFrom || travelTo || destinationNeedle) {
      let tripQuery = db.from("trips").select("id").is("archived_at", null).limit(1000);
      if (destinationNeedle) {
        tripQuery = tripQuery.or(`title.ilike.%${destinationNeedle}%,destination.ilike.%${destinationNeedle}%`);
      }
      if (travelFrom) tripQuery = tripQuery.gte("start_date", travelFrom);
      if (travelTo) tripQuery = tripQuery.lte("start_date", travelTo);

      const { data: tripRows, error: tripError } = await tripQuery;
      if (tripError) {
        setError(tripError.message);
        setRows([]);
        setTotal(0);
        setLoading(false);
        return;
      }

      tripIds = (tripRows ?? []).map((trip: { id: string }) => trip.id);
      if (tripIds.length === 0) {
        setRows([]);
        setTotal(0);
        setLoading(false);
        return;
      }
    }

    let query = db
      .from("bookings")
      .select(bookingColumns, { count: "exact" })
      .eq("agency_organization_id", organization.id)
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    if (status !== "all") query = query.eq("status", status);
    if (tripIds) query = query.in("trip_id", tripIds);
    const needle = search.trim();
    if (needle) {
      const safeNeedle = needle.replace(/,/g, " ");
      query = query.or(`reference.ilike.%${safeNeedle}%,contact_name.ilike.%${safeNeedle}%,contact_email.ilike.%${safeNeedle}%`);
    }

    const { data, error, count } = await query;
    if (error) {
      setError(error.message);
      setRows([]);
      setTotal(0);
    } else {
      setRows((data ?? []) as AgencyBooking[]);
      setTotal(count ?? 0);
    }
    setLoading(false);
  };

  const loadRequests = async () => {
    if (!organization) return;
    setRequestsLoading(true);
    setRequestError(null);

    const { data, error } = await db
      .from("agency_booking_requests")
      .select(requestColumns)
      .eq("organization_id", organization.id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      setRequestError(error.message);
      setRequests([]);
    } else {
      setRequests((data ?? []) as AgencyBookingRequest[]);
    }
    setRequestsLoading(false);
  };

  const loadRequestOptions = async () => {
    setTripsLoading(true);
    setTripsError(null);
    const { data: tripsData, error: tripsError } = await db
      .from("trips")
      .select(tripColumns)
      .is("archived_at", null)
      .in("status", ["open", "completed"])
      .order("start_date", { ascending: true, nullsFirst: false });

    if (tripsError) {
      setTripsError(tripsError.message);
      setTripOptions([]);
    } else {
      setTripOptions((tripsData ?? []) as TripOption[]);
    }
    setTripsLoading(false);

    setExtrasLoading(true);
    setExtrasError(null);
    const { data: extrasData, error: extrasError } = await db
      .from("extras")
      .select(extraColumns)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (extrasError) {
      setExtrasError(extrasError.message);
      setExtraOptions([]);
    } else {
      setExtraOptions((extrasData ?? []) as ExtraOption[]);
    }
    setExtrasLoading(false);
  };

  const loadCommissionRules = async () => {
    if (!organization) return;
    setCommissionRulesError(null);
    const { data, error } = await db
      .from("commission_engine_rules")
      .select(commissionRuleColumns)
      .eq("organization_id", organization.id)
      .eq("status", "active");

    if (error) {
      setCommissionRules([]);
      setCommissionRulesError(error.message);
      return;
    }
    setCommissionRules((data ?? []) as CommissionRule[]);
  };

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [organization?.id, page, search, status, travelFrom, travelTo, destination]);

  useEffect(() => {
    loadRequests();
  }, [organization?.id]);

  useEffect(() => {
    if (requestOpen && !requestForm.trip_id && tripOptions[0]?.id) {
      updateRequestForm("trip_id", tripOptions[0].id);
    }
  }, [requestOpen, requestForm.trip_id, tripOptions]);

  const openRequest = () => {
    const firstTripId = tripOptions[0]?.id ?? "";
    setRequestForm({ ...emptyRequestForm(), trip_id: firstTripId });
    setRequestOpen(true);
    void loadRequestOptions();
    void loadCommissionRules();
  };

  const updateRequestForm = <K extends keyof RequestForm>(key: K, value: RequestForm[K]) => {
    setRequestForm((current) => ({ ...current, [key]: value }));
  };

  const setExtraQuantity = (extraId: string, quantity: number) => {
    const safeQuantity = Math.max(0, Math.floor(Number.isFinite(quantity) ? quantity : 0));
    setRequestForm((current) => ({
      ...current,
      selected_extras: {
        ...current.selected_extras,
        [extraId]: safeQuantity,
      },
    }));
  };

  const selectedTrip = tripOptions.find((trip) => trip.id === requestForm.trip_id) ?? null;
  const selectedExtras = extraOptions
    .map((extra) => ({ extra, quantity: Number(requestForm.selected_extras[extra.id] ?? 0) }))
    .filter((item) => item.quantity > 0);
  const travelersCount = Number(requestForm.travelers_count);
  const safeTravelersCount = Number.isFinite(travelersCount) && travelersCount > 0 ? travelersCount : 1;
  const tripBasePrice = selectedTrip?.base_price_mad ?? null;
  const basePriceTotal = tripBasePrice === null ? null : tripBasePrice * safeTravelersCount;
  const roomSupplementPerTraveler = getRoomAdjustmentPerPerson(requestForm.room_type);
  const hotelSupplementPerTraveler = HOTEL_SUPPLEMENT[requestForm.hotel_category] ?? 0;
  const roomSupplementTotal = roomSupplementPerTraveler * safeTravelersCount;
  const hotelSupplementTotal = hotelSupplementPerTraveler * safeTravelersCount;
  const extrasTotal = selectedExtras.reduce((sum, item) => sum + Number(item.extra.price_mad ?? 0) * item.quantity, 0);
  const estimatedTotal = basePriceTotal === null
    ? null
    : basePriceTotal + roomSupplementTotal + hotelSupplementTotal + extrasTotal;
  const applicableCommissionRule = getApplicableRuleForRequest(commissionRules, selectedTrip);
  const estimatedCommission = calculateCommission(estimatedTotal, applicableCommissionRule);
  const derivedDepartureDate = selectedTrip?.start_date ?? null;
  const roomWarnings = [
    safeTravelersCount === 1 && requestForm.room_type !== "single"
      ? "Attention: chambre prévue pour plusieurs personnes."
      : null,
    safeTravelersCount >= 2 && requestForm.room_type === "single"
      ? "Attention: chambre single pour un seul voyageur."
      : null,
    requestForm.room_type === "triple" && safeTravelersCount < 3
      ? "Attention: chambre triple avec moins de 3 voyageurs."
      : null,
  ].filter(Boolean);
  const extraWarnings = selectedExtras
    .filter((item) => item.quantity > safeTravelersCount)
    .map((item) => `Attention: quantité ${item.quantity} pour ${item.extra.name}, supérieure au nombre de voyageurs.`);

  const submitRequest = async () => {
    if (!organization || !user || !isActiveAgency) return;
    if (!requestForm.client_full_name.trim()) {
      toast.error("Le nom du client est obligatoire.");
      return;
    }
    if (!selectedTrip) {
      toast.error("Sélectionnez un voyage.");
      return;
    }
    if (!Number.isFinite(travelersCount) || travelersCount < 1) {
      toast.error("Le nombre de voyageurs est obligatoire.");
      return;
    }

    let crmClientId: string | null = null;
    try {
      const { data: upsertedId } = await supabase.rpc("upsert_client_from_booking" as any, {
        _name: requestForm.client_full_name.trim(),
        _email: requestForm.client_email.trim(),
        _phone: requestForm.client_phone.trim(),
        _city: "",
      });
      crmClientId = (upsertedId as string) ?? null;
      if (crmClientId) await mergeClientAgencyMetadata(crmClientId, organization);
    } catch (error) {
      console.warn("[agency-booking-request] CRM upsert failed", error);
    }

    const metadata: RequestMetadata = {
      crm_client_id: crmClientId,
      agency_organization_id: organization.id,
      agency_name: organization.display_name ?? null,
      trip_id: selectedTrip.id,
      trip_title: selectedTrip.title,
      destination: getTripDestination(selectedTrip),
      room_type: requestForm.room_type,
      hotel_category: requestForm.hotel_category,
      selected_extras: selectedExtras.map(({ extra, quantity }) => ({
        extra_id: extra.id,
        id: extra.id,
        name: extra.name,
        unit_price: extra.price_mad,
        price_mad: extra.price_mad,
        quantity,
        total: extra.price_mad === null || extra.price_mad === undefined ? null : Number(extra.price_mad) * quantity,
      })),
      base_price: tripBasePrice,
      room_supplement: roomSupplementTotal,
      hotel_supplement: hotelSupplementTotal,
      extras_total: extrasTotal,
      estimated_total: estimatedTotal,
      estimated_commission: estimatedCommission,
      commission_rule_id: applicableCommissionRule?.id ?? null,
      commission_rule_label: applicableCommissionRule ? getCommissionScopeLabel(applicableCommissionRule) : null,
      special_requests: requestForm.special_requests.trim() || null,
      payment_status: "unpaid",
    };

    setRequestSaving(true);
    const { data: createdRequest, error } = await db.from("agency_booking_requests").insert({
      organization_id: organization.id,
      requested_by: user.id,
      client_full_name: requestForm.client_full_name.trim(),
      client_email: requestForm.client_email.trim() || null,
      client_phone: requestForm.client_phone.trim() || null,
      trip_interest: selectedTrip.title,
      travelers_count: travelersCount,
      preferred_departure_date: derivedDepartureDate,
      message: requestForm.special_requests.trim() || null,
      metadata,
      status: "new",
    }).select("id").maybeSingle();

    if (error) {
      toast.error(error.message ?? "Impossible d'envoyer la demande.");
      setRequestSaving(false);
      return;
    }

    trackEvent("agency_booking_created", {
      source: "agency_portal",
      trip_id: selectedTrip.id,
      travelers_count: travelersCount,
      extras_count: selectedExtras.length,
      has_commission_rule: Boolean(applicableCommissionRule),
    });
    toast.success("Demande envoyée.");
    if (createdRequest?.id) {
      void supabase.functions.invoke("send-admin-notification", {
        body: { type: "agency_booking", payload: { request_id: createdRequest.id } },
      }).then(({ data, error }) => {
        if (error || data?.ok === false) console.warn("agency booking notification failed", data ?? error);
      });
    }
    setRequestOpen(false);
    setRequestForm(emptyRequestForm());
    await loadRequests();
    setRequestSaving(false);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl">Réservations</h1>
          <p className="mt-1 text-sm text-muted-foreground">Réservations attribuées à {organization?.display_name}</p>
        </div>
        <Button className="min-h-11" onClick={openRequest} disabled={!isActiveAgency}>
          <Plus className="h-4 w-4" />
          Nouvelle demande
        </Button>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_170px_150px_150px_170px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => { setPage(0); setSearch(event.target.value); }}
              placeholder="Référence, nom ou email"
              className="min-h-11 pl-9"
            />
          </div>
          <Input
            value={destination}
            onChange={(event) => { setPage(0); setDestination(event.target.value); }}
            placeholder="Destination"
            className="min-h-11"
          />
          <Input
            type="date"
            value={travelFrom}
            onChange={(event) => { setPage(0); setTravelFrom(event.target.value); }}
            className="min-h-11"
            aria-label="Date voyage depuis"
          />
          <Input
            type="date"
            value={travelTo}
            onChange={(event) => { setPage(0); setTravelTo(event.target.value); }}
            className="min-h-11"
            aria-label="Date voyage jusqu'à"
          />
          <Select value={status} onValueChange={(value) => { setPage(0); setStatus(value); }}>
            <SelectTrigger className="min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous statuts</SelectItem>
              <SelectItem value="lead">Lead</SelectItem>
              <SelectItem value="confirmed">Confirmé</SelectItem>
              <SelectItem value="paid">Payé</SelectItem>
              <SelectItem value="cancelled">Annulé</SelectItem>
              <SelectItem value="completed">Terminé</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{total} réservation(s) attribuée(s) · lecture seule</p>
      </Card>

      {error && (
        <Card className="border-amber-200 bg-amber-50 p-4 text-amber-950">
          {error}
        </Card>
      )}

      {requestError && (
        <Card className="border-amber-200 bg-amber-50 p-4 text-amber-950">
          {requestError}
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div>
            <h2 className="font-display text-xl">Demandes agences</h2>
            <p className="mt-1 text-xs text-muted-foreground">{requests.length} demande(s) envoyée(s)</p>
          </div>
        </div>
        {requestsLoading ? (
          <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement des demandes…
          </div>
        ) : requests.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Aucune demande agence.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-secondary/55">
                <tr className="text-left">
                  <th className="p-4 font-semibold">Client</th>
                  <th className="p-4 font-semibold">Voyage</th>
                  <th className="p-4 font-semibold">Voyageurs</th>
                  <th className="p-4 font-semibold">Total estimé</th>
                  <th className="p-4 font-semibold">Commission estimée</th>
                  <th className="p-4 font-semibold">Statut</th>
                  <th className="p-4 font-semibold">Créée le</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {requests.map((request) => (
                  <tr key={request.id} className="hover:bg-secondary/30">
                    <td className="p-4">
                      <Link to={`/agency/bookings/${request.id}`} className="font-medium text-accent hover:underline">
                        {request.client_full_name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{request.client_email || request.client_phone || "—"}</p>
                    </td>
                    <td className="p-4">
                      <p className="font-medium">{request.metadata?.trip_title || request.trip_interest}</p>
                      <p className="text-xs text-muted-foreground">{request.metadata?.destination || request.preferred_departure_date || "—"}</p>
                    </td>
                    <td className="p-4">{request.travelers_count}</td>
                    <td className="p-4">
                      {request.metadata?.estimated_total === null || request.metadata?.estimated_total === undefined
                        ? "Prix non renseigné"
                        : fmtMAD(request.metadata.estimated_total)}
                    </td>
                    <td className="p-4">
                      {request.metadata?.estimated_commission === null || request.metadata?.estimated_commission === undefined
                        ? "Commission non renseignée"
                        : fmtMAD(request.metadata.estimated_commission)}
                    </td>
                    <td className="p-4">{VISUAL_REQUEST_STATUS_LABELS[getVisualAgencyRequestStatus(request)]}</td>
                    <td className="p-4 text-xs text-muted-foreground">{fmtDateTime(request.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement…
          </div>
        ) : rows.length === 0 ? (
          <p className="p-12 text-center text-sm text-muted-foreground">Aucune réservation attribuée.</p>
        ) : (
          <>
            <div className="hidden md:block">
              <table className="w-full text-sm">
                <thead className="bg-secondary/55">
                  <tr className="text-left">
                    <th className="p-4 font-semibold">Référence</th>
                    <th className="p-4 font-semibold">Client</th>
                    <th className="p-4 font-semibold">Voyage</th>
                    <th className="p-4 font-semibold">Total</th>
                    <th className="p-4 font-semibold">Payé</th>
                    <th className="p-4 font-semibold">Statut</th>
                    <th className="p-4 font-semibold">Créée le</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((booking) => (
                    <tr key={booking.id} className="hover:bg-secondary/30">
                      <td className="p-4">
                        <Link to={`/agency/bookings/${booking.id}`} className="font-semibold text-accent">{booking.reference}</Link>
                      </td>
                      <td className="p-4">
                        <p className="font-medium">{booking.contact_name}</p>
                        <p className="text-xs text-muted-foreground">{booking.contact_email}</p>
                      </td>
                      <td className="p-4">
                        <p className="font-medium">{booking.trips?.title ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">
                          {booking.trips?.destination || booking.preferred_dates || "—"}
                        </p>
                      </td>
                      <td className="p-4">{fmtMAD(booking.total_amount_mad)}</td>
                      <td className="p-4">{fmtMAD(booking.paid_amount_mad)}</td>
                      <td className="p-4"><AgencyStatusBadge value={booking.status} /></td>
                      <td className="p-4 text-xs text-muted-foreground">{fmtDateTime(booking.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y md:hidden">
              {rows.map((booking) => (
                <Link key={booking.id} to={`/agency/bookings/${booking.id}`} className="block space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-accent">{booking.reference}</p>
                      <p className="text-sm font-medium">{booking.contact_name}</p>
                      <p className="text-xs text-muted-foreground">{booking.contact_email}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{booking.trips?.title ?? booking.preferred_dates ?? "Voyage non défini"}</p>
                    </div>
                    <AgencyStatusBadge value={booking.status} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><p className="text-xs text-muted-foreground">Total</p><p className="font-medium">{fmtMAD(booking.total_amount_mad)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Payé</p><p className="font-medium">{fmtMAD(booking.paid_amount_mad)}</p></div>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="outline" disabled={page === 0 || loading} onClick={() => setPage((current) => Math.max(0, current - 1))}>
          <ChevronLeft className="h-4 w-4" />
          Précédent
        </Button>
        <p className="text-sm text-muted-foreground">Page {page + 1} / {totalPages}</p>
        <Button variant="outline" disabled={page + 1 >= totalPages || loading} onClick={() => setPage((current) => current + 1)}>
          Suivant
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nouvelle demande</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Nom complet du client *</Label>
              <Input value={requestForm.client_full_name} onChange={(event) => updateRequestForm("client_full_name", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email client</Label>
              <Input type="email" value={requestForm.client_email} onChange={(event) => updateRequestForm("client_email", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Téléphone client</Label>
              <Input value={requestForm.client_phone} onChange={(event) => updateRequestForm("client_phone", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Nombre de voyageurs *</Label>
              <Input type="number" min="1" value={requestForm.travelers_count} onChange={(event) => updateRequestForm("travelers_count", event.target.value)} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Voyage *</Label>
              <Select value={requestForm.trip_id} onValueChange={(value) => updateRequestForm("trip_id", value)}>
                <SelectTrigger className="min-h-11">
                  <SelectValue placeholder={tripsLoading ? "Chargement des voyages…" : "Sélectionner un voyage"} />
                </SelectTrigger>
                <SelectContent>
                  {tripOptions.map((trip) => (
                    <SelectItem key={trip.id} value={trip.id}>
                      {trip.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {tripsError && <p className="text-xs text-destructive">{tripsError}</p>}
              {selectedTrip ? (
                <div className="rounded-xl border border-border bg-secondary/35 p-3 text-sm">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <p className="font-semibold">{selectedTrip.title}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button asChild type="button" variant="outline" size="sm">
                        <Link to={`/agency/trips?trip=${selectedTrip.id}`} target="_blank">
                          Voir le voyage
                        </Link>
                      </Button>
                      {selectedTrip.programme_id && (
                        <Button asChild type="button" variant="outline" size="sm">
                          <Link to={`/agency/programmes?programme=${selectedTrip.programme_id}`} target="_blank">
                            Voir le programme
                          </Link>
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                    <span>Destination: {getTripDestination(selectedTrip) || "—"}</span>
                    <span>Départ: {formatTripDates(selectedTrip)}</span>
                    <span>Prix base: {selectedTrip.base_price_mad === null ? "Prix non renseigné" : fmtMAD(selectedTrip.base_price_mad)}</span>
                    <span>Places: {selectedTrip.slots_left ?? "—"}</span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {tripsLoading ? "Chargement des voyages…" : "Aucun voyage actif disponible."}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Date de départ</Label>
              <Input type="date" value={derivedDepartureDate ?? ""} readOnly className="bg-secondary/40" />
              <p className="text-xs text-muted-foreground">Date automatiquement reprise depuis le voyage sélectionné.</p>
            </div>
            <div className="space-y-2">
              <Label>Type de chambre</Label>
              <Select value={requestForm.room_type} onValueChange={(value) => updateRequestForm("room_type", value as RoomType)}>
                <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ROOM_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Hébergement Kyoto</Label>
              <Select value={requestForm.hotel_category} onValueChange={(value) => updateRequestForm("hotel_category", value as HotelCategory)}>
                <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PUBLIC_HOTEL_OPTIONS).map(([value, option]) => (
                    <SelectItem key={value} value={value}>{option.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {PUBLIC_HOTEL_OPTIONS[requestForm.hotel_category].desc}
              </p>
            </div>
            {[...roomWarnings, ...extraWarnings].length > 0 && (
              <div className="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                {[...roomWarnings, ...extraWarnings].map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            )}
            <div className="space-y-2 md:col-span-2">
              <Label>Extras</Label>
              {extrasError && <p className="text-xs text-destructive">{extrasError}</p>}
              {extrasLoading ? (
                <p className="rounded-xl border border-border p-3 text-sm text-muted-foreground">Chargement des extras…</p>
              ) : extraOptions.length === 0 ? (
                <p className="rounded-xl border border-border p-3 text-sm text-muted-foreground">Aucun extra actif disponible.</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {extraOptions.map((extra) => {
                    const quantity = Number(requestForm.selected_extras[extra.id] ?? 0);
                    return (
                      <div
                        key={extra.id}
                        className={`rounded-xl border p-3 text-left text-sm transition ${quantity > 0 ? "border-accent bg-accent/10" : "border-border"}`}
                      >
                        <span className="flex items-start justify-between gap-3">
                          <span>
                            <span className="block font-medium">{extra.name}</span>
                            <span className="block text-xs text-muted-foreground">{extra.city || extra.category || "Extra"}</span>
                          </span>
                          <span className="text-xs font-semibold">
                            {extra.price_mad === null || extra.price_mad === undefined ? "Prix non renseigné" : fmtMAD(extra.price_mad)}
                          </span>
                        </span>
                        <div className="mt-3 flex items-center gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => setExtraQuantity(extra.id, quantity - 1)} disabled={quantity <= 0}>-</Button>
                          <Input
                            type="number"
                            min={0}
                            value={quantity}
                            onChange={(event) => setExtraQuantity(extra.id, Number(event.target.value))}
                            className="h-9 w-20 text-center"
                            aria-label={`Quantité ${extra.name}`}
                          />
                          <Button type="button" variant="outline" size="sm" onClick={() => setExtraQuantity(extra.id, quantity + 1)}>+</Button>
                          <span className="text-xs text-muted-foreground">
                            Total: {extra.price_mad === null || extra.price_mad === undefined ? "prix non renseigné" : fmtMAD(Number(extra.price_mad) * quantity)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {selectedExtras.length > 0 && (
                <div className="rounded-xl bg-secondary/40 p-3 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">Extras sélectionnés</p>
                  <p>{selectedExtras.map(({ extra, quantity }) => `${extra.name} x${quantity} (${extra.price_mad === null || extra.price_mad === undefined ? "prix non renseigné" : fmtMAD(Number(extra.price_mad) * quantity)})`).join(" · ")}</p>
                </div>
              )}
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Demandes spéciales</Label>
              <Textarea rows={4} value={requestForm.special_requests} onChange={(event) => updateRequestForm("special_requests", event.target.value)} />
            </div>
            <div className="rounded-xl border border-border bg-background p-4 md:col-span-2">
              <h3 className="font-semibold">Aperçu prix</h3>
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">Prix voyage</span><span>{basePriceTotal === null ? "Prix non renseigné" : fmtMAD(basePriceTotal)}</span></div>
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">Supplément chambre</span><span>{fmtMAD(roomSupplementTotal)}</span></div>
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">Supplément hôtel</span><span>{fmtMAD(hotelSupplementTotal)}</span></div>
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">Extras</span><span>{fmtMAD(extrasTotal)}</span></div>
                <div className="flex justify-between gap-3 font-semibold sm:col-span-2"><span>Total client estimé</span><span>{estimatedTotal === null ? "Prix non renseigné" : fmtMAD(estimatedTotal)}</span></div>
                <div className="flex justify-between gap-3 sm:col-span-2">
                  <span className="text-muted-foreground">Commission estimée</span>
                  <span>{estimatedCommission === null ? "Commission non renseignée" : fmtMAD(estimatedCommission)}</span>
                </div>
              </div>
              {applicableCommissionRule && (
                <p className="mt-2 text-xs text-muted-foreground">Règle: {getCommissionScopeLabel(applicableCommissionRule)}</p>
              )}
              {commissionRulesError && (
                <p className="mt-2 text-xs text-amber-700">{commissionRulesError}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRequestOpen(false)} disabled={requestSaving}>Annuler</Button>
            <Button onClick={submitRequest} disabled={requestSaving || !isActiveAgency}>
              {requestSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              Envoyer la demande
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
