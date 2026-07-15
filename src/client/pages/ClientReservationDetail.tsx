import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, BedDouble, FileText, Plane, Sparkles, Users } from "lucide-react";
import { Seo } from "@/components/Seo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { fmtDate, fmtMAD } from "@/lib/format";
import {
  bookingPax,
  bookingRemaining,
  loadBookingExtras,
  loadBookingParticipants,
  loadClientBooking,
  loadTripHotels,
  type ClientBooking,
  type ClientBookingExtra,
  type ClientParticipant,
} from "../lib/client-portal";
import { CLIENT_PORTAL_CANONICAL_PATH } from "../lib/auth-urls";

export default function ClientReservationDetail() {
  const { bookingId } = useParams();
  const [booking, setBooking] = useState<ClientBooking | null>(null);
  const [participants, setParticipants] = useState<ClientParticipant[]>([]);
  const [extras, setExtras] = useState<ClientBookingExtra[]>([]);
  const [hotels, setHotels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!bookingId) return;
      setLoading(true);
      try {
        const row = await loadClientBooking(bookingId);
        if (cancelled) return;
        setBooking(row);
        if (row) {
          const [participantRows, extraRows, hotelRows] = await Promise.all([
            loadBookingParticipants(row.id).catch(() => []),
            loadBookingExtras(row.id).catch(() => []),
            loadTripHotels(row.trip_id).catch(() => []),
          ]);
          if (!cancelled) {
            setParticipants(participantRows);
            setExtras(extraRows);
            setHotels(hotelRows);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  if (loading) return <p className="text-sm text-muted-foreground">Chargement de la réservation…</p>;

  if (!booking) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="p-8 text-center">
          <h1 className="font-display text-2xl">Réservation introuvable</h1>
          <p className="mt-2 text-muted-foreground">Cette réservation n’est pas liée à votre compte.</p>
          <Button asChild className="mt-5"><Link to={`${CLIENT_PORTAL_CANONICAL_PATH}/reservations`}>Retour</Link></Button>
        </CardContent>
      </Card>
    );
  }

  const trip = booking.trips;
  const canSeeFinancials = booking.is_booking_owner === true;

  return (
    <div className="space-y-5">
      <Seo title={`${booking.reference} — Mon voyage LeJapon.ma`} description="Détail de votre réservation LeJapon.ma." noindex />
      <Button asChild variant="ghost" className="pl-0">
        <Link to={`${CLIENT_PORTAL_CANONICAL_PATH}/reservations`}><ArrowLeft className="h-4 w-4" /> Mes réservations</Link>
      </Button>

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <Badge variant="outline" className="mb-3">{booking.reference}</Badge>
        <h1 className="font-display text-3xl">{trip?.title || trip?.season || "Voyage Japon"}</h1>
        <p className="mt-2 text-muted-foreground">
          {fmtDate(trip?.start_date)} → {fmtDate(trip?.end_date)} · {bookingPax(booking)} voyageur(s)
        </p>
        {canSeeFinancials ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Info label="Total" value={fmtMAD(booking.total_amount_mad)} />
            <Info label="Payé" value={fmtMAD(booking.paid_amount_mad)} />
            <Info label="Reste" value={fmtMAD(bookingRemaining(booking))} strong />
          </div>
        ) : (
          <p className="mt-5 rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
            Vous avez un accès participant à cette réservation. Les montants, paiements et documents financiers sont visibles uniquement par le contact principal.
          </p>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_330px]">
        <div className="space-y-5">
          <Card className="rounded-2xl">
            <CardHeader><CardTitle className="flex items-center gap-2 font-display text-xl"><Plane className="h-5 w-5 text-red-600" /> Détails du voyage</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Info label="Durée du voyage" value={trip?.total_trip_days ? `${trip.total_trip_days} jours` : trip?.duration_days ? `${trip.duration_days} jours` : "À confirmer"} />
              <Info label="Séjour au Japon" value={trip?.japan_stay_days ? `${trip.japan_stay_days} jours` : "À confirmer"} />
              <Info label="Destination" value={trip?.destination || "Japon"} />
              <Info label="Chambre" value={booking.room_type || booking.formula || "À confirmer"} />
              {(trip?.outbound_flight_text || trip?.return_flight_text || trip?.visa_arrival_flight_number) && (
                <div className="sm:col-span-2 rounded-xl border bg-muted/20 p-4">
                  <p className="text-xs text-muted-foreground">Vols</p>
                  {trip.outbound_flight_text && <p className="mt-2 whitespace-pre-line text-sm">{trip.outbound_flight_text}</p>}
                  {trip.return_flight_text && <p className="mt-2 whitespace-pre-line text-sm">{trip.return_flight_text}</p>}
                  {!trip.outbound_flight_text && trip.visa_arrival_flight_number && <p className="mt-2 text-sm">{trip.visa_arrival_flight_number}</p>}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader><CardTitle className="flex items-center gap-2 font-display text-xl"><Users className="h-5 w-5 text-red-600" /> Participants</CardTitle></CardHeader>
            <CardContent>
              {participants.length === 0 ? <p className="text-sm text-muted-foreground">Les participants seront visibles après renseignement par notre équipe.</p> : (
                <div className="space-y-2">
                  {participants.map((participant, index) => (
                    <div key={participant.id} className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm">
                      <span>{index + 1}. {[participant.first_name, participant.last_name].filter(Boolean).join(" ") || "Participant"}</span>
                      <span className="text-muted-foreground">{participant.client_type || participant.room_type || "Voyageur"}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader><CardTitle className="flex items-center gap-2 font-display text-xl"><BedDouble className="h-5 w-5 text-red-600" /> Hôtels prévus</CardTitle></CardHeader>
            <CardContent>
              {hotels.length === 0 ? <p className="text-sm text-muted-foreground">Les hôtels seront confirmés et publiés dès disponibilité.</p> : (
                <div className="space-y-2">
                  {hotels.map((hotel) => (
                    <div key={hotel.id} className="rounded-xl border p-3">
                      <p className="font-medium">{hotel.name}</p>
                      <p className="text-sm text-muted-foreground">{hotel.city || "Ville à confirmer"} · {fmtDate(hotel.check_in)} → {fmtDate(hotel.check_out)}</p>
                      {hotel.address && <p className="mt-1 text-xs text-muted-foreground">{hotel.address}</p>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-5">
          <Card className="rounded-2xl">
            <CardHeader><CardTitle className="flex items-center gap-2 font-display text-xl"><Sparkles className="h-5 w-5 text-red-600" /> Expériences</CardTitle></CardHeader>
            <CardContent>
              {extras.length === 0 ? <p className="text-sm text-muted-foreground">Aucune expérience optionnelle ajoutée.</p> : (
                <div className="space-y-2">
                  {extras.map((extra) => (
                    <div key={extra.id} className="flex justify-between gap-3 text-sm">
                      <span>{extra.name_snapshot} × {extra.qty}</span>
                      <span className="font-medium">{fmtMAD(extra.qty * extra.unit_price_mad)}</span>
                    </div>
                  ))}
                </div>
              )}
              <Separator className="my-4" />
              <Button asChild variant="outline" className="w-full">
                <Link to={`${CLIENT_PORTAL_CANONICAL_PATH}/experiences`}>Gérer mes expériences</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader><CardTitle className="flex items-center gap-2 font-display text-xl"><FileText className="h-5 w-5 text-red-600" /> Documents</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Billets, reçus, programme, assurance ou autres documents publiés par l’équipe.</p>
              <Button asChild className="mt-4 w-full">
                <Link to={`${CLIENT_PORTAL_CANONICAL_PATH}/documents`}>Voir mes documents</Link>
              </Button>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Info({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={strong ? "mt-1 font-semibold text-red-700" : "mt-1 font-medium"}>{value}</p>
    </div>
  );
}
