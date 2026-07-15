import { PDFDocument, PDFPage, PDFFont, StandardFonts, rgb } from "pdf-lib";
import { sanitizePdfText } from "@/lib/booking-pdfs";
import { addCalendarDays, inclusiveCalendarDaysBetween, visaTripDatesFromTrip } from "@/lib/visa-trip-dates";
import { normalizeAgencySettings, type AgencySettings } from "@/lib/agency-settings";

export const VISA_PROGRAM_V2_DOCUMENT_TYPE = "visa_program_v2";

export type VisaProgramV2Row = {
  date: string;
  day: string;
  activityPlan: string;
  contact: string;
  accommodation: string;
};

export type VisaProgramV2Draft = {
  generatedDate: string;
  lengthOfStayDays: number;
  rows: VisaProgramV2Row[];
};

type TravelContext = {
  trip?: any | null;
  programme?: any | null;
  days?: any[];
  hotels?: any[];
  agency?: Partial<AgencySettings> | null;
};

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 36;
const TABLE_WIDTH = PAGE.width - MARGIN * 2;
const HEADER_Y = 760;
const FOOTER_Y = 34;
const BLACK = rgb(0.08, 0.08, 0.08);
const MUTED = rgb(0.35, 0.38, 0.42);
const BORDER = rgb(0.68, 0.70, 0.74);
const LIGHT = rgb(0.96, 0.97, 0.98);
const BRAND = rgb(0.78, 0.07, 0.10);

const columns = [
  { key: "date", label: "Date (y/m/d)", width: 72 },
  { key: "day", label: "Day", width: 48 },
  { key: "activityPlan", label: "Activity Plan", width: 196 },
  { key: "contact", label: "Contact", width: 102 },
  { key: "accommodation", label: "Accommodation", width: TABLE_WIDTH - 72 - 48 - 196 - 102 },
] as const;

const clean = (value: unknown, fallback = "") => sanitizePdfText(value ?? fallback).trim();

const isoDateOnly = (value?: string | null) => {
  const match = String(value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
};

const toYmdSlash = (value?: string | null) => {
  const iso = isoDateOnly(value);
  return iso ? iso.replace(/-/g, "/") : "";
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const daysBetween = (start?: string | null, end?: string | null) => {
  const count = inclusiveCalendarDaysBetween(start, end);
  return count === null ? 0 : count;
};

const dateOffsetFrom = (base?: string | null, value?: string | null) => {
  const baseIso = isoDateOnly(base);
  const valueIso = isoDateOnly(value);
  if (!baseIso || !valueIso) return null;
  const [by, bm, bd] = baseIso.split("-").map(Number);
  const [vy, vm, vd] = valueIso.split("-").map(Number);
  return Math.round((Date.UTC(vy, vm - 1, vd) - Date.UTC(by, bm - 1, bd)) / 86400000);
};

const firstText = (...values: unknown[]) => values.map((value) => clean(value)).find(Boolean) || "";

const flightNumberFromText = (value: unknown) => {
  const text = clean(value);
  const match = text.match(/\b[A-Z0-9]{2,3}\s?-?\d{2,4}[A-Z]?\b/i);
  return match?.[0]?.replace(/\s+/g, "") || "";
};

const lineValue = (value: unknown) => clean(value).replace(/\s+/g, " ");

const dayActivities = (day: any) => {
  const schedule = Array.isArray(day?.schedule_items) ? day.schedule_items : [];
  const scheduleText = schedule
    .map((item: any) => [item.time, item.title].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("; ");
  return firstText(scheduleText, day?.title, day?.description, day?.city, "Free day according to the confirmed programme.");
};

const programmeDayForDate = (ctx: TravelContext, date: string | null) => {
  const offset = dateOffsetFrom(ctx.trip?.start_date, date);
  const programmeDayNumber = offset === null ? null : offset + 1;
  if (!programmeDayNumber || programmeDayNumber < 1) return null;
  return (ctx.days ?? []).find((day) => Number(day.day_number || 0) === programmeDayNumber) ?? null;
};

const hotelForNight = (ctx: TravelContext, date?: string | null) => {
  const iso = isoDateOnly(date);
  if (!iso) return null;
  return (ctx.hotels ?? []).find((hotel) => {
    const checkIn = isoDateOnly(hotel.check_in);
    const checkOut = isoDateOnly(hotel.check_out);
    return checkIn && checkOut && iso >= checkIn && iso < checkOut;
  }) ?? null;
};

const hotelName = (hotel: any, app: any, ctx: TravelContext) =>
  firstText(hotel?.name, ctx.trip?.visa_hotel_name, app?.hotel_name);

const hotelCity = (hotel: any) => firstText(hotel?.city);

const hotelContact = (hotel: any, app: any, ctx: TravelContext) => {
  const name = hotelName(hotel, app, ctx);
  const address = firstText(hotel?.address, ctx.trip?.visa_hotel_address, app?.hotel_address);
  const phone = firstText(hotel?.phone, ctx.trip?.visa_hotel_phone, app?.hotel_tel);
  return [name, address, phone].filter(Boolean).join("\n");
};

const hotelAccommodation = (hotel: any, app: any, ctx: TravelContext) => {
  const name = hotelName(hotel, app, ctx);
  const city = hotelCity(hotel);
  const address = firstText(hotel?.address, ctx.trip?.visa_hotel_address, app?.hotel_address);
  return [name, city, address].filter(Boolean).join("\n");
};

export function sanitizeVisaProgramV2Filename(app: any, ctx: TravelContext = {}) {
  const name = firstText([app?.surname, app?.given_names].filter(Boolean).join("_"), "Client");
  const trip = firstText(ctx.trip?.title, ctx.programme?.title, "Voyage");
  return `Programme_Visa_V2_${name}_${trip}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 130) + ".pdf";
}

export function buildVisaProgramV2Draft(app: any, ctx: TravelContext = {}): VisaProgramV2Draft {
  const trip = ctx.trip ?? {};
  const visaDates = visaTripDatesFromTrip(trip);
  const departureInternational = isoDateOnly(trip.start_date);
  const arrivalJapan = isoDateOnly(app?.date_of_arrival) || visaDates.japanArrivalDate;
  const departureJapan = visaDates.japanDepartureDate || isoDateOnly(trip.end_date);
  const lengthOfStayDays = Number(visaDates.japanStayDays || daysBetween(arrivalJapan, departureJapan) || 0);
  const arrivalFlight = firstText(app?.airline_or_ship, trip.visa_arrival_flight_number, flightNumberFromText(trip.outbound_flight_text));
  const returnFlight = firstText(flightNumberFromText(trip.return_flight_text), trip.metadata?.return_flight_numbers);
  const departureCity = firstText(trip.metadata?.departure_airport, trip.metadata?.outbound_departure_airport, "Casablanca / Morocco");
  const arrivalAirport = firstText(app?.port_of_entry, trip.visa_arrival_port, "Japan airport");
  const agency = normalizeAgencySettings(ctx.agency);
  const agencyContact = [agency.brand_name, agency.email, agency.phone].filter(Boolean).join("\n");
  const rows: VisaProgramV2Row[] = [];

  if (departureInternational) {
    rows.push({
      date: toYmdSlash(departureInternational),
      day: "Day 0",
      activityPlan: `Departure from ${departureCity} on flight ${arrivalFlight || "[flight number]"}.`,
      contact: agencyContact,
      accommodation: "In flight",
    });
  }

  const firstHotel = hotelForNight(ctx, arrivalJapan);
  if (arrivalJapan) {
    rows.push({
      date: toYmdSlash(arrivalJapan),
      day: "Day 0",
      activityPlan: `Arrival at ${arrivalAirport} on flight ${arrivalFlight || "[flight number]"}. Transfer to ${hotelName(firstHotel, app, ctx) || "hotel"}.`,
      contact: hotelContact(firstHotel, app, ctx) || agencyContact,
      accommodation: hotelAccommodation(firstHotel, app, ctx),
    });
  }

  for (let index = 0; index < lengthOfStayDays; index += 1) {
    const date = addCalendarDays(arrivalJapan, index);
    const isDepartureDay = Boolean(departureJapan && date === departureJapan);
    const day = programmeDayForDate(ctx, date);
    const hotel = isDepartureDay ? null : hotelForNight(ctx, date);
    const city = firstText(day?.city, hotel?.city);
    const activity = isDepartureDay
      ? `Check-out and transfer to ${firstText(trip.metadata?.return_airport, arrivalAirport, "airport")}. Departure from Japan${returnFlight ? ` on flight ${returnFlight}` : ""}.`
      : `${city ? `${city}: ` : ""}${dayActivities(day)}.`;
    rows.push({
      date: toYmdSlash(date),
      day: `Day ${index + 1}`,
      activityPlan: activity,
      contact: isDepartureDay ? agencyContact : hotelContact(hotel, app, ctx) || agencyContact,
      accommodation: isDepartureDay ? "None - Departure from Japan" : hotelAccommodation(hotel, app, ctx),
    });
  }

  return {
    generatedDate: todayIso(),
    lengthOfStayDays,
    rows,
  };
}

export function validateVisaProgramV2Draft(draft: VisaProgramV2Draft, app: any, ctx: TravelContext = {}) {
  const errors: string[] = [];
  const trip = ctx.trip ?? {};
  const visaDates = visaTripDatesFromTrip(trip);
  const departureInternational = isoDateOnly(trip.start_date);
  const arrivalJapan = isoDateOnly(app?.date_of_arrival) || visaDates.japanArrivalDate;
  const departureJapan = visaDates.japanDepartureDate || isoDateOnly(trip.end_date);
  const arrivalFlight = firstText(app?.airline_or_ship, trip.visa_arrival_flight_number, flightNumberFromText(trip.outbound_flight_text));
  const returnFlight = firstText(flightNumberFromText(trip.return_flight_text), trip.metadata?.return_flight_numbers);

  if (!trip?.id) errors.push("Aucun voyage n'est sélectionné pour ce programme visa V2.");
  if (!departureInternational) errors.push("Date du départ international manquante sur le voyage.");
  if (!arrivalJapan) errors.push("Date d'arrivée au Japon manquante.");
  if (!departureJapan) errors.push("Date de départ du Japon manquante.");
  if (!draft.generatedDate) errors.push("Date d'établissement du document manquante.");
  if (!draft.lengthOfStayDays || draft.lengthOfStayDays <= 0) errors.push("Durée du séjour au Japon manquante ou invalide.");
  if (!arrivalFlight || arrivalFlight.includes("[")) errors.push("Numéro du vol d'arrivée au Japon manquant.");
  if (!firstText(trip.outbound_flight_text, arrivalFlight)) errors.push("Détails du vol aller manquants.");
  if (!returnFlight || !firstText(trip.return_flight_text, returnFlight)) errors.push("Numéro ou détails du vol de départ du Japon manquants.");
  if (!ctx.hotels?.length) errors.push("Aucun hôtel confirmé n'est renseigné pour ce voyage.");

  if (arrivalJapan && departureJapan) {
    const nights = Math.max(0, daysBetween(arrivalJapan, departureJapan) - 1);
    for (let index = 0; index < nights; index += 1) {
      const night = addCalendarDays(arrivalJapan, index);
      if (!hotelForNight(ctx, night)) {
        const label = night ? new Date(`${night}T00:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "date inconnue";
        errors.push(`Hôtel manquant pour la nuit du ${label}.`);
      }
    }
  }

  draft.rows.forEach((row, index) => {
    const label = `Ligne ${index + 1}`;
    if (!row.date.trim()) errors.push(`${label}: date manquante.`);
    if (!row.day.trim()) errors.push(`${label}: numéro de jour manquant.`);
    if (!row.activityPlan.trim()) errors.push(`${label}: activité manquante.`);
    if (!row.contact.trim()) errors.push(`${label}: contact manquant.`);
    if (!row.accommodation.trim()) errors.push(`${label}: hébergement manquant.`);
    if (/or similar|h[oô]tel similaire/i.test(`${row.activityPlan} ${row.accommodation}`)) {
      errors.push(`${label}: le texte ne doit pas contenir "or similar" ou "hôtel similaire".`);
    }
    if (/\[flight number\]|\[.*?\]/i.test(row.activityPlan)) {
      errors.push(`${label}: numéro de vol ou information entre crochets à compléter.`);
    }
  });

  return errors;
}

function drawText(page: PDFPage, value: unknown, x: number, y: number, font: PDFFont, size: number, color = BLACK) {
  page.drawText(clean(value), { x, y, font, size, color });
}

function wrapText(value: unknown, font: PDFFont, size: number, maxWidth: number) {
  const words = clean(value).replace(/\s+/g, " ").split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) current = next;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function drawMultiline(page: PDFPage, value: unknown, x: number, y: number, width: number, font: PDFFont, size: number, lineHeight: number) {
  const paragraphs = clean(value).split(/\r?\n/);
  const lines = paragraphs.flatMap((paragraph) => wrapText(paragraph, font, size, width));
  lines.forEach((line, index) => drawText(page, line, x, y - index * lineHeight, font, size));
  return lines.length;
}

function rowHeight(row: VisaProgramV2Row, font: PDFFont) {
  const lineHeight = 10;
  const maxLines = Math.max(
    1,
    ...columns.map((column) => {
      const value = row[column.key];
      return clean(value).split(/\r?\n/).flatMap((paragraph) => wrapText(paragraph, font, 7.2, column.width - 8)).length;
    })
  );
  return Math.max(42, maxLines * lineHeight + 15);
}

function drawTableHeader(page: PDFPage, y: number, bold: PDFFont) {
  page.drawRectangle({ x: MARGIN, y: y - 24, width: TABLE_WIDTH, height: 24, color: LIGHT, borderColor: BORDER, borderWidth: 0.8 });
  let x = MARGIN;
  columns.forEach((column) => {
    page.drawRectangle({ x, y: y - 24, width: column.width, height: 24, borderColor: BORDER, borderWidth: 0.6 });
    drawText(page, column.label, x + 4, y - 15, bold, 7.4);
    x += column.width;
  });
}

function drawFooter(page: PDFPage, font: PDFFont, pageNumber: number, totalPages: number) {
  page.drawRectangle({ x: MARGIN, y: FOOTER_Y + 12, width: TABLE_WIDTH, height: 0.5, color: BORDER });
  drawText(page, "LeJapon.ma / Moroccan Express Travel and Events", MARGIN, FOOTER_Y, font, 7, MUTED);
  drawText(page, `Page ${pageNumber} / ${totalPages}`, PAGE.width - MARGIN - 62, FOOTER_Y, font, 7, MUTED);
}

export async function generateVisaProgramV2Pdf(draft: VisaProgramV2Draft, app: any, ctx: TravelContext = {}): Promise<Uint8Array> {
  const errors = validateVisaProgramV2Draft(draft, app, ctx);
  if (errors.length) throw new Error(errors[0]);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [year, month, day] = (draft.generatedDate || todayIso()).split("-");

  let page = pdf.addPage([PAGE.width, PAGE.height]);
  let y = HEADER_Y;

  drawText(page, `(Year) ${year || ""}     (Month) ${month || ""}     (Day) ${day || ""}`, PAGE.width - MARGIN - 210, 802, font, 9);
  drawText(page, "Travel Itinerary", 226, y, bold, 18);
  y -= 32;
  drawText(page, `Length of stay in Japan: ${draft.lengthOfStayDays} days`, MARGIN, y, bold, 10);
  y -= 22;
  drawText(page, "The travel itinerary of the visa applicant is as follows:", MARGIN, y, font, 9.5);
  y -= 26;
  drawTableHeader(page, y, bold);
  y -= 24;

  for (const row of draft.rows) {
    const h = rowHeight(row, font);
    if (y - h < 66) {
      page = pdf.addPage([PAGE.width, PAGE.height]);
      y = 800;
      drawTableHeader(page, y, bold);
      y -= 24;
    }
    page.drawRectangle({ x: MARGIN, y: y - h, width: TABLE_WIDTH, height: h, borderColor: BORDER, borderWidth: 0.6 });
    let x = MARGIN;
    columns.forEach((column) => {
      page.drawRectangle({ x, y: y - h, width: column.width, height: h, borderColor: BORDER, borderWidth: 0.4 });
      drawMultiline(page, row[column.key], x + 4, y - 12, column.width - 8, font, 7.2, 10);
      x += column.width;
    });
    y -= h;
  }

  const pages = pdf.getPages();
  pages.forEach((pdfPage, index) => drawFooter(pdfPage, font, index + 1, pages.length));
  return pdf.save();
}
