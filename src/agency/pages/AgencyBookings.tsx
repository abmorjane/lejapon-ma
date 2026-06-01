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
import { fmtDateTime, fmtMAD } from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";
import { useAgencyContext } from "../useAgencyContext";
import type { AgencyBooking } from "../agencyTypes";
import { AgencyStatusBadge } from "../components/AgencyStatusBadge";

type DbClient = { from: (table: string) => any };
const db = supabase as unknown as DbClient;

const PAGE_SIZE = 20;
const bookingColumns = "id,reference,contact_name,contact_email,contact_phone,status,total_amount_mad,paid_amount_mad,created_at,preferred_dates,trip_id,agency_organization_id,assigned_to,agency_attributed_at,trips:trip_id(id,title,start_date,end_date,destination)";
const requestColumns = "id,organization_id,requested_by,client_full_name,client_email,client_phone,trip_interest,travelers_count,preferred_departure_date,message,status,created_at";

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
  status: AgencyBookingRequestStatus;
  created_at: string;
};

type RequestForm = {
  client_full_name: string;
  client_email: string;
  client_phone: string;
  trip_interest: string;
  travelers_count: string;
  preferred_departure_date: string;
  message: string;
};

const emptyRequestForm = (): RequestForm => ({
  client_full_name: "",
  client_email: "",
  client_phone: "",
  trip_interest: "",
  travelers_count: "1",
  preferred_departure_date: "",
  message: "",
});

const REQUEST_STATUS_LABELS: Record<AgencyBookingRequestStatus, string> = {
  new: "Nouvelle",
  contacted: "Contacté",
  quoted: "Devis envoyé",
  converted: "Convertie",
  rejected: "Rejetée",
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

  const load = async () => {
    if (!organization) return;
    setLoading(true);
    setError(null);

    let tripIds: string[] | null = null;
    const destinationNeedle = destination.trim().replace(/,/g, " ");
    if (travelFrom || travelTo || destinationNeedle) {
      let tripQuery = db.from("trips").select("id").limit(1000);
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

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [organization?.id, page, search, status, travelFrom, travelTo, destination]);

  useEffect(() => {
    loadRequests();
  }, [organization?.id]);

  const openRequest = () => {
    setRequestForm(emptyRequestForm());
    setRequestOpen(true);
  };

  const updateRequestForm = (key: keyof RequestForm, value: string) => {
    setRequestForm((current) => ({ ...current, [key]: value }));
  };

  const submitRequest = async () => {
    if (!organization || !user || !isActiveAgency) return;
    const travelersCount = Number(requestForm.travelers_count);
    if (!requestForm.client_full_name.trim()) {
      toast.error("Le nom du client est obligatoire.");
      return;
    }
    if (!requestForm.trip_interest.trim()) {
      toast.error("La destination ou le voyage souhaité est obligatoire.");
      return;
    }
    if (!Number.isFinite(travelersCount) || travelersCount < 1) {
      toast.error("Le nombre de voyageurs est obligatoire.");
      return;
    }

    setRequestSaving(true);
    const { error } = await db.from("agency_booking_requests").insert({
      organization_id: organization.id,
      requested_by: user.id,
      client_full_name: requestForm.client_full_name.trim(),
      client_email: requestForm.client_email.trim() || null,
      client_phone: requestForm.client_phone.trim() || null,
      trip_interest: requestForm.trip_interest.trim(),
      travelers_count: travelersCount,
      preferred_departure_date: requestForm.preferred_departure_date || null,
      message: requestForm.message.trim() || null,
      status: "new",
    });

    if (error) {
      toast.error(error.message ?? "Impossible d'envoyer la demande.");
      setRequestSaving(false);
      return;
    }

    toast.success("Demande envoyée.");
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
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-secondary/55">
                <tr className="text-left">
                  <th className="p-4 font-semibold">Client</th>
                  <th className="p-4 font-semibold">Intérêt voyage</th>
                  <th className="p-4 font-semibold">Voyageurs</th>
                  <th className="p-4 font-semibold">Départ souhaité</th>
                  <th className="p-4 font-semibold">Statut</th>
                  <th className="p-4 font-semibold">Créée le</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {requests.map((request) => (
                  <tr key={request.id} className="hover:bg-secondary/30">
                    <td className="p-4">
                      <p className="font-medium">{request.client_full_name}</p>
                      <p className="text-xs text-muted-foreground">{request.client_email || request.client_phone || "—"}</p>
                    </td>
                    <td className="p-4">{request.trip_interest}</td>
                    <td className="p-4">{request.travelers_count}</td>
                    <td className="p-4">{request.preferred_departure_date || "—"}</td>
                    <td className="p-4">{REQUEST_STATUS_LABELS[request.status] ?? request.status}</td>
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
              <Label>Destination / voyage souhaité *</Label>
              <Input value={requestForm.trip_interest} onChange={(event) => updateRequestForm("trip_interest", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Date de départ souhaitée</Label>
              <Input type="date" value={requestForm.preferred_departure_date} onChange={(event) => updateRequestForm("preferred_departure_date", event.target.value)} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Message / notes</Label>
              <Textarea rows={4} value={requestForm.message} onChange={(event) => updateRequestForm("message", event.target.value)} />
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
