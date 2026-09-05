/* eslint-disable @typescript-eslint/no-explicit-any */
import { PDFDocument, PDFPage, PDFFont, StandardFonts, rgb } from "pdf-lib";
import logoUrl from "@/assets/logo-moroccan-express.png";
import stampUrl from "@/assets/stamp-moroccan-express.png";
import { agencyAddressLine, agencyIceLine, normalizeAgencySettings, type AgencySettings } from "@/lib/agency-settings";
import { sanitizePdfText } from "@/lib/booking-pdfs";
import { sanitizeFilenamePart } from "@/admin/lib/flight-tickets";

export type VisaSubmissionPdfTrip = {
  title?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

export type VisaSubmissionApplicant = {
  id: string;
  officialName: string;
  passportNo: string;
  visaReference?: string | null;
  bookingReference?: string | null;
  visaStatus?: string | null;
  submissionStatus?: string | null;
  lastSubmissionReference?: string | null;
  selected?: boolean;
  warnings?: string[];
  internalNotes?: string | null;
};

export type VisaSubmissionPdfContext = {
  batchReference: string;
  submissionDate: string;
  preparedByName?: string | null;
  trip: VisaSubmissionPdfTrip;
  applicants: VisaSubmissionApplicant[];
  agency?: Partial<AgencySettings> | null;
};

const BLACK = rgb(0.08, 0.08, 0.08);
const GREY = rgb(0.42, 0.42, 0.42);
const LIGHT_GREY = rgb(0.93, 0.94, 0.96);
const SOFT_GREY = rgb(0.62, 0.64, 0.68);
const BORDER = rgb(0.82, 0.84, 0.87);
const RED = rgb(0.72, 0.04, 0.08);
const FOOTER_Y = 48;
const TOP_Y = 810;
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const clean = (value: unknown) => sanitizePdfText(value ?? "").trim();

export const parseCivilDateForVisaSubmission = (value?: string | null) => {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
};

export const formatVisaSubmissionDate = (value?: string | null) => {
  const parsed = parseCivilDateForVisaSubmission(value);
  if (!parsed) return "";
  return `${String(parsed.day).padStart(2, "0")} ${MONTHS_SHORT[parsed.month - 1]} ${parsed.year}`;
};

export const visaSubmissionFilename = (tripTitle: string, submissionDate: string, reference: string) =>
  `Visa_Submission_List_${sanitizeFilenamePart(tripTitle)}_${sanitizeFilenamePart(submissionDate)}_${sanitizeFilenamePart(reference)}.pdf`;

export const visaSubmissionInternalFilename = (tripTitle: string, submissionDate: string) =>
  `Visa_Submission_Internal_List_${sanitizeFilenamePart(tripTitle)}_${sanitizeFilenamePart(submissionDate)}.pdf`;

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

async function addHeaderFooter(
  pdf: PDFDocument,
  page: PDFPage,
  title: string,
  context: VisaSubmissionPdfContext,
  agency: AgencySettings,
  font: PDFFont,
  bold: PDFFont,
  pageIndex: number,
  pageCount: number,
) {
  const logo = await embedImage(pdf, agency.logo_url || logoUrl);
  if (logo) drawImageContain(page, logo, { x: 40, y: 784, width: 118, height: 38 });
  else drawText(page, agency.brand_name || "LeJapon.ma", 40, 806, bold, 11);
  drawText(page, title, 188, 812, bold, 14, RED);
  drawText(page, `Reference: ${context.batchReference}`, 188, 794, font, 8, GREY);
  page.drawRectangle({ x: 40, y: 772, width: 515, height: 1.1, color: RED });
  page.drawRectangle({ x: 40, y: FOOTER_Y + 10, width: 515, height: 0.6, color: BORDER });
  drawText(page, `${agency.legal_company_name} / ${agency.brand_name}`, 40, 42, font, 7.2, GREY);
  drawText(page, `${agencyAddressLine(agency)} · ${agencyIceLine(agency)}`, 40, 32, font, 7.2, GREY);
  drawText(page, `${agency.email} · ${agency.phone}${agency.website ? ` · ${agency.website}` : ""}`, 40, 22, font, 7.2, GREY);
  drawText(page, `Page ${pageIndex} / ${pageCount}`, 506, 22, font, 7.2, GREY);
}

function drawSummary(page: PDFPage, context: VisaSubmissionPdfContext, y: number, font: PDFFont, bold: PDFFont, submittedTodayCount: number) {
  const totalPassengers = context.applicants.length;
  page.drawRectangle({ x: 40, y: y - 74, width: 515, height: 74, borderColor: BORDER, borderWidth: 0.6, color: LIGHT_GREY });
  drawText(page, "Trip", 52, y - 16, font, 7.5, GREY);
  drawWrapped(page, context.trip.title || "Trip not specified", 52, y - 31, 220, bold, 9, BLACK, 10);
  drawText(page, "Trip dates", 292, y - 16, font, 7.5, GREY);
  drawText(page, [formatVisaSubmissionDate(context.trip.start_date), formatVisaSubmissionDate(context.trip.end_date)].filter(Boolean).join(" - "), 292, y - 31, bold, 9);
  drawText(page, "Submission date", 52, y - 53, font, 7.5, GREY);
  drawText(page, formatVisaSubmissionDate(context.submissionDate), 148, y - 53, bold, 9);
  drawText(page, "Total passengers", 292, y - 53, font, 7.5, GREY);
  drawText(page, String(totalPassengers), 390, y - 53, bold, 9);
  drawText(page, "Submitted today", 430, y - 53, font, 7.5, GREY);
  drawText(page, String(submittedTodayCount), 522, y - 53, bold, 9);
  return y - 92;
}

function officialTableHeader(page: PDFPage, y: number, bold: PDFFont) {
  page.drawRectangle({ x: 40, y: y - 23, width: 515, height: 23, color: rgb(0.12, 0.14, 0.18) });
  drawText(page, "No.", 50, y - 15, bold, 8, rgb(1, 1, 1));
  drawText(page, "Full name as shown on passport", 84, y - 15, bold, 8, rgb(1, 1, 1));
  drawText(page, "Passport No.", 330, y - 15, bold, 8, rgb(1, 1, 1));
  drawText(page, "Submission status", 428, y - 15, bold, 8, rgb(1, 1, 1));
  return y - 23;
}

function internalTableHeader(page: PDFPage, y: number, bold: PDFFont) {
  page.drawRectangle({ x: 40, y: y - 23, width: 515, height: 23, color: rgb(0.12, 0.14, 0.18) });
  drawText(page, "Included", 48, y - 15, bold, 7.4, rgb(1, 1, 1));
  drawText(page, "Name / Passport", 100, y - 15, bold, 7.4, rgb(1, 1, 1));
  drawText(page, "Visa status", 300, y - 15, bold, 7.4, rgb(1, 1, 1));
  drawText(page, "Last submission", 390, y - 15, bold, 7.4, rgb(1, 1, 1));
  drawText(page, "Alerts", 486, y - 15, bold, 7.4, rgb(1, 1, 1));
  return y - 23;
}

export async function generateVisaGroupSubmissionOfficialPdf(context: VisaSubmissionPdfContext) {
  const agency = normalizeAgencySettings(context.agency ?? {});
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const stamp = await embedImage(pdf, agency.stamp_signature_url || stampUrl);
  const pages: PDFPage[] = [];
  const addPage = () => {
    const page = pdf.addPage([595.28, 841.89]);
    pages.push(page);
    return page;
  };

  const applicants = context.applicants;
  const submittedTodayCount = applicants.filter((row) => row.selected).length;
  let page = addPage();
  let y = TOP_Y - 60;
  y = drawSummary(page, context, y, font, bold, submittedTodayCount);
  drawText(page, "Legend:", 52, y + 10, bold, 7.8, BLACK);
  drawText(page, "Bold black text = applications included in the present submission.", 96, y + 10, font, 7.8, BLACK);
  drawText(page, "Grey text = passengers not included in the present submission.", 96, y - 1, font, 7.8, GREY);
  y -= 14;
  y = officialTableHeader(page, y, bold);

  applicants.forEach((applicant, index) => {
    const nameLines = wrap(applicant.officialName, applicant.selected ? bold : font, 8.4, 226);
    const statusLines = wrap(applicant.submissionStatus || (applicant.selected ? "Submitted today" : "Not included in this submission"), font, 7.7, 112);
    const rowHeight = Math.max(29, Math.max(nameLines.length * 10, statusLines.length * 9) + 13);
    if (y - rowHeight < 155) {
      page = addPage();
      y = TOP_Y - 64;
      y = officialTableHeader(page, y, bold);
    }
    const color = applicant.selected ? BLACK : SOFT_GREY;
    page.drawRectangle({
      x: 40,
      y: y - rowHeight,
      width: 515,
      height: rowHeight,
      borderColor: BORDER,
      borderWidth: 0.45,
      color: applicant.selected ? rgb(1, 1, 1) : rgb(0.975, 0.975, 0.975),
    });
    drawText(page, String(index + 1), 50, y - 16, font, 8, color);
    drawWrapped(page, applicant.officialName, 84, y - 13, 226, applicant.selected ? bold : font, 8.4, color, 10);
    drawWrapped(page, applicant.passportNo || "Not provided", 330, y - 13, 76, font, 8, color, 9);
    drawWrapped(page, applicant.submissionStatus || (applicant.selected ? "Submitted today" : "Not included in this submission"), 428, y - 13, 112, applicant.selected ? bold : font, 7.7, color, 9);
    y -= rowHeight;
  });

  if (y < 230) {
    page = addPage();
    y = TOP_Y - 64;
  } else {
    y -= 24;
  }

  const statement = "Moroccan Express Travel & Events confirms that the passengers listed in bold are included in the present group visa submission. Other passengers are listed for group reference according to their submission status.";
  drawWrapped(page, statement, 40, y, 390, font, 8.8, BLACK, 11);
  y -= 58;
  drawText(page, `Prepared by: ${context.preparedByName || "Moroccan Express Travel & Events"}`, 40, y, font, 8, GREY);
  if (stamp) {
    drawImageContain(page, stamp, { x: 405, y: 108, width: 118, height: 90, opacity: 0.88 });
    drawText(page, "Authorized signature and stamp", 405, 98, font, 7.5, GREY);
  }

  for (let i = 0; i < pages.length; i += 1) {
    await addHeaderFooter(pdf, pages[i], "PASSENGER LIST - GROUP VISA SUBMISSION", context, agency, font, bold, i + 1, pages.length);
  }
  return await pdf.save();
}

export async function generateVisaGroupSubmissionInternalPdf(context: VisaSubmissionPdfContext) {
  const agency = normalizeAgencySettings(context.agency ?? {});
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages: PDFPage[] = [];
  const addPage = () => {
    const page = pdf.addPage([595.28, 841.89]);
    pages.push(page);
    return page;
  };

  let page = addPage();
  let y = TOP_Y - 60;
  drawText(page, "INTERNAL USE ONLY - NOT FOR EMBASSY SUBMISSION", 40, y, bold, 11, RED);
  y -= 24;
  y = drawSummary(page, context, y, font, bold, context.applicants.filter((row) => row.selected).length);
  y = internalTableHeader(page, y, bold);

  context.applicants.forEach((applicant) => {
    const color = applicant.selected ? BLACK : SOFT_GREY;
    const rowHeight = Math.max(32, wrap(applicant.officialName, bold, 8, 180).length * 10 + 18);
    if (y - rowHeight < 80) {
      page = addPage();
      y = TOP_Y - 64;
      y = internalTableHeader(page, y, bold);
    }
    page.drawRectangle({ x: 40, y: y - rowHeight, width: 515, height: rowHeight, borderColor: BORDER, borderWidth: 0.45, color: applicant.selected ? rgb(1, 1, 1) : rgb(0.97, 0.97, 0.97) });
    drawText(page, applicant.selected ? "YES" : "-", 52, y - 16, bold, 8, color);
    drawWrapped(page, `${applicant.officialName} · ${applicant.passportNo || "Passport missing"}`, 100, y - 12, 180, applicant.selected ? bold : font, 8, color, 10);
    drawWrapped(page, applicant.visaStatus || "-", 300, y - 12, 80, font, 7.5, color, 9);
    drawWrapped(page, applicant.lastSubmissionReference || "-", 390, y - 12, 86, font, 7.5, color, 9);
    drawWrapped(page, (applicant.warnings ?? []).join("; "), 486, y - 12, 60, font, 7, color, 8);
    y -= rowHeight;
  });

  for (let i = 0; i < pages.length; i += 1) {
    await addHeaderFooter(pdf, pages[i], "VISA GROUP SUBMISSION - INTERNAL TRACKING", context, agency, font, bold, i + 1, pages.length);
  }
  return await pdf.save();
}
