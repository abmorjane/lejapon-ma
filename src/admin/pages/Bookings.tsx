import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronDown, Plus, Search } from "lucide-react";
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

type DbClient = { from: (table: string) => any };
const db = supabase as unknown as DbClient;

type AgencyRequestStatus = "new" | "contacted" | "quoted" | "converted" | "rejected";
type VisualAgencyStatus = "lead" | "confirmed" | "rejected";
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
  selected_extras?: Array<{ id?: string; name?: string; price_mad?: number | null }>;
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
};

type OrganizationSummary = {
  id: string;
  display_name: string | null;
  legal_name: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  status?: string | null;
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
  trips?: { title?: string | null } | null;
  clients?: { loyalty_tier?: string | null; is_returning?: boolean | null; trips_completed?: number | null } | null;
};

type UnifiedReservation =
  | { kind: "booking"; id: string; created_at: string; status: string; booking: NormalBookingRow }
  | { kind: "agency_request"; id: string; created_at: string; status: VisualAgencyStatus; request: AgencyBookingRequest };

const agencyRequestColumns = "id,organization_id,client_full_name,client_email,client_phone,trip_interest,travelers_count,preferred_departure_date,message,metadata,status,created_at";

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
  rejected: "Rejeté",
};

const ROOM_TYPE_LABELS: Record<string, string> = {
  single: "Single",
  double: "Double",
  twin: "Twin",
  triple: "Triple",
};

const HOTEL_CATEGORY_LABELS: Record<string, string> = {
  standard: "Standard",
  superior: "Supérieur",
  premium: "Premium",
};

const formatMaybeMoney = (value: number | null | undefined, fallback = "Prix non renseigné") =>
  value === null || value === undefined ? fallback : fmtMAD(value);

const getAgencyVisualStatus = (status: AgencyRequestStatus): VisualAgencyStatus => {
  if (status === "converted") return "confirmed";
  if (status === "rejected") return "rejected";
  return "lead";
};

const agencyVisualBadgeClass = (status: VisualAgencyStatus) => {
  if (status === "confirmed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "rejected") return "border-red-200 bg-red-50 text-red-700";
  return "border-amber-200 bg-amber-50 text-amber-800";
};

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
  const [agencyRequests, setAgencyRequests] = useState<AgencyBookingRequest[]>([]);
  const [agencyRequestsLoading, setAgencyRequestsLoading] = useState(true);
  const [agencyRequestsError, setAgencyRequestsError] = useState<string | null>(null);
  const [agencyRequestBusy, setAgencyRequestBusy] = useState<string | null>(null);
  const [selectedAgencyRequest, setSelectedAgencyRequest] = useState<AgencyBookingRequest | null>(null);
  const [selectedAgencyOrg, setSelectedAgencyOrg] = useState<OrganizationSummary | null>(null);
  const [internalNotesDraft, setInternalNotesDraft] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<UnifiedStatus>("all");
  const [originFilter, setOriginFilter] = useState<ReservationOrigin>("all");
  const [agencyFilter, setAgencyFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const { roles } = useAuth();
  const canCreate = hasAnyRole(roles, ["super_admin", "admin", "manager"]);
  const reduceMotion = useReducedMotion();

  const load = async () => {
    const { data } = await supabase
      .from("bookings")
      .select("id, reference, contact_name, contact_email, contact_phone, status, num_adults, num_children, total_amount_mad, paid_amount_mad, created_at, trips(title), clients(loyalty_tier, is_returning, trips_completed)")
      .order("created_at", { ascending: false })
      .limit(160);
    setRows((data ?? []) as NormalBookingRow[]);
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
        .select("id,display_name,legal_name,email,phone,website,status")
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
    const nextMetadata = {
      ...(selectedAgencyRequest.metadata ?? {}),
      internal_notes: internalNotesDraft.trim() || null,
    };
    const { data, error } = await db
      .from("agency_booking_requests")
      .update({ metadata: nextMetadata })
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

  useEffect(() => { load(); }, []);
  useEffect(() => { loadAgencyRequests(); }, []);

  useEffect(() => {
    setInternalNotesDraft(selectedAgencyRequest?.metadata?.internal_notes ?? "");
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
      status: getAgencyVisualStatus(request.status),
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

  const openAgencyRequest = (request: AgencyBookingRequest) => {
    setSelectedAgencyRequest(request);
  };

  const metadata = selectedAgencyRequest?.metadata ?? {};
  const selectedExtras = metadata.selected_extras ?? [];

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
            {unifiedReservations.length} reservation(s) affichée(s) · {rows.length} LeJapon.ma · {agencyRequests.length} agences
          </p>
        </CardContent>
      </Card>

      {canCreate && <CreateBookingDialog open={createOpen} onOpenChange={setCreateOpen} />}

      {agencyRequestsError ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          {agencyRequestsError}
        </div>
      ) : null}

      <div className="space-y-3 md:hidden">
        {unifiedReservations.length === 0 && (
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
                      <Badge variant="outline" className="mb-2">Agence partenaire</Badge>
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
                      <Badge variant="outline" className={agencyVisualBadgeClass(getAgencyVisualStatus(request.status))}>
                        {VISUAL_AGENCY_STATUS_LABELS[getAgencyVisualStatus(request.status)]}
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
                    <Badge variant="outline" className="mb-2">LeJapon.ma</Badge>
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
              {agencyRequestsLoading && rows.length === 0 && (
                <tr><td colSpan={11} className="p-8 text-center text-muted-foreground">Chargement des réservations…</td></tr>
              )}
              {unifiedReservations.length === 0 && !agencyRequestsLoading && (
                <tr><td colSpan={11} className="p-8 text-center text-muted-foreground">Aucune réservation.</td></tr>
              )}
              {unifiedReservations.map((item) => {
                if (item.kind === "agency_request") {
                  const request = item.request;
                  const requestMetadata = request.metadata ?? {};
                  const extras = requestMetadata.selected_extras ?? [];
                  const visualStatus = getAgencyVisualStatus(request.status);
                  return (
                    <tr key={`agency-${request.id}`} className="align-top hover:bg-secondary/30">
                      <td className="p-4"><Badge variant="outline">Agence partenaire</Badge></td>
                      <td className="p-4">
                        <button
                          type="button"
                          className="text-left font-medium text-accent underline-offset-2 hover:underline"
                          onClick={() => setSelectedAgencyOrg(request.agency ?? null)}
                        >
                          {request.agency_name || "Agence"}
                        </button>
                        <p className="text-xs text-muted-foreground">{request.id.slice(0, 8)}</p>
                      </td>
                      <td className="p-4">
                        <button type="button" className="font-medium text-accent hover:underline" onClick={() => openAgencyRequest(request)}>
                          {request.client_full_name}
                        </button>
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
                          {extras.length ? extras.map((extra) => extra.name ?? "Extra").join(" · ") : "Aucun extra"}
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
                    <td className="p-4"><Badge variant="outline">LeJapon.ma</Badge></td>
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
                <Badge variant="outline">Agence partenaire</Badge>
                <Badge variant="outline" className={agencyVisualBadgeClass(getAgencyVisualStatus(selectedAgencyRequest.status))}>
                  {VISUAL_AGENCY_STATUS_LABELS[getAgencyVisualStatus(selectedAgencyRequest.status)]}
                </Badge>
                <span className="text-xs text-muted-foreground">Créée le {fmtDateTime(selectedAgencyRequest.created_at)}</span>
              </div>

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
                    <div><p className="text-xs text-muted-foreground">Départ souhaité</p><p className="font-medium">{selectedAgencyRequest.preferred_departure_date || "—"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Chambre / hôtel</p><p className="font-medium">{metadata.room_type ? ROOM_TYPE_LABELS[metadata.room_type] ?? metadata.room_type : "—"} · {metadata.hotel_category ? HOTEL_CATEGORY_LABELS[metadata.hotel_category] ?? metadata.hotel_category : "—"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Extras</p><p className="font-medium">{selectedExtras.length ? selectedExtras.map((extra) => `${extra.name ?? "Extra"} (${formatMaybeMoney(extra.price_mad, "prix non renseigné")})`).join(" · ") : "—"}</p></div>
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
                    <div className="flex justify-between gap-3"><span className="text-muted-foreground">Commission</span><span className="font-semibold">{formatMaybeMoney(metadata.estimated_commission, "Commission non renseignée")}</span></div>
                    <p className="text-xs text-muted-foreground">{metadata.commission_rule_label || "Aucune règle commission renseignée"}</p>
                  </div>
                </Card>
              </div>

              <Card className="p-4">
                <h3 className="font-display text-lg">Suivi admin</h3>
                <div className="mt-3 grid gap-4 lg:grid-cols-[220px_1fr]">
                  <div className="space-y-2">
                    <Label>Statut</Label>
                    <Select
                      value={selectedAgencyRequest.status}
                      onValueChange={(value) => updateAgencyRequestStatus(selectedAgencyRequest, value as AgencyRequestStatus)}
                      disabled={agencyRequestBusy === selectedAgencyRequest.id}
                    >
                      <SelectTrigger className="min-h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new">Lead · nouveau</SelectItem>
                        <SelectItem value="contacted">Lead · contacté</SelectItem>
                        <SelectItem value="quoted">Lead · devis envoyé</SelectItem>
                        <SelectItem value="converted">Confirmé</SelectItem>
                        <SelectItem value="rejected">Rejeté</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Le statut SQL existant est conservé.</p>
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
