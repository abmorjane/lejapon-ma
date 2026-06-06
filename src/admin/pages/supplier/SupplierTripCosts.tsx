import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowDown, ArrowLeft, ArrowUp, Download, MessageSquare, Paperclip, Plane, Plus, Save, Search, Send, Trash2 } from "lucide-react";
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
type ValidationItemKey = QuoteSection | "participants" | "rooming" | "documents";
type TripMessageType = "general" | "hotel" | "transport" | "activities" | "guides" | "urgent";
type TripDocumentCategory = "hotel_vouchers" | "transport_vouchers" | "guide_confirmations" | "flight_tickets" | "rooming_lists" | "emergency_contacts" | "contracts" | "other";
type SupplierValidationStatus = "draft" | "in_progress" | "ready_for_japan_office" | "japan_office_confirmed" | "ready_to_travel";

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

type QuoteEngineDiagnostic = {
  label: string;
  ok: boolean;
  code?: string | null;
  message?: string | null;
  details?: string | null;
};

type TripMessageAttachment = {
  id?: string;
  message_id: string;
  file_name: string;
  file_path?: string | null;
  file_url?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  created_at?: string | null;
};

type TripMessage = {
  id: string;
  trip_id: string;
  quote_id?: string | null;
  message_type: TripMessageType;
  body: string;
  sender_id?: string | null;
  sender_name?: string | null;
  sender_role?: string | null;
  sender_source?: string | null;
  created_at: string;
  updated_at?: string | null;
  attachments?: TripMessageAttachment[];
};

type TripDocument = {
  id: string;
  trip_id: string;
  quote_id?: string | null;
  category: TripDocumentCategory;
  title: string;
  file_name: string;
  file_path?: string | null;
  file_url?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  version: number;
  uploaded_by?: string | null;
  uploaded_by_name?: string | null;
  uploaded_by_role?: string | null;
  uploaded_at: string;
  updated_at?: string | null;
  deleted_at?: string | null;
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

const messageTypeLabel: Record<TripMessageType, string> = {
  general: "Général",
  hotel: "Hôtel",
  transport: "Transport",
  activities: "Activités",
  guides: "Guides",
  urgent: "Urgent",
};

const messageTypes = Object.keys(messageTypeLabel) as TripMessageType[];
const tripMessageAttachmentBucket = "trip-message-attachments";

const tripDocumentCategoryLabel: Record<TripDocumentCategory, string> = {
  hotel_vouchers: "Hotel vouchers",
  transport_vouchers: "Transport vouchers",
  guide_confirmations: "Guide confirmations",
  flight_tickets: "Flight tickets",
  rooming_lists: "Rooming lists",
  emergency_contacts: "Emergency contacts",
  contracts: "Contracts",
  other: "Other",
};

const tripDocumentCategories = Object.keys(tripDocumentCategoryLabel) as TripDocumentCategory[];
const tripDocumentBucket = "trip-documents";

const mandatoryTripDocumentCategories: TripDocumentCategory[] = [
  "hotel_vouchers",
  "transport_vouchers",
  "guide_confirmations",
  "flight_tickets",
  "rooming_lists",
  "emergency_contacts",
  "contracts",
];

const validationStatusLabel: Record<SupplierValidationStatus, string> = {
  draft: "Draft",
  in_progress: "In Progress",
  ready_for_japan_office: "Ready For Japan Office",
  japan_office_confirmed: "Japan Office Confirmed",
  ready_to_travel: "Ready To Travel",
};

const validationStatusOrder: SupplierValidationStatus[] = ["draft", "in_progress", "ready_for_japan_office", "japan_office_confirmed", "ready_to_travel"];
const validationDbColumns = [
  "validation_status",
  "validation_snapshot",
  "validation_metadata",
  "validation_completion_percentage",
  "validation_updated_by",
  "validation_updated_at",
] as const;

const transportTypes = ["bus", "metro", "taxi", "train", "shinkansen", "boat", "other"];
const guideTypes = ["francophone", "anglophone", "japanese", "assistant", "other"];
const roomTypes = ["double/twin", "single", "triple", "TL"];

const DEFAULT_HOTEL_ROOM_TYPES = ["double/twin", "single", "triple", "TL"] as const;

const DEFAULT_GUIDE_ROWS = [
  { day_number: 2, guide_type: "French or English speaking assistant", daily_price_jpy: 30000 },
  { day_number: 3, guide_type: "French or English speaking guide (Shibuya)", daily_price_jpy: 50000 },
  { day_number: 4, guide_type: "French or English speaking guide (Odaiba)", daily_price_jpy: 50000 },
  { day_number: 5, guide_type: "French or English speaking guide (Kamakura)", daily_price_jpy: 60000 },
  { day_number: 6, guide_type: "French or English speaking guide (Hakone)", daily_price_jpy: 60000 },
  { day_number: 7, guide_type: "French speaking guide (Kyoto) - Monsieur Koenuma", daily_price_jpy: 65000 },
  { day_number: 9, guide_type: "French speaking guide (Kyoto - Nara - Osaka)", daily_price_jpy: 65000 },
  { day_number: 10, guide_type: "French speaking guide (Hiroshima - Miyajima) - Madame Sekimura", daily_price_jpy: 55000 },
  { day_number: 11, guide_type: "French or English speaking guide (Osaka) - Monsieur Koenuma", daily_price_jpy: 65000 },
  { day_number: 15, guide_type: "French or English speaking guide (Asakusa - Akihabara) - Monsieur Atsushi au Kanto", daily_price_jpy: 55000 },
  { day_number: 16, guide_type: "French or English speaking assistant", daily_price_jpy: 30000 },
] as const;

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
  const [lastQuoteEngineError, setLastQuoteEngineError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<QuoteEngineDiagnostic[]>([]);
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<QuoteStatus>("draft");
  const [validationStatus, setValidationStatus] = useState<SupplierValidationStatus>("draft");
  const [validationBusy, setValidationBusy] = useState(false);
  const [validationOverrides, setValidationOverrides] = useState<Partial<Record<ValidationItemKey, boolean>>>({});
  const [commissionPct, setCommissionPct] = useState(10);
  const [exchangeRate, setExchangeRate] = useState(0.068);
  const [internalNotes, setInternalNotes] = useState("");
  const [operationalState, setOperationalState] = useState<OperationalState>({ day_statuses: {}, day_comments: {} });
  const [activeTab, setActiveTab] = useState("quote");
  const [messages, setMessages] = useState<TripMessage[]>([]);
  const [messageReads, setMessageReads] = useState<Record<string, string>>({});
  const [messageDraft, setMessageDraft] = useState("");
  const [messageType, setMessageType] = useState<TripMessageType>("general");
  const [messageSearch, setMessageSearch] = useState("");
  const [messageFilter, setMessageFilter] = useState<TripMessageType | "all">("all");
  const [messageFiles, setMessageFiles] = useState<File[]>([]);
  const [messageBusy, setMessageBusy] = useState(false);
  const [messagesSqlMissing, setMessagesSqlMissing] = useState(false);
  const [documents, setDocuments] = useState<TripDocument[]>([]);
  const [documentCategory, setDocumentCategory] = useState<TripDocumentCategory>("hotel_vouchers");
  const [documentTitle, setDocumentTitle] = useState("");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentSearch, setDocumentSearch] = useState("");
  const [documentFilter, setDocumentFilter] = useState<TripDocumentCategory | "all">("all");
  const [documentBusy, setDocumentBusy] = useState(false);
  const [documentsSqlMissing, setDocumentsSqlMissing] = useState(false);

  const isAdmin = roles.some((role) => ["super_admin", "admin"].includes(role));
  const canEdit = isAdmin || ["draft", "submitted", "revision_requested"].includes(status);
  const unreadMessageCount = useMemo(
    () => messages.filter((message) => message.sender_id !== user?.id && !messageReads[message.id]).length,
    [messageReads, messages, user?.id]
  );
  const validation = useMemo(
    () => buildSupplierValidation({
      rows,
      participants,
      rooms,
      assignments,
      documents,
      overrides: validationOverrides,
    }),
    [assignments, documents, participants, rooms, rows, validationOverrides]
  );

  useEffect(() => {
    void load();
  }, [tripId, user?.id]);

  useEffect(() => {
    if (activeTab === "messages") void markMessagesRead(messages);
  }, [activeTab, messages.length]);

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
      db.from("bookings").select("id,reference,contact_name,contact_email,contact_phone,contact_city,num_adults,num_children,room_type,formula,status,source,agency_organization_id,special_requests,total_amount_mad,paid_amount_mad,metadata,created_at").eq("trip_id", tripId),
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
      setValidationStatus((loadedQuote.quote.validation_status ?? "draft") as SupplierValidationStatus);
      setCommissionPct(Number(loadedQuote.quote.commission_percentage ?? loadedQuote.quote.commission_percent ?? 10));
      setExchangeRate(Number(loadedQuote.quote.exchange_rate_jpy_mad ?? 0.068));
      setInternalNotes(loadedQuote.quote.internal_notes ?? loadedQuote.quote.admin_notes ?? "");
      setOperationalState(parseOperationalState(loadedQuote.quote.supplier_notes));
      setValidationOverrides(extractValidationOverrides(loadedQuote.quote));
      setRows(loadedQuote.rows);
    } else {
      const initialRows = buildInitialRows({
        trip: tripRow,
        programmeDays: normalizeProgrammeDays(dayRows ?? [], tripRow),
        hotels: hotelRows ?? [],
        rooms: roomRows ?? [],
        assignments: assignmentRows ?? [],
        bookings: bookingRows ?? [],
        participants: participantList,
        bookingExtras: extrasRows ?? [],
      });
      setQuote(null);
      setStatus("draft");
      setValidationStatus("draft");
      setCommissionPct(10);
      setExchangeRate(0.068);
      setInternalNotes("");
      setOperationalState({ day_statuses: {}, day_comments: {} });
      setValidationOverrides({});
      setRows(initialRows);
    }
    await loadMessages(tripId);
    await loadDocuments(tripId);
  };

  const loadMessages = async (targetTripId = tripId) => {
    if (!targetTripId || !user) return;
    setMessagesSqlMissing(false);
    const { data, error } = await db
      .from("trip_messages")
      .select("*")
      .eq("trip_id", targetTripId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });
    if (error) {
      if (isMissingTableError(error)) setMessagesSqlMissing(true);
      return;
    }

    const messageRows = (data ?? []) as TripMessage[];
    const messageIds = messageRows.map((message) => message.id);
    let attachmentsByMessage = new Map<string, TripMessageAttachment[]>();
    if (messageIds.length) {
      const { data: attachmentRows } = await db
        .from("trip_message_attachments")
        .select("*")
        .in("message_id", messageIds)
        .order("created_at", { ascending: true });
      const signedAttachments = await Promise.all((attachmentRows ?? []).map(async (attachment: TripMessageAttachment) => ({
        ...attachment,
        file_url: await signedAttachmentUrl(attachment),
      })));
      attachmentsByMessage = signedAttachments.reduce((map, attachment) => {
        map.set(attachment.message_id, [...(map.get(attachment.message_id) ?? []), attachment]);
        return map;
      }, new Map<string, TripMessageAttachment[]>());
    }

    const { data: readRows } = messageIds.length
      ? await db.from("trip_message_reads").select("message_id,read_at").eq("user_id", user.id).in("message_id", messageIds)
      : { data: [] };

    const nextMessages = messageRows.map((message) => ({
      ...message,
      attachments: attachmentsByMessage.get(message.id) ?? [],
    }));
    setMessages(nextMessages);
    setMessageReads(Object.fromEntries((readRows ?? []).map((row: any) => [row.message_id, row.read_at])));
    if (activeTab === "messages") await markMessagesRead(nextMessages);
  };

  const markMessagesRead = async (messageList: TripMessage[]) => {
    if (!user?.id || !messageList.length) return;
    const unread = messageList.filter((message) => message.sender_id !== user.id && !messageReads[message.id]);
    if (!unread.length) return;
    const now = new Date().toISOString();
    const payload = unread.map((message) => ({ message_id: message.id, user_id: user.id, read_at: now }));
    const { error } = await db.from("trip_message_reads").upsert(payload, { onConflict: "message_id,user_id" });
    if (!error) {
      setMessageReads((current) => ({
        ...current,
        ...Object.fromEntries(unread.map((message) => [message.id, now])),
      }));
    }
  };

  const sendTripMessage = async () => {
    if (!tripId || !user) return;
    const body = messageDraft.trim();
    if (!body && messageFiles.length === 0) return;
    setMessageBusy(true);
    try {
      const { data: message, error } = await db
        .from("trip_messages")
        .insert({
          trip_id: tripId,
          quote_id: quote?.id ?? null,
          message_type: messageType,
          body: body || "Pièce jointe",
          sender_id: user.id,
          sender_name: user.user_metadata?.full_name || user.email || "Utilisateur",
          sender_role: roles[0] ?? (isAdmin ? "admin" : "supplier"),
          sender_source: isAdmin ? "morocco_office" : "japan_office",
          metadata: { notify: isAdmin ? "supplier_users" : "admin_users" },
        })
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!message?.id) throw new Error("Message non sauvegardé.");

      for (const file of messageFiles) {
        const safeName = safeStorageFilename(file.name);
        const path = `${tripId}/${message.id}/${Date.now()}-${safeName}`;
        const upload = await supabase.storage.from(tripMessageAttachmentBucket).upload(path, file, { upsert: false });
        if (upload.error) throw upload.error;
        const { error: attachmentError } = await db.from("trip_message_attachments").insert({
          message_id: message.id,
          file_name: file.name,
          file_path: path,
          mime_type: file.type || null,
          size_bytes: file.size,
          uploaded_by: user.id,
        });
        if (attachmentError) throw attachmentError;
      }

      setMessageDraft("");
      setMessageFiles([]);
      toast.success("Message envoyé.");
      await loadMessages(tripId);
    } catch (error: any) {
      if (isMissingTableError(error)) setMessagesSqlMissing(true);
      toast.error(error?.message ?? "Envoi du message impossible.");
    } finally {
      setMessageBusy(false);
    }
  };

  const loadDocuments = async (targetTripId = tripId) => {
    if (!targetTripId || !user) return;
    setDocumentsSqlMissing(false);
    const { data, error } = await db
      .from("trip_documents")
      .select("*")
      .eq("trip_id", targetTripId)
      .is("deleted_at", null)
      .order("category", { ascending: true })
      .order("uploaded_at", { ascending: false });
    if (error) {
      if (isMissingTableError(error)) setDocumentsSqlMissing(true);
      return;
    }
    const signedDocuments = await Promise.all((data ?? []).map(async (document: TripDocument) => ({
      ...document,
      file_url: await signedTripDocumentUrl(document),
    })));
    setDocuments(signedDocuments);
  };

  const uploadTripDocument = async () => {
    if (!tripId || !user || !documentFile) return;
    setDocumentBusy(true);
    try {
      const safeName = safeStorageFilename(documentFile.name);
      const path = `${tripId}/${documentCategory}/${Date.now()}-${safeName}`;
      const upload = await supabase.storage.from(tripDocumentBucket).upload(path, documentFile, { upsert: false });
      if (upload.error) throw upload.error;
      const now = new Date().toISOString();
      const { error } = await db.from("trip_documents").insert({
        trip_id: tripId,
        quote_id: quote?.id ?? null,
        category: documentCategory,
        title: documentTitle.trim() || documentFile.name,
        file_name: documentFile.name,
        file_path: path,
        mime_type: documentFile.type || null,
        size_bytes: documentFile.size,
        version: 1,
        uploaded_by: user.id,
        uploaded_by_name: user.user_metadata?.full_name || user.email || "Utilisateur",
        uploaded_by_role: roles[0] ?? (isAdmin ? "admin" : "supplier"),
        uploaded_at: now,
        updated_at: now,
      });
      if (error) throw error;
      setDocumentTitle("");
      setDocumentFile(null);
      toast.success("Document ajouté.");
      await loadDocuments(tripId);
    } catch (error: any) {
      if (isMissingTableError(error)) setDocumentsSqlMissing(true);
      toast.error(error?.message ?? "Upload du document impossible.");
    } finally {
      setDocumentBusy(false);
    }
  };

  const replaceTripDocument = async (document: TripDocument, file: File) => {
    if (!tripId || !user) return;
    setDocumentBusy(true);
    try {
      const safeName = safeStorageFilename(file.name);
      const path = `${tripId}/${document.category}/${document.id}/v${Number(document.version || 1) + 1}-${Date.now()}-${safeName}`;
      const upload = await supabase.storage.from(tripDocumentBucket).upload(path, file, { upsert: false });
      if (upload.error) throw upload.error;
      if (document.file_path) await supabase.storage.from(tripDocumentBucket).remove([document.file_path]);
      const now = new Date().toISOString();
      const { error } = await db
        .from("trip_documents")
        .update({
          file_name: file.name,
          file_path: path,
          mime_type: file.type || null,
          size_bytes: file.size,
          version: Number(document.version || 1) + 1,
          uploaded_by: user.id,
          uploaded_by_name: user.user_metadata?.full_name || user.email || "Utilisateur",
          uploaded_by_role: roles[0] ?? (isAdmin ? "admin" : "supplier"),
          uploaded_at: now,
          updated_at: now,
        })
        .eq("id", document.id);
      if (error) throw error;
      toast.success("Version remplacée.");
      await loadDocuments(tripId);
    } catch (error: any) {
      toast.error(error?.message ?? "Remplacement impossible.");
    } finally {
      setDocumentBusy(false);
    }
  };

  const deleteTripDocument = async (document: TripDocument) => {
    if (!tripId) return;
    setDocumentBusy(true);
    try {
      if (document.file_path) await supabase.storage.from(tripDocumentBucket).remove([document.file_path]);
      const { error } = await db.from("trip_documents").update({ deleted_at: new Date().toISOString() }).eq("id", document.id);
      if (error) throw error;
      toast.success("Document supprimé.");
      await loadDocuments(tripId);
    } catch (error: any) {
      toast.error(error?.message ?? "Suppression impossible.");
    } finally {
      setDocumentBusy(false);
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
      setLastQuoteEngineError(formatSupabaseError(error));
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
      if (error) {
        setLastQuoteEngineError(`${tableBySection[section]}: ${formatSupabaseError(error)}`);
        if (isMissingTableError(error)) setSqlMissing(true);
      }
      return [section, normalizeRows(section, data ?? [])] as const;
    }));

    return {
      quote,
      rows: Object.fromEntries(sectionResults) as Record<QuoteSection, QuoteRow[]>,
    };
  };

  const totals = useMemo(
    () => calculateQuoteTotals(rows, commissionPct, exchangeRate, participants, bookings),
    [bookings, commissionPct, exchangeRate, participants, rows]
  );

  const buildValidationForSave = (
    rowsToValidate: Record<QuoteSection, QuoteRow[]> = rows,
    overridesToValidate: Partial<Record<ValidationItemKey, boolean>> = validationOverrides
  ) => buildSupplierValidation({
    rows: rowsToValidate,
    participants,
    rooms,
    assignments,
    documents,
    overrides: overridesToValidate,
  });

  const saveQuote = async (
    nextStatus = status,
    options: {
      rowsOverride?: Record<QuoteSection, QuoteRow[]>;
      validationOverridesOverride?: Partial<Record<ValidationItemKey, boolean>>;
      validationStatusOverride?: SupplierValidationStatus;
    } = {}
  ) => {
    if (!tripId) return null;
    if (sqlMissing) {
      toast.error(lastQuoteEngineError ? `Migration SQL quote engine requise: ${lastQuoteEngineError}` : "Migration SQL quote engine requise avant l'enregistrement.");
      return null;
    }
    setBusy(true);
    try {
      const rowsToSave = options.rowsOverride ?? rows;
      const overridesToSave = options.validationOverridesOverride ?? validationOverrides;
      const validationStatusToSave = options.validationStatusOverride ?? validationStatus;
      const validationForSave = buildValidationForSave(rowsToSave, overridesToSave);
      const totalsForSave = calculateQuoteTotals(rowsToSave, commissionPct, exchangeRate, participants, bookings);
      const validationMetadata = {
        manual_overrides: overridesToSave,
        completion_percentage: validationForSave.completionPercentage,
        updated_at: new Date().toISOString(),
      };
      const quotePayloadBase = {
        trip_id: tripId,
        supplier_id: supplierId,
        status: nextStatus,
        commission_percentage: commissionPct,
        exchange_rate_jpy_mad: exchangeRate,
        participant_count: totalsForSave.participantCount,
        total_hotels_jpy: totalsForSave.hotels,
        total_transport_jpy: totalsForSave.transport,
        total_activities_jpy: totalsForSave.activities,
        total_guides_jpy: totalsForSave.guides,
        total_other_jpy: totalsForSave.other,
        grand_total_jpy: totalsForSave.grandTotalJpy,
        commission_amount_jpy: totalsForSave.commissionAmountJpy,
        final_total_jpy: totalsForSave.finalTotalJpy,
        final_total_mad: totalsForSave.finalTotalMad,
        cost_per_person_jpy: totalsForSave.costPerPersonJpy,
        cost_per_person_mad: totalsForSave.costPerPersonMad,
        supplier_notes: serializeOperationalState(operationalState),
        internal_notes: internalNotes || null,
        updated_by: user?.id ?? null,
      };
      const quotePayloadValidation = {
        validation_status: validationStatusToSave,
        validation_snapshot: { ...validationForSave, manual_overrides: overridesToSave },
        validation_metadata: validationMetadata,
        validation_completion_percentage: validationForSave.completionPercentage,
        validation_updated_by: user?.id ?? null,
        validation_updated_at: new Date().toISOString(),
      };

      let quotePayload: Record<string, any> = { ...quotePayloadBase, ...quotePayloadValidation };
      let quoteResult: any = null;
      for (let attempt = 0; attempt <= validationDbColumns.length; attempt += 1) {
        quoteResult = quote?.id
          ? await db.from("supplier_trip_quotes").update(quotePayload).eq("id", quote.id).select("*").maybeSingle()
          : await db.from("supplier_trip_quotes").insert({ ...quotePayload, created_by: user?.id ?? null }).select("*").maybeSingle();
        if (!quoteResult.error) break;
        const missingColumn = missingValidationColumnName(quoteResult.error);
        if (!missingColumn || !(missingColumn in quotePayload)) break;
        const nextPayload = { ...quotePayload };
        delete nextPayload[missingColumn];
        quotePayload = nextPayload;
      }
      if (quoteResult?.error) throw withQueryContext(quoteResult.error, "supplier_trip_quotes save");
      const savedQuote = quoteResult.data;
      if (!savedQuote?.id) throw new Error("Demande de devis non sauvegardée.");

      for (const section of Object.keys(tableBySection) as QuoteSection[]) {
        await db.from(tableBySection[section]).delete().eq("quote_id", savedQuote.id);
        const payload = rowsToSave[section].map((row, index) => serializeRow(section, row, savedQuote.id, index));
        if (payload.length) {
          const { error } = await db.from(tableBySection[section]).insert(payload);
          if (error) throw withQueryContext(error, `${tableBySection[section]} insert`);
        }
      }

      setQuote(savedQuote);
      setStatus(nextStatus as QuoteStatus);
      setValidationStatus(validationStatusToSave);
      toast.success(nextStatus === "submitted" ? "Devis soumis à l'équipe LeJapon.ma." : "Devis enregistré.");
      await load();
      return savedQuote;
    } catch (error: any) {
      setLastQuoteEngineError(formatSupabaseError(error));
      if (isMissingTableError(error)) {
        setSqlMissing(true);
        toast.error(`Migration SQL quote engine requise: ${formatSupabaseError(error)}`);
      } else {
        toast.error(error?.message ?? "Enregistrement impossible.");
      }
      return null;
    } finally {
      setBusy(false);
    }
  };

  const updateValidationStatus = async (nextStatus: SupplierValidationStatus) => {
    if (!tripId || !user) return;
    const blockingErrors = validationBlockingErrors(nextStatus, validationStatus, validation);
    if (blockingErrors.length > 0) {
      toast.error(blockingErrors[0]);
      return;
    }
    setValidationBusy(true);
    try {
      const saved = await saveQuote(status, { validationStatusOverride: nextStatus });
      if (!saved?.id) throw new Error("Enregistrez le devis avant de modifier le workflow.");
      setValidationStatus(nextStatus);
      toast.success(`Statut workflow: ${validationStatusLabel[nextStatus]}`);
    } catch (error: any) {
      toast.error(error?.message ?? "Mise à jour du workflow impossible.");
    } finally {
      setValidationBusy(false);
    }
  };

  const bulkSetValidationSection = async (section: ValidationItemKey, confirmed: boolean) => {
    if (!canEdit) return;
    setValidationBusy(true);
    try {
      if (isQuoteSection(section)) {
        const nextRows = {
          ...rows,
          [section]: normalizeRows(section, rows[section].map((row) => ({ ...row, status: confirmed ? "confirmed" : "todo" }))),
        };
        setRows(nextRows);
        await saveQuote(status, { rowsOverride: nextRows });
      } else {
        const nextOverrides = { ...validationOverrides, [section]: confirmed };
        setValidationOverrides(nextOverrides);
        await saveQuote(status, { validationOverridesOverride: nextOverrides });
      }
      toast.success(confirmed ? "Section validée." : "Section remise à faire.");
    } catch (error: any) {
      toast.error(error?.message ?? "Mise à jour de la validation impossible.");
    } finally {
      setValidationBusy(false);
    }
  };

  const updateRows = (section: QuoteSection, nextRows: QuoteRow[]) => {
    setRows((current) => ({ ...current, [section]: normalizeRows(section, nextRows) }));
  };

  const addRow = (section: QuoteSection) => {
    updateRows(section, [...rows[section], blankRow(section, rows[section].length)]);
  };

  const runQuoteEngineDiagnostics = async () => {
    if (!tripId || !isAdmin) return;
    setDiagnosticBusy(true);
    const next: QuoteEngineDiagnostic[] = [];
    const addResult = (label: string, error: any, details?: string | null) => {
      next.push({
        label,
        ok: !error,
        code: error?.code ?? null,
        message: error?.message ?? null,
        details: details ?? error?.details ?? error?.hint ?? null,
      });
    };

    const tables = ["supplier_trip_quotes", ...Object.values(tableBySection), "supplier_quote_comments"];
    for (const table of tables) {
      const { error } = await db.from(table).select("*").limit(1);
      addResult(`SELECT ${table}`, error);
    }

    const diagnosticQuotePayload = {
      trip_id: tripId,
      supplier_id: null,
      status: "draft",
      commission_percentage: commissionPct,
      exchange_rate_jpy_mad: exchangeRate,
      participant_count: totals.participantCount,
      total_hotels_jpy: 0,
      total_transport_jpy: 0,
      total_activities_jpy: 0,
      total_guides_jpy: 0,
      total_other_jpy: 0,
      grand_total_jpy: 0,
      commission_amount_jpy: 0,
      final_total_jpy: 0,
      final_total_mad: 0,
      cost_per_person_jpy: 0,
      cost_per_person_mad: 0,
      supplier_notes: serializeOperationalState({ day_statuses: {}, day_comments: {}, legacy_notes: "diagnostic" }),
      internal_notes: "diagnostic",
      created_by: user?.id ?? null,
      updated_by: user?.id ?? null,
      metadata: { diagnostic: true },
    };

    const quoteInsert = await db.from("supplier_trip_quotes").insert(diagnosticQuotePayload).select("*").maybeSingle();
    addResult("INSERT supplier_trip_quotes diagnostic payload", quoteInsert.error);
    const diagnosticQuoteId = quoteInsert.data?.id;

    if (diagnosticQuoteId) {
      const hotelInsert = await db.from("supplier_quote_hotel_rows").insert({
        quote_id: diagnosticQuoteId,
        sort_order: 0,
        city: "Diagnostic",
        hotel_name: "Diagnostic",
        check_in: null,
        check_out: null,
        nights: 1,
        room_type: "double/twin",
        rooms_count: 1,
        unit_price_jpy: 1,
        subtotal_jpy: 1,
        status: "todo",
        comment: "diagnostic",
        metadata: { diagnostic: true },
      });
      addResult("INSERT supplier_quote_hotel_rows diagnostic payload", hotelInsert.error);

      const guideInsert = await db.from("supplier_quote_guide_rows").insert({
        quote_id: diagnosticQuoteId,
        sort_order: 0,
        service_date: null,
        city: "Diagnostic",
        guide_type: "francophone",
        guides_count: 1,
        daily_price_jpy: 1,
        subtotal_jpy: 1,
        status: "todo",
        comment: "diagnostic",
        metadata: { diagnostic: true },
      });
      addResult("INSERT supplier_quote_guide_rows diagnostic payload", guideInsert.error);

      for (const table of [...Object.values(tableBySection), "supplier_quote_comments"]) {
        await db.from(table).delete().eq("quote_id", diagnosticQuoteId);
      }
      const cleanup = await db.from("supplier_trip_quotes").delete().eq("id", diagnosticQuoteId);
      addResult("DELETE diagnostic quote cleanup", cleanup.error);
    }

    setDiagnostics(next);
    const firstError = next.find((item) => !item.ok);
    setLastQuoteEngineError(firstError ? `${firstError.label}: ${firstError.code ?? ""} ${firstError.message ?? ""}`.trim() : null);
    setDiagnosticBusy(false);
  };

  const exportExcel = async (scope: "quote" | "operations" | "participants" | "rooms_extras" | "global" | "operational_book") => {
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
    } else if (scope === "operational_book") {
      const book = buildOperationalBookContext({
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
        supplierName,
      });
      await exportWorkbook(`${fileBase}-dossier-operationnel.xlsx`, [
        { name: "Summary", rows: book.summaryRows },
        { name: "Flights", rows: book.flightRows },
        { name: "Hotels", rows: book.hotelRows },
        { name: "Rooming List", rows: book.roomingRows },
        { name: "Participants", rows: book.participantRows },
        { name: "Activities", rows: book.activityRows },
        { name: "Guides", rows: book.guideRows },
        { name: "Transport", rows: book.transportRows },
        { name: "Emergency Contacts", rows: book.emergencyContactRows },
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
          {lastQuoteEngineError && <p className="mt-2 font-mono text-xs">{lastQuoteEngineError}</p>}
        </Card>
      )}

      {isAdmin && (
        <Card className="border-dashed p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Diagnostic quote engine</h2>
              <p className="text-muted-foreground">Visible admin uniquement. Teste les tables, RLS et colonnes utilisées par cette page.</p>
            </div>
            <Button type="button" variant="outline" onClick={runQuoteEngineDiagnostics} disabled={diagnosticBusy}>
              {diagnosticBusy ? "Test en cours..." : "Tester accès SQL"}
            </Button>
          </div>
          {lastQuoteEngineError && <p className="mt-3 rounded bg-muted px-3 py-2 font-mono text-xs">{lastQuoteEngineError}</p>}
          {diagnostics.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-[720px] text-left text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="py-2 pr-3">Test</th>
                    <th className="py-2 pr-3">Statut</th>
                    <th className="py-2 pr-3">Code</th>
                    <th className="py-2 pr-3">Erreur</th>
                  </tr>
                </thead>
                <tbody>
                  {diagnostics.map((item) => (
                    <tr key={item.label} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-mono">{item.label}</td>
                      <td className="py-2 pr-3">{item.ok ? <Badge variant="outline">OK</Badge> : <Badge variant="destructive">Erreur</Badge>}</td>
                      <td className="py-2 pr-3 font-mono">{item.code || "—"}</td>
                      <td className="py-2 pr-3">{item.message || item.details || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <SupplierValidationWorkflow
        validation={validation}
        status={validationStatus}
        busy={validationBusy || busy}
        canEdit={canEdit}
        onStatusChange={updateValidationStatus}
        onBulkSectionChange={bulkSetValidationSection}
      />

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
            <Button size="sm" onClick={() => void exportExcel("operational_book")}><Download className="h-4 w-4" /> Exporter dossier opérationnel</Button>
          </div>
        </div>
      </Card>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value)} className="space-y-4">
        <TabsList className={`grid h-auto w-full grid-cols-1 ${isAdmin ? "md:grid-cols-4 xl:grid-cols-7" : "md:grid-cols-3 xl:grid-cols-6"}`}>
          <TabsTrigger value="quote">Devis</TabsTrigger>
          {isAdmin && <TabsTrigger value="financial">Bilan financier</TabsTrigger>}
          <TabsTrigger value="messages" className="gap-2">
            Messages
            {unreadMessageCount > 0 && <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">{unreadMessageCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
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

        {isAdmin && (
          <TabsContent value="financial">
            <FinancialDashboard rows={rows} totals={totals} bookings={bookings} participants={participants} exchangeRate={exchangeRate} />
          </TabsContent>
        )}

        <TabsContent value="messages">
          <TripMessagesCenter
            messages={messages}
            messageType={messageType}
            messageDraft={messageDraft}
            messageFiles={messageFiles}
            messageSearch={messageSearch}
            messageFilter={messageFilter}
            messageBusy={messageBusy}
            messagesSqlMissing={messagesSqlMissing}
            currentUserId={user?.id ?? null}
            canSend={Boolean(user)}
            onTypeChange={setMessageType}
            onDraftChange={setMessageDraft}
            onFilesChange={setMessageFiles}
            onSearchChange={setMessageSearch}
            onFilterChange={setMessageFilter}
            onSend={sendTripMessage}
          />
        </TabsContent>

        <TabsContent value="documents">
          <TripDocumentsCenter
            documents={documents}
            category={documentCategory}
            title={documentTitle}
            file={documentFile}
            search={documentSearch}
            filter={documentFilter}
            busy={documentBusy}
            sqlMissing={documentsSqlMissing}
            onCategoryChange={setDocumentCategory}
            onTitleChange={setDocumentTitle}
            onFileChange={setDocumentFile}
            onSearchChange={setDocumentSearch}
            onFilterChange={setDocumentFilter}
            onUpload={uploadTripDocument}
            onReplace={replaceTripDocument}
            onDelete={deleteTripDocument}
          />
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

function FinancialDashboard({
  rows,
  totals,
  bookings,
  participants,
  exchangeRate,
}: {
  rows: Record<QuoteSection, QuoteRow[]>;
  totals: any;
  bookings: any[];
  participants: any[];
  exchangeRate: number;
}) {
  const passengerCount = participants.length || getParticipantCount([], bookings) || 0;
  const safePassengerCount = Math.max(1, passengerCount || 1);
  const safeExchangeRate = Number(exchangeRate || 0);
  const revenueMad = bookings.reduce((sum, booking) => sum + numeric(booking.total_amount_mad), 0);
  const revenueJpy = safeExchangeRate > 0 ? revenueMad / safeExchangeRate : 0;
  const revenuePerPassengerMad = passengerCount > 0 ? revenueMad / safePassengerCount : 0;
  const revenuePerPassengerJpy = passengerCount > 0 ? revenueJpy / safePassengerCount : 0;
  const supplierCostMad = totals.grandTotalJpy * safeExchangeRate;
  const grossMarginMad = revenueMad - supplierCostMad;
  const grossMarginJpy = revenueJpy - totals.grandTotalJpy;
  const netProfitMad = revenueMad - totals.finalTotalMad;
  const netProfitJpy = revenueJpy - totals.finalTotalJpy;
  const marginPercent = revenueMad > 0 ? (netProfitMad / revenueMad) * 100 : 0;

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <SectionTitle title="Supplier costs" subtitle="Coûts consolidés depuis les lignes du devis fournisseur." />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <FinancialMetric label="Hotels total" value={fmtJPY(totals.hotels)} />
          <FinancialMetric label="Transport total" value={fmtJPY(totals.transport)} />
          <FinancialMetric label="Activities total" value={fmtJPY(totals.activities)} />
          <FinancialMetric label="Guides total" value={fmtJPY(totals.guides)} />
          <FinancialMetric label="Other costs total" value={fmtJPY(totals.other)} />
          <FinancialMetric label="Grand total supplier cost" value={fmtJPY(totals.grandTotalJpy)} strong />
        </div>
      </Card>

      <Card className="p-4">
        <SectionTitle title="Revenue" subtitle="Chiffre d'affaires calculé depuis les réservations rattachées au voyage." />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <FinancialMetric label="Total passengers" value={String(passengerCount)} />
          <FinancialMetric label="Revenue MAD" value={fmtMAD(revenueMad)} strong />
          <FinancialMetric label="Revenue JPY" value={fmtJPY(revenueJpy)} />
          <FinancialMetric label="Revenue per passenger" value={`${fmtMAD(revenuePerPassengerMad)} · ${fmtJPY(revenuePerPassengerJpy)}`} />
        </div>
      </Card>

      <Card className="p-4">
        <SectionTitle title="Profitability" subtitle="Lecture marge brute et profit net après commission bureau Japon." />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <FinancialMetric label="Gross margin MAD" value={fmtMAD(grossMarginMad)} tone={grossMarginMad >= 0 ? "positive" : "negative"} />
          <FinancialMetric label="Gross margin JPY" value={fmtJPY(grossMarginJpy)} tone={grossMarginJpy >= 0 ? "positive" : "negative"} />
          <FinancialMetric label="Margin %" value={`${formatPercent(marginPercent)}`} tone={marginPercent >= 0 ? "positive" : "negative"} strong />
          <FinancialMetric label="Cost per passenger" value={`${fmtMAD(totals.costPerPersonMad)} · ${fmtJPY(totals.costPerPersonJpy)}`} />
          <FinancialMetric label="Revenue per passenger" value={`${fmtMAD(revenuePerPassengerMad)} · ${fmtJPY(revenuePerPassengerJpy)}`} />
          <FinancialMetric label="Net profit" value={`${fmtMAD(netProfitMad)} · ${fmtJPY(netProfitJpy)}`} tone={netProfitMad >= 0 ? "positive" : "negative"} strong />
        </div>
      </Card>

      <Card className="p-4">
        <SectionTitle title="Supplier status" subtitle="Progression par poste selon les lignes marquées confirmées." />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SupplierStatusCard label="Hotel confirmed" status={sectionConfirmationStatus(rows.hotels)} />
          <SupplierStatusCard label="Transport confirmed" status={sectionConfirmationStatus(rows.transport)} />
          <SupplierStatusCard label="Activities confirmed" status={sectionConfirmationStatus(rows.activities)} />
          <SupplierStatusCard label="Guides confirmed" status={sectionConfirmationStatus(rows.guides)} />
        </div>
      </Card>
    </div>
  );
}

const SectionTitle = ({ title, subtitle }: { title: string; subtitle: string }) => (
  <div>
    <h2 className="font-display text-lg">{title}</h2>
    <p className="text-sm text-muted-foreground">{subtitle}</p>
  </div>
);

const FinancialMetric = ({
  label,
  value,
  strong = false,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "positive" | "negative";
}) => (
  <div className="rounded-lg border border-border bg-background p-3">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className={`mt-1 break-words ${strong ? "font-display text-xl" : "text-base font-semibold"} ${tone === "positive" ? "text-emerald-700" : tone === "negative" ? "text-red-700" : ""}`}>
      {value}
    </p>
  </div>
);

const SupplierStatusCard = ({ label, status }: { label: string; status: ReturnType<typeof sectionConfirmationStatus> }) => {
  const styles = {
    complete: "border-emerald-200 bg-emerald-50 text-emerald-900",
    pending: "border-orange-200 bg-orange-50 text-orange-950",
    missing: "border-red-200 bg-red-50 text-red-950",
  }[status.state];
  const badgeLabel = status.state === "complete" ? "Complet" : status.state === "pending" ? "En attente" : "Manquant";
  return (
    <div className={`rounded-lg border p-4 ${styles}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">{label}</p>
        <Badge variant="outline" className="border-current text-current">{badgeLabel}</Badge>
      </div>
      <p className="mt-3 font-display text-2xl">{formatPercent(status.percent)}</p>
      <p className="text-xs opacity-80">{status.confirmed} / {status.total} ligne(s) confirmée(s)</p>
    </div>
  );
};

function SupplierValidationWorkflow({
  validation,
  status,
  busy,
  canEdit,
  onStatusChange,
  onBulkSectionChange,
}: {
  validation: ReturnType<typeof buildSupplierValidation>;
  status: SupplierValidationStatus;
  busy: boolean;
  canEdit: boolean;
  onStatusChange: (status: SupplierValidationStatus) => void;
  onBulkSectionChange: (section: ValidationItemKey, confirmed: boolean) => void;
}) {
  const blockingErrors = validationBlockingErrors(nextValidationStatus(status), status, validation);
  return (
    <Card className="overflow-hidden border-primary/20">
      <div className="border-b border-border bg-secondary/30 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-display text-lg">Supplier Validation Workflow</h2>
            <p className="text-sm text-muted-foreground">Aucun voyage ne peut passer en prêt tant que les éléments opérationnels requis ne sont pas complets.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Badge variant={validation.allComplete ? "default" : "outline"}>{validationStatusLabel[status]}</Badge>
            <Select value={status} onValueChange={(value) => onStatusChange(value as SupplierValidationStatus)} disabled={busy}>
              <SelectTrigger className="w-full sm:w-[250px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {validationStatusOrder.map((item) => (
                  <SelectItem key={item} value={item}>{validationStatusLabel[item]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[280px_1fr]">
        <div className="rounded-lg border border-border p-4">
          <p className="text-xs text-muted-foreground">Completion</p>
          <p className="mt-1 font-display text-4xl">{validation.completionPercentage}%</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
            <div className={`h-full rounded-full ${validation.allComplete ? "bg-emerald-600" : "bg-amber-500"}`} style={{ width: `${validation.completionPercentage}%` }} />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{validation.completedItems} / {validation.totalItems} item(s) complets</p>
        </div>

        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {validation.items.map((item) => (
              <div key={item.key} className={`rounded-lg border p-3 ${item.complete ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-amber-200 bg-amber-50 text-amber-950"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{item.label}</p>
                    <p className="mt-1 text-xs opacity-80">{item.detail}</p>
                  </div>
                  <Badge variant="outline" className="border-current text-current">{item.complete ? "OK" : "Bloquant"}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={item.complete ? "outline" : "default"}
                    disabled={busy || !canEdit}
                    onClick={() => onBulkSectionChange(item.key, true)}
                  >
                    Tout valider
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || !canEdit}
                    onClick={() => onBulkSectionChange(item.key, false)}
                  >
                    Tout remettre à faire
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {validation.blockingErrors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-950">
              <p className="font-semibold">Blocking errors</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {validation.blockingErrors.map((error) => <li key={error}>{error}</li>)}
              </ul>
            </div>
          )}

          {blockingErrors.length > 0 && (
            <p className="text-xs text-muted-foreground">Prochaine étape bloquée: {blockingErrors[0]}</p>
          )}
        </div>
      </div>
    </Card>
  );
}

function TripMessagesCenter({
  messages,
  messageType,
  messageDraft,
  messageFiles,
  messageSearch,
  messageFilter,
  messageBusy,
  messagesSqlMissing,
  currentUserId,
  canSend,
  onTypeChange,
  onDraftChange,
  onFilesChange,
  onSearchChange,
  onFilterChange,
  onSend,
}: {
  messages: TripMessage[];
  messageType: TripMessageType;
  messageDraft: string;
  messageFiles: File[];
  messageSearch: string;
  messageFilter: TripMessageType | "all";
  messageBusy: boolean;
  messagesSqlMissing: boolean;
  currentUserId: string | null;
  canSend: boolean;
  onTypeChange: (value: TripMessageType) => void;
  onDraftChange: (value: string) => void;
  onFilesChange: (files: File[]) => void;
  onSearchChange: (value: string) => void;
  onFilterChange: (value: TripMessageType | "all") => void;
  onSend: () => void;
}) {
  const filteredMessages = useMemo(() => {
    const search = normalizeSearch(messageSearch);
    return messages.filter((message) => {
      const matchesType = messageFilter === "all" || message.message_type === messageFilter;
      const haystack = normalizeSearch([
        message.body,
        message.sender_name,
        message.sender_role,
        message.sender_source,
        messageTypeLabel[message.message_type],
        ...(message.attachments ?? []).map((attachment) => attachment.file_name),
      ].join(" "));
      return matchesType && (!search || haystack.includes(search));
    });
  }, [messageFilter, messageSearch, messages]);

  return (
    <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-primary" />
          <div>
            <h2 className="font-display text-lg">Messages voyage</h2>
            <p className="text-sm text-muted-foreground">Communication Maroc / Bureau Japon.</p>
          </div>
        </div>

        {messagesSqlMissing && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            Migration SQL du centre de messages requise avant utilisation.
          </div>
        )}

        <div className="mt-4 space-y-3">
          <div>
            <Label>Type de message</Label>
            <Select value={messageType} onValueChange={(value) => onTypeChange(value as TripMessageType)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {messageTypes.map((type) => <SelectItem key={type} value={type}>{messageTypeLabel[type]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Message</Label>
            <Textarea
              className="mt-1"
              rows={6}
              value={messageDraft}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder="Écrire un message pour l’équipe Maroc ou le bureau Japon..."
            />
          </div>
          <div>
            <Label>Pièces jointes</Label>
            <Input
              className="mt-1"
              type="file"
              multiple
              onChange={(event) => onFilesChange(Array.from(event.target.files ?? []))}
            />
            {messageFiles.length > 0 && (
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                {messageFiles.map((file) => (
                  <div key={`${file.name}-${file.size}`} className="flex items-center gap-1">
                    <Paperclip className="h-3 w-3" />
                    <span className="truncate">{file.name}</span>
                    <span>{formatFileSize(file.size)}</span>
                  </div>
                ))}
                <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => onFilesChange([])}>
                  Retirer les fichiers
                </Button>
              </div>
            )}
          </div>
          <Button onClick={onSend} disabled={!canSend || messageBusy || (!messageDraft.trim() && messageFiles.length === 0)} className="w-full">
            <Send className="h-4 w-4" />
            {messageBusy ? "Envoi..." : "Envoyer le message"}
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-border p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_220px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                value={messageSearch}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Rechercher dans les messages, auteurs, pièces jointes..."
              />
            </div>
            <Select value={messageFilter} onValueChange={(value) => onFilterChange(value as TripMessageType | "all")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les types</SelectItem>
                {messageTypes.map((type) => <SelectItem key={type} value={type}>{messageTypeLabel[type]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{filteredMessages.length} message(s) affiché(s) sur {messages.length}.</p>
        </div>

        <div className="max-h-[720px] space-y-3 overflow-y-auto p-4">
          {filteredMessages.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Aucun message pour ce filtre.
            </div>
          )}
          {filteredMessages.map((message) => {
            const mine = message.sender_id === currentUserId;
            return (
              <article key={message.id} className={`rounded-lg border p-4 ${message.message_type === "urgent" ? "border-red-200 bg-red-50/70" : mine ? "border-primary/20 bg-primary/5" : "border-border bg-background"}`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={message.message_type === "urgent" ? "destructive" : "outline"}>{messageTypeLabel[message.message_type]}</Badge>
                      <span className="font-medium">{message.sender_name || "Utilisateur"}</span>
                      <span className="text-xs text-muted-foreground">{senderSourceLabel(message.sender_source)} · {message.sender_role || "—"}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{fmtDateTimeLabel(message.created_at)}</p>
                  </div>
                  {mine && <Badge variant="secondary">Moi</Badge>}
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{message.body}</p>
                {(message.attachments ?? []).length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(message.attachments ?? []).map((attachment) => (
                      <a
                        key={attachment.id ?? attachment.file_path ?? attachment.file_name}
                        href={attachment.file_url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs hover:bg-secondary"
                      >
                        <Paperclip className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{attachment.file_name}</span>
                        {attachment.size_bytes ? <span className="text-muted-foreground">{formatFileSize(attachment.size_bytes)}</span> : null}
                      </a>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function TripDocumentsCenter({
  documents,
  category,
  title,
  file,
  search,
  filter,
  busy,
  sqlMissing,
  onCategoryChange,
  onTitleChange,
  onFileChange,
  onSearchChange,
  onFilterChange,
  onUpload,
  onReplace,
  onDelete,
}: {
  documents: TripDocument[];
  category: TripDocumentCategory;
  title: string;
  file: File | null;
  search: string;
  filter: TripDocumentCategory | "all";
  busy: boolean;
  sqlMissing: boolean;
  onCategoryChange: (value: TripDocumentCategory) => void;
  onTitleChange: (value: string) => void;
  onFileChange: (file: File | null) => void;
  onSearchChange: (value: string) => void;
  onFilterChange: (value: TripDocumentCategory | "all") => void;
  onUpload: () => void;
  onReplace: (document: TripDocument, file: File) => void;
  onDelete: (document: TripDocument) => void;
}) {
  const filteredDocuments = useMemo(() => {
    const query = normalizeSearch(search);
    return documents.filter((document) => {
      const matchesCategory = filter === "all" || document.category === filter;
      const haystack = normalizeSearch([
        document.title,
        document.file_name,
        document.uploaded_by_name,
        document.uploaded_by_role,
        tripDocumentCategoryLabel[document.category],
      ].join(" "));
      return matchesCategory && (!query || haystack.includes(query));
    });
  }, [documents, filter, search]);

  const grouped = tripDocumentCategories
    .map((key) => ({ category: key, documents: filteredDocuments.filter((document) => document.category === key) }))
    .filter((group) => group.documents.length > 0);

  return (
    <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
      <Card className="p-4">
        <div>
          <h2 className="font-display text-lg">Ajouter un document</h2>
          <p className="text-sm text-muted-foreground">Documents opérationnels du voyage stockés dans Supabase Storage.</p>
        </div>

        {sqlMissing && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            Migration SQL du centre documents requise avant utilisation.
          </div>
        )}

        <div className="mt-4 space-y-3">
          <div>
            <Label>Catégorie</Label>
            <Select value={category} onValueChange={(value) => onCategoryChange(value as TripDocumentCategory)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {tripDocumentCategories.map((item) => <SelectItem key={item} value={item}>{tripDocumentCategoryLabel[item]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Titre</Label>
            <Input className="mt-1" value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="Ex: Voucher hôtel Tokyo" />
          </div>
          <div>
            <Label>Fichier</Label>
            <Input className="mt-1" type="file" onChange={(event) => onFileChange(event.target.files?.[0] ?? null)} />
            {file && (
              <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                <Paperclip className="h-3 w-3" />
                {file.name} {formatFileSize(file.size)}
              </p>
            )}
          </div>
          <Button className="w-full" onClick={onUpload} disabled={busy || !file}>
            <Plus className="h-4 w-4" />
            {busy ? "Upload..." : "Uploader"}
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-border p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_240px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Rechercher par titre, fichier, auteur..."
              />
            </div>
            <Select value={filter} onValueChange={(value) => onFilterChange(value as TripDocumentCategory | "all")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes catégories</SelectItem>
                {tripDocumentCategories.map((item) => <SelectItem key={item} value={item}>{tripDocumentCategoryLabel[item]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{filteredDocuments.length} document(s) affiché(s) sur {documents.length}.</p>
        </div>

        <div className="space-y-4 p-4">
          {filteredDocuments.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Aucun document opérationnel pour ce filtre.
            </div>
          )}

          {grouped.map((group) => (
            <section key={group.category} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold">{tripDocumentCategoryLabel[group.category]}</h3>
                <Badge variant="outline">{group.documents.length}</Badge>
              </div>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[920px] text-sm">
                  <thead className="bg-secondary/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Document</th>
                      <th className="px-3 py-2">Version</th>
                      <th className="px-3 py-2">Uploadé par</th>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Taille</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {group.documents.map((document) => (
                      <tr key={document.id}>
                        <td className="px-3 py-2">
                          <p className="font-medium">{document.title || document.file_name}</p>
                          <p className="text-xs text-muted-foreground">{document.file_name}</p>
                        </td>
                        <td className="px-3 py-2">v{document.version || 1}</td>
                        <td className="px-3 py-2">
                          <p>{document.uploaded_by_name || "Utilisateur"}</p>
                          <p className="text-xs text-muted-foreground">{document.uploaded_by_role || "—"}</p>
                        </td>
                        <td className="px-3 py-2">{fmtDateTimeLabel(document.uploaded_at)}</td>
                        <td className="px-3 py-2">{formatFileSize(document.size_bytes)}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button asChild variant="outline" size="sm" disabled={!document.file_url}>
                              <a href={document.file_url ?? "#"} target="_blank" rel="noreferrer">Prévisualiser</a>
                            </Button>
                            <Button asChild variant="outline" size="sm" disabled={!document.file_url}>
                              <a href={document.file_url ?? "#"} download={document.file_name}>
                                <Download className="h-4 w-4" /> Télécharger
                              </a>
                            </Button>
                            <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent">
                              Remplacer
                              <input
                                type="file"
                                className="sr-only"
                                disabled={busy}
                                onChange={(event) => {
                                  const nextFile = event.target.files?.[0];
                                  if (nextFile) onReplace(document, nextFile);
                                  event.currentTarget.value = "";
                                }}
                              />
                            </label>
                            <Button variant="ghost" size="icon" disabled={busy} onClick={() => onDelete(document)} aria-label="Supprimer le document">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      </Card>
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
  const total = rows.reduce((sum, row) => sum + subtotal(row, section), 0);
  const columns = columnsForSection(section);
  const update = (index: number, key: string, value: any) => {
    onRowsChange(rows.map((row, rowIndex) => rowIndex === index ? normalizeRow(section, { ...row, [key]: value }, rowIndex) : row));
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
    ? rows.filter((row) => !row.optional).reduce((sum, row) => sum + subtotal(row, "activities"), 0)
    : 0;
  const optionalActivityTotal = section === "activities"
    ? rows.filter((row) => row.optional).reduce((sum, row) => sum + subtotal(row, "activities"), 0)
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
                <td className="px-3 py-2 text-right font-semibold">{fmtJPY(subtotal(row, section))}</td>
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
    const options = Array.from(new Set([...(column.options ?? []), value].filter((option) => String(option ?? "").trim()).map(String)));
    return (
      <Select value={String(value ?? column.options[0] ?? "")} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger className="h-9 min-w-[140px]"><SelectValue /></SelectTrigger>
        <SelectContent>{options.map((option: string) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
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

const normalizeSearch = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const senderSourceLabel = (source?: string | null) => {
  if (source === "japan_office" || source === "supplier") return "Bureau Japon";
  if (source === "morocco_office") return "Maroc";
  if (source === "admin") return "Admin";
  return "Équipe";
};

const formatFileSize = (size?: number | null) => {
  const value = Number(size ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1024) return `${value} o`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} Ko`;
  return `${(value / (1024 * 1024)).toFixed(1)} Mo`;
};

const safeStorageFilename = (filename: string) => {
  const extension = filename.includes(".") ? `.${filename.split(".").pop()}` : "";
  const base = filename.replace(/\.[^.]+$/, "");
  const normalized = base
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "piece-jointe";
  return `${normalized}${extension.toLowerCase()}`;
};

const signedAttachmentUrl = async (attachment: TripMessageAttachment) => {
  if (!attachment.file_path) return attachment.file_url ?? null;
  const { data, error } = await supabase.storage
    .from(tripMessageAttachmentBucket)
    .createSignedUrl(attachment.file_path, 60 * 60);
  return error ? attachment.file_url ?? null : data?.signedUrl ?? attachment.file_url ?? null;
};

const signedTripDocumentUrl = async (document: TripDocument) => {
  if (!document.file_path) return document.file_url ?? null;
  const { data, error } = await supabase.storage
    .from(tripDocumentBucket)
    .createSignedUrl(document.file_path, 60 * 60);
  return error ? document.file_url ?? null : data?.signedUrl ?? document.file_url ?? null;
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
    { key: "rooms_count", label: "Personnes", type: "number" },
    { key: "unit_price_jpy", label: "Prix/pers./nuit JPY", type: "number" },
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
    { key: "participant_count", label: "Participants", type: "number" },
    { key: "optional", label: "Optionnel", type: "boolean" },
  ];
  if (section === "guides") return [
    { key: "service_date", label: "Date", type: "date" },
    { key: "day_number", label: "Jour", type: "number" },
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
  if (section === "activities") return { ...base, service_date: "", day_number: index + 1, activity_name: "", participant_count: 1, quantity: 1, unit_price_jpy: 0, optional: false };
  if (section === "guides") return { ...base, service_date: "", day_number: index + 1, city: "", guide_type: "francophone", guides_count: 1, daily_price_jpy: 0 };
  return { ...base, label: "", quantity: 1, unit_price_jpy: 0 };
};

const numeric = (value: unknown) => {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const hasValue = (value: unknown) => value !== null && value !== undefined && value !== "";

const subtotal = (row: QuoteRow, section?: QuoteSection) => {
  if (section === "hotels" || (!section && ("hotel_name" in row || "rooms_count" in row || "room_count" in row))) {
    return numeric(row.rooms_count ?? row.room_count) * numeric(row.nights || 0) * numeric(row.unit_price_jpy ?? row.price_per_room_per_night_jpy);
  }
  if (section === "transport") {
    return numeric(row.quantity) * numeric(row.unit_price_jpy);
  }
  if (section === "activities" || (!section && ("activity_name" in row || "participant_count" in row))) {
    const count = hasValue(row.participant_count) ? row.participant_count : row.quantity;
    return numeric(count) * numeric(row.unit_price_jpy);
  }
  if (section === "guides" || (!section && ("guide_type" in row || "guides_count" in row || "guide_count" in row))) {
    return numeric(row.guides_count ?? row.guide_count) * numeric(row.daily_price_jpy);
  }
  return numeric(row.quantity) * numeric(row.unit_price_jpy);
};

const serializeRow = (section: QuoteSection, row: QuoteRow, quoteId: string, index: number) => {
  const normalized = normalizeRow(section, row, index);
  const base = {
    quote_id: quoteId,
    sort_order: index,
    status: normalized.status ?? "todo",
    assigned_to: normalized.assigned_to || null,
    comment: normalized.comment || null,
    subtotal_jpy: subtotal(normalized, section),
    updated_at: new Date().toISOString(),
  };
  const clean = (keys: string[]) => Object.fromEntries(keys.map((key) => [key, normalized[key] ?? null]));
  if (section === "hotels") {
    const peopleCount = numeric(normalized.rooms_count ?? normalized.room_count);
    const unitPrice = numeric(normalized.unit_price_jpy ?? normalized.price_per_room_per_night_jpy);
    return {
      ...base,
      ...clean(["city", "hotel_name", "check_in", "check_out", "nights", "room_type"]),
      rooms_count: peopleCount,
      room_count: peopleCount,
      unit_price_jpy: unitPrice,
      price_per_room_per_night_jpy: unitPrice,
    };
  }
  if (section === "transport") return { ...base, ...clean(["service_date", "day_number", "city_route", "transport_type", "description", "quantity", "unit_price_jpy"]) };
  if (section === "activities") {
    const participantCount = numeric(hasValue(normalized.participant_count) ? normalized.participant_count : normalized.quantity);
    return { ...base, ...clean(["service_date", "day_number", "activity_name", "unit_price_jpy", "optional"]), participant_count: participantCount, quantity: participantCount };
  }
  if (section === "guides") {
    const guideCount = numeric(normalized.guides_count ?? normalized.guide_count);
    return { ...base, ...clean(["service_date", "day_number", "city", "guide_type", "daily_price_jpy"]), guides_count: guideCount, guide_count: guideCount };
  }
  return { ...base, ...clean(["label", "quantity", "unit_price_jpy"]) };
};

const exportWorkbook = async (filename: string, sheets: Array<{ name: string; rows: any[] }>) => {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  sheets.forEach((sheet) => {
    const rows = sheet.rows.length ? sheet.rows : [{ note: "Aucune donnée" }];
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const headers = Object.keys(rows[0] ?? {});
    worksheet["!cols"] = headers.map((header) => ({
      wch: Math.min(48, Math.max(14, header.length + 4, ...rows.map((row) => String(row?.[header] ?? "").length + 2))),
    }));
    if (headers.length > 0 && rows.length > 0) {
      const range = XLSX.utils.decode_range(worksheet["!ref"] ?? "A1:A1");
      worksheet["!autofilter"] = { ref: XLSX.utils.encode_range(range) };
      worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };
      headers.forEach((_, index) => {
        const cell = worksheet[XLSX.utils.encode_cell({ r: 0, c: index })];
        if (cell) {
          cell.s = {
            font: { bold: true, color: { rgb: "FFFFFF" } },
            fill: { fgColor: { rgb: "1F2937" } },
            alignment: { horizontal: "center" },
          };
        }
      });
    }
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

const buildOperationalBookContext = ({
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
  supplierName,
}: any) => {
  const participantRows = buildParticipantRows({ participants, bookings, bookingExtras, extrasList, rooms, hotels, assignments, participantActivitySelections });
  const roomingRows = buildRoomRows({ hotels, rooms, assignments, participants, bookings });
  const extraRows = buildExtraGroups({ participants, bookings, bookingExtras, extrasList, participantActivitySelections });
  const summaryRows = buildOperationalSummaryRows({ trip, totals, participants, bookings, hotels, rooms, rows, supplierName });
  return {
    summaryRows,
    flightRows: buildFlightRows(trip),
    hotelRows: buildOperationalHotelRows(hotels, rooms, assignments),
    roomingRows,
    participantRows,
    activityRows: buildOperationalActivityRows(rows.activities, extraRows),
    guideRows: buildOperationalGuideRows(rows.guides),
    transportRows: buildOperationalTransportRows(rows.transport),
    emergencyContactRows: buildEmergencyContactRows({ trip, hotels, participants, operationalState }),
  };
};

const buildOperationalSummaryRows = ({ trip, totals, participants, bookings, hotels, rooms, rows, supplierName }: any) => [
  { Rubrique: "Voyage", Information: "Titre", Valeur: trip?.title ?? "—" },
  { Rubrique: "Voyage", Information: "Saison", Valeur: trip?.season ?? trip?.label ?? "—" },
  { Rubrique: "Voyage", Information: "Départ", Valeur: formatDateForDisplay(trip?.start_date) },
  { Rubrique: "Voyage", Information: "Retour", Valeur: formatDateForDisplay(trip?.end_date) },
  { Rubrique: "Voyage", Information: "Durée", Valeur: trip?.duration_days ? `${trip.duration_days} jours` : "—" },
  { Rubrique: "Bureau Japon", Information: "Fournisseur", Valeur: supplierName ?? "Japan office" },
  { Rubrique: "Participants", Information: "Total passagers", Valeur: participants.length || getParticipantCount([], bookings) || 0 },
  { Rubrique: "Participants", Information: "Réservations", Valeur: bookings.length },
  { Rubrique: "Hébergement", Information: "Hôtels", Valeur: hotels.length },
  { Rubrique: "Hébergement", Information: "Chambres", Valeur: rooms.length },
  { Rubrique: "Planning", Information: "Activités devis", Valeur: rows.activities.length },
  { Rubrique: "Planning", Information: "Guides", Valeur: rows.guides.length },
  { Rubrique: "Planning", Information: "Transports", Valeur: rows.transport.length },
  { Rubrique: "Coûts", Information: "Total fournisseur JPY", Valeur: roundNumber(totals.grandTotalJpy) },
  { Rubrique: "Coûts", Information: "Total final JPY", Valeur: roundNumber(totals.finalTotalJpy) },
  { Rubrique: "Coûts", Information: "Total final MAD", Valeur: roundNumber(totals.finalTotalMad) },
  { Rubrique: "Export", Information: "Généré le", Valeur: new Date().toLocaleString("fr-FR") },
];

const buildFlightRows = (trip: any) => [
  {
    Segment: "Aller",
    Route: firstText(trip?.metadata?.outbound_route, trip?.visa_arrival_port ? `Maroc → ${trip.visa_arrival_port}` : "À confirmer"),
    Vols: firstText(trip?.metadata?.outbound_flight_numbers, trip?.visa_arrival_flight_number, "À confirmer"),
    Départ: firstText(trip?.metadata?.outbound_departure_text, trip?.start_date ? `Départ: ${formatDateForDisplay(trip.start_date)}` : "À confirmer"),
    Arrivée: firstText(trip?.metadata?.outbound_arrival_text, trip?.visa_japan_arrival_date ? `Arrivée: ${formatDateForDisplay(trip.visa_japan_arrival_date)} · ${trip.visa_arrival_port || ""}` : "À confirmer"),
    Compagnie: firstText(trip?.airline, trip?.metadata?.airline, "À confirmer"),
    Notes: firstText(trip?.outbound_flight_text, trip?.metadata?.outbound_flight_text, trip?.flight_notes, trip?.metadata?.flight_notes, ""),
  },
  {
    Segment: "Retour",
    Route: firstText(trip?.metadata?.return_route, "Japon → Maroc"),
    Vols: firstText(trip?.metadata?.return_flight_numbers, "À confirmer"),
    Départ: firstText(trip?.metadata?.return_departure_text, trip?.visa_japan_departure_date ? `Départ Japon: ${formatDateForDisplay(trip.visa_japan_departure_date)}` : "À confirmer"),
    Arrivée: firstText(trip?.metadata?.return_arrival_text, trip?.end_date ? `Retour: ${formatDateForDisplay(trip.end_date)}` : "À confirmer"),
    Compagnie: firstText(trip?.airline, trip?.metadata?.airline, "À confirmer"),
    Notes: firstText(trip?.return_flight_text, trip?.metadata?.return_flight_text, trip?.flight_notes, trip?.metadata?.flight_notes, ""),
  },
];

const buildOperationalHotelRows = (hotels: any[], rooms: any[], assignments: any[]) =>
  (hotels ?? []).map((hotel) => {
    const hotelRooms = (rooms ?? []).filter((room) => room.trip_hotel_id === hotel.id);
    const assignedCount = hotelRooms.reduce((sum, room) => sum + (assignments ?? []).filter((assignment) => assignment.room_id === room.id).length, 0);
    return {
      Ville: hotel.city ?? "",
      Hôtel: hotel.name ?? hotel.hotel_name ?? "Hôtel",
      "Check-in": formatDateForDisplay(hotel.check_in),
      "Check-out": formatDateForDisplay(hotel.check_out),
      Nuits: nightsBetween(hotel.check_in, hotel.check_out) || "",
      Adresse: hotel.address ?? "",
      Téléphone: hotel.phone ?? "",
      Site: hotel.website_url ?? hotel.website ?? "",
      "Google Maps": hotel.google_maps_url ?? hotel.google_maps_link ?? "",
      Chambres: hotelRooms.length,
      "Participants assignés": assignedCount,
      Notes: hotel.notes ?? hotel.internal_notes ?? "",
    };
  });

const buildOperationalActivityRows = (activityRows: QuoteRow[], extraRows: any[]) => {
  const matched = new Set<string>();
  const rowsFromQuote = (activityRows ?? []).map((row) => {
    const extra = findMatchingExtraGroup(row.activity_name, extraRows);
    if (extra) matched.add(normalizeActivityName(extra.name));
    return {
      Date: formatDateForDisplay(row.service_date),
      Jour: row.day_number ?? "",
      Activité: row.activity_name ?? "",
      Type: row.optional ? "Optionnelle" : "Incluse / requise",
      "Participants prévus": row.participant_count ?? row.quantity ?? 0,
      "Participants inscrits": extra?.participants ?? "",
      "Réservations": extra?.booking_references ?? "",
      Quantité: row.quantity ?? row.participant_count ?? 0,
      "Prix unitaire JPY": row.unit_price_jpy ?? "",
      "Sous-total JPY": roundNumber(subtotal(row, "activities")),
      Statut: rowStatusLabel[row.status as RowStatus] ?? row.status ?? "",
      "Assigné à": row.assigned_to ?? "",
      Commentaire: row.comment ?? "",
    };
  });
  const extraOnlyRows = (extraRows ?? [])
    .filter((extra) => !matched.has(normalizeActivityName(extra.name)))
    .map((extra) => ({
      Date: "",
      Jour: "",
      Activité: extra.name,
      Type: "Extra sélectionné",
      "Participants prévus": extra.quantity,
      "Participants inscrits": extra.participants,
      "Réservations": extra.booking_references,
      Quantité: extra.quantity,
      "Prix unitaire JPY": "",
      "Sous-total JPY": "",
      Statut: "À confirmer",
      "Assigné à": "",
      Commentaire: "",
    }));
  return [...rowsFromQuote, ...extraOnlyRows];
};

const buildOperationalGuideRows = (guideRows: QuoteRow[]) =>
  (guideRows ?? []).map((row) => ({
    Date: formatDateForDisplay(row.service_date),
    Jour: row.day_number ?? "",
    Ville: row.city ?? "",
    "Guide / type": row.guide_type ?? "",
    "Nombre de guides": row.guides_count ?? row.guide_count ?? 0,
    "Prix jour JPY": row.daily_price_jpy ?? "",
    "Sous-total JPY": roundNumber(subtotal(row, "guides")),
    Statut: rowStatusLabel[row.status as RowStatus] ?? row.status ?? "",
    "Assigné à": row.assigned_to ?? "",
    Commentaire: row.comment ?? "",
  }));

const buildOperationalTransportRows = (transportRows: QuoteRow[]) =>
  (transportRows ?? []).map((row) => ({
    Date: formatDateForDisplay(row.service_date),
    Jour: row.day_number ?? "",
    "Ville / route": row.city_route ?? "",
    Type: row.transport_type ?? "",
    Description: row.description ?? "",
    Quantité: row.quantity ?? 0,
    "Prix unitaire JPY": row.unit_price_jpy ?? "",
    "Sous-total JPY": roundNumber(subtotal(row, "transport")),
    Statut: rowStatusLabel[row.status as RowStatus] ?? row.status ?? "",
    "Assigné à": row.assigned_to ?? "",
    Commentaire: row.comment ?? "",
  }));

const buildEmergencyContactRows = ({ trip, hotels, participants, operationalState }: any) => {
  const rows: any[] = [
    { Type: "Organisateur Maroc", Nom: "LeJapon.ma / Moroccan Express Travel & Events", Téléphone: "+212 711 449 838", Email: "info@lejapon.ma", Adresse: "Rue Annour, El Wifaq, Témara", Notes: "Contact principal Maroc" },
  ];
  collectEmergencyContacts(trip).forEach((contact) => rows.push(contact));
  (hotels ?? []).forEach((hotel: any) => {
    if (!hotel.phone && !hotel.address) return;
    rows.push({
      Type: "Hôtel",
      Nom: hotel.name ?? hotel.hotel_name ?? "Hôtel",
      Téléphone: hotel.phone ?? "",
      Email: hotel.email ?? "",
      Adresse: hotel.address ?? "",
      Notes: [hotel.city, formatDateForDisplay(hotel.check_in), formatDateForDisplay(hotel.check_out)].filter(Boolean).join(" · "),
    });
  });
  (participants ?? []).forEach((participant: any) => {
    const name = firstText(participant.emergency_contact_name, participant.emergency_name, participant.metadata?.emergency_contact_name, participant.metadata?.emergency_name);
    const phone = firstText(participant.emergency_contact_phone, participant.emergency_phone, participant.metadata?.emergency_contact_phone, participant.metadata?.emergency_phone);
    if (!name && !phone) return;
    rows.push({
      Type: "Contact urgence participant",
      Nom: name || "Contact urgence",
      Téléphone: phone,
      Email: "",
      Adresse: "",
      Notes: `Participant: ${participantFullName(participant)}`,
    });
  });
  const dayIssues = Object.entries(operationalState?.day_statuses ?? {})
    .filter(([, status]) => status === "attention")
    .map(([day]) => `Jour ${day}`)
    .join(", ");
  if (dayIssues) rows.push({ Type: "Attention opérationnelle", Nom: "Jours à surveiller", Téléphone: "", Email: "", Adresse: "", Notes: dayIssues });
  return rows;
};

const collectEmergencyContacts = (trip: any) => {
  const metadata = trip?.metadata ?? {};
  const raw = metadata.emergency_contacts ?? metadata.emergencyContacts ?? trip?.emergency_contacts ?? [];
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw) : [];
  const rows = list.map((contact: any) => ({
    Type: contact.type ?? contact.role ?? "Contact urgence",
    Nom: contact.name ?? contact.full_name ?? contact.title ?? "",
    Téléphone: contact.phone ?? contact.tel ?? contact.mobile ?? "",
    Email: contact.email ?? "",
    Adresse: contact.address ?? "",
    Notes: contact.notes ?? contact.comment ?? "",
  }));
  [
    ["Bureau Japon", metadata.japan_office_contact ?? metadata.japanOfficeContact],
    ["Accompagnateur", metadata.tour_leader_contact ?? metadata.tourLeaderContact],
    ["Guide principal", metadata.guide_contact ?? metadata.guideContact],
  ].forEach(([type, value]) => {
    if (!value) return;
    if (typeof value === "string") rows.push({ Type: type, Nom: value, Téléphone: "", Email: "", Adresse: "", Notes: "" });
    else rows.push({ Type: type, Nom: value.name ?? value.full_name ?? "", Téléphone: value.phone ?? value.mobile ?? "", Email: value.email ?? "", Adresse: value.address ?? "", Notes: value.notes ?? "" });
  });
  return rows.filter((row) => Object.values(row).some((value) => String(value ?? "").trim()));
};

const findMatchingExtraGroup = (activityName: unknown, extraRows: any[]) => {
  const normalized = normalizeActivityName(activityName);
  if (!normalized) return null;
  return (extraRows ?? []).find((extra) => {
    const extraName = normalizeActivityName(extra.name);
    return extraName === normalized || extraName.includes(normalized) || normalized.includes(extraName);
  }) ?? null;
};

const buildQuoteExportRows = (rows: Record<QuoteSection, QuoteRow[]>, includeAdminNotes: boolean) =>
  (Object.keys(rows) as QuoteSection[]).flatMap((section) =>
    rows[section].map((row, index) => {
      const base: Record<string, unknown> = {
        section: sectionLabels[section],
        ordre: index + 1,
        statut: rowStatusLabel[row.status as RowStatus] ?? row.status ?? "",
        sous_total_jpy: roundNumber(subtotal(row, section)),
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
        personnes: row.rooms_count ?? row.room_count,
        prix_personne_nuit_jpy: row.unit_price_jpy ?? row.price_per_room_per_night_jpy,
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
        participants: row.participant_count ?? row.quantity,
        prix_unitaire_jpy: row.unit_price_jpy,
      });
      if (section === "guides") Object.assign(base, {
        date: formatDateForDisplay(row.service_date),
        jour: row.day_number,
        ville: row.city,
        type_guide: row.guide_type,
        guides: row.guides_count ?? row.guide_count,
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

const normalizeRow = (section: QuoteSection, row: any, index: number): QuoteRow => {
  const normalized: QuoteRow = {
    ...row,
    local_id: row.local_id ?? row.id ?? crypto.randomUUID(),
    sort_order: row.sort_order ?? index,
    status: row.status ?? "todo",
    optional: Boolean(row.optional),
  };

  if (section === "hotels") {
    const peopleCount = numeric(row.rooms_count ?? row.room_count);
    const unitPrice = numeric(row.unit_price_jpy ?? row.price_per_room_per_night_jpy);
    normalized.rooms_count = peopleCount;
    normalized.room_count = peopleCount;
    normalized.unit_price_jpy = unitPrice;
    normalized.price_per_room_per_night_jpy = unitPrice;
  } else if (section === "transport") {
    normalized.quantity = numeric(row.quantity);
    normalized.unit_price_jpy = numeric(row.unit_price_jpy);
  } else if (section === "activities") {
    const participantCount = numeric(hasValue(row.participant_count) ? row.participant_count : row.quantity);
    normalized.participant_count = participantCount;
    normalized.quantity = participantCount;
    normalized.unit_price_jpy = numeric(row.unit_price_jpy);
  } else if (section === "guides") {
    const guideCount = numeric(row.guides_count ?? row.guide_count);
    normalized.guides_count = guideCount;
    normalized.guide_count = guideCount;
    normalized.daily_price_jpy = numeric(row.daily_price_jpy);
  } else {
    normalized.quantity = numeric(row.quantity);
    normalized.unit_price_jpy = numeric(row.unit_price_jpy);
  }

  normalized.subtotal_jpy = subtotal(normalized, section);
  return normalized;
};

const normalizeRows = (section: QuoteSection, rows: any[]): QuoteRow[] =>
  reindexRows(rows.map((row, index) => normalizeRow(section, row, index)));

const reindexRows = (rows: QuoteRow[]): QuoteRow[] =>
  rows.map((row, index) => ({ ...row, sort_order: index }));

const buildInitialRows = ({ trip, programmeDays, hotels, rooms, assignments, bookings, participants, bookingExtras }: any): Record<QuoteSection, QuoteRow[]> => {
  const participantCount = getParticipantCount(participants, bookings ?? []);
  const sortedHotels = [...(hotels.length ? hotels : [])].sort((a: any, b: any) =>
    (dateToTime(a.check_in) ?? Number.MAX_SAFE_INTEGER) - (dateToTime(b.check_in) ?? Number.MAX_SAFE_INTEGER)
    || Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)
  );
  const hotelRows = sortedHotels.flatMap((hotel: any, hotelIndex: number) => {
    const peopleCounts = hotelPersonCountsByRoomType(hotel.id, rooms, assignments ?? [], participantCount);
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
        rooms_count: peopleCounts[roomType] ?? 0,
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
  const guideRows = DEFAULT_GUIDE_ROWS.map((guide, index) => {
    const day = programmeDays.find((item: any) => Number(item.day_number) === guide.day_number);
    return {
      ...blankRow("guides", index),
      service_date: dateForDay(programmeDays, trip, guide.day_number),
      day_number: guide.day_number,
      city: day?.city || day?.location || "",
      guide_type: guide.guide_type,
      guides_count: 1,
      daily_price_jpy: guide.daily_price_jpy,
      status: "todo" as RowStatus,
    };
  });
  const optionalQuantities = aggregateOptionalActivityQuantities(bookingExtras, participants);
  const requiredActivityRows = DEFAULT_REQUIRED_ACTIVITIES.map((activity, index) => ({
    ...blankRow("activities", index),
    service_date: dateForDay(programmeDays, trip, activity.day_number),
    day_number: activity.day_number,
    activity_name: activity.activity_name,
    participant_count: participantCount,
    quantity: participantCount,
    unit_price_jpy: activity.unit_price_jpy,
    optional: false,
  }));
  const optionalActivityRows = DEFAULT_OPTIONAL_ACTIVITIES.map((activity, optionalIndex) => {
    const index = requiredActivityRows.length + optionalIndex;
    const participantCount = optionalQuantityForActivity(optionalQuantities, activity.aliases);
    return {
      ...blankRow("activities", index),
      service_date: dateForDay(programmeDays, trip, activity.day_number),
      day_number: activity.day_number,
      activity_name: activity.activity_name,
      participant_count: participantCount,
      quantity: participantCount,
      unit_price_jpy: activity.unit_price_jpy,
      optional: true,
    };
  });
  return {
    hotels: normalizeRows("hotels", hotelRows),
    transport: normalizeRows("transport", transportRows),
    activities: normalizeRows("activities", [...requiredActivityRows, ...optionalActivityRows]),
    guides: normalizeRows("guides", guideRows),
    other: normalizeRows("other", []),
  };
};

const hotelPersonCountsByRoomType = (hotelId: string, rooms: any[], assignments: any[], totalParticipants: number) => {
  const counts: Record<string, number> = { "double/twin": 0, single: 0, triple: 0, TL: 0 };
  const hotelRooms = rooms.filter((room) => room.trip_hotel_id === hotelId);
  let assignedCount = 0;

  hotelRooms.forEach((room) => {
    const roomAssignments = assignments.filter((assignment) => assignment.room_id === room.id);
    const count = roomAssignments.length;
    if (count <= 0) return;
    assignedCount += count;
    const key = normalizeRoomTypeForCost(room.room_type);
    counts[key] = (counts[key] ?? 0) + count;
  });

  if (assignedCount === 0) {
    counts["double/twin"] = totalParticipants;
    counts.single = 0;
    counts.triple = 0;
    counts.TL = 1;
  } else if (counts.TL === 0 && hotelRooms.some((room) => normalizeRoomTypeForCost(room.room_type) === "TL")) {
    counts.TL = 1;
  }

  return counts;
};

const normalizeRoomTypeForCost = (value: unknown): "double/twin" | "single" | "triple" | "TL" => {
  const text = String(value ?? "").toLowerCase();
  if (/tl|tour\s*leader|leader|accompagn/.test(text)) return "TL";
  if (/single|solo|individuel|individuelle/.test(text)) return "single";
  if (/triple|3/.test(text)) return "triple";
  return "double/twin";
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

const formatSupabaseError = (error: any) =>
  [error?.context, error?.code, error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" · ");

const withQueryContext = (error: any, context: string) => {
  if (error && typeof error === "object") return { ...error, context };
  return { message: String(error ?? "Erreur inconnue"), context };
};

const isMissingTableError = (error: any) =>
  ["42P01", "PGRST205"].includes(error?.code)
  || /Could not find the table|relation .* does not exist/i.test(error?.message ?? "");

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

const formatPercent = (value: number) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(Number(value || 0))}%`;
const fmtJPY = (value: number) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Number(value || 0))} JPY`;
const fmtMAD = (value: number) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Number(value || 0))} MAD`;

const sectionConfirmationStatus = (rows: QuoteRow[]) => {
  const total = rows.length;
  const confirmed = rows.filter((row) => row.status === "confirmed").length;
  const percent = total > 0 ? (confirmed / total) * 100 : 0;
  const state: "complete" | "pending" | "missing" = total === 0 ? "missing" : confirmed === total ? "complete" : "pending";
  return { total, confirmed, percent, state };
};

const calculateQuoteTotals = (
  rows: Record<QuoteSection, QuoteRow[]>,
  commissionPct: number,
  exchangeRate: number,
  participants: any[],
  bookings: any[]
) => {
  const sectionTotals = {
    hotels: rows.hotels.reduce((sum, row) => sum + subtotal(row, "hotels"), 0),
    transport: rows.transport.reduce((sum, row) => sum + subtotal(row, "transport"), 0),
    activities: rows.activities.reduce((sum, row) => sum + subtotal(row, "activities"), 0),
    guides: rows.guides.reduce((sum, row) => sum + subtotal(row, "guides"), 0),
    other: rows.other.reduce((sum, row) => sum + subtotal(row, "other"), 0),
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
};

const isQuoteSection = (section: ValidationItemKey): section is QuoteSection =>
  ["hotels", "transport", "activities", "guides", "other"].includes(section);

const missingValidationColumnName = (error: any) => {
  const text = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`;
  return validationDbColumns.find((column) =>
    text.includes(`'${column}'`)
    || text.includes(`"${column}"`)
    || text.includes(` ${column} `)
  ) ?? null;
};

const extractValidationOverrides = (quote: any): Partial<Record<ValidationItemKey, boolean>> => {
  const metadata = quote?.validation_metadata ?? quote?.validation_snapshot ?? {};
  const raw = metadata?.manual_overrides ?? metadata?.manualOverrides ?? {};
  if (!raw || typeof raw !== "object") return {};
  return Object.fromEntries(
    Object.entries(raw).filter(([key, value]) =>
      ["hotels", "transport", "activities", "guides", "other", "participants", "rooming", "documents"].includes(key)
      && typeof value === "boolean"
    )
  ) as Partial<Record<ValidationItemKey, boolean>>;
};

const withManualValidationOverride = (
  key: ValidationItemKey,
  computedComplete: boolean,
  computedDetail: string,
  overrides: Partial<Record<ValidationItemKey, boolean>>
) => {
  const override = overrides[key];
  if (override === true) return { complete: true, detail: "Validé manuellement" };
  if (override === false) return { complete: false, detail: "Remis à faire manuellement" };
  return { complete: computedComplete, detail: computedDetail };
};

const buildSupplierValidation = ({
  rows,
  participants,
  rooms,
  assignments,
  documents,
  overrides = {},
}: {
  rows: Record<QuoteSection, QuoteRow[]>;
  participants: any[];
  rooms: any[];
  assignments: any[];
  documents: TripDocument[];
  overrides?: Partial<Record<ValidationItemKey, boolean>>;
}) => {
  const confirmed = (items: QuoteRow[]) => items.length > 0 && items.every((row) => row.status === "confirmed");
  const passportMissing = (participants ?? []).filter((participant) => !isParticipantPassportComplete(participant));
  const assignedParticipantIds = new Set((assignments ?? []).map((assignment) => assignment.participant_id).filter(Boolean));
  const roomsWithAssignments = new Set((assignments ?? []).map((assignment) => assignment.room_id).filter(Boolean));
  const roomingComplete = (participants ?? []).length > 0
    && (participants ?? []).every((participant) => assignedParticipantIds.has(participant.id))
    && (rooms ?? []).length > 0
    && roomsWithAssignments.size > 0;
  const missingDocumentCategories = mandatoryTripDocumentCategories.filter((category) =>
    !(documents ?? []).some((document) => document.category === category && !document.deleted_at && (document.file_path || document.file_url))
  );

  const hotelValidation = withManualValidationOverride("hotels", confirmed(rows.hotels), rows.hotels.length ? `${rows.hotels.filter((row) => row.status === "confirmed").length}/${rows.hotels.length} confirmed` : "No hotel rows", overrides);
  const transportValidation = withManualValidationOverride("transport", confirmed(rows.transport), rows.transport.length ? `${rows.transport.filter((row) => row.status === "confirmed").length}/${rows.transport.length} confirmed` : "No transport rows", overrides);
  const activitiesValidation = withManualValidationOverride("activities", confirmed(rows.activities), rows.activities.length ? `${rows.activities.filter((row) => row.status === "confirmed").length}/${rows.activities.length} confirmed` : "No activity rows", overrides);
  const guidesValidation = withManualValidationOverride("guides", confirmed(rows.guides), rows.guides.length ? `${rows.guides.filter((row) => row.status === "confirmed").length}/${rows.guides.length} confirmed` : "No guide rows", overrides);
  const participantsValidation = withManualValidationOverride("participants", (participants ?? []).length > 0 && passportMissing.length === 0, passportMissing.length ? `${passportMissing.length} passport(s) incomplete` : `${participants.length} passport(s) complete`, overrides);
  const roomingValidation = withManualValidationOverride("rooming", roomingComplete, roomingComplete ? "All participants assigned to rooms" : "Room assignments incomplete", overrides);
  const documentsValidation = withManualValidationOverride(
    "documents",
    missingDocumentCategories.length === 0,
    missingDocumentCategories.length
      ? `Missing: ${missingDocumentCategories.map((category) => tripDocumentCategoryLabel[category]).join(", ")}`
      : "Mandatory files uploaded",
    overrides
  );

  const items: Array<{
    key: ValidationItemKey;
    label: string;
    complete: boolean;
    detail: string;
    error: string;
  }> = [
    {
      key: "hotels",
      label: "Hotels",
      complete: hotelValidation.complete,
      detail: hotelValidation.detail,
      error: "Hotels: all hotel lines must be confirmed.",
    },
    {
      key: "transport",
      label: "Transport",
      complete: transportValidation.complete,
      detail: transportValidation.detail,
      error: "Transport: all transport lines must be confirmed.",
    },
    {
      key: "activities",
      label: "Activities",
      complete: activitiesValidation.complete,
      detail: activitiesValidation.detail,
      error: "Activities: all activity lines must be confirmed.",
    },
    {
      key: "guides",
      label: "Guides",
      complete: guidesValidation.complete,
      detail: guidesValidation.detail,
      error: "Guides: all guide lines must be confirmed.",
    },
    {
      key: "participants",
      label: "Participants",
      complete: participantsValidation.complete,
      detail: participantsValidation.detail,
      error: "Participants: all passports must include number, nationality, birthdate, sex and expiry date.",
    },
    {
      key: "rooming",
      label: "Rooming",
      complete: roomingValidation.complete,
      detail: roomingValidation.detail,
      error: "Rooming: every participant must be assigned to a room.",
    },
    {
      key: "documents",
      label: "Documents",
      complete: documentsValidation.complete,
      detail: documentsValidation.detail,
      error: "Documents: all mandatory operational files must be uploaded.",
    },
  ];
  const blockingErrors = items.filter((item) => !item.complete).map((item) => item.error);
  const completedItems = items.filter((item) => item.complete).length;
  const totalItems = items.length;
  return {
    items,
    blockingErrors,
    missingDocumentCategories,
    allComplete: blockingErrors.length === 0,
    completedItems,
    totalItems,
    completionPercentage: Math.round((completedItems / Math.max(1, totalItems)) * 100),
  };
};

const isParticipantPassportComplete = (participant: any) =>
  Boolean(
    passportNumber(participant)
    && participantNationality(participant)
    && participantBirthdate(participant)
    && participantSex(participant)
    && participantPassportExpiry(participant)
  );

const nextValidationStatus = (status: SupplierValidationStatus) =>
  validationStatusOrder[Math.min(validationStatusOrder.length - 1, validationStatusOrder.indexOf(status) + 1)] ?? status;

const validationBlockingErrors = (
  nextStatus: SupplierValidationStatus,
  currentStatus: SupplierValidationStatus,
  validation: ReturnType<typeof buildSupplierValidation>
) => {
  const nextIndex = validationStatusOrder.indexOf(nextStatus);
  const currentIndex = validationStatusOrder.indexOf(currentStatus);
  if (nextIndex <= currentIndex) return [];
  if (nextStatus === "draft" || nextStatus === "in_progress") return [];
  if (!validation.allComplete) return validation.blockingErrors;
  if (nextStatus === "ready_to_travel" && currentStatus !== "japan_office_confirmed" && currentStatus !== "ready_to_travel") {
    return ["Ready To Travel requires Japan Office Confirmed first."];
  }
  return [];
};

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
