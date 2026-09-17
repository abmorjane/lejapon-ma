import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Archive, ArrowRight, BedDouble, Bell, Check, ClipboardList, Plane, Ticket, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtDate } from "@/lib/format";
import { TripArchiveView, tripsForArchiveView } from "@/lib/trip-archiving";

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
  archived_at?: string | null;
  archive_reason?: string | null;
};

type SupplierNotification = {
  id: string;
  title: string;
  message?: string | null;
  link?: string | null;
  read_at?: string | null;
  created_at: string;
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
  const { user, isAdmin } = useAuth();
  const [trips, setTrips] = useState<TripCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [supplierIds, setSupplierIds] = useState<string[]>([]);
  const [quoteTableMissing, setQuoteTableMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadErrorDetail, setLoadErrorDetail] = useState<string | null>(null);
  const [hasSupplierMembership, setHasSupplierMembership] = useState(true);
  const [notifications, setNotifications] = useState<SupplierNotification[]>([]);
  const [archiveView, setArchiveView] = useState<TripArchiveView>("active");

  useEffect(() => {
    (async () => {
      if (!user) return;
      setLoading(true);
      setQuoteTableMissing(false);
      setLoadError(null);
      setLoadErrorDetail(null);

      const { data: members, error: membersError } = await db
        .from("supplier_members")
        .select("supplier_id")
        .eq("user_id", user.id);
      if (membersError && !isAdmin) {
        setTrips([]);
        setHasSupplierMembership(false);
        setLoadError("Impossible de charger votre rattachement fournisseur.");
        setLoadErrorDetail(formatSupabaseError(membersError));
        setLoading(false);
        return;
      }
      const currentSupplierIds = Array.from(new Set((members ?? []).map((member: any) => member.supplier_id).filter(Boolean)));
      setSupplierIds(currentSupplierIds);
      setHasSupplierMembership(isAdmin || currentSupplierIds.length > 0);

      if (!isAdmin) {
        const [{ data: dashboardRows, error: dashboardError }, notificationResult] = await Promise.all([
          db.rpc("get_supplier_trip_dashboard"),
          db.from("supplier_portal_notifications").select("id,title,message,link,read_at,created_at").order("created_at", { ascending: false }).limit(8),
        ]);
        if (dashboardError) {
          console.error("Supplier dashboard query failed", dashboardError);
          setTrips([]);
          setLoadError("Impossible de charger vos voyages assignés.");
          setLoadErrorDetail(formatSupabaseError(dashboardError));
          setLoading(false);
          return;
        }
        if (notificationResult.error && !isMissingTableError(notificationResult.error)) {
          console.error("Supplier notifications query failed", notificationResult.error);
        }
        setNotifications(notificationResult.data ?? []);
        setTrips((dashboardRows ?? []) as TripCard[]);
        setLoading(false);
        return;
      }

      let assignedTripIds: string[] = [];
      if (currentSupplierIds.length) {
        const { data: assignments, error: assignmentError } = await db
          .from("trip_suppliers")
          .select("trip_id")
          .in("supplier_id", currentSupplierIds);
        if (assignmentError && !isAdmin) {
          setTrips([]);
          setLoadError("Impossible de charger vos voyages assignés.");
          setLoadErrorDetail(formatSupabaseError(assignmentError));
          setLoading(false);
          return;
        }
        assignedTripIds = Array.from(new Set((assignments ?? []).map((item: any) => item.trip_id).filter(Boolean)));
      }
      if (!isAdmin && !assignedTripIds.length) {
        setTrips([]);
        setLoading(false);
        return;
      }

      let tripQuery = db
        .from("trips")
        .select("id,title,status,start_date,end_date,duration_days,season,archived_at,archive_reason")
        .order("start_date", { ascending: true, nullsFirst: false });

      if (assignedTripIds.length) {
        tripQuery = tripQuery.in("id", assignedTripIds);
      }

      const { data: tripRows, error: tripError } = await tripQuery;
      if (tripError) {
        console.error("Supplier trips query failed", tripError);
        setTrips([]);
        setLoadError("Impossible de charger vos voyages assignés.");
        setLoadErrorDetail(formatSupabaseError(tripError));
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

  const markNotificationRead = async (notification: SupplierNotification) => {
    const { error } = await db.rpc("mark_supplier_notification_read", { p_notification_id: notification.id });
    if (error) return;
    setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item));
  };

  const activeTrips = tripsForArchiveView(trips, "active");
  const archivedTrips = tripsForArchiveView(trips, "archived");
  const visibleTrips = tripsForArchiveView(trips, archiveView);
  const summary = {
    trips: activeTrips.length,
    participants: activeTrips.reduce((sum, trip) => sum + trip.participant_count, 0),
    rooms: activeTrips.reduce((sum, trip) => sum + trip.room_count, 0),
    extras: activeTrips.reduce((sum, trip) => sum + trip.extras_count, 0),
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Japan Office - vue fournisseur"
        description="Vos voyages assignés, devis Japon, rooming, participants, documents et messages opérationnels."
      />

      {quoteTableMissing && (
        <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          Les tables du quote engine fournisseur ne sont pas encore disponibles. La lecture opérationnelle fonctionne, mais l'enregistrement des devis nécessite la migration SQL V1.
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard icon={Plane} label="Voyages assignés" value={summary.trips} />
        <StatCard icon={Archive} label="Voyages archivés" value={archivedTrips.length} />
        <StatCard icon={Users} label="Participants" value={summary.participants} />
        <StatCard icon={BedDouble} label="Hôtels actifs" value={summary.rooms} />
        <StatCard icon={Ticket} label="Extras actifs" value={summary.extras} />
      </div>

      <Tabs value={archiveView} onValueChange={(value) => setArchiveView(value as TripArchiveView)}>
        <TabsList className="grid h-11 w-full grid-cols-2 rounded-xl sm:w-[420px]">
          <TabsTrigger value="active" className="rounded-lg">Voyages assignés ({activeTrips.length})</TabsTrigger>
          <TabsTrigger value="archived" className="rounded-lg">Voyages archivés ({archivedTrips.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {!isAdmin && notifications.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Bell className="h-4 w-4 text-primary" />
            <h2 className="font-display text-lg">Notifications</h2>
            <Badge variant="outline">{notifications.filter((item) => !item.read_at).length} non lue(s)</Badge>
          </div>
          <div className="divide-y divide-border">
            {notifications.map((notification) => (
              <div key={notification.id} className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between ${notification.read_at ? "opacity-70" : "bg-primary/5"}`}>
                <div>
                  <p className="font-medium">{notification.title}</p>
                  {notification.message && <p className="text-sm text-muted-foreground">{notification.message}</p>}
                </div>
                <div className="flex gap-2">
                  {notification.link && <Button asChild size="sm" variant="outline"><Link to={notification.link}>Ouvrir</Link></Button>}
                  {!notification.read_at && <Button size="sm" variant="ghost" onClick={() => void markNotificationRead(notification)}><Check className="h-4 w-4" /> Lu</Button>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {loading ? (
        <p className="text-muted-foreground">Chargement…</p>
      ) : loadError ? (
        <Card className="p-10 text-center">
          <Plane className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="font-medium">{loadError}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Contactez l'équipe LeJapon.ma si le problème persiste.
          </p>
          {loadErrorDetail && <p className="mt-3 break-all font-mono text-xs text-destructive">{loadErrorDetail}</p>}
        </Card>
      ) : visibleTrips.length === 0 ? (
        <Card className="p-10 text-center">
          <Plane className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="font-medium">
            {archiveView === "archived"
              ? "Aucun voyage archivé."
              : hasSupplierMembership ? "Aucun voyage ne vous est actuellement assigné." : "Votre compte fournisseur n'est pas encore relié à un fournisseur."}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {archiveView === "archived"
              ? "Les voyages archivés par l’agence apparaîtront ici en lecture seule."
              : "Dès qu'un voyage vous sera assigné, il apparaîtra ici avec ses onglets opérationnels."}
          </p>
        </Card>
      ) : (
        <div className="grid gap-3">
          <h2 className="font-display text-xl">{archiveView === "archived" ? "Mes voyages archivés" : "Mes voyages assignés"}</h2>
          {visibleTrips.map((trip) => (
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
                    {trip.archived_at ? "Consulter le devis" : "Préparer le devis"}
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

const formatSupabaseError = (error: any) => [error?.code, error?.message, error?.details, error?.hint].filter(Boolean).join(" · ") || "Erreur Supabase inconnue";

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
