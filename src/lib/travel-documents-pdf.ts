import { PDFDocument, PDFPage, PDFFont, StandardFonts, rgb } from "pdf-lib";
import logoUrl from "@/assets/logo-moroccan-express.png";
import logoJaponUrl from "@/assets/logo-lejapon.png";
import { sanitizePdfText } from "@/lib/booking-pdfs";
import { agencyAddressLine, agencyIceLine, normalizeAgencySettings, type AgencySettings } from "@/lib/agency-settings";

type TravelContext = {
  trip?: any | null;
  programme?: any | null;
  days?: any[];
  hotels?: any[];
  participants?: any[];
  agency?: Partial<AgencySettings> | null;
};

const RED = rgb(0.78, 0.07, 0.10);
const BLACK = rgb(0.08, 0.08, 0.08);
const GREY = rgb(0.42, 0.42, 0.42);
const LIGHT = rgb(0.97, 0.97, 0.97);
const BORDER = rgb(0.86, 0.86, 0.86);

const fmtDate = (value?: string | null) => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return sanitizePdfText(value);
  return sanitizePdfText(d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }));
};

const fmtDayMonth = (value?: string | null) => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return sanitizePdfText(value);
  return sanitizePdfText(d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long" }));
};

const addDays = (value: string | null | undefined, offset: number) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

const dateToTime = (value?: string | null) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
};

async function embedImage(pdf: PDFDocument, url?: string | null) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("jpeg") || contentType.includes("jpg") || /\.jpe?g($|\?)/i.test(url)) {
      return await pdf.embedJpg(bytes);
    }
    return await pdf.embedPng(bytes);
  } catch {
    return null;
  }
}

function drawImageContain(page: PDFPage, image: any, box: { x: number; y: number; width: number; height: number; padding?: number }) {
  const padding = box.padding ?? 0;
  const maxW = Math.max(1, box.width - padding * 2);
  const maxH = Math.max(1, box.height - padding * 2);
  const ratio = image.width / image.height;
  let width = maxW;
  let height = width / ratio;
  if (height > maxH) {
    height = maxH;
    width = height * ratio;
  }
  page.drawImage(image, {
    x: box.x + padding + (maxW - width) / 2,
    y: box.y + padding + (maxH - height) / 2,
    width,
    height,
  });
}

function wrap(text: unknown, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = sanitizePdfText(text).replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
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
  return lines;
}

function text(page: PDFPage, value: unknown, x: number, y: number, font: PDFFont, size = 10, color = BLACK) {
  page.drawText(sanitizePdfText(value), { x, y, font, size, color });
}

function drawWrapped(page: PDFPage, value: unknown, x: number, y: number, width: number, font: PDFFont, size = 9, color = BLACK, lineHeight = size + 3, maxLines = 99) {
  const lines = wrap(value, font, size, width).slice(0, maxLines);
  lines.forEach((line, idx) => text(page, line, x, y - idx * lineHeight, font, size, color));
  return lines.length * lineHeight;
}

async function header(pdf: PDFDocument, page: PDFPage, title: string, ref: string, font: PDFFont, bold: PDFFont, agency: AgencySettings) {
  const logo = await embedImage(pdf, agency.logo_url || logoUrl);
  if (logo) {
    drawImageContain(page, logo, { x: 40, y: 786, width: 128, height: 42, padding: 3 });
  } else {
    text(page, agency.legal_company_name, 40, 810, bold, 13);
  }
  text(page, title, 300, 812, bold, 20, RED);
  text(page, ref, 300, 794, font, 9, GREY);
  page.drawRectangle({ x: 40, y: 772, width: 515, height: 1.2, color: RED });
}

async function footer(pdf: PDFDocument, page: PDFPage, font: PDFFont, agency: AgencySettings) {
  const logo = await embedImage(pdf, agency.logo_url || logoJaponUrl);
  page.drawRectangle({ x: 40, y: 58, width: 515, height: 0.6, color: BORDER });
  let x = 40;
  if (logo) {
    drawImageContain(page, logo, { x, y: 18, width: 70, height: 32, padding: 2 });
    x += 82;
  }
  text(page, `${agency.legal_company_name} / ${agency.brand_name}`, x, 42, font, 7.5, GREY);
  text(page, `${agencyAddressLine(agency)} · ${agencyIceLine(agency)}`, x, 32, font, 7.5, GREY);
  text(page, `${agency.email} · ${agency.phone}${agency.website ? ` · ${agency.website}` : ""}`, x, 22, font, 7.5, GREY);
}

function field(page: PDFPage, label: string, value: unknown, x: number, y: number, width: number, font: PDFFont, bold: PDFFont) {
  page.drawRectangle({ x, y: y - 38, width, height: 38, color: LIGHT, borderColor: BORDER, borderWidth: 0.5 });
  text(page, label, x + 9, y - 14, font, 7.5, GREY);
  const lines = wrap(value || "-", bold, 9.5, width - 18);
  text(page, lines[0] || "-", x + 9, y - 29, bold, 9.5, BLACK);
}

function sectionTitle(page: PDFPage, title: string, x: number, y: number, bold: PDFFont) {
  page.drawRectangle({ x, y: y - 18, width: 515, height: 18, color: BLACK });
  text(page, title, x + 10, y - 13, bold, 9.5, rgb(1, 1, 1));
}

function row(page: PDFPage, label: string, value: unknown, x: number, y: number, width: number, font: PDFFont, bold: PDFFont) {
  text(page, label, x, y, bold, 8.5, GREY);
  wrap(value || "-", font, 9, width,).slice(0, 2).forEach((line, idx) => text(page, line, x + 120, y - idx * 11, font, 9, BLACK));
}

function preformatted(page: PDFPage, value: unknown, x: number, y: number, mono: PDFFont, size = 8.5) {
  const lines = sanitizePdfText(value)
    .split(/\r?\n/)
    .map((line) => line.replace(/\t/g, "    "));
  lines.forEach((line, idx) => text(page, line, x, y - idx * 11, mono, size, BLACK));
  return Math.max(lines.length, 1) * 11;
}

async function pageWithHeader(pdf: PDFDocument, title: string, ref: string, font: PDFFont, bold: PDFFont, agency: AgencySettings) {
  const page = pdf.addPage([595.28, 841.89]);
  await header(pdf, page, title, ref, font, bold, agency);
  await footer(pdf, page, font, agency);
  return page;
}

function dayActivities(day: any) {
  const schedule = Array.isArray(day.schedule_items) ? day.schedule_items : [];
  const scheduleText = schedule.map((s: any) => [s.time, s.title].filter(Boolean).join(" ")).filter(Boolean).join(" · ");
  return scheduleText || day.description || day.title || "-";
}

function dayTransport(day: any) {
  const icons = Array.isArray(day.icons) ? day.icons : [];
  const known = icons.filter((i: string) => ["bus", "train", "shinkansen", "plane", "boat", "walk"].includes(i));
  return known.length ? known.join(", ") : "-";
}

function hotelForDay(day: any, ctx: TravelContext, app: any, date?: string | null) {
  const hotels = ctx.hotels ?? [];
  const dateTime = dateToTime(date);
  const dateMatch = dateTime
    ? hotels.find((h) => {
        const checkIn = dateToTime(h.check_in);
        const checkOut = dateToTime(h.check_out);
        return checkIn !== null && checkOut !== null && dateTime >= checkIn && dateTime < checkOut;
      })
    : null;
  if (dateMatch?.name) return [dateMatch.name, dateMatch.city].filter(Boolean).join(", ");
  const city = String(day.city ?? "").toLowerCase();
  const match = hotels.find((h) => city && String(h.city ?? "").toLowerCase().includes(city));
  return match?.name ? [match.name, match.city].filter(Boolean).join(", ") : app.hotel_name || ctx.trip?.visa_hotel_name || "-";
}

function hotelReservationLine(hotel: any, fallbackArrival?: string | null, fallbackDeparture?: string | null) {
  const checkIn = hotel.check_in || fallbackArrival;
  const checkOut = hotel.check_out || fallbackDeparture;
  const city = hotel.city ? `, ${hotel.city}` : "";
  const stay = checkIn || checkOut ? `Du ${fmtDayMonth(checkIn)} au ${fmtDayMonth(checkOut)} : ` : "";
  return `${stay}${hotel.name || "Hotel"}${city}`;
}

function hotelDetailsLine(hotel: any) {
  return [hotel.address, hotel.phone].filter(Boolean).join(" · ");
}

export async function generateTravelProgrammePdf(app: any, ctx: TravelContext = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const agency = normalizeAgencySettings(ctx.agency);
  const title = "Programme du voyage";
  const ref = app.reference ? `Dossier ${app.reference}` : "Dossier visa";
  let page = await pageWithHeader(pdf, title, ref, font, bold, agency);
  let y = 730;

  const fullName = [app.surname, app.given_names].filter(Boolean).join(" ") || "Client";
  const tripTitle = ctx.trip?.title || ctx.programme?.title || "Voyage Japon";
  const arrival = app.date_of_arrival || ctx.trip?.visa_japan_arrival_date || ctx.trip?.start_date;
  const departure = ctx.trip?.visa_japan_departure_date || ctx.trip?.end_date;
  const days = (ctx.days ?? []).filter((d) => d.is_active !== false).sort((a, b) => (a.sort_order ?? a.day_number ?? 0) - (b.sort_order ?? b.day_number ?? 0));

  text(page, sanitizePdfText(fullName).toUpperCase(), 40, y, bold, 13);
  text(page, tripTitle, 40, y - 18, font, 10, GREY);
  field(page, "Arrivee Japon", fmtDate(arrival), 40, y - 48, 160, font, bold);
  field(page, "Depart Japon", fmtDate(departure), 218, y - 48, 160, font, bold);
  field(page, "Programme", ctx.programme?.title || tripTitle, 396, y - 48, 159, font, bold);
  y -= 108;

  if (!days.length) {
    const message = ctx.programme
      ? "Aucun jour n'est renseigné pour ce programme dans Gestion des programmes."
      : "Aucun programme n'est lié à ce départ. Merci de choisir un programme dans Gestion des voyages.";
    wrap(message, font, 10, 500).forEach((line, idx) => text(page, line, 40, y - idx * 13, font, 10, GREY));
  }

  for (const day of days) {
    const boxHeight = 82;
    if (y - boxHeight < 82) {
      page = await pageWithHeader(pdf, title, ref, font, bold, agency);
      y = 730;
    }
    page.drawRectangle({ x: 40, y: y - boxHeight, width: 515, height: boxHeight, color: rgb(1, 1, 1), borderColor: BORDER, borderWidth: 0.6 });
    page.drawRectangle({ x: 40, y: y - boxHeight, width: 4, height: boxHeight, color: RED });
    const dayNo = Number(day.day_number || 1);
    const dayDate = addDays(arrival, dayNo - 1);
    text(page, `Jour ${dayNo} · ${fmtDate(dayDate)}`, 52, y - 17, bold, 10.5, BLACK);
    text(page, day.city || "-", 430, y - 17, font, 9, GREY);
    text(page, day.title || "-", 52, y - 33, bold, 10, BLACK);
    const activityLines = wrap(`Visites / activites : ${dayActivities(day)}`, font, 8.5, 480).slice(0, 2);
    activityLines.forEach((line, idx) => text(page, line, 52, y - 49 - idx * 11, font, 8.5, GREY));
    text(page, `Hotel : ${hotelForDay(day, ctx, app, dayDate)}`, 52, y - 72, font, 8.5, GREY);
    text(page, `Transport : ${dayTransport(day)}`, 300, y - 72, font, 8.5, GREY);
    y -= boxHeight + 10;
  }

  return pdf.save();
}

export async function generateTravelConfirmationPdf(app: any, settings: any = {}, ctx: TravelContext = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const agency = normalizeAgencySettings(ctx.agency);
  const page = pdf.addPage([595.28, 841.89]);
  const logo = await embedImage(pdf, agency.logo_url || logoUrl);
  const stamp = await embedImage(pdf, agency.stamp_signature_url);
  const fullName = [app.surname, app.given_names].filter(Boolean).join(" ") || "Client";
  const tripTitle = ctx.trip?.title || ctx.programme?.title || "Voyage Japon";
  const arrival = ctx.trip?.visa_japan_arrival_date || app.date_of_arrival || ctx.trip?.start_date;
  const departure = ctx.trip?.visa_japan_departure_date || ctx.trip?.end_date;
  const port = app.port_of_entry || ctx.trip?.visa_arrival_port || "-";
  const flight = app.airline_or_ship || ctx.trip?.visa_arrival_flight_number || "-";
  const outboundFlightText = String(ctx.trip?.outbound_flight_text ?? "");
  const returnFlightText = String(ctx.trip?.return_flight_text ?? "");
  const hasOutboundFlightText = outboundFlightText.trim().length > 0;
  const hasReturnFlightText = returnFlightText.trim().length > 0;
  const hotelName = ctx.trip?.visa_hotel_name || app.hotel_name || "-";
  const hotelAddress = ctx.trip?.visa_hotel_address || app.hotel_address || "";
  const hotelPhone = ctx.trip?.visa_hotel_phone || app.hotel_tel || "";
  const partnerName = settings.inviter_same_as_guarantor === false ? settings.inviter_name : settings.guarantor_name;
  const partnerAddress = settings.inviter_same_as_guarantor === false ? settings.inviter_address : settings.guarantor_address;
  const partnerPhone = settings.inviter_same_as_guarantor === false ? settings.inviter_tel : settings.guarantor_tel;
  const partnerRegistration = settings.guarantor_profession || settings.inviter_profession || "Travel agency / Tour operator";
  const participants = (ctx.participants?.length ? ctx.participants : [{ first_name: app.given_names, last_name: app.surname, passport_no: app.passport_no }])
    .map((p) => ({
      name: [p.first_name, p.last_name].filter(Boolean).join(" ") || fullName,
      passport: p.passport_no || "-",
    }));

  const section = (title: string, y: number) => {
    page.drawRectangle({ x: 40, y: y - 15, width: 515, height: 15, color: BLACK });
    text(page, title, 48, y - 11, bold, 8, rgb(1, 1, 1));
    return y - 24;
  };
  const smallRow = (label: string, value: unknown, x: number, y: number, width = 480) => {
    text(page, label, x, y, bold, 7.5, GREY);
    drawWrapped(page, value || "-", x + 82, y, width - 82, font, 8, BLACK, 9.5, 2);
  };
  const preLines = (value: unknown, x: number, y: number, size = 7) => {
    const lines = sanitizePdfText(value).split(/\r?\n/).map((line) => line.replace(/\t/g, "    "));
    lines.forEach((line, idx) => text(page, line, x, y - idx * 8, mono, size, BLACK));
    return Math.max(lines.length, 1) * 8;
  };

  // Compact one-page header.
  if (logo) drawImageContain(page, logo, { x: 40, y: 786, width: 118, height: 38, padding: 3 });
  else text(page, agency.brand_name, 40, 810, bold, 12);
  text(page, "CONFIRMATION DE VOYAGE", 190, 812, bold, 16, RED);
  text(page, app.reference ? `Dossier ${app.reference}` : "Dossier visa", 190, 795, font, 8, GREY);
  text(page, `Date: ${fmtDate(new Date().toISOString())}`, 455, 812, font, 8, GREY);
  text(page, agency.agency_display_name, 40, 774, bold, 8.5, BLACK);
  text(page, `${agencyAddressLine(agency)} · ${agencyIceLine(agency)}`, 40, 763, font, 7, GREY);
  text(page, `${agency.email} · ${agency.phone}${agency.website ? ` · ${agency.website}` : ""}`, 40, 753, font, 7, GREY);
  page.drawRectangle({ x: 40, y: 742, width: 515, height: 1, color: RED });

  let y = 724;
  page.drawRectangle({ x: 40, y: y - 42, width: 515, height: 42, color: LIGHT, borderColor: BORDER, borderWidth: 0.5 });
  text(page, "Participant principal", 50, y - 13, font, 7, GREY);
  text(page, fullName, 50, y - 28, bold, 9, BLACK);
  text(page, "Voyage", 210, y - 13, font, 7, GREY);
  text(page, tripTitle, 210, y - 28, bold, 8.5, BLACK);
  text(page, "Dates du sejour", 410, y - 13, font, 7, GREY);
  text(page, `${fmtDate(arrival)} - ${fmtDate(departure)}`, 410, y - 28, bold, 8.5, BLACK);
  y -= 58;

  const attestation = `${agency.legal_company_name}, operant la marque ${agency.brand_name}, atteste que les participants ci-dessous sont inscrits a un voyage organise au Japon. Cette confirmation est emise pour appuyer les demarches administratives et de voyage relatives au sejour indique.`;
  y -= drawWrapped(page, attestation, 40, y, 515, font, 8, BLACK, 10, 3) + 8;

  y = section("JAPAN PARTNER CONFIRMATION BLOCK", y);
  page.drawRectangle({ x: 40, y: y - 48, width: 515, height: 54, color: rgb(1, 1, 1), borderColor: BORDER, borderWidth: 0.5 });
  smallRow("Partner", partnerName || "-", 48, y - 6, 240);
  smallRow("Phone", partnerPhone || "-", 315, y - 6, 230);
  smallRow("Address", partnerAddress || "-", 48, y - 24, 490);
  smallRow("Registration", partnerRegistration || "-", 48, y - 42, 490);
  y -= 66;

  y = section("FLIGHTS RESERVATION", y);
  if (hasOutboundFlightText) {
    text(page, "Outbound", 48, y, bold, 7.5, GREY);
    y -= preLines(outboundFlightText, 104, y, 7) + 4;
  } else {
    smallRow("Outbound", `${flight} - Arrival ${fmtDate(arrival)} at ${port}`, 48, y);
    y -= 14;
  }
  if (hasReturnFlightText) {
    text(page, "Return", 48, y, bold, 7.5, GREY);
    y -= preLines(returnFlightText, 104, y, 7) + 8;
  } else {
    smallRow("Return", `Return from Japan on ${fmtDate(departure)}`, 48, y);
    y -= 18;
  }

  y = section("HOTELS RESERVATIONS", y);
  const detailedHotels = (ctx.hotels ?? [])
    .filter((h) => [h.name, h.city, h.check_in, h.check_out, h.address, h.phone].some((value) => String(value ?? "").trim()))
    .sort((a, b) => (dateToTime(a.check_in) ?? 0) - (dateToTime(b.check_in) ?? 0) || ((a.sort_order ?? 0) - (b.sort_order ?? 0)));
  const hotelRows = detailedHotels.length
    ? detailedHotels.map((h) => ({ line: hotelReservationLine(h, arrival, departure), details: hotelDetailsLine(h) }))
    : [{ line: `${fmtDate(arrival)} - ${fmtDate(departure)} · ${hotelName}`, details: [hotelAddress, hotelPhone].filter(Boolean).join(" · ") }];
  for (const [idx, hotel] of hotelRows.entries()) {
    text(page, `${idx + 1}.`, 48, y, bold, 8, GREY);
    drawWrapped(page, hotel.line, 66, y, 470, font, 8, BLACK, 9, 1);
    y -= 10;
    if (hotel.details) {
      drawWrapped(page, hotel.details, 66, y, 470, font, 6.8, GREY, 8, 1);
      y -= 8;
    }
  }
  y -= 6;

  y = section("PARTICIPANTS", y);
  const participantRows = participants.slice(0, 12);
  participantRows.forEach((p, idx) => {
    const col = idx % 2;
    const rowIdx = Math.floor(idx / 2);
    const x = col === 0 ? 48 : 302;
    const rowY = y - rowIdx * 14;
    text(page, `${idx + 1}. ${p.name}`, x, rowY, font, 7.6, BLACK);
    text(page, `Passport: ${p.passport}`, x + 132, rowY, font, 7.2, GREY);
  });
  if (participants.length > participantRows.length) {
    text(page, `+ ${participants.length - participantRows.length} participants supplementaires`, 48, y - Math.ceil(participantRows.length / 2) * 14, font, 7, GREY);
  }
  y -= Math.max(28, Math.ceil(participantRows.length / 2) * 14 + 12);

  const closing = "This document is issued based on the information available in our reservation file. Final entry permission remains subject to the decision of the competent authorities and the traveller's compliance with all applicable requirements.";
  drawWrapped(page, closing, 40, Math.max(y, 138), 330, font, 7.2, GREY, 8.5, 3);

  const sigY = 112;
  if (stamp) drawImageContain(page, stamp, { x: 388, y: sigY + 15, width: 130, height: 58, padding: 2 });
  text(page, "Signature", 394, sigY + 5, bold, 8, BLACK);
  page.drawRectangle({ x: 394, y: sigY - 3, width: 135, height: 0.6, color: BLACK });
  text(page, agency.manager_name || agency.legal_company_name, 394, sigY - 16, font, 7.5, GREY);
  if (agency.manager_title) text(page, agency.manager_title, 394, sigY - 26, font, 7, GREY);

  page.drawRectangle({ x: 40, y: 58, width: 515, height: 0.6, color: BORDER });
  text(page, `${agency.legal_company_name} / ${agency.brand_name}`, 40, 42, font, 7, GREY);
  text(page, `${agencyAddressLine(agency)} · ${agencyIceLine(agency)}`, 40, 32, font, 7, GREY);
  text(page, `${agency.email} · ${agency.phone}${agency.website ? ` · ${agency.website}` : ""}`, 40, 22, font, 7, GREY);

  return pdf.save();
}
