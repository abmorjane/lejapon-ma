import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { fmtDateTime, fmtMAD } from "@/lib/format";
import { useAgencyContext } from "../useAgencyContext";
import type { AgencyBooking, TripSummary } from "../agencyTypes";
import { AgencyStatusBadge } from "../components/AgencyStatusBadge";

type DbClient = { from: (table: string) => any };
const db = supabase as unknown as DbClient;

const bookingColumns = "id,reference,contact_name,contact_email,contact_phone,status,total_amount_mad,paid_amount_mad,created_at,preferred_dates,trip_id,agency_organization_id,agency_attributed_at,num_adults,num_children";
const requestColumns = "id,organization_id,requested_by,client_full_name,client_email,client_phone,trip_interest,travelers_count,preferred_departure_date,message,status,metadata,created_at";

type PaymentRow = {
  id: string;
  amount_mad: number;
  paid_at: string | null;
  created_at: string | null;
  status: string;
  reference: string | null;
};

type AgencyRequestStatus = "new" | "contacted" | "quoted" | "converted" | "rejected";

type RequestMetadata = {
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
  commission_rule_label?: string | null;
  special_requests?: string | null;
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

export default function AgencyBookingDetail() {
  const { id } = useParams();
  const { organization } = useAgencyContext();
  const [booking, setBooking] = useState<AgencyBooking | null>(null);
  const [request, setRequest] = useState<AgencyBookingRequest | null>(null);
  const [requestForm, setRequestForm] = useState({ client_full_name: "", client_email: "", client_phone: "", special_requests: "" });
  const [requestSaving, setRequestSaving] = useState(false);
  const [trip, setTrip] = useState<TripSummary | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

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
          special_requests: requestRow.metadata?.special_requests ?? requestRow.message ?? "",
        });
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
    setRequestSaving(true);
    const nextMetadata = {
      ...(request.metadata ?? {}),
      special_requests: requestForm.special_requests.trim() || null,
    };
    const { data, error } = await db
      .from("agency_booking_requests")
      .update({
        client_full_name: requestForm.client_full_name.trim(),
        client_email: requestForm.client_email.trim() || null,
        client_phone: requestForm.client_phone.trim() || null,
        message: requestForm.special_requests.trim() || null,
        metadata: nextMetadata,
      })
      .eq("id", request.id)
      .eq("organization_id", request.organization_id)
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
    const selectedExtras = metadata.selected_extras ?? [];
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
          <span className="inline-flex rounded-full border border-border px-3 py-1 text-sm font-medium">
            {REQUEST_STATUS_LABELS[request.status] ?? request.status}
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2">
            <h2 className="font-display text-xl">Client</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Nom</Label>
                <Input value={requestForm.client_full_name} onChange={(event) => setRequestForm((current) => ({ ...current, client_full_name: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={requestForm.client_email} onChange={(event) => setRequestForm((current) => ({ ...current, client_email: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Téléphone</Label>
                <Input value={requestForm.client_phone} onChange={(event) => setRequestForm((current) => ({ ...current, client_phone: event.target.value }))} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Voyageurs</p>
                <p className="mt-2 font-medium">{request.travelers_count}</p>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="font-display text-xl">Résumé estimatif</h2>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Total</span><span className="font-semibold">{formatMaybeMoney(metadata.estimated_total)}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Commission</span><span className="font-semibold">{formatMaybeMoney(metadata.estimated_commission, "Commission non renseignée")}</span></div>
              <p className="text-xs text-muted-foreground">{metadata.commission_rule_label || "Règle commission non renseignée"}</p>
            </div>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="font-display text-xl">Voyage</h2>
            <div className="mt-4 space-y-3 text-sm">
              <div><p className="text-xs text-muted-foreground">Programme / voyage</p><p className="font-medium">{metadata.trip_title || request.trip_interest}</p></div>
              <div><p className="text-xs text-muted-foreground">Destination</p><p className="font-medium">{metadata.destination || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Départ souhaité</p><p className="font-medium">{request.preferred_departure_date || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Chambre</p><p className="font-medium">{metadata.room_type ? ROOM_TYPE_LABELS[metadata.room_type] ?? metadata.room_type : "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Hôtel</p><p className="font-medium">{metadata.hotel_category ? HOTEL_CATEGORY_LABELS[metadata.hotel_category] ?? metadata.hotel_category : "—"}</p></div>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="font-display text-xl">Extras</h2>
            <div className="mt-4 space-y-3 text-sm">
              {selectedExtras.length === 0 ? (
                <p className="text-muted-foreground">Aucun extra sélectionné.</p>
              ) : selectedExtras.map((extra) => (
                <div key={extra.id || extra.name} className="flex justify-between gap-3">
                  <span>{extra.name || "Extra"}</span>
                  <span className="font-medium">{formatMaybeMoney(extra.price_mad, "prix non renseigné")}</span>
                </div>
              ))}
              <div className="flex justify-between gap-3 border-t border-border pt-3">
                <span className="text-muted-foreground">Total extras</span>
                <span className="font-semibold">{formatMaybeMoney(metadata.extras_total)}</span>
              </div>
            </div>
          </Card>
        </div>

        <Card className="p-5">
          <h2 className="font-display text-xl">Demandes spéciales</h2>
          <Textarea
            className="mt-4"
            rows={5}
            value={requestForm.special_requests}
            onChange={(event) => setRequestForm((current) => ({ ...current, special_requests: event.target.value }))}
          />
          <p className="mt-2 text-xs text-muted-foreground">Le statut, les prix et la commission sont mis à jour par l'administration.</p>
          <Button className="mt-4" onClick={saveRequest} disabled={requestSaving}>
            {requestSaving ? "Enregistrement…" : "Enregistrer les modifications"}
          </Button>
        </Card>
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
