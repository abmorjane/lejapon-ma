import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from "pdf-lib";
import type { VisaApplicationData, VisaSettingsData } from "./visa-pdf";

/** Pencil-black ink for the invitation letter overlay (slightly soft, not pure black). */
const PENCIL_BLACK = rgb(0.12, 0.12, 0.14);

/** Strip characters that the WinAnsi (Helvetica) encoder cannot represent. */
const winAnsiSafe = (s: string | null | undefined): string => {
  if (!s) return "";
  return String(s)
    .replace(/[\u3012]/g, "T")           // 〒 postal mark → T
    .replace(/[\u2018\u2019]/g, "'")     // smart single quotes
    .replace(/[\u201C\u201D]/g, '"')     // smart double quotes
    .replace(/[\u2013\u2014]/g, "-")     // en/em dash
    .replace(/[^\x00-\xFF]/g, "");        // drop anything else outside Latin-1
};

const splitDate = (s?: string | null) => {
  if (!s) return { y: "", m: "", d: "" };
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return { y: "", m: "", d: "" };
  return { y: String(dt.getFullYear()), m: String(dt.getMonth() + 1).padStart(2, "0"), d: String(dt.getDate()).padStart(2, "0") };
};

const ageFrom = (s?: string | null) => {
  if (!s) return "";
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return "";
  const diff = Date.now() - dt.getTime();
  return String(Math.floor(diff / (365.25 * 24 * 3600 * 1000)));
};

const todayParts = () => splitDate(new Date().toISOString());

/** Draw a string at an exact PDF coordinate, with optional auto-shrink. */
function drawAt(
  page: PDFPage,
  font: PDFFont,
  text: string | null | undefined,
  x: number,
  y: number,
  size = 10,
  maxWidth?: number,
  minSize = 7
) {
  const str = winAnsiSafe(text);
  if (!str) return;
  let s = size;
  if (maxWidth) {
    while (s > minSize && font.widthOfTextAtSize(str, s) > maxWidth) s -= 0.5;
  }
  page.drawText(str, { x, y, size: s, font, color: PENCIL_BLACK });
}

/** Draw text wrapped over up to `maxLines` lines. */
function drawWrapped(
  page: PDFPage,
  font: PDFFont,
  text: string | null | undefined,
  x: number,
  y: number,
  maxWidth: number,
  size = 10,
  lineGap = 13,
  maxLines = 3
) {
  const safe = winAnsiSafe(text);
  if (!safe) return;
  const words = safe.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(t, size) <= maxWidth) cur = t;
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  lines.slice(0, maxLines).forEach((ln, i) => {
    page.drawText(ln, { x, y: y - i * lineGap, size, font, color: PENCIL_BLACK });
  });
}

/** Tick a checkbox by drawing an X at the box's bottom-left. */
function tick(page: PDFPage, font: PDFFont, x: number, y: number) {
  page.drawText("X", { x: x + 1.2, y: y + 1.2, size: 10, font, color: PENCIL_BLACK });
}

/**
 * Fill the official Letter of Invitation PDF by overlaying client + settings
 * data at coordinates calibrated against the template image (1448x2048 px →
 * 596x842 pt). y_pdf = 842 − y_img × 842/2048.
 */
export async function generateInvitationLetter(
  app: VisaApplicationData,
  settings: VisaSettingsData
): Promise<Uint8Array> {
  const tplBytes = await fetch("/visa/invitation-letter-template.pdf").then((r) => r.arrayBuffer());
  const pdf = await PDFDocument.load(tplBytes);
  const page = pdf.getPages()[0];
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const today = todayParts();
  const dob = splitDate(app.date_of_birth);
  const fullName = [app.surname, app.given_names].filter(Boolean).join(" ").toUpperCase();

  // The supplied template already contains the Inviter, Company, Morocco
  // recipient and the boilerplate (1)/(2)/(3) paragraphs. We only overlay
  // the application date (top right) and the Visa Applicant block.
  // All coordinates were measured from the rasterised template
  // (596×842 pt) by detecting the printed underlines and label baselines.

  // Date row at the top right — underline pdf_y=753.5. The (Year)(Month)(Day)
  // labels sit on the underline; values are written ABOVE each label,
  // visually centered above each parenthesised label.
  // Label centers (measured): (Year)≈402, (Month)≈455, (Day)≈517.
  drawAt(page, font, today.y, 391, 770, 11, 22);   // center "2026" → ~402
  drawAt(page, font, today.m, 449, 770, 11, 18);   // center "04"   → ~455
  drawAt(page, font, today.d, 511, 770, 11, 18);   // center "24"   → ~517

  // Visa Applicant — full name area sits between the ":" (~x 170) and the
  // "(□Male / □ Female)" group (~x 335). Baseline of the row = pdf_y 429.
  drawAt(page, font, fullName, 175, 432, 11, 155, 6);
  // Male / Female empty squares (verified by overlaying ruler on template):
  //   Male  □ : pdf_x ≈ 343..352, pdf_y ≈ 430..438
  //   Female □: pdf_x ≈ 368..377, pdf_y ≈ 430..438
  if (app.sex === "male") tick(page, bold, 343, 430);
  if (app.sex === "female") tick(page, bold, 368, 430);

  // Date of birth — underline pdf_y=399, slashes at pdf_x ≈ 130 and 166.
  // Slots: Year 105..128, Month 132..164, Day 168..205.
  drawAt(page, font, dob.y, 105, 402, 11, 22);
  drawAt(page, font, dob.m, 142, 402, 11, 22);
  drawAt(page, font, dob.d, 178, 402, 11, 24);
  // (Age:  ) — colon ends ≈ pdf_x 270, ")" at ≈ pdf_x 282; tiny slot.
  drawAt(page, font, ageFrom(app.date_of_birth), 274, 402, 9, 10);

  // Nationality / Occupation — labels "Nationality :" / "Occupation:"
  // colons end ≈ pdf_x 113 / 110; baselines pdf_y 371 / 357.
  drawAt(page, font, app.nationality, 120, 374, 11, 410);
  drawAt(page, font, app.profession, 120, 360, 11, 410);

  return await pdf.save();
}

export async function generateGuaranteeLetter(
  app: VisaApplicationData,
  settings: VisaSettingsData
): Promise<Uint8Array> {
  // Overlay applicant information on top of the official Letter of Guarantee
  // template. The template already contains "MOROCCO", the boilerplate, the
  // guarantor block (Tapis Volant) and the company seal — we only fill the
  // application date (top right) and the Visa Applicant block.
  const tplBytes = await fetch("/visa/guarantee-letter-template.pdf").then((r) => r.arrayBuffer());
  const pdf = await PDFDocument.load(tplBytes);
  const page = pdf.getPages()[0];
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const today = todayParts();
  const dob = splitDate(app.date_of_birth);
  const fullName = [app.surname, app.given_names].filter(Boolean).join(" ").toUpperCase();

  // Date row at top right — values sit ON the underline (pdf_y ≈ 758),
  // centered above each (Year)/(Month)/(Day) label.
  drawAt(page, font, today.y, 374, 760, 11, 22);
  drawAt(page, font, today.m, 442, 760, 11, 18);
  drawAt(page, font, today.d, 505, 760, 11, 18);

  // Visa Applicant — Full name written on its own line, below the
  // "Full name (in Latin alphabet):" label, indented to align with the
  // other applicant fields. Baseline measured at pdf_y ≈ 615.
  drawAt(page, font, fullName, 117, 615, 12, 270, 7);

  // Male / Female checkboxes — shifted left to land in the actual squares.
  if (app.sex === "male") tick(page, bold, 392, 612);
  if (app.sex === "female") tick(page, bold, 447, 612);

  // Date of birth — underline pdf_y ≈ 583, slashes at pdf_x ≈ 177 and 236.
  // Slots: Year 130..175, Month 180..234, Day 240..281.
  drawAt(page, font, dob.y, 137, 586, 11, 34);
  drawAt(page, font, dob.m, 192, 586, 11, 38);
  drawAt(page, font, dob.d, 250, 586, 11, 28);
  // (Age:  ) — colon ends ≈ pdf_x 320, ")" at ≈ pdf_x 363.
  drawAt(page, font, ageFrom(app.date_of_birth), 326, 586, 10, 30);

  // Nationality / Occupation — raised slightly to sit on the label baselines.
  drawAt(page, font, app.nationality, 125, 558, 11, 410);
  drawAt(page, font, app.profession, 125, 542, 11, 410);

  return await pdf.save();
}