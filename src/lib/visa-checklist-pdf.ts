import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { supabase } from "@/integrations/supabase/client";
import { professionalSituationLabel, type VisaChecklistItem } from "@/lib/visa-document-checklists";
import { formatVisaDate } from "@/lib/visa-format";

const BLACK = rgb(0.08, 0.09, 0.12);
const MUTED = rgb(0.38, 0.42, 0.48);
const ORANGE = rgb(0.92, 0.36, 0.08);
const BORDER = rgb(0.84, 0.86, 0.9);
const LIGHT = rgb(0.98, 0.98, 0.97);

const clean = (value: unknown) => String(value ?? "").trim();

const fmtDate = (value?: string | null) => formatVisaDate(value, clean(value));

const fullName = (app: any) =>
  [app?.given_names, app?.surname].map(clean).filter(Boolean).join(" ") || clean(app?.full_name);

function wrap(text: string, maxChars = 82) {
  const words = clean(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) current = next;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function generateVisaChecklistPdf(app: any, items: VisaChecklistItem[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  let page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const width = page.getWidth();
  const draw = (text: unknown, x: number, y: number, size = 10, useBold = false, color = BLACK) => {
    page.drawText(clean(text), { x, y, size, font: useBold ? bold : font, color });
  };
  const newPage = () => {
    page = pdf.addPage([595.28, 841.89]);
    page.drawRectangle({ x: 0, y: 817, width, height: 25, color: ORANGE });
    return 780;
  };

  page.drawRectangle({ x: 0, y: 817, width, height: 25, color: ORANGE });
  draw("LeJapon.ma", 48, 784, 16, true, ORANGE);
  draw("Moroccan Express Travel & Events", 48, 766, 9, false, MUTED);
  draw("LISTE PERSONNALISÉE DES DOCUMENTS À FOURNIR", 48, 724, 18, true);

  page.drawRectangle({ x: 48, y: 626, width: 499, height: 78, color: LIGHT, borderColor: BORDER, borderWidth: 0.8 });
  draw("Client", 64, 684, 9, true, MUTED);
  draw(fullName(app) || "Non renseigné", 64, 666, 11, true);
  draw("Passeport", 265, 684, 9, true, MUTED);
  draw(app?.passport_no || "Non renseigné", 265, 666, 11, true);
  draw("Référence", 64, 642, 9, true, MUTED);
  draw(app?.reference || "Non renseignée", 64, 626 + 14, 10, true);
  draw("Situation", 265, 642, 9, true, MUTED);
  draw(professionalSituationLabel(app?.category), 265, 626 + 14, 10, true);
  draw("Date", 445, 642, 9, true, MUTED);
  draw(fmtDate(app?.submitted_at || app?.date_of_application || new Date().toISOString()), 445, 626 + 14, 10, true);

  let y = 590;
  draw("Documents attendus", 48, y, 13, true, ORANGE);
  y -= 20;

  const list = items.length ? items : [{
    title_fr: "Documents à confirmer avec l'agence",
    notes: "Aucune règle active n'est configurée pour cette situation.",
    required: true,
    original_required: false,
    copy_upload_required: false,
    active: true,
    display_order: 1,
  }];

  for (const item of list) {
    if (y < 110) y = newPage();
    const notes = item.notes ? wrap(item.notes, 76) : [];
    const rowHeight = Math.max(54, 42 + notes.length * 11);
    page.drawRectangle({ x: 48, y: y - rowHeight + 10, width: 499, height: rowHeight, borderColor: BORDER, borderWidth: 0.6 });
    page.drawRectangle({ x: 64, y: y - 14, width: 10, height: 10, borderColor: BLACK, borderWidth: 0.8 });
    draw(item.title_fr, 86, y - 14, 10.5, true);
    const flags = [
      item.original_required ? "Original requis" : null,
      item.copy_upload_required ? "Copie / scan requis" : null,
      item.required ? "Obligatoire" : "Si applicable",
    ].filter(Boolean).join(" · ");
    draw(flags, 86, y - 30, 8.5, false, MUTED);
    notes.forEach((line, index) => draw(line, 86, y - 44 - index * 11, 8.5, false, MUTED));
    y -= rowHeight + 8;
  }

  draw("Les documents originaux doivent être envoyés ou déposés à l'agence Moroccan Express Travel and Events.", 48, 58, 8.5, false, MUTED);
  return await pdf.save();
}

export const isVisaChecklistDocument = (doc: any) =>
  /liste.*documents|checklist/i.test(clean(doc?.file_name)) || /generated-checklists/i.test(clean(doc?.storage_path));

export async function upsertVisaChecklistDocument(app: any, userId: string, items: VisaChecklistItem[]) {
  const bytes = await generateVisaChecklistPdf(app, items);
  const reference = clean(app?.reference) || "visa";
  const path = `${userId}/${app.id}/generated-checklists/checklist.pdf`;
  const fileName = `${reference}-liste-documents.pdf`;

  const { error: uploadError } = await supabase.storage.from("visa-docs").upload(path, bytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (uploadError) throw uploadError;

  const { data: existing } = await supabase
    .from("visa_documents")
    .select("*")
    .eq("application_id", app.id)
    .eq("storage_path", path)
    .maybeSingle();

  const payload = {
    application_id: app.id,
    user_id: userId,
    doc_type: "other" as any,
    storage_path: path,
    file_name: fileName,
    mime_type: "application/pdf",
    size_bytes: bytes.length,
  };

  const result = existing?.id
    ? await supabase.from("visa_documents").update(payload).eq("id", existing.id).select("*").single()
    : await supabase.from("visa_documents").insert(payload).select("*").single();
  if (result.error) throw result.error;
  return result.data;
}
