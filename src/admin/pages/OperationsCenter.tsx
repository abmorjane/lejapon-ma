import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileWarning,
  Hotel,
  ListChecks,
  Plane,
  RefreshCw,
  Search,
  ShieldCheck,
  Train,
  UserRoundCheck,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/admin/components/PageHeader";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Severity = "critical" | "high" | "medium" | "low" | "success";

type OpsItem = {
  id: string;
  section: string;
  title: string;
  subtitle?: string;
  status?: string;
  href: string;
  severity: Severity;
  dueAt?: string | null;
  source: string;
  progress?: number;
};

type SourceStatus = {
  key: string;
  ok: boolean;
  message?: string;
};

type OpsState = {
  flights: OpsItem[];
  visaActions: OpsItem[];
  missingPassports: OpsItem[];
  hotelsPending: OpsItem[];
  guidesPending: OpsItem[];
  transportPending: OpsItem[];
  supplierQuotesPending: OpsItem[];
  agencyFitPending: OpsItem[];
  urgentTasks: OpsItem[];
  overdueTasks: OpsItem[];
  trips: any[];
  sourceStatuses: SourceStatus[];
};

const emptyState: OpsState = {
  flights: [],
  visaActions: [],
  missingPassports: [],
  hotelsPending: [],
  guidesPending: [],
  transportPending: [],
  supplierQuotesPending: [],
  agencyFitPending: [],
  urgentTasks: [],
  overdueTasks: [],
  trips: [],
  sourceStatuses: [],
};

const severityRank: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  success: 1,
};

const severityClasses: Record<Severity, string> = {
  critical: "border-red-200 bg-red-50 text-red-900",
  high: "border-orange-200 bg-orange-50 text-orange-900",
  medium: "border-sky-200 bg-sky-50 text-sky-900",
  low: "border-slate-200 bg-slate-50 text-slate-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
};

const sourceLabels: Record<string, string> = {
  flights: "Vols",
  visa: "Visa",
  passports: "Passeports",
  hotels: "Hôtels",
  guides: "Guides",
  transport: "Transport",
  suppliers: "Fournisseurs",
  agency_fit: "Agency FIT",
  tasks: "Tâches",
  trips: "Départs",
};

const pendingStatuses = new Set(["todo", "pending", "issue", "draft", "in_progress", "submitted", "revision_requested", "ready_for_japan_office"]);
const closedVisaStatuses = new Set(["approved", "accepted", "completed", "rejected", "cancelled", "archived"]);
const closedAgencyFitStatuses = new Set(["accepted", "converted_to_booking", "cancelled", "archived"]);

const isMissingTable = (error: any) => /schema cache|does not exist|Could not find the table|relation .* does not exist/i.test(error?.message ?? "");

const safeText = (...values: unknown[]) => values.map((value) => String(value ?? "").trim()).filter(Boolean).join(" · ");

const isOverdue = (value?: string | null) => Boolean(value && new Date(value).getTime() < Date.now());

const daysUntil = (dateValue?: string | null) => {
  if (!dateValue) return Number.POSITIVE_INFINITY;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateValue);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
};

const toOpsError = (key: string, error: any): SourceStatus => ({
  key,
  ok: false,
  message: isMissingTable(error) ? "Migration ou table absente en production." : error?.message ?? "Chargement impossible.",
});

async function runSource<T>(key: string, fn: () => Promise<{ data: T[] | null; error: any }>) {
  const result = await fn();
  if (result.error) return { rows: [] as T[], status: toOpsError(key, result.error) };
  return { rows: result.data ?? [], status: { key, ok: true } as SourceStatus };
}

async function loadBookingContext(bookingIds: string[]) {
  if (bookingIds.length === 0) return new Map<string, any>();
  const { data } = await (supabase as any)
    .from("bookings")
    .select("id,reference,contact_name,contact_email,status,trip_id,trips(id,title,start_date,end_date)")
    .in("id", Array.from(new Set(bookingIds)))
    .limit(300);
  return new Map((data ?? []).map((booking: any) => [booking.id, booking]));
}

const sectionConfig = [
  { key: "flights", title: "Flights to reserve", icon: Plane, href: "/admin/bookings", tone: "text-orange-700", description: "Vols non finalisés après paiement." },
  { key: "visaActions", title: "Visa actions", icon: ShieldCheck, href: "/admin/visa", tone: "text-sky-700", description: "Demandes visa nécessitant une action." },
  { key: "missingPassports", title: "Missing passports", icon: FileWarning, href: "/admin/bookings", tone: "text-red-700", description: "Voyageurs sans numéro de passeport." },
  { key: "hotelsPending", title: "Hotels pending", icon: Hotel, href: "/supplier/trips", tone: "text-orange-700", description: "Lignes hôtels fournisseur à confirmer." },
  { key: "guidesPending", title: "Guides pending", icon: UserRoundCheck, href: "/supplier/trips", tone: "text-orange-700", description: "Guides non confirmés." },
  { key: "transportPending", title: "Transport pending", icon: Train, href: "/supplier/trips", tone: "text-orange-700", description: "Transport fournisseur non confirmé." },
  { key: "supplierQuotesPending", title: "Supplier quotes pending", icon: Building2, href: "/admin/supplier-costs", tone: "text-amber-700", description: "Devis fournisseurs en préparation." },
  { key: "agencyFitPending", title: "Agency FIT pending", icon: BriefcaseBusiness, href: "/admin/agency-fit-requests", tone: "text-indigo-700", description: "Demandes FIT agence ouvertes." },
] as const;

export default function OperationsCenter() {
  const [state, setState] = useState<OpsState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [query, setQuery] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [
        flightResult,
        visaResult,
        participantResult,
        supplierQuoteResult,
        hotelRowsResult,
        guideRowsResult,
        transportRowsResult,
        agencyFitResult,
        tasksResult,
        checklistItemsResult,
        tripsResult,
      ] = await Promise.all([
        runSource<any>("booking_flight_reservations", () => (supabase as any)
          .from("booking_flight_reservations")
          .select("id,booking_id,status,pnr,airline,flight_number,departure_at,return_at,segments,ticket_document_id,ticket_storage_path,ticket_sent_to_customer,required_traveler_count,linked_traveler_count,updated_at")
          .neq("status", "ticket_sent")
          .neq("status", "cancelled")
          .order("updated_at", { ascending: true })
          .limit(120)),
        runSource<any>("visa_applications", () => (supabase as any)
          .from("visa_applications")
          .select("id,reference,status,surname,given_names,passport_no,residential_email,submitted_at,created_at")
          .order("created_at", { ascending: false })
          .limit(160)),
        runSource<any>("booking_participants", () => (supabase as any)
          .from("booking_participants")
          .select("id,booking_id,first_name,last_name,email,passport_no,created_at")
          .order("created_at", { ascending: false })
          .limit(220)),
        runSource<any>("supplier_trip_quotes", () => (supabase as any)
          .from("supplier_trip_quotes")
          .select("id,trip_id,supplier_id,status,validation_status,updated_at,trips(id,title,start_date,end_date)")
          .order("updated_at", { ascending: false })
          .limit(120)),
        runSource<any>("supplier_quote_hotel_rows", () => (supabase as any)
          .from("supplier_quote_hotel_rows")
          .select("id,quote_id,status,city,hotel_name,name,day_number,sort_order")
          .neq("status", "confirmed")
          .limit(160)),
        runSource<any>("supplier_quote_guide_rows", () => (supabase as any)
          .from("supplier_quote_guide_rows")
          .select("id,quote_id,status,city,guide_language,language,day_number,sort_order")
          .neq("status", "confirmed")
          .limit(160)),
        runSource<any>("supplier_quote_transport_rows", () => (supabase as any)
          .from("supplier_quote_transport_rows")
          .select("id,quote_id,status,city,route,transport_type,name,day_number,sort_order")
          .neq("status", "confirmed")
          .limit(160)),
        runSource<any>("agency_fit_requests", () => (supabase as any)
          .from("agency_fit_requests")
          .select("id,status,client_full_name,client_name,destination_country,destination,desired_departure_date,travel_start_date,created_at,updated_at")
          .order("updated_at", { ascending: false })
          .limit(120)),
        runSource<any>("operation_tasks", () => (supabase as any)
          .from("operation_tasks")
          .select("id,title,description,priority,status,booking_id,trip_id,visa_application_id,deadline,created_at,updated_at")
          .not("status", "in", "(completed,cancelled)")
          .order("deadline", { ascending: true, nullsFirst: false })
          .limit(180)),
        runSource<any>("operation_checklist_items", () => (supabase as any)
          .from("operation_checklist_items")
          .select("id,title,category,priority,status,deadline,completed_at,operation_checklists(id,title,booking_id,trip_id,visa_application_id,customer_id,client_id,progress_percent)")
          .not("status", "in", "(completed,cancelled)")
          .order("deadline", { ascending: true, nullsFirst: false })
          .limit(180)),
        runSource<any>("trips", () => (supabase as any)
          .from("trips")
          .select("id,title,start_date,end_date,status")
          .gte("start_date", new Date().toISOString().slice(0, 10))
          .order("start_date", { ascending: true })
          .limit(120)),
      ]);

      const bookingIds = [
        ...flightResult.rows.map((row: any) => row.booking_id),
        ...participantResult.rows.map((row: any) => row.booking_id),
        ...tasksResult.rows.map((row: any) => row.booking_id),
        ...checklistItemsResult.rows.map((row: any) => row.operation_checklists?.booking_id),
      ].filter(Boolean);
      const bookingMap = await loadBookingContext(bookingIds);

      const quoteMap = new Map((supplierQuoteResult.rows ?? []).map((quote: any) => [quote.id, quote]));
      const sourceStatuses = [
        flightResult.status,
        visaResult.status,
        participantResult.status,
        supplierQuoteResult.status,
        hotelRowsResult.status,
        guideRowsResult.status,
        transportRowsResult.status,
        agencyFitResult.status,
        tasksResult.status,
        checklistItemsResult.status,
        tripsResult.status,
      ];

      const flights = flightResult.rows.map((row: any): OpsItem => {
        const booking = bookingMap.get(row.booking_id);
        const missing = [
          !row.pnr && "PNR",
          !row.airline && "compagnie",
          !row.flight_number && "vol",
          (!Array.isArray(row.segments) || row.segments.length === 0) && "segments",
          Number(row.linked_traveler_count || 0) < Number(row.required_traveler_count || 0) && "voyageurs",
          (!row.ticket_document_id && !row.ticket_storage_path) && "PDF",
          row.ticket_sent_to_customer !== true && "envoi client",
        ].filter(Boolean).join(", ");
        return {
          id: row.id,
          section: "Flights to reserve",
          title: booking?.reference ? `${booking.reference} · ${booking.contact_name}` : "Vol à réserver",
          subtitle: safeText(booking?.trips?.title, missing ? `Manquant: ${missing}` : "Prêt à finaliser"),
          status: row.status,
          href: row.booking_id ? `/admin/bookings/${row.booking_id}` : "/admin/bookings",
          severity: missing ? "high" : "medium",
          dueAt: row.updated_at,
          source: "flights",
          progress: row.status === "booked" ? 65 : 25,
        };
      });

      const visaActions = visaResult.rows
        .filter((row: any) => !closedVisaStatuses.has(String(row.status || "").toLowerCase()))
        .map((row: any): OpsItem => ({
          id: row.id,
          section: "Visa actions",
          title: `${row.reference || "Visa"} · ${safeText(row.given_names, row.surname) || row.residential_email || "Client visa"}`,
          subtitle: row.passport_no ? "Passeport renseigné" : "Passeport à vérifier",
          status: row.status,
          href: `/admin/visa/${row.id}`,
          severity: row.passport_no ? "medium" : "high",
          dueAt: row.submitted_at || row.created_at,
          source: "visa",
          progress: row.passport_no ? 55 : 35,
        }));

      const missingPassports = participantResult.rows
        .filter((row: any) => !String(row.passport_no || "").trim())
        .map((row: any): OpsItem => {
          const booking = bookingMap.get(row.booking_id);
          return {
            id: row.id,
            section: "Missing passports",
            title: safeText(row.first_name, row.last_name) || row.email || "Voyageur sans passeport",
            subtitle: safeText(booking?.reference, booking?.contact_name, booking?.trips?.title),
            status: "missing_passport",
            href: row.booking_id ? `/admin/bookings/${row.booking_id}` : "/admin/bookings",
            severity: "high",
            source: "passports",
            progress: 20,
          };
        });

      const supplierRowToItem = (row: any, section: "hotels" | "guides" | "transport"): OpsItem => {
        const quote = quoteMap.get(row.quote_id);
        const label = section === "hotels"
          ? row.hotel_name || row.name || "Hôtel à confirmer"
          : section === "guides"
            ? row.guide_language || row.language || "Guide à confirmer"
            : row.route || row.transport_type || row.name || "Transport à confirmer";
        return {
          id: row.id,
          section: sourceLabels[section],
          title: String(label),
          subtitle: safeText(quote?.trips?.title, row.city, row.day_number ? `Jour ${row.day_number}` : ""),
          status: row.status,
          href: quote?.trip_id ? `/supplier/trips/${quote.trip_id}/quote` : "/admin/supplier-costs",
          severity: row.status === "issue" ? "critical" : "medium",
          source: section,
          progress: row.status === "pending" ? 50 : row.status === "issue" ? 10 : 25,
        };
      };

      const hotelsPending = hotelRowsResult.rows.filter((row: any) => pendingStatuses.has(row.status)).map((row: any) => supplierRowToItem(row, "hotels"));
      const guidesPending = guideRowsResult.rows.filter((row: any) => pendingStatuses.has(row.status)).map((row: any) => supplierRowToItem(row, "guides"));
      const transportPending = transportRowsResult.rows.filter((row: any) => pendingStatuses.has(row.status)).map((row: any) => supplierRowToItem(row, "transport"));

      const supplierQuotesPending = supplierQuoteResult.rows
        .filter((row: any) => {
          const status = String(row.validation_status || row.status || "").toLowerCase();
          return !["japan_office_confirmed", "ready_to_travel", "approved", "reviewed"].includes(status);
        })
        .map((row: any): OpsItem => ({
          id: row.id,
          section: "Supplier quotes pending",
          title: row.trips?.title || "Devis fournisseur",
          subtitle: safeText(row.status, row.validation_status, row.trips?.start_date ? `Départ ${fmtDate(row.trips.start_date)}` : ""),
          status: row.validation_status || row.status,
          href: row.trip_id ? `/supplier/trips/${row.trip_id}/quote` : "/admin/supplier-costs",
          severity: ["draft", "in_progress"].includes(row.validation_status) ? "medium" : "high",
          dueAt: row.updated_at,
          source: "suppliers",
          progress: row.validation_status === "ready_for_japan_office" ? 75 : 40,
        }));

      const agencyFitPending = agencyFitResult.rows
        .filter((row: any) => !closedAgencyFitStatuses.has(String(row.status || "").toLowerCase()))
        .map((row: any): OpsItem => ({
          id: row.id,
          section: "Agency FIT pending",
          title: row.client_full_name || row.client_name || "Demande FIT agence",
          subtitle: safeText(row.destination_country || row.destination, row.desired_departure_date || row.travel_start_date),
          status: row.status,
          href: "/admin/agency-fit-requests",
          severity: ["submitted", "new", "under_review"].includes(String(row.status)) ? "high" : "medium",
          dueAt: row.updated_at || row.created_at,
          source: "agency_fit",
          progress: row.status === "quoted" ? 80 : 35,
        }));

      const taskItems = [
        ...tasksResult.rows.map((row: any): OpsItem => ({
          id: row.id,
          section: "Urgent tasks",
          title: row.title,
          subtitle: row.description,
          status: row.status,
          href: row.booking_id ? `/admin/bookings/${row.booking_id}` : row.visa_application_id ? `/admin/visa/${row.visa_application_id}` : "/admin/operations-center",
          severity: row.priority === "critical" ? "critical" : row.priority === "high" ? "high" : "medium",
          dueAt: row.deadline,
          source: "tasks",
          progress: row.status === "in_progress" ? 45 : 15,
        })),
        ...checklistItemsResult.rows.map((row: any): OpsItem => ({
          id: row.id,
          section: "Urgent tasks",
          title: row.title,
          subtitle: safeText(row.category, row.operation_checklists?.title),
          status: row.status,
          href: row.operation_checklists?.booking_id
            ? `/admin/bookings/${row.operation_checklists.booking_id}`
            : row.operation_checklists?.visa_application_id
              ? `/admin/visa/${row.operation_checklists.visa_application_id}`
              : "/admin/operations-center",
          severity: row.priority === "critical" ? "critical" : row.priority === "high" ? "high" : "medium",
          dueAt: row.deadline,
          source: "tasks",
          progress: Number(row.operation_checklists?.progress_percent || 0),
        })),
      ];
      const urgentTasks = taskItems.filter((item) => item.severity === "critical" || item.severity === "high").sort(sortItems).slice(0, 80);
      const overdueTasks = taskItems.filter((item) => isOverdue(item.dueAt)).sort(sortItems).slice(0, 80);

      setState({
        flights,
        visaActions,
        missingPassports,
        hotelsPending,
        guidesPending,
        transportPending,
        supplierQuotesPending,
        agencyFitPending,
        urgentTasks,
        overdueTasks,
        trips: tripsResult.rows,
        sourceStatuses,
      });
    } catch (error: any) {
      toast.error(error?.message ?? "Impossible de charger le dashboard opérations.");
      setState(emptyState);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const allItems = useMemo(
    () => [
      ...state.flights,
      ...state.visaActions,
      ...state.missingPassports,
      ...state.hotelsPending,
      ...state.guidesPending,
      ...state.transportPending,
      ...state.supplierQuotesPending,
      ...state.agencyFitPending,
      ...state.urgentTasks,
      ...state.overdueTasks,
    ].sort(sortItems),
    [state]
  );

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allItems.filter((item) => {
      const severityOk = severityFilter === "all" || item.severity === severityFilter;
      const sourceOk = sourceFilter === "all" || item.source === sourceFilter;
      const queryOk = !q || `${item.title} ${item.subtitle ?? ""} ${item.status ?? ""}`.toLowerCase().includes(q);
      return severityOk && sourceOk && queryOk;
    });
  }, [allItems, query, severityFilter, sourceFilter]);

  const kpis = useMemo(() => {
    const activeCount = state.flights.length + state.visaActions.length + state.missingPassports.length + state.hotelsPending.length
      + state.guidesPending.length + state.transportPending.length + state.supplierQuotesPending.length + state.agencyFitPending.length;
    const criticalCount = allItems.filter((item) => item.severity === "critical").length;
    const highCount = allItems.filter((item) => item.severity === "high").length;
    const overdueCount = state.overdueTasks.length;
    const avgProgress = Math.round(allItems.reduce((acc, item) => acc + Number(item.progress || 0), 0) / Math.max(allItems.length, 1));
    return { activeCount, criticalCount, highCount, overdueCount, avgProgress };
  }, [allItems, state]);

  const tripWindows = useMemo(() => buildTripWindows(state.trips), [state.trips]);
  const failedSources = state.sourceStatuses.filter((source) => !source.ok);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Executive Operations Dashboard"
        description="Pilotage consolidé des vols, visas, passeports, fournisseurs, demandes FIT et départs proches."
        action={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/admin/bookings"><CalendarClock className="h-4 w-4" /> Réservations</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/admin/visa"><ShieldCheck className="h-4 w-4" /> Visa</Link>
            </Button>
            <Button onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              Actualiser
            </Button>
          </div>
        }
      />

      {failedSources.length > 0 && (
        <Card className="border-amber-200 bg-amber-50 shadow-sm">
          <CardContent className="flex flex-col gap-2 p-4 text-sm text-amber-950 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-semibold">Audit données incomplet</p>
              <p className="text-xs">{failedSources.map((source) => `${source.key}: ${source.message}`).join(" · ")}</p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold">{failedSources.length} source(s)</span>
          </CardContent>
        </Card>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard icon={ListChecks} label="Actions actives" value={kpis.activeCount} tone="text-slate-900" />
        <KpiCard icon={AlertTriangle} label="Critical alerts" value={kpis.criticalCount} tone="text-red-700" />
        <KpiCard icon={Clock} label="Overdue tasks" value={kpis.overdueCount} tone="text-red-700" />
        <KpiCard icon={FileWarning} label="High priority" value={kpis.highCount} tone="text-orange-700" />
        <KpiCard icon={CheckCircle2} label="Progression moyenne" value={`${kpis.avgProgress}%`} tone="text-emerald-700" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="rounded-xl shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Operations pulse</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {sectionConfig.map((section) => {
              const items = state[section.key] as OpsItem[];
              const pct = Math.min(100, Math.round((items.length / Math.max(kpis.activeCount, 1)) * 100));
              const Icon = section.icon;
              return (
                <Link
                  key={section.key}
                  to={section.href}
                  className="block rounded-lg border border-border p-3 transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Icon className={cn("h-5 w-5 shrink-0", section.tone)} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{section.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{section.description}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-display text-xl">{items.length}</p>
                      <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                  <Progress value={pct} className="mt-3 h-1.5" />
                </Link>
              );
            })}
          </CardContent>
        </Card>

        <Card className="rounded-xl shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Trips leaving in</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {tripWindows.map((window) => (
              <Link key={window.label} to="/admin/trips" className="block rounded-lg border border-border p-3 transition-colors hover:bg-muted/50">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium">{window.label}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", window.count > 0 ? "bg-orange-50 text-orange-800" : "bg-slate-100 text-slate-600")}>
                    {window.count}
                  </span>
                </div>
                <Progress value={window.progress} className="h-1.5" />
                {window.nextTrip && <p className="mt-2 truncate text-xs text-muted-foreground">Prochain: {window.nextTrip.title} · {fmtDate(window.nextTrip.start_date)}</p>}
              </Link>
            ))}
          </CardContent>
        </Card>
      </section>

      <Card className="rounded-xl shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <CardTitle className="text-lg">Critical alerts & quick actions</CardTitle>
            <div className="grid gap-2 sm:grid-cols-[1fr_180px_180px] xl:w-[760px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher une action, client, voyage..." className="pl-9" />
              </div>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes sources</SelectItem>
                  {Object.entries(sourceLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={severityFilter} onValueChange={setSeverityFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes priorités</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 lg:grid-cols-2">
            {loading && Array.from({ length: 6 }).map((_, index) => <SkeletonAlert key={index} />)}
            {!loading && filteredItems.length === 0 && (
              <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground lg:col-span-2">
                Aucune alerte ne correspond aux filtres.
              </div>
            )}
            {!loading && filteredItems.slice(0, 80).map((item) => <OpsAlertCard key={`${item.source}-${item.id}-${item.section}`} item={item} />)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function sortItems(a: OpsItem, b: OpsItem) {
  const severityDiff = severityRank[b.severity] - severityRank[a.severity];
  if (severityDiff) return severityDiff;
  const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
  const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
  return aDue - bDue || a.title.localeCompare(b.title);
}

function buildTripWindows(trips: any[]) {
  const windows = [
    { label: "30 days", max: 30 },
    { label: "15 days", max: 15 },
    { label: "7 days", max: 7 },
    { label: "3 days", max: 3 },
    { label: "Tomorrow", max: 1 },
  ];
  const maxCount = Math.max(1, ...windows.map((window) => trips.filter((trip) => {
    const days = daysUntil(trip.start_date);
    return days >= 0 && days <= window.max;
  }).length));

  return windows.map((window) => {
    const matching = trips
      .filter((trip) => {
        const days = daysUntil(trip.start_date);
        return days >= 0 && days <= window.max;
      })
      .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
    return {
      ...window,
      count: matching.length,
      progress: Math.round((matching.length / maxCount) * 100),
      nextTrip: matching[0],
    };
  });
}

function KpiCard({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string | number; tone: string }) {
  return (
    <Card className="rounded-xl shadow-sm">
      <CardContent className="p-4">
        <Icon className={cn("mb-3 h-5 w-5", tone)} />
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 font-display text-2xl">{value}</p>
      </CardContent>
    </Card>
  );
}

function OpsAlertCard({ item }: { item: OpsItem }) {
  return (
    <Link
      to={item.href}
      className={cn(
        "block rounded-xl border p-4 transition-colors hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-accent",
        severityClasses[item.severity]
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">{sourceLabels[item.source] ?? item.source}</span>
            {item.status && <span className="text-xs text-current/75">{item.status}</span>}
          </div>
          <h3 className="mt-2 truncate text-sm font-semibold">{item.title}</h3>
          {item.subtitle && <p className="mt-1 line-clamp-2 text-xs text-current/75">{item.subtitle}</p>}
        </div>
        <ArrowRight className="mt-1 h-4 w-4 shrink-0 opacity-70" />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Progress value={item.progress ?? 0} className="h-1.5 bg-white/60" />
        </div>
        <span className="shrink-0 text-[11px] text-current/70">{item.dueAt ? (isOverdue(item.dueAt) ? `Retard · ${fmtDateTime(item.dueAt)}` : fmtDateTime(item.dueAt)) : "Action"}</span>
      </div>
    </Link>
  );
}

function SkeletonAlert() {
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="h-3 w-24 rounded bg-muted" />
      <div className="mt-3 h-4 w-2/3 rounded bg-muted" />
      <div className="mt-2 h-3 w-full rounded bg-muted" />
      <div className="mt-4 h-1.5 w-full rounded bg-muted" />
    </div>
  );
}
