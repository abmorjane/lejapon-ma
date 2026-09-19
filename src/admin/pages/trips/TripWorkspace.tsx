/* eslint-disable @typescript-eslint/no-explicit-any */
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  AlertTriangle, Archive, BookOpenCheck, Building2,
  CircleDollarSign, ClipboardList, FileText, Hotel, Plane, RefreshCw, ShieldCheck,
  Users, WalletCards,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { fmtDate, fmtMAD } from "@/lib/format";
import { getBookingPricingBreakdown } from "@/lib/booking-pricing";
import { PageHeader } from "@/admin/components/PageHeader";
import { StatusBadge } from "@/admin/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  activeBookingStatuses, latestSupplierQuotes, normalizeTripWorkspaceTab,
  tripWorkspacePath, tripWorkspaceTabs, workspaceInternalCostMad,
  workspaceRevenue, workspaceSupplierCostJpy, type TripWorkspaceTab,
} from "@/admin/lib/trip-workspace";
import { adminSupplierQuotePath, groupSupplierQuoteVersions } from "@/admin/lib/supplier-admin-review";

const OpsParticipants = lazy(() => import("./ops/OpsParticipants"));
const OpsRooms = lazy(() => import("./ops/OpsRooms"));
const TripOperations = lazy(() => import("./TripOperations"));
const FlightTickets = lazy(() => import("../FlightTickets"));
const SupplierTripCosts = lazy(() => import("../supplier/SupplierTripCosts"));
const db = supabase as any;

type WorkspaceState = {
  trip: any | null;
  bookings: any[];
  bookingCount: number | null;
  participants: any[];
  visas: any[];
  flights: any[];
  quotes: any[] | null;
  suppliers: any[];
  documents: any[];
  tasks: any[];
  hotels: any[];
  rooms: any[];
  assignments: any[];
  errors: string[];
};

const emptyState: WorkspaceState = {
  trip: null, bookings: [], bookingCount: null, participants: [], visas: [], flights: [],
  quotes: [], suppliers: [], documents: [], tasks: [], hotels: [], rooms: [], assignments: [], errors: [],
};

const tabDefinitions: Array<{ key: TripWorkspaceTab; label: string; icon: typeof Users; module?: Parameters<ReturnType<typeof useAuth>["can"]>[0] }> = [
  { key: "overview", label: "Vue générale", icon: BookOpenCheck },
  { key: "reservations", label: "Réservations", icon: WalletCards, module: "bookings" },
  { key: "participants", label: "Participants", icon: Users, module: "bookings" },
  { key: "finance", label: "Finance", icon: CircleDollarSign, module: "accounting" },
  { key: "visa", label: "Visa", icon: ShieldCheck, module: "visa" },
  { key: "flights", label: "Vols", icon: Plane, module: "flight_tickets" },
  { key: "hotels", label: "Hôtels", icon: Hotel, module: "operations_center" },
  { key: "supplier", label: "Fournisseur", icon: Building2, module: "supplier_costs" },
  { key: "operations", label: "Opérations", icon: ClipboardList, module: "operations_center" },
  { key: "documents", label: "Documents", icon: FileText, module: "operations_center" },
];

const quoteLabels: Record<string, string> = {
  draft: "Brouillon", submitted: "Soumis", reviewed: "En revue",
  revision_requested: "Révision demandée", approved: "Approuvé",
  rejected: "Rejeté", archived: "Remplacé",
};
const tripStatusLabels: Record<string, string> = { draft: "Brouillon", open: "Ouvert", closed: "Fermé", completed: "Terminé" };

const diag = (source: string, error: any) => `${source} : ${[error?.code, error?.message, error?.details, error?.hint].filter(Boolean).join(" · ") || "chargement impossible"}`;
const fullName = (participant: any) => [participant.first_name, participant.last_name].filter(Boolean).join(" ") || "Participant";
const isIncompleteParticipant = (participant: any) => ["passport_no", "nationality", "date_of_birth", "sex", "passport_expiry"].some(field => !String(participant[field] ?? "").trim());
const isFlightComplete = (flight: any) => ["reserved", "ticketed", "delivered", "ticket_sent"].includes(String(flight.status ?? ""));

export default function TripWorkspace() {
  const { tripId = "", tab: rawTab } = useParams();
  const tab = normalizeTripWorkspaceTab(rawTab);
  const { can } = useAuth();
  const [state, setState] = useState<WorkspaceState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);

  const load = useCallback(async () => {
    if (!tripId) return;
    setLoading(true);
    const errors: string[] = [];
    const safe = async (source: string, query: PromiseLike<any>) => {
      const result = await query;
      if (result.error) errors.push(diag(source, result.error));
      return result;
    };
    try {
      const quoteQuery = can("supplier_costs")
        ? safe("Devis fournisseur", db.from("supplier_trip_quotes").select("id,trip_id,supplier_id,status,version_number,supplier_execution_status,supplier_total_jpy,final_total_mad,updated_at,created_at", { count: "exact" }).eq("trip_id", tripId).order("version_number", { ascending: false }))
        : Promise.resolve({ data: null, error: null, count: null });
      const [tripResult, bookingResult, participantResult, quoteResult, supplierResult, documentResult, taskResult, hotelResult] = await Promise.all([
        safe("Voyage", db.from("trips").select("id,title,label,season,start_date,end_date,status,total_slots,slots_left,archived_at,archive_reason").eq("id", tripId).maybeSingle()),
        safe("Réservations", db.from("bookings").select("*", { count: "exact" }).eq("trip_id", tripId).order("created_at", { ascending: false })),
        safe("Participants", db.from("booking_participants").select("id,booking_id,trip_id,first_name,last_name,email,passport_no,nationality,date_of_birth,sex,passport_expiry,is_lead").eq("trip_id", tripId)),
        quoteQuery,
        safe("Fournisseurs", db.from("trip_suppliers").select("supplier_id,status,suppliers(id,name)").eq("trip_id", tripId).neq("status", "cancelled")),
        safe("Documents", db.from("trip_documents").select("id,category,title,file_name,file_path,file_url,mime_type,size_bytes,version,uploaded_by_name,uploaded_by_role,uploaded_at,created_at").eq("trip_id", tripId).is("deleted_at", null).order("uploaded_at", { ascending: false })),
        safe("Tâches", db.from("operation_tasks").select("id,title,status,priority,deadline,booking_id,trip_id").eq("trip_id", tripId).not("status", "in", "(completed,cancelled)").order("deadline", { ascending: true, nullsFirst: false })),
        safe("Hôtels", db.from("trip_hotels").select("id,name,city,sort_order").eq("trip_id", tripId).order("sort_order")),
      ]);

      const bookings = bookingResult.data ?? [];
      const bookingIds = bookings.map((booking: any) => booking.id).filter(Boolean);
      const hotelIds = (hotelResult.data ?? []).map((hotel: any) => hotel.id).filter(Boolean);
      const [visaResult, flightResult, roomResult] = await Promise.all([
        bookingIds.length ? safe("Visa", db.from("visa_applications").select("id,reference,status,surname,given_names,passport_no,booking_id,booking_participant_id,submitted_at").in("booking_id", bookingIds)) : Promise.resolve({ data: [], error: null }),
        bookingIds.length ? safe("Vols", db.from("booking_flight_reservations").select("id,booking_id,status,pnr,airline,flight_number,departure_at,return_at,ticket_document_id,ticket_storage_path,ticket_sent_to_customer").in("booking_id", bookingIds).neq("status", "cancelled")) : Promise.resolve({ data: [], error: null }),
        hotelIds.length ? safe("Chambres", db.from("trip_rooms").select("id,trip_hotel_id,room_number,room_type,capacity").in("trip_hotel_id", hotelIds)) : Promise.resolve({ data: [], error: null }),
      ]);
      const roomIds = (roomResult.data ?? []).map((room: any) => room.id).filter(Boolean);
      const assignmentResult = roomIds.length
        ? await safe("Rooming", db.from("room_assignments").select("id,room_id,participant_id").in("room_id", roomIds))
        : { data: [], error: null };

      setState({
        trip: tripResult.data ?? null,
        bookings,
        bookingCount: bookingResult.error ? null : bookingResult.count,
        participants: participantResult.data ?? [], visas: visaResult.data ?? [], flights: flightResult.data ?? [],
        quotes: quoteResult.data, suppliers: supplierResult.data ?? [], documents: documentResult.data ?? [],
        tasks: taskResult.data ?? [], hotels: hotelResult.data ?? [], rooms: roomResult.data ?? [],
        assignments: assignmentResult.data ?? [], errors,
      });
    } catch (error) {
      setState(current => ({ ...current, errors: [diag("Dossier voyage", error)] }));
    } finally {
      setLoading(false);
    }
  }, [can, retry, tripId]);

  useEffect(() => { void load(); }, [load]);

  if (rawTab && !tripWorkspaceTabs.includes(rawTab as TripWorkspaceTab)) return <Navigate to={tripWorkspacePath(tripId)} replace />;
  if (loading && !state.trip) return <div role="status" className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Chargement du dossier voyage…</div>;
  if (!state.trip) return <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5"><p role="alert">Voyage introuvable ou inaccessible.</p><Button className="mt-3" variant="outline" onClick={() => setRetry(value => value + 1)}><RefreshCw className="h-4 w-4" /> Réessayer</Button></div>;

  const trip = state.trip;
  const archived = Boolean(trip.archived_at);
  const currentQuotes = latestSupplierQuotes(state.quotes ?? []);
  const primaryQuote = currentQuotes[0] ?? null;
  const confirmedBookings = state.bookings.filter(booking => activeBookingStatuses.has(String(booking.status))).length;
  const supplierNames = state.suppliers.flatMap(row => Array.isArray(row.suppliers) ? row.suppliers : [row.suppliers]).map((supplier: any) => supplier?.name).filter(Boolean);
  const incompleteParticipants = state.participants.filter(isIncompleteParticipant);
  const unpaidBookings = state.bookings.filter(booking => activeBookingStatuses.has(String(booking.status)) && getBookingPricingBreakdown({ booking }).remainingAmount > 0);
  const incompleteFlights = state.bookings.filter(booking => activeBookingStatuses.has(String(booking.status)) && !state.flights.some(flight => flight.booking_id === booking.id && isFlightComplete(flight)));
  const openVisas = state.visas.filter(visa => !["approved", "completed", "rejected", "cancelled", "archived"].includes(String(visa.status ?? "")));
  const overdueTasks = state.tasks.filter(task => task.deadline && new Date(task.deadline).getTime() < Date.now());
  const operationalPending = currentQuotes.filter(quote => quote.status === "approved" && quote.supplier_execution_status !== "operationally_confirmed");
  const alerts = [
    { count: unpaidBookings.length, title: "Réservations non soldées", detail: "Paiements partiels ou restant à encaisser", tab: "reservations" as const, tone: "amber" },
    { count: incompleteParticipants.length, title: "Informations participants incomplètes", detail: "Passeport ou identité à compléter", tab: "participants" as const, tone: "red" },
    { count: openVisas.length, title: "Dossiers visa à traiter", detail: "Demandes non finalisées", tab: "visa" as const, tone: "amber" },
    { count: incompleteFlights.length, title: "Vols à réserver ou compléter", detail: "Réservation ou émission incomplète", tab: "flights" as const, tone: "red" },
    { count: currentQuotes.filter(quote => quote.status === "submitted").length, title: "Devis fournisseur à revoir", detail: "Soumis à LeJapon.ma", tab: "supplier" as const, tone: "amber" },
    { count: currentQuotes.filter(quote => quote.status === "revision_requested").length, title: "Révision fournisseur demandée", detail: "Nouvelle version attendue", tab: "supplier" as const, tone: "amber" },
    { count: operationalPending.length, title: "Réservations fournisseur en attente", detail: "Devis approuvé, exécution en cours", tab: "operations" as const, tone: "amber" },
    { count: state.documents.length === 0 ? 1 : 0, title: "Aucun document voyage", detail: "Le dossier documentaire est vide", tab: "documents" as const, tone: "amber" },
    { count: overdueTasks.length, title: "Tâches en retard", detail: "Échéance dépassée", tab: "operations" as const, tone: "red" },
  ].filter(alert => alert.count > 0 && (!tabDefinitions.find(item => item.key === alert.tab)?.module || can(tabDefinitions.find(item => item.key === alert.tab)!.module!)));

  const revenue = workspaceRevenue(state.bookings, state.errors.some(error => error.startsWith("Réservations")), state.bookingCount);
  const internalCost = can("supplier_costs") ? workspaceInternalCostMad(state.quotes) : null;
  const supplierCost = can("supplier_costs") ? workspaceSupplierCostJpy(state.quotes) : null;
  const margin = revenue.state === "available" && internalCost !== null ? revenue.amountMad - internalCost : null;
  const visaComplete = state.visas.filter(visa => ["approved", "completed"].includes(String(visa.status ?? ""))).length;
  const roomedParticipants = new Set(state.assignments.map(assignment => assignment.participant_id)).size;

  return <div className="space-y-4">
    <div className="sticky top-0 z-20 -mx-2 bg-background/95 px-2 pb-2 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <PageHeader
        title={trip.title}
        description={[trip.label, trip.season, `${fmtDate(trip.start_date)} → ${fmtDate(trip.end_date)}`].filter(Boolean).join(" · ")}
        action={<Button asChild variant="outline"><Link to="/admin/trips">Retour aux voyages</Link></Button>}
      />
      {archived && <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><Archive className="mt-0.5 h-4 w-4 shrink-0" /><span><strong>Voyage archivé.</strong> Les données historiques restent accessibles en lecture. {trip.archive_reason || "Les restrictions d’écriture existantes restent appliquées."}</span></div>}
      <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl border bg-card p-3 text-xs sm:grid-cols-4 lg:grid-cols-8">
        <HeaderFact label="Statut" value={<StatusBadge value={trip.status} label={tripStatusLabels[trip.status] ?? trip.status} />} />
        <HeaderFact label="Participants" value={String(state.participants.length)} />
        <HeaderFact label="Réservations confirmées" value={String(confirmedBookings)} />
        <HeaderFact label="Places disponibles" value={trip.slots_left == null ? "—" : String(trip.slots_left)} />
        <HeaderFact label="Fournisseur Japon" value={supplierNames.join(", ") || "Non assigné"} />
        {can("supplier_costs") && <HeaderFact label="Devis fournisseur" value={primaryQuote ? `${quoteLabels[primaryQuote.status] ?? primaryQuote.status} · V${primaryQuote.version_number ?? 1}` : "Aucun devis"} />}
        <HeaderFact label="Alertes" value={alerts.length ? `${alerts.length} à traiter` : "Aucune critique"} tone={alerts.some(item => item.tone === "red") ? "danger" : undefined} />
      </div>
      <nav aria-label="Sections du dossier voyage" className="overflow-x-auto rounded-xl border bg-card p-1">
        <div className="flex min-w-max gap-1">
          {tabDefinitions.map(item => {
            const Icon = item.icon;
            const allowed = !item.module || can(item.module);
            return <Link key={item.key} to={tripWorkspacePath(tripId, item.key)} aria-current={tab === item.key ? "page" : undefined} className={cn("inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", tab === item.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground", !allowed && "opacity-60")}>
              <Icon className="h-4 w-4" />{item.label}
            </Link>;
          })}
        </div>
      </nav>
    </div>

    {state.errors.length > 0 && <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />Certaines données n’ont pas pu être chargées.</div><ul className="mt-2 list-disc space-y-1 pl-5">{state.errors.map(error => <li key={error} className="break-words">{error}</li>)}</ul><Button variant="outline" size="sm" className="mt-3" onClick={() => setRetry(value => value + 1)}><RefreshCw className="h-4 w-4" /> Réessayer</Button></div>}

    <Suspense fallback={<div role="status" className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Chargement de la section…</div>}>
      {tab === "overview" && <WorkspaceOverview alerts={alerts} tripId={tripId} revenue={revenue} internalCost={internalCost} supplierCost={supplierCost} margin={margin} bookings={state.bookings.length} participants={state.participants.length} visaComplete={visaComplete} visaTotal={state.visas.length} roomed={roomedParticipants} supplierStatus={primaryQuote?.status} />}
      {tab === "reservations" && <Protected allowed={can("bookings")}><ReservationsTab rows={state.bookings} tripId={tripId} /></Protected>}
      {tab === "participants" && <Protected allowed={can("bookings")}><ArchivedSwitch archived={archived} archivedView={<ParticipantsReadOnly rows={state.participants} />}><OpsParticipants trip={trip} /></ArchivedSwitch></Protected>}
      {tab === "finance" && <Protected allowed={can("accounting")}><FinanceTab revenue={revenue} internalCost={internalCost} supplierCost={supplierCost} margin={margin} /></Protected>}
      {tab === "visa" && <Protected allowed={can("visa")}><VisaTab rows={state.visas} /></Protected>}
      {tab === "flights" && <Protected allowed={can("flight_tickets")}><FlightTickets initialTripId={tripId} embedded /></Protected>}
      {tab === "hotels" && <Protected allowed={can("operations_center")}><ArchivedSwitch archived={archived} archivedView={<HotelsReadOnly hotels={state.hotels} rooms={state.rooms} />}><OpsRooms trip={trip} /></ArchivedSwitch></Protected>}
      {tab === "supplier" && <Protected allowed={can("supplier_costs")}><ArchivedSwitch archived={archived} archivedView={<SupplierReadOnly rows={state.quotes ?? []} />}><SupplierWorkspaceTab tripId={tripId} quotes={state.quotes ?? []} suppliers={state.suppliers} /></ArchivedSwitch></Protected>}
      {tab === "operations" && <Protected allowed={can("operations_center")}><ArchivedSwitch archived={archived} archivedView={<TasksReadOnly rows={state.tasks} />}><TripOperations trip={trip} /></ArchivedSwitch></Protected>}
      {tab === "documents" && <Protected allowed={can("operations_center")}><DocumentsTab rows={state.documents} archived={archived} tripId={tripId} /></Protected>}
    </Suspense>
  </div>;
}

function Protected({ allowed, children }: { allowed: boolean; children: React.ReactNode }) {
  return allowed ? <>{children}</> : <div className="rounded-xl border bg-card p-8 text-center"><p className="font-semibold">Accès restreint</p><p className="mt-1 text-sm text-muted-foreground">Votre rôle ne permet pas d’afficher cette section.</p></div>;
}
function ArchivedSwitch({ archived, archivedView, children }: { archived: boolean; archivedView: React.ReactNode; children: React.ReactNode }) { return <>{archived ? archivedView : children}</>; }
function HeaderFact({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "danger" }) { return <div className="min-w-0"><p className="text-muted-foreground">{label}</p><div className={cn("mt-1 truncate font-semibold", tone === "danger" && "text-destructive")}>{value}</div></div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border bg-card p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>; }

function WorkspaceOverview({ alerts, tripId, revenue, internalCost, supplierCost, margin, bookings, participants, visaComplete, visaTotal, roomed, supplierStatus }: any) {
  return <div className="space-y-5">
    <section><div className="mb-3 flex items-center justify-between"><div><h2 className="font-display text-xl">À traiter</h2><p className="text-sm text-muted-foreground">Actions opérationnelles pour ce voyage.</p></div></div>
      {alerts.length === 0 ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">Aucune action critique détectée dans les données chargées.</div> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{alerts.map((alert: any) => <Link key={`${alert.tab}:${alert.title}`} to={tripWorkspacePath(tripId, alert.tab)} className={cn("group rounded-xl border p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", alert.tone === "red" ? "border-red-200 bg-red-50 hover:border-red-400" : "border-amber-200 bg-amber-50 hover:border-amber-400")}><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{alert.title}</p><p className="mt-1 text-xs text-muted-foreground">{alert.detail}</p></div><Badge variant={alert.tone === "red" ? "destructive" : "secondary"}>{alert.count}</Badge></div><p className="mt-3 text-xs font-semibold group-hover:underline">Ouvrir la section</p></Link>)}</div>}
    </section>
    <section><h2 className="mb-3 font-display text-xl">Synthèse compacte</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Metric label="Réservations" value={String(bookings)} /><Metric label="Passagers" value={String(participants)} />
      <Metric label="Chiffre d’affaires" value={revenue.state === "available" ? fmtMAD(revenue.amountMad) : "CA non disponible"} />
      <Metric label="Coût fournisseur" value={supplierCost === null ? "Non disponible" : `${supplierCost.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} JPY`} />
      <Metric label="Coût interne" value={internalCost === null ? "Non disponible" : fmtMAD(internalCost)} />
      <Metric label="Marge" value={margin === null ? "Non calculable" : fmtMAD(margin)} />
      <Metric label="Visa" value={visaTotal ? `${visaComplete}/${visaTotal} finalisés` : "Aucun dossier"} />
      <Metric label="Rooming" value={participants ? `${roomed}/${participants} assignés` : "Aucun participant"} />
      <Metric label="Fournisseur" value={supplierStatus ? quoteLabels[supplierStatus] ?? supplierStatus : "Aucun devis"} />
    </div></section>
  </div>;
}

function ReservationsTab({ rows, tripId }: { rows: any[]; tripId: string }) {
  return <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle>Réservations du voyage</CardTitle><p className="mt-1 text-sm text-muted-foreground">{rows.length} réservation(s), filtrées par voyage.</p></div><Button asChild variant="outline"><Link to={`/admin/bookings?tripId=${encodeURIComponent(tripId)}`}>Ouvrir le module</Link></Button></CardHeader><CardContent><div className="overflow-x-auto"><table className="min-w-[760px] w-full text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="p-3">Référence</th><th className="p-3">Client</th><th className="p-3">Statut</th><th className="p-3">Voyageurs</th><th className="p-3">Total</th><th className="p-3">Payé</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-b"><td className="p-3"><Link className="font-semibold text-primary hover:underline" to={`/admin/bookings/${row.id}`}>{row.reference}</Link></td><td className="p-3">{row.contact_name}</td><td className="p-3"><StatusBadge value={row.status} /></td><td className="p-3">{Number(row.num_adults || 0) + Number(row.num_children || 0)}</td><td className="p-3">{fmtMAD(getBookingPricingBreakdown({ booking: row }).enteredFinalTotal)}</td><td className="p-3">{fmtMAD(Number(row.paid_amount_mad || 0))}</td></tr>)}{rows.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Aucune réservation pour ce voyage.</td></tr>}</tbody></table></div></CardContent></Card>;
}
function ParticipantsReadOnly({ rows }: { rows: any[] }) { return <Card><CardHeader><CardTitle>Participants archivés</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="min-w-[620px] w-full text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="p-3">Participant</th><th className="p-3">Email</th><th className="p-3">Passeport</th><th className="p-3">Nationalité</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-b"><td className="p-3 font-medium">{fullName(row)}</td><td className="p-3">{row.email || "—"}</td><td className="p-3">{row.passport_no || "—"}</td><td className="p-3">{row.nationality || "—"}</td></tr>)}</tbody></table></div></CardContent></Card>; }
function FinanceTab({ revenue, internalCost, supplierCost, margin }: any) { return <div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Chiffre d’affaires engagé" value={revenue.state === "available" ? fmtMAD(revenue.amountMad) : "CA non disponible"} /><Metric label="Coût fournisseur" value={supplierCost === null ? "Non disponible" : `${supplierCost.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} JPY`} /><Metric label="Coût interne" value={internalCost === null ? "Non disponible" : fmtMAD(internalCost)} /><Metric label="Marge prévisionnelle" value={margin === null ? "Non calculable" : fmtMAD(margin)} /></div><p className="mt-3 text-xs text-muted-foreground">Le CA utilise les montants négociés des réservations confirmées/payées/terminées. Une donnée inconnue reste indisponible et ne devient jamais zéro.</p></div>; }
function VisaTab({ rows }: { rows: any[] }) { return <Card><CardHeader><CardTitle>Dossiers visa du voyage</CardTitle></CardHeader><CardContent className="space-y-2">{rows.map(row => <Link key={row.id} to={`/admin/visa/${row.id}`} className="flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:bg-muted"><div><p className="font-medium">{row.reference || `${row.given_names ?? ""} ${row.surname ?? ""}`}</p><p className="text-xs text-muted-foreground">{row.passport_no || "Passeport à compléter"}</p></div><StatusBadge value={row.status} /></Link>)}{rows.length === 0 && <p className="text-sm text-muted-foreground">Aucun dossier visa relié aux réservations de ce voyage.</p>}</CardContent></Card>; }
function HotelsReadOnly({ hotels, rooms }: { hotels: any[]; rooms: any[] }) { return <Card><CardHeader><CardTitle>Hébergement archivé</CardTitle></CardHeader><CardContent className="space-y-2">{hotels.map(hotel => <div key={hotel.id} className="rounded-lg border p-3"><p className="font-medium">{hotel.name}</p><p className="text-xs text-muted-foreground">{hotel.city || "Ville non renseignée"} · {rooms.filter(room => room.trip_hotel_id === hotel.id).length} chambre(s)</p></div>)}{hotels.length === 0 && <p className="text-sm text-muted-foreground">Aucun hôtel enregistré.</p>}</CardContent></Card>; }
function SupplierWorkspaceTab({ tripId, quotes, suppliers }: { tripId: string; quotes: any[]; suppliers: any[] }) {
  const dossiers = groupSupplierQuoteVersions(quotes);
  const supplierNames = new Map(suppliers.map(row => [row.supplier_id, (Array.isArray(row.suppliers) ? row.suppliers[0] : row.suppliers)?.name]));
  if (dossiers.length > 1) return <div className="space-y-3"><div className="rounded-xl border bg-card p-4"><h2 className="font-semibold">Fournisseurs du voyage</h2><p className="mt-1 text-sm text-muted-foreground">Sélectionnez le dossier et la version à ouvrir dans le moteur de devis existant.</p></div>{dossiers.map(dossier => <Card key={dossier.key}><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-semibold">{supplierNames.get(dossier.current.supplier_id) || "Fournisseur"}</p><p className="text-sm text-muted-foreground">V{dossier.current.version_number ?? 1} · {quoteLabels[dossier.current.status] ?? dossier.current.status}</p></div><div className="flex flex-wrap gap-2">{dossier.versions.map(version => <Button key={version.id} asChild size="sm" variant={version.id === dossier.current.id ? "default" : "outline"}><Link to={adminSupplierQuotePath(tripId, version.id)}>V{version.version_number ?? 1}</Link></Button>)}</div></CardContent></Card>)}</div>;
  return <SupplierTripCosts key={tripId} context="admin" />;
}
function SupplierReadOnly({ rows }: { rows: any[] }) { return <Card><CardHeader><CardTitle>Dossier fournisseur archivé</CardTitle></CardHeader><CardContent className="space-y-2">{rows.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><p className="font-medium">Version V{row.version_number ?? 1}</p><p className="text-xs text-muted-foreground">{quoteLabels[row.status] ?? row.status}</p></div><div className="text-right"><p className="font-semibold">{row.supplier_total_jpy == null ? "Total non disponible" : `${Number(row.supplier_total_jpy).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} JPY`}</p><p className="text-xs text-muted-foreground">{row.supplier_execution_status || "Statut opérationnel historique"}</p></div></div>)}{rows.length === 0 && <p className="text-sm text-muted-foreground">Aucun devis fournisseur accessible.</p>}</CardContent></Card>; }
function TasksReadOnly({ rows }: { rows: any[] }) { return <Card><CardHeader><CardTitle>Suivi opérationnel archivé</CardTitle></CardHeader><CardContent className="space-y-2">{rows.map(row => <div key={row.id} className="flex justify-between gap-3 rounded-lg border p-3"><div><p className="font-medium">{row.title}</p><p className="text-xs text-muted-foreground">{row.deadline ? `Échéance ${fmtDate(row.deadline)}` : "Sans échéance"}</p></div><StatusBadge value={row.status} /></div>)}{rows.length === 0 && <p className="text-sm text-muted-foreground">Aucune tâche ouverte.</p>}</CardContent></Card>; }
function DocumentsTab({ rows, archived, tripId }: { rows: any[]; archived: boolean; tripId: string }) {
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const openDocument = async (row: any) => {
    setOpening(row.id); setOpenError(null);
    try {
      let url = row.file_url || null;
      if (row.file_path) {
        const { data, error } = await supabase.storage.from("trip-documents").createSignedUrl(row.file_path, 60 * 60);
        if (error) throw error;
        url = data?.signedUrl;
      }
      if (!url) throw new Error("Aucun fichier accessible pour ce document.");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) { setOpenError(diag("Document", error)); }
    finally { setOpening(null); }
  };
  return <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle>Documents du voyage</CardTitle><p className="mt-1 text-sm text-muted-foreground">{rows.length} document(s) accessible(s) selon votre rôle.</p></div>{!archived && <Button asChild variant="outline"><Link to={`/admin/supplier-costs/${tripId}`}>Gérer dans le dossier fournisseur</Link></Button>}</CardHeader><CardContent className="space-y-2">{openError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{openError}</p>}{rows.map(row => <div key={row.id} className="flex flex-col justify-between gap-2 rounded-lg border p-3 sm:flex-row sm:items-center"><div><p className="font-medium">{row.title || row.file_name}</p><p className="text-xs text-muted-foreground">{row.category || "Autre"} · V{row.version ?? 1} · {row.uploaded_at ? fmtDate(row.uploaded_at) : "Date inconnue"}</p></div><div className="flex items-center gap-2"><Badge variant="outline">{row.uploaded_by_role || "Interne"}</Badge><Button type="button" variant="outline" size="sm" disabled={opening === row.id} onClick={() => void openDocument(row)}>Ouvrir</Button></div></div>)}{rows.length === 0 && <p className="text-sm text-muted-foreground">Aucun document dans ce dossier.</p>}</CardContent></Card>;
}
