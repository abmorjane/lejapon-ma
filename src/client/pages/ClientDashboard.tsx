import { Link } from "react-router-dom";
import { ArrowRight, CalendarCheck, FileSignature, FileText, HelpCircle, Plane, Sparkles, Stamp } from "lucide-react";
import { Seo } from "@/components/Seo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { fmtDate, fmtMAD } from "@/lib/format";
import { bookingPax, bookingRemaining } from "../lib/client-portal";
import { useClientPortalData } from "../lib/useClientPortalData";
import { CLIENT_PORTAL_CANONICAL_PATH } from "../lib/auth-urls";

export default function ClientDashboard() {
  const { bookings, documents, agreements, upcomingBooking, loading } = useClientPortalData();
  const canSeeFinancials = upcomingBooking?.is_booking_owner === true;
  const agreementToAccept = agreements.find((agreement) => agreement.status !== "accepted");
  const acceptedAgreement = agreements.find((agreement) => agreement.status === "accepted");
  const nextActions = [
    !upcomingBooking ? "Aucune réservation liée à cet email pour le moment." : null,
    upcomingBooking && canSeeFinancials && bookingRemaining(upcomingBooking) > 0 ? "Suivre le solde restant à payer." : null,
    upcomingBooking && !acceptedAgreement && agreementToAccept ? "Lire et accepter l’accord de voyage." : null,
    upcomingBooking ? "Vérifier les documents disponibles avant le départ." : null,
    upcomingBooking ? "Compléter ou suivre la demande de visa Japon." : null,
  ].filter(Boolean) as string[];

  if (loading) return <p className="text-sm text-muted-foreground">Chargement de votre espace…</p>;

  return (
    <div className="space-y-6">
      <Seo title="Mon voyage — LeJapon.ma" description="Espace client LeJapon.ma pour suivre votre réservation, vos documents et vos prochaines étapes." noindex />
      <section className="rounded-2xl bg-gradient-to-br from-red-600 to-orange-500 p-6 text-white shadow-sm sm:p-8">
        <p className="mb-3 inline-flex rounded-full bg-white/15 px-3 py-1 text-sm font-medium">Espace client</p>
        <h1 className="font-display text-3xl sm:text-4xl">Mon voyage</h1>
        <p className="mt-3 max-w-2xl text-white/85">
          Retrouvez ici votre réservation, vos documents de voyage, votre visa, vos accords et les expériences optionnelles.
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-4">
        <Metric icon={CalendarCheck} label="Réservations" value={bookings.length} />
        <Metric icon={FileText} label="Documents" value={documents.length} />
        <Metric icon={FileSignature} label="Accords" value={agreements.length} />
        <Metric icon={Sparkles} label="Expériences" value="Optionnel" />
      </div>

      {upcomingBooking ? (
        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Badge variant="outline" className="mb-2">{upcomingBooking.reference}</Badge>
              <CardTitle className="font-display text-2xl">{upcomingBooking.trips?.title || upcomingBooking.trips?.season || "Voyage Japon"}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {fmtDate(upcomingBooking.trips?.start_date)} → {fmtDate(upcomingBooking.trips?.end_date)} · {bookingPax(upcomingBooking)} voyageur(s)
              </p>
            </div>
            <Button asChild>
              <Link to={`${CLIENT_PORTAL_CANONICAL_PATH}/reservations/${upcomingBooking.id}`}>Ouvrir <ArrowRight className="h-4 w-4" /></Link>
            </Button>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <Info label="Statut réservation" value={statusLabel(upcomingBooking.status)} />
            <Info label="Voyageurs" value={`${bookingPax(upcomingBooking)} personne(s)`} />
            <Info label="Accès" value={canSeeFinancials ? "Contact réservation" : "Participant"} />
            {canSeeFinancials && (
              <div className="md:col-span-3 rounded-xl border bg-muted/20 p-4">
                <div className="mb-3 grid gap-3 sm:grid-cols-3">
                  <Info label="Total" value={fmtMAD(upcomingBooking.total_amount_mad)} />
                  <Info label="Payé" value={fmtMAD(upcomingBooking.paid_amount_mad)} />
                  <Info label="Reste à payer" value={fmtMAD(bookingRemaining(upcomingBooking))} strong />
                </div>
                <div className="mb-2 flex justify-between text-sm">
                  <span className="text-muted-foreground">Paiement</span>
                  <span className="font-medium">{fmtMAD(upcomingBooking.paid_amount_mad)} / {fmtMAD(upcomingBooking.total_amount_mad)}</span>
                </div>
                <Progress value={paymentProgress(upcomingBooking)} />
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-2xl">
          <CardContent className="p-8 text-center">
            <Plane className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <h2 className="font-display text-2xl">Aucun voyage lié</h2>
            <p className="mx-auto mt-2 max-w-md text-muted-foreground">
              Connectez-vous avec l’email utilisé lors de la réservation. Si votre dossier existe avec une autre adresse, notre équipe peut le rattacher.
            </p>
          </CardContent>
        </Card>
      )}

      <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="font-display text-xl">Prochaines actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {nextActions.map((action) => (
              <div key={action} className="flex gap-3 rounded-xl border bg-muted/30 p-3 text-sm">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-red-600" />
                <span>{action}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="font-display text-xl">Accès rapide</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            <QuickLink to={`${CLIENT_PORTAL_CANONICAL_PATH}/documents`} icon={FileText} label="Mes documents" />
            <QuickLink to={`${CLIENT_PORTAL_CANONICAL_PATH}/visa`} icon={Stamp} label="Visa Japon" />
            <QuickLink to={`${CLIENT_PORTAL_CANONICAL_PATH}/accords`} icon={FileSignature} label="Accords de voyage" />
            <QuickLink to={`${CLIENT_PORTAL_CANONICAL_PATH}/experiences`} icon={Sparkles} label="Expériences" />
            <QuickLink to={`${CLIENT_PORTAL_CANONICAL_PATH}#contact`} icon={HelpCircle} label="Contacter un conseiller" />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: any; label: string; value: string | number }) {
  return (
    <Card className="rounded-2xl shadow-sm">
      <CardContent className="p-4">
        <Icon className="mb-3 h-5 w-5 text-red-600" />
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
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

function QuickLink({ to, icon: Icon, label }: { to: string; icon: any; label: string }) {
  return (
    <Button asChild variant="outline" className="min-h-11 justify-start">
      <Link to={to}><Icon className="h-4 w-4" /> {label}</Link>
    </Button>
  );
}

function paymentProgress(booking: any) {
  const total = Number(booking.total_amount_mad || 0);
  if (total <= 0) return 0;
  return Math.min(100, Math.round((Number(booking.paid_amount_mad || 0) / total) * 100));
}

function statusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    lead: "Demande reçue",
    confirmed: "Confirmée",
    paid: "Payée",
    cancelled: "Annulée",
  };
  return labels[String(status || "")] || status || "À confirmer";
}
