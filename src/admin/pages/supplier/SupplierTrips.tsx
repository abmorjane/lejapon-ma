import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BedDouble, CircleDollarSign, ClipboardList, Plane, Ticket, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fmtDate } from "@/lib/format";

const db = supabase as any;

type TripCard = {
  id: string;
  title: string;
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  duration_days?: number | null;
  season?: string | null;
  participant_count: number;
  room_count: number;
  extras_count: number;
  quote_status: string;
  quote_id?: string | null;
};

const quoteStatusLabel: Record<string, string> = {
  draft: "Brouillon",
  submitted: "Soumis",
  reviewed: "Revu",
  approved: "Approuvé",
  revision_requested: "Révision demandée",
};

const quoteBadgeClass = (status: string) => {
  if (status === "approved") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "submitted") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "reviewed") return "border-violet-200 bg-violet-50 text-violet-700";
  if (status === "revision_requested") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-border bg-secondary text-muted-foreground";
};

export default function SupplierTrips() {
  const { user, roles } = useAuth();
  const [trips, setTrips] = useState<TripCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [supplierIds, setSupplierIds] = useState<string[]>([]);
  const [quoteTableMissing, setQuoteTableMissing] = useState(false);
  const isAdmin = roles.some((role) => ["super_admin", "admin"].includes(role));

  useEffect(() => {
    (async () => {
      if (!user) return;
      setLoading(true);
      setQuoteTableMissing(false);

      const { data: members } = await db
        .from("supplier_members")
        .select("supplier_id")
        .eq("user_id", user.id);
      const currentSupplierIds = Array.from(new Set((members ?? []).map((member: any) => member.supplier_id).filter(Boolean)));
      setSupplierIds(currentSupplierIds);

      let assignedTripIds: string[] = [];
      if (currentSupplierIds.length) {
        const { data: assignments } = await db
          .from("trip_suppliers")
          .select("trip_id")
          .in("supplier_id", currentSupplierIds);
        assignedTripIds = Array.from(new Set((assignments ?? []).map((item: any) => item.trip_id).filter(Boolean)));
      }

      let tripQuery = db
        .from("trips")
        .select("id,title,status,start_date,end_date,duration_days,season,is_public")
        .order("start_date", { ascending: true, nullsFirst: false });

      if (assignedTripIds.length) {
        tripQuery = tripQuery.in("id", assignedTripIds);
      } else if (!isAdmin) {
        tripQuery = tripQuery.or("status.eq.active,status.eq.published,is_public.eq.true");
      }

      const { data: tripRows, error: tripError } = await tripQuery;
      if (tripError) {
        setTrips([]);
        setLoading(false);
        return;
      }

      const tripIds = (tripRows ?? []).map((trip: any) => trip.id);
      if (!tripIds.length) {
        setTrips([]);
        setLoading(false);
        return;
      }

      const [{ data: participants }, { data: hotels }, { data: extras }, quoteResult] = await Promise.all([
        db.from("booking_participants").select("id,trip_id").in("trip_id", tripIds),
        db.from("trip_hotels").select("id,trip_id").in("trip_id", tripIds),
        db.from("booking_extras").select("id,booking_id,qty,bookings!inner(trip_id)").in("bookings.trip_id", tripIds),
        db
          .from("supplier_trip_quotes")
          .select("id,trip_id,supplier_id,status")
          .in("trip_id", tripIds),
      ]);

      if (quoteResult.error && isMissingTableError(quoteResult.error)) setQuoteTableMissing(true);

      const participantCountByTrip = countBy(participants ?? [], "trip_id");
      const roomCountByTrip = countBy(hotels ?? [], "trip_id");
      const extrasCountByTrip = new Map<string, number>();
      (extras ?? []).forEach((extra: any) => {
        const tripId = extra.bookings?.trip_id;
        if (!tripId) return;
        extrasCountByTrip.set(tripId, (extrasCountByTrip.get(tripId) ?? 0) + Number(extra.qty ?? 1));
      });

      const quoteByTrip = new Map<string, any>();
      (quoteResult.data ?? []).forEach((quote: any) => {
        if (!quote.trip_id) return;
        if (currentSupplierIds.length && quote.supplier_id && !currentSupplierIds.includes(quote.supplier_id) && !isAdmin) return;
        quoteByTrip.set(quote.trip_id, quote);
      });

      setTrips((tripRows ?? []).map((trip: any) => {
        const quote = quoteByTrip.get(trip.id);
        return {
          ...trip,
          participant_count: participantCountByTrip.get(trip.id) ?? 0,
          room_count: roomCountByTrip.get(trip.id) ?? 0,
          extras_count: extrasCountByTrip.get(trip.id) ?? 0,
          quote_status: quote?.status ?? "draft",
          quote_id: quote?.id ?? null,
        };
      }));
      setLoading(false);
    })();
  }, [isAdmin, user]);

  const summary = useMemo(() => ({
    trips: trips.length,
    participants: trips.reduce((sum, trip) => sum + trip.participant_count, 0),
    rooms: trips.reduce((sum, trip) => sum + trip.room_count, 0),
    extras: trips.reduce((sum, trip) => sum + trip.extras_count, 0),
  }), [trips]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Japan Office - voyages actifs"
        description="Vue opérationnelle fournisseurs: participants, chambres, activités et devis Japon par voyage."
      />

      {quoteTableMissing && (
        <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          Les tables du quote engine fournisseur ne sont pas encore disponibles. La lecture opérationnelle fonctionne, mais l'enregistrement des devis nécessite la migration SQL V1.
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Plane} label="Voyages" value={summary.trips} />
        <StatCard icon={Users} label="Participants" value={summary.participants} />
        <StatCard icon={BedDouble} label="Hôtels / blocs" value={summary.rooms} />
        <StatCard icon={Ticket} label="Extras sélectionnés" value={summary.extras} />
      </div>

      {loading ? (
        <p className="text-muted-foreground">Chargement…</p>
      ) : trips.length === 0 ? (
        <Card className="p-10 text-center">
          <Plane className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="font-medium">Aucun voyage visible</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Les fournisseurs voient leurs voyages assignés. Sans assignation en V1, ils voient les voyages actifs/publics.
          </p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {trips.map((trip) => (
            <Card key={trip.id} className="p-4 transition-colors hover:border-primary/50">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-lg">{trip.title}</h3>
                    <StatusBadge value={trip.status} />
                    <Badge variant="outline" className={quoteBadgeClass(trip.quote_status)}>
                      {quoteStatusLabel[trip.quote_status] ?? trip.quote_status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {trip.season ? `${trip.season} - ` : ""}{fmtDate(trip.start_date)} → {fmtDate(trip.end_date)} · {trip.duration_days ?? "?"} jours
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs text-muted-foreground sm:min-w-[280px]">
                  <MiniMetric label="Participants" value={trip.participant_count} />
                  <MiniMetric label="Chambres" value={trip.room_count} />
                  <MiniMetric label="Extras" value={trip.extras_count} />
                </div>
                <Button asChild>
                  <Link to={`/supplier/trips/${trip.id}/quote`}>
                    <ClipboardList className="h-4 w-4" />
                    Préparer le devis
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

const countBy = (rows: any[], key: string) => {
  const map = new Map<string, number>();
  rows.forEach((row) => {
    const value = row?.[key];
    if (value) map.set(value, (map.get(value) ?? 0) + 1);
  });
  return map;
};

const isMissingTableError = (error: any) =>
  ["42P01", "PGRST205", "PGRST204"].includes(error?.code) || /Could not find the table|does not exist|schema cache/i.test(error?.message ?? "");

const StatCard = ({ icon: Icon, label, value }: { icon: any; label: string; value: number }) => (
  <Card className="p-4">
    <div className="flex items-center gap-3">
      <span className="rounded-lg bg-primary/10 p-2 text-primary"><Icon className="h-4 w-4" /></span>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-display text-xl">{value}</p>
      </div>
    </div>
  </Card>
);

const MiniMetric = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
    <p className="font-semibold text-foreground">{value}</p>
    <p>{label}</p>
  </div>
);
