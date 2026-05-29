import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "pdf-lib";
import logoUrl from "@/assets/logo-moroccan-express.png";
import logoJaponUrl from "@/assets/logo-lejapon.png";
import stampUrl from "@/assets/stamp-moroccan-express.png";
import { agencyAddressLine, agencyIceLine, normalizeAgencySettings, type AgencySettings } from "@/lib/agency-settings";

const RED = rgb(0.78, 0.07, 0.10);
const BLACK = rgb(0.07, 0.07, 0.07);
const GREY = rgb(0.45, 0.45, 0.45);
const LIGHT = rgb(0.96, 0.96, 0.96);
const BORDER = rgb(0.85, 0.85, 0.85);

/** Replace Unicode characters that WinAnsi (Helvetica/StandardFonts) cannot encode. */
export function sanitizePdfText(input: unknown): string {
  if (input === null || input === undefined) return "";
  let s = String(input);
  s = s
    .replace(/\u202F/g, " ") // narrow no-break space (from Intl fr-FR)
    .replace(/\u00A0/g, " ") // no-break space
    .replace(/\u2009/g, " ") // thin space
    .replace(/\u200B/g, "")  // zero-width space
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00B7/g, "·"); // keep middle dot (WinAnsi supports it)
  // Strip remaining non-WinAnsi (e.g. Arabic) to avoid encoding crash
  s = s.replace(/[^\x00-\xFF]/g, "");
  return s;
}

const fmtMad = (n: number) =>
  sanitizePdfText(new Intl.NumberFormat("fr-FR").format(Math.round(n || 0))) + " MAD";

const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
};

async function loadImage(pdf: PDFDocument, url: string) {
  try {
    const res = await fetch(url);
    const buf = new Uint8Array(await res.arrayBuffer());
    return await pdf.embedPng(buf);
  } catch {
    return null;
  }
}

async function loadExternalImage(pdf: PDFDocument, url?: string | null) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    const buf = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("jpeg") || contentType.includes("jpg") || /\.jpe?g($|\?)/i.test(url)) {
      return await pdf.embedJpg(buf);
    }
    return await pdf.embedPng(buf);
  } catch {
    return null;
  }
}

async function loadLogo(pdf: PDFDocument, agency?: AgencySettings) {
  return (await loadExternalImage(pdf, agency?.logo_url)) ?? loadImage(pdf, logoUrl);
}

async function loadJaponLogo(pdf: PDFDocument) {
  try {
    const res = await fetch(logoJaponUrl);
    const buf = new Uint8Array(await res.arrayBuffer());
    return await pdf.embedPng(buf);
  } catch {
    return null;
  }
}

async function loadStamp(pdf: PDFDocument, agency?: AgencySettings) {
  const configured = await loadExternalImage(pdf, agency?.stamp_signature_url);
  if (configured) return configured;
  try {
    const res = await fetch(stampUrl);
    const buf = new Uint8Array(await res.arrayBuffer());
    return await pdf.embedPng(buf);
  } catch {
    return null;
  }
}

async function drawStamp(pdf: PDFDocument, page: PDFPage, x: number, y: number, maxW = 170, maxH = 110, agency?: AgencySettings) {
  const stamp = await loadStamp(pdf, agency);
  if (!stamp) return;
  const ratio = stamp.width / stamp.height;
  let w = maxW, h = w / ratio;
  if (h > maxH) { h = maxH; w = h * ratio; }
  page.drawImage(stamp, { x, y, width: w, height: h, opacity: 0.9 });
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = sanitizePdfText(text).split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    const c = cur ? cur + " " + w : w;
    if (font.widthOfTextAtSize(c, size) <= maxWidth) cur = c;
    else { if (cur) out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
}

function drawText(p: PDFPage, t: string, x: number, y: number, font: PDFFont, size: number, color = BLACK) {
  p.drawText(sanitizePdfText(t), { x, y, font, size, color });
}

async function header(pdf: PDFDocument, page: PDFPage, title: string, number: string, fontB: PDFFont, font: PDFFont, agency: AgencySettings) {
  const logo = await loadLogo(pdf, agency);
  const pw = page.getWidth();
  // Logo top-left — preserve aspect ratio (contain in 130×60 box)
  if (logo) {
    const maxW = 130;
    const maxH = 60;
    const ratio = logo.width / logo.height;
    let w = maxW;
    let h = w / ratio;
    if (h > maxH) { h = maxH; w = h * ratio; }
    page.drawImage(logo, { x: 40, y: 800 - h / 2, width: w, height: h });
  } else {
    drawText(page, "MOROCCAN EXPRESS", 40, 808, fontB, 14, BLACK);
    drawText(page, "TRAVEL & EVENTS", 40, 793, font, 9, GREY);
  }
  // Title block top-right
  const titleSize = 26;
  const tw = fontB.widthOfTextAtSize(title, titleSize);
  drawText(page, title, pw - 40 - tw, 810, fontB, titleSize, RED);
  const numLabel = `N° ${number}`;
  const nw = font.widthOfTextAtSize(sanitizePdfText(numLabel), 10);
  drawText(page, numLabel, pw - 40 - nw, 792, font, 10, GREY);
  // Thin red accent line
  page.drawRectangle({ x: 40, y: 770, width: pw - 80, height: 1.2, color: RED });

  // Company info under accent line
  let y = 758;
  drawText(page, agency.legal_company_name, 40, y, fontB, 9.5, BLACK);
  y -= 12;
  drawText(page, agencyAddressLine(agency), 40, y, font, 8.5, GREY); y -= 11;
  drawText(page, `${agencyIceLine(agency)}  ·  ${agency.email}  ·  ${agency.phone}`, 40, y, font, 8.5, GREY);
}

function infoBlock(page: PDFPage, font: PDFFont, fontB: PDFFont, x: number, y: number, w: number, label: string, lines: string[]) {
  const h = lines.length * 13 + 30;
  page.drawRectangle({ x, y: y - h, width: w, height: h, color: LIGHT, borderColor: BORDER, borderWidth: 0.5 });
  // Red label accent
  page.drawRectangle({ x, y: y - 22, width: 3, height: 14, color: RED });
  drawText(page, label, x + 10, y - 18, fontB, 9, BLACK);
  let yy = y - 36;
  lines.forEach((l) => { drawText(page, l, x + 10, yy, font, 9.5); yy -= 13; });
  return y - h - 12;
}

function table(page: PDFPage, font: PDFFont, fontB: PDFFont, x: number, y: number, w: number, rows: { label: string; qty?: string; unit?: string; total: string }[]) {
  const cols = [x + 10, x + w - 230, x + w - 160, x + w - 80];
  // Header
  page.drawRectangle({ x, y: y - 22, width: w, height: 22, color: BLACK });
  drawText(page, "Désignation", cols[0], y - 16, fontB, 9.5, rgb(1,1,1));
  drawText(page, "Qté", cols[1], y - 16, fontB, 9.5, rgb(1,1,1));
  drawText(page, "PU", cols[2], y - 16, fontB, 9.5, rgb(1,1,1));
  drawText(page, "Total", cols[3], y - 16, fontB, 9.5, rgb(1,1,1));
  let yy = y - 22;
  rows.forEach((r, i) => {
    const labelLines = wrap(r.label, font, 9.5, w - 250);
    const rowH = Math.max(20, labelLines.length * 12 + 8);
    if (i % 2 === 0) page.drawRectangle({ x, y: yy - rowH, width: w, height: rowH, color: rgb(0.97, 0.97, 0.97) });
    labelLines.forEach((ln, j) => drawText(page, ln, cols[0], yy - 14 - j * 12, font, 9.5));
    drawText(page, r.qty ?? "", cols[1], yy - 14, font, 9.5);
    drawText(page, r.unit ?? "", cols[2], yy - 14, font, 9.5);
    drawText(page, r.total, cols[3], yy - 14, fontB, 9.5);
    yy -= rowH;
  });
  // Border
  page.drawRectangle({ x, y: yy, width: w, height: y - yy, borderColor: BLACK, borderWidth: 0.6, color: undefined as any, opacity: 0 });
  return yy - 10;
}

function totalsBlock(page: PDFPage, font: PDFFont, fontB: PDFFont, x: number, y: number, w: number, items: { label: string; value: string; bold?: boolean; accent?: boolean }[]) {
  const xLeft = x + w - 280;
  const blockH = items.length * 18 + 12;
  page.drawRectangle({ x: xLeft, y: y - blockH, width: 280, height: blockH, color: rgb(0.97, 0.97, 0.97) });
  let yy = y - 18;
  items.forEach((it) => {
    const f = it.bold ? fontB : font;
    const c = it.accent ? RED : BLACK;
    drawText(page, it.label, xLeft + 12, yy, f, 10, c);
    const tw = f.widthOfTextAtSize(it.value, 10);
    drawText(page, it.value, xLeft + 280 - 12 - tw, yy, f, 10, c);
    yy -= 18;
  });
  return y - blockH - 10;
}

async function footer(pdf: PDFDocument, page: PDFPage, font: PDFFont, agency: AgencySettings) {
  const pw = page.getWidth();
  // Discreet footer with thin red rule
  page.drawRectangle({ x: 40, y: 58, width: pw - 80, height: 0.6, color: BORDER });
  // LeJapon.ma logo (preserve ratio, contain in 70×28 box) — discreet, top-left of footer
  const japon = await loadJaponLogo(pdf);
  let textX = 40;
  if (japon) {
    const maxW = 70, maxH = 28;
    const ratio = japon.width / japon.height;
    let w = maxW, h = w / ratio;
    if (h > maxH) { h = maxH; w = h * ratio; }
    page.drawImage(japon, { x: 40, y: 22, width: w, height: h });
    textX = 40 + w + 12;
  }
  drawText(page, agency.legal_company_name, textX, 42, font, 7.5, GREY);
  drawText(page, agencyAddressLine(agency), textX, 32, font, 7.5, GREY);
  drawText(page, `${agencyIceLine(agency)}  ·  ${agency.email}  ·  ${agency.phone}`, textX, 22, font, 7.5, GREY);
}

export type QuoteData = {
  booking: any;
  trip?: { title?: string; season?: string | null; start_date?: string | null; end_date?: string | null } | null;
  extras?: { name_snapshot: string; qty: number; unit_price_mad: number }[];
  number: string;
  validUntil?: Date;
  agency?: Partial<AgencySettings> | null;
};

export async function generateQuotePdf(d: QuoteData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);
  const agency = normalizeAgencySettings(d.agency);

  await header(pdf, page, "DEVIS", d.number, fontB, font, agency);

  // Date row
  let y = 700;
  const validity = d.validUntil ?? new Date(Date.now() + 14 * 24 * 3600 * 1000);
  drawText(page, `Date : ${fmtDate(new Date())}`, 40, y, font, 10);
  drawText(page, `Valide jusqu'au : ${fmtDate(validity)}`, 320, y, font, 10);

  // Client block
  y -= 18;
  const b = d.booking;
  const clientLines = [
    b.contact_name ?? "—",
    b.contact_email ?? "",
    b.contact_phone ?? "",
    b.contact_city ?? "",
  ].filter(Boolean);
  infoBlock(page, font, fontB, 40, y, 250, "CLIENT", clientLines);
  // Trip block
  const trip = d.trip;
  const tripLines = [
    trip?.title ?? "—",
    trip?.season ?? "",
    trip?.start_date ? `Départ : ${fmtDate(trip.start_date)}` : "",
    `Voyageurs : ${b.num_adults || 0} adulte(s)${b.num_children ? ` + ${b.num_children} enfant(s)` : ""}`,
    b.room_type ? `Chambre : ${b.room_type}` : "",
    b.formula ? `Hôtel : ${b.formula}` : "",
  ].filter(Boolean);
  infoBlock(page, font, fontB, 305, y, 250, "RÉSERVATION", tripLines);

  // Items table
  y -= Math.max(clientLines.length, tripLines.length) * 13 + 50;
  const pax = (b.num_adults || 0) + (b.num_children || 0);
  const extrasTotal = (d.extras ?? []).reduce((s, e) => s + e.qty * Number(e.unit_price_mad || 0), 0);
  const peopleTotal = Math.max(0, Number(b.total_amount_mad || 0) - extrasTotal);
  const perPax = pax > 0 ? peopleTotal / pax : peopleTotal;
  const rows = [
    {
      label: `${trip?.title ?? "Voyage"}${trip?.start_date ? " — départ " + fmtDate(trip.start_date) : ""}`,
      qty: String(pax || 1),
      unit: fmtMad(perPax),
      total: fmtMad(peopleTotal),
    },
    ...(d.extras ?? []).map((e) => ({
      label: e.name_snapshot,
      qty: String(e.qty),
      unit: fmtMad(Number(e.unit_price_mad)),
      total: fmtMad(e.qty * Number(e.unit_price_mad)),
    })),
  ];
  y = table(page, font, fontB, 40, y, 515, rows);

  // Totals
  const total = Number(b.total_amount_mad || 0);
  const paid = Number(b.paid_amount_mad || 0);
  const remaining = Math.max(0, total - paid);
  const paxCount = (b.num_adults || 0) + (b.num_children || 0);
  const deposit = paxCount * 25000;
  y = totalsBlock(page, font, fontB, 40, y, 515, [
    { label: "Total HT", value: fmtMad(total) },
    { label: "Total TTC", value: fmtMad(total), bold: true },
    { label: `Acompte demandé (25 000 MAD × ${paxCount} pers.)`, value: fmtMad(deposit), accent: true },
    { label: "Déjà payé", value: fmtMad(paid) },
    { label: "Reste à payer", value: fmtMad(remaining), bold: true },
  ]);

  // Conditions
  y -= 6;
  drawText(page, "Conditions", 40, y, fontB, 10, RED); y -= 14;
  const cond = "Pour confirmer votre réservation, vous devez vous acquitter d'un premier paiement de 25000 MAD par personne. Le solde est dû maximum un mois avant le départ. Toute annulation passant ce délai entraînera des frais selon nos conditions générales de vente.";
  wrap(cond, font, 9, 515).forEach((l) => { drawText(page, l, 40, y, font, 9, GREY); y -= 12; });

  // Cachet société (bottom-right above footer)
  await drawStamp(pdf, page, 380, 80, 175, 115, agency);

  await footer(pdf, page, font, agency);
  return await pdf.save();
}

export type ReceiptData = {
  booking: any;
  trip?: { title?: string; season?: string | null; start_date?: string | null } | null;
  payment: { amount_mad: number; method?: string | null; reference?: string | null; paid_at?: string | null };
  number: string;
  extras?: { name_snapshot: string; qty: number; unit_price_mad: number }[];
  agency?: Partial<AgencySettings> | null;
};

export async function generateReceiptPdf(d: ReceiptData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);
  const agency = normalizeAgencySettings(d.agency);

  await header(pdf, page, "REÇU DE PAIEMENT", d.number, fontB, font, agency);

  let y = 700;
  drawText(page, `Date du paiement : ${fmtDate(d.payment.paid_at ?? new Date())}`, 40, y, font, 10);
  drawText(page, `Référence réservation : ${d.booking.reference ?? "—"}`, 320, y, font, 10);

  y -= 18;
  const b = d.booking;
  const clientLines = [
    b.contact_name ?? "—", b.contact_email ?? "", b.contact_phone ?? "", b.contact_city ?? "",
  ].filter(Boolean);
  const tripLines = [
    d.trip?.title ?? "—",
    d.trip?.season ?? "",
    d.trip?.start_date ? `Départ : ${fmtDate(d.trip.start_date)}` : "",
    `Voyageurs : ${b.num_adults || 0} adulte(s)${b.num_children ? ` + ${b.num_children} enfant(s)` : ""}`,
    b.room_type ? `Chambre : ${b.room_type}` : "",
    b.formula ? `Hôtel : ${b.formula}` : "",
  ].filter(Boolean);
  infoBlock(page, font, fontB, 40, y, 250, "CLIENT", clientLines);
  infoBlock(page, font, fontB, 305, y, 250, "RÉSERVATION", tripLines);

  y -= Math.max(clientLines.length, tripLines.length) * 13 + 50;

  const total = Number(b.total_amount_mad || 0);
  const paid = Number(b.paid_amount_mad || 0);
  const remaining = Math.max(0, total - paid);
  const pax = (b.num_adults || 0) + (b.num_children || 0);
  const extras = d.extras ?? [];
  const extrasTotal = extras.reduce((s, e) => s + e.qty * Number(e.unit_price_mad || 0), 0);
  const peopleTotal = Math.max(0, total - extrasTotal);
  const perPax = pax > 0 ? peopleTotal / pax : peopleTotal;

  // Detail of the booking (what the client is paying for)
  drawText(page, "Détail de la réservation", 40, y, fontB, 10, RED); y -= 6;
  y = table(page, font, fontB, 40, y, 515, [
    {
      label: `${d.trip?.title ?? "Voyage"}${d.trip?.start_date ? " — départ " + fmtDate(d.trip.start_date) : ""}`,
      qty: String(pax || 1),
      unit: fmtMad(perPax),
      total: fmtMad(peopleTotal),
    },
    ...extras.map((e) => ({
      label: e.name_snapshot,
      qty: String(e.qty),
      unit: fmtMad(Number(e.unit_price_mad)),
      total: fmtMad(e.qty * Number(e.unit_price_mad)),
    })),
  ]);

  // Detail of this payment
  y -= 4;
  drawText(page, "Détail du paiement", 40, y, fontB, 10, RED); y -= 6;
  y = table(page, font, fontB, 40, y, 515, [
    {
      label: `Paiement reçu — ${d.payment.method || "virement"}${d.payment.reference ? " (réf. " + d.payment.reference + ")" : ""}`,
      qty: "1",
      unit: fmtMad(Number(d.payment.amount_mad)),
      total: fmtMad(Number(d.payment.amount_mad)),
    },
  ]);

  y = totalsBlock(page, font, fontB, 40, y, 515, [
    { label: "Total réservation", value: fmtMad(total) },
    { label: "Montant de ce paiement", value: fmtMad(Number(d.payment.amount_mad)), accent: true },
    { label: "Montant payé (cumul)", value: fmtMad(paid), bold: true },
    { label: "Reste à payer", value: fmtMad(remaining), bold: true },
  ]);

  y -= 14;
  drawText(page, "Merci pour votre confiance.", 40, y, fontB, 11, RED);
  y -= 14;
  drawText(page, "Ce reçu fait foi du paiement enregistré ci-dessus.", 40, y, font, 9, GREY);

  // Signature box
  page.drawRectangle({ x: 360, y: 110, width: 195, height: 70, borderColor: GREY, borderWidth: 0.6, color: undefined as any, opacity: 0 });
  drawText(page, "Signature & cachet", 365, 168, font, 8, GREY);
  // Cachet société à l'intérieur du cadre signature
  await drawStamp(pdf, page, 365, 95, 185, 95, agency);

  await footer(pdf, page, font, agency);
  return await pdf.save();
}

export function downloadBytes(bytes: Uint8Array, filename: string) {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([ab], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
