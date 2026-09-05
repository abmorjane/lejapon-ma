/* eslint-disable @typescript-eslint/no-explicit-any */
import { PDFDocument, PDFPage, PDFFont, StandardFonts, rgb } from "pdf-lib";
import logoUrl from "@/assets/logo-moroccan-express.png";
import stampUrl from "@/assets/stamp-moroccan-express.png";
import { sanitizePdfText } from "@/lib/booking-pdfs";
import { agencyAddressLine, agencyIceLine, normalizeAgencySettings, type AgencySettings } from "@/lib/agency-settings";
import { participantFullName, sanitizeFilenamePart } from "@/admin/lib/flight-tickets";

export const VISA_HOTEL_CONFIRMATION_DOCUMENT_TYPE = "hotel_reservation_confirmation";
export const HOTEL_GROUP_RESERVATION_NAME = "団体LEJAPON";

export type HotelConfirmationGuest = {
  participantId: string;
  name: string;
  roomNo?: string | null;
  roomType?: string | null;
  board?: string | null;
  adults?: number;
  children?: number;
  isVisaApplicant?: boolean;
  passportNo?: string | null;
};

export type HotelConfirmationRoom = {
  roomId: string;
  roomNo: string;
  roomType?: string | null;
  board?: string | null;
  guests: HotelConfirmationGuest[];
  adults: number;
  children: number;
};

export type HotelConfirmationDraft = {
  documentReference: string;
  groupReservationReference: string;
  groupReservationName: string;
  issueDate: string;
  reservationStatus: string;
  hotelName: string;
  hotelAddress: string;
  hotelCity?: string | null;
  hotelPrefecture?: string | null;
  hotelPhone: string;
  hotelEmail?: string | null;
  hotelWebsite?: string | null;
  japanesePartner?: string | null;
  japanesePartnerAddress?: string | null;
  japanesePartnerPhone?: string | null;
  supplierReference?: string | null;
  checkIn: string;
  checkOut: string;
  nights: number;
  numberOfRooms?: number | null;
  roomTypes?: string | null;
  mealPlan?: string | null;
  paymentStatus?: string | null;
  applicantParticipantId: string;
  applicantName: string;
  bookingReference?: string | null;
  tripTitle?: string | null;
  guests: HotelConfirmationGuest[];
  rooms?: HotelConfirmationRoom[];
  roomingMissing?: boolean;
  agency?: Partial<AgencySettings> | null;
};

const BLACK = rgb(0.08, 0.08, 0.08);
const GREY = rgb(0.42, 0.42, 0.42);
const LIGHT = rgb(0.96, 0.97, 0.98);
const BORDER = rgb(0.82, 0.84, 0.87);
const RED = rgb(0.72, 0.04, 0.08);
const FOOTER_Y = 48;
const TOP_Y = 810;

const clean = (value: unknown, fallback = "") => sanitizePdfText(value ?? fallback).trim();
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const isoToday = () => new Date().toISOString().slice(0, 10);

export const parseCivilDate = (value?: string | null) => {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
};

export const dateOnlyTime = (value?: string | null) => {
  const parsed = parseCivilDate(value);
  if (!parsed) return null;
  return Date.UTC(parsed.year, parsed.month - 1, parsed.day);
};

export const nightsBetween = (checkIn?: string | null, checkOut?: string | null) => {
  const start = dateOnlyTime(checkIn);
  const end = dateOnlyTime(checkOut);
  if (start === null || end === null || end <= start) return 0;
  return Math.round((end - start) / 86400000);
};

export const formatEnglishDate = (value?: string | null) => {
  const parsed = parseCivilDate(value);
  if (!parsed) return "";
  return `${String(parsed.day).padStart(2, "0")} ${MONTHS_SHORT[parsed.month - 1]} ${parsed.year}`;
};

export const isHotelProvisional = (hotel: any) => {
  const text = [hotel?.name, hotel?.notes, hotel?.metadata?.status, hotel?.confirmation_status].filter(Boolean).join(" ").toLowerCase();
  return /similar|similaire|provisoire|tbc|to be confirmed|pending/.test(text);
};

export const hotelReservationStatusLabel = (status: string) => {
  switch (status) {
    case "draft":
      return "Pending confirmation";
    case "cancelled":
      return "Cancelled";
    case "replaced":
      return "Hotel replaced";
    case "confirmed":
    default:
      return "Confirmed";
  }
};

const stableTripReferencePart = (trip: any, length = 6) => {
  const fromId = String(trip?.id ?? "").replace(/[^a-fA-F0-9]/g, "").toUpperCase();
  if (fromId) return `T${fromId.slice(0, Math.max(4, length))}`;
  const fromSlug = String(trip?.slug ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
  return `T${(fromSlug || "TRIP").slice(0, Math.max(4, length))}`;
};

export const buildHotelGroupReference = (trip: any, hotel: any, index: number, tripCodeLength = 6) => {
  const time = dateOnlyTime(trip?.start_date ?? hotel?.check_in);
  const month = time === null
    ? "TRIP"
    : new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(new Date(time)).toUpperCase();
  const year = time === null ? "" : new Intl.DateTimeFormat("en-US", { year: "2-digit", timeZone: "UTC" }).format(new Date(time));
  return `LJ-${month}${year}-${stableTripReferencePart(trip, tripCodeLength)}-H${String(index + 1).padStart(2, "0")}`;
};

export const buildHotelDocumentReference = (groupReference: string, visaApplicationId: string, hotelId: string) => {
  const stable = `${visaApplicationId}-${hotelId}`.replace(/-/g, "").slice(0, 6).toUpperCase();
  return `${groupReference}-VISA-${stable}`;
};

export const hotelConfirmationDataHash = (draft: HotelConfirmationDraft) => {
  const stable = JSON.stringify({
    documentReference: draft.documentReference,
    groupReservationReference: draft.groupReservationReference,
    hotelName: draft.hotelName,
    hotelAddress: draft.hotelAddress,
    hotelPhone: draft.hotelPhone,
    checkIn: draft.checkIn,
    checkOut: draft.checkOut,
    reservationStatus: draft.reservationStatus,
    rooms: getHotelConfirmationRooms(draft).map((room) => ({
      roomId: room.roomId,
      roomNo: room.roomNo,
      roomType: room.roomType ?? null,
      board: room.board ?? null,
      adults: room.adults,
      children: room.children,
      guests: room.guests.map((guest) => ({
        participantId: guest.participantId,
        name: guest.name,
        isVisaApplicant: Boolean(guest.isVisaApplicant),
      })),
    })),
  });
  let hash = 0;
  for (let i = 0; i < stable.length; i += 1) {
    hash = (hash << 5) - hash + stable.charCodeAt(i);
    hash |= 0;
  }
  return `h${Math.abs(hash).toString(36)}`;
};

export const sanitizeHotelReservationFilename = (draft: HotelConfirmationDraft) =>
  `Reservation_Hotel_${sanitizeFilenamePart(draft.hotelName)}_${sanitizeFilenamePart(draft.checkIn)}_${sanitizeFilenamePart(draft.applicantName)}.pdf`;

export const sanitizeHotelReservationsZipFilename = (participantName: string, tripTitle: string) =>
  `Reservations_Hotels_${sanitizeFilenamePart(participantName)}_${sanitizeFilenamePart(tripTitle)}.zip`;

export const validateHotelConfirmationDraft = (draft: HotelConfirmationDraft) => {
  const errors: string[] = [];
  if (!draft.documentReference) errors.push("Référence du document manquante.");
  if (!draft.groupReservationReference) errors.push("La réservation de groupe n’a pas encore de référence.");
  if (!draft.applicantParticipantId) errors.push("Participant du dossier visa non relié.");
  if (!draft.hotelName) errors.push("Nom de l’hôtel manquant.");
  if (!draft.hotelAddress) errors.push(`Adresse manquante pour ${draft.hotelName || "cet hôtel"}.`);
  if (!draft.hotelPhone) errors.push(`Téléphone manquant pour ${draft.hotelName || "cet hôtel"}.`);
  if (!draft.checkIn) errors.push(`Date de check-in manquante pour ${draft.hotelName || "cet hôtel"}.`);
  if (!draft.checkOut) errors.push(`Date de check-out manquante pour ${draft.hotelName || "cet hôtel"}.`);
  if (draft.checkIn && draft.checkOut && nightsBetween(draft.checkIn, draft.checkOut) <= 0) {
    errors.push(`Le check-out doit être postérieur au check-in pour ${draft.hotelName || "cet hôtel"}.`);
  }
  if (!draft.guests.length) errors.push("Aucun participant actif n’a été retrouvé pour ce séjour.");
  if (!draft.guests.some((guest) => guest.participantId === draft.applicantParticipantId)) {
    errors.push("Le participant du dossier visa n’est pas associé à cet hôtel.");
  }
  if (draft.reservationStatus !== "confirmed") {
    errors.push(`La réservation hôtel n'est pas confirmée pour ${draft.hotelName || "cet hôtel"}.`);
  }
  if (!draft.agency?.legal_company_name && !draft.agency?.brand_name) errors.push("Nom de l’agence manquant.");
  if (!draft.agency?.email && !draft.agency?.phone) errors.push("Contact de vérification agence manquant.");
  return errors;
};

export const normalizeGuestNameForPdf = (value: unknown) =>
  clean(value)
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

export const buildHotelConfirmationRoom = (
  roomId: string,
  roomNo: string,
  room: any,
  guests: HotelConfirmationGuest[],
): HotelConfirmationRoom => ({
  roomId,
  roomNo,
  roomType: room?.room_type ?? null,
  board: room?.board_basis ?? room?.meal_plan ?? room?.notes ?? null,
  guests,
  adults: guests.reduce((sum, guest) => sum + (Number(guest.adults ?? 0) || 0), 0),
  children: guests.reduce((sum, guest) => sum + (Number(guest.children ?? 0) || 0), 0),
});

export const getHotelConfirmationRooms = (draft: HotelConfirmationDraft): HotelConfirmationRoom[] => {
  if (draft.rooms?.length) return draft.rooms;
  const byRoom = new Map<string, HotelConfirmationRoom>();
  for (const guest of draft.guests) {
    const roomId = guest.roomNo || "group-allocation";
    const existing = byRoom.get(roomId);
    if (existing) {
      existing.guests.push(guest);
      existing.adults += Number(guest.adults ?? 0) || 0;
      existing.children += Number(guest.children ?? 0) || 0;
    } else {
      byRoom.set(roomId, {
        roomId,
        roomNo: guest.roomNo || "Group allocation pending",
        roomType: guest.roomType ?? null,
        board: guest.board ?? null,
        guests: [guest],
        adults: Number(guest.adults ?? 0) || 0,
        children: Number(guest.children ?? 0) || 0,
      });
    }
  }
  return Array.from(byRoom.values());
};

async function embedImage(pdf: PDFDocument, url?: string | null) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("jpeg") || /\.jpe?g($|\?)/i.test(url)) return await pdf.embedJpg(bytes);
    return await pdf.embedPng(bytes);
  } catch {
    return null;
  }
}

async function groupNameImage(pdf: PDFDocument, value: string) {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  try {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="60"><rect width="360" height="60" fill="white" fill-opacity="0"/><text x="0" y="42" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" fill="#111827">${value}</text></svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const image = new Image();
    const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = reject;
    });
    image.src = url;
    const img = await loaded;
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return null;
    return await pdf.embedPng(new Uint8Array(await blob.arrayBuffer()));
  } catch {
    return null;
  }
}

function drawText(page: PDFPage, value: unknown, x: number, y: number, font: PDFFont, size = 9, color = BLACK) {
  page.drawText(clean(value), { x, y, font, size, color });
}

function wrap(value: unknown, font: PDFFont, size: number, maxWidth: number) {
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

function drawWrapped(page: PDFPage, value: unknown, x: number, y: number, width: number, font: PDFFont, size = 8.5, color = BLACK, lineHeight = 11) {
  const lines = wrap(value, font, size, width);
  lines.forEach((line, index) => drawText(page, line, x, y - index * lineHeight, font, size, color));
  return Math.max(lineHeight, lines.length * lineHeight);
}

function drawImageContain(page: PDFPage, image: any, box: { x: number; y: number; width: number; height: number; opacity?: number }) {
  const ratio = image.width / image.height;
  let width = box.width;
  let height = width / ratio;
  if (height > box.height) {
    height = box.height;
    width = height * ratio;
  }
  page.drawImage(image, {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
    opacity: box.opacity,
  });
}

function field(page: PDFPage, label: string, value: unknown, x: number, y: number, width: number, font: PDFFont, bold: PDFFont) {
  page.drawRectangle({ x, y: y - 39, width, height: 39, borderColor: BORDER, borderWidth: 0.6, color: LIGHT });
  drawText(page, label, x + 8, y - 13, font, 7.2, GREY);
  drawWrapped(page, value, x + 8, y - 27, width - 16, bold, 8.5, BLACK, 10);
}

function drawCompactPanel(
  page: PDFPage,
  title: string,
  lines: string[],
  x: number,
  y: number,
  width: number,
  height: number,
  font: PDFFont,
  bold: PDFFont,
) {
  page.drawRectangle({ x, y: y - height, width, height, borderColor: BORDER, borderWidth: 0.6, color: LIGHT });
  drawText(page, title, x + 9, y - 13, bold, 8.5, RED);
  let cursor = y - 28;
  for (const line of lines.filter(Boolean)) {
    const used = drawWrapped(page, line, x + 9, cursor, width - 18, font, 8, BLACK, 9.5);
    cursor -= used;
    if (cursor < y - height + 10) break;
  }
}

async function addHeaderFooter(
  pdf: PDFDocument,
  page: PDFPage,
  draft: HotelConfirmationDraft,
  agency: AgencySettings,
  font: PDFFont,
  bold: PDFFont,
  pageIndex: number,
  pageCount: number,
) {
  const logo = await embedImage(pdf, agency.logo_url || logoUrl);
  if (logo) drawImageContain(page, logo, { x: 40, y: 784, width: 118, height: 38 });
  else drawText(page, agency.legal_company_name, 40, 806, bold, 11);
  drawText(page, "HOTEL RESERVATION CONFIRMATION", 198, 812, bold, 16, RED);
  drawText(page, `Document reference: ${draft.documentReference}`, 198, 794, font, 8, GREY);
  page.drawRectangle({ x: 40, y: 772, width: 515, height: 1.1, color: RED });

  page.drawRectangle({ x: 40, y: FOOTER_Y + 10, width: 515, height: 0.6, color: BORDER });
  drawText(page, `${agency.legal_company_name} / ${agency.brand_name}`, 40, 42, font, 7.2, GREY);
  drawText(page, `${agencyAddressLine(agency)} · ${agencyIceLine(agency)}`, 40, 32, font, 7.2, GREY);
  drawText(page, `${agency.email} · ${agency.phone}${agency.website ? ` · ${agency.website}` : ""}`, 40, 22, font, 7.2, GREY);
  drawText(page, `Page ${pageIndex} / ${pageCount}`, 506, 22, font, 7.2, GREY);
}

function tableHeader(page: PDFPage, y: number, bold: PDFFont) {
  page.drawRectangle({ x: 40, y: y - 22, width: 515, height: 22, color: rgb(0.12, 0.14, 0.18) });
  drawText(page, "Room No.", 47, y - 14, bold, 7.8, rgb(1, 1, 1));
  drawText(page, "Room Type / Board", 112, y - 14, bold, 7.8, rgb(1, 1, 1));
  drawText(page, "Guest Names", 260, y - 14, bold, 7.8, rgb(1, 1, 1));
  drawText(page, "Adults", 468, y - 14, bold, 7.8, rgb(1, 1, 1));
  drawText(page, "Children", 512, y - 14, bold, 7.8, rgb(1, 1, 1));
  return y - 22;
}

function roomRowHeight(room: HotelConfirmationRoom, font: PDFFont, bold: PDFFont) {
  const guestLines = room.guests.flatMap((guest) => {
    const nameFont = guest.isVisaApplicant ? bold : font;
    const name = `${guest.name}${guest.isVisaApplicant ? " - Visa applicant" : ""}`;
    const lineCount = wrap(name, nameFont, 8.4, 190).length;
    return Array.from({ length: lineCount + (guest.isVisaApplicant && guest.passportNo ? 1 : 0) });
  }).length;
  return Math.max(31, guestLines * 10 + 11);
}

function drawRoomRow(page: PDFPage, room: HotelConfirmationRoom, y: number, height: number, font: PDFFont, bold: PDFFont) {
  const bg = room.guests.some((guest) => guest.isVisaApplicant) ? rgb(0.91, 0.93, 0.96) : rgb(1, 1, 1);
  page.drawRectangle({ x: 40, y: y - height, width: 515, height, color: bg, borderColor: BORDER, borderWidth: 0.45 });
  drawWrapped(page, room.roomNo || "Group allocation pending", 47, y - 12, 54, font, 7.8, BLACK, 9);
  drawWrapped(page, [room.roomType, room.board].filter(Boolean).join(" - ") || "Group allocation pending", 112, y - 12, 136, font, 7.8, BLACK, 9);
  let guestY = y - 12;
  for (const guest of room.guests) {
    const name = `${guest.name}${guest.isVisaApplicant ? " - Visa applicant" : ""}`;
    const used = drawWrapped(page, name, 260, guestY, 190, guest.isVisaApplicant ? bold : font, 8.4, BLACK, 9.8);
    guestY -= used;
    if (guest.isVisaApplicant && guest.passportNo) {
      drawText(page, `Passport: ${guest.passportNo}`, 260, guestY + 1, font, 7, GREY);
      guestY -= 10;
    }
  }
  drawText(page, String(room.adults), 476, y - 17, font, 8, BLACK);
  drawText(page, String(room.children), 526, y - 17, font, 8, BLACK);
}

export async function generateHotelReservationConfirmationPdf(draft: HotelConfirmationDraft) {
  const agency = normalizeAgencySettings(draft.agency ?? {});
  const rooms = getHotelConfirmationRooms(draft);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages: PDFPage[] = [];
  const stamp = await embedImage(pdf, agency.stamp_signature_url || stampUrl);
  const groupName = await groupNameImage(pdf, draft.groupReservationName || HOTEL_GROUP_RESERVATION_NAME);

  const addPage = () => {
    const page = pdf.addPage([595.28, 841.89]);
    pages.push(page);
    return page;
  };

  let page = addPage();
  let y = TOP_Y - 58;
  drawText(page, "Issued by Moroccan Express Travel & Events based on a confirmed group reservation in Japan.", 40, y, bold, 9.2);
  y -= 22;
  field(page, "Group reservation reference", draft.groupReservationReference, 40, y, 160, font, bold);
  field(page, "Group reservation name", "", 210, y, 150, font, bold);
  if (groupName) {
    drawImageContain(page, groupName, { x: 218, y: y - 34, width: 128, height: 22 });
  } else {
    drawText(page, "Japanese group reservation name", 218, y - 27, bold, 8.5);
  }
  field(page, "Issue date", formatEnglishDate(draft.issueDate), 370, y, 88, font, bold);
  field(page, "Reservation status", hotelReservationStatusLabel(draft.reservationStatus), 466, y, 89, font, bold);
  y -= 54;

  const hotelLines = [
    draft.hotelName,
    [draft.hotelAddress, [draft.hotelCity, draft.hotelPrefecture].filter(Boolean).join(" / ")].filter(Boolean).join(" · "),
    draft.hotelPhone ? `Tel. ${draft.hotelPhone}` : "",
    [draft.hotelEmail, draft.hotelWebsite].filter(Boolean).join(" · "),
  ];
  const roomSummary = [
    draft.numberOfRooms ? `${draft.numberOfRooms} room${draft.numberOfRooms > 1 ? "s" : ""}` : "",
    draft.roomTypes || "",
  ].filter(Boolean).join(" · ");
  const stayLines = [
    `${formatEnglishDate(draft.checkIn)} - ${formatEnglishDate(draft.checkOut)} · ${draft.nights} night${draft.nights > 1 ? "s" : ""}`,
    roomSummary,
    "Reservation name:",
    draft.mealPlan ? `Meal plan: ${draft.mealPlan}` : "",
    draft.supplierReference ? `Hotel / supplier confirmation reference: ${draft.supplierReference}` : "",
    draft.paymentStatus ? `Payment status: ${draft.paymentStatus}` : "",
  ];
  drawCompactPanel(page, "Hotel", hotelLines, 40, y, 250, 86, font, bold);
  drawCompactPanel(page, "Stay", stayLines, 305, y, 250, 86, font, bold);
  if (groupName) drawImageContain(page, groupName, { x: 398, y: y - 54, width: 104, height: 20 });
  y -= 102;

  if (draft.japanesePartner) {
    const partnerLines = [
      `Japanese booking partner: ${draft.japanesePartner}`,
      draft.japanesePartnerAddress || "",
      draft.japanesePartnerPhone ? `Tel. ${draft.japanesePartnerPhone}` : "",
    ];
    drawCompactPanel(page, "Japanese booking partner", partnerLines, 40, y, 515, 45, font, bold);
    y -= 59;
  }

  drawText(page, "Guests", 40, y, bold, 12, RED);
  if (draft.roomingMissing) drawText(page, "Rooming list missing: group allocation pending.", 94, y, font, 8.2, GREY);
  y -= 12;
  y = tableHeader(page, y, bold);

  for (const room of rooms) {
    const rowHeight = roomRowHeight(room, font, bold);
    if (y - rowHeight < 112) {
      page = addPage();
      y = TOP_Y - 64;
      drawText(page, "Guests", 40, y, bold, 12, RED);
      y -= 12;
      y = tableHeader(page, y, bold);
    }
    drawRoomRow(page, room, y, rowHeight, font, bold);
    y -= rowHeight;
  }

  if (y < 215) {
    page = addPage();
    y = TOP_Y - 64;
  } else {
    y -= 22;
  }

  drawText(page, "Confirmation statement", 40, y, bold, 12, RED);
  y -= 17;
  const statement = draft.japanesePartner
    ? `Moroccan Express Travel & Events confirms that the guests listed above are included in the confirmed group accommodation reservation held under the reservation name shown above.\n\nThe reservation details are based on the confirmed records held by Moroccan Express Travel & Events and its Japanese booking partner.`
    : `Moroccan Express Travel & Events confirms that the guests listed above are included in the group accommodation reservation held under the reservation name shown above.\n\nThis document is issued for visa application and administrative purposes.`;
  for (const paragraph of statement.split("\n\n")) {
    const used = drawWrapped(page, paragraph, 40, y, 360, font, 8.7, BLACK, 11);
    y -= used + 8;
  }

  if (draft.bookingReference || draft.tripTitle) {
    drawWrapped(page, `Booking reference: ${draft.bookingReference || "-"} · Trip: ${draft.tripTitle || "-"}`, 40, y, 360, font, 8, GREY, 10);
  }

  if (stamp) {
    drawImageContain(page, stamp, { x: 405, y: 112, width: 118, height: 90, opacity: 0.88 });
    drawText(page, "Authorized signature and stamp", 405, 101, font, 7.5, GREY);
  }

  for (let i = 0; i < pages.length; i += 1) {
    await addHeaderFooter(pdf, pages[i], draft, agency, font, bold, i + 1, pages.length);
  }

  return await pdf.save();
}

export function buildGuestFromParticipant(participant: any, applicantParticipantId: string, room?: any | null): HotelConfirmationGuest {
  const type = String(participant.client_type ?? "").toLowerCase();
  const isChild = /child|enfant|infant|baby|bebe|bébé/.test(type);
  return {
    participantId: participant.id,
    name: normalizeGuestNameForPdf(participantFullName(participant)),
    roomNo: room?.room_number ?? null,
    roomType: room?.room_type ?? participant.room_type ?? null,
    board: room?.board_basis ?? room?.meal_plan ?? participant.board_basis ?? null,
    adults: isChild ? 0 : 1,
    children: isChild ? 1 : 0,
    isVisaApplicant: participant.id === applicantParticipantId,
    passportNo: participant.id === applicantParticipantId ? participant.passport_no ?? null : null,
  };
}
