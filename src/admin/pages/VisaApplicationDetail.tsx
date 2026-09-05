/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Download, Eye, FileText, Mail, Pencil, Save, Search, Unlink } from "lucide-react";
import { toast } from "sonner";
import { generateVisaPdf, downloadBlob } from "@/lib/visa-pdf";
import { generateInvitationLetter, generateGuaranteeLetter } from "@/lib/visa-letters";
import { generateTravelConfirmationPdf, generateTravelProgrammePdf } from "@/lib/travel-documents-pdf";
import {
  buildVisaProgramV2Draft,
  generateVisaProgramV2Pdf,
  sanitizeVisaProgramV2Filename,
  validateVisaProgramV2Draft,
  VISA_PROGRAM_V2_DOCUMENT_TYPE,
  type VisaProgramV2Draft,
} from "@/lib/visa-program-v2-pdf";
import { isVisaProcurationDocument, upsertVisaProcurationDocument } from "@/lib/visa-procuration-pdf";
import { isVisaChecklistDocument, upsertVisaChecklistDocument } from "@/lib/visa-checklist-pdf";
import {
  PROFESSIONAL_SITUATIONS,
  checklistSnapshotText,
  findChecklistForSituation,
  professionalSituationLabel,
} from "@/lib/visa-document-checklists";
import { PdfPreviewDialog } from "@/admin/components/PdfPreviewDialog";
import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import { AlertTriangle, MailQuestion, Package } from "lucide-react";
import JSZip from "jszip";
import { QuickActions } from "@/admin/components/QuickActions";
import { fetchAgencySettings, type AgencySettings } from "@/lib/agency-settings";
import { lookupVisaPrefillByPassport, normalizePassportNo } from "@/lib/visa-prefill";
import {
  buildPreviousJapanStayValue,
  formatPreviousJapanStayForDisplay,
  formatVisaDate,
  isRetiredVisaCategory,
  parsePreviousJapanStay,
  RETIRED_NOT_APPLICABLE,
} from "@/lib/visa-format";
import { visaTripDatesFromTrip } from "@/lib/visa-trip-dates";
import {
  createStampedFlightTicketPdf,
  downloadBytes,
  flightTicketVisaFilename,
  getFlightTicketStatus,
  participantFullName,
} from "@/admin/lib/flight-tickets";
import { loadOperationalRoomingForTrip } from "@/admin/lib/operational-rooming";
import {
  buildGuestFromParticipant,
  buildHotelConfirmationRoom,
  buildHotelDocumentReference,
  buildHotelGroupReference,
  generateHotelReservationConfirmationPdf,
  getHotelConfirmationRooms,
  HOTEL_GROUP_RESERVATION_NAME,
  hotelConfirmationDataHash,
  isHotelProvisional,
  nightsBetween,
  sanitizeHotelReservationFilename,
  sanitizeHotelReservationsZipFilename,
  validateHotelConfirmationDraft,
  VISA_HOTEL_CONFIRMATION_DOCUMENT_TYPE,
  type HotelConfirmationDraft,
} from "@/lib/visa-hotel-reservation-pdf";

const todayISO = () => new Date().toISOString().slice(0, 10);

const STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon",
  submitted: "Soumise",
  awaiting_documents: "En attente des documents",
  documents_received: "Documents reçus",
  in_review: "En traitement",
  submitted_to_embassy: "Soumise à l'ambassade",
  approved: "Approuvée",
  rejected: "Rejetée",
  completed: "Terminée",
};

const VISA_SUBMISSION_BATCH_STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon",
  generated: "Généré",
  submitted: "Déposé",
  needs_completion: "À compléter",
  cancelled: "Annulé",
};

const normalizeMatchText = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const hasText = (value: unknown) => String(value ?? "").trim().length > 0;

const isVisaProgramV2Document = (doc: any) =>
  String(doc?.storage_path ?? "").includes("/generated-program-v2/") ||
  String(doc?.storage_path ?? "").includes(`/${VISA_PROGRAM_V2_DOCUMENT_TYPE}/`) ||
  String(doc?.file_name ?? "").toLowerCase().includes("programme_visa_v2") ||
  String(doc?.file_name ?? "").toLowerCase().includes("travel_itinerary");

type TravelContext = {
  trip?: any | null;
  programme?: any | null;
  days?: any[];
  hotels?: any[];
  participants?: any[];
  agency?: AgencySettings | null;
};

type VisaFlightTicket = {
  flight: any;
  traveler: any | null;
  participant: any | null;
  bookingReference: string | null;
  participantName: string;
  storagePath: string;
  fileName?: string | null;
  createdAt: string | null;
};

type VisaBookingAssociation = {
  booking: any | null;
  participant: any | null;
};

type VisaAssociationSuggestion = {
  booking: any;
  participant: any;
  confidence: "exact" | "probable" | "check";
  reason: string;
};

type VisaHotelConfirmationItem = {
  hotel: any;
  stayIndex: number;
  stayLabel: string;
  isRepeatedHotelStayName: boolean;
  groupReservation: any | null;
  document: any | null;
  draft: HotelConfirmationDraft;
  dataHash: string;
  errors: string[];
  status: "missing" | "ready" | "generated" | "needs_regeneration";
  diagnostics: {
    totalTripParticipants: number;
    assignedParticipants: number;
    roomCount: number;
    completeRoomCount: number;
    freePlaces: number;
    emptyRoomCount: number;
    applicantRoomLabel: string | null;
  };
};

const maskPassportNo = (value: unknown) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  if (raw.length <= 4) return "••••";
  return `${raw.slice(0, 2)}••••${raw.slice(-2)}`;
};

const bookingTrip = (booking: any) => {
  if (Array.isArray(booking?.trips)) return booking.trips[0] ?? null;
  return booking?.trips ?? booking?.trip ?? null;
};

const bookingLabel = (booking: any) => {
  const trip = bookingTrip(booking);
  return [booking?.reference, trip?.title].filter(Boolean).join(" · ") || booking?.id || "Réservation";
};

const isUuid = (value: unknown) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ""));

const isMissingTableError = (error: any, tableName: string) =>
  Boolean(error?.message && new RegExp(`${tableName}|schema cache|Could not find the table`, "i").test(error.message));

const isActiveTravelParticipant = (participant: any) => {
  const status = String(participant?.status ?? participant?.booking_status ?? "").toLowerCase();
  return !["cancelled", "canceled", "deleted", "archived", "removed", "retired"].includes(status);
};

const normalizedHotelStayName = (hotel: any) =>
  String(hotel?.official_name ?? hotel?.name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const hotelConfirmationStatusLabel: Record<VisaHotelConfirmationItem["status"], string> = {
  missing: "Données manquantes",
  ready: "Prête à générer",
  generated: "Générée",
  needs_regeneration: "À régénérer",
};

const hotelConfirmationStatusClass: Record<VisaHotelConfirmationItem["status"], string> = {
  missing: "border-red-200 bg-red-50 text-red-900",
  ready: "border-emerald-200 bg-emerald-50 text-emerald-900",
  generated: "border-sky-200 bg-sky-50 text-sky-900",
  needs_regeneration: "border-orange-200 bg-orange-50 text-orange-900",
};

const associationParticipantStatusLabel = (participant: any) =>
  participant?.status ||
  participant?.client_type ||
  (participant?.is_lead ? "Responsable" : "Participant");

const logAssociationParticipantsError = (error: any, bookingId: unknown) => {
  if (!import.meta.env.DEV) return;
  console.warn("[visa-association] participants load failed", {
    booking_id: bookingId || null,
    code: error?.code ?? null,
    message: error?.message ?? null,
    details: error?.details ?? null,
    hint: error?.hint ?? null,
  });
};

async function loadVisaSubmissionHistory(visaApplicationId: string) {
  const { data: items, error } = await (supabase as any)
    .from("visa_group_submission_items")
    .select("*")
    .eq("visa_application_id", visaApplicationId)
    .order("created_at", { ascending: false });
  if (isMissingTableError(error, "visa_group_submission_items")) return [];
  if (error) throw error;
  const itemRows = items ?? [];
  const batchIds = Array.from(new Set(itemRows.map((item: any) => item.batch_id).filter(Boolean)));
  if (!batchIds.length) return [];
  const { data: batches, error: batchError } = await (supabase as any)
    .from("visa_group_submission_batches")
    .select("*")
    .in("id", batchIds);
  if (isMissingTableError(batchError, "visa_group_submission_batches")) return [];
  if (batchError) throw batchError;
  const batchById = new Map((batches ?? []).map((batch: any) => [batch.id, batch]));
  return itemRows.map((item: any) => ({
    item,
    batch: batchById.get(item.batch_id) ?? null,
  })).filter((row: any) => row.batch);
}

type DraftInputProps = {
  draft: any;
  field: string;
  label: string;
  type?: string;
  className?: string;
  disabled?: boolean;
  displayValue?: string;
  onChange: (field: string, value: unknown) => void;
};

function DraftInput({
  draft,
  field,
  label,
  type = "text",
  className = "",
  disabled = false,
  displayValue,
  onChange,
}: DraftInputProps) {
  return (
    <div className={className}>
      <label className="text-xs text-muted-foreground">{label}</label>
      <Input
        type={type}
        disabled={disabled}
        value={displayValue ?? draft?.[field] ?? ""}
        onChange={(e) => onChange(field, e.target.value)}
      />
    </div>
  );
}

function DraftSelect({
  draft,
  field,
  label,
  options,
  onChange,
}: {
  draft: any;
  field: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  onChange: (field: string, value: unknown) => void;
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <Select value={draft?.[field] ?? ""} onValueChange={(value) => onChange(field, value)}>
        <SelectTrigger className="min-h-10">
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function DraftBoolean({
  draft,
  field,
  label,
  onChange,
}: {
  draft: any;
  field: string;
  label: string;
  onChange: (field: string, value: unknown) => void;
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <Select value={draft?.[field] ? "yes" : "no"} onValueChange={(value) => onChange(field, value === "yes")}>
        <SelectTrigger className="min-h-10"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="no">Non</SelectItem>
          <SelectItem value="yes">Oui</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

async function loadTravelContextForTrip(tripId: string | null | undefined, participants: any[] = [], agency?: AgencySettings | null): Promise<TravelContext> {
  const ctx: TravelContext = { participants, agency, trip: null, programme: null, days: [], hotels: [] };
  if (!tripId) return ctx;

  const { data: trip } = await supabase.from("trips").select("*").eq("id", tripId).maybeSingle();
  ctx.trip = trip ?? null;
  if (!trip) return ctx;

  let programmeId = trip.programme_id;
  let matchedProgramme: any = null;
  if (programmeId) {
    const { data } = await supabase.from("programmes").select("*").eq("id", programmeId).maybeSingle();
    matchedProgramme = data ?? null;
  } else {
    const { data: programmes } = await supabase.from("programmes").select("*").order("sort_order");
    const tripText = normalizeMatchText([trip.title, trip.season, trip.label, trip.program_link].filter(Boolean).join(" "));
    matchedProgramme = (programmes ?? []).find((programme: any) => {
      const title = normalizeMatchText(programme.title);
      const slug = normalizeMatchText(programme.slug);
      return (
        (title && (tripText.includes(title) || title.includes(tripText))) ||
        (slug && (tripText.includes(slug) || String(trip.program_link ?? "").includes(programme.slug)))
      );
    });
    programmeId = matchedProgramme?.id ?? null;
  }

  const [daysRes, hotelsRes] = await Promise.all([
    programmeId
      ? supabase.from("programme_days").select("*").eq("programme_id", programmeId).order("day_number", { ascending: true })
      : Promise.resolve({ data: [] } as any),
    supabase
      .from("trip_hotels")
      .select("*")
      .eq("trip_id", trip.id)
      .order("sort_order")
      .order("check_in"),
  ]);
  ctx.programme = matchedProgramme;
  ctx.days = daysRes.data ?? [];
  ctx.hotels = hotelsRes.data ?? [];
  return ctx;
}

async function loadVisaBookingAssociation(appRow: any): Promise<VisaBookingAssociation> {
  const [bookingRes, participantRes] = await Promise.all([
    appRow?.booking_id
      ? supabase
        .from("bookings")
        .select("id,reference,status,contact_name,contact_email,trip_id,trips(id,title,start_date,end_date)")
        .eq("id", appRow.booking_id)
        .maybeSingle()
      : Promise.resolve({ data: null } as any),
    appRow?.booking_participant_id
      ? supabase
        .from("booking_participants")
        .select("*")
        .eq("id", appRow.booking_participant_id)
        .maybeSingle()
      : Promise.resolve({ data: null } as any),
  ]);

  return {
    booking: bookingRes.data ?? null,
    participant: participantRes.data ?? null,
  };
}

async function resolveFlightTicketStoragePaths(flight: any, bookingId: string, participantId?: string | null) {
  if (flight?.id && participantId) {
    const { data: links, error: linkError } = await (supabase as any)
      .from("booking_flight_ticket_document_travelers")
      .select("flight_ticket_document_id")
      .eq("flight_reservation_id", flight.id)
      .eq("participant_id", participantId);

    if (linkError && !/booking_flight_ticket_document_travelers|schema cache|Could not find the table/i.test(linkError.message ?? "")) {
      console.warn("[visa-flight-ticket] participant ticket links unavailable", linkError);
    }

    const documentIds = Array.from(new Set((links ?? []).map((row: any) => row.flight_ticket_document_id).filter(Boolean)));
    if (documentIds.length > 0) {
      const { data: ticketDocs, error: docsError } = await (supabase as any)
        .from("booking_flight_ticket_documents")
        .select("id,storage_path,file_name,created_at,updated_at")
        .in("id", documentIds)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (docsError && !/booking_flight_ticket_documents|schema cache|Could not find the table/i.test(docsError.message ?? "")) {
        console.warn("[visa-flight-ticket] participant ticket docs unavailable", docsError);
      }

      const resolved = (ticketDocs ?? [])
        .filter((doc: any) => doc.storage_path)
        .map((doc: any) => ({
          storagePath: doc.storage_path,
          fileName: doc.file_name ?? null,
          createdAt: doc.created_at ?? doc.updated_at ?? flight?.updated_at ?? null,
        }));
      if (resolved.length > 0) return resolved;
    }
  }

  if (flight?.ticket_storage_path) {
    return [{
      storagePath: flight.ticket_storage_path,
      fileName: null,
      createdAt: flight.ticket_uploaded_at ?? flight.updated_at ?? null,
    }];
  }

  if (flight?.ticket_document_id) {
    const { data } = await supabase
      .from("booking_documents" as any)
      .select("id,storage_path,created_at,updated_at")
      .eq("id", flight.ticket_document_id)
      .maybeSingle();
    if ((data as any)?.storage_path) {
      return [{
        storagePath: (data as any).storage_path,
        fileName: null,
        createdAt: (data as any).created_at ?? (data as any).updated_at ?? flight.updated_at ?? null,
      }];
    }
  }

  const { data: docs } = await supabase
    .from("booking_documents" as any)
    .select("id,storage_path,created_at,updated_at,document_type,kind")
    .eq("booking_id", bookingId)
    .or("document_type.eq.flight_ticket,kind.eq.billet_avion")
    .order("created_at", { ascending: false })
    .limit(1);

  const doc = docs?.[0] as any;
  if (doc?.storage_path) {
    return [{
      storagePath: doc.storage_path,
      fileName: null,
      createdAt: doc.created_at ?? doc.updated_at ?? flight?.updated_at ?? null,
    }];
  }

  return [];
}

async function loadVisaFlightTickets(appRow: any, participants: any[] = [], explicitParticipant?: any | null): Promise<VisaFlightTicket[]> {
  if (!appRow?.booking_id) {
    return [];
  }

  const subjectParticipant =
    explicitParticipant ??
    (appRow.booking_participant_id
      ? participants.find((participant: any) => participant.id === appRow.booking_participant_id)
      : null) ??
    participants.find((participant: any) => participant.booking_id === appRow.booking_id && participant.is_subject) ??
    participants.find((participant: any) =>
      participant.booking_id === appRow.booking_id &&
      appRow.passport_no &&
      participant.passport_no &&
      normalizePassportNo(participant.passport_no) === normalizePassportNo(appRow.passport_no)
    ) ??
    participants.find((participant: any) =>
      participant.booking_id === appRow.booking_id &&
      appRow.residential_email &&
      participant.email &&
      String(participant.email).trim().toLowerCase() === String(appRow.residential_email).trim().toLowerCase()
    ) ??
    null;

  const [{ data: booking }, { data: flights, error: flightError }] = await Promise.all([
    supabase.from("bookings").select("id,reference").eq("id", appRow.booking_id).maybeSingle(),
    (supabase as any)
      .from("booking_flight_reservations")
      .select("*")
      .eq("booking_id", appRow.booking_id)
      .neq("status", "cancelled")
      .order("updated_at", { ascending: false }),
  ]);

  if (flightError || !flights?.length) {
    return [];
  }
  const flightIds = flights.map((flight: any) => flight.id).filter(Boolean);
  let traveler: any | null = null;

  if (subjectParticipant?.id && flightIds.length > 0) {
    const { data: travelerRows } = await (supabase as any)
      .from("booking_flight_travelers")
      .select("*")
      .in("flight_reservation_id", flightIds)
      .eq("participant_id", subjectParticipant.id)
      .neq("traveler_status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(1);
    traveler = travelerRows?.[0] ?? null;
  }

  if (!subjectParticipant?.id) {
    return [];
  }

  const flight = traveler
    ? flights.find((row: any) => row.id === traveler.flight_reservation_id)
    : flights[0];
  const resolvedTickets = await resolveFlightTicketStoragePaths(flight, appRow.booking_id, subjectParticipant.id);
  if (!flight || resolvedTickets.length === 0) {
    return [];
  }

  return resolvedTickets.map((ticket) => ({
    flight,
    traveler,
    participant: subjectParticipant,
    bookingReference: (booking as any)?.reference ?? null,
    participantName: subjectParticipant ? participantFullName(subjectParticipant) : [appRow.given_names, appRow.surname].filter(Boolean).join(" ") || "Participant",
    storagePath: ticket.storagePath,
    fileName: ticket.fileName,
    createdAt: ticket.createdAt,
  }));
}

const ilikeTerm = (value: unknown) =>
  `%${String(value ?? "").replace(/[%_,]/g, " ").trim()}%`;

async function loadVisaAssociationSuggestions(appRow: any): Promise<VisaAssociationSuggestion[]> {
  const candidates = new Map<string, VisaAssociationSuggestion>();
  const addRows = (rows: any[] | null | undefined, confidence: VisaAssociationSuggestion["confidence"], reason: string) => {
    for (const row of rows ?? []) {
      if (!row?.id || !row?.booking_id) continue;
      const current = candidates.get(row.id);
      if (current && current.confidence === "exact") continue;
      candidates.set(row.id, {
        booking: null,
        participant: row,
        confidence,
        reason,
      } as any);
    }
  };

  const passport = String(appRow?.passport_no ?? "").trim();
  const email = String(appRow?.residential_email ?? "").trim();
  const surname = String(appRow?.surname ?? "").trim();
  const givenNames = String(appRow?.given_names ?? "").trim();

  if (passport) {
    const { data } = await supabase
      .from("booking_participants")
      .select("*")
      .ilike("passport_no", passport);
    addRows(data as any[], "exact", "Passeport exact");
  }

  if (email) {
    const { data } = await supabase
      .from("booking_participants")
      .select("*")
      .ilike("email", email);
    addRows(data as any[], "exact", "Email exact");
  }

  if (surname || givenNames) {
    const query = [surname, givenNames].filter(Boolean).join(" ");
    const { data } = await supabase
      .from("booking_participants")
      .select("*")
      .or(`first_name.ilike.${ilikeTerm(query)},last_name.ilike.${ilikeTerm(query)}`)
      .limit(10);
    addRows(data as any[], "check", "Nom à vérifier");
  }

  const bookingIds = Array.from(new Set(Array.from(candidates.values()).map((candidate) => candidate.participant.booking_id).filter(Boolean)));
  if (!bookingIds.length) return [];

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id,reference,status,contact_name,contact_email,trip_id,trips(id,title,start_date,end_date)")
    .in("id", bookingIds);
  const bookingById = new Map((bookings ?? []).map((booking: any) => [booking.id, booking]));

  return Array.from(candidates.values())
    .map((candidate) => ({
      ...candidate,
      booking: bookingById.get(candidate.participant.booking_id) ?? null,
    }))
    .filter((candidate) => candidate.booking)
    .slice(0, 5);
}

async function loadBookingParticipantsForAssociation(bookingId: string) {
  return supabase
    .from("booking_participants")
    .select("*")
    .eq("booking_id", bookingId)
    .order("is_lead", { ascending: false })
    .order("created_at", { ascending: true });
}

async function buildVisaHotelConfirmationItems(
  appRow: any,
  ctx: TravelContext,
  association: VisaBookingAssociation,
): Promise<VisaHotelConfirmationItem[]> {
  const trip = ctx.trip;
  const hotels = (ctx.hotels ?? []).filter((hotel: any) => hotel?.id);
  if (!appRow?.id || !trip?.id || !association.booking?.id || !association.participant?.id || hotels.length === 0) {
    return [];
  }

  const hotelIds = hotels.map((hotel: any) => hotel.id);
  const [{ data: groupRows, error: groupError }, { data: docRows, error: docError }, roomingData] = await Promise.all([
    (supabase as any)
      .from("visa_hotel_group_reservations")
      .select("*")
      .eq("trip_id", trip.id)
      .in("trip_hotel_id", hotelIds)
      .neq("reservation_status", "cancelled"),
    (supabase as any)
      .from("visa_hotel_confirmation_documents")
      .select("*")
      .eq("visa_application_id", appRow.id)
      .eq("is_current", true)
      .neq("status", "cancelled"),
    loadOperationalRoomingForTrip(trip.id),
  ]);

  if (isMissingTableError(groupError, "visa_hotel_group_reservations") || isMissingTableError(docError, "visa_hotel_confirmation_documents")) {
    throw new Error("Les tables de confirmations hôtel ne sont pas encore disponibles. Appliquez la migration visa_hotel_reservation_confirmations dans Lovable.");
  }
  if (groupError) throw groupError;
  if (docError) throw docError;

  const groupsByHotel = new Map((groupRows ?? []).map((row: any) => [`${row.trip_hotel_id}:${row.check_in}:${row.check_out}`, row]));
  const docsByHotel = new Map((docRows ?? []).map((row: any) => [row.trip_hotel_id, row]));
  const stayByHotelId = new Map((roomingData.stays ?? []).map((stay: any) => [stay.hotel.id, stay]));
  const hotelNameCounts = hotels.reduce((counts, hotel: any) => {
    const key = normalizedHotelStayName(hotel) || String(hotel.id);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  const hotelNameSequences = new Map<string, number>();

  return hotels.map((hotel: any, index: number) => {
    const stayNameKey = normalizedHotelStayName(hotel) || String(hotel.id);
    const sameNameCount = hotelNameCounts.get(stayNameKey) ?? 1;
    const stayNameSequence = (hotelNameSequences.get(stayNameKey) ?? 0) + 1;
    hotelNameSequences.set(stayNameKey, stayNameSequence);
    const stayLabel = `Séjour ${sameNameCount > 1 ? stayNameSequence : index + 1}`;
    const stay = stayByHotelId.get(hotel.id) ?? null;
    const groupReference = buildHotelGroupReference(trip, hotel, index);
    const group = groupsByHotel.get(`${hotel.id}:${hotel.check_in}:${hotel.check_out}`) ?? null;
    const documentReference = buildHotelDocumentReference(group?.group_reservation_reference ?? groupReference, appRow.id, hotel.id);
    const rooms = stay?.rooms ?? [];
    const confirmationRooms = rooms.map((roomModel: any) => {
      const roomGuests = roomModel.occupants.map((occupant: any) => buildGuestFromParticipant(occupant.participant, association.participant.id, {
        ...roomModel.room,
        room_number: `Room ${roomModel.roomOrder}`,
      }));
    return buildHotelConfirmationRoom(
        roomModel.room.id,
        `Room ${roomModel.roomOrder}`,
        roomModel.room,
        roomGuests,
      );
    });
    const guests = confirmationRooms.flatMap((room) => room.guests);
    const applicantRoom = rooms.find((roomModel: any) =>
      roomModel.occupants.some((occupant: any) => occupant.participant?.id === association.participant.id)
    ) ?? null;
    const draft: HotelConfirmationDraft = {
      documentReference,
      groupReservationReference: group?.group_reservation_reference ?? groupReference,
      groupReservationName: group?.group_reservation_name ?? HOTEL_GROUP_RESERVATION_NAME,
      issueDate: new Date().toISOString().slice(0, 10),
      reservationStatus: group?.reservation_status ?? hotel.confirmation_status ?? "confirmed",
      hotelName: hotel.official_name ?? hotel.name ?? "",
      hotelAddress: hotel.address ?? "",
      hotelCity: hotel.city ?? null,
      hotelPrefecture: hotel.prefecture ?? hotel.metadata?.prefecture ?? null,
      hotelPhone: hotel.phone ?? "",
      hotelEmail: hotel.email ?? hotel.metadata?.email ?? null,
      hotelWebsite: hotel.website ?? hotel.metadata?.website ?? null,
      japanesePartner: group?.partner_name ?? hotel.partner_name ?? hotel.metadata?.partner_name ?? null,
      japanesePartnerAddress: group?.metadata?.partner_address ?? hotel.partner_address ?? hotel.metadata?.partner_address ?? null,
      japanesePartnerPhone: group?.metadata?.partner_phone ?? hotel.partner_phone ?? hotel.metadata?.partner_phone ?? null,
      supplierReference: group?.supplier_reference ?? hotel.supplier_reference ?? hotel.metadata?.supplier_reference ?? null,
      checkIn: hotel.check_in ?? "",
      checkOut: hotel.check_out ?? "",
      nights: nightsBetween(hotel.check_in, hotel.check_out),
      numberOfRooms: rooms.length || hotel.room_count || null,
      roomTypes: Array.from(new Set(rooms.map((roomModel: any) => roomModel.room.room_type).filter(Boolean))).join(", ") || hotel.room_type || null,
      mealPlan: hotel.board_basis ?? hotel.meal_plan ?? hotel.metadata?.meal_plan ?? null,
      paymentStatus: hotel.payment_status ?? hotel.metadata?.payment_status ?? null,
      applicantParticipantId: association.participant.id,
      applicantName: participantFullName(association.participant),
      bookingReference: association.booking?.reference ?? null,
      tripTitle: trip.title ?? null,
      guests,
      rooms: confirmationRooms,
      roomingMissing: rooms.length === 0,
      agency: ctx.agency ?? null,
    };
    let errors = validateHotelConfirmationDraft(draft);
    if (!stay) {
      errors = ["Mauvaise correspondance d’hôtel: ce séjour n’existe pas dans la rooming list opérationnelle.", ...errors];
    } else if (rooms.length === 0) {
      errors = ["Rooming list absente pour cet hôtel.", ...errors];
    } else {
      const emptyRooms = rooms.filter((roomModel: any) => roomModel.occupiedCount === 0);
      if (emptyRooms.length) {
        errors = [
          ...emptyRooms.map((roomModel: any) => `Chambre ${roomModel.roomOrder} sans occupant.`),
          ...errors,
        ];
      }
      if (!guests.length) {
        errors = ["Rooming list créée mais vide pour cet hôtel.", ...errors];
      }
      if (!applicantRoom) {
        errors = ["Le demandeur du visa n’est affecté à aucune chambre pour ce séjour.", ...errors];
      }
    }
    if (isHotelProvisional(hotel)) {
      errors = [`Hôtel provisoire ou similaire non accepté pour ${hotel.name}. Confirmez l'hôtel définitif avant génération.`, ...errors];
    }
    const dataHash = hotelConfirmationDataHash(draft);
    const document = docsByHotel.get(hotel.id) ?? null;
    const status: VisaHotelConfirmationItem["status"] = errors.length
      ? "missing"
      : document
        ? document.data_hash && document.data_hash !== dataHash
          ? "needs_regeneration"
          : "generated"
        : "ready";
    return {
      hotel,
      stayIndex: index,
      stayLabel,
      isRepeatedHotelStayName: sameNameCount > 1,
      groupReservation: group,
      document,
      draft,
      dataHash,
      errors: Array.from(new Set(errors)),
      status,
      diagnostics: {
        totalTripParticipants: stay?.diagnostics.totalTripParticipants ?? roomingData.participants.length,
        assignedParticipants: stay?.diagnostics.assignedParticipants ?? 0,
        roomCount: stay?.diagnostics.roomCount ?? 0,
        completeRoomCount: stay?.diagnostics.completeRoomCount ?? 0,
        freePlaces: stay?.diagnostics.freePlaces ?? 0,
        emptyRoomCount: stay?.diagnostics.emptyRoomCount ?? 0,
        applicantRoomLabel: applicantRoom ? `Chambre ${applicantRoom.roomOrder}` : null,
      },
    };
  });
}

export default function VisaApplicationDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [app, setApp] = useState<any | null>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [visaFlightTickets, setVisaFlightTickets] = useState<VisaFlightTicket[]>([]);
  const [settings, setSettings] = useState<any | null>(null);
  const [checklists, setChecklists] = useState<any[]>([]);
  const [trips, setTrips] = useState<any[]>([]);
  const [bookingTripId, setBookingTripId] = useState<string | null>(null);
  const [selectedTravelTripId, setSelectedTravelTripId] = useState<string | null>(null);
  const [travelCtx, setTravelCtx] = useState<TravelContext>({});
  const [editingVisaInfo, setEditingVisaInfo] = useState(false);
  const [visaDraft, setVisaDraft] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<null | "visa" | "invitation" | "guarantee" | "programme" | "confirmation">(null);
  const [visaProgramV2Open, setVisaProgramV2Open] = useState(false);
  const [visaProgramV2Draft, setVisaProgramV2Draft] = useState<VisaProgramV2Draft | null>(null);
  const [visaAssociation, setVisaAssociation] = useState<VisaBookingAssociation>({ booking: null, participant: null });
  const [hotelConfirmations, setHotelConfirmations] = useState<VisaHotelConfirmationItem[]>([]);
  const [hotelConfirmationsWarning, setHotelConfirmationsWarning] = useState<string | null>(null);
  const [hotelPreview, setHotelPreview] = useState<VisaHotelConfirmationItem | null>(null);
  const [submissionHistory, setSubmissionHistory] = useState<any[]>([]);
  const [associationDialogOpen, setAssociationDialogOpen] = useState(false);
  const [associationSearch, setAssociationSearch] = useState("");
  const [associationSearchBusy, setAssociationSearchBusy] = useState(false);
  const [associationResults, setAssociationResults] = useState<any[]>([]);
  const [associationParticipants, setAssociationParticipants] = useState<any[]>([]);
  const [associationParticipantsLoading, setAssociationParticipantsLoading] = useState(false);
  const [associationParticipantsError, setAssociationParticipantsError] = useState<string | null>(null);
  const [selectedAssociationBooking, setSelectedAssociationBooking] = useState<any | null>(null);
  const [selectedAssociationParticipantId, setSelectedAssociationParticipantId] = useState<string>("");
  const [associationSaving, setAssociationSaving] = useState(false);
  const [associationSuggestions, setAssociationSuggestions] = useState<VisaAssociationSuggestion[]>([]);

  useEffect(() => {
    Promise.all([
      supabase.from("visa_applications").select("*").eq("id", id!).maybeSingle(),
      supabase.from("visa_documents").select("*").eq("application_id", id!).order("created_at"),
      supabase.from("visa_settings").select("*").limit(1).maybeSingle(),
      supabase.from("visa_document_checklists").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("trips").select("id,title,season,start_date,end_date,label,total_trip_days,duration_days,japan_stay_days,visa_japan_arrival_date,visa_japan_departure_date").order("start_date", { ascending: false }),
      fetchAgencySettings(),
    ]).then(async ([a, d, s, c, t, agency]) => {
      if (!a.data) { toast.error("Demande introuvable"); nav("/admin/visa"); return; }
      let appRow: any = a.data;
      let nextBookingTripId: string | null = null;
      const documentTripId: string | null = appRow.document_trip_id ?? null;
      let participants: any[] = [];

      if (appRow.booking_id) {
        const { data: booking } = await supabase
          .from("bookings")
          .select("id, trip_id")
          .eq("id", appRow.booking_id)
          .maybeSingle();
        nextBookingTripId = (booking as any)?.trip_id ?? null;
        if (nextBookingTripId) {
          const { data: activeBookings } = await supabase
            .from("bookings")
            .select("id,status,created_at")
            .eq("trip_id", nextBookingTripId)
            .in("status", ["lead", "confirmed", "paid", "completed"])
            .order("created_at");
          const bookingIds = (activeBookings ?? []).map((row: any) => row.id);
          if (bookingIds.length) {
            const bookingOrder = new Map(bookingIds.map((bookingId: string, index: number) => [bookingId, index]));
            const { data: participantRows } = await supabase
              .from("booking_participants")
              .select("*")
              .in("booking_id", bookingIds)
              .order("created_at");
            const seen = new Set<string>();
            participants = (participantRows ?? [])
              .map((participant: any) => {
                const isSubject = Boolean(
                  (appRow.client_id && participant.client_id === appRow.client_id) ||
                  (appRow.passport_no && participant.passport_no && normalizePassportNo(participant.passport_no) === normalizePassportNo(appRow.passport_no)) ||
                  (appRow.residential_email && participant.email && String(participant.email).trim().toLowerCase() === String(appRow.residential_email).trim().toLowerCase())
                );
                return {
                  ...participant,
                  is_subject: isSubject,
                  source_order: bookingOrder.get(participant.booking_id) ?? 9999,
                };
              })
              .filter((participant: any) => {
                const key = participant.id || (participant.client_id ? `client:${participant.client_id}` : null) || `${participant.booking_id}:${participant.first_name}:${participant.last_name}:${participant.passport_no}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              })
              .sort((a: any, b: any) => (a.source_order - b.source_order) || String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`));
          }
        }
      }

      const association = await loadVisaBookingAssociation(appRow);
      const submissions = await loadVisaSubmissionHistory(appRow.id);
      const effectiveTravelTripId = documentTripId || nextBookingTripId;
      const ctx = await loadTravelContextForTrip(effectiveTravelTripId, participants, agency);
      const flightTickets = await loadVisaFlightTickets(appRow, participants, association.participant);
      const suggestions = appRow.booking_participant_id ? [] : await loadVisaAssociationSuggestions(appRow);
      let hotels: VisaHotelConfirmationItem[] = [];
      let hotelWarning: string | null = null;
      try {
        hotels = await buildVisaHotelConfirmationItems(appRow, ctx, association);
      } catch (error: any) {
        hotelWarning = error?.message ?? "Impossible de charger les confirmations d’hôtel.";
      }

      if (ctx.trip) {
          const visaTripDates = visaTripDatesFromTrip(ctx.trip);
          const patch: any = {};
          if (!appRow.date_of_arrival && visaTripDates.japanArrivalDate) patch.date_of_arrival = visaTripDates.japanArrivalDate;
          if (!appRow.intended_length_of_stay && visaTripDates.japanStayDays) patch.intended_length_of_stay = `${visaTripDates.japanStayDays} jours`;
          if (!appRow.port_of_entry && ctx.trip.visa_arrival_port) patch.port_of_entry = ctx.trip.visa_arrival_port;
          if (!appRow.airline_or_ship && ctx.trip.visa_arrival_flight_number) patch.airline_or_ship = ctx.trip.visa_arrival_flight_number;
          if (!appRow.hotel_name && ctx.trip.visa_hotel_name) patch.hotel_name = ctx.trip.visa_hotel_name;
          if (!appRow.hotel_address && ctx.trip.visa_hotel_address) patch.hotel_address = ctx.trip.visa_hotel_address;
          if (!appRow.hotel_tel && ctx.trip.visa_hotel_phone) patch.hotel_tel = ctx.trip.visa_hotel_phone;
          if (Object.keys(patch).length) {
            await supabase.from("visa_applications").update(patch).eq("id", appRow.id);
            appRow = { ...appRow, ...patch };
          }
      }

      setApp(appRow);
      setDocs(d.data ?? []);
      setVisaFlightTickets(flightTickets);
      setVisaAssociation(association);
      setHotelConfirmations(hotels);
      setHotelConfirmationsWarning(hotelWarning);
      setAssociationSuggestions(suggestions);
      setSubmissionHistory(submissions);
      setSettings(s.data);
      setChecklists(c.data ?? []);
      setTrips(t.data ?? []);
      setBookingTripId(nextBookingTripId);
      setSelectedTravelTripId(effectiveTravelTripId);
      setTravelCtx(ctx);
    });
  }, [id, nav]);

  const refreshVisaAssociation = async (nextApp: any, participants: any[] = travelCtx.participants ?? []) => {
    const association = await loadVisaBookingAssociation(nextApp);
    const flightTickets = await loadVisaFlightTickets(nextApp, participants, association.participant);
    const suggestions = nextApp.booking_participant_id ? [] : await loadVisaAssociationSuggestions(nextApp);
    let hotels: VisaHotelConfirmationItem[] = [];
    let hotelWarning: string | null = null;
    try {
      hotels = await buildVisaHotelConfirmationItems(nextApp, travelCtx, association);
    } catch (error: any) {
      hotelWarning = error?.message ?? "Impossible de charger les confirmations d’hôtel.";
    }
    setVisaAssociation(association);
    setVisaFlightTickets(flightTickets);
    setHotelConfirmations(hotels);
    setHotelConfirmationsWarning(hotelWarning);
    setAssociationSuggestions(suggestions);
  };

  const loadAssociationParticipants = async (booking: any) => {
    setSelectedAssociationBooking(booking);
    setSelectedAssociationParticipantId("");
    setAssociationParticipants([]);
    setAssociationParticipantsError(null);
    const bookingId = booking?.id;
    if (!bookingId || !isUuid(bookingId)) {
      setAssociationParticipantsError("Identifiant interne de réservation manquant ou invalide.");
      return false;
    }

    setAssociationParticipantsLoading(true);
    const { data, error } = await loadBookingParticipantsForAssociation(bookingId);
    setAssociationParticipantsLoading(false);
    if (error) {
      logAssociationParticipantsError(error, bookingId);
      setAssociationParticipantsError("Les participants n’ont pas pu être chargés.");
      setAssociationParticipants([]);
      return false;
    }
    const seen = new Set<string>();
    const participants = (data ?? []).filter((participant: any) => {
      if (!participant?.id || seen.has(participant.id)) return false;
      seen.add(participant.id);
      return isActiveTravelParticipant(participant);
    });
    setAssociationParticipants(participants);
    return true;
  };

  const searchAssociationBookings = async (searchValue = associationSearch) => {
    const term = searchValue.trim();
    setAssociationSearchBusy(true);
    try {
      const bookingMap = new Map<string, any>();
      const addBookings = (rows: any[] | null | undefined) => {
        for (const row of rows ?? []) {
          if (row?.id) bookingMap.set(row.id, row);
        }
      };
      const bookingSelect = "id,reference,status,contact_name,contact_email,trip_id,created_at,trips(id,title,start_date,end_date)";

      let recentQuery = supabase
        .from("bookings")
        .select(bookingSelect)
        .order("created_at", { ascending: false })
        .limit(25);
      if (term) {
        recentQuery = recentQuery.or(`reference.ilike.${ilikeTerm(term)},contact_name.ilike.${ilikeTerm(term)},contact_email.ilike.${ilikeTerm(term)}`);
      }
      const { data: bookingRows, error: bookingError } = await recentQuery;
      if (bookingError) throw bookingError;
      addBookings(bookingRows as any[]);

      if (term) {
        const { data: participantRows } = await supabase
          .from("booking_participants")
          .select("booking_id")
          .or(`first_name.ilike.${ilikeTerm(term)},last_name.ilike.${ilikeTerm(term)},email.ilike.${ilikeTerm(term)},passport_no.ilike.${ilikeTerm(term)}`)
          .limit(50);
        const participantBookingIds = Array.from(new Set((participantRows ?? []).map((row: any) => row.booking_id).filter(Boolean)));
        if (participantBookingIds.length) {
          const { data } = await supabase
            .from("bookings")
            .select(bookingSelect)
            .in("id", participantBookingIds);
          addBookings(data as any[]);
        }

        const { data: tripRows } = await supabase
          .from("trips")
          .select("id")
          .ilike("title", ilikeTerm(term))
          .limit(25);
        const tripIds = (tripRows ?? []).map((row: any) => row.id).filter(Boolean);
        if (tripIds.length) {
          const { data } = await supabase
            .from("bookings")
            .select(bookingSelect)
            .in("trip_id", tripIds)
            .limit(50);
          addBookings(data as any[]);
        }
      }

      const results = Array.from(bookingMap.values())
        .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
        .slice(0, 30);
      setAssociationResults(results);
    } catch (error: any) {
      toast.error(`Recherche impossible: ${error?.message ?? "erreur inconnue"}`);
    } finally {
      setAssociationSearchBusy(false);
    }
  };

  const openAssociationDialog = async () => {
    setAssociationDialogOpen(true);
    const defaultSearch = app?.reference || app?.passport_no || app?.residential_email || [app?.surname, app?.given_names].filter(Boolean).join(" ");
    setAssociationSearch(defaultSearch ?? "");
    setAssociationResults([]);
    setAssociationParticipants([]);
    setAssociationParticipantsError(null);
    setAssociationParticipantsLoading(false);
    setSelectedAssociationBooking(null);
    setSelectedAssociationParticipantId("");
    await searchAssociationBookings(defaultSearch ?? "");
  };

  const confirmAssociation = async () => {
    if (!app?.id || !selectedAssociationBooking?.id || !selectedAssociationParticipantId) {
      toast.error("Sélectionnez une réservation puis le participant exact.");
      return;
    }
    const selectedParticipant = associationParticipants.find((participant) => participant.id === selectedAssociationParticipantId);
    if (!selectedParticipant || selectedParticipant.booking_id !== selectedAssociationBooking.id) {
      toast.error("Le participant sélectionné n’appartient pas à cette réservation.");
      return;
    }

    setAssociationSaving(true);
    const patch = {
      booking_id: selectedAssociationBooking.id,
      booking_participant_id: selectedAssociationParticipantId,
    };
    const { data, error } = await supabase
      .from("visa_applications")
      .update(patch as any)
      .eq("id", app.id)
      .select("*")
      .maybeSingle();
    setAssociationSaving(false);
    if (error) return toast.error(error.message);
    const nextApp = data ?? { ...app, ...patch };
    setApp(nextApp);
    setBookingTripId(selectedAssociationBooking.trip_id ?? null);
    await refreshVisaAssociation(nextApp);
    setAssociationDialogOpen(false);
    toast.success("Réservation associée au dossier visa.");
  };

  const clearAssociation = async () => {
    if (!app?.id) return;
    if (!window.confirm("Retirer l’association ? Le dossier visa, la réservation et le participant seront conservés.")) return;
    setAssociationSaving(true);
    const { data, error } = await supabase
      .from("visa_applications")
      .update({ booking_id: null, booking_participant_id: null } as any)
      .eq("id", app.id)
      .select("*")
      .maybeSingle();
    setAssociationSaving(false);
    if (error) return toast.error(error.message);
    const nextApp = data ?? { ...app, booking_id: null, booking_participant_id: null };
    setApp(nextApp);
    await refreshVisaAssociation(nextApp, []);
    toast.success("Association retirée.");
  };

  const updateStatus = async (status: string) => {
    setBusy(true);
    const patch: any = { status, reviewed_at: new Date().toISOString() };
    const { error } = await supabase.from("visa_applications").update(patch).eq("id", app.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    setApp({ ...app, ...patch });
    toast.success("Statut mis à jour");
    // Fire-and-forget email notification to the client
    const payload = {
      application_id: app.id,
      status,
      extra: app.requested_documents ?? null,
    };
    supabase.functions.invoke("send-visa-email", {
      body: payload,
    }).then(({ error: e }) => {
      if (e) console.warn("notification email failed", e);
    });
  };

  const saveNotes = async () => {
    const { error } = await supabase.from("visa_applications").update({ admin_notes: app.admin_notes ?? "" }).eq("id", app.id);
    if (error) return toast.error(error.message);
    toast.success("Notes enregistrées");
  };

  const openVisaEdit = () => {
    setVisaDraft({
      ...app,
      category: app.category ?? "tourism",
      passport_type: app.passport_type ?? "ordinary",
      purpose_of_visit: app.purpose_of_visit || "Tourisme",
      date_of_application: app.date_of_application || todayISO(),
    });
    setEditingVisaInfo(true);
  };

  const updateVisaDraft = (key: string, value: unknown) => {
    setVisaDraft((current: any) => ({ ...current, [key]: value }));
  };

  const updateVisaDraftProfessionalSituation = (value: string) => {
    setVisaDraft((current: any) => {
      const next = { ...current, category: value };
      if (isRetiredVisaCategory(value)) {
        next.profession = next.profession || "Retraité";
        next.employer_name = "";
        next.employer_tel = "";
        next.employer_address = "";
      }
      return next;
    });
  };

  const updateVisaDraftPreviousStay = (patch: Partial<ReturnType<typeof parsePreviousJapanStay>>) => {
    setVisaDraft((current: any) => {
      const previousStay = parsePreviousJapanStay(current?.previous_stays);
      return {
        ...current,
        previous_stays: buildPreviousJapanStayValue({ ...previousStay, ...patch }),
      };
    });
  };

  const saveVisaInfo = async () => {
    if (!app?.id || !visaDraft) return;
    const editableFields = [
      "category",
      "surname",
      "given_names",
      "other_names",
      "date_of_birth",
      "place_of_birth_city",
      "place_of_birth_state",
      "place_of_birth_country",
      "sex",
      "marital_status",
      "nationality",
      "former_nationality",
      "national_id_no",
      "passport_type",
      "passport_no",
      "passport_place_of_issue",
      "passport_date_of_issue",
      "passport_issuing_authority",
      "passport_date_of_expiry",
      "certificate_of_eligibility_no",
      "purpose_of_visit",
      "intended_length_of_stay",
      "date_of_arrival",
      "port_of_entry",
      "airline_or_ship",
      "hotel_name",
      "hotel_tel",
      "hotel_address",
      "previous_stays",
      "residential_address",
      "residential_tel",
      "residential_mobile",
      "residential_email",
      "profession",
      "partner_profession",
      "employer_name",
      "employer_tel",
      "employer_address",
      "q_convicted_crime",
      "q_imprisoned_1y",
      "q_deported",
      "q_drug_offence",
      "q_prostitution",
      "q_trafficking",
      "declarations_details",
      "remarks",
      "date_of_application",
    ];
    const normalizedDraft = isRetiredVisaCategory(visaDraft.category)
      ? {
          ...visaDraft,
          profession: visaDraft.profession || "Retraité",
          employer_name: null,
          employer_tel: null,
          employer_address: null,
        }
      : visaDraft;
    const patch = editableFields.reduce<Record<string, unknown>>((acc, key) => {
      const value = normalizedDraft[key];
      acc[key] = value === "" ? null : value;
      return acc;
    }, {});
    setBusy(true);
    const { data, error } = await supabase
      .from("visa_applications")
      .update(patch as any)
      .eq("id", app.id)
      .select("*")
      .maybeSingle();
    setBusy(false);
    if (error) return toast.error(error.message);
    if (data) setApp(data);
    setEditingVisaInfo(false);
    toast.success("Informations visa mises à jour");
  };

  const refreshFromTravelerFile = async () => {
    const passportNo = normalizePassportNo(app?.passport_no);
    if (!passportNo) return toast.error("Aucun numéro de passeport à rechercher.");
    setBusy(true);
    const lookup = await lookupVisaPrefillByPassport({
      passportNo,
      lastName: app?.surname ?? "",
      email: app?.residential_email ?? "",
    });
    setBusy(false);
    if (lookup.status !== "matched") {
      toast.info(lookup.message);
      return;
    }
    const patch = {
      ...lookup.patch,
      purpose_of_visit: app.purpose_of_visit || "Tourisme",
      date_of_application: app.date_of_application || todayISO(),
    };
    setBusy(true);
    const { data, error } = await supabase
      .from("visa_applications")
      .update(patch as any)
      .eq("id", app.id)
      .select("*")
      .maybeSingle();
    setBusy(false);
    if (error) return toast.error(error.message);
    if (data) setApp(data);
    toast.success(`Dossier reprérempli depuis: ${lookup.sourceLabel}`);
  };

  const saveTravelFields = async () => {
    const patch = {
      date_of_arrival: app.date_of_arrival || null,
      port_of_entry: app.port_of_entry || null,
      airline_or_ship: app.airline_or_ship || null,
      hotel_name: app.hotel_name || null,
      hotel_tel: app.hotel_tel || null,
      hotel_address: app.hotel_address || null,
    };
    const { error } = await supabase.from("visa_applications").update(patch).eq("id", app.id);
    if (error) return toast.error(error.message);
    toast.success("Informations voyage enregistrées");
  };

  const applyTripVisaDates = async () => {
    if (!app?.id || !travelCtx.trip) return toast.error("Aucun voyage sélectionné.");
    const dates = visaTripDatesFromTrip(travelCtx.trip);
    const patch = {
      date_of_arrival: dates.japanArrivalDate || null,
      intended_length_of_stay: dates.japanStayDays ? `${dates.japanStayDays} jours` : null,
    };
    const { error } = await supabase.from("visa_applications").update(patch).eq("id", app.id);
    if (error) return toast.error(error.message);
    setApp({ ...app, ...patch });
    toast.success("Dates visa du voyage appliquées.");
  };

  const documentTripId = app?.document_trip_id ?? null;
  const canonicalVisaTripDates = visaTripDatesFromTrip(travelCtx.trip);
  const expectedVisaStayLabel = canonicalVisaTripDates.japanStayDays ? `${canonicalVisaTripDates.japanStayDays} jours` : "";
  const currentStayNumber = String(app?.intended_length_of_stay ?? "").match(/\d+/)?.[0] ?? "";
  const visaDatesMismatch = Boolean(
    travelCtx.trip?.id && (
      (canonicalVisaTripDates.japanArrivalDate && app?.date_of_arrival && app.date_of_arrival !== canonicalVisaTripDates.japanArrivalDate) ||
      (canonicalVisaTripDates.japanStayDays && currentStayNumber && Number(currentStayNumber) !== canonicalVisaTripDates.japanStayDays)
    )
  );
  const travelTripWarnings = [
    !selectedTravelTripId ? "Aucun voyage n'est sélectionné pour les documents de voyage." : null,
    !documentTripId && !bookingTripId ? "Aucun voyage n'est lié à la réservation de cette demande visa." : null,
    !travelCtx.trip?.id ? "Aucun voyage n'est sélectionné pour les documents de voyage." : null,
    travelCtx.trip?.id && !canonicalVisaTripDates.japanStayDays ? "Le nombre de jours au Japon n'est pas renseigné sur ce voyage." : null,
    visaDatesMismatch ? "Les dates visa ne correspondent pas aux dates configurées pour ce voyage." : null,
  ].filter(Boolean) as string[];

  const confirmationWarnings = [
    !travelCtx.trip?.id ? "Aucun voyage n'est sélectionné pour les documents de voyage." : null,
    !hasText(travelCtx.trip?.outbound_flight_text) ? "Aucun texte complet de vol aller n'est renseigné." : null,
    !hasText(travelCtx.trip?.return_flight_text) ? "Aucun texte complet de vol retour n'est renseigné." : null,
    !(travelCtx.hotels?.length) ? "Aucun hôtel détaillé n'est lié à ce voyage." : null,
    !hasText(travelCtx.trip?.programme_id) ? "Aucun programme n'est lié à ce voyage." : null,
  ].filter(Boolean) as string[];

  const warnIfConfirmationIncomplete = () => {
    if (!confirmationWarnings.length) return;
    toast.warning("Confirmation voyage incomplète", {
      description: confirmationWarnings.join(" "),
    });
  };

  const ensureTravelTripSelected = () => {
    if (travelCtx.trip?.id) return true;
    toast.error("Aucun voyage n'est sélectionné pour les documents de voyage.");
    return false;
  };

  const changeTravelTrip = async (value: string) => {
    if (!app?.id) return;
    const tripId = value === "none" ? null : value;
    setBusy(true);
    const { error } = await supabase
      .from("visa_applications")
      .update({ document_trip_id: tripId } as any)
      .eq("id", app.id);
    setBusy(false);
    if (error) return toast.error(error.message);

    const effectiveTravelTripId = tripId || bookingTripId;
    const nextCtx = await loadTravelContextForTrip(effectiveTravelTripId, travelCtx.participants ?? [], travelCtx.agency ?? null);
    setApp((current: any) => current ? { ...current, document_trip_id: tripId } : current);
    setSelectedTravelTripId(effectiveTravelTripId);
    setTravelCtx(nextCtx);
    await refreshHotelConfirmations(app, nextCtx, visaAssociation);
    toast.success("Voyage utilisé pour les documents enregistré.");
  };

  const requestDocs = async () => {
    const text = (app.requested_documents ?? "").trim();
    if (!text) return toast.error("Indiquez les documents demandés.");
    setBusy(true);
    const patch = { requested_documents: text, documents_requested_at: new Date().toISOString() };
    const { error } = await supabase.from("visa_applications").update(patch).eq("id", app.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    setApp({ ...app, ...patch });
    toast.success("Demande envoyée au client.");
  };

  const sendFormReceived = async () => {
    if (!app) return;
    if (!confirm("Envoyer l'email de confirmation de réception du formulaire au client ?")) return;
    setBusy(true);
    const payload = {
      application_id: app.id,
      status: "form_received",
    };
    const { error } = await supabase.functions.invoke("send-visa-email", {
      body: payload,
    });
    setBusy(false);
    if (error) return toast.error(error.message ?? "Échec de l'envoi");
    toast.success("Email envoyé au client");
  };

  const clearRequest = async () => {
    setBusy(true);
    const patch = { requested_documents: null, documents_requested_at: null };
    const { error } = await supabase.from("visa_applications").update(patch).eq("id", app.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    setApp({ ...app, ...patch });
  };

  const downloadDoc = async (d: any) => {
    const { data, error } = await supabase.storage.from("visa-docs").createSignedUrl(d.storage_path, 60);
    if (error || !data) return toast.error("Lien indisponible");
    window.open(data.signedUrl, "_blank");
  };

  const downloadStampedFlightTicket = async (ticket: VisaFlightTicket) => {
    if (!ticket) return toast.error("Aucun billet d’avion lié à ce dossier visa.");
    setBusy(true);
    try {
      const { data, error } = await supabase.storage.from("booking-docs").download(ticket.storagePath);
      if (error || !data) throw error ?? new Error("Billet PDF introuvable.");
      if (data.type && data.type !== "application/pdf") throw new Error("Le billet doit être un PDF pour générer une copie cachetée.");
      const bytes = await createStampedFlightTicketPdf(await data.arrayBuffer(), {
        participantName: ticket.participantName,
        bookingReference: ticket.bookingReference,
      });
      downloadBytes(bytes, flightTicketVisaFilename(ticket.participantName));
    } catch (error: any) {
      toast.error(error?.message ?? "Téléchargement du billet cacheté impossible.");
    } finally {
      setBusy(false);
    }
  };

  const refreshHotelConfirmations = async (nextApp: any = app, nextCtx: TravelContext = travelCtx, nextAssociation: VisaBookingAssociation = visaAssociation) => {
    try {
      const items = await buildVisaHotelConfirmationItems(nextApp, nextCtx, nextAssociation);
      setHotelConfirmations(items);
      setHotelConfirmationsWarning(null);
      return items;
    } catch (error: any) {
      const message = error?.message ?? "Impossible de charger les confirmations d’hôtel.";
      setHotelConfirmationsWarning(message);
      return [];
    }
  };

  const findExistingHotelGroupReservation = async (item: VisaHotelConfirmationItem) => {
    const { data, error } = await (supabase as any)
      .from("visa_hotel_group_reservations")
      .select("*")
      .eq("trip_id", travelCtx.trip?.id)
      .eq("trip_hotel_id", item.hotel.id)
      .eq("check_in", item.draft.checkIn)
      .eq("check_out", item.draft.checkOut)
      .neq("reservation_status", "cancelled")
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  };

  const draftWithResolvedHotelGroup = (
    item: VisaHotelConfirmationItem,
    group: any,
  ): HotelConfirmationDraft => {
    const groupReference = group?.group_reservation_reference ?? item.draft.groupReservationReference;
    return {
      ...item.draft,
      groupReservationReference: groupReference,
      groupReservationName: (group?.group_reservation_name ?? item.draft.groupReservationName) || HOTEL_GROUP_RESERVATION_NAME,
      supplierReference: group?.supplier_reference ?? item.draft.supplierReference,
      japanesePartner: group?.partner_name ?? item.draft.japanesePartner,
      reservationStatus: group?.reservation_status ?? item.draft.reservationStatus,
      documentReference: buildHotelDocumentReference(groupReference, app?.id ?? "", item.hotel.id),
    };
  };

  const ensureHotelGroupReservation = async (item: VisaHotelConfirmationItem) => {
    if (item.groupReservation?.id) return item.groupReservation;
    const existing = await findExistingHotelGroupReservation(item);
    if (existing?.id) return existing;

    const { data: userData } = await supabase.auth.getUser();
    const candidateReferences = Array.from(new Set([
      item.draft.groupReservationReference,
      travelCtx.trip ? buildHotelGroupReference(travelCtx.trip, item.hotel, item.stayIndex, 10) : null,
      travelCtx.trip ? buildHotelGroupReference(travelCtx.trip, item.hotel, item.stayIndex, 16) : null,
    ].filter(Boolean))) as string[];

    for (const reference of candidateReferences) {
      const payload = {
        trip_id: travelCtx.trip?.id,
        trip_hotel_id: item.hotel.id,
        check_in: item.draft.checkIn,
        check_out: item.draft.checkOut,
        group_reservation_reference: reference,
        group_reservation_name: item.draft.groupReservationName || HOTEL_GROUP_RESERVATION_NAME,
        supplier_reference: item.draft.supplierReference || null,
        partner_name: item.draft.japanesePartner || null,
        reservation_status: item.draft.reservationStatus || "confirmed",
        confirmed_at: item.draft.reservationStatus === "confirmed" ? new Date().toISOString() : null,
        created_by: userData.user?.id ?? null,
        updated_by: userData.user?.id ?? null,
        metadata: {
          source: "visa_hotel_confirmation",
          hotel_name: item.draft.hotelName,
          reference_format: "trip_scoped_v2",
        },
      };
      const insert = await (supabase as any)
        .from("visa_hotel_group_reservations")
        .insert(payload)
        .select("*")
        .single();
      if (!insert.error) return insert.data;
      const duplicate = insert.error.code === "23505" || /duplicate|unique/i.test(insert.error.message ?? "");
      if (!duplicate) throw insert.error;

      const group = await findExistingHotelGroupReservation(item);
      if (group?.id) return group;

      if (import.meta.env.DEV) {
        console.warn("[visa-hotel-group-reference-collision]", {
          reference,
          trip_id: travelCtx.trip?.id,
          trip_hotel_id: item.hotel.id,
          check_in: item.draft.checkIn,
          check_out: item.draft.checkOut,
          error_code: insert.error.code,
          error_message: insert.error.message,
        });
      }
    }

    throw new Error("Une référence de réservation existe déjà pour un autre voyage. La confirmation n’a pas été générée.");
  };

  const downloadHotelConfirmationDocument = async (item: VisaHotelConfirmationItem) => {
    if (!item.document?.storage_path) return toast.error("Aucun PDF généré pour cet hôtel.");
    const { data, error } = await supabase.storage.from("visa-docs").createSignedUrl(item.document.storage_path, 60);
    if (error || !data) return toast.error("Lien de téléchargement indisponible.");
    window.open(data.signedUrl, "_blank");
  };

  const downloadVisaSubmissionBatch = async (batch: any) => {
    if (!batch?.file_path) return toast.error("Aucun PDF officiel enregistré pour ce lot.");
    const { data, error } = await supabase.storage.from("visa-docs").createSignedUrl(batch.file_path, 60);
    if (error || !data) return toast.error("Lien de téléchargement indisponible.");
    window.open(data.signedUrl, "_blank");
  };

  const generateHotelConfirmation = async (item: VisaHotelConfirmationItem) => {
    if (!app?.id || !app?.user_id || !app?.booking_id || !app?.booking_participant_id || !travelCtx.trip?.id) {
      return toast.error("Dossier visa non relié à une réservation et un participant.");
    }
    if (item.errors.length) return toast.error(item.errors[0]);
    setBusy(true);
    try {
      const group = await ensureHotelGroupReservation(item);
      const resolvedDraft = draftWithResolvedHotelGroup(item, group);
      const bytes = await generateHotelReservationConfirmationPdf(resolvedDraft);
      const filename = sanitizeHotelReservationFilename(resolvedDraft);
      const version = Number(item.document?.version ?? 0) + 1 || 1;
      const path = `${app.user_id}/${app.id}/${VISA_HOTEL_CONFIRMATION_DOCUMENT_TYPE}/${item.hotel.id}/v${version}-${Date.now()}-${filename}`;
      const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)], { type: "application/pdf" });
      const upload = await supabase.storage.from("visa-docs").upload(path, blob, {
        contentType: "application/pdf",
        upsert: false,
      });
      if (upload.error) throw upload.error;
      const visaDocInsert = await supabase.from("visa_documents").insert({
        application_id: app.id,
        user_id: app.user_id,
        doc_type: "other",
        storage_path: path,
        file_name: filename,
        mime_type: "application/pdf",
        size_bytes: bytes.byteLength,
      }).select("*").single();
      if (visaDocInsert.error) throw visaDocInsert.error;
      const { data: userData } = await supabase.auth.getUser();
      const ledgerInsert = await (supabase as any)
        .from("visa_hotel_confirmation_documents")
        .insert({
          visa_application_id: app.id,
          booking_id: app.booking_id,
          booking_participant_id: app.booking_participant_id,
          trip_id: travelCtx.trip.id,
          trip_hotel_id: item.hotel.id,
          group_reservation_id: group.id,
          visa_document_id: visaDocInsert.data.id,
          document_reference: resolvedDraft.documentReference,
          file_name: filename,
          storage_path: path,
          status: "generated",
          version,
          is_current: true,
          data_hash: hotelConfirmationDataHash(resolvedDraft),
          generated_by: userData.user?.id ?? null,
          metadata: {
            hotel_name: resolvedDraft.hotelName,
            group_reservation_reference: resolvedDraft.groupReservationReference,
            rooming_missing: Boolean(resolvedDraft.roomingMissing),
          },
        })
        .select("*")
        .single();
      if (ledgerInsert.error) throw ledgerInsert.error;
      setDocs((current) => [visaDocInsert.data, ...current]);
      await refreshHotelConfirmations();
      toast.success("Confirmation d’hôtel générée.");
    } catch (error: any) {
      toast.error(error?.message ?? "Erreur génération confirmation hôtel.");
    } finally {
      setBusy(false);
    }
  };

  const generateAllHotelConfirmations = async () => {
    const readyItems = hotelConfirmations.filter((item) => item.status === "ready" || item.status === "needs_regeneration");
    if (!readyItems.length) return toast.info("Aucune confirmation d’hôtel prête à générer.");
    for (const item of readyItems) {
      // Sequential generation avoids duplicate group-reference races and keeps toast/errors readable.
      await generateHotelConfirmation(item);
    }
  };

  const downloadAllHotelConfirmationsZip = async () => {
    const generatedItems = hotelConfirmations.filter((item) => item.document?.storage_path);
    if (!generatedItems.length) return toast.error("Aucune confirmation d’hôtel générée.");
    setBusy(true);
    try {
      const zip = new JSZip();
      await Promise.all(generatedItems.map(async (item) => {
        const { data } = await supabase.storage.from("visa-docs").download(item.document.storage_path);
        if (data) zip.file(item.document.file_name || sanitizeHotelReservationFilename(item.draft), await data.arrayBuffer());
      }));
      const bytes = await zip.generateAsync({ type: "uint8array" });
      const applicantName = visaAssociation.participant
        ? participantFullName(visaAssociation.participant)
        : [app?.given_names, app?.surname].filter(Boolean).join(" ") || "Participant";
      downloadBlob(bytes, sanitizeHotelReservationsZipFilename(applicantName, travelCtx.trip?.title ?? "Voyage"));
      toast.success("Archive hôtels téléchargée.");
    } catch (error: any) {
      toast.error(error?.message ?? "Téléchargement ZIP impossible.");
    } finally {
      setBusy(false);
    }
  };

  const downloadAll = async () => {
    if (!app || !settings) return;
    if (!ensureTravelTripSelected()) return;
    setBusy(true);
    try {
      const zip = new JSZip();
      // Generated PDFs
      const [visaBytes, invBytes, garBytes] = await Promise.all([
        generateVisaPdf(app, settings),
        generateInvitationLetter(app, settings),
        generateGuaranteeLetter(app, settings),
      ]);
      warnIfConfirmationIncomplete();
      const [programmeBytes, confirmationBytes] = await Promise.all([
        generateTravelProgrammePdf(app, travelCtx),
        generateTravelConfirmationPdf(app, settings, travelCtx),
      ]);
      zip.file(`${app.reference}-visa-japon.pdf`, visaBytes);
      zip.file(`${app.reference}-invitation.pdf`, invBytes);
      zip.file(`${app.reference}-guarantee.pdf`, garBytes);
      zip.file(`${app.reference}-programme-voyage.pdf`, programmeBytes);
      zip.file(`${app.reference}-confirmation-voyage.pdf`, confirmationBytes);
      // Client uploaded documents
      if (docs.length) {
        const folder = zip.folder("documents-client");
        await Promise.all(docs.map(async (d) => {
          const { data } = await supabase.storage.from("visa-docs").download(d.storage_path);
          if (data) folder!.file(d.file_name, await data.arrayBuffer());
        }));
      }
      const blob = await zip.generateAsync({ type: "uint8array" });
      downloadBlob(blob, `${app.reference}-dossier-complet.zip`);
      toast.success("Archive téléchargée");
    } catch (e: any) { toast.error(e.message ?? "Erreur archive"); }
    finally { setBusy(false); }
  };

  const generateProgramme = useCallback(async () => {
    if (!travelCtx.trip?.id) throw new Error("Aucun voyage n'est sélectionné pour les documents de voyage.");
    return generateTravelProgrammePdf(app ?? {}, travelCtx);
  }, [app, travelCtx]);

  const confirmTravelConfirmationParticipant = useCallback(() => {
    const participants = travelCtx.participants ?? [];
    if (!app?.booking_id || participants.length === 0 || participants.some((participant: any) => participant.is_subject)) return true;
    return window.confirm(
      "Le participant concerné n’a pas été retrouvé dans la liste des participants associés à ce voyage. Générer quand même la confirmation ?"
    );
  }, [app?.booking_id, travelCtx.participants]);

  const generateConfirmation = useCallback(async () => {
    if (!travelCtx.trip?.id) throw new Error("Aucun voyage n'est sélectionné pour les documents de voyage.");
    if (!confirmTravelConfirmationParticipant()) throw new Error("Génération annulée: participant concerné non retrouvé dans la liste.");
    return generateTravelConfirmationPdf(app ?? {}, settings ?? {}, travelCtx);
  }, [app, confirmTravelConfirmationParticipant, settings, travelCtx]);

  const generators = {
    visa: useCallback(() => generateVisaPdf(app ?? {}, settings ?? {}), [app, settings]),
    invitation: useCallback(() => generateInvitationLetter(app ?? {}, settings ?? {}), [app, settings]),
    guarantee: useCallback(() => generateGuaranteeLetter(app ?? {}, settings ?? {}), [app, settings]),
    programme: generateProgramme,
    confirmation: generateConfirmation,
  };

  const openPreview = (kind: "visa" | "invitation" | "guarantee" | "programme" | "confirmation") => {
    if ((kind === "programme" || kind === "confirmation") && !ensureTravelTripSelected()) return;
    if (kind === "confirmation" && !confirmTravelConfirmationParticipant()) return;
    if (kind === "confirmation") warnIfConfirmationIncomplete();
    setPreview(kind);
  };

  const downloadDirect = async (kind: "visa" | "invitation" | "guarantee" | "programme" | "confirmation") => {
    if (!app || !settings) return;
    if ((kind === "programme" || kind === "confirmation") && !ensureTravelTripSelected()) return;
    setBusy(true);
    try {
      if (kind === "confirmation") {
        warnIfConfirmationIncomplete();
        if (!confirmTravelConfirmationParticipant()) return;
      }
      const bytes = kind === "visa"
        ? await generateVisaPdf(app, settings)
        : kind === "invitation"
          ? await generateInvitationLetter(app, settings)
          : kind === "guarantee"
            ? await generateGuaranteeLetter(app, settings)
            : kind === "programme"
              ? await generateTravelProgrammePdf(app, travelCtx)
              : await generateTravelConfirmationPdf(app, settings, travelCtx);
      const suffix = kind === "visa" ? "visa-japon" : kind === "invitation" ? "invitation" : kind === "guarantee" ? "guarantee" : kind === "programme" ? "programme-voyage" : "confirmation-voyage";
      downloadBlob(bytes, `${app.reference}-${suffix}.pdf`);
    } catch (e: any) { toast.error(e.message ?? "Erreur PDF"); }
    finally { setBusy(false); }
  };

  const openVisaProgramV2 = () => {
    if (!ensureTravelTripSelected()) return;
    const draft = buildVisaProgramV2Draft(app ?? {}, travelCtx);
    setVisaProgramV2Draft(draft);
    setVisaProgramV2Open(true);
  };

  const updateVisaProgramV2Draft = (patch: Partial<VisaProgramV2Draft>) => {
    setVisaProgramV2Draft((current) => current ? { ...current, ...patch } : current);
  };

  const updateVisaProgramV2Row = (index: number, field: keyof VisaProgramV2Draft["rows"][number], value: string) => {
    setVisaProgramV2Draft((current) => {
      if (!current) return current;
      return {
        ...current,
        rows: current.rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row),
      };
    });
  };

  const currentVisaProgramV2Errors = visaProgramV2Draft
    ? validateVisaProgramV2Draft(visaProgramV2Draft, app ?? {}, travelCtx)
    : [];

  const generateVisaProgramV2Bytes = async () => {
    if (!visaProgramV2Draft) throw new Error("Programme visa V2 non préparé.");
    return generateVisaProgramV2Pdf(visaProgramV2Draft, app ?? {}, travelCtx);
  };

  const downloadVisaProgramV2 = async () => {
    if (!app || !visaProgramV2Draft) return;
    const errors = validateVisaProgramV2Draft(visaProgramV2Draft, app, travelCtx);
    if (errors.length) return toast.error(errors[0]);
    setBusy(true);
    try {
      const bytes = await generateVisaProgramV2Bytes();
      downloadBlob(bytes, sanitizeVisaProgramV2Filename(app, travelCtx));
      toast.success("Programme visa V2 généré");
    } catch (e: any) {
      toast.error(e.message ?? "Erreur génération Programme visa V2");
    } finally {
      setBusy(false);
    }
  };

  const saveVisaProgramV2Document = async () => {
    if (!app?.id || !app?.user_id || !visaProgramV2Draft) {
      return toast.error("Dossier visa ou utilisateur introuvable.");
    }
    const errors = validateVisaProgramV2Draft(visaProgramV2Draft, app, travelCtx);
    if (errors.length) return toast.error(errors[0]);
    setBusy(true);
    try {
      const bytes = await generateVisaProgramV2Bytes();
      const filename = sanitizeVisaProgramV2Filename(app, travelCtx);
      const path = `${app.user_id}/${app.id}/generated-program-v2/${Date.now()}-${filename}`;
      const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)], { type: "application/pdf" });
      const upload = await supabase.storage.from("visa-docs").upload(path, blob, {
        contentType: "application/pdf",
        upsert: false,
      });
      if (upload.error) throw upload.error;
      const insert = await supabase.from("visa_documents").insert({
        application_id: app.id,
        user_id: app.user_id,
        doc_type: "other",
        storage_path: path,
        file_name: filename,
        mime_type: "application/pdf",
        size_bytes: bytes.byteLength,
      }).select("*").single();
      if (insert.error) throw insert.error;
      setDocs((current) => [insert.data, ...current]);
      toast.success("Programme visa V2 enregistré dans le dossier");
    } catch (e: any) {
      toast.error(e.message ?? "Erreur enregistrement Programme visa V2");
    } finally {
      setBusy(false);
    }
  };

  const generateProcuration = async () => {
    if (!app?.user_id) return toast.error("Utilisateur visa introuvable pour ce dossier.");
    setBusy(true);
    try {
      const doc = await upsertVisaProcurationDocument(app, app.user_id);
      setDocs((current) => [doc, ...current.filter((item) => !isVisaProcurationDocument(item))]);
      toast.success("Procuration générée");
    } catch (e: any) {
      toast.error(e.message ?? "Erreur génération procuration");
    } finally {
      setBusy(false);
    }
  };

  const regenerateChecklist = async () => {
    if (!app?.user_id) return toast.error("Utilisateur visa introuvable pour ce dossier.");
    const selectedChecklist = findChecklistForSituation(checklists, app.category);
    const items = selectedChecklist?.items ?? [];
    const snapshot = checklistSnapshotText(items);
    const requested_documents = snapshot
      ? `Liste personnalisée des documents à fournir — ${professionalSituationLabel(app.category)}\n${snapshot}`
      : `Liste personnalisée des documents à fournir — ${professionalSituationLabel(app.category)}\nAucune règle active n'est configurée pour cette situation. Notre équipe confirmera les documents à fournir.`;
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("visa_applications")
        .update({ requested_documents } as any)
        .eq("id", app.id)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      const doc = await upsertVisaChecklistDocument(data ?? { ...app, requested_documents }, app.user_id, items);
      setApp(data ?? { ...app, requested_documents });
      setDocs((current) => [doc, ...current.filter((item) => !isVisaChecklistDocument(item))]);
      toast.success("Checklist régénérée depuis les règles actuelles.");
    } catch (e: any) {
      toast.error(e.message ?? "Erreur génération checklist");
    } finally {
      setBusy(false);
    }
  };

  if (!app) return <p className="text-muted-foreground">Chargement…</p>;
  const procurationDoc = docs.find(isVisaProcurationDocument);
  const checklistDoc = docs.find(isVisaChecklistDocument);
  const selectedChecklist = findChecklistForSituation(checklists, app.category);
  const selectedChecklistItems = selectedChecklist?.items ?? [];
  const associatedBooking = visaAssociation.booking;
  const associatedParticipant = visaAssociation.participant;
  const associatedTrip = bookingTrip(associatedBooking);
  const associationIsLinked = Boolean(associatedBooking?.id && associatedParticipant?.id);
  const confidenceLabel: Record<VisaAssociationSuggestion["confidence"], string> = {
    exact: "Correspondance exacte",
    probable: "Correspondance probable",
    check: "À vérifier",
  };

  const Row = ({ label, value }: any) => (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-2 py-2 text-sm border-b border-border/40 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="sm:col-span-2 whitespace-pre-wrap font-medium break-words">{value || "—"}</span>
    </div>
  );

  const draftPreviousStay = parsePreviousJapanStay(visaDraft?.previous_stays);
  const draftIsRetired = isRetiredVisaCategory(visaDraft?.category);
  const appIsRetired = isRetiredVisaCategory(app.category);

  return (
    <div>
      <button onClick={() => nav("/admin/visa")} className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1">
        <ArrowLeft className="w-4 h-4" /> Toutes les demandes
      </button>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-3xl mb-1">{app.reference}</h1>
          <p className="text-sm text-muted-foreground">{[app.surname, app.given_names].filter(Boolean).join(" ") || "Sans nom"}</p>
          <QuickActions
            phone={app.residential_mobile || app.residential_tel}
            email={app.residential_email}
            passport={app.passport_no}
            onPdf={() => setPreview("visa")}
            className="mt-4 sm:hidden"
          />
          <Button variant="outline" size="sm" className="mt-3" onClick={openVisaEdit}>
            <Pencil className="h-4 w-4" />
            Modifier les informations visa
          </Button>
          <Button variant="outline" size="sm" className="ml-2 mt-3" onClick={refreshFromTravelerFile} disabled={busy || !app.passport_no}>
            <Save className="h-4 w-4" />
            Repréremplir depuis le dossier voyageur
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-3">
          <Badge>{STATUS_LABEL[app.status]}</Badge>
          <Select value={app.status} onValueChange={updateStatus} disabled={busy}>
            <SelectTrigger className="w-full sm:w-44 min-h-11"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_LABEL).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {editingVisaInfo && visaDraft && (
        <Card className="mb-6 p-4 sm:p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-xl">Modifier les informations visa</h2>
              <p className="text-sm text-muted-foreground">Les modifications sont enregistrées dans la demande visa et seront reprises par les PDF.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditingVisaInfo(false)} disabled={busy}>Annuler</Button>
              <Button onClick={saveVisaInfo} disabled={busy}>
                <Save className="h-4 w-4" />
                Enregistrer
              </Button>
            </div>
          </div>

          <div className="space-y-6">
            <section>
              <h3 className="mb-3 font-semibold">Identité</h3>
              <div className="grid gap-3 md:grid-cols-2">
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="surname" label="Nom" />
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="given_names" label="Prénom(s)" />
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="other_names" label="Autres noms / alias" />
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="date_of_birth" label="Date de naissance" type="date" />
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="place_of_birth_city" label="Ville de naissance" />
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="place_of_birth_state" label="Région / Province" />
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="place_of_birth_country" label="Pays de naissance" />
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="nationality" label="Nationalité" />
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="former_nationality" label="Nationalité antérieure" />
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="national_id_no" label="N° pièce d'identité" />
                <DraftSelect draft={visaDraft} onChange={updateVisaDraft} field="sex" label="Sexe" options={[{ value: "male", label: "Homme" }, { value: "female", label: "Femme" }]} />
                <DraftSelect draft={visaDraft} onChange={updateVisaDraft} field="marital_status" label="État civil" options={[
                  { value: "single", label: "Célibataire" },
                  { value: "married", label: "Marié(e)" },
                  { value: "widowed", label: "Veuf(ve)" },
                  { value: "divorced", label: "Divorcé(e)" },
                ]} />
              </div>
            </section>

            <section>
              <h3 className="mb-3 font-semibold">Passeport</h3>
              <div className="grid gap-3 md:grid-cols-2">
                <DraftSelect draft={visaDraft} onChange={updateVisaDraft} field="passport_type" label="Type de passeport" options={[
                  { value: "ordinary", label: "Ordinaire" },
                  { value: "diplomatic", label: "Diplomatique" },
                  { value: "official", label: "Officiel" },
                  { value: "other", label: "Autre" },
                ]} />
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="passport_no" label="Numéro de passeport" />
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="passport_place_of_issue" label="Lieu de délivrance" />
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="passport_date_of_issue" label="Date de délivrance" type="date" />
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="passport_issuing_authority" label="Autorité de délivrance" />
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="passport_date_of_expiry" label="Date d'expiration" type="date" />
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="certificate_of_eligibility_no" label="N° Certificat d'éligibilité" />
              </div>
            </section>

            <section>
              <h3 className="mb-3 font-semibold">Voyage</h3>
              <div className="grid gap-3 md:grid-cols-2">
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="purpose_of_visit" label="Motif de voyage" />
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="intended_length_of_stay" label="Durée prévue du séjour" />
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="date_of_arrival" label="Arrivée Japon" type="date" />
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="port_of_entry" label="Port / aéroport d'entrée" />
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="airline_or_ship" label="Compagnie / vol" />
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="hotel_name" label="Hôtel" />
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="hotel_tel" label="Téléphone hôtel" />
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="hotel_address" label="Adresse hôtel" />
                <div className="md:col-span-2">
                  <label className="text-xs text-muted-foreground">Avez-vous déjà séjourné au Japon ?</label>
                  <RadioGroup
                    value={draftPreviousStay.hasPrevious}
                    onValueChange={(value) => updateVisaDraftPreviousStay({ hasPrevious: value as "yes" | "no" })}
                    className="mt-2 flex gap-4"
                  >
                    <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="yes" /> Oui</label>
                    <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="no" /> Non</label>
                  </RadioGroup>
                </div>
                {draftPreviousStay.hasPrevious === "yes" && (
                  <>
                    <div>
                      <label className="text-xs text-muted-foreground">Date du dernier séjour au Japon</label>
                      <Input
                        type="date"
                        value={draftPreviousStay.lastStayDate}
                        onChange={(event) => updateVisaDraftPreviousStay({ lastStayDate: event.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Nombre de séjours précédents</label>
                      <Input
                        type="number"
                        min="1"
                        value={draftPreviousStay.stayCount}
                        onChange={(event) => updateVisaDraftPreviousStay({ stayCount: event.target.value })}
                      />
                    </div>
                  </>
                )}
              </div>
            </section>

            <section>
              <h3 className="mb-3 font-semibold">Résidence, profession et école</h3>
              <div className="grid gap-3 md:grid-cols-2">
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="residential_address" label="Adresse de résidence" className="md:col-span-2" />
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="residential_tel" label="Téléphone fixe" />
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="residential_mobile" label="Mobile" />
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="residential_email" label="Email" type="email" />
                <div>
                  <label className="text-xs text-muted-foreground">Situation professionnelle</label>
                  <Select value={visaDraft?.category ?? ""} onValueChange={updateVisaDraftProfessionalSituation}>
                    <SelectTrigger className="min-h-10">
                      <SelectValue placeholder="Situation professionnelle" />
                    </SelectTrigger>
                    <SelectContent>
                      {PROFESSIONAL_SITUATIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="profession" label="Profession / activité exacte" />
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="partner_profession" label="Profession du conjoint / parents, si mineur" />
                {draftIsRetired && (
                  <Alert className="md:col-span-2">
                    <AlertTitle>Retraité</AlertTitle>
                    <AlertDescription>{RETIRED_NOT_APPLICABLE}</AlertDescription>
                  </Alert>
                )}
                <DraftInput
                  draft={visaDraft}
                  onChange={updateVisaDraft}
                  field="employer_name"
                  label="Nom de l'employeur ou de l'école si étudiant"
                  disabled={draftIsRetired}
                  displayValue={draftIsRetired ? RETIRED_NOT_APPLICABLE : undefined}
                />
                <DraftInput
                  draft={visaDraft}
                  onChange={updateVisaDraft}
                  field="employer_tel"
                  label="Téléphone de l'employeur ou de l'école si étudiant"
                  disabled={draftIsRetired}
                  displayValue={draftIsRetired ? RETIRED_NOT_APPLICABLE : undefined}
                />
                <DraftInput
                  draft={visaDraft}
                  onChange={updateVisaDraft}
                  field="employer_address"
                  label="Adresse de l'employeur ou de l'école si étudiant"
                  className="md:col-span-2"
                  disabled={draftIsRetired}
                  displayValue={draftIsRetired ? RETIRED_NOT_APPLICABLE : undefined}
                />
              </div>
            </section>

            <section>
              <h3 className="mb-3 font-semibold">Déclarations et date</h3>
              <div className="grid gap-3 md:grid-cols-2">
                <DraftBoolean draft={visaDraft} onChange={updateVisaDraft} field="q_convicted_crime" label="Crime / délit" />
                <DraftBoolean draft={visaDraft} onChange={updateVisaDraft} field="q_imprisoned_1y" label="Emprisonnement 1 an+" />
                <DraftBoolean draft={visaDraft} onChange={updateVisaDraft} field="q_deported" label="Déportation" />
                <DraftBoolean draft={visaDraft} onChange={updateVisaDraft} field="q_drug_offence" label="Drogue" />
                <DraftBoolean draft={visaDraft} onChange={updateVisaDraft} field="q_prostitution" label="Prostitution" />
                <DraftBoolean draft={visaDraft} onChange={updateVisaDraft} field="q_trafficking" label="Traite" />
                <div className="md:col-span-2">
                  <label className="text-xs text-muted-foreground">Précisions déclarations</label>
                  <Textarea rows={3} value={visaDraft.declarations_details ?? ""} onChange={(e) => updateVisaDraft("declarations_details", e.target.value)} />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs text-muted-foreground">Remarques</label>
                  <Textarea rows={3} value={visaDraft.remarks ?? ""} onChange={(e) => updateVisaDraft("remarks", e.target.value)} />
                </div>
                <DraftInput draft={visaDraft} onChange={updateVisaDraft} field="date_of_application" label="Date de la demande" type="date" />
              </div>
            </section>
          </div>
        </Card>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-4 sm:p-5">
            <h2 className="font-display text-lg mb-3">Identité</h2>
            <Row label="Nom / Prénom" value={`${app.surname ?? ""} ${app.given_names ?? ""}`.trim()} />
            <Row label="Autres noms" value={app.other_names} />
            <Row label="Date de naissance" value={formatVisaDate(app.date_of_birth)} />
            <Row label="Lieu de naissance" value={[app.place_of_birth_city, app.place_of_birth_state, app.place_of_birth_country].filter(Boolean).join(", ")} />
            <Row label="Sexe / État civil" value={[app.sex, app.marital_status].filter(Boolean).join(" / ")} />
            <Row label="Nationalité" value={app.nationality} />
            <Row label="N° pièce d'identité" value={app.national_id_no} />
            <Row label="Date de la demande" value={formatVisaDate(app.date_of_application || todayISO())} />
            <Row
              label="Source voyageur liée"
              value={app.booking_id
                ? `Réservation ${app.booking_id}`
                : app.document_trip_id
                  ? `Voyage ${app.document_trip_id}`
                  : "Aucune source liée"}
            />
          </Card>

          <Card className="p-4 sm:p-5">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="font-display text-lg">Réservation associée</h2>
                <p className="text-sm text-muted-foreground">
                  Lien administratif utilisé pour retrouver le billet, les vols et les documents de réservation.
                </p>
              </div>
              <Badge variant={associationIsLinked ? "secondary" : "outline"} className={associationIsLinked ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}>
                {associationIsLinked ? "Relié" : "Non relié"}
              </Badge>
            </div>

            {associationIsLinked ? (
              <div className="space-y-3">
                <div className="grid gap-3 rounded-lg border border-border bg-muted/20 p-3 text-sm md:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Réservation</p>
                    <p className="font-semibold">{associatedBooking?.reference ?? associatedBooking?.id}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Voyage</p>
                    <p className="font-semibold">{associatedTrip?.title ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      {[formatVisaDate(associatedTrip?.start_date), formatVisaDate(associatedTrip?.end_date)].filter(Boolean).join(" → ") || "Dates non renseignées"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Participant associé</p>
                    <p className="font-semibold">{participantFullName(associatedParticipant)}</p>
                    <p className="text-xs text-muted-foreground">{associatedParticipant?.email || "Email non renseigné"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Passeport</p>
                    <p className="font-semibold">{maskPassportNo(associatedParticipant?.passport_no)}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => nav(`/admin/bookings/${associatedBooking.id}`)}>
                    Ouvrir la réservation
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={openAssociationDialog}>
                    Changer l’association
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={clearAssociation} disabled={associationSaving}>
                    <Unlink className="h-4 w-4" /> Retirer l’association
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                  Ce dossier visa n’est relié à aucune réservation.
                </div>
                {associationSuggestions.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold">Suggestions de correspondance</p>
                    {associationSuggestions.map((suggestion) => (
                      <button
                        type="button"
                        key={`${suggestion.booking.id}:${suggestion.participant.id}`}
                        className="w-full rounded-lg border border-border p-3 text-left text-sm transition-colors hover:bg-muted/40"
                        onClick={async () => {
                          const loaded = await loadAssociationParticipants(suggestion.booking);
                          if (loaded) setSelectedAssociationParticipantId(suggestion.participant.id);
                          setAssociationDialogOpen(true);
                        }}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{bookingLabel(suggestion.booking)}</span>
                          <Badge variant="outline">{confidenceLabel[suggestion.confidence]}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {participantFullName(suggestion.participant)} · {suggestion.reason} · passeport {maskPassportNo(suggestion.participant.passport_no)}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
                <Button type="button" onClick={openAssociationDialog}>
                  Associer une réservation
                </Button>
              </div>
            )}
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="font-display text-lg mb-3">Passeport</h2>
            <QuickActions passport={app.passport_no} compact className="mb-3" />
            <Row label="Type / N°" value={`${app.passport_type ?? ""} · ${app.passport_no ?? ""}`} />
            <Row label="Lieu de délivrance" value={app.passport_place_of_issue} />
            <Row label="Date de délivrance" value={formatVisaDate(app.passport_date_of_issue)} />
            <Row label="Autorité" value={app.passport_issuing_authority} />
            <Row label="Date d'expiration" value={formatVisaDate(app.passport_date_of_expiry)} />
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="font-display text-lg mb-3">Voyage & hébergement</h2>
            {travelTripWarnings.length > 0 && (
              <Alert className="mb-4 border-amber-300 bg-amber-50 text-amber-950">
                <AlertTriangle className="h-4 w-4 text-amber-700" />
                <AlertTitle>Voyage documents à vérifier</AlertTitle>
                <AlertDescription>
                  <ul className="mt-2 list-disc space-y-1 pl-4">
                    {travelTripWarnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <Row label="Motif" value={app.purpose_of_visit} />
            <Row label="Durée" value={app.intended_length_of_stay} />
            <Row label="Séjours précédents au Japon" value={formatPreviousJapanStayForDisplay(app.previous_stays)} />
            <div className="my-4 rounded-lg border border-border bg-secondary/20 p-3">
              <label className="text-xs text-muted-foreground">Voyage utilisé pour Programme / Confirmation PDF</label>
              <Select value={selectedTravelTripId || "none"} onValueChange={changeTravelTrip}>
                <SelectTrigger className="mt-1 min-h-11">
                  <SelectValue placeholder="Sélectionner un voyage" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Aucun voyage sélectionné</SelectItem>
                  {trips.map((trip) => (
                    <SelectItem key={trip.id} value={trip.id}>
                      {[trip.title, trip.season, formatVisaDate(trip.start_date)].filter(Boolean).join(" · ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {travelCtx.trip?.id && (
              <div className="my-4 rounded-lg border border-border bg-background p-3">
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Dates visa selon le voyage</p>
                <Row label="Voyage" value={[travelCtx.trip.title, travelCtx.trip.season].filter(Boolean).join(" · ")} />
                <Row label="Départ du voyage" value={formatVisaDate(travelCtx.trip.start_date)} />
                <Row label="Arrivée au Japon" value={formatVisaDate(canonicalVisaTripDates.japanArrivalDate)} />
                <Row label="Départ du Japon" value={formatVisaDate(canonicalVisaTripDates.japanDepartureDate)} />
                <Row label="Fin du voyage" value={formatVisaDate(travelCtx.trip.end_date)} />
                <Row label="Séjour au Japon" value={expectedVisaStayLabel} />
                {visaDatesMismatch && (
                  <Button size="sm" variant="outline" className="mt-3 min-h-10" onClick={applyTripVisaDates} disabled={busy}>
                    Appliquer les dates du voyage
                  </Button>
                )}
              </div>
            )}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-muted-foreground">Arrivée Japon</label>
                <Input type="date" value={app.date_of_arrival ?? ""} onChange={(e) => setApp({ ...app, date_of_arrival: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Port / aéroport d'entrée</label>
                <Input value={app.port_of_entry ?? ""} onChange={(e) => setApp({ ...app, port_of_entry: e.target.value })} placeholder="Narita, Haneda…" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Compagnie / vol</label>
                <Input value={app.airline_or_ship ?? ""} onChange={(e) => setApp({ ...app, airline_or_ship: e.target.value })} placeholder="EK318…" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Hôtel</label>
                <Input value={app.hotel_name ?? ""} onChange={(e) => setApp({ ...app, hotel_name: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Téléphone hôtel</label>
                <Input value={app.hotel_tel ?? ""} onChange={(e) => setApp({ ...app, hotel_tel: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Adresse hôtel</label>
                <Input value={app.hotel_address ?? ""} onChange={(e) => setApp({ ...app, hotel_address: e.target.value })} />
              </div>
            </div>
            <Button size="sm" variant="outline" className="mt-3 min-h-10" onClick={saveTravelFields}>
              <Save className="w-4 h-4" /> Enregistrer les infos voyage
            </Button>
            <Separator className="my-2" />
            <Row label="Voyage lié" value={travelCtx.trip?.title} />
            <Row label="Programme lié" value={travelCtx.programme?.title} />
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="font-display text-lg mb-3">Résidence, profession et école</h2>
            <QuickActions phone={app.residential_mobile || app.residential_tel} email={app.residential_email} compact className="mb-3" />
            <Row label="Adresse" value={app.residential_address} />
            <Row label="Tel / Mobile" value={[app.residential_tel, app.residential_mobile].filter(Boolean).join(" · ")} />
            <Row label="Email" value={app.residential_email} />
            <Row label="Situation professionnelle" value={professionalSituationLabel(app.category)} />
            <Row label="Profession / activité exacte" value={app.profession} />
            <Row label="Employeur / école" value={appIsRetired ? RETIRED_NOT_APPLICABLE : app.employer_name} />
            <Row label="Tel employeur / école" value={appIsRetired ? RETIRED_NOT_APPLICABLE : app.employer_tel} />
            <Row label="Adresse employeur / école" value={appIsRetired ? RETIRED_NOT_APPLICABLE : app.employer_address} />
          </Card>

          <Card className="p-4 sm:p-5">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-lg">Checklist documents visa</h2>
                <p className="text-sm text-muted-foreground">Snapshot attendu pour cette demande et règles actuelles par situation.</p>
              </div>
              <Button size="sm" variant="outline" className="min-h-10" onClick={regenerateChecklist} disabled={busy}>
                <FileText className="w-4 h-4" /> Régénérer
              </Button>
            </div>
            <Row label="Situation sélectionnée" value={professionalSituationLabel(app.category)} />
            <div className="mt-4 rounded-lg border border-border bg-secondary/20 p-3">
              <p className="mb-2 text-sm font-semibold">Snapshot enregistré</p>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{app.requested_documents || "Aucun snapshot enregistré."}</p>
            </div>
            <div className="mt-4">
              <p className="mb-2 text-sm font-semibold">Règles actives actuelles</p>
              {selectedChecklistItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune règle active trouvée pour cette situation.</p>
              ) : (
                <div className="space-y-2">
                  {selectedChecklistItems.map((item, index) => (
                    <div key={item.id ?? index} className="rounded-lg border border-border p-3 text-sm">
                      <p className="font-medium">{item.title_fr}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {[
                          item.required ? "Obligatoire" : "Le cas échéant",
                          item.original_required ? "original requis" : null,
                          item.copy_upload_required ? "copie / scan requis" : null,
                        ].filter(Boolean).join(" · ")}
                      </p>
                      {item.notes && <p className="mt-2 text-xs text-muted-foreground">{item.notes}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="font-display text-lg mb-3">Déclarations</h2>
            <Row label="Crime / délit" value={app.q_convicted_crime ? "Oui" : "Non"} />
            <Row label="Emprisonnement 1 an+" value={app.q_imprisoned_1y ? "Oui" : "Non"} />
            <Row label="Déportation" value={app.q_deported ? "Oui" : "Non"} />
            <Row label="Drogue" value={app.q_drug_offence ? "Oui" : "Non"} />
            <Row label="Prostitution" value={app.q_prostitution ? "Oui" : "Non"} />
            <Row label="Traite" value={app.q_trafficking ? "Oui" : "Non"} />
            <Row label="Précisions" value={app.declarations_details} />
            <Row label="Remarques" value={app.remarks} />
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4 sm:p-5">
            <h2 className="font-display text-lg mb-3">Actions</h2>
            <p className="text-xs text-muted-foreground mb-3">Documents officiels pré-remplis avec les informations garant par défaut.</p>
            {confirmationWarnings.length > 0 && (
              <Alert className="mb-3 border-amber-300 bg-amber-50 text-amber-950">
                <AlertTriangle className="h-4 w-4 text-amber-700" />
                <AlertTitle>Confirmation voyage incomplète</AlertTitle>
                <AlertDescription>
                  <ul className="mt-2 list-disc space-y-1 pl-4">
                    {confirmationWarnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <Button
              size="sm"
              className="w-full min-h-11 mb-3"
              onClick={sendFormReceived}
              disabled={busy || !app.residential_email}
              title={!app.residential_email ? "Aucun email client" : undefined}
            >
              <Mail className="w-4 h-4" /> Formulaire de visa reçu
            </Button>
            {([
              { k: "visa", label: "Formulaire visa officiel" },
              { k: "invitation", label: "Lettre d'invitation" },
              { k: "guarantee", label: "Lettre de garantie" },
              { k: "programme", label: "Programme du voyage" },
              { k: "confirmation", label: "Confirmation du voyage" },
            ] as const).map(({ k, label }) => (
              <div key={k} className="flex items-center gap-2 mb-2">
                <Button variant="outline" size="sm" className="flex-1 min-h-11 justify-start" onClick={() => openPreview(k)} disabled={busy}>
                  <Eye className="w-4 h-4" /> {label}
                </Button>
                <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => downloadDirect(k)} disabled={busy} title="Télécharger">
                  <Download className="w-4 h-4" />
                </Button>
              </div>
            ))}
            <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50/70 p-3">
              <p className="text-sm font-semibold text-orange-950">Programme visa V2 – Format Ambassade du Japon</p>
              <p className="mt-1 text-xs text-orange-900/80">Nouveau document distinct du programme visa actuel. Préparation éditable avant génération.</p>
              <Button variant="outline" size="sm" className="mt-3 w-full min-h-11 justify-start bg-white" onClick={openVisaProgramV2} disabled={busy}>
                <Eye className="w-4 h-4" /> Préparer le Programme visa V2
              </Button>
            </div>
            <Separator className="my-3" />
            <Button size="sm" className="w-full min-h-11" onClick={downloadAll} disabled={busy}>
              <Package className="w-4 h-4" /> Tout télécharger (ZIP)
            </Button>
          </Card>

          <Card className="p-4 sm:p-5">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="font-display text-lg">Documents de transport et d’hébergement</h2>
                <p className="text-sm text-muted-foreground">
                  Documents destinés au dossier ambassade, reliés à la réservation et au participant exact.
                </p>
              </div>
              {associationIsLinked ? (
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-900">Relié</Badge>
              ) : (
                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-900">Association requise</Badge>
              )}
            </div>

            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">Billet d’avion</p>
                {visaFlightTickets.length > 0 && (
                  <Badge variant="outline" className="bg-white">
                    {visaFlightTickets.every((ticket) => ["reserved", "ticketed", "delivered"].includes(getFlightTicketStatus(ticket.flight, ticket.traveler)))
                      ? "Billet disponible"
                      : "Billet disponible – Informations de vol incomplètes"}
                  </Badge>
                )}
              </div>
              {visaFlightTickets.length > 0 ? (
                <div className="space-y-2 text-sm">
                  {visaFlightTickets.map((ticket) => (
                    <div key={ticket.storagePath} className="rounded-lg border border-border bg-white p-3">
                      <p className="font-medium">Billet d’avion – {ticket.participantName}</p>
                      <p className="text-xs text-muted-foreground">
                        {ticket.fileName ? `${ticket.fileName} · ` : ""}
                        Source réservation {ticket.bookingReference ?? app?.booking_id}
                        {ticket.createdAt ? ` · ajouté le ${formatVisaDate(ticket.createdAt)}` : ""}
                      </p>
                      <Button size="sm" variant="outline" className="mt-2 min-h-10" onClick={() => downloadStampedFlightTicket(ticket)} disabled={busy}>
                        <Download className="w-4 h-4" /> Télécharger copie cachetée
                      </Button>
                    </div>
                  ))}
                </div>
              ) : app?.booking_id ? (
                <p className="text-sm text-muted-foreground">
                  Billet d’avion manquant pour ce participant ou non assigné au dossier de réservation.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Associez d’abord une réservation pour retrouver le billet du participant.
                </p>
              )}
            </div>

            <div>
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold">Réservations d’hébergement</p>
                  <p className="text-xs text-muted-foreground">
                    Une confirmation PDF distincte est générée pour chaque hôtel confirmé du voyage.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={generateAllHotelConfirmations} disabled={busy || !associationIsLinked}>
                    Générer toutes
                  </Button>
                  <Button size="sm" variant="ghost" onClick={downloadAllHotelConfirmationsZip} disabled={busy || !hotelConfirmations.some((item) => item.document?.storage_path)}>
                    ZIP hôtels
                  </Button>
                </div>
              </div>

              {hotelConfirmationsWarning && (
                <Alert className="mb-3 border-amber-300 bg-amber-50 text-amber-950">
                  <AlertTriangle className="h-4 w-4 text-amber-700" />
                  <AlertTitle>Confirmations hôtel indisponibles</AlertTitle>
                  <AlertDescription>{hotelConfirmationsWarning}</AlertDescription>
                </Alert>
              )}

              {!associationIsLinked ? (
                <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                  Ce dossier doit être relié à une réservation et au participant exact avant de générer les confirmations d’hôtel.
                </div>
              ) : hotelConfirmations.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-700">
                  Aucun hôtel détaillé n’est lié au voyage de cette réservation.
                </div>
              ) : (
                <div className="space-y-3">
                  {hotelConfirmations.map((item) => (
                    <div key={item.hotel.id} className="rounded-lg border border-border p-3 text-sm">
                      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold">
                            {item.draft.hotelName}
                            {item.isRepeatedHotelStayName && <span className="text-muted-foreground"> — {item.stayLabel}</span>}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {[item.draft.hotelCity, formatVisaDate(item.draft.checkIn), formatVisaDate(item.draft.checkOut)]
                              .filter(Boolean)
                              .join(" · ")}
                            {item.draft.nights ? ` · ${item.draft.nights} nuit${item.draft.nights > 1 ? "s" : ""}` : ""}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Réf. groupe: {item.draft.groupReservationReference} · {item.draft.groupReservationName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {item.diagnostics.roomCount} chambre{item.diagnostics.roomCount > 1 ? "s" : ""} · {item.diagnostics.assignedParticipants} participant{item.diagnostics.assignedParticipants > 1 ? "s" : ""} affecté{item.diagnostics.assignedParticipants > 1 ? "s" : ""} · source: Rooming list opérationnelle
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Demandeur visa: {item.diagnostics.applicantRoomLabel ?? "non affecté"} · {item.diagnostics.assignedParticipants}/{item.diagnostics.totalTripParticipants} participants affectés
                          </p>
                        </div>
                        <Badge variant="outline" className={hotelConfirmationStatusClass[item.status]}>
                          {hotelConfirmationStatusLabel[item.status]}
                        </Badge>
                      </div>
                      {item.errors.length > 0 && (
                        <ul className="mb-3 list-disc space-y-1 pl-4 text-xs text-red-800">
                          {item.errors.slice(0, 3).map((error) => (
                            <li key={error}>{error}</li>
                          ))}
                          {item.errors.length > 3 && <li>{item.errors.length - 3} autre(s) erreur(s)…</li>}
                        </ul>
                      )}
                      {item.draft.roomingMissing && (
                        <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                          Rooming list absente pour cet hôtel: créez les chambres et affectations dans Operations → Voyages → B. Chambres.
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => setHotelPreview(item)}>
                          <Eye className="h-4 w-4" /> Aperçu
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => nav(`/admin/trips?tab=management&trip=${travelCtx.trip?.id ?? ""}&ops=rooms&hotel=${item.hotel.id}`)}
                        >
                          Ouvrir la rooming list
                        </Button>
                        {item.document?.storage_path && (
                          <Button size="sm" variant="outline" onClick={() => downloadHotelConfirmationDocument(item)}>
                            <Download className="h-4 w-4" /> Télécharger
                          </Button>
                        )}
                        <Button
                          size="sm"
                          onClick={() => generateHotelConfirmation(item)}
                          disabled={busy || item.errors.length > 0}
                        >
                          <FileText className="h-4 w-4" />
                          {item.document ? "Régénérer" : "Générer"}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card className="p-4 sm:p-5">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="font-display text-lg">Dépôts groupés visa</h2>
                <p className="text-sm text-muted-foreground">
                  Historique des lots officiels dans lesquels ce dossier a été inclus.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => nav(`/admin/visa-group-submissions${selectedTravelTripId || bookingTripId || travelCtx.trip?.id ? `?trip=${selectedTravelTripId || bookingTripId || travelCtx.trip?.id}` : ""}`)}
              >
                Ouvrir les dépôts
              </Button>
            </div>
            {submissionHistory.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-muted-foreground">
                Aucun lot de dépôt enregistré pour ce dossier visa.
              </div>
            ) : (
              <div className="space-y-2">
                {submissionHistory.map(({ item, batch }) => (
                  <div key={item.id} className="rounded-lg border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{batch.reference}</p>
                        <p className="text-xs text-muted-foreground">
                          Dépôt prévu: {formatVisaDate(batch.submission_date)}
                          {batch.actual_submission_date ? ` · Déposé le ${formatVisaDate(batch.actual_submission_date)}` : ""}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Nom officiel: {item.official_name} · Passeport {maskPassportNo(item.passport_no)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">
                          {VISA_SUBMISSION_BATCH_STATUS_LABEL[batch.status] ?? batch.status}
                        </Badge>
                        {batch.file_path && (
                          <Button size="sm" variant="outline" onClick={() => downloadVisaSubmissionBatch(batch)}>
                            <Download className="h-4 w-4" /> PDF officiel
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="font-display text-lg mb-3">Documents ({docs.length})</h2>
            <div className="mb-3 rounded-lg border border-accent/30 bg-accent/5 p-3 text-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold">Liste personnalisée des documents</p>
                  <p className="text-xs text-muted-foreground">
                    Statut: {checklistDoc ? "générée / téléchargeable" : "à générer"}
                  </p>
                </div>
                {checklistDoc ? (
                  <Button size="sm" variant="outline" className="min-h-10" onClick={() => downloadDoc(checklistDoc)}>
                    <Download className="w-4 h-4" /> Télécharger la liste
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="min-h-10" onClick={regenerateChecklist} disabled={busy}>
                    <FileText className="w-4 h-4" /> Générer la liste
                  </Button>
                )}
              </div>
            </div>
            <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold">Procuration</p>
                  <p className="text-xs">
                    Statut: {procurationDoc ? "à signer / à recevoir" : "à générer puis à signer / à recevoir"}
                  </p>
                </div>
                {procurationDoc ? (
                  <Button size="sm" variant="outline" className="min-h-10" onClick={() => downloadDoc(procurationDoc)}>
                    <Download className="w-4 h-4" /> Télécharger procuration
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="min-h-10" onClick={generateProcuration} disabled={busy}>
                    <FileText className="w-4 h-4" /> Générer procuration
                  </Button>
                )}
              </div>
            </div>
            {docs.length === 0 && <p className="text-sm text-muted-foreground">Aucun document.</p>}
            <div className="space-y-2">
              {docs.map((d) => (
                <button key={d.id} onClick={() => downloadDoc(d)} className="w-full flex items-center gap-2 p-2 border border-border rounded hover:bg-secondary text-left">
                  <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">{d.file_name}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {isVisaProgramV2Document(d) ? "Programme visa V2 · Format Ambassade du Japon" : isVisaChecklistDocument(d) ? "Liste des documents · générée" : isVisaProcurationDocument(d) ? "Procuration · à signer / à recevoir" : d.doc_type}
                    </p>
                  </div>
                  <Download className="w-4 h-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="font-display text-lg mb-3 flex items-center gap-2"><MailQuestion className="w-4 h-4" /> Demande de documents</h2>
            <p className="text-xs text-muted-foreground mb-2">
              Précisez ce que le client doit téléverser. Le message sera affiché en haut de son formulaire.
            </p>
            <Textarea
              rows={3}
              placeholder="Ex. Photo d'identité 45×35mm, justificatif d'emploi, réservation d'hôtel…"
              value={app.requested_documents ?? ""}
              onChange={(e) => setApp({ ...app, requested_documents: e.target.value })}
            />
            {app.documents_requested_at && (
              <p className="text-xs text-muted-foreground mt-2">
                Demandé le {formatVisaDate(app.documents_requested_at)}
              </p>
            )}
            <div className="flex gap-2 mt-2">
              <Button size="sm" className="flex-1" onClick={requestDocs} disabled={busy}>Envoyer la demande</Button>
              {app.requested_documents && (
                <Button size="sm" variant="ghost" onClick={clearRequest} disabled={busy}>Effacer</Button>
              )}
            </div>
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="font-display text-lg mb-3">Notes internes</h2>
            <Textarea rows={6} value={app.admin_notes ?? ""} onChange={(e) => setApp({ ...app, admin_notes: e.target.value })} />
            <Button size="sm" onClick={saveNotes} className="mt-2 w-full"><Save className="w-4 h-4" /> Enregistrer</Button>
          </Card>
        </div>
      </div>

      <Dialog open={associationDialogOpen} onOpenChange={setAssociationDialogOpen}>
        <DialogContent className="flex max-h-[90dvh] max-w-4xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Associer une réservation</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Recherchez la réservation, puis choisissez le participant exact. Aucun lien n’est créé automatiquement.
            </p>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto md:grid-cols-2">
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="Référence, voyage, client, email, passeport…"
                    value={associationSearch}
                    onChange={(event) => setAssociationSearch(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void searchAssociationBookings();
                    }}
                  />
                </div>
                <Button type="button" variant="outline" onClick={() => searchAssociationBookings()} disabled={associationSearchBusy}>
                  Rechercher
                </Button>
              </div>

              <div className="space-y-2">
                {associationResults.length === 0 && (
                  <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                    {associationSearchBusy ? "Recherche en cours…" : "Aucune réservation sélectionnée."}
                  </p>
                )}
                {associationResults.map((booking) => {
                  const trip = bookingTrip(booking);
                  const selected = selectedAssociationBooking?.id === booking.id;
                  return (
                    <button
                      type="button"
                      key={booking.id}
                      className={`w-full rounded-lg border p-3 text-left text-sm transition-colors ${selected ? "border-accent bg-accent/10" : "border-border hover:bg-muted/40"}`}
                      onClick={() => loadAssociationParticipants(booking)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{booking.reference}</span>
                        <Badge variant="outline">{booking.status}</Badge>
                      </div>
                      <p className="mt-1 text-muted-foreground">{trip?.title ?? "Voyage non renseigné"}</p>
                      <p className="text-xs text-muted-foreground">
                        {[formatVisaDate(trip?.start_date), formatVisaDate(trip?.end_date)].filter(Boolean).join(" → ") || "Dates non renseignées"}
                      </p>
                      <p className="text-xs text-muted-foreground">{booking.contact_name} · {booking.contact_email}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <h3 className="font-semibold">Participant de la réservation</h3>
                <p className="text-sm text-muted-foreground">
                  Sélection obligatoire. Le participant doit appartenir à la réservation choisie.
                </p>
              </div>
              {!selectedAssociationBooking ? (
                <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                  Choisissez d’abord une réservation.
                </p>
              ) : associationParticipantsLoading ? (
                <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                  Chargement des participants…
                </p>
              ) : associationParticipantsError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-950">
                  <p>{associationParticipantsError}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3 bg-white"
                    onClick={() => loadAssociationParticipants(selectedAssociationBooking)}
                  >
                    Réessayer
                  </Button>
                </div>
              ) : associationParticipants.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                  Aucun participant n’est enregistré dans cette réservation.
                </p>
              ) : (
                <RadioGroup value={selectedAssociationParticipantId} onValueChange={setSelectedAssociationParticipantId}>
                  <div className="space-y-2">
                    {associationParticipants.map((participant) => (
                      <label
                        key={participant.id}
                        className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm transition-colors hover:bg-muted/40"
                      >
                        <RadioGroupItem value={participant.id} className="mt-1" />
                        <span className="min-w-0">
                          <span className="block font-semibold">{participantFullName(participant)}</span>
                          <span className="block text-xs text-muted-foreground">
                            Passeport {maskPassportNo(participant.passport_no)} · {participant.email || "email non renseigné"}
                          </span>
                          <span className="mt-1 inline-flex text-xs text-muted-foreground">
                            Statut: {associationParticipantStatusLabel(participant)}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </RadioGroup>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssociationDialogOpen(false)} disabled={associationSaving}>Annuler</Button>
            <Button onClick={confirmAssociation} disabled={associationSaving || !selectedAssociationBooking || !selectedAssociationParticipantId}>
              {associationSaving ? "Association…" : "Confirmer l’association"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(hotelPreview)} onOpenChange={(open) => !open && setHotelPreview(null)}>
        <DialogContent className="flex max-h-[90dvh] max-w-4xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Confirmation de réservation hôtelière</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Aperçu des données utilisées pour le PDF ambassade. Les corrections principales doivent être faites dans le voyage ou la rooming list.
            </p>
          </DialogHeader>
          {hotelPreview && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
              {hotelPreview.errors.length > 0 && (
                <Alert className="border-red-300 bg-red-50 text-red-950">
                  <AlertTriangle className="h-4 w-4 text-red-700" />
                  <AlertTitle>Génération bloquée</AlertTitle>
                  <AlertDescription>
                    <ul className="mt-2 list-disc space-y-1 pl-4">
                      {hotelPreview.errors.map((error) => <li key={error}>{error}</li>)}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">Document reference</p>
                  <p className="font-semibold">{hotelPreview.draft.documentReference}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">Agency group reservation reference</p>
                  <p className="font-semibold">{hotelPreview.draft.groupReservationReference} ({hotelPreview.draft.groupReservationName})</p>
                </div>
                        <div className="rounded-lg border border-border p-3">
                          <p className="text-xs text-muted-foreground">Hôtel</p>
                  <p className="font-semibold">
                    {hotelPreview.draft.hotelName}
                    {hotelPreview.isRepeatedHotelStayName && <span className="text-muted-foreground"> — {hotelPreview.stayLabel}</span>}
                  </p>
                  <p className="text-sm text-muted-foreground">{hotelPreview.draft.hotelAddress || "Adresse manquante"}</p>
                  <p className="text-sm text-muted-foreground">{hotelPreview.draft.hotelPhone || "Téléphone manquant"}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">Séjour</p>
                  <p className="font-semibold">{formatVisaDate(hotelPreview.draft.checkIn)} → {formatVisaDate(hotelPreview.draft.checkOut)}</p>
                  <p className="text-sm text-muted-foreground">{hotelPreview.draft.nights} nuit{hotelPreview.draft.nights > 1 ? "s" : ""}</p>
                  <p className="text-sm text-muted-foreground">Statut: {hotelPreview.draft.reservationStatus}</p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-lg border border-border bg-slate-50 p-3">
                  <p className="text-xs text-muted-foreground">Participants affectés</p>
                  <p className="font-semibold">{hotelPreview.diagnostics.assignedParticipants}/{hotelPreview.diagnostics.totalTripParticipants}</p>
                </div>
                <div className="rounded-lg border border-border bg-slate-50 p-3">
                  <p className="text-xs text-muted-foreground">Chambres créées</p>
                  <p className="font-semibold">{hotelPreview.diagnostics.roomCount}</p>
                </div>
                <div className="rounded-lg border border-border bg-slate-50 p-3">
                  <p className="text-xs text-muted-foreground">Chambres complètes</p>
                  <p className="font-semibold">{hotelPreview.diagnostics.completeRoomCount}</p>
                </div>
                <div className="rounded-lg border border-border bg-slate-50 p-3">
                  <p className="text-xs text-muted-foreground">Demandeur visa</p>
                  <p className="font-semibold">{hotelPreview.diagnostics.applicantRoomLabel ?? "Non affecté"}</p>
                </div>
              </div>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="min-w-[720px] w-full text-sm">
                  <thead className="bg-slate-100 text-left text-xs text-slate-700">
                    <tr>
                      <th className="p-2">Room No.</th>
                      <th className="p-2">Room Type / Board</th>
                      <th className="p-2">Guest Name</th>
                      <th className="p-2">Adults</th>
                      <th className="p-2">Children</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getHotelConfirmationRooms(hotelPreview.draft).map((room) => (
                      <tr key={room.roomId} className={room.guests.some((guest) => guest.isVisaApplicant) ? "bg-slate-100" : ""}>
                        <td className="border-t p-2">{room.roomNo || "Group allocation pending"}</td>
                        <td className="border-t p-2">{[room.roomType, room.board].filter(Boolean).join(" - ") || "Group allocation pending"}</td>
                        <td className="border-t p-2">
                          <div className="space-y-1">
                            {room.guests.map((guest) => (
                              <div key={guest.participantId} className={guest.isVisaApplicant ? "font-semibold" : ""}>
                                {guest.name}
                                {guest.isVisaApplicant && <span className="ml-2 text-xs text-muted-foreground">Visa applicant</span>}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="border-t p-2">{room.adults}</td>
                        <td className="border-t p-2">{room.children}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setHotelPreview(null)}>Fermer</Button>
            {hotelPreview && hotelPreview.document?.storage_path && (
              <Button variant="outline" onClick={() => downloadHotelConfirmationDocument(hotelPreview)}>
                <Download className="h-4 w-4" /> Télécharger
              </Button>
            )}
            {hotelPreview && (
              <Button onClick={() => generateHotelConfirmation(hotelPreview)} disabled={busy || hotelPreview.errors.length > 0}>
                <FileText className="h-4 w-4" /> {hotelPreview.document ? "Régénérer" : "Générer"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={visaProgramV2Open} onOpenChange={setVisaProgramV2Open}>
        <DialogContent className="flex max-h-[92dvh] w-[96vw] max-w-6xl flex-col overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b p-4">
            <DialogTitle>Programme visa V2 – Format Ambassade du Japon</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Préparez le tableau en anglais avant génération. Ces corrections s'appliquent uniquement au PDF généré.
            </p>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto p-4">
            {!visaProgramV2Draft ? (
              <p className="text-sm text-muted-foreground">Chargement du brouillon…</p>
            ) : (
              <div className="space-y-4">
                {currentVisaProgramV2Errors.length > 0 && (
                  <Alert className="border-red-300 bg-red-50 text-red-950">
                    <AlertTriangle className="h-4 w-4 text-red-700" />
                    <AlertTitle>Informations obligatoires manquantes</AlertTitle>
                    <AlertDescription>
                      <ul className="mt-2 list-disc space-y-1 pl-4">
                        {currentVisaProgramV2Errors.map((error) => (
                          <li key={error}>{error}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}

                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <label className="text-xs text-muted-foreground">Date d'établissement</label>
                    <Input
                      type="date"
                      value={visaProgramV2Draft.generatedDate}
                      onChange={(event) => updateVisaProgramV2Draft({ generatedDate: event.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Length of stay in Japan</label>
                    <Input
                      type="number"
                      min="1"
                      value={visaProgramV2Draft.lengthOfStayDays}
                      onChange={(event) => updateVisaProgramV2Draft({ lengthOfStayDays: Number(event.target.value || 0) })}
                    />
                  </div>
                  <div className="rounded-lg border border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
                    <p className="font-semibold text-foreground">{travelCtx.trip?.title || "Voyage non sélectionné"}</p>
                    <p>Arrivée Japon: {canonicalVisaTripDates.japanArrivalDate || "—"}</p>
                    <p>Départ Japon: {canonicalVisaTripDates.japanDepartureDate || "—"}</p>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="min-w-[1120px] w-full border-collapse text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-100 text-left text-xs font-semibold text-slate-700">
                      <tr>
                        <th className="w-32 border-b border-r p-2">Date (y/m/d)</th>
                        <th className="w-24 border-b border-r p-2">Day</th>
                        <th className="w-[360px] border-b border-r p-2">Activity Plan</th>
                        <th className="w-[240px] border-b border-r p-2">Contact</th>
                        <th className="w-[260px] border-b p-2">Accommodation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visaProgramV2Draft.rows.map((row, index) => (
                        <tr key={`${row.day}-${index}`} className="align-top">
                          <td className="border-r border-t p-2">
                            <Input value={row.date} onChange={(event) => updateVisaProgramV2Row(index, "date", event.target.value)} />
                          </td>
                          <td className="border-r border-t p-2">
                            <Input value={row.day} onChange={(event) => updateVisaProgramV2Row(index, "day", event.target.value)} />
                          </td>
                          <td className="border-r border-t p-2">
                            <Textarea rows={4} value={row.activityPlan} onChange={(event) => updateVisaProgramV2Row(index, "activityPlan", event.target.value)} />
                          </td>
                          <td className="border-r border-t p-2">
                            <Textarea rows={4} value={row.contact} onChange={(event) => updateVisaProgramV2Row(index, "contact", event.target.value)} />
                          </td>
                          <td className="border-t p-2">
                            <Textarea rows={4} value={row.accommodation} onChange={(event) => updateVisaProgramV2Row(index, "accommodation", event.target.value)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="shrink-0 border-t bg-white p-4">
            <Button variant="outline" onClick={() => setVisaProgramV2Open(false)} disabled={busy}>Fermer</Button>
            <Button variant="outline" onClick={downloadVisaProgramV2} disabled={busy || !visaProgramV2Draft || currentVisaProgramV2Errors.length > 0}>
              <Download className="h-4 w-4" /> Télécharger PDF
            </Button>
            <Button onClick={saveVisaProgramV2Document} disabled={busy || !visaProgramV2Draft || currentVisaProgramV2Errors.length > 0}>
              <Save className="h-4 w-4" /> Enregistrer dans le dossier
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PdfPreviewDialog
        open={preview === "visa"}
        onOpenChange={(v) => !v && setPreview(null)}
        title="Formulaire visa officiel"
        filename={`${app.reference}-visa-japon.pdf`}
        generate={generators.visa}
      />
      <PdfPreviewDialog
        open={preview === "invitation"}
        onOpenChange={(v) => !v && setPreview(null)}
        title="Lettre d'invitation"
        filename={`${app.reference}-invitation.pdf`}
        generate={generators.invitation}
      />
      <PdfPreviewDialog
        open={preview === "guarantee"}
        onOpenChange={(v) => !v && setPreview(null)}
        title="Lettre de garantie"
        filename={`${app.reference}-guarantee.pdf`}
        generate={generators.guarantee}
      />
      <PdfPreviewDialog
        open={preview === "programme"}
        onOpenChange={(v) => !v && setPreview(null)}
        title="Programme du voyage"
        filename={`${app.reference}-programme-voyage.pdf`}
        generate={generators.programme}
      />
      <PdfPreviewDialog
        open={preview === "confirmation"}
        onOpenChange={(v) => !v && setPreview(null)}
        title="Confirmation du voyage"
        filename={`${app.reference}-confirmation-voyage.pdf`}
        generate={generators.confirmation}
      />
    </div>
  );
}
