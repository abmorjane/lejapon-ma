import { Link } from "react-router-dom";
import { ArrowRight, CalendarCheck } from "lucide-react";
import { Seo } from "@/components/Seo";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtMAD } from "@/lib/format";
import { bookingPax, bookingRemaining } from "../lib/client-portal";
import { useClientPortalData } from "../lib/useClientPortalData";
import { CLIENT_PORTAL_CANONICAL_PATH } from "../lib/auth-urls";

export default function ClientReservations() {
  const { bookings, loading } = useClientPortalData();

  return (
    <div className="space-y-5">
      <Seo title="Mes réservations — LeJapon.ma" description="Liste de vos réservations LeJapon.ma." noindex />
      <div>
        <h1 className="font-display text-3xl">Mes réservations</h1>
        <p className="mt-2 text-muted-foreground">Vos voyages liés à l’email de votre compte.</p>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Chargement…</p> : null}
      {!loading && bookings.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="p-8 text-center">
            <CalendarCheck className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <h2 className="font-display text-2xl">Aucune réservation trouvée</h2>
            <p className="mt-2 text-muted-foreground">Utilisez le même email que celui renseigné lors de votre réservation.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {bookings.map((booking) => (
            <Card key={booking.id} className="rounded-2xl shadow-sm">
              <CardContent className="grid gap-4 p-5 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <Badge variant="outline" className="mb-2">{booking.reference}</Badge>
                  <h2 className="font-display text-2xl">{booking.trips?.title || booking.trips?.season || "Voyage Japon"}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {fmtDate(booking.trips?.start_date)} → {fmtDate(booking.trips?.end_date)} · {bookingPax(booking)} voyageur(s)
                  </p>
                  {booking.is_booking_owner ? (
                    <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                      <span>Total : <strong>{fmtMAD(booking.total_amount_mad)}</strong></span>
                      <span>Payé : <strong>{fmtMAD(booking.paid_amount_mad)}</strong></span>
                      <span>Reste : <strong>{fmtMAD(bookingRemaining(booking))}</strong></span>
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-muted-foreground">Accès participant : les informations financières sont réservées au contact de la réservation.</p>
                  )}
                </div>
                <Button asChild>
                  <Link to={`${CLIENT_PORTAL_CANONICAL_PATH}/reservations/${booking.id}`}>Voir le détail <ArrowRight className="h-4 w-4" /></Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
