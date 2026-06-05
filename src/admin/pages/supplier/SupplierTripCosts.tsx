import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowDown, ArrowLeft, ArrowUp, Download, MessageSquare, Plane, Plus, Save, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "../../components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { fmtDate } from "@/lib/format";

const db = supabase as any;

type QuoteStatus = "draft" | "submitted" | "reviewed" | "approved" | "revision_requested";
type RowStatus = "todo" | "pending" | "confirmed" | "issue";
type QuoteSection = "hotels" | "transport" | "activities" | "guides" | "other";

type QuoteRow = {
  id?: string;
  local_id: string;
  sort_order: number;
  status: RowStatus;
  assigned_to?: string | null;
  comment?: string | null;
  [key: string]: any;
};

type DayOperationalStatus = "to_confirm" | "confirmed" | "attention" | "modified";

type DayComment = {
  id: string;
  day_number: number;
  body: string;
  author_id: string | null;
  author_email: string | null;
  author_name: string;
  source: "maroc" | "japan_office" | "admin";
  created_at: string;
  updated_at?: string | null;
};

type OperationalState = {
  day_statuses: Record<string, DayOperationalStatus>;
  day_comments: Record<string, DayComment[]>;
  legacy_notes?: string | null;
};

const tableBySection: Record<QuoteSection, string> = {
  hotels: "supplier_quote_hotel_rows",
  transport: "supplier_quote_transport_rows",
  activities: "supplier_quote_activity_rows",
  guides: "supplier_quote_guide_rows",
  other: "supplier_quote_other_rows",
};

const sectionLabels: Record<QuoteSection, string> = {
  hotels: "Hôtels",
  transport: "Transport",
  activities: "Visites / tickets / activités",
  guides: "Guides",
  other: "Autres coûts",
};

const quoteStatusLabel: Record<QuoteStatus, string> = {
  draft: "Brouillon",
  submitted: "Soumis",
  reviewed: "Revu",
  approved: "Approuvé",
  revision_requested: "Révision demandée",
};

const rowStatusLabel: Record<RowStatus, string> = {
  todo: "À faire",
  pending: "En attente",
  confirmed: "Confirmé",
  issue: "Problème",
};

const dayStatusLabel: Record<DayOperationalStatus, string> = {
  to_confirm: "À confirmer",
  confirmed: "Confirmé",
  attention: "Attention requise",
  modified: "Modifié",
};

const transportTypes = ["bus", "metro", "taxi", "train", "shinkansen", "boat", "other"];
const guideTypes = ["francophone", "anglophone", "japanese", "assistant", "other"];
const roomTypes = ["double/twin", "single", "triple", "TL"];

const DEFAULT_HOTEL_ROOM_TYPES = ["double/twin", "single", "triple", "TL"] as const;

const DEFAULT_REQUIRED_ACTIVITIES = [
  { day_number: 3, activity_name: "Team Lab Planet Tokyo", unit_price_jpy: 5600 },
  { day_number: 4, activity_name: "Kamakura Buddha", unit_price_jpy: 300 },
  { day_number: 5, activity_name: "Hakone Pirate Ship", unit_price_jpy: 2000 },
  { day_number: 6, activity_name: "Golden Pavilion", unit_price_jpy: 500 },
  { day_number: 6, activity_name: "Kiyomizudera Temple", unit_price_jpy: 500 },
  { day_number: 6, activity_name: "Ryoanji Temple", unit_price_jpy: 600 },
  { day_number: 6, activity_name: "Nijo-jo", unit_price_jpy: 1300 },
  { day_number: 9, activity_name: "Memorial Museum", unit_price_jpy: 200 },
  { day_number: 9, activity_name: "Ferry to Miyajima", unit_price_jpy: 200 },
  { day_number: 9, activity_name: "Hiroshima Tax", unit_price_jpy: 100 },
  { day_number: 10, activity_name: "Kaiyukan", unit_price_jpy: 3500 },
  { day_number: 10, activity_name: "Osaka Castle", unit_price_jpy: 1200 },
] as const;

const DEFAULT_OPTIONAL_ACTIVITIES = [
  { day_number: 7, activity_name: "Morning Meditation in Kyoto at Kounji", unit_price_jpy: 1000, aliases: ["meditation", "morning meditation", "kounji"] },
  { day_number: 7, activity_name: "Tea Ceremony in Kyoto", unit_price_jpy: 3500, aliases: ["tea ceremony", "ceremonie du the", "cérémonie du thé"] },
  { day_number: 7, activity_name: "Geisha Make Up in Kyoto", unit_price_jpy: 12000, aliases: ["geisha makeup", "geisha make up", "maquillage geisha"] },
  { day_number: 7, activity_name: "Maiko Dinner Experience", unit_price_jpy: 23925, aliases: ["maiko dinner", "geisha dinner", "maiko dinner experience"] },
  { day_number: 11, activity_name: "Universal Studios", unit_price_jpy: 10900, aliases: ["universal studio", "universal studios", "usj"] },
  { day_number: 13, activity_name: "Disney Sea/Land", unit_price_jpy: 10900, aliases: ["disney", "disneyland", "disney sea", "disney land"] },
] as const;

export default function SupplierTripCosts() {
  const { tripId } = useParams();
  const { user, roles } = useAuth();
  const [trip, setTrip] = useState<any>(null);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [supplierName, setSupplierName] = useState<string>("Japan office");
  const [quote, setQuote] = useState<any>(null);
  const [rows, setRows] = useState<Record<QuoteSection, QuoteRow[]>>({
    hotels: [],
    transport: [],
    activities: [],
    guides: [],
    other: [],
  });
  const [programmeDays, setProgrammeDays] = useState<any[]>([]);
  const [participants, setParticipants] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [hotels, setHotels] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [bookingExtras, setBookingExtras] = useState<any[]>([]);
  const [extrasList, setExtrasList] = useState<any[]>([]);
  const [participantActivitySelections, setParticipantActivitySelections] = useState<any[]>([]);
  const [sqlMissing, setSqlMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<QuoteStatus>("draft");
  const [commissionPct, setCommissionPct] = useState(10);
  const [exchangeRate, setExchangeRate] = useState(0.068);
  const [internalNotes, setInternalNotes] = useState("");
  const [operationalState, setOperationalState] = useState<OperationalState>({ day_statuses: {}, day_comments: {} });

  const isAdmin = roles.some((role) => ["super_admin", "admin"].includes(role));
  const canEdit = isAdmin || ["draft", "submitted", "revision_requested"].includes(status);

  useEffect(() => {
    void load();
  }, [tripId, user?.id]);

  const load = async () => {
    if (!tripId || !user) return;
    setSqlMissing(false);

    const { data: memberRows } = await db
      .from("supplier_members")
      .select("supplier_id,suppliers(name)")
      .eq("user_id", user.id)
      .limit(1);
    const member = memberRows?.[0];
    const currentSupplierId = member?.supplier_id ?? null;
    setSupplierId(currentSupplierId);
    setSupplierName(member?.suppliers?.name ?? (isAdmin ? "Japan office / admin" : "Japan office"));

    const { data: tripRow, error: tripError } = await db
      .from("trips")
      .select("*,programmes:programme_id(id,title,duration_days,duration,days)")
      .eq("id", tripId)
      .maybeSingle();
    if (tripError || !tripRow) {
      toast.error(tripError?.message ?? "Voyage introuvable.");
      return;
    }
    setTrip(tripRow);

    const [{ data: dayRows }, { data: bookingRows }, { data: hotelRows }, { data: extraRows }] = await Promise.all([
      tripRow.programme_id
        ? db.from("programme_days").select("*").eq("programme_id", tripRow.programme_id).order("day_number", { ascending: true }).order("sort_order", { ascending: true })
        : Promise.resolve({ data: [] }),
      db.from("bookings").select("id,reference,contact_name,contact_email,contact_phone,contact_city,num_adults,num_children,room_type,formula,status,source,agency_organization_id,special_requests,metadata,created_at").eq("trip_id", tripId),
      db.from("trip_hotels").select("*").eq("trip_id", tripId).order("sort_order", { ascending: true }),
      db.from("extras").select("*").eq("is_active", true).order("sort_order"),
    ]);

    const bookingIds = (bookingRows ?? []).map((booking: any) => booking.id);
    const hotelIds = (hotelRows ?? []).map((hotel: any) => hotel.id);

    const [{ data: participantRows }, { data: extrasRows }, { data: roomRows }] = await Promise.all([
      bookingIds.length
        ? db.from("booking_participants").select("*").in("booking_id", bookingIds)
        : Promise.resolve({ data: [] }),
      bookingIds.length
        ? db.from("booking_extras").select("*,extras(id,name,price_mad)").in("booking_id", bookingIds)
        : Promise.resolve({ data: [] }),
      hotelIds.length
        ? db.from("trip_rooms").select("*").in("trip_hotel_id", hotelIds)
        : Promise.resolve({ data: [] }),
    ]);

    let participantList = participantRows ?? [];
    const existingParticipantIds = new Set(participantList.map((participant: any) => participant.id));
    const { data: directParticipantRows } = await db.from("booking_participants").select("*").eq("trip_id", tripId);
    for (const participant of directParticipantRows ?? []) {
      if (participant?.id && !existingParticipantIds.has(participant.id)) {
        participantList.push(participant);
        existingParticipantIds.add(participant.id);
      }
    }

    const roomIds = (roomRows ?? []).map((room: any) => room.id);
    const participantIds = participantList.map((participant: any) => participant.id).filter(Boolean);
    const [{ data: assignmentRows }, { data: selectionRows }] = await Promise.all([
      roomIds.length
        ? db.from("room_assignments").select("*").in("room_id", roomIds)
        : Promise.resolve({ data: [] }),
      participantIds.length
        ? db.from("booking_participant_activities").select("*").in("participant_id", participantIds)
        : Promise.resolve({ data: [] }),
    ]);

    setProgrammeDays(normalizeProgrammeDays(dayRows ?? [], tripRow));
    setBookings(bookingRows ?? []);
    setParticipants(participantList);
    setBookingExtras(extrasRows ?? []);
    setExtrasList(extraRows ?? []);
    setHotels(hotelRows ?? []);
    setRooms(roomRows ?? []);
    setAssignments(assignmentRows ?? []);
    setParticipantActivitySelections(selectionRows ?? []);

    const loadedQuote = await loadQuote(tripId, currentSupplierId, isAdmin);
    if (loadedQuote) {
      setQuote(loadedQuote.quote);
      setStatus((loadedQuote.quote.status ?? "draft") as QuoteStatus);
      setCommissionPct(Number(loadedQuote.quote.commission_percentage ?? 10));
      setExchangeRate(Number(loadedQuote.quote.exchange_rate_jpy_mad ?? 0.068));
      setInternalNotes(loadedQuote.quote.internal_notes ?? "");
      setOperationalState(parseOperationalState(loadedQuote.quote.supplier_notes));
      setRows(loadedQuote.rows);
    } else {
      const initialRows = buildInitialRows({
        trip: tripRow,
        programmeDays: normalizeProgrammeDays(dayRows ?? [], tripRow),
        hotels: hotelRows ?? [],
        rooms: roomRows ?? [],
        bookings: bookingRows ?? [],
        participants: participantList,
        bookingExtras: extrasRows ?? [],
      });
      setQuote(null);
      setStatus("draft");
      setCommissionPct(10);
      setExchangeRate(0.068);
      setInternalNotes("");
      setOperationalState({ day_statuses: {}, day_comments: {} });
      setRows(initialRows);
    }
  };

  const loadQuote = async (tripId: string, currentSupplierId: string | null, admin: boolean) => {
    const query = db
      .from("supplier_trip_quotes")
      .select("*")
      .eq("trip_id", tripId)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(1);
    const { data: quoteRows, error } = currentSupplierId && !admin
      ? await query.eq("supplier_id", currentSupplierId)
      : await query;
    if (error) {
      if (isMissingTableError(error)) setSqlMissing(true);
      return null;
    }
    const quote = quoteRows?.[0];
    if (!quote?.id) return null;

    const sectionResults = await Promise.all((Object.keys(tableBySection) as QuoteSection[]).map(async (section) => {
      const { data, error } = await db
        .from(tableBySection[section])
        .select("*")
        .eq("quote_id", quote.id)
        .order("sort_order", { ascending: true });
      if (error && isMissingTableError(error)) setSqlMissing(true);
      return [section, normalizeRows(data ?? [])] as const;
    }));

    return {
      quote,
      rows: Object.fromEntries(sectionResults) as Record<QuoteSection, QuoteRow[]>,
    };
  };

  const totals = useMemo(() => {
    const sectionTotals = {
      hotels: rows.hotels.reduce((sum, row) => sum + subtotal(row), 0),
      transport: rows.transport.reduce((sum, row) => sum + subtotal(row), 0),
      activities: rows.activities.reduce((sum, row) => sum + subtotal(row), 0),
      guides: rows.guides.reduce((sum, row) => sum + subtotal(row), 0),
      other: rows.other.reduce((sum, row) => sum + subtotal(row), 0),
    };
    const grandTotalJpy = Object.values(sectionTotals).reduce((sum, value) => sum + value, 0);
    const commissionAmountJpy = grandTotalJpy * Number(commissionPct || 0) / 100;
    const finalTotalJpy = grandTotalJpy + commissionAmountJpy;
    const finalTotalMad = finalTotalJpy * Number(exchangeRate || 0);
    const participantCount = Math.max(1, participants.length || getParticipantCount([], bookings) || 1);
    return {
      ...sectionTotals,
      grandTotalJpy,
      commissionAmountJpy,
      finalTotalJpy,
      finalTotalMad,
      participantCount,
      costPerPersonJpy: finalTotalJpy / participantCount,
      costPerPersonMad: finalTotalMad / participantCount,
    };
  }, [bookings, commissionPct, exchangeRate, participants.length, rows]);

  const saveQuote = async (nextStatus = status) => {
    if (!tripId) return;
    if (sqlMissing) {
      toast.error("Migration SQL quote engine requise avant l'enregistrement.");
      return;
    }
    setBusy(true);
    try {
      const quotePayload = {
        trip_id: tripId,
        supplier_id: supplierId,
        status: nextStatus,
        commission_percentage: commissionPct,
        exchange_rate_jpy_mad: exchangeRate,
        participant_count: totals.participantCount,
        total_hotels_jpy: totals.hotels,
        total_transport_jpy: totals.transport,
        total_activities_jpy: totals.activities,
        total_guides_jpy: totals.guides,
        total_other_jpy: totals.other,
        grand_total_jpy: totals.grandTotalJpy,
        commission_amount_jpy: totals.commissionAmountJpy,
        final_total_jpy: totals.finalTotalJpy,
        final_total_mad: totals.finalTotalMad,
        cost_per_person_jpy: totals.costPerPersonJpy,
        cost_per_person_mad: totals.costPerPersonMad,
        supplier_notes: serializeOperationalState(operationalState),
        internal_notes: internalNotes || null,
        updated_by: user?.id ?? null,
      };

      const quoteResult = quote?.id
        ? await db.from("supplier_trip_quotes").update(quotePayload).eq("id", quote.id).select("*").maybeSingle()
        : await db.from("supplier_trip_quotes").insert({ ...quotePayload, created_by: user?.id ?? null }).select("*").maybeSingle();
      if (quoteResult.error) throw quoteResult.error;
      const savedQuote = quoteResult.data;
      if (!savedQuote?.id) throw new Error("Demande de devis non sauvegardée.");

      for (const section of Object.keys(tableBySection) as QuoteSection[]) {
        await db.from(tableBySection[section]).delete().eq("quote_id", savedQuote.id);
        const payload = rows[section].map((row, index) => serializeRow(section, row, savedQuote.id, index));
        if (payload.length) {
          const { error } = await db.from(tableBySection[section]).insert(payload);
          if (error) throw error;
        }
      }

      setQuote(savedQuote);
      setStatus(nextStatus as QuoteStatus);
      toast.success(nextStatus === "submitted" ? "Devis soumis à l'équipe LeJapon.ma." : "Devis enregistré.");
      await load();
    } catch (error: any) {
      if (isMissingTableError(error)) {
        setSqlMissing(true);
        toast.error("Migration SQL quote engine requise avant l'enregistrement.");
      } else {
        toast.error(error?.message ?? "Enregistrement impossible.");
      }
    } finally {
      setBusy(false);
    }
  };

  const updateRows = (section: QuoteSection, nextRows: QuoteRow[]) => {
    setRows((current) => ({ ...current, [section]: reindexRows(nextRows) }));
  };

  const addRow = (section: QuoteSection) => {
    updateRows(section, [...rows[section], blankRow(section, rows[section].length)]);
  };

  const exportExcel = async (scope: "quote" | "operations" | "participants" | "rooms_extras" | "global") => {
    const context = buildExportContext({
      trip,
      rows,
      totals,
      programmeDays,
      hotels,
      rooms,
      assignments,
      participants,
      bookings,
      bookingExtras,
      extrasList,
      participantActivitySelections,
      operationalState,
      includeAdminNotes: isAdmin,
    });
    const fileBase = supplierExcelFilename(trip);
    if (scope === "quote") {
      await exportWorkbook(`${fileBase}-devis.xlsx`, [
        { name: "Devis", rows: context.quoteRows },
        { name: "Totaux", rows: context.totalRows },
      ]);
    } else if (scope === "operations") {
      await exportWorkbook(`${fileBase}-vue-operationnelle.xlsx`, [{ name: "Vue opérationnelle", rows: context.operationalRows }]);
    } else if (scope === "participants") {
      await exportWorkbook(`${fileBase}-participants.xlsx`, [{ name: "Participants", rows: context.participantRows }]);
    } else if (scope === "rooms_extras") {
      await exportWorkbook(`${fileBase}-chambres-extras.xlsx`, [
        { name: "Chambres", rows: context.roomRows },
        { name: "Extras", rows: context.extraRows },
      ]);
    } else {
      await exportWorkbook(`${fileBase}-global.xlsx`, [
        { name: "Devis", rows: context.quoteRows },
        { name: "Vue opérationnelle", rows: context.operationalRows },
        { name: "Participants", rows: context.participantRows },
        { name: "Chambres", rows: context.roomRows },
        { name: "Extras", rows: context.extraRows },
        { name: "Totaux", rows: context.totalRows },
      ]);
    }
  };

  const updateDayStatus = (dayNumber: number, nextStatus: DayOperationalStatus) => {
    setOperationalState((current) => ({
      ...current,
      day_statuses: { ...current.day_statuses, [String(dayNumber)]: nextStatus },
    }));
  };

  const addDayComment = (dayNumber: number, body: string) => {
    const cleaned = body.trim();
    if (!cleaned) return;
    const key = String(dayNumber);
    const comment: DayComment = {
      id: crypto.randomUUID(),
      day_number: dayNumber,
      body: cleaned,
      author_id: user?.id ?? null,
      author_email: user?.email ?? null,
      author_name: user?.user_metadata?.full_name || user?.email || supplierName,
      source: isAdmin ? "admin" : "japan_office",
      created_at: new Date().toISOString(),
      updated_at: null,
    };
    setOperationalState((current) => ({
      ...current,
      day_comments: {
        ...current.day_comments,
        [key]: [...(current.day_comments[key] ?? []), comment],
      },
    }));
  };

  const updateDayComment = (dayNumber: number, commentId: string, body: string) => {
    const key = String(dayNumber);
    setOperationalState((current) => ({
      ...current,
      day_comments: {
        ...current.day_comments,
        [key]: (current.day_comments[key] ?? []).map((comment) =>
          comment.id === commentId ? { ...comment, body: body.trim(), updated_at: new Date().toISOString() } : comment
        ),
      },
    }));
  };

  const deleteDayComment = (dayNumber: number, commentId: string) => {
    const key = String(dayNumber);
    setOperationalState((current) => ({
      ...current,
      day_comments: {
        ...current.day_comments,
        [key]: (current.day_comments[key] ?? []).filter((comment) => comment.id !== commentId),
      },
    }));
  };

  if (!trip) return <p className="text-muted-foreground">Chargement…</p>;

  return (
    <div className="space-y-6">
      <Link to="/supplier/trips" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Voyages fournisseur
      </Link>

      <PageHeader
        title={`Devis Japon - ${trip.title}`}
        description={`${supplierName} · ${fmtDate(trip.start_date)} → ${fmtDate(trip.end_date)} · ${trip.duration_days ?? (programmeDays.length || "?")} jours`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => saveQuote(status)} disabled={busy || !canEdit}>
              <Save className="h-4 w-4" /> Enregistrer
            </Button>
            <Button onClick={() => saveQuote("submitted")} disabled={busy || status === "approved"}>
              <Send className="h-4 w-4" /> Soumettre
            </Button>
          </div>
        }
      />

      {sqlMissing && (
        <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          Les tables dédiées au quote engine fournisseur sont absentes ou non accessibles. Appliquez la migration SQL V1 pour enregistrer les devis structurés.
        </Card>
      )}

      <div className="grid gap-3 lg:grid-cols-5">
        <TotalCard label="Hôtels" value={totals.hotels} />
        <TotalCard label="Transport" value={totals.transport} />
        <TotalCard label="Activités" value={totals.activities} />
        <TotalCard label="Guides" value={totals.guides} />
        <TotalCard label="Autres" value={totals.other} />
      </div>

      <Card className="sticky top-20 z-10 border-primary/20 bg-background/95 p-4 shadow-sm backdrop-blur">
        <div className="grid gap-4 md:grid-cols-4 xl:grid-cols-8">
          <div>
            <Label>Statut</Label>
            <Select value={status} onValueChange={(value) => setStatus(value as QuoteStatus)} disabled={!isAdmin && status === "approved"}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(quoteStatusLabel).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Commission office (%)</Label>
            <Input className="mt-1" type="number" value={commissionPct} onChange={(event) => setCommissionPct(Number(event.target.value))} disabled={!canEdit} />
          </div>
          <div>
            <Label>JPY → MAD</Label>
            <Input className="mt-1" type="number" step="0.001" value={exchangeRate} onChange={(event) => setExchangeRate(Number(event.target.value))} disabled={!canEdit} />
          </div>
          <SummaryMetric label="Total brut JPY" value={fmtJPY(totals.grandTotalJpy)} />
          <SummaryMetric label="Commission JPY" value={fmtJPY(totals.commissionAmountJpy)} />
          <SummaryMetric label="Total final JPY" value={fmtJPY(totals.finalTotalJpy)} strong />
          <SummaryMetric label="Total final MAD" value={fmtMAD(totals.finalTotalMad)} strong />
          <SummaryMetric label="Coût / personne" value={`${fmtJPY(totals.costPerPersonJpy)} · ${fmtMAD(totals.costPerPersonMad)}`} />
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="font-display text-lg">Exports Excel</h2>
            <p className="text-sm text-muted-foreground">Données opérationnelles bureau Japon, sans paiements ni marge commerciale.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void exportExcel("quote")}><Download className="h-4 w-4" /> Export devis Excel</Button>
            <Button variant="outline" size="sm" onClick={() => void exportExcel("operations")}><Download className="h-4 w-4" /> Export vue opérationnelle Excel</Button>
            <Button variant="outline" size="sm" onClick={() => void exportExcel("participants")}><Download className="h-4 w-4" /> Export participants Excel</Button>
            <Button variant="outline" size="sm" onClick={() => void exportExcel("rooms_extras")}><Download className="h-4 w-4" /> Export chambres & extras Excel</Button>
            <Button size="sm" onClick={() => void exportExcel("global")}><Download className="h-4 w-4" /> Export dossier global Excel</Button>
          </div>
        </div>
      </Card>

      <Tabs defaultValue="quote" className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-1 md:grid-cols-4">
          <TabsTrigger value="quote">Devis</TabsTrigger>
          <TabsTrigger value="operations">Vue opérationnelle</TabsTrigger>
          <TabsTrigger value="participants">Participants</TabsTrigger>
          <TabsTrigger value="rooms">Chambres & extras</TabsTrigger>
        </TabsList>

        <TabsContent value="quote" className="space-y-5">
          <QuoteTable section="hotels" rows={rows.hotels} canEdit={canEdit} onRowsChange={(next) => updateRows("hotels", next)} onAdd={() => addRow("hotels")} />
          <QuoteTable section="transport" rows={rows.transport} canEdit={canEdit} onRowsChange={(next) => updateRows("transport", next)} onAdd={() => addRow("transport")} />
          <QuoteTable section="activities" rows={rows.activities} canEdit={canEdit} onRowsChange={(next) => updateRows("activities", next)} onAdd={() => addRow("activities")} />
          <QuoteTable section="guides" rows={rows.guides} canEdit={canEdit} onRowsChange={(next) => updateRows("guides", next)} onAdd={() => addRow("guides")} />
          <QuoteTable section="other" rows={rows.other} canEdit={canEdit} onRowsChange={(next) => updateRows("other", next)} onAdd={() => addRow("other")} />
          <Card className="p-4">
            <Label>Notes internes admin / Japan office</Label>
            <Textarea className="mt-2" rows={3} value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} disabled={!isAdmin} />
          </Card>
        </TabsContent>

        <TabsContent value="operations" className="space-y-3">
          <OperationProgramme
            trip={trip}
            days={programmeDays}
            hotels={hotels}
            operationalState={operationalState}
            canEdit={canEdit}
            isAdmin={isAdmin}
            currentUserId={user?.id ?? null}
            onDayStatusChange={updateDayStatus}
            onAddComment={addDayComment}
            onUpdateComment={updateDayComment}
            onDeleteComment={deleteDayComment}
          />
        </TabsContent>

        <TabsContent value="participants">
          <ParticipantsTable
            participants={participants}
            bookings={bookings}
            bookingExtras={bookingExtras}
            extrasList={extrasList}
            rooms={rooms}
            hotels={hotels}
            assignments={assignments}
            participantActivitySelections={participantActivitySelections}
          />
        </TabsContent>

        <TabsContent value="rooms">
          <RoomsAndExtras
            hotels={hotels}
            rooms={rooms}
            assignments={assignments}
            participants={participants}
            bookings={bookings}
            bookingExtras={bookingExtras}
            extrasList={extrasList}
            participantActivitySelections={participantActivitySelections}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function QuoteTable({ section, rows, canEdit, onRowsChange, onAdd }: {
  section: QuoteSection;
  rows: QuoteRow[];
  canEdit: boolean;
  onRowsChange: (rows: QuoteRow[]) => void;
  onAdd: () => void;
}) {
  const total = rows.reduce((sum, row) => sum + subtotal(row), 0);
  const columns = columnsForSection(section);
  const update = (index: number, key: string, value: any) => {
    onRowsChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  };
  const remove = (index: number) => onRowsChange(rows.filter((_, rowIndex) => rowIndex !== index));
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const nextRows = [...rows];
    [nextRows[index], nextRows[target]] = [nextRows[target], nextRows[index]];
    onRowsChange(nextRows);
  };
  const requiredActivityTotal = section === "activities"
    ? rows.filter((row) => !row.optional).reduce((sum, row) => sum + subtotal(row), 0)
    : 0;
  const optionalActivityTotal = section === "activities"
    ? rows.filter((row) => row.optional).reduce((sum, row) => sum + subtotal(row), 0)
    : 0;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-display text-lg">{sectionLabels[section]}</h2>
          <p className="text-sm text-muted-foreground">{rows.length} ligne(s) · Total {fmtJPY(total)}</p>
        </div>
        <Button variant="outline" size="sm" onClick={onAdd} disabled={!canEdit}>
          <Plus className="h-4 w-4" /> Ajouter une ligne
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1120px] text-sm">
          <thead className="bg-secondary/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Ordre</th>
              {columns.map((column) => <th key={column.key} className="px-3 py-2 font-medium">{column.label}</th>)}
              <th className="px-3 py-2 text-right font-medium">Sous-total</th>
              <th className="px-3 py-2 font-medium">Statut</th>
              <th className="px-3 py-2 font-medium">Assigné</th>
              <th className="px-3 py-2 font-medium">Commentaire</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr><td colSpan={columns.length + 6} className="p-8 text-center text-muted-foreground">Aucune ligne.</td></tr>
            )}
            {rows.map((row, index) => (
              <tr key={row.local_id} className="align-top">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" disabled={!canEdit || index === 0} onClick={() => move(index, -1)} aria-label="Monter la ligne">
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" disabled={!canEdit || index === rows.length - 1} onClick={() => move(index, 1)} aria-label="Descendre la ligne">
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
                {columns.map((column) => (
                  <td key={column.key} className="px-3 py-2">
                    <CellInput column={column} value={row[column.key]} disabled={!canEdit} onChange={(value) => update(index, column.key, value)} />
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-semibold">{fmtJPY(subtotal(row))}</td>
                <td className="px-3 py-2">
                  <Select value={row.status ?? "todo"} disabled={!canEdit} onValueChange={(value) => update(index, "status", value)}>
                    <SelectTrigger className="h-9 min-w-[130px]"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(rowStatusLabel).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent>
                  </Select>
                </td>
                <td className="px-3 py-2"><Input className="h-9 min-w-[130px]" value={row.assigned_to ?? ""} disabled={!canEdit} onChange={(event) => update(index, "assigned_to", event.target.value)} /></td>
                <td className="px-3 py-2"><Input className="h-9 min-w-[180px]" value={row.comment ?? ""} disabled={!canEdit} onChange={(event) => update(index, "comment", event.target.value)} /></td>
                <td className="px-3 py-2 text-right">
                  <Button variant="ghost" size="icon" disabled={!canEdit} onClick={() => remove(index)}><Trash2 className="h-4 w-4" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
          {section === "activities" && rows.length > 0 && (
            <tfoot className="border-t border-border bg-secondary/30 text-sm">
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-3 font-medium">Total activités requises</td>
                <td className="px-3 py-3 text-right font-semibold">{fmtJPY(requiredActivityTotal)}</td>
                <td colSpan={4}></td>
              </tr>
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-3 font-medium">Total activités optionnelles</td>
                <td className="px-3 py-3 text-right font-semibold">{fmtJPY(optionalActivityTotal)}</td>
                <td colSpan={4}></td>
              </tr>
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-3 font-semibold">Total toutes activités</td>
                <td className="px-3 py-3 text-right font-bold">{fmtJPY(total)}</td>
                <td colSpan={4}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  );
}

const CellInput = ({ column, value, disabled, onChange }: { column: any; value: any; disabled: boolean; onChange: (value: any) => void }) => {
  if (column.type === "boolean") {
    return (
      <label className="flex h-9 min-w-[110px] items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        Oui
      </label>
    );
  }
  if (column.type === "select") {
    return (
      <Select value={String(value ?? column.options[0] ?? "")} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger className="h-9 min-w-[140px]"><SelectValue /></SelectTrigger>
        <SelectContent>{column.options.map((option: string) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
      </Select>
    );
  }
  if (column.type === "number") {
    return <Input className="h-9 min-w-[110px]" type="number" value={value ?? 0} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />;
  }
  if (column.type === "date") {
    return <Input className="h-9 min-w-[140px]" type="date" value={value ?? ""} disabled={disabled} onChange={(event) => onChange(event.target.value)} />;
  }
  return <Input className="h-9 min-w-[160px]" value={value ?? ""} disabled={disabled} onChange={(event) => onChange(event.target.value)} />;
};

function OperationProgramme({
  trip,
  days,
  hotels,
  operationalState,
  canEdit,
  isAdmin,
  currentUserId,
  onDayStatusChange,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
}: {
  trip: any;
  days: any[];
  hotels: any[];
  operationalState: OperationalState;
  canEdit: boolean;
  isAdmin: boolean;
  currentUserId: string | null;
  onDayStatusChange: (dayNumber: number, status: DayOperationalStatus) => void;
  onAddComment: (dayNumber: number, body: string) => void;
  onUpdateComment: (dayNumber: number, commentId: string, body: string) => void;
  onDeleteComment: (dayNumber: number, commentId: string) => void;
}) {
  return (
    <div className="space-y-4">
      <FlightBlock trip={trip} />
      {days.map((day) => (
        <OperationalDayCard
          key={day.local_id ?? day.day_number}
          day={day}
          trip={trip}
          hotels={hotels}
          status={operationalState.day_statuses[String(day.day_number)] ?? "to_confirm"}
          comments={operationalState.day_comments[String(day.day_number)] ?? []}
          canEdit={canEdit}
          isAdmin={isAdmin}
          currentUserId={currentUserId}
          onStatusChange={(nextStatus) => onDayStatusChange(day.day_number, nextStatus)}
          onAddComment={(body) => onAddComment(day.day_number, body)}
          onUpdateComment={(commentId, body) => onUpdateComment(day.day_number, commentId, body)}
          onDeleteComment={(commentId) => onDeleteComment(day.day_number, commentId)}
        />
      ))}
    </div>
  );
}

function FlightBlock({ trip }: { trip: any }) {
  const outboundText = firstText(trip.outbound_flight_text, trip.metadata?.outbound_flight_text);
  const returnText = firstText(trip.return_flight_text, trip.metadata?.return_flight_text);
  const airline = firstText(trip.airline, trip.metadata?.airline);
  const notes = firstText(trip.flight_notes, trip.metadata?.flight_notes);
  const hasFlightData = [outboundText, returnText, trip.visa_arrival_flight_number, trip.visa_arrival_port, trip.visa_japan_arrival_date, trip.visa_japan_departure_date, airline, notes]
    .some((value) => String(value ?? "").trim());

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Plane className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-lg">Informations de vol</h2>
              <p className="text-sm text-muted-foreground">Données voyage configurées pour le bureau Japon.</p>
            </div>
            {airline && <Badge variant="outline">{airline}</Badge>}
          </div>

          {!hasFlightData ? (
            <p className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Informations de vol à confirmer.</p>
          ) : (
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <FlightInfoCard
                title="Vol aller"
                route={firstText(trip.metadata?.outbound_route, trip.visa_arrival_port ? `Maroc → ${trip.visa_arrival_port}` : "")}
                flightNumbers={firstText(trip.metadata?.outbound_flight_numbers, trip.visa_arrival_flight_number)}
                departure={firstText(trip.metadata?.outbound_departure_text, trip.start_date ? `Départ: ${fmtDate(trip.start_date)}` : "")}
                arrival={firstText(trip.metadata?.outbound_arrival_text, trip.visa_japan_arrival_date ? `Arrivée: ${fmtDate(trip.visa_japan_arrival_date)} · ${trip.visa_arrival_port || ""}` : "")}
                notes={outboundText}
              />
              <FlightInfoCard
                title="Vol retour"
                route={firstText(trip.metadata?.return_route, "Japon → Maroc")}
                flightNumbers={firstText(trip.metadata?.return_flight_numbers)}
                departure={firstText(trip.metadata?.return_departure_text, trip.visa_japan_departure_date ? `Départ Japon: ${fmtDate(trip.visa_japan_departure_date)}` : "")}
                arrival={firstText(trip.metadata?.return_arrival_text, trip.end_date ? `Retour: ${fmtDate(trip.end_date)}` : "")}
                notes={returnText}
              />
              {notes && <div className="rounded-lg bg-secondary/40 p-3 text-sm lg:col-span-2"><span className="font-medium">Notes: </span>{notes}</div>}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function FlightInfoCard({ title, route, flightNumbers, departure, arrival, notes }: {
  title: string;
  route?: string;
  flightNumbers?: string;
  departure?: string;
  arrival?: string;
  notes?: string;
}) {
  return (
    <div className="rounded-lg border border-border p-3 text-sm">
      <p className="font-semibold">{title}</p>
      <div className="mt-2 grid gap-1 text-muted-foreground">
        <p><span className="text-foreground">Route:</span> {route || "À confirmer"}</p>
        <p><span className="text-foreground">Vol(s):</span> {flightNumbers || "À confirmer"}</p>
        <p><span className="text-foreground">Départ:</span> {departure || "À confirmer"}</p>
        <p><span className="text-foreground">Arrivée:</span> {arrival || "À confirmer"}</p>
        {notes && <p className="whitespace-pre-wrap"><span className="text-foreground">Détails:</span> {notes}</p>}
      </div>
    </div>
  );
}

function OperationalDayCard({
  day,
  trip,
  hotels,
  status,
  comments,
  canEdit,
  isAdmin,
  currentUserId,
  onStatusChange,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
}: {
  day: any;
  trip: any;
  hotels: any[];
  status: DayOperationalStatus;
  comments: DayComment[];
  canEdit: boolean;
  isAdmin: boolean;
  currentUserId: string | null;
  onStatusChange: (status: DayOperationalStatus) => void;
  onAddComment: (body: string) => void;
  onUpdateComment: (commentId: string, body: string) => void;
  onDeleteComment: (commentId: string) => void;
}) {
  const hotel = resolveHotelForDay(day, trip, hotels);
  const scheduleRows = normalizeScheduleRows(day);
  const operationalNotes = firstText(day.operational_notes, day.metadata?.operational_notes, day.notes);

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border bg-secondary/20 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">Jour {day.day_number}</Badge>
              <DayStatusBadge status={status} />
              <span className="text-sm text-muted-foreground">{fmtDate(day.date)}</span>
            </div>
            <h3 className="mt-2 font-display text-xl">{safeText(day.title) || "Programme à compléter"}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{safeText(day.city || day.location || day.route) || "Ville / route à confirmer"}</p>
          </div>
          <div className="w-full lg:w-56">
            <Label className="text-xs">Statut opérationnel</Label>
            <Select value={status} onValueChange={(value) => onStatusChange(value as DayOperationalStatus)} disabled={!canEdit}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(dayStatusLabel).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <InfoBox label="Transport prévu" value={safeText(day.transport || day.metadata?.transport) || "Transport à confirmer"} />
            <InfoBox label="Notes opérationnelles" value={operationalNotes || "Aucune note opérationnelle."} />
          </div>

          <div>
            <h4 className="text-sm font-semibold">Programme horaire</h4>
            <div className="mt-2 overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-secondary/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Heure</th>
                    <th className="px-3 py-2">Activité / visite</th>
                    <th className="px-3 py-2">Lieu</th>
                    <th className="px-3 py-2">Transport</th>
                    <th className="px-3 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {scheduleRows.map((row, index) => (
                    <tr key={`${day.day_number}-${index}`}>
                      <td className="px-3 py-2 font-medium">{row.time || "—"}</td>
                      <td className="px-3 py-2">{row.activity || "À compléter"}</td>
                      <td className="px-3 py-2">{row.location || "—"}</td>
                      <td className="px-3 py-2">{row.transport || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <DayComments
            comments={comments}
            canEdit={canEdit}
            isAdmin={isAdmin}
            currentUserId={currentUserId}
            onAdd={onAddComment}
            onUpdate={onUpdateComment}
            onDelete={onDeleteComment}
          />
        </div>

        <aside className="space-y-3 rounded-lg border border-border bg-background p-4">
          <h4 className="font-semibold">Hôtel du jour</h4>
          <div className="space-y-2 text-sm">
            <p className="font-medium">{hotel.name}</p>
            <p className="text-muted-foreground">{hotel.city}</p>
            <p>{hotel.address}</p>
            <p>{hotel.phone}</p>
            <p className="text-xs text-muted-foreground">{hotel.stay}</p>
          </div>
        </aside>
      </div>
    </Card>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3 text-sm">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-2 whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function DayStatusBadge({ status }: { status: DayOperationalStatus }) {
  const className = {
    to_confirm: "border-slate-200 bg-slate-50 text-slate-700",
    confirmed: "border-emerald-200 bg-emerald-50 text-emerald-700",
    attention: "border-amber-200 bg-amber-50 text-amber-800",
    modified: "border-sky-200 bg-sky-50 text-sky-700",
  }[status];
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>{dayStatusLabel[status]}</span>;
}

function DayComments({ comments, canEdit, isAdmin, currentUserId, onAdd, onUpdate, onDelete }: {
  comments: DayComment[];
  canEdit: boolean;
  isAdmin: boolean;
  currentUserId: string | null;
  onAdd: (body: string) => void;
  onUpdate: (commentId: string, body: string) => void;
  onDelete: (commentId: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const add = () => {
    onAdd(draft);
    setDraft("");
  };

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <h4 className="text-sm font-semibold">Commentaires collaboration</h4>
      </div>
      <div className="mt-3 space-y-3">
        {comments.length === 0 && <p className="text-sm text-muted-foreground">Aucun commentaire pour ce jour.</p>}
        {comments.map((comment) => {
          const canManage = isAdmin || comment.author_id === currentUserId;
          return (
            <div key={comment.id} className="rounded-lg bg-secondary/35 p-3 text-sm">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-medium">{comment.author_name || comment.author_email || "Utilisateur"}</p>
                  <p className="text-xs text-muted-foreground">
                    {commentSourceLabel(comment.source)} · {fmtDateTimeLabel(comment.created_at)}
                    {comment.updated_at ? ` · modifié ${fmtDateTimeLabel(comment.updated_at)}` : ""}
                  </p>
                </div>
                {canManage && canEdit && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingId(comment.id);
                        setEditDraft(comment.body);
                      }}
                    >
                      Modifier
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onDelete(comment.id)}>
                      Supprimer
                    </Button>
                  </div>
                )}
              </div>
              {editingId === comment.id ? (
                <div className="mt-2 space-y-2">
                  <Textarea value={editDraft} onChange={(event) => setEditDraft(event.target.value)} rows={2} />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => { onUpdate(comment.id, editDraft); setEditingId(null); setEditDraft(""); }}>Enregistrer</Button>
                    <Button size="sm" variant="outline" onClick={() => { setEditingId(null); setEditDraft(""); }}>Annuler</Button>
                  </div>
                </div>
              ) : (
                <p className="mt-2 whitespace-pre-wrap">{comment.body}</p>
              )}
            </div>
          );
        })}
      </div>
      {canEdit && (
        <div className="mt-3 space-y-2">
          <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} placeholder="Ajouter un commentaire opérationnel..." />
          <Button size="sm" onClick={add} disabled={!draft.trim()}>Ajouter commentaire</Button>
        </div>
      )}
    </div>
  );
}

const commentSourceLabel = (source: DayComment["source"]) => {
  if (source === "japan_office") return "Bureau Japon";
  if (source === "maroc") return "Maroc";
  return "Admin";
};

const fmtDateTimeLabel = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

function ParticipantsTable({
  participants,
  bookings,
  bookingExtras,
  extrasList,
  rooms,
  hotels,
  assignments,
  participantActivitySelections,
}: {
  participants: any[];
  bookings: any[];
  bookingExtras: any[];
  extrasList: any[];
  rooms: any[];
  hotels: any[];
  assignments: any[];
  participantActivitySelections: any[];
}) {
  const participantRows = buildParticipantRows({ participants, bookings, bookingExtras, extrasList, rooms, hotels, assignments, participantActivitySelections });
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1700px] text-sm">
          <thead className="bg-secondary/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-10 min-w-[190px] bg-secondary/50 px-3 py-2">Participant</th>
              <th className="px-3 py-2">Réservation</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Chambre</th>
              <th className="px-3 py-2">Type chambre</th>
              <th className="px-3 py-2">Extras</th>
              <th className="px-3 py-2">Notes spéciales</th>
              <th className="px-3 py-2">Passeport</th>
              <th className="px-3 py-2">Nationalité</th>
              <th className="px-3 py-2">Naissance</th>
              <th className="px-3 py-2">Sexe</th>
              <th className="px-3 py-2">Expiration passeport</th>
              <th className="px-3 py-2">Émission passeport</th>
              <th className="px-3 py-2">CIN / ID national</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {participantRows.length === 0 && <tr><td colSpan={14} className="p-8 text-center text-muted-foreground">Aucun participant enregistré.</td></tr>}
            {participantRows.map((row) => {
              return (
                <tr key={row.id}>
                  <td className="sticky left-0 z-10 bg-background px-3 py-2 font-medium">{row.full_name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{row.booking_reference}</td>
                  <td className="px-3 py-2">{row.booking_source}</td>
                  <td className="px-3 py-2">{row.room_assignment}</td>
                  <td className="px-3 py-2">{row.room_type}</td>
                  <td className="px-3 py-2">{row.selected_extras}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.special_notes}</td>
                  <td className="px-3 py-2">{row.passport_number}</td>
                  <td className="px-3 py-2">{row.nationality}</td>
                  <td className="px-3 py-2">{row.birthdate}</td>
                  <td className="px-3 py-2">{row.sex}</td>
                  <td className="px-3 py-2">{row.passport_expiry}</td>
                  <td className="px-3 py-2">{row.passport_issue_date}</td>
                  <td className="px-3 py-2">{row.national_id_number}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function RoomsAndExtras({
  hotels,
  rooms,
  assignments,
  participants,
  bookings,
  bookingExtras,
  extrasList,
  participantActivitySelections,
}: {
  hotels: any[];
  rooms: any[];
  assignments: any[];
  participants: any[];
  bookings: any[];
  bookingExtras: any[];
  extrasList: any[];
  participantActivitySelections: any[];
}) {
  const participantById = new Map(participants.map((participant) => [participant.id, participant]));
  const bookingById = new Map(bookings.map((booking) => [booking.id, booking]));
  const extrasSummary = buildExtraGroups({ participants, bookings, bookingExtras, extrasList, participantActivitySelections });
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Card className="p-4">
        <h2 className="font-display text-lg">Chambres par hôtel</h2>
        <div className="mt-4 space-y-4">
          {hotels.length === 0 && <p className="text-sm text-muted-foreground">Aucun hôtel configuré.</p>}
          {hotels.map((hotel) => {
            const hotelRooms = rooms.filter((room) => room.trip_hotel_id === hotel.id);
            return (
              <div key={hotel.id} className="rounded-lg border border-border p-3">
                <p className="font-semibold">{hotel.name || hotel.hotel_name || "Hôtel"} · {hotel.city || "Ville à confirmer"}</p>
                <p className="text-xs text-muted-foreground">{fmtDate(hotel.check_in)} → {fmtDate(hotel.check_out)}</p>
                <div className="mt-3 grid gap-2">
                  {hotelRooms.length === 0 && <p className="text-sm text-muted-foreground">Aucune chambre.</p>}
                  {hotelRooms.map((room) => {
                    const roomAssignments = assignments.filter((assignment) => assignment.room_id === room.id);
                    const assignedParticipants = roomAssignments.map((assignment) => {
                      const participant = participantById.get(assignment.participant_id);
                      const booking = participant ? bookingById.get(participant.booking_id) : null;
                      return { participant, booking };
                    }).filter(({ participant }) => Boolean(participant));
                    return (
                      <div key={room.id} className="rounded-md bg-secondary/40 p-3 text-sm">
                        <div className="font-medium">{room.room_number || room.room_name || "Chambre"} · {room.room_type || "—"}</div>
                        {assignedParticipants.length === 0 ? (
                          <p className="mt-1 text-muted-foreground">Non assignée</p>
                        ) : (
                          <div className="mt-2 space-y-2">
                            {assignedParticipants.map(({ participant, booking }) => (
                              <div key={participant.id} className="rounded border border-border bg-background px-3 py-2">
                                <p className="font-medium">{participantFullName(participant)} <span className="text-xs text-muted-foreground">· {booking?.reference ?? "Sans référence"}</span></p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Passeport: {passportNumber(participant) || "—"} · Nationalité: {participantNationality(participant) || "—"} · Naissance: {formatDateForDisplay(participantBirthdate(participant))}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Expiration: {formatDateForDisplay(participantPassportExpiry(participant))} · Type: {participant.room_type ?? booking?.room_type ?? room.room_type ?? "—"}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      <Card className="p-4">
        <h2 className="font-display text-lg">Activités / extras</h2>
        <div className="mt-4 space-y-2">
          {extrasSummary.length === 0 && <p className="text-sm text-muted-foreground">Aucun extra sélectionné.</p>}
          {extrasSummary.map((extra) => (
            <div key={extra.name} className="rounded-lg border border-border px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{extra.name}</span>
                <Badge variant="outline">Qté {extra.quantity}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Réservations: {extra.booking_references || "—"}</p>
              <p className="mt-1 text-xs text-muted-foreground">Participants: {extra.participants || "—"}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

const columnsForSection = (section: QuoteSection) => {
  if (section === "hotels") return [
    { key: "city", label: "Ville" },
    { key: "hotel_name", label: "Hôtel" },
    { key: "check_in", label: "Check-in", type: "date" },
    { key: "check_out", label: "Check-out", type: "date" },
    { key: "nights", label: "Nuits", type: "number" },
    { key: "room_type", label: "Type", type: "select", options: roomTypes },
    { key: "rooms_count", label: "Chambres", type: "number" },
    { key: "unit_price_jpy", label: "Prix/nuit JPY", type: "number" },
  ];
  if (section === "transport") return [
    { key: "service_date", label: "Date", type: "date" },
    { key: "day_number", label: "Jour", type: "number" },
    { key: "city_route", label: "Ville / route" },
    { key: "transport_type", label: "Type", type: "select", options: transportTypes },
    { key: "description", label: "Description" },
    { key: "quantity", label: "Qté", type: "number" },
    { key: "unit_price_jpy", label: "Prix unitaire JPY", type: "number" },
  ];
  if (section === "activities") return [
    { key: "service_date", label: "Date", type: "date" },
    { key: "day_number", label: "Jour", type: "number" },
    { key: "activity_name", label: "Activité" },
    { key: "unit_price_jpy", label: "Prix unitaire JPY", type: "number" },
    { key: "quantity", label: "Participants", type: "number" },
    { key: "optional", label: "Optionnel", type: "boolean" },
  ];
  if (section === "guides") return [
    { key: "service_date", label: "Date", type: "date" },
    { key: "city", label: "Ville" },
    { key: "guide_type", label: "Type", type: "select", options: guideTypes },
    { key: "guides_count", label: "Guides", type: "number" },
    { key: "daily_price_jpy", label: "Prix jour JPY", type: "number" },
  ];
  return [
    { key: "label", label: "Libellé" },
    { key: "quantity", label: "Qté", type: "number" },
    { key: "unit_price_jpy", label: "Prix unitaire JPY", type: "number" },
  ];
};

const blankRow = (section: QuoteSection, index: number): QuoteRow => {
  const base = { local_id: crypto.randomUUID(), sort_order: index, status: "todo" as RowStatus, comment: "", assigned_to: "" };
  if (section === "hotels") return { ...base, city: "", hotel_name: "", check_in: "", check_out: "", nights: 1, room_type: "double/twin", rooms_count: 1, unit_price_jpy: 0 };
  if (section === "transport") return { ...base, service_date: "", day_number: index + 1, city_route: "", transport_type: "bus", description: "", quantity: 1, unit_price_jpy: 0 };
  if (section === "activities") return { ...base, service_date: "", day_number: index + 1, activity_name: "", quantity: 1, unit_price_jpy: 0, optional: false };
  if (section === "guides") return { ...base, service_date: "", city: "", guide_type: "francophone", guides_count: 1, daily_price_jpy: 0 };
  return { ...base, label: "", quantity: 1, unit_price_jpy: 0 };
};

const subtotal = (row: QuoteRow) => {
  if ("rooms_count" in row) return Number(row.rooms_count || 0) * Number(row.nights || 0) * Number(row.unit_price_jpy || 0);
  if ("guides_count" in row) return Number(row.guides_count || 0) * Number(row.daily_price_jpy || 0);
  return Number(row.quantity || 0) * Number(row.unit_price_jpy || 0);
};

const serializeRow = (section: QuoteSection, row: QuoteRow, quoteId: string, index: number) => {
  const base = {
    quote_id: quoteId,
    sort_order: index,
    status: row.status ?? "todo",
    assigned_to: row.assigned_to || null,
    comment: row.comment || null,
    subtotal_jpy: subtotal(row),
    updated_at: new Date().toISOString(),
  };
  const clean = (keys: string[]) => Object.fromEntries(keys.map((key) => [key, row[key] ?? null]));
  if (section === "hotels") return { ...base, ...clean(["city", "hotel_name", "check_in", "check_out", "nights", "room_type", "rooms_count", "unit_price_jpy"]) };
  if (section === "transport") return { ...base, ...clean(["service_date", "day_number", "city_route", "transport_type", "description", "quantity", "unit_price_jpy"]) };
  if (section === "activities") return { ...base, ...clean(["service_date", "day_number", "activity_name", "quantity", "unit_price_jpy", "optional"]) };
  if (section === "guides") return { ...base, ...clean(["service_date", "city", "guide_type", "guides_count", "daily_price_jpy"]) };
  return { ...base, ...clean(["label", "quantity", "unit_price_jpy"]) };
};

const exportWorkbook = async (filename: string, sheets: Array<{ name: string; rows: any[] }>) => {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  sheets.forEach((sheet) => {
    const rows = sheet.rows.length ? sheet.rows : [{ note: "Aucune donnée" }];
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, sanitizeSheetName(sheet.name));
  });
  XLSX.writeFile(workbook, filename);
};

const buildExportContext = ({ trip, rows, totals, programmeDays, hotels, rooms, assignments, participants, bookings, bookingExtras, extrasList, participantActivitySelections, operationalState, includeAdminNotes }: any) => {
  const participantRows = buildParticipantRows({ participants, bookings, bookingExtras, extrasList, rooms, hotels, assignments, participantActivitySelections });
  const extraRows = buildExtraGroups({ participants, bookings, bookingExtras, extrasList, participantActivitySelections });
  const roomRows = buildRoomRows({ hotels, rooms, assignments, participants, bookings });
  const operationalRows = buildOperationalExportRows({ trip, days: programmeDays, hotels, operationalState });
  const quoteRows = buildQuoteExportRows(rows, includeAdminNotes);
  const totalRows = [
    { poste: "Hôtels", montant_jpy: roundNumber(totals.hotels) },
    { poste: "Transport", montant_jpy: roundNumber(totals.transport) },
    { poste: "Activités", montant_jpy: roundNumber(totals.activities) },
    { poste: "Guides", montant_jpy: roundNumber(totals.guides) },
    { poste: "Autres", montant_jpy: roundNumber(totals.other) },
    { poste: "Total brut", montant_jpy: roundNumber(totals.grandTotalJpy) },
    { poste: "Commission office", montant_jpy: roundNumber(totals.commissionAmountJpy) },
    { poste: "Total final JPY", montant_jpy: roundNumber(totals.finalTotalJpy) },
    { poste: "Total final MAD", montant_mad: roundNumber(totals.finalTotalMad) },
    { poste: "Participants", valeur: totals.participantCount },
    { poste: "Coût par personne JPY", montant_jpy: roundNumber(totals.costPerPersonJpy) },
    { poste: "Coût par personne MAD", montant_mad: roundNumber(totals.costPerPersonMad) },
  ];
  return { participantRows, extraRows, roomRows, operationalRows, quoteRows, totalRows };
};

const buildQuoteExportRows = (rows: Record<QuoteSection, QuoteRow[]>, includeAdminNotes: boolean) =>
  (Object.keys(rows) as QuoteSection[]).flatMap((section) =>
    rows[section].map((row, index) => {
      const base: Record<string, unknown> = {
        section: sectionLabels[section],
        ordre: index + 1,
        statut: rowStatusLabel[row.status as RowStatus] ?? row.status ?? "",
        sous_total_jpy: roundNumber(subtotal(row)),
        assigne_a: row.assigned_to ?? "",
        commentaire: row.comment ?? "",
      };
      if (section === "hotels") Object.assign(base, {
        ville: row.city,
        hotel: row.hotel_name,
        check_in: formatDateForDisplay(row.check_in),
        check_out: formatDateForDisplay(row.check_out),
        nuits: row.nights,
        type_chambre: row.room_type,
        chambres: row.rooms_count,
        prix_nuit_jpy: row.unit_price_jpy,
      });
      if (section === "transport") Object.assign(base, {
        date: formatDateForDisplay(row.service_date),
        jour: row.day_number,
        ville_route: row.city_route,
        type_transport: row.transport_type,
        description: row.description,
        quantite: row.quantity,
        prix_unitaire_jpy: row.unit_price_jpy,
      });
      if (section === "activities") Object.assign(base, {
        date: formatDateForDisplay(row.service_date),
        jour: row.day_number,
        activite: row.activity_name,
        optionnel: row.optional ? "Oui" : "Non",
        participants: row.quantity,
        prix_unitaire_jpy: row.unit_price_jpy,
      });
      if (section === "guides") Object.assign(base, {
        date: formatDateForDisplay(row.service_date),
        ville: row.city,
        type_guide: row.guide_type,
        guides: row.guides_count,
        prix_jour_jpy: row.daily_price_jpy,
      });
      if (section === "other") Object.assign(base, {
        libelle: row.label,
        quantite: row.quantity,
        prix_unitaire_jpy: row.unit_price_jpy,
      });
      if (!includeAdminNotes) delete base.commentaire;
      return base;
    })
  );

const buildOperationalExportRows = ({ trip, days, hotels, operationalState }: { trip: any; days: any[]; hotels: any[]; operationalState: OperationalState }) =>
  days.flatMap((day) => {
    const hotel = resolveHotelForDay(day, trip, hotels);
    const comments = (operationalState.day_comments[String(day.day_number)] ?? []).map((comment) => `${commentSourceLabel(comment.source)} ${fmtDateTimeLabel(comment.created_at)}: ${comment.body}`).join("\n");
    return normalizeScheduleRows(day).map((row) => ({
      jour: day.day_number,
      date: formatDateForDisplay(day.date),
      ville_route: safeText(day.city || day.location || day.route) || "À confirmer",
      titre: safeText(day.title) || "Programme à compléter",
      statut: dayStatusLabel[operationalState.day_statuses[String(day.day_number)] ?? "to_confirm"],
      hotel: hotel.name,
      adresse_hotel: hotel.address,
      telephone_hotel: hotel.phone,
      sejour_hotel: hotel.stay,
      heure: row.time,
      activite: row.activity,
      lieu: row.location,
      transport: row.transport,
      notes: row.notes,
      commentaires: comments,
    }));
  });

const buildParticipantRows = ({ participants, bookings, bookingExtras, extrasList, rooms, hotels, assignments, participantActivitySelections }: any) => {
  const bookingById = new Map((bookings ?? []).map((booking: any) => [booking.id, booking]));
  return (participants ?? []).map((participant: any) => {
    const booking = bookingById.get(participant.booking_id);
    return {
      id: participant.id,
      full_name: participantFullName(participant),
      booking_reference: booking?.reference ?? "—",
      booking_source: bookingSourceLabel(booking),
      room_assignment: participantRoomAssignment(participant, rooms ?? [], hotels ?? [], assignments ?? []),
      room_type: participant.room_type ?? booking?.room_type ?? "—",
      selected_extras: selectedExtrasForParticipant(participant, bookingExtras ?? [], extrasList ?? [], participantActivitySelections ?? []),
      special_notes: participant.notes ?? participant.metadata?.special_notes ?? booking?.special_requests ?? "—",
      passport_number: passportNumber(participant) || "—",
      nationality: participantNationality(participant) || "—",
      birthdate: formatDateForDisplay(participantBirthdate(participant)),
      sex: participantSex(participant) || "—",
      passport_expiry: formatDateForDisplay(participantPassportExpiry(participant)),
      passport_issue_date: formatDateForDisplay(participantPassportIssueDate(participant)),
      national_id_number: participantNationalId(participant) || "—",
    };
  });
};

const buildRoomRows = ({ hotels, rooms, assignments, participants, bookings }: any) => {
  const participantById = new Map((participants ?? []).map((participant: any) => [participant.id, participant]));
  const bookingById = new Map((bookings ?? []).map((booking: any) => [booking.id, booking]));
  return (hotels ?? []).flatMap((hotel: any) =>
    (rooms ?? []).filter((room: any) => room.trip_hotel_id === hotel.id).flatMap((room: any) => {
      const roomAssignments = (assignments ?? []).filter((assignment: any) => assignment.room_id === room.id);
      if (roomAssignments.length === 0) return [{
        hotel: hotel.name ?? "Hôtel",
        ville: hotel.city ?? "",
        chambre: room.room_number || room.room_name || "Chambre",
        type_chambre: room.room_type ?? "",
        participant: "Non assignée",
      }];
      return roomAssignments.map((assignment: any) => {
        const participant = participantById.get(assignment.participant_id);
        const booking = participant ? bookingById.get(participant.booking_id) : null;
        return {
          hotel: hotel.name ?? "Hôtel",
          ville: hotel.city ?? "",
          check_in: formatDateForDisplay(hotel.check_in),
          check_out: formatDateForDisplay(hotel.check_out),
          chambre: room.room_number || room.room_name || "Chambre",
          type_chambre: room.room_type ?? "",
          participant: participant ? participantFullName(participant) : "Non assignée",
          reservation: booking?.reference ?? "",
          passeport: participant ? passportNumber(participant) : "",
          nationalite: participant ? participantNationality(participant) : "",
          naissance: participant ? formatDateForDisplay(participantBirthdate(participant)) : "",
          expiration_passeport: participant ? formatDateForDisplay(participantPassportExpiry(participant)) : "",
        };
      });
    })
  );
};

const buildExtraGroups = ({ participants, bookings, bookingExtras, extrasList, participantActivitySelections }: any) => {
  const bookingById = new Map((bookings ?? []).map((booking: any) => [booking.id, booking]));
  const groups = new Map<string, { name: string; quantity: number; participants: Set<string>; bookingReferences: Set<string> }>();
  const ensure = (name: string) => {
    const key = normalizeActivityName(name || "Extra");
    if (!groups.has(key)) groups.set(key, { name: name || "Extra", quantity: 0, participants: new Set(), bookingReferences: new Set() });
    return groups.get(key)!;
  };

  if ((extrasList ?? []).length > 0 && (participants ?? []).length > 0) {
    for (const participant of participants ?? []) {
      const booking = bookingById.get(participant.booking_id);
      for (const extra of extrasList ?? []) {
        if (!isParticipantExtraSelected(participant, extra.id, bookingExtras ?? [], participantActivitySelections ?? [])) continue;
        const group = ensure(extra.name);
        group.quantity += 1;
        group.participants.add(participantFullName(participant));
        if (booking?.reference) group.bookingReferences.add(booking.reference);
      }
    }
  }

  if (groups.size === 0) {
    for (const extra of bookingExtras ?? []) {
      const booking = bookingById.get(extra.booking_id);
      const group = ensure(extraName(extra));
      group.quantity += Number(extra.qty ?? extra.quantity ?? 1);
      if (booking?.reference) group.bookingReferences.add(booking.reference);
    }
  }

  return Array.from(groups.values()).map((group) => ({
    name: group.name,
    quantity: group.quantity,
    participants: Array.from(group.participants).filter(Boolean).join(", "),
    booking_references: Array.from(group.bookingReferences).filter(Boolean).join(", "),
  })).sort((a, b) => a.name.localeCompare(b.name));
};

const isParticipantExtraSelected = (participant: any, extraId: string, bookingExtras: any[], participantActivitySelections: any[]) => {
  const explicit = participantActivitySelections.find((selection) => selection.participant_id === participant.id && selection.extra_id === extraId);
  if (explicit) return Boolean(explicit.is_selected);
  return bookingExtras.some((extra) => extra.booking_id === participant.booking_id && extra.extra_id === extraId);
};

const normalizeRows = (rows: any[]): QuoteRow[] =>
  reindexRows(rows.map((row, index) => ({ ...row, local_id: row.id ?? crypto.randomUUID(), sort_order: row.sort_order ?? index, status: row.status ?? "todo", optional: Boolean(row.optional) })));

const reindexRows = (rows: QuoteRow[]): QuoteRow[] =>
  rows.map((row, index) => ({ ...row, sort_order: index }));

const buildInitialRows = ({ trip, programmeDays, hotels, rooms, bookings, participants, bookingExtras }: any): Record<QuoteSection, QuoteRow[]> => {
  const sortedHotels = [...(hotels.length ? hotels : [])].sort((a: any, b: any) =>
    (dateToTime(a.check_in) ?? Number.MAX_SAFE_INTEGER) - (dateToTime(b.check_in) ?? Number.MAX_SAFE_INTEGER)
    || Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)
  );
  const hotelRows = sortedHotels.flatMap((hotel: any, hotelIndex: number) => {
    const hotelRooms = rooms.filter((room: any) => room.trip_hotel_id === hotel.id);
    const detectedRoomCount = hotelRooms.length || 0;
    return DEFAULT_HOTEL_ROOM_TYPES.map((roomType, roomTypeIndex) => {
      const index = hotelIndex * DEFAULT_HOTEL_ROOM_TYPES.length + roomTypeIndex;
      return {
        ...blankRow("hotels", index),
        city: hotel.city ?? "",
        hotel_name: hotel.name ?? hotel.hotel_name ?? "",
        check_in: dateOnly(hotel.check_in),
        check_out: dateOnly(hotel.check_out),
        nights: nightsBetween(hotel.check_in, hotel.check_out) || 1,
        room_type: roomType,
        rooms_count: roomType === "double/twin" ? detectedRoomCount : 0,
      };
    });
  });
  const transportRows = programmeDays.map((day: any, index: number) => ({
    ...blankRow("transport", index),
    service_date: dateOnly(day.date),
    day_number: day.day_number,
    city_route: day.city || day.location || "",
    transport_type: guessTransportType(day.transport),
    description: day.transport || "",
  }));
  const guideRows = programmeDays.map((day: any, index: number) => ({
    ...blankRow("guides", index),
    service_date: dateOnly(day.date),
    city: day.city || day.location || "",
  }));
  const participantCount = getParticipantCount(participants, bookings ?? []);
  const optionalQuantities = aggregateOptionalActivityQuantities(bookingExtras, participants);
  const requiredActivityRows = DEFAULT_REQUIRED_ACTIVITIES.map((activity, index) => ({
    ...blankRow("activities", index),
    service_date: dateForDay(programmeDays, trip, activity.day_number),
    day_number: activity.day_number,
    activity_name: activity.activity_name,
    quantity: participantCount,
    unit_price_jpy: activity.unit_price_jpy,
    optional: false,
  }));
  const optionalActivityRows = DEFAULT_OPTIONAL_ACTIVITIES.map((activity, optionalIndex) => {
    const index = requiredActivityRows.length + optionalIndex;
    return {
      ...blankRow("activities", index),
      service_date: dateForDay(programmeDays, trip, activity.day_number),
      day_number: activity.day_number,
      activity_name: activity.activity_name,
      quantity: optionalQuantityForActivity(optionalQuantities, activity.aliases),
      unit_price_jpy: activity.unit_price_jpy,
      optional: true,
    };
  });
  return { hotels: hotelRows, transport: transportRows, activities: [...requiredActivityRows, ...optionalActivityRows], guides: guideRows, other: [] };
};

const parseOperationalState = (value: unknown): OperationalState => {
  if (!value) return { day_statuses: {}, day_comments: {} };
  if (typeof value === "object") {
    const parsed = value as any;
    return normalizeOperationalState(parsed);
  }
  try {
    return normalizeOperationalState(JSON.parse(String(value)));
  } catch {
    return { day_statuses: {}, day_comments: {}, legacy_notes: String(value) };
  }
};

const normalizeOperationalState = (value: any): OperationalState => ({
  day_statuses: value?.day_statuses && typeof value.day_statuses === "object" ? value.day_statuses : {},
  day_comments: value?.day_comments && typeof value.day_comments === "object" ? value.day_comments : {},
  legacy_notes: value?.legacy_notes ?? null,
});

const serializeOperationalState = (value: OperationalState) =>
  JSON.stringify({
    day_statuses: value.day_statuses ?? {},
    day_comments: value.day_comments ?? {},
    legacy_notes: value.legacy_notes ?? null,
  });

const resolveHotelForDay = (day: any, trip: any, hotels: any[]) => {
  const directHotel = day.hotel ?? day.metadata?.hotel;
  if (directHotel) {
    const direct = normalizeHotelValue(directHotel);
    if (direct.name !== "Hôtel à confirmer") return direct;
  }

  const dayTime = dateToTime(day.date);
  const sortedHotels = [...hotels]
    .filter((hotel) => [hotel.name, hotel.city, hotel.check_in, hotel.check_out, hotel.address, hotel.phone].some((value) => String(value ?? "").trim()))
    .sort((a, b) => (dateToTime(a.check_in) ?? Number.MAX_SAFE_INTEGER) - (dateToTime(b.check_in) ?? Number.MAX_SAFE_INTEGER) || Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));

  const matched = dayTime
    ? sortedHotels.find((hotel) => {
        const checkIn = dateToTime(hotel.check_in);
        const checkOut = dateToTime(hotel.check_out);
        return checkIn !== null && checkOut !== null && dayTime >= checkIn && dayTime < checkOut;
      })
    : null;
  const fallback = matched ?? (dayTime ? nearestHotelByDate(sortedHotels, dayTime) : null);
  if (fallback) return normalizeHotelValue(fallback);

  return normalizeHotelValue({
    name: trip.visa_hotel_name || "Hôtel à confirmer",
    city: "",
    address: trip.visa_hotel_address || "Adresse à confirmer",
    phone: trip.visa_hotel_phone || "Téléphone à confirmer",
  });
};

const nearestHotelByDate = (hotels: any[], targetTime: number) =>
  hotels
    .map((hotel) => ({ hotel, distance: Math.abs((dateToTime(hotel.check_in) ?? targetTime) - targetTime) }))
    .sort((a, b) => a.distance - b.distance)[0]?.hotel ?? null;

const normalizeHotelValue = (value: any) => {
  if (typeof value === "string") {
    return {
      name: safeText(value) || "Hôtel à confirmer",
      city: "Ville à confirmer",
      address: "Adresse à confirmer",
      phone: "Téléphone à confirmer",
      stay: "Dates à confirmer",
    };
  }
  return {
    name: safeText(value?.name || value?.hotel_name || value?.title) || "Hôtel à confirmer",
    city: safeText(value?.city) || "Ville à confirmer",
    address: safeText(value?.address) || "Adresse à confirmer",
    phone: safeText(value?.phone) || "Téléphone à confirmer",
    stay: [value?.check_in ? fmtDate(value.check_in) : null, value?.check_out ? fmtDate(value.check_out) : null].filter(Boolean).join(" → ") || "Dates à confirmer",
  };
};

const normalizeScheduleRows = (day: any) => {
  const source = firstScheduleSource(day);
  const rows = collectScheduleItems(source).map((item) => ({
    time: safeText(item.time || item.hour || item.start_time || item.start),
    activity: safeText(item.activity || item.visit || item.title || item.name || item.description),
    location: safeText(item.location || item.place || item.city || item.address),
    transport: safeText(item.transport || item.transfer || item.route),
    notes: safeText(item.notes || item.comment || item.description),
  })).filter((item) => Object.values(item).some(Boolean));

  if (rows.length > 0) return rows;
  return [{
    time: "",
    activity: formatActivities(day.activities || day.visits || day.description || day.title),
    location: safeText(day.city || day.location),
    transport: safeText(day.transport),
    notes: safeText(day.notes || day.metadata?.notes),
  }];
};

const firstScheduleSource = (day: any) =>
  day.schedule_items ?? day.activities ?? day.visits ?? day.metadata?.schedule_items ?? day.metadata?.activities ?? day.metadata?.visits ?? day.description;

const collectScheduleItems = (value: any): any[] => {
  if (!value) return [];
  if (typeof value === "string") {
    try {
      return collectScheduleItems(JSON.parse(value));
    } catch {
      return value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => ({ title: line }));
    }
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectScheduleItems(item));
  if (typeof value === "object") return [value];
  return [{ title: String(value) }];
};

const firstText = (...values: unknown[]) => {
  for (const value of values) {
    const text = safeText(value);
    if (text) return text;
  }
  return "";
};

const safeText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(safeText).filter(Boolean).join(" · ");
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return firstText(object.time, object.title, object.name, object.activity, object.visit, object.description, object.city, object.location);
  }
  return String(value);
};

const normalizeProgrammeDays = (rows: any[], trip: any) => {
  if (rows.length) {
    return rows
      .map((row, index) => ({
        ...row,
        local_id: row.id ?? `day-${index + 1}`,
        day_number: Number(row.day_number ?? index + 1),
        date: row.fixed_date ?? dateFromOffset(trip.start_date, Number(row.date_offset ?? row.day_number - 1 ?? index)),
      }))
      .sort((a, b) => Number(a.day_number) - Number(b.day_number));
  }
  const total = Number(trip.duration_days ?? 1);
  return Array.from({ length: Math.max(1, total) }, (_, index) => ({
    local_id: `generated-${index + 1}`,
    day_number: index + 1,
    date: dateFromOffset(trip.start_date, index),
    title: "Programme à compléter",
    activities: "À compléter",
  }));
};

const aggregateExtras = (extras: any[]) => {
  const map = new Map<string, { name: string; qty: number }>();
  extras.forEach((extra) => {
    const name = extraName(extra);
    const current = map.get(name) ?? { name, qty: 0 };
    current.qty += Number(extra.qty ?? extra.quantity ?? 1);
    map.set(name, current);
  });
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
};

const aggregateOptionalActivityQuantities = (bookingExtras: any[], participants: any[]) => {
  const map = new Map<string, number>();
  bookingExtras.forEach((extra) => {
    const name = normalizeActivityName(extraName(extra));
    if (!name) return;
    map.set(name, (map.get(name) ?? 0) + Number(extra.qty ?? extra.quantity ?? 1));
  });
  if (map.size > 0) return map;

  participants.forEach((participant) => {
    collectSelectedExtraEntries(participant.selected_extras ?? participant.metadata?.selected_extras).forEach((entry) => {
      const name = normalizeActivityName(entry.name);
      if (!name) return;
      map.set(name, (map.get(name) ?? 0) + Number(entry.quantity ?? 1));
    });
  });
  return map;
};

const collectSelectedExtraEntries = (value: any): Array<{ name: string; quantity: number }> => {
  if (!value) return [];
  if (typeof value === "string") {
    try {
      return collectSelectedExtraEntries(JSON.parse(value));
    } catch {
      return [{ name: value, quantity: 1 }];
    }
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectSelectedExtraEntries(item));
  }
  if (typeof value === "object") {
    const name = value.name ?? value.label ?? value.title ?? value.extra_name ?? value.activity_name ?? value.extra?.name;
    if (!name && value.id) return [];
    return [{ name: String(name ?? ""), quantity: Number(value.quantity ?? value.qty ?? 1) || 1 }];
  }
  return [];
};

const optionalQuantityForActivity = (quantities: Map<string, number>, aliases: readonly string[]) => {
  const normalizedAliases = aliases.map(normalizeActivityName).filter(Boolean);
  let total = 0;
  quantities.forEach((qty, normalizedName) => {
    if (normalizedAliases.some((alias) => normalizedName.includes(alias) || alias.includes(normalizedName))) {
      total += qty;
    }
  });
  return total;
};

const normalizeActivityName = (value: string) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const getParticipantCount = (participants: any[], bookings: any[]) => {
  if (participants.length > 0) return participants.length;
  return bookings.reduce((sum, booking) => sum + Number(booking.num_adults ?? 0) + Number(booking.num_children ?? 0), 0);
};

const dateForDay = (programmeDays: any[], trip: any, dayNumber: number) => {
  const programmeDay = programmeDays.find((day) => Number(day.day_number) === Number(dayNumber));
  return dateOnly(programmeDay?.date) || dateFromOffset(trip.start_date, Math.max(0, Number(dayNumber || 1) - 1));
};

const extraName = (extra: any) =>
  extra.name_snapshot || extra.name || extra.extras?.name || extra.metadata?.name || "Extra";

const participantFullName = (participant: any) =>
  [participant.first_name, participant.last_name].filter(Boolean).join(" ").trim()
  || participant.full_name
  || participant.metadata?.full_name
  || "Participant";

const participantRoomAssignment = (participant: any, rooms: any[], hotels: any[], assignments: any[]) => {
  const assignedRooms = assignments
    .filter((assignment) => assignment.participant_id === participant.id)
    .map((assignment) => {
      const room = rooms.find((item) => item.id === assignment.room_id);
      const hotel = hotels.find((item) => item.id === room?.trip_hotel_id);
      if (!room) return "";
      return [hotel?.name, room.room_number || room.room_name || "Chambre", room.room_type].filter(Boolean).join(" · ");
    })
    .filter(Boolean);
  return assignedRooms.length ? assignedRooms.join(" / ") : "Non assignée";
};

const selectedExtrasForParticipant = (participant: any, bookingExtras: any[], extrasList: any[], participantActivitySelections: any[]) => {
  const names = new Set<string>();
  extrasList.forEach((extra) => {
    if (isParticipantExtraSelected(participant, extra.id, bookingExtras, participantActivitySelections)) names.add(extra.name);
  });
  collectSelectedExtraEntries(participant.selected_extras ?? participant.metadata?.selected_extras).forEach((entry) => {
    if (entry.name) names.add(entry.name);
  });
  return Array.from(names).join(", ") || "—";
};

const bookingSourceLabel = (booking: any) => {
  if (!booking) return "—";
  if (booking.source === "agency" || booking.agency_organization_id) return "Agence partenaire";
  if (booking.source === "admin") return "Admin";
  return "Site LeJapon.ma";
};

const passportOcr = (participant: any) => participant?.metadata?.passport_ocr ?? participant?.passport_ocr ?? {};
const passportNumber = (participant: any) => firstText(participant.passport_no, participant.passport_number, participant.document_number, passportOcr(participant).passport_number, passportOcr(participant).passport_no);
const participantNationality = (participant: any) => firstText(participant.nationality, passportOcr(participant).nationality);
const participantBirthdate = (participant: any) => firstText(participant.date_of_birth, participant.birthdate, passportOcr(participant).birthdate, passportOcr(participant).date_of_birth);
const participantSex = (participant: any) => firstText(participant.sex, participant.gender, passportOcr(participant).sex);
const participantPassportExpiry = (participant: any) => firstText(participant.passport_expiry, participant.passport_expiry_date, passportOcr(participant).passport_expiry_date, passportOcr(participant).passport_expiry);
const participantPassportIssueDate = (participant: any) => firstText(participant.passport_issue_date, passportOcr(participant).passport_issue_date);
const participantNationalId = (participant: any) => firstText(participant.national_id_number, participant.cin, participant.id_card_no, passportOcr(participant).cin, passportOcr(participant).national_id_number);

const formatDateForDisplay = (value?: string | null) => {
  const text = String(value ?? "").trim();
  if (!text) return "—";
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) return text;
  const date = new Date(text.length === 10 ? `${text}T00:00:00` : text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const supplierExcelFilename = (trip: any) =>
  `lejapon-bureau-japon-${slugForFilename(trip?.title || "voyage")}-${new Date().toISOString().slice(0, 10)}`
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const slugForFilename = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

const sanitizeSheetName = (value: string) => value.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Feuille";
const roundNumber = (value: unknown) => Math.round(Number(value || 0));

const formatActivities = (value: any): string => {
  if (!value) return "À compléter";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => {
    if (typeof item === "string") return item;
    return [item.time, item.title, item.description, item.city].filter(Boolean).join(" - ");
  }).filter(Boolean).join("\n");
  if (typeof value === "object") return [value.time, value.title, value.description, value.city].filter(Boolean).join(" - ") || "À compléter";
  return String(value);
};

const isMissingTableError = (error: any) =>
  ["42P01", "PGRST205", "PGRST204"].includes(error?.code) || /Could not find the table|does not exist|schema cache/i.test(error?.message ?? "");

const dateOnly = (value: any) => typeof value === "string" ? value.slice(0, 10) : "";

const dateToTime = (value: any) => {
  const date = dateOnly(value);
  if (!date) return null;
  const time = new Date(`${date}T00:00:00`).getTime();
  return Number.isNaN(time) ? null : time;
};

const dateFromOffset = (startDate: string | null | undefined, offset: number) => {
  if (!startDate) return "";
  const date = new Date(`${startDate.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
};

const nightsBetween = (start?: string | null, end?: string | null) => {
  if (!start || !end) return 0;
  const a = new Date(`${start.slice(0, 10)}T00:00:00`).getTime();
  const b = new Date(`${end.slice(0, 10)}T00:00:00`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
};

const guessTransportType = (value: any) => {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("shinkansen")) return "shinkansen";
  if (text.includes("train")) return "train";
  if (text.includes("taxi")) return "taxi";
  if (text.includes("metro")) return "metro";
  if (text.includes("boat") || text.includes("bateau")) return "boat";
  return "bus";
};

const fmtJPY = (value: number) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Number(value || 0))} JPY`;
const fmtMAD = (value: number) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Number(value || 0))} MAD`;

const TotalCard = ({ label, value }: { label: string; value: number }) => (
  <Card className="p-4">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="font-display text-xl">{fmtJPY(value)}</p>
  </Card>
);

const SummaryMetric = ({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) => (
  <div className="rounded-lg bg-secondary/40 p-3">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className={strong ? "font-display text-lg text-primary" : "font-semibold"}>{value}</p>
  </div>
);
