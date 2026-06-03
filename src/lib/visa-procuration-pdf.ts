import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { supabase } from "@/integrations/supabase/client";
import { formatVisaDate } from "@/lib/visa-format";

const BLACK = rgb(0.08, 0.09, 0.12);
const MUTED = rgb(0.38, 0.42, 0.48);
const ORANGE = rgb(0.92, 0.36, 0.08);

const clean = (value: unknown) => String(value ?? "").trim();

const fmtDate = (value?: string | null) => formatVisaDate(value, clean(value));

const fullName = (app: any) =>
  [app?.given_names, app?.surname].map(clean).filter(Boolean).join(" ") || clean(app?.full_name);

const dotted = (value: unknown, minDots = 36) => clean(value) || ".".repeat(minDots);

export async function generateVisaProcurationPdf(app: any): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const width = page.getWidth();

  const draw = (text: unknown, x: number, y: number, size = 11, useBold = false, color = BLACK) => {
    page.drawText(clean(text), { x, y, size, font: useBold ? bold : font, color });
  };
  const line = (label: string, value: unknown, y: number) => {
    draw(label, 64, y, 11, true);
    draw(dotted(value), 210, y, 11);
  };

  page.drawRectangle({ x: 0, y: 817, width, height: 25, color: ORANGE });
  const titleWidth = bold.widthOfTextAtSize("PROCURATION", 26);
  page.drawText("PROCURATION", { x: (width - titleWidth) / 2, y: 760, size: 26, font: bold, color: BLACK });

  draw("Je soussigne(e),", 64, 705, 12);
  line("Nom et Prenom", fullName(app), 670);
  line("Date de naissance", fmtDate(app?.date_of_birth), 640);
  line("Numero de passeport", app?.passport_no, 610);
  line("Adresse", app?.residential_address, 580);
  line("Numero de telephone", app?.residential_mobile || app?.residential_tel, 550);

  draw(
    "donne procuration a Moroccan Express Travel and Events pour effectuer les demarches",
    64,
    505,
    11,
  );
  draw("necessaires au depot et au suivi de mon dossier de visa Japon.", 64, 485, 11);

  draw("Agence mandatee", 64, 435, 13, true, ORANGE);
  line("Societe", "Moroccan Express Travel and Events", 405);
  line("Nom de l'agent", "Hiba Bouchra", 375);
  line("Fonction", "Agent de Reservation", 345);
  line("Adresse de l'agence", "Rue Annour Hay El Wifaq Temara", 315);

  line("Fait a", app?.place_of_signature || app?.residential_city || "", 255);
  line("Le", fmtDate(new Date().toISOString().slice(0, 10)), 225);

  draw("Signature du Client", 64, 165, 12, true);
  page.drawLine({ start: { x: 64, y: 118 }, end: { x: 260, y: 118 }, thickness: 0.8, color: MUTED });

  draw("Document a signer et legaliser avant transmission a l'agence.", 64, 60, 8.5, false, MUTED);
  return await pdf.save();
}

export const isVisaProcurationDocument = (doc: any) =>
  /procuration/i.test(clean(doc?.file_name)) || /generated-procurations/i.test(clean(doc?.storage_path));

export async function upsertVisaProcurationDocument(app: any, userId: string) {
  const bytes = await generateVisaProcurationPdf(app);
  const reference = clean(app?.reference) || "visa";
  const path = `${userId}/${app.id}/generated-procurations/procuration.pdf`;
  const fileName = `${reference}-procuration.pdf`;

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
