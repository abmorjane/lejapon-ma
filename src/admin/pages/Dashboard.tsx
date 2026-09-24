/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, CalendarClock, CalendarDays, CheckCircle2,
  CircleDollarSign, Clock3, FileCheck2, ListChecks, Plane, ReceiptText,
  UserRoundSearch, Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BookingQuickViewSheet } from "@/admin/components/BookingQuickViewSheet";
import { bookingStatusLabel } from "@/admin/lib/booking-status";
import {
  actionableDashboardTasks, activeBookingRemaining, daysUntilDeparture,
  formatDepartureCountdown, isDashboardTaskDueToday, isDashboardTaskOverdue,
  type DashboardTask,
} from "@/admin/lib/dashboard-operations";
import { getFlightTicketStatus, missingFlightReservationRequirements } from "@/admin/lib/flight-tickets";
import { tripWorkspacePath } from "@/admin/lib/trip-workspace";
import { useAuth } from "@/hooks/useAuth";
import { SUPPLIER_PORTAL_PATH } from "@/admin/lib/portal-access";
import { fmtDate, fmtMAD } from "@/lib/format";
import { quoteAdjustmentsFromBooking, quoteTotalWithAdjustments } from "@/lib/quote-adjustments";

type ModuleResult<T> = { rows: T[]; error: string | null };
type DashboardState = {
  trips: ModuleResult<any>; bookings: ModuleResult<any>; payments: ModuleResult<any>;
  tasks: ModuleResult<any>; checklistItems: ModuleResult<any>; flights: ModuleResult<any>;
  visas: ModuleResult<any>; clients: { count: number | null; error: string | null };
};

const moduleState = (): ModuleResult<any> => ({ rows: [], error: null });
const emptyState: DashboardState = {
  trips: moduleState(), bookings: moduleState(), payments: moduleState(), tasks: moduleState(),
  checklistItems: moduleState(), flights: moduleState(), visas: moduleState(),
  clients: { count: null, error: null },
};
const closedVisaStatuses = new Set(["approved", "accepted", "completed", "rejected", "cancelled", "archived"]);
const activeFinancialBookingStatuses = new Set(["lead", "confirmed", "paid"]);
const activeBookingStatuses = new Set(["lead", "confirmed", "paid", "completed"]);
const visaStatusLabel: Record<string, string> = {
  draft: "Brouillon", submitted: "Soumise", awaiting_documents: "Documents attendus",
  documents_received: "Documents reçus", in_review: "En traitement",
  submitted_to_embassy: "Transmise à l’ambassade", approved: "Approuvée",
  rejected: "Rejetée", completed: "Terminée",
};
const tripStatusLabel: Record<string, string> = {
  draft: "Brouillon", open: "Ouvert", sold_out: "Complet", closed: "Fermé",
  completed: "Terminé", archived: "Archivé",
};

async function runModule<T>(promise: PromiseLike<{ data: T[] | null; error: any }>): Promise<ModuleResult<T>> {
  try {
    const { data, error } = await promise;
    return error ? { rows: [], error: error.message ?? "Chargement impossible" } : { rows: data ?? [], error: null };
  } catch (error: any) {
    return { rows: [], error: error?.message ?? "Chargement impossible" };
  }
}

const bookingTotal = (booking: any) =>
  quoteTotalWithAdjustments(Number(booking?.total_amount_mad || 0), quoteAdjustmentsFromBooking(booking));
const bookingTrip = (booking: any) => Array.isArray(booking?.trips) ? booking.trips[0] : booking?.trips;
const displayPersonName = (row: any) =>
  [row?.given_names, row?.surname].filter(Boolean).join(" ").trim() || row?.residential_email || "Demande visa";

const compactDateRange = (start?: string | null, end?: string | null) => {
  if (!start) return "Dates à confirmer";
  const startDate = new Date(`${start.slice(0, 10)}T00:00:00`);
  const endDate = end ? new Date(`${end.slice(0, 10)}T00:00:00`) : null;
  const startText = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(startDate);
  if (!endDate) return startText;
  const endText = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" }).format(endDate);
  return `${startText} → ${endText}`;
};

export default function Dashboard() {
  const { isSupplierOnly } = useAuth();
  const [state, setState] = useState<DashboardState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [selectedBooking, setSelectedBooking] = useState<any | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (isSupplierOnly) return;
    let active = true;
    void (async () => {
      setLoading(true);
      const [trips, bookings, payments, tasks, checklistItems, flights, visas, clientsResult] = await Promise.all([
        runModule<any>((supabase as any).from("trips")
          .select("id,title,label,season,start_date,end_date,status,total_slots,slots_left,archived_at")
          .is("archived_at", null).order("start_date", { ascending: true }).limit(200)),
        runModule<any>((supabase as any).from("bookings")
          .select("id,reference,contact_name,contact_email,contact_phone,status,total_amount_mad,paid_amount_mad,quote_adjustments,metadata,num_adults,num_children,formula,room_type,created_at,updated_at,trip_id,trips!inner(id,title,season,start_date,end_date,archived_at)")
          .is("trips.archived_at", null).order("created_at", { ascending: false }).limit(500)),
        runModule<any>((supabase as any).from("payments")
          .select("id,booking_id,amount_mad,status,paid_at,created_at").eq("status", "received")
          .order("paid_at", { ascending: false, nullsFirst: false }).limit(1000)),
        runModule<any>((supabase as any).from("operation_tasks")
          .select("id,title,priority,status,booking_id,reservation_id,trip_id,visa_application_id,deadline,created_at,trips:trip_id(id,title,archived_at)")
          .not("status", "in", "(completed,cancelled)").order("deadline", { ascending: true, nullsFirst: false }).limit(180)),
        runModule<any>((supabase as any).from("operation_checklist_items")
          .select("id,title,priority,status,deadline,created_at,operation_checklists(id,title,booking_id,reservation_id,trip_id,visa_application_id,trips:trip_id(id,title,archived_at))")
          .not("status", "in", "(completed,cancelled)").order("deadline", { ascending: true, nullsFirst: false }).limit(180)),
        runModule<any>((supabase as any).from("booking_flight_reservations")
          .select("id,booking_id,status,pnr,pnr_normalized,booking_platform,fare_amount,fare_mad,fare_currency,linked_traveler_count,airline,flight_number,departure_at,return_at,segments,ticket_document_id,ticket_storage_path,ticket_sent_to_customer,updated_at")
          .neq("status", "cancelled").order("updated_at", { ascending: true }).limit(200)),
        runModule<any>((supabase as any).from("visa_applications")
          .select("id,reference,status,surname,given_names,passport_no,residential_email,booking_id,submitted_at,created_at")
          .order("created_at", { ascending: false }).limit(200)),
        (async () => {
          try {
            const { count, error } = await (supabase as any).from("clients").select("id", { count: "exact", head: true });
            return { count: error ? null : count ?? 0, error: error?.message ?? null };
          } catch (error: any) {
            return { count: null, error: error?.message ?? "Chargement impossible" };
          }
        })(),
      ]);
      if (!active) return;
      setState({ trips, bookings, payments, tasks, checklistItems, flights, visas, clients: clientsResult });
      setLoading(false);
    })();
    return () => { active = false; };
  }, [isSupplierOnly, reloadKey]);

  const dashboard = useMemo(() => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const bookingMap = new Map(state.bookings.rows.map((booking) => [booking.id, booking]));
    const futureTrips = state.trips.rows.filter((trip) => !trip.archived_at && trip.start_date && trip.start_date >= today)
      .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date))).slice(0, 5);
    const resolveBookingId = (row: any) => row.booking_id || row.reservation_id || null;
    const isActiveContext = (bookingId?: string | null, trip?: any) => !trip?.archived_at && (!bookingId || bookingMap.has(bookingId));
    const taskRows: DashboardTask[] = state.tasks.rows
      .filter((row) => isActiveContext(resolveBookingId(row), row.trips))
      .map((row) => {
        const bookingId = resolveBookingId(row);
        const booking = bookingId ? bookingMap.get(bookingId) : null;
        return {
          id: row.id, source: "task" as const, title: row.title, priority: row.priority, deadline: row.deadline,
          bookingId, tripId: row.trip_id, visaApplicationId: row.visa_application_id,
          context: booking ? `${booking.reference} · ${booking.contact_name}` : row.trips?.title,
          href: bookingId ? `/admin/bookings/${bookingId}` : row.visa_application_id ? `/admin/visa/${row.visa_application_id}` : row.trip_id ? tripWorkspacePath(row.trip_id, "operations") : "/admin/operations-center",
        };
      });
    const checklistRows: DashboardTask[] = state.checklistItems.rows
      .filter((row) => isActiveContext(resolveBookingId(row.operation_checklists ?? {}), row.operation_checklists?.trips))
      .map((row) => {
        const checklist = row.operation_checklists ?? {};
        const bookingId = resolveBookingId(checklist);
        const booking = bookingId ? bookingMap.get(bookingId) : null;
        return {
          id: row.id, source: "checklist" as const, title: row.title, priority: row.priority, deadline: row.deadline,
          bookingId, tripId: checklist.trip_id, visaApplicationId: checklist.visa_application_id,
          context: booking ? `${booking.reference} · ${booking.contact_name}` : checklist.trips?.title || checklist.title,
          href: bookingId ? `/admin/bookings/${bookingId}` : checklist.visa_application_id ? `/admin/visa/${checklist.visa_application_id}` : checklist.trip_id ? tripWorkspacePath(checklist.trip_id, "operations") : "/admin/operations-center",
        };
      });
    const allTasks = [...taskRows, ...checklistRows];
    const actionableTasks = actionableDashboardTasks(allTasks, now);
    const openVisas = state.visas.rows.filter((visa) =>
      !closedVisaStatuses.has(String(visa.status || "").toLowerCase()) && (!visa.booking_id || bookingMap.has(visa.booking_id)));
    const actionableVisas = openVisas.filter((visa) =>
      !String(visa.passport_no || "").trim()
      || ["draft", "submitted", "awaiting_documents", "documents_received"].includes(String(visa.status || "").toLowerCase()));
    const relevantFlights = state.flights.rows.filter((flight) => bookingMap.has(flight.booking_id)).map((flight) => {
      const status = getFlightTicketStatus(flight);
      const missing = missingFlightReservationRequirements(flight);
      return { ...flight, dashboardStatus: status === "pending_booking" ? "pending" : missing.length > 0 ? "incomplete" : "ready", missing };
    });
    const pendingFlights = relevantFlights.filter((flight) => flight.dashboardStatus === "pending");
    const incompleteFlights = relevantFlights.filter((flight) => flight.dashboardStatus === "incomplete");
    const reservationsToHandle = state.bookings.rows.filter((booking) =>
      booking.status === "lead" || (booking.status === "confirmed" && activeBookingRemaining(bookingTotal(booking), Number(booking.paid_amount_mad || 0)) > 0))
      .sort((a, b) => Number(b.status === "lead") - Number(a.status === "lead") || String(b.created_at).localeCompare(String(a.created_at))).slice(0, 5);
    const tripBookingSummary = new Map<string, { bookings: number; travelers: number }>();
    state.bookings.rows.filter((booking) => activeBookingStatuses.has(String(booking.status))).forEach((booking) => {
      const current = tripBookingSummary.get(booking.trip_id) ?? { bookings: 0, travelers: 0 };
      current.bookings += 1;
      current.travelers += Number(booking.num_adults || 0) + Number(booking.num_children || 0);
      tripBookingSummary.set(booking.trip_id, current);
    });
    const received = state.payments.rows.reduce((sum, payment) => sum + Number(payment.amount_mad || 0), 0);
    const remaining = state.bookings.rows.filter((booking) => activeFinancialBookingStatuses.has(String(booking.status)))
      .reduce((sum, booking) => sum + activeBookingRemaining(bookingTotal(booking), Number(booking.paid_amount_mad || 0)), 0);
    const priorityActions = [
      ...actionableTasks.slice(0, 3).map((task) => ({
        key: `${task.source}-${task.id}`, type: "task" as const,
        priority: task.priority === "critical" ? 0 : isDashboardTaskOverdue(task, now) ? 1 : 4,
        title: task.title, subtitle: task.context || (task.deadline ? fmtDate(task.deadline) : "Action opérationnelle"), href: task.href,
      })),
      ...actionableVisas.slice(0, 2).map((visa) => ({
        key: `visa-${visa.id}`, type: "visa" as const, priority: 3,
        title: visaActionLabel(visa),
        subtitle: visa.reference || visaStatusLabel[visa.status] || "Dossier visa", href: `/admin/visa/${visa.id}`,
      })),
      ...[...pendingFlights, ...incompleteFlights].slice(0, 2).map((flight) => {
        const booking = bookingMap.get(flight.booking_id);
        return {
          key: `flight-${flight.id}`, type: "flight" as const, priority: 2,
          title: flight.dashboardStatus === "pending" ? "Vol à réserver" : "Vol à compléter",
          subtitle: booking ? `${booking.reference} · ${booking.contact_name}` : "Réservation", href: `/admin/bookings/${flight.booking_id}`,
        };
      }),
      ...state.bookings.rows.filter((booking) => booking.status === "lead").slice(0, 2).map((booking) => ({
        key: `booking-${booking.id}`, type: "booking" as const, priority: 5,
        title: `Prospect à suivre — ${booking.contact_name || booking.reference}`,
        subtitle: bookingTrip(booking)?.title || booking.reference, href: `/admin/bookings/${booking.id}`, booking,
      })),
    ].sort((a, b) => a.priority - b.priority).slice(0, 6);
    return {
      allTasks, actionableTasks, openVisas, actionableVisas, pendingFlights, incompleteFlights, reservationsToHandle,
      futureTrips, tripBookingSummary, received, remaining, priorityActions,
      criticalCount: allTasks.filter((task) => task.priority === "critical").length,
      overdueCount: allTasks.filter((task) => isDashboardTaskOverdue(task, now)).length,
      todayCount: allTasks.filter((task) => isDashboardTaskDueToday(task, now)).length,
    };
  }, [state]);

  if (isSupplierOnly) return <Navigate to={SUPPLIER_PORTAL_PATH} replace />;

  const errors = [state.trips.error, state.bookings.error, state.payments.error, state.tasks.error,
    state.checklistItems.error, state.flights.error, state.visas.error, state.clients.error].filter(Boolean);
  const counters = [
    { label: "critiques", value: dashboard.criticalCount, tone: "border-red-200 bg-red-50 text-red-900" },
    { label: "en retard", value: dashboard.overdueCount, tone: "border-orange-200 bg-orange-50 text-orange-900" },
    { label: "aujourd’hui", value: dashboard.todayCount, tone: "border-amber-200 bg-amber-50 text-amber-900" },
    { label: "visas à traiter", value: dashboard.actionableVisas.length, tone: "border-violet-200 bg-violet-50 text-violet-900" },
    { label: "prospects", value: state.bookings.rows.filter((booking) => booking.status === "lead").length, tone: "border-blue-200 bg-blue-50 text-blue-900" },
    { label: "vols à traiter", value: dashboard.pendingFlights.length + dashboard.incompleteFlights.length, tone: "border-sky-200 bg-sky-50 text-sky-900" },
  ].filter((counter) => counter.value > 0);

  return (
    <div className="space-y-4 pb-4 sm:space-y-5">
      <header className="pb-1">
        <h1 className="font-display text-2xl leading-tight sm:text-3xl">Tableau de bord</h1>
        <p className="mt-1 text-sm text-muted-foreground">Voici ce qui demande votre attention aujourd’hui.</p>
      </header>

      {errors.length > 0 && !loading && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Certaines données sont momentanément indisponibles. Les autres blocs restent utilisables.</p>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm" aria-labelledby="attention-title">
        <div className="border-b border-border p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Aujourd’hui</p><h2 id="attention-title" className="font-display text-xl">À traiter</h2></div>
            <Link to="/admin/operations-center" className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-accent hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Toutes les actions <ArrowRight className="h-4 w-4" /></Link>
          </div>
          {loading ? (
            <div className="mt-3 flex gap-2 overflow-hidden"><Skeleton className="h-9 w-28" /><Skeleton className="h-9 w-28" /><Skeleton className="h-9 w-28" /></div>
          ) : counters.length > 0 ? (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {counters.map((counter) => <span key={counter.label} className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold ${counter.tone}`}>{counter.value} {counter.label}</span>)}
            </div>
          ) : <div className="mt-3 flex items-center gap-2 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4" /> Aucune action prioritaire détectée.</div>}
        </div>
        <div className="divide-y divide-border">
          {loading && [0, 1, 2].map((item) => <div key={item} className="space-y-2 p-4"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /></div>)}
          {!loading && dashboard.priorityActions.length === 0 && <p className="p-5 text-sm text-muted-foreground">Rien ne demande une intervention immédiate.</p>}
          {!loading && dashboard.priorityActions.map((action) => {
            const Icon = action.type === "task" ? ListChecks : action.type === "visa" ? FileCheck2 : action.type === "flight" ? Plane : UserRoundSearch;
            const content = <><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted"><Icon className="h-5 w-5 text-foreground/75" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-foreground">{action.title}</span><span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{action.subtitle}</span></span><ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" /></>;
            const className = "flex min-h-[68px] w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent";
            return action.type === "booking" && "booking" in action
              ? <button key={action.key} type="button" data-testid="priority-action" data-action-type={action.type} className={className} onClick={() => setSelectedBooking(action.booking)}>{content}</button>
              : <Link key={action.key} to={action.href} data-testid="priority-action" data-action-type={action.type} className={className}>{content}</Link>;
          })}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)] xl:items-start">
        <DashboardSection className="xl:col-start-1 xl:row-start-1" title="Tâches opérationnelles" icon={ListChecks} link="/admin/operations-center" linkLabel="Voir toutes les tâches">
          <div className="flex gap-2 border-b border-border px-4 pb-3 sm:px-5">
            {dashboard.criticalCount > 0 && <SmallCount value={dashboard.criticalCount} label="critiques" tone="text-red-700" />}
            {dashboard.overdueCount > 0 && <SmallCount value={dashboard.overdueCount} label="en retard" tone="text-orange-700" />}
            {dashboard.todayCount > 0 && <SmallCount value={dashboard.todayCount} label="aujourd’hui" tone="text-amber-700" />}
          </div>
          <div className="divide-y divide-border">
            {loading ? <SectionSkeleton /> : state.tasks.error && state.checklistItems.error ? <ModuleUnavailable text="Les tâches ne peuvent pas être chargées." /> : dashboard.actionableTasks.length === 0 ? <EmptyState text="Aucune tâche critique, en retard ou prévue aujourd’hui." /> : dashboard.actionableTasks.slice(0, 5).map((task) => (
              <Link key={`${task.source}-${task.id}`} to={task.href} className="flex min-h-[72px] items-center gap-3 p-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:px-5">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${task.priority === "critical" ? "bg-red-500" : isDashboardTaskOverdue(task) ? "bg-orange-500" : "bg-amber-400"}`} />
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{task.title}</span><span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{task.context || "Action opérationnelle"}</span></span>
                <span className={`shrink-0 text-right text-[13px] font-medium ${isDashboardTaskOverdue(task) ? "text-red-700" : "text-muted-foreground"}`}>{isDashboardTaskOverdue(task) ? "En retard" : isDashboardTaskDueToday(task) ? "Aujourd’hui" : task.priority === "critical" ? "Critique" : fmtDate(task.deadline)}</span>
              </Link>
            ))}
          </div>
        </DashboardSection>

        <DashboardSection className="xl:col-start-2 xl:row-start-1" title="Prochains départs" icon={CalendarDays} link="/admin/trips" linkLabel="Tous les voyages">
          <div className="divide-y divide-border">
            {loading ? <SectionSkeleton /> : state.trips.error ? <ModuleUnavailable text="Les prochains départs ne peuvent pas être chargés." /> : dashboard.futureTrips.length === 0 ? <EmptyState text="Aucun départ à venir." /> : dashboard.futureTrips.map((trip) => {
              const summary = dashboard.tripBookingSummary.get(trip.id) ?? { bookings: 0, travelers: 0 };
              return <Link key={trip.id} to={tripWorkspacePath(trip.id)} className="flex min-h-[76px] items-center gap-3 p-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"><span className="flex h-11 min-w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 px-1 text-sm font-bold text-accent">{formatDepartureCountdown(daysUntilDeparture(trip.start_date))}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{trip.title}</span><span className="block text-[13px] text-muted-foreground">{compactDateRange(trip.start_date, trip.end_date)}</span><span className="mt-1 block text-[13px] text-muted-foreground">{summary.travelers} voyageur{summary.travelers > 1 ? "s" : ""} · {summary.bookings} réservation{summary.bookings > 1 ? "s" : ""}</span></span><Badge variant="outline" className="shrink-0">{tripStatusLabel[trip.status] || trip.status}</Badge></Link>;
            })}
          </div>
        </DashboardSection>

        <DashboardSection className="xl:col-start-1 xl:row-start-2 xl:row-span-2" title="Réservations à traiter" icon={ReceiptText} link="/admin/bookings" linkLabel="Toutes les réservations">
          <div className="divide-y divide-border">
            {loading ? <SectionSkeleton /> : state.bookings.error ? <ModuleUnavailable text="Les réservations ne peuvent pas être chargées." /> : dashboard.reservationsToHandle.length === 0 ? <EmptyState text="Aucune réservation récente ne demande de suivi." /> : dashboard.reservationsToHandle.map((booking) => {
              const total = bookingTotal(booking); const remaining = activeBookingRemaining(total, Number(booking.paid_amount_mad || 0));
              return <button key={booking.id} type="button" onClick={() => setSelectedBooking(booking)} className="flex min-h-[82px] w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:px-5"><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-sm font-semibold">{booking.contact_name || "Client à renseigner"}</span><Badge variant="outline" className="shrink-0 text-xs">{bookingStatusLabel(booking.status)}</Badge></span><span className="mt-1 block truncate text-[13px] text-muted-foreground">{booking.reference} · {bookingTrip(booking)?.title || "Voyage à renseigner"}</span><span className="mt-1 block text-[13px] text-muted-foreground">Créée le {fmtDate(booking.created_at)}</span></span><span className="shrink-0 text-right"><span className="block text-sm font-semibold">{fmtMAD(total)}</span><span className={remaining > 0 ? "text-[13px] font-medium text-orange-700" : "text-[13px] text-emerald-700"}>{remaining > 0 ? `${fmtMAD(remaining)} restant` : "Soldée"}</span></span></button>;
            })}
          </div>
        </DashboardSection>

        <DashboardSection className="xl:col-start-2 xl:row-start-2" title="Visa à traiter" icon={FileCheck2} link="/admin/visa" linkLabel="Ouvrir Visa">
          <div className="divide-y divide-border">
            {loading ? <SectionSkeleton rows={2} /> : state.visas.error ? <ModuleUnavailable text="Les dossiers visa ne peuvent pas être chargés." /> : dashboard.actionableVisas.length === 0 ? <EmptyState text="Aucune action visa en attente." /> : dashboard.actionableVisas.slice(0, 3).map((visa) => <Link key={visa.id} to={`/admin/visa/${visa.id}`} className="flex min-h-[68px] items-center gap-3 p-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{displayPersonName(visa)}</span><span className="block truncate text-[13px] text-muted-foreground">{visa.reference || "Sans référence"} · {visaStatusLabel[visa.status] || visa.status}</span></span>{!visa.passport_no && <Badge className="shrink-0 border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-50">Passeport manquant</Badge>}<ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" /></Link>)}
          </div>
        </DashboardSection>

        <DashboardSection className="xl:col-start-2 xl:row-start-3" title="Vols" icon={Plane} link="/admin/flight-tickets" linkLabel="Billets d’avion">
          <div className="border-b border-border px-4 pb-3 text-sm text-muted-foreground">
            {state.flights.error ? "Données indisponibles" : <><span className="font-semibold text-foreground">{dashboard.pendingFlights.length}</span> à réserver · <span className="font-semibold text-foreground">{dashboard.incompleteFlights.length}</span> incomplet{dashboard.incompleteFlights.length > 1 ? "s" : ""}</>}
          </div>
          <div className="divide-y divide-border">
            {loading ? <SectionSkeleton rows={2} /> : state.flights.error ? <ModuleUnavailable text="Les données de vols ne peuvent pas être chargées." /> : dashboard.pendingFlights.length + dashboard.incompleteFlights.length === 0 ? <EmptyState text="Aucun vol à traiter." /> : [...dashboard.pendingFlights, ...dashboard.incompleteFlights].slice(0, 3).map((flight) => {
              const booking = state.bookings.rows.find((row) => row.id === flight.booking_id);
              return <Link key={flight.id} to={`/admin/bookings/${flight.booking_id}`} className="flex min-h-[68px] items-center gap-3 p-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{booking?.contact_name || booking?.reference || "Réservation"}</span><span className="block truncate text-[13px] text-muted-foreground">{flight.dashboardStatus === "pending" ? "Réservation du vol à effectuer" : `À compléter : ${flight.missing.join(", ")}`}</span></span><ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" /></Link>;
            })}
          </div>
        </DashboardSection>
      </div>

      <section className="rounded-2xl border border-border bg-background p-4 shadow-sm sm:p-5" aria-labelledby="finance-title">
        <div className="flex items-center gap-2"><Wallet className="h-5 w-5 text-accent" /><h2 id="finance-title" className="font-display text-lg">Finance</h2></div>
        <div className="mt-3 grid grid-cols-2 gap-3"><FinancialStat label="Encaissé" value={state.payments.error ? "Indisponible" : fmtMAD(dashboard.received)} icon={CircleDollarSign} /><FinancialStat label="Reste à encaisser" value={state.bookings.error ? "Indisponible" : fmtMAD(dashboard.remaining)} icon={Clock3} /></div>
        <p className="mt-3 text-[13px] text-muted-foreground">Le reste à encaisser porte sur les prospects et réservations actives, sans notion d’échéance de paiement.</p>
      </section>

      <section aria-labelledby="stats-title">
        <div className="mb-2 flex items-center gap-2"><CalendarClock className="h-4 w-4 text-muted-foreground" /><h2 id="stats-title" className="text-sm font-semibold">Activité générale</h2></div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <CompactStat label="Voyages ouverts" value={state.trips.error ? "—" : state.trips.rows.filter((trip) => trip.status === "open").length} />
          <CompactStat label="Clients" value={state.clients.count ?? "—"} />
          <CompactStat label="Confirmées" value={state.bookings.error ? "—" : state.bookings.rows.filter((booking) => booking.status === "confirmed").length} />
          <CompactStat label="Payées" value={state.bookings.error ? "—" : state.bookings.rows.filter((booking) => booking.status === "paid").length} />
          <CompactStat label="CA encaissé" value={state.payments.error ? "—" : fmtMAD(dashboard.received)} wide />
        </div>
      </section>

      <BookingQuickViewSheet
        booking={selectedBooking}
        open={Boolean(selectedBooking)}
        onOpenChange={(open) => { if (!open) setSelectedBooking(null); }}
        onChanged={() => setReloadKey((value) => value + 1)}
      />
    </div>
  );
}

function DashboardSection({ title, icon: Icon, link, linkLabel, className = "", children }: { title: string; icon: any; link: string; linkLabel: string; className?: string; children: React.ReactNode }) {
  return <section className={`overflow-hidden rounded-2xl border border-border bg-background shadow-sm ${className}`}><div className="flex min-h-[60px] items-center justify-between gap-2 p-4 pb-3 sm:gap-3 sm:px-5"><div className="flex min-w-0 items-center gap-2"><Icon className="h-5 w-5 shrink-0 text-accent" /><h2 className="font-display text-lg leading-tight">{title}</h2></div><Link to={link} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-1.5 text-sm font-semibold text-accent hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:px-2"><span className="sm:hidden">Voir tout</span><span className="hidden sm:inline">{linkLabel}</span> <ArrowRight className="h-4 w-4" /></Link></div>{children}</section>;
}
function visaActionLabel(visa: any) {
  const name = displayPersonName(visa);
  if (!String(visa.passport_no || "").trim()) return `Passeport à renseigner — ${name}`;
  if (visa.status === "awaiting_documents") return `Documents visa à obtenir — ${name}`;
  if (visa.status === "documents_received") return `Documents visa à contrôler — ${name}`;
  if (visa.status === "draft") return `Dossier visa à compléter — ${name}`;
  return `Dossier visa à traiter — ${name}`;
}
function SmallCount({ value, label, tone }: { value: number; label: string; tone: string }) { return <span className={`text-[13px] font-semibold ${tone}`}>{value} {label}</span>; }
function EmptyState({ text }: { text: string }) { return <p className="p-5 text-sm text-muted-foreground">{text}</p>; }
function ModuleUnavailable({ text }: { text: string }) { return <div className="flex items-start gap-2 p-5 text-sm text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>{text}</p></div>; }
function SectionSkeleton({ rows = 3 }: { rows?: number }) { return <>{Array.from({ length: rows }).map((_, index) => <div key={index} className="space-y-2 p-4"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /></div>)}</>; }
function FinancialStat({ label, value, icon: Icon }: { label: string; value: string; icon: any }) { return <div className="rounded-xl bg-muted/40 p-3 sm:p-4"><Icon className="mb-2 h-4 w-4 text-muted-foreground" /><p className="text-[13px] text-muted-foreground">{label}</p><p className="mt-1 text-base font-semibold sm:text-lg">{value}</p></div>; }
function CompactStat({ label, value, wide = false }: { label: string; value: string | number; wide?: boolean }) { return <div className={`rounded-xl border border-border bg-background p-3 ${wide ? "col-span-2 sm:col-span-1" : ""}`}><p className="text-[13px] text-muted-foreground">{label}</p><p className="mt-1 text-base font-semibold">{value}</p></div>; }
