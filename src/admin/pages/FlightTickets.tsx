/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Eye, Plane, RefreshCw, Search, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/admin/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtDate, fmtDateTime } from "@/lib/format";
import {
  createStampedFlightTicketPdf,
  downloadBytes,
  flightTicketVisaFilename,
  FLIGHT_TICKET_STATUS_CLASSES,
  FLIGHT_TICKET_STATUS_LABELS,
  getFlightTicketStatus,
  missingFlightTicketRequirements,
  participantFullName,
  type FlightTicketStatus,
} from "@/admin/lib/flight-tickets";
import { tripWorkspacePath } from "@/admin/lib/trip-workspace";

type TripGroup = {
  trip: any;
  bookings: any[];
  participants: any[];
  reserved: number;
  incomplete: number;
  pending: number;
  total: number;
};

const activeBookingStatuses = new Set(["lead", "confirmed", "paid", "completed"]);

const isMissingSchema = (error: any) =>
  /schema cache|Could not find the table|relation .* does not exist/i.test(error?.message ?? "");

export default function FlightTickets({ initialTripId, embedded = false }: { initialTripId?: string; embedded?: boolean } = {}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bookings, setBookings] = useState<any[]>([]);
  const [participants, setParticipants] = useState<any[]>([]);
  const [flights, setFlights] = useState<any[]>([]);
  const [travelers, setTravelers] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | FlightTicketStatus>("all");
  const [selectedTripId, setSelectedTripId] = useState<string | null>(initialTripId ?? null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      let bookingQuery = (supabase as any)
        .from("bookings")
        .select("id,reference,status,contact_name,trip_id,created_at,trips(id,title,start_date,end_date)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (initialTripId) bookingQuery = bookingQuery.eq("trip_id", initialTripId);
      const { data: bookingRows, error: bookingError } = await bookingQuery;
      if (bookingError) throw bookingError;

      const activeBookings = (bookingRows ?? []).filter((booking: any) =>
        booking.trip_id && activeBookingStatuses.has(String(booking.status ?? ""))
      );
      const bookingIds = activeBookings.map((booking: any) => booking.id).filter(Boolean);
      setBookings(activeBookings);

      if (bookingIds.length === 0) {
        setParticipants([]);
        setFlights([]);
        setTravelers([]);
        return;
      }

      const [participantResult, flightResult] = await Promise.all([
        (supabase as any)
          .from("booking_participants")
          .select("id,booking_id,trip_id,client_id,first_name,last_name,email,passport_no,is_lead,created_at")
          .in("booking_id", bookingIds)
          .order("created_at", { ascending: true }),
        (supabase as any)
          .from("booking_flight_reservations")
          .select("*")
          .in("booking_id", bookingIds)
          .neq("status", "cancelled")
          .order("updated_at", { ascending: false }),
      ]);
      if (participantResult.error) throw participantResult.error;
      if (flightResult.error) throw flightResult.error;

      const flightRows = flightResult.data ?? [];
      const flightIds = flightRows.map((flight: any) => flight.id).filter(Boolean);
      let travelerRows: any[] = [];
      if (flightIds.length > 0) {
        const { data, error } = await (supabase as any)
          .from("booking_flight_travelers")
          .select("*")
          .in("flight_reservation_id", flightIds)
          .neq("traveler_status", "cancelled")
          .order("created_at", { ascending: true });
        if (error) throw error;
        travelerRows = data ?? [];
      }

      setParticipants(participantResult.data ?? []);
      setFlights(flightRows);
      setTravelers(travelerRows);
    } catch (loadError: any) {
      setError(isMissingSchema(loadError)
        ? "Migration Flight Reservation Workflow requise pour afficher les billets d’avion."
        : loadError?.message ?? "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [initialTripId]);

  useEffect(() => { if (initialTripId) setSelectedTripId(initialTripId); }, [initialTripId]);

  const bookingById = useMemo(() => new Map(bookings.map((booking) => [booking.id, booking])), [bookings]);
  const flightById = useMemo(() => new Map(flights.map((flight) => [flight.id, flight])), [flights]);
  const travelerByParticipant = useMemo(() => {
    const map = new Map<string, any>();
    travelers.forEach((traveler) => {
      if (!map.has(traveler.participant_id)) map.set(traveler.participant_id, traveler);
    });
    return map;
  }, [travelers]);
  const latestFlightByBooking = useMemo(() => {
    const map = new Map<string, any>();
    flights.forEach((flight) => {
      if (!map.has(flight.booking_id)) map.set(flight.booking_id, flight);
    });
    return map;
  }, [flights]);

  const rowForParticipant = useCallback((participant: any) => {
    const traveler = travelerByParticipant.get(participant.id) ?? null;
    const flight = traveler ? flightById.get(traveler.flight_reservation_id) : latestFlightByBooking.get(participant.booking_id);
    const status: FlightTicketStatus = traveler ? getFlightTicketStatus(flight, traveler) : flight ? "incomplete" : "pending_booking";
    return { participant, booking: bookingById.get(participant.booking_id), traveler, flight, status };
  }, [bookingById, flightById, latestFlightByBooking, travelerByParticipant]);

  const groups = useMemo(() => {
    const byTrip = new Map<string, TripGroup>();
    bookings.forEach((booking) => {
      const trip = booking.trips ?? { id: booking.trip_id, title: "Voyage sans titre" };
      if (!byTrip.has(booking.trip_id)) {
        byTrip.set(booking.trip_id, { trip, bookings: [], participants: [], reserved: 0, incomplete: 0, pending: 0, total: 0 });
      }
      byTrip.get(booking.trip_id)!.bookings.push(booking);
    });
    participants.forEach((participant) => {
      const booking = bookingById.get(participant.booking_id);
      if (!booking?.trip_id || !byTrip.has(booking.trip_id)) return;
      const group = byTrip.get(booking.trip_id)!;
      const status = rowForParticipant(participant).status;
      group.participants.push(participant);
      group.total += 1;
      if (["reserved", "partially_ticketed", "ticketed", "delivered"].includes(status)) group.reserved += 1;
      if (["incomplete", "partially_ticketed"].includes(status)) group.incomplete += 1;
      if (status === "pending_booking") group.pending += 1;
    });
    return Array.from(byTrip.values()).sort((a, b) =>
      String(a.trip?.start_date ?? "9999").localeCompare(String(b.trip?.start_date ?? "9999"))
    );
  }, [bookings, participants, bookingById, rowForParticipant]);

  const visibleGroups = groups.filter((group) => {
    const text = `${group.trip?.title ?? ""} ${group.trip?.start_date ?? ""}`.toLowerCase();
    return !query.trim() || text.includes(query.trim().toLowerCase());
  });

  const selectedGroup = selectedTripId
    ? groups.find((group) => group.trip?.id === selectedTripId || group.bookings.some((booking) => booking.trip_id === selectedTripId)) ?? null
    : visibleGroups[0] ?? null;

  const participantRows = (selectedGroup?.participants ?? [])
    .map(rowForParticipant)
    .filter((row) => statusFilter === "all" || row.status === statusFilter)
    .sort((a, b) => participantFullName(a.participant).localeCompare(participantFullName(b.participant)));

  const openOriginalTicket = async (flight: any) => {
    if (!flight?.ticket_storage_path) return toast.error("Aucun billet PDF lié.");
    const { data, error } = await supabase.storage.from("booking-docs").createSignedUrl(flight.ticket_storage_path, 60);
    if (error || !data) return toast.error("Lien billet indisponible.");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const downloadStampedTicket = async (row: ReturnType<typeof rowForParticipant>) => {
    if (!row.traveler) return toast.error("Ce participant n’est pas assigné à ce billet.");
    if (!row.flight?.ticket_storage_path) return toast.error("Aucun billet PDF lié.");
    try {
      const { data, error } = await supabase.storage.from("booking-docs").download(row.flight.ticket_storage_path);
      if (error || !data) throw error ?? new Error("Billet PDF introuvable.");
      const name = participantFullName(row.participant);
      const bytes = await createStampedFlightTicketPdf(await data.arrayBuffer(), {
        participantName: name,
        bookingReference: row.booking?.reference,
      });
      downloadBytes(bytes, flightTicketVisaFilename(name));
    } catch (downloadError: any) {
      toast.error(downloadError?.message ?? "Copie cachetée impossible.");
    }
  };

  const totalParticipants = groups.reduce((sum, group) => sum + group.total, 0);
  const totalReserved = groups.reduce((sum, group) => sum + group.reserved, 0);
  const totalIncomplete = groups.reduce((sum, group) => sum + group.incomplete, 0);

  return (
    <div className="space-y-6">
      {!embedded && <PageHeader
        title="Billets d’avion"
        description="Suivi opérationnel des billets par voyage, réservation et participant."
        action={
          <Button type="button" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className="h-4 w-4" /> Actualiser
          </Button>
        }
      />}

      {!embedded && <div className="grid gap-3 md:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Participants actifs</p><p className="text-2xl font-semibold">{totalParticipants}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Billets réservés</p><p className="text-2xl font-semibold text-emerald-700">{totalReserved}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Billets incomplets</p><p className="text-2xl font-semibold text-orange-700">{totalIncomplete}</p></CardContent></Card>
      </div>}

      {!embedded && <Card>
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Rechercher un voyage ou une date..." value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as any)}>
            <SelectTrigger className="lg:w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              <SelectItem value="reserved">Vol réservé</SelectItem>
              <SelectItem value="partially_ticketed">Billets partiellement émis</SelectItem>
              <SelectItem value="ticketed">Billets émis</SelectItem>
              <SelectItem value="delivered">Billets envoyés</SelectItem>
              <SelectItem value="incomplete">Informations incomplètes</SelectItem>
              <SelectItem value="pending_booking">En attente</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>}

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</div>}
      {loading ? <div className="rounded-lg border p-6 text-sm text-muted-foreground">Chargement des billets...</div> : null}

      <div className={embedded ? "grid gap-4" : "grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]"}>
        {!embedded && <div className="space-y-3">
          {visibleGroups.length === 0 && !loading ? (
            <Card><CardContent className="p-5 text-sm text-muted-foreground">Aucun voyage avec participants actifs.</CardContent></Card>
          ) : null}
          {visibleGroups.map((group) => {
            const progress = group.total > 0 ? Math.round((group.reserved / group.total) * 100) : 0;
            const active = selectedGroup?.trip?.id === group.trip?.id;
            return (
              <button
                key={group.trip?.id ?? group.bookings[0]?.trip_id}
                type="button"
                onClick={() => setSelectedTripId(group.trip?.id ?? group.bookings[0]?.trip_id)}
                className={`w-full rounded-lg border p-4 text-left transition hover:bg-slate-50 ${active ? "border-orange-300 bg-orange-50/40" : "bg-card"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{group.trip?.title ?? "Voyage sans titre"}</p>
                    <p className="text-xs text-muted-foreground">
                      {fmtDate(group.trip?.start_date)} → {fmtDate(group.trip?.end_date)}
                    </p>
                  </div>
                  <span className="text-sm font-semibold">{progress}%</span>
                </div>
                <Progress value={progress} className="mt-3 h-2" />
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">{group.reserved} réservés</span>
                  <span className="rounded bg-orange-50 px-2 py-1 text-orange-700">{group.incomplete} incomplets</span>
                  <span className="rounded bg-red-50 px-2 py-1 text-red-700">{group.pending} attente</span>
                </div>
              </button>
            );
          })}
        </div>}

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Plane className="h-5 w-5 text-orange-600" />
              {selectedGroup?.trip?.title ?? "Participants"}
            </CardTitle>
            {!embedded && selectedGroup?.trip?.id && <Button asChild variant="outline" size="sm"><Link to={tripWorkspacePath(selectedGroup.trip.id, "flights")}>Dossier voyage</Link></Button>}
          </CardHeader>
          <CardContent>
            {participantRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun participant ne correspond au filtre.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[920px] w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-3">Participant</th>
                      <th className="px-3 py-3">Réservation</th>
                      <th className="px-3 py-3">PNR / Compagnie</th>
                      <th className="px-3 py-3">Vols</th>
                      <th className="px-3 py-3">Billet</th>
                      <th className="px-3 py-3">Statut</th>
                      <th className="px-3 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {participantRows.map((row) => {
                      const missing = missingFlightTicketRequirements(row.flight, row.traveler);
                      return (
                        <tr key={row.participant.id} className="border-b align-top hover:bg-slate-50">
                          <td className="px-3 py-3 font-medium">{participantFullName(row.participant)}</td>
                          <td className="px-3 py-3">
                            <Link to={`/admin/bookings/${row.booking?.id}`} className="font-medium text-orange-700 hover:underline">
                              {row.booking?.reference ?? "Réservation"}
                            </Link>
                          </td>
                          <td className="px-3 py-3">
                            <p>{row.flight?.pnr || "—"}</p>
                            <p className="text-xs text-muted-foreground">{row.flight?.airline || "Compagnie à renseigner"}</p>
                          </td>
                          <td className="px-3 py-3">
                            <p>{row.flight?.flight_number || "—"}</p>
                            <p className="text-xs text-muted-foreground">
                              {row.flight?.departure_at ? fmtDateTime(row.flight.departure_at) : "Départ manquant"}
                              {" / "}
                              {row.flight?.return_at ? fmtDateTime(row.flight.return_at) : "Retour manquant"}
                            </p>
                          </td>
                          <td className="px-3 py-3">
                            {row.flight?.ticket_storage_path ? (
                              <span className="text-emerald-700">PDF lié</span>
                            ) : (
                              <span className="text-red-700">PDF manquant</span>
                            )}
                            {missing.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{missing.join(", ")}</p>}
                          </td>
                          <td className="px-3 py-3">
                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${FLIGHT_TICKET_STATUS_CLASSES[row.status]}`}>
                              {FLIGHT_TICKET_STATUS_LABELS[row.status]}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex justify-end gap-2">
                              <Button type="button" variant="outline" size="sm" asChild>
                                <Link to={`/admin/bookings/${row.booking?.id}`}><Eye className="h-4 w-4" /> Ouvrir</Link>
                              </Button>
                              <Button type="button" variant="outline" size="sm" onClick={() => openOriginalTicket(row.flight)} disabled={!row.flight?.ticket_storage_path}>
                                <Download className="h-4 w-4" /> Original
                              </Button>
                              <Button type="button" variant="outline" size="sm" onClick={() => downloadStampedTicket(row)} disabled={!row.traveler || !row.flight?.ticket_storage_path}>
                                <Upload className="h-4 w-4" /> Cachetée
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
