import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, BriefcaseBusiness, Building2, CalendarClock, CheckCircle2,
  FileWarning, Filter, Hotel, ListChecks, MoreHorizontal, Plane, RefreshCw, Search,
  ShieldCheck, Train, UserRoundCheck,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOverlayHistory } from "@/hooks/useOverlayHistory";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AdminOverlayCloseButton } from "@/admin/components/AdminOverlayCloseButton";
import { BookingQuickViewSheet } from "@/admin/components/BookingQuickViewSheet";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isLinkedToArchivedTrip } from "@/lib/trip-archiving";
import { tripWorkspacePath } from "@/admin/lib/trip-workspace";
import {
  deduplicateOperationTasks, groupOperationTaskKey, isOperationTaskBacklog,
  isOperationTaskDueToday, isOperationTaskOverdue, operationCategoryLabels,
  operationPriorityLabels, operationStatusLabels, operationTaskDueBucket,
  operationTaskDueLabel, operationTaskKey, sortOperationTasks, taskMatchesQuickFilter,
  tasksSupportMutation, type NormalizedOperationTask, type OperationGroupView,
  type OperationPriority, type OperationQuickFilter, type OperationStatus,
  type OperationTaskSource,
} from "@/admin/lib/operations-center";

type SourceStatus = { key: string; ok: boolean; message?: string };
type StaffMember = { id: string; name: string };
type BusinessAlertSource = "flights" | "visa" | "passports" | "hotels" | "guides" | "transport" | "suppliers" | "agency_fit";
type BusinessAlert = {
  id: string; source: BusinessAlertSource; title: string; context?: string | null;
  missing?: string[]; href: string; bookingId?: string | null;
  severity: "critical" | "high" | "medium";
};
type OperationsState = {
  tasks: NormalizedOperationTask[]; alerts: BusinessAlert[]; trips: any[]; bookings: any[];
  staff: StaffMember[]; sourceStatuses: SourceStatus[]; legacyDuplicatesRemoved: number;
};

const emptyState: OperationsState = { tasks: [], alerts: [], trips: [], bookings: [], staff: [], sourceStatuses: [], legacyDuplicatesRemoved: 0 };
const activeSupplierStatuses = new Set(["todo", "pending", "issue", "draft", "in_progress", "submitted", "revision_requested", "ready_for_japan_office"]);
const closedVisaStatuses = new Set(["approved", "accepted", "completed", "rejected", "cancelled", "archived"]);
const closedAgencyFitStatuses = new Set(["accepted", "converted_to_booking", "cancelled", "archived"]);
const activeTaskStatuses = new Set(["todo", "in_progress", "waiting"]);

const alertLabels: Record<BusinessAlertSource, string> = {
  flights: "Vols", visa: "Visa", passports: "Passeports", hotels: "Hôtels",
  guides: "Guides", transport: "Transport", suppliers: "Fournisseurs", agency_fit: "Agency FIT",
};
const alertIcons: Record<BusinessAlertSource, typeof Plane> = {
  flights: Plane, visa: ShieldCheck, passports: FileWarning, hotels: Hotel,
  guides: UserRoundCheck, transport: Train, suppliers: Building2, agency_fit: BriefcaseBusiness,
};
const priorityStyles: Record<OperationPriority, string> = {
  critical: "bg-red-50 text-red-800 ring-red-200", high: "bg-orange-50 text-orange-800 ring-orange-200",
  medium: "bg-sky-50 text-sky-800 ring-sky-200", low: "bg-slate-100 text-slate-700 ring-slate-200",
};
const statusStyles: Record<OperationStatus, string> = {
  todo: "bg-slate-100 text-slate-700", in_progress: "bg-blue-50 text-blue-800",
  waiting: "bg-amber-50 text-amber-800", completed: "bg-emerald-50 text-emerald-800",
  cancelled: "bg-slate-100 text-slate-500",
};
const quickFilterLabels: Array<{ key: OperationQuickFilter; label: string }> = [
  { key: "today", label: "Aujourd’hui" }, { key: "overdue", label: "En retard" },
  { key: "critical", label: "Critiques" }, { key: "backlog", label: "Backlog" },
  { key: "unassigned", label: "Sans responsable" }, { key: "mine", label: "Mes tâches" },
  { key: "all", label: "Toutes" },
];
const groupLabels: Record<OperationGroupView, string> = { priorities: "Priorités", trips: "Voyages", bookings: "Réservations" };
const safeText = (...values: unknown[]) => values.map((value) => String(value ?? "").trim()).filter(Boolean).join(" · ");
const isMissingTable = (error: any) => /schema cache|does not exist|Could not find the table|relation .* does not exist/i.test(error?.message ?? "");
const sourceError = (key: string, error: any): SourceStatus => ({ key, ok: false, message: isMissingTable(error) ? "Table indisponible." : error?.message ?? "Chargement impossible." });
async function runSource<T>(key: string, query: PromiseLike<{ data: T[] | null; error: any }>) {
  const result = await query;
  if (result.error) return { rows: [] as T[], status: sourceError(key, result.error) };
  return { rows: result.data ?? [], status: { key, ok: true } as SourceStatus };
}
const resolveBookingId = (row: any) => row?.booking_id || row?.reservation_id || null;

export default function OperationsCenter() {
  const { user } = useAuth();
  const [state, setState] = useState<OperationsState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("tasks");
  const [quickFilter, setQuickFilter] = useState<OperationQuickFilter>("all");
  const [query, setQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [tripFilter, setTripFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [groupView, setGroupView] = useState<OperationGroupView>("priorities");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [selectedTask, setSelectedTask] = useState<NormalizedOperationTask | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<any | null>(null);
  const [alertSource, setAlertSource] = useState<BusinessAlertSource | "all">("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tasksResult, checklistItemsResult, flightsResult, visasResult, participantsResult,
        quotesResult, hotelRowsResult, guideRowsResult, transportRowsResult, agencyFitResult,
        tripsResult, rolesResult, profilesResult] = await Promise.all([
        runSource<any>("operation_tasks", (supabase as any).from("operation_tasks")
          .select("id,title,description,category,priority,status,assigned_to,reservation_id,booking_id,trip_id,visa_application_id,customer_id,deadline,completed_at,created_at,updated_at,trips:trip_id(id,title,archived_at)")
          .not("status", "in", "(completed,cancelled)").order("deadline", { ascending: true, nullsFirst: false }).limit(240)),
        runSource<any>("operation_checklist_items", (supabase as any).from("operation_checklist_items")
          .select("id,title,description,category,priority,status,assigned_to,deadline,completed_at,created_at,updated_at,operation_checklists(id,title,booking_id,reservation_id,trip_id,visa_application_id,customer_id,client_id,trips:trip_id(id,title,archived_at))")
          .not("status", "in", "(completed,cancelled)").order("deadline", { ascending: true, nullsFirst: false }).limit(240)),
        runSource<any>("booking_flight_reservations", (supabase as any).from("booking_flight_reservations")
          .select("id,booking_id,status,pnr,booking_platform,fare_amount,fare_mad,fare_currency,airline,flight_number,departure_at,return_at,segments,ticket_document_id,ticket_storage_path,ticket_sent_to_customer,required_traveler_count,linked_traveler_count,updated_at")
          .neq("status", "ticket_sent").neq("status", "cancelled").order("updated_at", { ascending: true }).limit(140)),
        runSource<any>("visa_applications", (supabase as any).from("visa_applications")
          .select("id,reference,status,surname,given_names,passport_no,residential_email,booking_id,submitted_at,created_at").order("created_at", { ascending: false }).limit(180)),
        runSource<any>("booking_participants", (supabase as any).from("booking_participants")
          .select("id,booking_id,first_name,last_name,email,passport_no,created_at").order("created_at", { ascending: false }).limit(260)),
        runSource<any>("supplier_trip_quotes", (supabase as any).from("supplier_trip_quotes")
          .select("id,trip_id,status,validation_status,updated_at,trips(id,title,start_date,end_date,archived_at)").order("updated_at", { ascending: false }).limit(140)),
        runSource<any>("supplier_quote_hotel_rows", (supabase as any).from("supplier_quote_hotel_rows")
          .select("id,quote_id,status,city,hotel_name,name,day_number").neq("status", "confirmed").limit(180)),
        runSource<any>("supplier_quote_guide_rows", (supabase as any).from("supplier_quote_guide_rows")
          .select("id,quote_id,status,city,guide_language,language,day_number").neq("status", "confirmed").limit(180)),
        runSource<any>("supplier_quote_transport_rows", (supabase as any).from("supplier_quote_transport_rows")
          .select("id,quote_id,status,city,route,transport_type,name,day_number").neq("status", "confirmed").limit(180)),
        runSource<any>("agency_fit_requests", (supabase as any).from("agency_fit_requests")
          .select("id,status,client_full_name,client_name,destination_country,destination,desired_departure_date,travel_start_date,created_at,updated_at").order("updated_at", { ascending: false }).limit(140)),
        runSource<any>("trips", (supabase as any).from("trips")
          .select("id,title,start_date,end_date,status,archived_at").is("archived_at", null).gte("start_date", new Date().toISOString().slice(0, 10)).order("start_date", { ascending: true }).limit(120)),
        runSource<any>("user_roles", (supabase as any).from("user_roles").select("user_id,role").limit(500)),
        runSource<any>("profiles", (supabase as any).from("profiles").select("id,full_name").order("full_name").limit(500)),
      ]);

      const bookingIds = [
        ...tasksResult.rows.map(resolveBookingId), ...checklistItemsResult.rows.map((row: any) => resolveBookingId(row.operation_checklists)),
        ...flightsResult.rows.map((row: any) => row.booking_id), ...visasResult.rows.map((row: any) => row.booking_id),
        ...participantsResult.rows.map((row: any) => row.booking_id),
      ].filter(Boolean);
      const bookingResult = await runSource<any>("bookings", bookingIds.length
        ? (supabase as any).from("bookings")
          .select("id,reference,contact_name,contact_email,status,trip_id,num_adults,num_children,total_amount_mad,paid_amount_mad,formula,room_type,quote_adjustments,trips(id,title,start_date,end_date,archived_at)")
          .in("id", Array.from(new Set(bookingIds))).limit(400)
        : Promise.resolve({ data: [], error: null }));
      const bookingMap = new Map(bookingResult.rows.map((booking: any) => [booking.id, booking]));
      const bookingIsArchived = (bookingId?: string | null) => isLinkedToArchivedTrip(bookingMap.get(bookingId)?.trips);

      const rawTasks: NormalizedOperationTask[] = [
        ...tasksResult.rows.filter((row: any) => activeTaskStatuses.has(row.status) && !isLinkedToArchivedTrip(row.trips) && !bookingIsArchived(resolveBookingId(row)))
          .map((row: any) => normalizeTask(row, "operation_tasks", bookingMap.get(resolveBookingId(row)), row.trips)),
        ...checklistItemsResult.rows.filter((row: any) => activeTaskStatuses.has(row.status) && !isLinkedToArchivedTrip(row.operation_checklists?.trips) && !bookingIsArchived(resolveBookingId(row.operation_checklists)))
          .map((row: any) => {
            const checklist = row.operation_checklists ?? {};
            return normalizeTask({ ...row, ...checklist, id: row.id, title: row.title, description: row.description, category: row.category, priority: row.priority, status: row.status, assigned_to: row.assigned_to, deadline: row.deadline, completed_at: row.completed_at }, "operation_checklist_items", bookingMap.get(resolveBookingId(checklist)), checklist.trips, checklist.title);
          }),
      ];
      const tasks = deduplicateOperationTasks(rawTasks);
      const legacyDuplicatesRemoved = tasks.filter((task) => (task.priority === "critical" || task.priority === "high") && isOperationTaskOverdue(task)).length;
      const activeQuotes = quotesResult.rows.filter((quote: any) => !isLinkedToArchivedTrip(quote.trips));
      const quoteMap = new Map(activeQuotes.map((quote: any) => [quote.id, quote]));
      const alerts: BusinessAlert[] = [];

      flightsResult.rows.filter((row: any) => !bookingIsArchived(row.booking_id)).forEach((row: any) => {
        const booking = bookingMap.get(row.booking_id);
        const missing = [!row.pnr && "PNR", !row.booking_platform && "plateforme", !(Number(row.fare_amount || row.fare_mad) > 0) && "prix",
          !row.fare_currency && "devise", Number(row.linked_traveler_count || 0) < Math.max(1, Number(row.required_traveler_count || 0)) && "voyageurs",
          (!row.ticket_document_id && !row.ticket_storage_path) && "billet PDF", row.ticket_sent_to_customer !== true && "envoi client"].filter(Boolean) as string[];
        alerts.push({ id: row.id, source: "flights", title: booking ? `${booking.contact_name || "Client"} · ${booking.reference}` : "Vol incomplet",
          context: booking?.trips?.title, missing, bookingId: row.booking_id, href: row.booking_id ? `/admin/bookings/${row.booking_id}` : "/admin/flights", severity: missing.length >= 3 ? "high" : "medium" });
      });
      visasResult.rows.filter((row: any) => !bookingIsArchived(row.booking_id) && !closedVisaStatuses.has(String(row.status || "").toLowerCase()))
        .forEach((row: any) => alerts.push({ id: row.id, source: "visa", title: safeText(row.given_names, row.surname) || row.residential_email || "Dossier visa",
          context: safeText(row.reference, bookingMap.get(row.booking_id)?.trips?.title), missing: row.passport_no ? ["Dossier à traiter"] : ["Passeport"], href: `/admin/visa/${row.id}`,
          bookingId: row.booking_id, severity: row.passport_no ? "medium" : "high" }));
      participantsResult.rows.filter((row: any) => !bookingIsArchived(row.booking_id) && !String(row.passport_no || "").trim()).forEach((row: any) => {
        const booking = bookingMap.get(row.booking_id);
        alerts.push({ id: row.id, source: "passports", title: safeText(row.first_name, row.last_name) || row.email || "Voyageur",
          context: safeText(booking?.reference, booking?.trips?.title), missing: ["Passeport non renseigné"], bookingId: row.booking_id,
          href: row.booking_id ? `/admin/bookings/${row.booking_id}` : "/admin/bookings", severity: "high" });
      });

      const addSupplierAlerts = (rows: any[], source: "hotels" | "guides" | "transport") => rows
        .filter((row: any) => quoteMap.has(row.quote_id) && activeSupplierStatuses.has(String(row.status))).forEach((row: any) => {
          const quote: any = quoteMap.get(row.quote_id);
          const label = source === "hotels" ? row.hotel_name || row.name || "Hôtel" : source === "guides" ? row.guide_language || row.language || "Guide" : row.route || row.transport_type || row.name || "Transport";
          alerts.push({ id: row.id, source, title: String(label), context: safeText(quote?.trips?.title, row.city, row.day_number ? `Jour ${row.day_number}` : ""),
            missing: [row.status === "issue" ? "Correction requise" : "Confirmation fournisseur"], href: quote?.trip_id ? `/admin/supplier-costs/${quote.trip_id}/${quote.id}` : "/admin/supplier-costs",
            severity: row.status === "issue" ? "critical" : "medium" });
        });
      addSupplierAlerts(hotelRowsResult.rows, "hotels"); addSupplierAlerts(guideRowsResult.rows, "guides"); addSupplierAlerts(transportRowsResult.rows, "transport");
      activeQuotes.filter((row: any) => !["japan_office_confirmed", "ready_to_travel", "approved", "reviewed"].includes(String(row.validation_status || row.status || "").toLowerCase()))
        .forEach((row: any) => alerts.push({ id: row.id, source: "suppliers", title: row.trips?.title || "Devis fournisseur", context: safeText(row.status, row.validation_status),
          missing: ["Revue du devis fournisseur"], href: row.trip_id ? `/admin/supplier-costs/${row.trip_id}/${row.id}` : "/admin/supplier-costs", severity: "medium" }));
      agencyFitResult.rows.filter((row: any) => !closedAgencyFitStatuses.has(String(row.status || "").toLowerCase())).forEach((row: any) => alerts.push({
        id: row.id, source: "agency_fit", title: row.client_full_name || row.client_name || "Demande FIT agence", context: safeText(row.destination_country || row.destination, row.desired_departure_date || row.travel_start_date),
        missing: ["Demande à traiter"], href: "/admin/agency-fit-requests", severity: ["submitted", "new", "under_review"].includes(String(row.status)) ? "high" : "medium" }));

      const staffIds = new Set(rolesResult.rows.map((role: any) => role.user_id).filter(Boolean));
      const profileMap = new Map(profilesResult.rows.map((profile: any) => [profile.id, profile]));
      const staff = Array.from(staffIds).map((id) => ({ id: String(id), name: String(profileMap.get(id)?.full_name || (id === user?.id ? user.email || "Moi" : "Membre équipe")) })).sort((a, b) => a.name.localeCompare(b.name, "fr"));
      setState({ tasks, alerts, trips: tripsResult.rows, bookings: bookingResult.rows, staff, legacyDuplicatesRemoved,
        sourceStatuses: [tasksResult.status, checklistItemsResult.status, flightsResult.status, visasResult.status, participantsResult.status, quotesResult.status,
          hotelRowsResult.status, guideRowsResult.status, transportRowsResult.status, agencyFitResult.status, tripsResult.status, rolesResult.status, profilesResult.status, bookingResult.status] });
      setSelectedKeys((current) => new Set(Array.from(current).filter((key) => tasks.some((task) => operationTaskKey(task) === key))));
    } catch (error: any) { toast.error(error?.message ?? "Impossible de charger Operations Center."); }
    finally { setLoading(false); }
  }, [user?.email, user?.id]);

  useEffect(() => { void load(); }, [load]);
  const staffMap = useMemo(() => new Map(state.staff.map((member) => [member.id, member.name])), [state.staff]);
  const bookingMap = useMemo(() => new Map(state.bookings.map((booking) => [booking.id, booking])), [state.bookings]);
  const counts = useMemo(() => ({
    today: state.tasks.filter((task) => isOperationTaskDueToday(task)).length,
    overdue: state.tasks.filter((task) => isOperationTaskOverdue(task)).length,
    critical: state.tasks.filter((task) => task.priority === "critical").length,
    backlog: state.tasks.filter((task) => isOperationTaskBacklog(task)).length,
    unassigned: state.tasks.filter((task) => !task.assignedTo).length,
    mine: state.tasks.filter((task) => task.assignedTo === user?.id).length,
    all: state.tasks.length,
  }), [state.tasks, user?.id]);

  const filteredTasks = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("fr");
    return sortOperationTasks(state.tasks.filter((task) => {
      if (!taskMatchesQuickFilter(task, quickFilter, user?.id)) return false;
      if (priorityFilter !== "all" && task.priority !== priorityFilter) return false;
      if (statusFilter !== "active" && task.status !== statusFilter) return false;
      if (categoryFilter !== "all" && task.category !== categoryFilter) return false;
      if (tripFilter !== "all" && (task.tripId || "none") !== tripFilter) return false;
      if (assigneeFilter === "mine" && task.assignedTo !== user?.id) return false;
      if (assigneeFilter === "unassigned" && task.assignedTo) return false;
      if (!["all", "mine", "unassigned"].includes(assigneeFilter) && task.assignedTo !== assigneeFilter) return false;
      return !needle || safeText(task.title, task.description, task.category, task.bookingReference, task.clientName, task.tripTitle).toLocaleLowerCase("fr").includes(needle);
    }));
  }, [assigneeFilter, categoryFilter, priorityFilter, query, quickFilter, state.tasks, statusFilter, tripFilter, user?.id]);

  const effectiveGroupView: OperationGroupView = quickFilter === "backlog" && groupView === "priorities" ? "trips" : groupView;
  const groupedTasks = useMemo(() => {
    const groups = new Map<string, NormalizedOperationTask[]>();
    filteredTasks.forEach((task) => { const key = groupOperationTaskKey(task, effectiveGroupView); groups.set(key, [...(groups.get(key) ?? []), task]); });
    return Array.from(groups.entries()).map(([key, tasks]) => ({ key, title: groupTitle(key, tasks, effectiveGroupView), tasks }));
  }, [effectiveGroupView, filteredTasks]);
  const selectedTasks = useMemo(() => state.tasks.filter((task) => selectedKeys.has(operationTaskKey(task))), [selectedKeys, state.tasks]);
  const categories = useMemo(() => Array.from(new Set(state.tasks.map((task) => task.category))).sort(), [state.tasks]);
  const alertCounts = useMemo(() => Object.fromEntries(Object.keys(alertLabels).map((source) => [source, state.alerts.filter((alert) => alert.source === source).length])) as Record<BusinessAlertSource, number>, [state.alerts]);
  const filteredAlerts = useMemo(() => state.alerts.filter((alert) => alertSource === "all" || alert.source === alertSource).sort((a, b) => alertSeverityRank(a.severity) - alertSeverityRank(b.severity)), [alertSource, state.alerts]);
  const failedSources = state.sourceStatuses.filter((source) => !source.ok);

  const updateTasks = async (tasks: NormalizedOperationTask[], patch: Record<string, unknown>, successMessage: string) => {
    if (!tasks.length) return;
    setSaving(true);
    const previousStatuses = new Map(tasks.map((task) => [operationTaskKey(task), task.status]));
    try {
      for (const sourceTable of ["operation_tasks", "operation_checklist_items"] as OperationTaskSource[]) {
        const sourceTasks = tasks.filter((task) => task.sourceTable === sourceTable);
        if (!sourceTasks.length) continue;
        const { error } = await (supabase as any).from(sourceTable).update(patch).in("id", sourceTasks.map((task) => task.id));
        if (error) throw error;
        if (sourceTable === "operation_tasks" && typeof patch.status === "string") {
          const historyRows = sourceTasks.map((task) => ({ task_id: task.id, event_type: patch.status === "completed" ? "completed" : "status_changed",
            old_status: previousStatuses.get(operationTaskKey(task)), new_status: patch.status, actor_id: user?.id ?? null, metadata: { source: "operations_center" } }));
          const { error: historyError } = await (supabase as any).from("operation_task_history").insert(historyRows);
          if (historyError) console.warn("[operations-center] task history unavailable", historyError);
        }
      }
      toast.success(successMessage); setSelectedKeys(new Set()); setSelectedTask(null); await load();
    } catch (error: any) { toast.error(error?.message ?? "Mise à jour impossible."); }
    finally { setSaving(false); }
  };
  const updateStatus = (tasks: NormalizedOperationTask[], status: OperationStatus) => updateTasks(tasks, {
    status, completed_at: status === "completed" ? new Date().toISOString() : null, completed_by: status === "completed" ? user?.id ?? null : null,
  }, tasks.length > 1 ? `${tasks.length} tâches mises à jour.` : `Tâche ${operationStatusLabels[status].toLocaleLowerCase("fr")}.`);
  const updateAssignee = (tasks: NormalizedOperationTask[], assignedTo: string | null) => updateTasks(tasks, { assigned_to: assignedTo }, tasks.length > 1 ? `${tasks.length} tâches réassignées.` : "Responsable mis à jour.");
  const toggleSelected = (task: NormalizedOperationTask) => setSelectedKeys((current) => { const next = new Set(current); const key = operationTaskKey(task); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  return (
    <div className="space-y-4 pb-24 md:space-y-5 md:pb-8">
      <header className="flex items-start justify-between gap-3 rounded-2xl border bg-card px-4 py-4 shadow-sm sm:items-end sm:px-5">
        <div className="min-w-0">
          <h1 className="font-display text-2xl leading-tight md:text-3xl">Operations Center</h1>
          <p className="mt-1 text-sm text-muted-foreground">Les actions opérationnelles à traiter aujourd’hui.</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button asChild variant="outline" className="hidden min-h-11 sm:inline-flex"><Link to="/admin/operation-task-templates"><ListChecks className="h-4 w-4" /> Tâches standards</Link></Button>
          <Button variant="outline" size="icon" className="h-11 w-11 sm:w-auto sm:px-4" onClick={() => void load()} disabled={loading} aria-label="Actualiser"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /><span className="hidden sm:inline">Actualiser</span></Button>
        </div>
      </header>

      <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" aria-label="Filtres rapides"><div className="flex min-w-max gap-2">
        {quickFilterLabels.filter((filter) => filter.key !== "mine" || user?.id).map((filter) => <button key={filter.key} type="button" data-testid="operation-quick-filter" data-filter={filter.key} onClick={() => { setQuickFilter(filter.key); setActiveTab("tasks"); }}
          className={cn("min-h-11 rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            quickFilter === filter.key ? "border-foreground bg-foreground text-background shadow-sm" : "border-border bg-background hover:bg-muted")}>{filter.label} <span className={cn("ml-1 tabular-nums", quickFilter === filter.key ? "text-background/75" : "text-muted-foreground")}>{counts[filter.key]}</span></button>)}
      </div></div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid h-11 w-full grid-cols-2 sm:w-[420px]"><TabsTrigger value="tasks" className="min-h-9">Tâches <span className="ml-1 text-xs opacity-70">{state.tasks.length}</span></TabsTrigger><TabsTrigger value="alerts" className="min-h-9">Alertes métier <span className="ml-1 text-xs opacity-70">{state.alerts.length}</span></TabsTrigger></TabsList>
        <TabsContent value="tasks" className="mt-4"><div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <main className="min-w-0 space-y-4">
            <section aria-labelledby="tasks-heading"><div className="mb-3 flex items-end justify-between gap-3"><div><h2 id="tasks-heading" className="font-display text-xl font-semibold">À traiter maintenant</h2><p className="text-sm text-muted-foreground">{filteredTasks.length} tâche{filteredTasks.length !== 1 ? "s" : ""} · {groupLabels[effectiveGroupView].toLocaleLowerCase("fr")}</p></div>
              {filteredTasks.length > 0 && <Button variant="ghost" size="sm" className="hidden sm:inline-flex" onClick={() => setSelectedKeys(selectedKeys.size === filteredTasks.length ? new Set() : new Set(filteredTasks.map(operationTaskKey)))}>{selectedKeys.size === filteredTasks.length ? "Tout désélectionner" : "Tout sélectionner"}</Button>}</div>
              <div className="mb-3 rounded-2xl border border-border bg-card p-2 shadow-sm sm:p-4">
                <div className="flex gap-2 md:items-center"><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tâche, client, réservation, voyage…" className="h-11 pl-9" /></div>
                  <Button variant="outline" size="icon" className="h-11 w-11 shrink-0 md:hidden" onClick={() => setFiltersOpen(true)} aria-label="Filtres"><Filter className="h-4 w-4" />{activeAdvancedFilterCount({ priorityFilter, statusFilter, categoryFilter, tripFilter, assigneeFilter }) > 0 && <span className="absolute -mr-8 -mt-8 rounded-full bg-foreground px-1.5 text-[10px] text-background">{activeAdvancedFilterCount({ priorityFilter, statusFilter, categoryFilter, tripFilter, assigneeFilter })}</span>}</Button>
                  <Select value={groupView} onValueChange={(value) => setGroupView(value as OperationGroupView)}><SelectTrigger className="hidden h-11 md:flex md:w-[180px]"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(groupLabels).map(([value, label]) => <SelectItem key={value} value={value}>Vue : {label}</SelectItem>)}</SelectContent></Select>
                </div>
                <div className="mt-3 hidden grid-cols-5 gap-2 md:grid"><TaskFilters {...{ priorityFilter, setPriorityFilter, statusFilter, setStatusFilter, categoryFilter, setCategoryFilter, tripFilter, setTripFilter, assigneeFilter, setAssigneeFilter }} categories={categories} trips={state.trips} staff={state.staff} currentUserId={user?.id} /></div>
              </div>
              {loading ? <TaskSkeleton /> : groupedTasks.length === 0 ? <EmptyTasks filtered={state.tasks.length > 0} /> : <div className="space-y-4">{groupedTasks.map((group) => <div key={group.key} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"><div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3"><div><h3 className="text-sm font-semibold">{group.title}</h3><p className="text-xs text-muted-foreground">{group.tasks.length} restante{group.tasks.length > 1 ? "s" : ""}</p></div>{effectiveGroupView !== "priorities" && group.key !== "trip:none" && group.key !== "booking:none" && <Link to={groupLink(group.tasks[0], effectiveGroupView)} className="inline-flex min-h-11 items-center gap-1 px-2 text-sm font-medium text-orange-700 hover:underline">Ouvrir <ArrowRight className="h-4 w-4" /></Link>}</div><div className="divide-y divide-border">{group.tasks.map((task) => <TaskRow key={operationTaskKey(task)} task={task} selected={selectedKeys.has(operationTaskKey(task))} assigneeName={task.assignedTo ? staffMap.get(task.assignedTo) : null} saving={saving} onSelect={() => toggleSelected(task)} onOpen={() => setSelectedTask(task)} onStatus={(status) => void updateStatus([task], status)} />)}</div></div>)}</div>}
            </section>
          </main>
          <aside className="space-y-4"><UpcomingTrips trips={state.trips} tasks={state.tasks} /><AlertSummary counts={alertCounts} onOpen={(source) => { setAlertSource(source); setActiveTab("alerts"); }} />{failedSources.length > 0 && <SourceErrors sources={failedSources} />}{state.legacyDuplicatesRemoved > 0 && <p data-testid="legacy-duplicates-removed" className="px-1 text-xs text-muted-foreground">{state.legacyDuplicatesRemoved} doublon{state.legacyDuplicatesRemoved > 1 ? "s" : ""} d’affichage historique éliminé{state.legacyDuplicatesRemoved > 1 ? "s" : ""}.</p>}</aside>
        </div></TabsContent>
        <TabsContent value="alerts" className="mt-4 space-y-4"><AlertSummary counts={alertCounts} active={alertSource} onOpen={setAlertSource} expanded /><div className="flex items-end justify-between gap-3"><div><h2 className="font-display text-xl font-semibold">Alertes métier</h2><p className="text-sm text-muted-foreground">Signaux à résoudre dans leur module métier.</p></div>{alertSource !== "all" && <Button variant="ghost" onClick={() => setAlertSource("all")}>Tout afficher</Button>}</div>
          {loading ? <TaskSkeleton /> : filteredAlerts.length === 0 ? <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">Aucune alerte métier pour ce filtre.</div> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filteredAlerts.slice(0, 160).map((alert) => <BusinessAlertCard key={`${alert.source}:${alert.id}`} alert={alert} onBookingQuickView={(bookingId) => setSelectedBooking(bookingMap.get(bookingId) ?? null)} />)}</div>}
        </TabsContent>
      </Tabs>

      <TaskDetailSheet task={selectedTask} open={Boolean(selectedTask)} staff={state.staff} saving={saving} onOpenChange={(open) => !open && setSelectedTask(null)} onStatus={(status) => selectedTask && void updateStatus([selectedTask], status)} onDeadline={(deadline) => selectedTask && void updateTasks([selectedTask], { deadline }, "Échéance mise à jour.")} onAssign={(assignedTo) => selectedTask && void updateAssignee([selectedTask], assignedTo)} onBookingQuickView={(bookingId) => setSelectedBooking(bookingMap.get(bookingId) ?? null)} />
      <BookingQuickViewSheet booking={selectedBooking} open={Boolean(selectedBooking)} onOpenChange={(open) => !open && setSelectedBooking(null)} onChanged={() => void load()} />
      <FiltersSheet open={filtersOpen} onOpenChange={setFiltersOpen} groupView={groupView} setGroupView={setGroupView} filterProps={{ priorityFilter, setPriorityFilter, statusFilter, setStatusFilter, categoryFilter, setCategoryFilter, tripFilter, setTripFilter, assigneeFilter, setAssigneeFilter }} categories={categories} trips={state.trips} staff={state.staff} currentUserId={user?.id} />
      {selectedTasks.length > 0 && <BulkActionBar tasks={selectedTasks} staff={state.staff} saving={saving} onClear={() => setSelectedKeys(new Set())} onStatus={(status) => void updateStatus(selectedTasks, status)} onAssign={(assignedTo) => void updateAssignee(selectedTasks, assignedTo)} />}
    </div>
  );
}

function normalizeTask(row: any, sourceTable: OperationTaskSource, booking: any, trip: any, checklistTitle?: string): NormalizedOperationTask {
  const bookingId = resolveBookingId(row); const tripId = row.trip_id || booking?.trip_id || null;
  const href = bookingId ? `/admin/bookings/${bookingId}` : row.visa_application_id ? `/admin/visa/${row.visa_application_id}` : tripId ? tripWorkspacePath(tripId, "operations") : "/admin/operations-center";
  return { id: row.id, sourceTable, title: row.title, description: row.description, category: row.category || "general", priority: row.priority || "medium", status: row.status || "todo", assignedTo: row.assigned_to,
    deadline: row.deadline, completedAt: row.completed_at, bookingId, tripId, visaApplicationId: row.visa_application_id, clientId: row.client_id || row.customer_id,
    bookingReference: booking?.reference, clientName: booking?.contact_name, tripTitle: booking?.trips?.title || trip?.title, checklistTitle, href };
}
function groupTitle(key: string, tasks: NormalizedOperationTask[], view: OperationGroupView) { const first = tasks[0]; if (view === "trips") return first.tripTitle || "Sans voyage"; if (view === "bookings") return first.bookingReference ? safeText(first.bookingReference, first.clientName) : "Sans réservation"; return operationPriorityLabels[key.replace("priority:", "") as OperationPriority] || "Autres priorités"; }
function groupLink(task: NormalizedOperationTask, view: OperationGroupView) { if (view === "trips" && task.tripId) return tripWorkspacePath(task.tripId, "operations"); if (view === "bookings" && task.bookingId) return `/admin/bookings/${task.bookingId}`; return task.href; }

function TaskRow({ task, selected, assigneeName, saving, onSelect, onOpen, onStatus }: { task: NormalizedOperationTask; selected: boolean; assigneeName?: string | null; saving: boolean; onSelect: () => void; onOpen: () => void; onStatus: (status: OperationStatus) => void }) {
  const overdue = isOperationTaskOverdue(task); const bucket = operationTaskDueBucket(task);
  return <article data-testid="operation-task-row" data-task-key={operationTaskKey(task)} data-source={task.sourceTable} className={cn("p-3 transition-colors sm:p-4", selected && "bg-orange-50/60")}><div className="flex items-start gap-3"><label className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg hover:bg-muted" aria-label={`Sélectionner ${task.title}`}><Checkbox checked={selected} onCheckedChange={onSelect} className="h-5 w-5" /></label><button type="button" data-testid="operation-task-open" onClick={onOpen} className="min-w-0 flex-1 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="flex flex-wrap items-center gap-2"><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1", priorityStyles[task.priority])}>{operationPriorityLabels[task.priority]}</span><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", statusStyles[task.status])}>{operationStatusLabels[task.status]}</span><span className={cn("text-xs font-semibold", overdue ? "text-red-700" : bucket === "today" ? "text-orange-700" : "text-muted-foreground")}>{operationTaskDueLabel(task)}</span></div><h3 className="mt-2 text-[15px] font-semibold leading-snug text-foreground">{task.title}</h3><p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{safeText(task.bookingReference, task.clientName, task.tripTitle) || task.checklistTitle || operationCategoryLabels[task.category] || task.category}</p><div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{operationCategoryLabels[task.category] || task.category}</span><span>{assigneeName || "Non assigné"}</span></div></button></div><div className="mt-3 flex flex-wrap items-center gap-2 pl-14">{task.status !== "in_progress" && <Button variant="outline" size="sm" className="min-h-11" disabled={saving} onClick={() => onStatus("in_progress")}>En cours</Button>}<Button size="sm" className="min-h-11 bg-emerald-700 hover:bg-emerald-800" disabled={saving} onClick={() => onStatus("completed")}><CheckCircle2 className="h-4 w-4" /> Terminer</Button><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Plus d’actions"><MoreHorizontal className="h-5 w-5" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={onOpen}>Ouvrir / modifier</DropdownMenuItem><DropdownMenuItem onClick={() => onStatus("waiting")}>Mettre en attente</DropdownMenuItem><DropdownMenuItem className="text-destructive" onClick={() => confirm(`Annuler la tâche « ${task.title} » ?`) && onStatus("cancelled")}>Annuler la tâche</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></article>;
}

function TaskDetailSheet({ task, open, staff, saving, onOpenChange, onStatus, onDeadline, onAssign, onBookingQuickView }: { task: NormalizedOperationTask | null; open: boolean; staff: StaffMember[]; saving: boolean; onOpenChange: (open: boolean) => void; onStatus: (status: OperationStatus) => void; onDeadline: (deadline: string | null) => void; onAssign: (assignedTo: string | null) => void; onBookingQuickView: (bookingId: string) => void }) {
  const overlay = useOverlayHistory(open, () => onOpenChange(false), "operation-task-detail"); const [deadline, setDeadline] = useState(""); const [history, setHistory] = useState<any[]>([]); const [historyLoading, setHistoryLoading] = useState(false);
  useEffect(() => { setDeadline(task?.deadline ? toLocalDateTimeInput(task.deadline) : ""); if (!open || !task) { setHistory([]); return; } let active = true; setHistoryLoading(true); const table = task.sourceTable === "operation_tasks" ? "operation_task_history" : "operation_checklist_history"; const idColumn = task.sourceTable === "operation_tasks" ? "task_id" : "item_id"; void (async () => { const { data, error } = await (supabase as any).from(table).select("*").eq(idColumn, task.id).order("created_at", { ascending: false }).limit(20); if (!active) return; if (error) console.warn("[operations-center] history unavailable", error); setHistory(data ?? []); setHistoryLoading(false); })(); return () => { active = false; }; }, [open, task]);
  return <Sheet open={open} onOpenChange={overlay.handleOpenChange}><SheetContent className="w-full max-w-none p-0 [&>button:last-child]:hidden sm:w-[min(620px,92vw)] sm:max-w-none">{task && <div className="flex min-h-full flex-col"><SheetHeader className="sticky top-0 z-40 border-b bg-background px-4 pb-4 pt-[calc(0.75rem+env(safe-area-inset-top))] shadow-sm sm:px-6 sm:pt-4"><div className="flex min-h-11 items-center justify-between gap-3"><AdminOverlayCloseButton onClick={() => overlay.requestClose()} /><span className={cn("rounded-full px-2 py-1 text-xs font-semibold", statusStyles[task.status])}>{operationStatusLabels[task.status]}</span></div><div className="pt-1 text-left"><SheetTitle className="font-display text-xl leading-tight">{task.title}</SheetTitle><SheetDescription>{safeText(task.bookingReference, task.clientName, task.tripTitle) || "Tâche opérationnelle"}</SheetDescription></div></SheetHeader><div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:px-6 sm:pb-6"><div className="flex flex-wrap gap-2"><span className={cn("rounded-full px-2 py-1 text-xs font-semibold ring-1", priorityStyles[task.priority])}>{operationPriorityLabels[task.priority]}</span><span className="rounded-full bg-muted px-2 py-1 text-xs">{operationCategoryLabels[task.category] || task.category}</span><span className="rounded-full bg-muted px-2 py-1 text-xs">{operationTaskDueLabel(task)}</span></div>{task.description && <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{task.description}</p>}<div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1.5 text-sm font-medium">Statut<Select value={task.status} onValueChange={(value) => onStatus(value as OperationStatus)} disabled={saving}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent>{(["todo", "in_progress", "waiting", "completed"] as OperationStatus[]).map((status) => <SelectItem key={status} value={status}>{operationStatusLabels[status]}</SelectItem>)}</SelectContent></Select></label><label className="space-y-1.5 text-sm font-medium">Responsable<Select value={task.assignedTo || "unassigned"} onValueChange={(value) => onAssign(value === "unassigned" ? null : value)} disabled={saving}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unassigned">Non assigné</SelectItem>{staff.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}</SelectContent></Select></label><label className="space-y-1.5 text-sm font-medium sm:col-span-2">Échéance<div className="flex gap-2"><Input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} className="h-11" /><Button variant="outline" className="min-h-11" disabled={saving} onClick={() => onDeadline(deadline ? new Date(deadline).toISOString() : null)}>Enregistrer</Button></div></label></div><div className="grid gap-2 sm:grid-cols-2">{task.bookingId && <Button variant="outline" className="min-h-11" onClick={() => onBookingQuickView(task.bookingId!)}>Aperçu réservation</Button>}<Button asChild className="min-h-11"><Link to={task.href}>Ouvrir le dossier lié <ArrowRight className="h-4 w-4" /></Link></Button></div><section><h3 className="text-sm font-semibold">Historique récent</h3>{historyLoading ? <p className="mt-2 text-sm text-muted-foreground">Chargement…</p> : history.length ? <div className="mt-2 space-y-2">{history.map((entry) => <div key={entry.id} className="rounded-xl border p-3 text-sm"><p className="font-medium">{historyLabel(entry)}</p><p className="mt-1 text-xs text-muted-foreground">{fmtDateTime(entry.created_at)}</p></div>)}</div> : <p className="mt-2 text-sm text-muted-foreground">Aucun historique disponible.</p>}</section></div></div>}</SheetContent></Sheet>;
}

type FilterProps = { priorityFilter: string; setPriorityFilter: (value: string) => void; statusFilter: string; setStatusFilter: (value: string) => void; categoryFilter: string; setCategoryFilter: (value: string) => void; tripFilter: string; setTripFilter: (value: string) => void; assigneeFilter: string; setAssigneeFilter: (value: string) => void };
function TaskFilters(props: FilterProps & { categories: string[]; trips: any[]; staff: StaffMember[]; currentUserId?: string }) { return <><Select value={props.priorityFilter} onValueChange={props.setPriorityFilter}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Toutes priorités</SelectItem>{Object.entries(operationPriorityLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Select value={props.statusFilter} onValueChange={props.setStatusFilter}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Statuts actifs</SelectItem>{(["todo", "in_progress", "waiting"] as OperationStatus[]).map((value) => <SelectItem key={value} value={value}>{operationStatusLabels[value]}</SelectItem>)}</SelectContent></Select><Select value={props.categoryFilter} onValueChange={props.setCategoryFilter}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Toutes catégories</SelectItem>{props.categories.map((value) => <SelectItem key={value} value={value}>{operationCategoryLabels[value] || value}</SelectItem>)}</SelectContent></Select><Select value={props.tripFilter} onValueChange={props.setTripFilter}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Tous voyages</SelectItem><SelectItem value="none">Sans voyage</SelectItem>{props.trips.map((trip) => <SelectItem key={trip.id} value={trip.id}>{trip.title}</SelectItem>)}</SelectContent></Select><Select value={props.assigneeFilter} onValueChange={props.setAssigneeFilter}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Tous responsables</SelectItem>{props.currentUserId && <SelectItem value="mine">Moi</SelectItem>}<SelectItem value="unassigned">Non assigné</SelectItem>{props.staff.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}</SelectContent></Select></>; }
function FiltersSheet({ open, onOpenChange, groupView, setGroupView, filterProps, categories, trips, staff, currentUserId }: { open: boolean; onOpenChange: (open: boolean) => void; groupView: OperationGroupView; setGroupView: (value: OperationGroupView) => void; filterProps: FilterProps; categories: string[]; trips: any[]; staff: StaffMember[]; currentUserId?: string }) { const overlay = useOverlayHistory(open, () => onOpenChange(false), "operations-filters"); return <Sheet open={open} onOpenChange={overlay.handleOpenChange}><SheetContent side="bottom" className="max-h-[90dvh] rounded-t-3xl p-0 [&>button:last-child]:hidden"><SheetHeader className="border-b px-4 pb-4 pt-4 text-left"><div className="flex items-center justify-between"><AdminOverlayCloseButton onClick={() => overlay.requestClose()} /><SheetTitle>Filtres</SheetTitle></div><SheetDescription>Affiner et regrouper les tâches opérationnelles.</SheetDescription></SheetHeader><div className="grid gap-3 overflow-y-auto px-4 py-4 pb-[calc(2rem+env(safe-area-inset-bottom))]"><Select value={groupView} onValueChange={(value) => setGroupView(value as OperationGroupView)}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(groupLabels).map(([value, label]) => <SelectItem key={value} value={value}>Vue : {label}</SelectItem>)}</SelectContent></Select><TaskFilters {...filterProps} categories={categories} trips={trips} staff={staff} currentUserId={currentUserId} /><Button className="min-h-11" onClick={() => overlay.requestClose()}>Afficher les résultats</Button></div></SheetContent></Sheet>; }

function SourceErrors({ sources }: { sources: SourceStatus[] }) { return <details className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"><summary className="cursor-pointer font-medium">{sources.length} source{sources.length > 1 ? "s" : ""} indisponible{sources.length > 1 ? "s" : ""}</summary><ul className="mt-2 space-y-1 text-xs">{sources.map((source) => <li key={source.key}>{source.key} : {source.message}</li>)}</ul></details>; }

function BulkActionBar({ tasks, staff, saving, onClear, onStatus, onAssign }: { tasks: NormalizedOperationTask[]; staff: StaffMember[]; saving: boolean; onClear: () => void; onStatus: (status: OperationStatus) => void; onAssign: (assignedTo: string | null) => void }) { const statusSupported = tasksSupportMutation(tasks, "status"); const assignSupported = tasksSupportMutation(tasks, "assign"); return <div className="fixed inset-x-3 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-40 rounded-2xl border bg-background p-3 shadow-2xl md:inset-x-auto md:bottom-5 md:left-1/2 md:w-auto md:min-w-[680px] md:-translate-x-1/2"><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={onClear} className="min-h-11 rounded-lg px-2 text-sm font-semibold hover:bg-muted">{tasks.length} sélectionnée{tasks.length > 1 ? "s" : ""} ×</button><div className="ml-auto flex flex-wrap gap-2"><Button size="sm" className="min-h-11 bg-emerald-700 hover:bg-emerald-800" disabled={!statusSupported || saving} onClick={() => onStatus("completed")}>Terminer</Button><Button size="sm" variant="outline" className="min-h-11" disabled={!statusSupported || saving} onClick={() => onStatus("in_progress")}>En cours</Button><Button size="sm" variant="outline" className="hidden min-h-11 sm:inline-flex" disabled={!statusSupported || saving} onClick={() => onStatus("waiting")}>En attente</Button><DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="outline" className="h-11 w-11" aria-label="Actions groupées"><MoreHorizontal className="h-5 w-5" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{assignSupported && <><DropdownMenuItem onClick={() => onAssign(null)}>Ne pas assigner</DropdownMenuItem>{staff.map((member) => <DropdownMenuItem key={member.id} onClick={() => onAssign(member.id)}>Assigner à {member.name}</DropdownMenuItem>)}</>}<DropdownMenuItem className="text-destructive" disabled={!statusSupported} onClick={() => confirm(`Annuler ${tasks.length} tâche(s) ?`) && onStatus("cancelled")}>Annuler les tâches</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></div></div>; }
function BusinessAlertCard({ alert, onBookingQuickView }: { alert: BusinessAlert; onBookingQuickView: (bookingId: string) => void }) { const Icon = alertIcons[alert.source]; return <Card className="rounded-2xl shadow-sm"><CardContent className="p-4"><div className="flex items-start gap-3"><span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", alert.severity === "critical" ? "bg-red-50 text-red-700" : alert.severity === "high" ? "bg-orange-50 text-orange-700" : "bg-sky-50 text-sky-700")}><Icon className="h-5 w-5" /></span><div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{alertLabels[alert.source]}</p><h3 className="mt-1 text-sm font-semibold">{alert.title}</h3>{alert.context && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{alert.context}</p>}</div></div>{alert.missing?.length ? <p className="mt-3 text-sm"><span className="font-medium">À traiter :</span> {alert.missing.join(" · ")}</p> : null}<div className="mt-4 flex gap-2">{alert.bookingId && <Button variant="outline" size="sm" className="min-h-11 flex-1" onClick={() => onBookingQuickView(alert.bookingId!)}>Aperçu</Button>}<Button asChild size="sm" className="min-h-11 flex-1"><Link to={alert.href}>Ouvrir <ArrowRight className="h-4 w-4" /></Link></Button></div></CardContent></Card>; }
function AlertSummary({ counts, onOpen, active = "all", expanded = false }: { counts: Record<BusinessAlertSource, number>; onOpen: (source: BusinessAlertSource) => void; active?: BusinessAlertSource | "all"; expanded?: boolean }) { return <section className={cn("rounded-2xl border bg-card p-4 shadow-sm", expanded && "shadow-none")}><h2 className="font-display text-lg font-semibold">Alertes métier</h2><div className={cn("mt-3 grid gap-2", expanded ? "grid-cols-2 sm:grid-cols-4 xl:grid-cols-8" : "grid-cols-2")}>{(Object.keys(alertLabels) as BusinessAlertSource[]).map((source) => { const Icon = alertIcons[source]; return <button key={source} type="button" onClick={() => onOpen(source)} className={cn("flex min-h-11 items-center gap-2 rounded-xl border px-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active === source && "border-foreground bg-muted")}><Icon className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-xs font-medium">{alertLabels[source]}</span><strong className="text-sm tabular-nums">{counts[source] || 0}</strong></button>; })}</div></section>; }
function UpcomingTrips({ trips, tasks }: { trips: any[]; tasks: NormalizedOperationTask[] }) { return <section className="rounded-2xl border bg-card p-4 shadow-sm"><div className="flex items-center justify-between"><h2 className="font-display text-lg font-semibold">Prochains départs</h2><CalendarClock className="h-5 w-5 text-muted-foreground" /></div><div className="mt-3 space-y-2">{trips.slice(0, 5).map((trip) => { const related = tasks.filter((task) => task.tripId === trip.id); const critical = related.filter((task) => task.priority === "critical").length; return <Link key={trip.id} to={tripWorkspacePath(trip.id, "operations")} className="block rounded-xl border p-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{trip.title}</p><p className="mt-1 text-xs text-muted-foreground">{fmtDate(trip.start_date)} · {departureLabel(trip.start_date)}</p></div><ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" /></div><p className="mt-2 text-xs text-muted-foreground">{related.length} tâche{related.length !== 1 ? "s" : ""} active{related.length !== 1 ? "s" : ""}{critical ? ` · ${critical} critique${critical > 1 ? "s" : ""}` : ""}</p></Link>; })}{!trips.length && <p className="py-4 text-center text-sm text-muted-foreground">Aucun départ à venir.</p>}</div></section>; }
function EmptyTasks({ filtered }: { filtered: boolean }) { return <div className="rounded-2xl border border-dashed p-10 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" /><p className="mt-3 font-medium">{filtered ? "Aucune tâche pour ces filtres" : "Aucune tâche active"}</p><p className="mt-1 text-sm text-muted-foreground">Modifiez les filtres ou actualisez les données.</p></div>; }
function TaskSkeleton() { return <div className="space-y-3">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-32 animate-pulse rounded-2xl border bg-muted/40" />)}</div>; }
function departureLabel(value: string) { const today = new Date(); today.setHours(0, 0, 0, 0); const departure = new Date(`${value.slice(0, 10)}T00:00:00`); const days = Math.ceil((departure.getTime() - today.getTime()) / 86_400_000); if (days === 0) return "Aujourd’hui"; if (days === 1) return "Demain"; return `J-${days}`; }
function alertSeverityRank(value: BusinessAlert["severity"]) { return value === "critical" ? 0 : value === "high" ? 1 : 2; }
function toLocalDateTimeInput(value: string) { const date = new Date(value); const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }
function historyLabel(entry: any) { if (entry.new_status) return `${operationStatusLabels[entry.old_status as OperationStatus] || entry.old_status || "Statut"} → ${operationStatusLabels[entry.new_status as OperationStatus] || entry.new_status}`; return entry.event_type || entry.action || "Mise à jour"; }
function activeAdvancedFilterCount(filters: { priorityFilter: string; statusFilter: string; categoryFilter: string; tripFilter: string; assigneeFilter: string }) { return Number(filters.priorityFilter !== "all") + Number(filters.statusFilter !== "active") + Number(filters.categoryFilter !== "all") + Number(filters.tripFilter !== "all") + Number(filters.assigneeFilter !== "all"); }
