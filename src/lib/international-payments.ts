import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { sanitizePdfText } from "@/lib/booking-pdfs";

export type InternationalPaymentFile = {
  id?: string;
  supplier_id?: string | null;
  supplier_name?: string | null;
  supplier_snapshot?: Record<string, unknown> | null;
  payment_reference?: string | null;
  invoice_number?: string | null;
  issue_date?: string | null;
  due_date?: string | null;
  currency?: string | null;
  total_invoice_amount?: number | string | null;
  payment_percentage?: number | string | null;
  amount_to_pay_now?: number | string | null;
  amount_already_paid?: number | string | null;
  remaining_balance?: number | string | null;
  unit_price_jpy?: number | string | null;
  tax_percent?: number | string | null;
  notes?: string | null;
  status?: string | null;
};

export type JapanSupplier = {
  id?: string;
  name?: string | null;
  category?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  notes?: string | null;
  bank_name?: string | null;
  branch_name?: string | null;
  bank_code?: string | null;
  branch_code?: string | null;
  account_type?: string | null;
  account_number?: string | null;
  account_holder?: string | null;
  logo_path?: string | null;
  logo_url?: string | null;
  stamp_path?: string | null;
  stamp_url?: string | null;
  contract_path?: string | null;
  contract_url?: string | null;
  invoice_template_path?: string | null;
  invoice_template_url?: string | null;
  status?: string | null;
};

export type JapanPartnerSettings = JapanSupplier & {
  partner_name?: string | null;
  registration_number?: string | null;
  corporate_number?: string | null;
  account_name?: string | null;
};

export type InternationalPaymentParticipant = {
  id?: string;
  payment_file_id?: string;
  source_participant_id?: string | null;
  full_name: string;
  passport_no?: string | null;
  nationality?: string | null;
  date_of_birth?: string | null;
  birth_date?: string | null;
  booking_reference?: string | null;
  room_type?: string | null;
  cin?: string | null;
  address?: string | null;
  city?: string | null;
  passport_copy_path?: string | null;
};

const ORANGE = rgb(0.91, 0.31, 0.08);
const BLACK = rgb(0.08, 0.08, 0.08);
const GREY = rgb(0.42, 0.42, 0.42);
const LIGHT = rgb(0.96, 0.95, 0.93);
const BORDER = rgb(0.84, 0.82, 0.78);

const pageSize: [number, number] = [595.28, 841.89];

export const fmtJPY = (value: unknown) =>
  `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Number(value || 0))} JPY`;

export const fmtMAD = (value: unknown) =>
  `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Number(value || 0))} MAD`;

export const fmtDate = (value: unknown) => {
  if (!value) return "Non renseigné";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return sanitizePdfText(value);
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const text = (value: unknown, fallback = "Non renseigné") => sanitizePdfText(value || fallback);

const drawText = (page: PDFPage, value: unknown, x: number, y: number, font: PDFFont, size = 10, color = BLACK, maxWidth?: number) => {
  const content = text(value);
  if (!maxWidth || font.widthOfTextAtSize(content, size) <= maxWidth) {
    page.drawText(content, { x, y, size, font, color });
    return;
  }
  const words = content.split(/\s+/);
  let line = "";
  let yy = y;
  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
      page.drawText(line, { x, y: yy, size, font, color });
      line = word;
      yy -= size + 3;
    } else {
      line = next;
    }
  });
  if (line) page.drawText(line, { x, y: yy, size, font, color });
};

const row = (page: PDFPage, label: string, value: unknown, x: number, y: number, font: PDFFont, bold: PDFFont, width = 245) => {
  page.drawRectangle({ x, y: y - 6, width, height: 24, borderColor: BORDER, borderWidth: 0.5 });
  drawText(page, label, x + 8, y + 3, font, 8, GREY, 90);
  drawText(page, value, x + 110, y + 2, bold, 9, BLACK, width - 118);
};

const header = (page: PDFPage, title: string, subtitle: string, font: PDFFont, bold: PDFFont) => {
  page.drawRectangle({ x: 0, y: 780, width: 595, height: 62, color: BLACK });
  page.drawText("LeJapon.ma", { x: 36, y: 812, size: 18, font: bold, color: ORANGE });
  page.drawText("Moroccan Express Travel and Events", { x: 36, y: 795, size: 9, font, color: rgb(1, 1, 1) });
  page.drawText(title, { x: 330, y: 810, size: 15, font: bold, color: rgb(1, 1, 1) });
  page.drawText(subtitle, { x: 330, y: 792, size: 9, font, color: rgb(0.88, 0.88, 0.88) });
};

const footer = (page: PDFPage, font: PDFFont) => {
  page.drawLine({ start: { x: 36, y: 42 }, end: { x: 559, y: 42 }, thickness: 0.5, color: BORDER });
  page.drawText("Dossier bancaire international - document interne LeJapon.ma", { x: 36, y: 26, size: 8, font, color: GREY });
};

export async function generateInternationalInvoicePdf({
  file,
  supplier,
  tripTitle,
  participantCount,
  unitPriceJpy,
  taxPercent,
}: {
  file: InternationalPaymentFile;
  supplier: JapanSupplier | JapanPartnerSettings;
  tripTitle: string;
  participantCount: number;
  unitPriceJpy: number;
  taxPercent: number;
}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage(pageSize);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const subtotal = Number(participantCount || 0) * Number(unitPriceJpy || 0);
  const tax = Math.round(subtotal * Number(taxPercent || 0) / 100);
  const amountDue = Number(file.amount_to_pay_now || subtotal + tax);
  const alreadyPaid = Number(file.amount_already_paid || 0);
  const remaining = Math.max(0, Number(file.total_invoice_amount || subtotal + tax) - alreadyPaid);

  header(page, "Supplier invoice", text(file.invoice_number || file.payment_reference), font, bold);
  page.drawText("FACTURE FOURNISSEUR - JAPON", { x: 36, y: 742, size: 18, font: bold, color: BLACK });
  page.drawText(text(tripTitle), { x: 36, y: 720, size: 11, font, color: GREY });

  page.drawRectangle({ x: 36, y: 575, width: 255, height: 120, color: LIGHT, borderColor: BORDER, borderWidth: 0.5 });
  drawText(page, "Fournisseur Japon", 50, 672, bold, 11);
  drawText(page, supplier.name || (supplier as JapanPartnerSettings).partner_name, 50, 650, bold, 10, BLACK, 220);
  drawText(page, supplier.address, 50, 632, font, 9, GREY, 220);
  drawText(page, supplier.email, 50, 606, font, 9, GREY, 220);
  drawText(page, supplier.phone, 50, 590, font, 9, GREY, 220);

  row(page, "N facture", file.invoice_number, 315, 676, font, bold, 244);
  row(page, "Date emission", fmtDate(file.issue_date), 315, 646, font, bold, 244);
  row(page, "Date echeance", fmtDate(file.due_date), 315, 616, font, bold, 244);
  row(page, "Reference", file.payment_reference, 315, 586, font, bold, 244);

  const tableY = 520;
  page.drawRectangle({ x: 36, y: tableY, width: 523, height: 28, color: BLACK });
  ["Description", "Qté", "Prix unitaire", "TVA", "Total"].forEach((label, index) => {
    const xs = [48, 300, 350, 435, 480];
    page.drawText(label, { x: xs[index], y: tableY + 10, size: 9, font: bold, color: rgb(1, 1, 1) });
  });
  page.drawRectangle({ x: 36, y: tableY - 42, width: 523, height: 42, borderColor: BORDER, borderWidth: 0.5 });
  drawText(page, `Prestation voyage Japon - ${tripTitle}`, 48, tableY - 24, font, 9, BLACK, 245);
  drawText(page, participantCount, 303, tableY - 24, font, 9);
  drawText(page, fmtJPY(unitPriceJpy), 350, tableY - 24, font, 9);
  drawText(page, `${taxPercent || 0}%`, 440, tableY - 24, font, 9);
  drawText(page, fmtJPY(subtotal + tax), 482, tableY - 24, bold, 9);

  row(page, "Sous-total", fmtJPY(subtotal), 315, 420, font, bold, 244);
  row(page, "Taxe", fmtJPY(tax), 315, 390, font, bold, 244);
  row(page, "% paiement", `${Number(file.payment_percentage || 0)}%`, 315, 360, font, bold, 244);
  row(page, "Montant a payer", fmtJPY(amountDue), 315, 330, font, bold, 244);
  row(page, "Deja paye", fmtJPY(alreadyPaid), 315, 300, font, bold, 244);
  row(page, "Solde restant", fmtJPY(remaining), 315, 270, font, bold, 244);

  page.drawText("Coordonnees bancaires", { x: 36, y: 430, size: 12, font: bold });
  [
    ["Banque", supplier.bank_name],
    ["Code banque", supplier.bank_code],
    ["Agence", [supplier.branch_name, supplier.branch_code].filter(Boolean).join(" - ")],
    ["Type compte", supplier.account_type],
    ["Numero compte", supplier.account_number],
    ["Nom compte", supplier.account_holder || (supplier as JapanPartnerSettings).account_name],
  ].forEach(([label, value], index) => row(page, label, value, 36, 400 - index * 30, font, bold, 250));

  if (file.notes) {
    page.drawText("Notes", { x: 36, y: 190, size: 11, font: bold });
    drawText(page, file.notes, 36, 170, font, 9, GREY, 520);
  }
  footer(page, font);
  return await pdf.save();
}

export async function generateParticipantsListPdf(tripTitle: string, participants: InternationalPaymentParticipant[]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage(pageSize);
  let y = 730;
  header(page, "Liste des participants", tripTitle, font, bold);
  page.drawText(`Participants: ${participants.length}`, { x: 36, y: 748, size: 11, font: bold });
  page.drawText("Moroccan Express Travel and Events", { x: 380, y: 748, size: 9, font: bold, color: ORANGE });

  const drawHeader = () => {
    page.drawRectangle({ x: 36, y, width: 523, height: 24, color: LIGHT, borderColor: BORDER, borderWidth: 0.5 });
    ["Nom", "Passeport", "Nationalite", "Naissance", "Reservation", "Chambre"].forEach((label, index) => {
      const xs = [42, 184, 270, 345, 420, 500];
      page.drawText(label, { x: xs[index], y: y + 8, size: 7.5, font: bold, color: BLACK });
    });
    y -= 24;
  };
  drawHeader();
  participants.forEach((participant) => {
    if (y < 70) {
      footer(page, font);
      page = pdf.addPage(pageSize);
      header(page, "Liste participants", tripTitle, font, bold);
      y = 730;
      drawHeader();
    }
    page.drawRectangle({ x: 36, y, width: 523, height: 24, borderColor: BORDER, borderWidth: 0.35 });
    const values = [participant.full_name, participant.passport_no, participant.nationality, fmtDate(participant.birth_date || participant.date_of_birth), participant.booking_reference, participant.room_type];
    const xs = [42, 184, 270, 345, 420, 500];
    values.forEach((value, index) => drawText(page, value || "-", xs[index], y + 8, font, 7.5, BLACK, index === 0 ? 132 : 72));
    y -= 24;
  });
  footer(page, font);
  return await pdf.save();
}

export async function generateSubrogationPdf({
  participant,
  amountMad,
  place,
  signatureDate,
  agencyName,
  notes,
}: {
  participant: InternationalPaymentParticipant;
  amountMad: number;
  place: string;
  signatureDate: string;
  agencyName: string;
  notes?: string | null;
}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage(pageSize);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  header(page, "Acte de subrogation", participant.full_name, font, bold);
  page.drawText("ACTE DE SUBROGATION", { x: 170, y: 720, size: 18, font: bold, color: BLACK });
  const body = [
    `Je soussigne(e) ${participant.full_name}, titulaire du passeport/CIN ${participant.passport_no || participant.cin || "________________"}, demeurant a ${[participant.address, participant.city].filter(Boolean).join(", ") || "________________"},`,
    `autorise ${agencyName || "Moroccan Express Travel and Events"} a effectuer, pour mon compte, les demarches et paiements necessaires lies au voyage au Japon.`,
    `Le montant concerne par la presente subrogation est de ${fmtMAD(amountMad)} par participant.`,
    "Cette autorisation est etablie pour servir et valoir ce que de droit dans le cadre du dossier bancaire international.",
  ];
  let y = 650;
  body.forEach((line) => {
    drawText(page, line, 58, y, font, 11, BLACK, 480);
    y -= 58;
  });
  if (notes) {
    page.drawText("Notes", { x: 58, y: 360, size: 11, font: bold });
    drawText(page, notes, 58, 340, font, 9, GREY, 480);
  }
  page.drawRectangle({ x: 58, y: 150, width: 220, height: 86, borderColor: BORDER, borderWidth: 0.7 });
  page.drawText("Signature du participant", { x: 70, y: 215, size: 9, font, color: GREY });
  page.drawRectangle({ x: 330, y: 150, width: 185, height: 86, borderColor: BORDER, borderWidth: 0.7 });
  page.drawText("Cachet agence", { x: 345, y: 215, size: 9, font, color: GREY });
  page.drawText(`Signe electroniquement le ${fmtDate(signatureDate)} a ${place || "________________"}`, { x: 58, y: 108, size: 10, font: bold });
  page.drawText("Moroccan Express Travel & Events", { x: 58, y: 88, size: 9, font, color: GREY });
  footer(page, font);
  return await pdf.save();
}

export async function mergePdfBytes(files: Uint8Array[]) {
  const merged = await PDFDocument.create();
  for (const file of files) {
    const source = await PDFDocument.load(file);
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  return await merged.save();
}

export async function exportInternationalPaymentWorkbook(filename: string, sheets: Array<{ name: string; rows: Record<string, unknown>[] }>) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  sheets.forEach((sheet) => {
    const rows = sheet.rows.length ? sheet.rows : [{ Information: "Aucune donnée" }];
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31));
  });
  XLSX.writeFile(workbook, filename);
}
