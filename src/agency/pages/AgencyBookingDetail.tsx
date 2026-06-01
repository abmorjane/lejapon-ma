import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarCheck, FileText, Loader2, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate, fmtDateTime, fmtMAD } from "@/lib/format";
import { useAgencyContext } from "../useAgencyContext";
import type { AgencyBooking, TripSummary } from "../agencyTypes";
import { AgencyStatusBadge } from "../components/AgencyStatusBadge";
import { downloadBytes, generateQuotePdf, generateReceiptPdf } from "@/lib/booking-pdfs";
import {
  PUBLIC_HOTEL_OPTIONS,
  PUBLIC_ROOM_LABELS,
  type PublicHotelKey,
  type PublicRoomKey,
} from "@/lib/booking-options";

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
  commission_rule_label?: string | null;
  special_requests?: string | null;
  payment_status?: "unpaid" | "paid" | null;
  payment_type?: "cash" | "bank_transfer" | "card" | "cheque" | "other" | null;
  payment_date?: string | null;
  paid_amount?: number | null;
  payment_notes?: string | null;
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

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  cash: "Espèces",
  bank_transfer: "Virement",
  card: "Carte",
  cheque: "Chèque",
  other: "Autre",
};

const formatMaybeMoney = (value: number | null | undefined, fallback = "Prix non renseigné") =>
  value === null || value === undefined ? fallback : fmtMAD(value);

export default function AgencyBookingDetail() {
  const { id } = useParams();
  const { organization } = useAgencyContext();
  const [booking, setBooking] = useState<AgencyBooking | null>(null);
  const [request, setRequest] = useState<AgencyBookingRequest | null>(null);
  const [requestForm, setRequestForm] = useState({
    client_full_name: "",
    client_email: "",
    client_phone: "",
    special_requests: "",
    status: "lead" as "lead" | "confirmed" | "paid",
    payment_type: "bank_transfer",
    payment_date: "",
    paid_amount: "",
    payment_notes: "",
  });
  const [requestSaving, setRequestSaving] = useState(false);
  const [pdfBusy, setPdfBusy] = useState<"quote" | "receipt" | null>(null);
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
          status: requestRow.metadata?.payment_status === "paid" ? "paid" : requestRow.status === "converted" ? "confirmed" : "lead",
          payment_type: requestRow.metadata?.payment_type ?? "bank_transfer",
          payment_date: requestRow.metadata?.payment_date ?? "",
          paid_amount: requestRow.metadata?.paid_amount === null || requestRow.metadata?.paid_amount === undefined ? "" : String(requestRow.metadata.paid_amount),
          payment_notes: requestRow.metadata?.payment_notes ?? "",
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
    const nextDbStatus: AgencyRequestStatus = requestForm.status === "lead" ? "new" : "converted";
    const paidAmount = requestForm.paid_amount.trim() ? Number(requestForm.paid_amount) : null;
    setRequestSaving(true);
    const nextMetadata = {
      ...(request.metadata ?? {}),
      special_requests: requestForm.special_requests.trim() || null,
      payment_status: requestForm.status === "paid" ? "paid" : "unpaid",
      payment_type: requestForm.payment_type || null,
      payment_date: requestForm.payment_date || null,
      paid_amount: Number.isFinite(paidAmount) ? paidAmount : null,
      payment_notes: requestForm.payment_notes.trim() || null,
    };
    const { data, error } = await db
      .from("agency_booking_requests")
      .update({
        client_full_name: requestForm.client_full_name.trim(),
        client_email: requestForm.client_email.trim() || null,
        client_phone: requestForm.client_phone.trim() || null,
        message: requestForm.special_requests.trim() || null,
        metadata: nextMetadata,
        status: nextDbStatus,
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

  const buildRequestPdfData = () => {
    if (!request) return null;
    const metadata = request.metadata ?? {};
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
      paid_amount_mad: Number(metadata.paid_amount ?? 0),
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
      email: organization?.email ?? undefined,
      phone: organization?.phone ?? undefined,
      address_line1: organization?.address_line_1 ?? undefined,
      address_line2: organization?.address_line_2 ?? undefined,
      city: organization?.city ?? undefined,
      postal_code: organization?.postal_code ?? undefined,
      country: organization?.country ?? undefined,
    };
    return { bookingLike, tripLike, extras, agency };
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
    const amount = Number(metadata.paid_amount ?? 0);
    if (!amount) {
      toast.error("Renseignez un montant payé avant de générer le reçu.");
      return;
    }
    setPdfBusy("receipt");
    try {
      const bytes = await generateReceiptPdf({
        booking: pdfData.bookingLike,
        trip: pdfData.tripLike,
        extras: pdfData.extras,
        payment: {
          amount_mad: amount,
          method: metadata.payment_type ? PAYMENT_TYPE_LABELS[metadata.payment_type] ?? metadata.payment_type : null,
          paid_at: metadata.payment_date ?? new Date().toISOString(),
          reference: `AG-${request.id.slice(0, 8).toUpperCase()}`,
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
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Payé</span><span className="font-semibold">{formatMaybeMoney(metadata.paid_amount, "0 MAD")}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Reste</span><span className="font-semibold">{formatMaybeMoney(Math.max(0, Number(metadata.estimated_total || 0) - Number(metadata.paid_amount || 0)))}</span></div>
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
              <div><p className="text-xs text-muted-foreground">Départ</p><p className="font-medium">{request.preferred_departure_date ? fmtDate(request.preferred_departure_date) : "—"}</p></div>
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
                  <span>{extra.name || "Extra"} x{extra.quantity ?? 1}</span>
                  <span className="font-medium">{formatMaybeMoney(extra.total ?? Number(extra.price_mad ?? extra.unit_price ?? 0) * Number(extra.quantity ?? 1), "prix non renseigné")}</span>
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
          <h2 className="font-display text-xl">Statut et paiement</h2>
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
            <div className="space-y-2">
              <Label>Type de paiement</Label>
              <Select value={requestForm.payment_type} onValueChange={(value) => setRequestForm((current) => ({ ...current, payment_type: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PAYMENT_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Date paiement</Label>
              <Input type="date" value={requestForm.payment_date} onChange={(event) => setRequestForm((current) => ({ ...current, payment_date: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Montant payé</Label>
              <Input type="number" min={0} value={requestForm.paid_amount} onChange={(event) => setRequestForm((current) => ({ ...current, paid_amount: event.target.value }))} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Notes paiement</Label>
              <Textarea rows={3} value={requestForm.payment_notes} onChange={(event) => setRequestForm((current) => ({ ...current, payment_notes: event.target.value }))} />
            </div>
          </div>
        </Card>

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
