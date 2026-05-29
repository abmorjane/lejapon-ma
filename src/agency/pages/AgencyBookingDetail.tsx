import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarCheck, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { fmtDateTime, fmtMAD } from "@/lib/format";
import { useAgencyContext } from "../useAgencyContext";
import type { AgencyBooking, TripSummary } from "../agencyTypes";
import { AgencyStatusBadge } from "../components/AgencyStatusBadge";

type DbClient = { from: (table: string) => any };
const db = supabase as unknown as DbClient;

const bookingColumns = "id,reference,contact_name,contact_email,contact_phone,status,total_amount_mad,paid_amount_mad,created_at,preferred_dates,trip_id,agency_organization_id,agency_attributed_at,num_adults,num_children";

type PaymentRow = {
  id: string;
  amount_mad: number;
  paid_at: string | null;
  created_at: string | null;
  status: string;
  reference: string | null;
};

export default function AgencyBookingDetail() {
  const { id } = useParams();
  const { organization } = useAgencyContext();
  const [booking, setBooking] = useState<AgencyBooking | null>(null);
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
        setBooking(null);
        setNotFound(true);
        setLoading(false);
        return;
      }

      const bookingRow = data as AgencyBooking;
      setBooking(bookingRow);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Chargement…
      </div>
    );
  }

  if (notFound || !booking) {
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
