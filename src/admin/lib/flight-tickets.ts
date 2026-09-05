/* eslint-disable @typescript-eslint/no-explicit-any */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import stampUrl from "@/assets/stamp-moroccan-express.png";

export type FlightWorkflowStatus = "pending_booking" | "reserved" | "partially_ticketed" | "ticketed" | "delivered";
export type FlightTicketStatus = FlightWorkflowStatus | "incomplete";

export const FLIGHT_TICKET_STATUS_LABELS: Record<FlightTicketStatus, string> = {
  pending_booking: "En attente de réservation",
  reserved: "Vol réservé",
  partially_ticketed: "Billets partiellement émis",
  ticketed: "Billets émis",
  delivered: "Billets envoyés",
  incomplete: "Informations incomplètes",
};

export const LEGACY_FLIGHT_STATUS_MAP: Record<string, FlightWorkflowStatus> = {
  not_booked: "pending_booking",
  booked: "reserved",
  ticket_sent: "delivered",
  pending_booking: "pending_booking",
  reserved: "reserved",
  partially_ticketed: "partially_ticketed",
  ticketed: "ticketed",
  delivered: "delivered",
};

export const FLIGHT_TICKET_STATUS_CLASSES: Record<FlightTicketStatus, string> = {
  pending_booking: "border-red-200 bg-red-50 text-red-900",
  reserved: "border-blue-200 bg-blue-50 text-blue-900",
  incomplete: "border-orange-200 bg-orange-50 text-orange-900",
  partially_ticketed: "border-orange-200 bg-orange-50 text-orange-900",
  ticketed: "border-emerald-200 bg-emerald-50 text-emerald-900",
  delivered: "border-emerald-300 bg-emerald-100 text-emerald-950",
};

export const normalizePnr = (value: unknown) =>
  String(value ?? "").replace(/\s+/g, "").trim().toUpperCase();

export const flightHasTicketFile = (flight: any) =>
  Boolean(
    flight?.ticket_storage_path ||
    flight?.ticket_document_id ||
    Number(flight?.associated_ticket_document_count ?? 0) > 0
  );

export const normalizeFlightWorkflowStatus = (status?: unknown): FlightWorkflowStatus => {
  const value = String(status ?? "").trim();
  return LEGACY_FLIGHT_STATUS_MAP[value] ?? "pending_booking";
};

export const flightHasCoreReservationInfo = (flight: any) => {
  const amount = flight?.fare_amount ?? flight?.fare_mad;
  const hasAmount = amount !== null && amount !== undefined && amount !== "" && Number(amount) >= 0;
  const currency = String(flight?.fare_currency || (flight?.fare_mad != null ? "MAD" : "")).trim();
  return Boolean(
    normalizePnr(flight?.pnr || flight?.pnr_normalized) &&
    String(flight?.booking_platform ?? "").trim() &&
    hasAmount &&
    currency &&
    Number(flight?.linked_traveler_count ?? flight?.traveler_count ?? 0) > 0
  );
};

export const flightHasOptionalOperationalDetails = (flight: any) =>
  Boolean(
    String(flight?.airline ?? "").trim() ||
    String(flight?.flight_number ?? "").trim() ||
    flight?.departure_at ||
    flight?.return_at ||
    (Array.isArray(flight?.segments) && flight.segments.length > 0) ||
    String(flight?.booking_class ?? "").trim() ||
    String(flight?.baggage ?? "").trim()
  );

export const travelerHasTicketEvidence = (
  traveler: any,
  ticketNumbers: any[] = [],
  ticketDocuments: any[] = []
) =>
  Boolean(
    String(traveler?.e_ticket_number ?? "").trim() ||
    ticketNumbers.some((ticket) => ticket?.participant_id === traveler?.participant_id && String(ticket?.e_ticket_number ?? "").trim()) ||
    ticketDocuments.some((doc) => doc?.participant_ids?.includes?.(traveler?.participant_id))
  );

export const isFlightFinalizedForTraveler = (flight: any, traveler?: any) => {
  const travelerLinked = !traveler || ["linked", "ticketed"].includes(String(traveler?.traveler_status ?? ""));
  return flightHasCoreReservationInfo(flight) && travelerLinked;
};

export const getFlightTicketStatus = (
  flight?: any | null,
  traveler?: any | null,
  ticketNumbers: any[] = [],
  ticketDocuments: any[] = []
): FlightTicketStatus => {
  if (!flight || String(flight.status ?? "") === "cancelled") return "pending_booking";
  const status = normalizeFlightWorkflowStatus(flight.status);
  if (status === "delivered") return "delivered";
  if (status === "ticketed") return "ticketed";
  if (status === "partially_ticketed") return "partially_ticketed";
  if (status === "reserved") return "reserved";
  if (traveler && travelerHasTicketEvidence(traveler, ticketNumbers, ticketDocuments)) return "ticketed";
  if (
    flightHasCoreReservationInfo(flight) ||
    flightHasTicketFile(flight) ||
    String(flight?.pnr ?? "").trim() ||
    flightHasOptionalOperationalDetails(flight)
  ) {
    return "incomplete";
  }
  return "pending_booking";
};

export const missingFlightReservationRequirements = (flight: any, travelerCount?: number) => {
  const missing: string[] = [];
  if (!normalizePnr(flight?.pnr || flight?.pnr_normalized)) missing.push("PNR");
  if (!String(flight?.booking_platform ?? "").trim()) missing.push("Plateforme");
  const amount = flight?.fare_amount ?? flight?.fare_mad;
  if (amount === null || amount === undefined || amount === "" || Number(amount) < 0) missing.push("Prix total");
  if (!String(flight?.fare_currency || (flight?.fare_mad != null ? "MAD" : "")).trim()) missing.push("Devise");
  if (Number(travelerCount ?? flight?.linked_traveler_count ?? flight?.traveler_count ?? 0) <= 0) missing.push("Voyageurs");
  return missing;
};

export const missingFlightTicketRequirements = (
  flight: any,
  traveler?: any | null,
  ticketNumbers: any[] = [],
  ticketDocuments: any[] = []
) => {
  const missing = missingFlightReservationRequirements(flight);
  if (traveler && !["linked", "ticketed"].includes(String(traveler?.traveler_status ?? ""))) {
    missing.push("Participant lié");
  }
  if (traveler && !travelerHasTicketEvidence(traveler, ticketNumbers, ticketDocuments)) missing.push("Billet ou e-ticket du participant");
  if (!flight?.ticket_sent_to_customer) missing.push("Billet envoyé au client");
  return missing;
};

export const participantFullName = (participant: any) =>
  [participant?.first_name, participant?.last_name].filter(Boolean).join(" ").trim() ||
  [participant?.given_names, participant?.surname].filter(Boolean).join(" ").trim() ||
  participant?.full_name ||
  participant?.contact_name ||
  "Participant";

export const sanitizeFilenamePart = (value: unknown) =>
  String(value ?? "document")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "document";

export const flightTicketVisaFilename = (participantName: string) =>
  `Billet_avion_${sanitizeFilenamePart(participantName)}.pdf`;

export function downloadBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function loadStamp(pdf: PDFDocument) {
  try {
    const res = await fetch(stampUrl);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return await pdf.embedPng(bytes);
  } catch {
    return null;
  }
}

export async function createStampedFlightTicketPdf(
  originalPdf: ArrayBuffer,
  context: {
    participantName: string;
    bookingReference?: string | null;
    generatedAt?: Date;
  }
) {
  const pdf = await PDFDocument.load(originalPdf);
  const pages = pdf.getPages();
  if (pages.length === 0) return await pdf.save();

  const page = pages[0];
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const stamp = await loadStamp(pdf);
  const { width } = page.getSize();
  const x = width - 176;
  const y = 36;

  page.drawRectangle({
    x: x - 8,
    y: y - 8,
    width: 144,
    height: 82,
    borderColor: rgb(0.82, 0.82, 0.82),
    color: rgb(1, 1, 1),
    opacity: 0.78,
    borderWidth: 0.6,
  });

  if (stamp) {
    const stampWidth = 78;
    const stampHeight = stampWidth / (stamp.width / stamp.height);
    page.drawImage(stamp, { x: x + 42, y: y + 14, width: stampWidth, height: stampHeight, opacity: 0.82 });
  }

  page.drawText("Copie jointe au dossier de voyage", {
    x,
    y: y + 54,
    size: 7.5,
    font: bold,
    color: rgb(0.14, 0.14, 0.14),
  });
  page.drawText(`Participant: ${context.participantName}`.slice(0, 48), {
    x,
    y: y + 42,
    size: 6.8,
    font,
    color: rgb(0.28, 0.28, 0.28),
  });
  if (context.bookingReference) {
    page.drawText(`Reservation: ${context.bookingReference}`.slice(0, 48), {
      x,
      y: y + 32,
      size: 6.8,
      font,
      color: rgb(0.28, 0.28, 0.28),
    });
  }

  return await pdf.save();
}
