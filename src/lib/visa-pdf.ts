import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  cleanVisaText,
  formatPreviousJapanStayForDisplay,
  formatVisaDate,
  isRetiredVisaCategory,
  parsePreviousJapanStay,
  PDF_NOT_APPLICABLE,
} from "@/lib/visa-format";

/** Pen-blue ink color used to mimic a hand-filled form. */
const PEN_BLUE = rgb(0.07, 0.13, 0.55);

export type VisaApplicationData = {
  // Identity
  category?: string | null;
  surname?: string | null;
  given_names?: string | null;
  other_names?: string | null;
  date_of_birth?: string | null;
  place_of_birth_city?: string | null;
  place_of_birth_state?: string | null;
  place_of_birth_country?: string | null;
  sex?: string | null;
  marital_status?: string | null;
  nationality?: string | null;
  former_nationality?: string | null;
  national_id_no?: string | null;
  // Passport
  passport_type?: string | null;
  passport_no?: string | null;
  passport_place_of_issue?: string | null;
  passport_date_of_issue?: string | null;
  passport_issuing_authority?: string | null;
  passport_date_of_expiry?: string | null;
  certificate_of_eligibility_no?: string | null;
  // Travel
  purpose_of_visit?: string | null;
  intended_length_of_stay?: string | null;
  date_of_arrival?: string | null;
  port_of_entry?: string | null;
  airline_or_ship?: string | null;
  // Stay
  hotel_name?: string | null;
  hotel_tel?: string | null;
  hotel_address?: string | null;
  previous_stays?: string | null;
  // Residence
  residential_address?: string | null;
  residential_tel?: string | null;
  residential_mobile?: string | null;
  residential_email?: string | null;
  // Profession
  profession?: string | null;
  employer_name?: string | null;
  employer_tel?: string | null;
  employer_address?: string | null;
  partner_profession?: string | null;
  // Declarations
  q_convicted_crime?: boolean;
  q_imprisoned_1y?: boolean;
  q_deported?: boolean;
  q_drug_offence?: boolean;
  q_prostitution?: boolean;
  q_trafficking?: boolean;
  declarations_details?: string | null;
  remarks?: string | null;
  date_of_application?: string | null;
};

export const VISA_OPTIONAL_FIELD_LABELS = [
  "Nationalité antérieure",
  "Autres noms / alias",
  "N° Certificat d'éligibilité",
  "Séjours précédents au Japon",
  "Profession du conjoint / parents",
] as const;

export type VisaSettingsData = {
  guarantor_name?: string | null;
  guarantor_tel?: string | null;
  guarantor_address?: string | null;
  guarantor_dob?: string | null;
  guarantor_sex?: string | null;
  guarantor_relationship?: string | null;
  guarantor_profession?: string | null;
  guarantor_nationality?: string | null;
  inviter_same_as_guarantor?: boolean;
  inviter_name?: string | null;
  inviter_tel?: string | null;
  inviter_address?: string | null;
  inviter_dob?: string | null;
  inviter_sex?: string | null;
  inviter_relationship?: string | null;
  inviter_profession?: string | null;
  inviter_nationality?: string | null;
};

export function formatVisaPdfDate(value?: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    const d = String(value.getDate()).padStart(2, "0");
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const y = String(value.getFullYear());
    return `${d}/${m}/${y}`;
  }

  const raw = cleanVisaText(value);
  if (!raw) return "";

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/);
  if (iso) {
    return `${iso[3].padStart(2, "0")}/${iso[2].padStart(2, "0")}/${iso[1]}`;
  }

  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    return `${slash[1].padStart(2, "0")}/${slash[2].padStart(2, "0")}/${slash[3]}`;
  }

  const spaced = raw.match(/^(\d{1,2})\s+(\d{1,2})\s+(\d{4})$/);
  if (spaced) {
    return `${spaced[1].padStart(2, "0")}/${spaced[2].padStart(2, "0")}/${spaced[3]}`;
  }

  return formatVisaDate(raw, "");
}

const fmtDate = (s?: string | null) => formatVisaPdfDate(s);

/** Required-field validation. Returns a list of missing/invalid field labels. */
export function validateVisaApplication(app: VisaApplicationData): string[] {
  const missing: string[] = [];
  const isRetired = isRetiredVisaCategory((app as any).category);
  const previousStay = parsePreviousJapanStay(app.previous_stays);
  const need = (v: unknown, label: string) => {
    if (v === undefined || v === null || (typeof v === "string" && !v.trim())) missing.push(label);
  };
  need((app as any).category, "Situation professionnelle");
  need(app.surname, "Nom (Surname)");
  need(app.given_names, "Prénoms (Given names)");
  need(app.date_of_application, "Date de la demande");
  need(app.date_of_birth, "Date de naissance");
  need(app.place_of_birth_city, "Ville de naissance");
  need(app.place_of_birth_state, "Région / Province de naissance");
  need(app.place_of_birth_country, "Pays de naissance");
  need(app.sex, "Sexe");
  need(app.marital_status, "État civil");
  need(app.nationality, "Nationalité");
  need(app.national_id_no, "N° pièce d'identité");
  need(app.passport_type, "Type de passeport");
  need(app.passport_no, "Numéro de passeport");
  need(app.passport_date_of_issue, "Date d'émission du passeport");
  need(app.passport_date_of_expiry, "Date d'expiration du passeport");
  need(app.passport_place_of_issue, "Lieu d'émission du passeport");
  need(app.passport_issuing_authority, "Autorité de délivrance du passeport");
  need(app.purpose_of_visit, "Objet du voyage");
  need(app.intended_length_of_stay, "Durée du séjour");
  need(app.residential_address, "Adresse de résidence");
  need(app.residential_tel, "Téléphone fixe");
  need(app.residential_mobile, "Mobile");
  need(app.residential_email, "Email");
  need(app.profession, "Profession");
  if (!previousStay.hasPrevious) need(app.previous_stays, "Séjours précédents au Japon");
  if (previousStay.hasPrevious === "yes") need(previousStay.lastStayDate, "Date du dernier séjour au Japon");
  if (!isRetired) {
    need(app.employer_name, "Nom de l'employeur ou de l'école");
    need(app.employer_tel, "Téléphone de l'employeur ou de l'école");
    need(app.employer_address, "Adresse de l'employeur ou de l'école");
  }
  return missing;
}

/**
 * Fill the official Japan visa PDF by overlaying text at calibrated coordinates.
 * Coordinates are in PDF points (origin bottom-left). Tuned for the official
 * MOFA A4 template (595×842 pts). Field labels were located by extracting the
 * underlying text positions from the template, so layouts stay aligned with
 * the printed underlines and checkboxes.
 */
export async function generateVisaPdf(
  application: VisaApplicationData,
  settings: VisaSettingsData
): Promise<Uint8Array> {
  const tplBytes = await fetch("/visa/visa-template.pdf").then((r) => r.arrayBuffer());
  const pdf = await PDFDocument.load(tplBytes);
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [p1, p2] = pdf.getPages();

  /**
   * Draw text shrinking the font size if it would exceed `maxWidth`,
   * down to a hard minimum. Prevents overflow into adjacent fields.
   */
  const draw = (
    page: typeof p1,
    text: string | null | undefined,
    x: number,
    y: number,
    size = 9,
    opts: { bold?: boolean; maxWidth?: number; minSize?: number } = {}
  ) => {
    const str = cleanVisaText(text);
    if (!str) return;
    const font = opts.bold ? helvBold : helv;
    let fontSize = size;
    if (opts.maxWidth) {
      const minSize = opts.minSize ?? 6;
      while (fontSize > minSize && font.widthOfTextAtSize(str, fontSize) > opts.maxWidth) {
        fontSize -= 0.5;
      }
    }
    page.drawText(str, { x, y, size: fontSize, font, color: PEN_BLUE });
  };

  /** Draw text wrapped to two lines if it doesn't fit on one. */
  const drawWrapped = (
    page: typeof p1,
    text: string | null | undefined,
    x: number,
    y: number,
    maxWidth: number,
    size = 9,
    lineGap = 11
  ) => {
    const str = cleanVisaText(text);
    if (!str) return;
    const lines = wrapToWidth(str, maxWidth, helv, size);
    lines.slice(0, 2).forEach((ln, i) => {
      page.drawText(ln, { x, y: y - i * lineGap, size, font: helv, color: PEN_BLUE });
    });
  };

  const tick = (page: typeof p1, x: number, y: number) => {
    // x,y are the BOTTOM-LEFT of the 10x10 checkbox in the template.
    // Offset to visually center an "X" glyph at size 10.
    page.drawText("X", { x: x + 1.2, y: y + 1.2, size: 10, font: helvBold, color: PEN_BLUE });
  };

  const drawDateCells = (
    page: typeof p1,
    s: string | null | undefined,
    xDay: number,
    _xMonth: number,
    _xYear: number,
    y: number,
    size = 9
  ) => {
    const fullDate = formatVisaPdfDate(s);
    const parts = fullDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!parts) return;

    // Official template prints Day/Month/Year hints under separate blanks.
    // We intentionally draw the date as one contiguous visual value with
    // explicit slash glyphs, so it never renders as "15 01 1968".
    let cursor = xDay;
    const drawSegment = (value: string, maxWidth: number) => {
      draw(page, value, cursor, y, size, { maxWidth, minSize: 7 });
      cursor += helv.widthOfTextAtSize(value, size) + 2;
    };
    drawSegment(parts[1], 16);
    drawSegment("/", 6);
    drawSegment(parts[2], 16);
    drawSegment("/", 6);
    drawSegment(parts[3], 34);
  };

  // ===================== PAGE 1 =====================
  // Text is offset ~3pt above the printed underline so it sits ON TOP of the line, not over it.
  const Y_OFFSET = 3;
  // Page 1 calibrated layout constants.
  // These are deliberately named because the official template has dense labels
  // around these fields and future micro-adjustments should not be archaeology.
  const purposeOfVisitX = 305;
  const purposeOfVisitY = 371.9 + Y_OFFSET;
  const employerNameX = 170;
  const employerNameY = 96.5 + Y_OFFSET;
  const employerAddressX = 170;
  const employerAddressY = 76.5 + Y_OFFSET;
  const employerPhoneX = 440;
  const employerPhoneY = 96.5 + Y_OFFSET;
  const isRetiredApplicant = isRetiredVisaCategory(application.category);
  const employerName = isRetiredApplicant ? PDF_NOT_APPLICABLE : application.employer_name;
  const employerTel = isRetiredApplicant ? PDF_NOT_APPLICABLE : application.employer_tel;
  const employerAddress = isRetiredApplicant ? PDF_NOT_APPLICABLE : application.employer_address;
  const purposeOfVisit = cleanVisaText(application.purpose_of_visit).toLowerCase() === "tourisme"
    ? "Tourisme"
    : application.purpose_of_visit;

  // Identity
  draw(p1, application.surname?.toUpperCase(),       210, 621.3 + Y_OFFSET, 9, { maxWidth: 360 });
  draw(p1, application.given_names?.toUpperCase(),   285, 600.6 + Y_OFFSET, 9, { maxWidth: 285 });
  draw(p1, application.other_names,                  430, 581.9 + Y_OFFSET, 9, { maxWidth: 140 });

  drawDateCells(p1, application.date_of_birth, 130, 156, 178, 548.5 + Y_OFFSET);
  draw(p1, application.place_of_birth_city,    285, 548.5 + Y_OFFSET, 9, { maxWidth: 60 });
  draw(p1, application.place_of_birth_state,   355, 548.5 + Y_OFFSET, 9, { maxWidth: 95 });
  draw(p1, application.place_of_birth_country, 470, 548.5 + Y_OFFSET, 9, { maxWidth: 95 });

  // Sex/Marital status checkboxes — coordinates = bottom-left of printed 10x10 boxes.
  if (application.sex === "male")   tick(p1, 113.8, 530.3);
  if (application.sex === "female") tick(p1, 171.5, 530.3);
  if (application.marital_status === "single")   tick(p1, 330.9, 529.9);
  if (application.marital_status === "married")  tick(p1, 389.8, 529.9);
  if (application.marital_status === "widowed")  tick(p1, 457.9, 529.9);
  if (application.marital_status === "divorced") tick(p1, 523.6, 529.9);

  draw(p1, application.nationality,         200, 509.1 + Y_OFFSET, 9, { maxWidth: 360 });
  draw(p1, application.former_nationality,  315, 489.2 + Y_OFFSET, 9, { maxWidth: 245 });
  draw(p1, application.national_id_no,      280, 469.3 + Y_OFFSET, 9, { maxWidth: 280 });

  // Passport type checkboxes
  if (application.passport_type === "diplomatic") tick(p1, 186.4, 449.5);
  if (application.passport_type === "official")   tick(p1, 244.1, 449.5);
  if (application.passport_type === "ordinary")   tick(p1, 310.4, 449.5);
  if (application.passport_type === "other")      tick(p1, 365.2, 449.5);
  draw(p1, application.passport_no?.toUpperCase(), 450, 448.7 + Y_OFFSET, 9, { maxWidth: 110 });

  draw(p1, application.passport_place_of_issue,         140, 430.5 + Y_OFFSET, 9, { maxWidth: 240 });
  drawDateCells(p1, application.passport_date_of_issue, 478, 502, 524, 430.5 + Y_OFFSET);
  draw(p1, application.passport_issuing_authority,       150, 410.5 + Y_OFFSET, 9, { maxWidth: 230 });
  drawDateCells(p1, application.passport_date_of_expiry, 478, 502, 524, 410.5 + Y_OFFSET);
  draw(p1, application.certificate_of_eligibility_no,    200, 390.8 + Y_OFFSET, 9, { maxWidth: 360 });

  // Travel. Purpose starts after the long printed label
  // "Purpose of visit to Japan/Status of residence" to avoid label overlap.
  draw(p1, purposeOfVisit, purposeOfVisitX, purposeOfVisitY, 9, { maxWidth: 255 });
  draw(p1, application.intended_length_of_stay,  215, 350.5 + Y_OFFSET, 9, { maxWidth: 80 });
  draw(p1, fmtDate(application.date_of_arrival), 425, 350.5 + Y_OFFSET, 9, { maxWidth: 130 });
  draw(p1, application.port_of_entry,            180, 331.1 + Y_OFFSET, 9, { maxWidth: 110 });
  draw(p1, application.airline_or_ship,          425, 331.1 + Y_OFFSET, 9, { maxWidth: 135 });

  // Hotel
  draw(p1, application.hotel_name,    127, 290.6 + Y_OFFSET, 9, { maxWidth: 280 });
  draw(p1, application.hotel_tel,     440, 290.6 + Y_OFFSET, 9, { maxWidth: 120 });
  drawWrapped(p1, application.hotel_address, 130, 258.7 + Y_OFFSET, 430, 9);
  drawWrapped(p1, formatPreviousJapanStayForDisplay(application.previous_stays), 275, 239.0 + Y_OFFSET, 285, 9);

  // Residence
  drawWrapped(p1, application.residential_address, 130, 187.9 + Y_OFFSET, 430, 9);
  draw(p1, application.residential_tel,     120, 168.0 + Y_OFFSET, 9, { maxWidth: 90 });
  draw(p1, application.residential_mobile,  280, 168.1 + Y_OFFSET, 9, { maxWidth: 280 });
  draw(p1, application.residential_email,   130, 149.8 + Y_OFFSET, 9, { maxWidth: 430 });

  draw(p1, application.profession, 280, 129.8 + Y_OFFSET, 9, { maxWidth: 280 });

  // Employer. The printed heading says "Name and address of employer";
  // values must sit on the sub-lines, not on the heading baseline.
  // Name line: left side under "Name"; Tel line: right side; Address line below.
  draw(p1, employerName, employerNameX, employerNameY, 9, { maxWidth: 220 });
  draw(p1, employerTel, employerPhoneX, employerPhoneY, 9, { maxWidth: 120 });
  drawWrapped(p1, employerAddress, employerAddressX, employerAddressY, 280, 9);

  // ===================== PAGE 2 =====================
  draw(p2, application.partner_profession, 290, 792.0 + Y_OFFSET, 9, { maxWidth: 270 });

  // Guarantor
  draw(p2, settings.guarantor_name,         127, 740.8 + Y_OFFSET, 9, { maxWidth: 280 });
  draw(p2, settings.guarantor_tel,          440, 740.8 + Y_OFFSET, 9, { maxWidth: 120 });
  drawWrapped(p2, settings.guarantor_address, 130, 709.7 + Y_OFFSET, 430, 9);
  drawDateCells(p2, settings.guarantor_dob, 160, 184, 206, 690.8 + Y_OFFSET);
  if (settings.guarantor_sex === "male")    tick(p2, 326.7, 691.7);
  if (settings.guarantor_sex === "female")  tick(p2, 384.4, 691.7);
  draw(p2, settings.guarantor_relationship, 215, 671.9 + Y_OFFSET, 9, { maxWidth: 345 });
  draw(p2, settings.guarantor_profession,   265, 653.0 + Y_OFFSET, 9, { maxWidth: 295 });
  draw(p2, settings.guarantor_nationality,  270, 634.1 + Y_OFFSET, 9, { maxWidth: 290 });

  // Inviter
  if (settings.inviter_same_as_guarantor) {
    draw(p2, "Same as above", 127, 596.3 + Y_OFFSET, 9, { bold: true });
  } else {
    draw(p2, settings.inviter_name,         127, 596.3 + Y_OFFSET, 9, { maxWidth: 280 });
    draw(p2, settings.inviter_tel,          440, 596.3 + Y_OFFSET, 9, { maxWidth: 120 });
    drawWrapped(p2, settings.inviter_address, 130, 565.2 + Y_OFFSET, 430, 9);
    drawDateCells(p2, settings.inviter_dob, 160, 184, 206, 546.3 + Y_OFFSET);
    if (settings.inviter_sex === "male")   tick(p2, 326.7, 547.3);
    if (settings.inviter_sex === "female") tick(p2, 384.4, 547.3);
    draw(p2, settings.inviter_relationship, 215, 526.6 + Y_OFFSET, 9, { maxWidth: 345 });
    draw(p2, settings.inviter_profession,   265, 507.7 + Y_OFFSET, 9, { maxWidth: 295 });
    draw(p2, settings.inviter_nationality,  270, 488.8 + Y_OFFSET, 9, { maxWidth: 290 });
  }

  // Remarks
  drawWrapped(p2, application.remarks, 285, 470.0 + Y_OFFSET, 275, 9);

  // Yes/No questions — bottom-left of each 10x10 box (Yes x=502.3, No x=539.8).
  const qRows: Array<[boolean | undefined, number]> = [
    [application.q_convicted_crime, 439.0],
    [application.q_imprisoned_1y,   423.9],
    [application.q_deported,        396.9],
    [application.q_drug_offence,    369.8],
    [application.q_prostitution,    333.1],
    [application.q_trafficking,     318.1],
  ];
  qRows.forEach(([v, y]) => {
    if (v === true)       tick(p2, 502.3, y);
    else if (v === false) tick(p2, 539.8, y);
  });

  // Free-text "if Yes" details
  if (application.declarations_details) {
    const lines = wrapToWidth(application.declarations_details, 480, helv, 9).slice(0, 5);
    lines.forEach((ln, i) => draw(p2, ln, 78, 280 - i * 12));
  }

  // Date of application
  drawDateCells(p2, application.date_of_application, 160, 184, 208, 138.3 + Y_OFFSET);

  return await pdf.save();
}

/** Word-wrap by measured pixel width using a pdf-lib font. */
function wrapToWidth(
  text: string,
  maxWidth: number,
  font: { widthOfTextAtSize: (s: string, size: number) => number },
  size: number
): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    let cur = "";
    for (const w of words) {
      const candidate = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        cur = candidate;
      } else {
        if (cur) out.push(cur);
        cur = w;
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

export function downloadBlob(bytes: Uint8Array, filename: string) {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([ab], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
