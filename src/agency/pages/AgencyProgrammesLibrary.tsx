import { useEffect, useState } from "react";
import { Download, Loader2, Printer } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { fmtDateTime } from "@/lib/format";
import { downloadBytes } from "@/lib/booking-pdfs";
import { compactProgrammeSummary, normalizeProgrammeContentList } from "@/lib/programme-content";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { trackEvent } from "@/lib/analytics";

type DbClient = { from: (table: string) => any };
const db = supabase as unknown as DbClient;

type ProgrammeDay = {
  id: string;
  programme_id: string;
  day_number: number;
  title: string;
  city: string | null;
  description: string | null;
  included_items: string[] | null;
  schedule_items: string[] | null;
  sort_order: number | null;
};

type Programme = {
  id: string;
  title: string;
  subtitle: string | null;
  introduction: string | null;
  duration: string | null;
  duration_days: number | null;
  pdf_url: string | null;
  sort_order: number | null;
  rich_days: ProgrammeDay[];
};

const wrapText = (text: string, maxChars = 88) => {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });
  if (current) lines.push(current);
  return lines;
};

export default function AgencyProgrammesLibrary() {
  const [searchParams] = useSearchParams();
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [activeId, setActiveId] = useState<string | null>(searchParams.get("programme"));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadProgrammes = async () => {
      setLoading(true);
      const { data: programmeRows, error: programmeError } = await db
        .from("programmes")
        .select("*")
        .eq("is_published", true)
        .order("sort_order", { ascending: true });

      if (programmeError) {
        setError(programmeError.message);
        setProgrammes([]);
        setLoading(false);
        return;
      }

      const ids = (programmeRows ?? []).map((programme: any) => programme.id);
      const { data: dayRows, error: dayError } = ids.length
        ? await db
            .from("programme_days")
            .select("*")
            .in("programme_id", ids)
            .eq("is_active", true)
            .order("day_number", { ascending: true })
        : { data: [], error: null };

      if (dayError) {
        setError(dayError.message);
      } else {
        setError(null);
      }

      const list = (programmeRows ?? []).map((programme: any) => ({
        ...programme,
        rich_days: (dayRows ?? [])
          .filter((day: any) => day.programme_id === programme.id)
          .sort((a: any, b: any) => Number(a.day_number || 0) - Number(b.day_number || 0))
          .map((day: any) => ({
            ...day,
            included_items: normalizeProgrammeContentList(day.included_items),
            schedule_items: normalizeProgrammeContentList(day.schedule_items),
          })),
      })) as Programme[];

      setProgrammes(list);
      setActiveId((current) => current && list.some((programme) => programme.id === current) ? current : list[0]?.id ?? null);
      setLoading(false);
    };
    void loadProgrammes();
  }, []);

  const activeProgramme = programmes.find((programme) => programme.id === activeId) ?? null;

  const downloadSummaryPdf = async () => {
    if (!activeProgramme) return;
    trackEvent("pdf_downloaded", {
      source: "agency_programmes_library_summary",
      pdf_type: "programme_summary",
      programme_id: activeProgramme.id,
    });
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 42;
    let page = pdfDoc.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin;

    const ensureSpace = (height: number) => {
      if (y - height >= margin) return;
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    };
    const drawLine = (text: string, size = 10, fontFace = font, color = rgb(0.13, 0.13, 0.13)) => {
      page.drawText(text, { x: margin, y, size, font: fontFace, color });
      y -= size + 5;
    };

    drawLine("LeJapon.ma", 11, bold, rgb(0.9, 0.33, 0.08));
    drawLine(activeProgramme.title || "Programme", 20, bold);
    drawLine(activeProgramme.duration_days ? `${activeProgramme.duration_days} jours` : activeProgramme.duration || "Programme", 11);
    if (activeProgramme.subtitle) drawLine(activeProgramme.subtitle, 10);
    if (activeProgramme.introduction) {
      y -= 4;
      wrapText(activeProgramme.introduction, 94).slice(0, 5).forEach((line) => drawLine(line, 9));
    }
    y -= 10;

    activeProgramme.rich_days
      .sort((a, b) => Number(a.day_number || 0) - Number(b.day_number || 0))
      .forEach((day) => {
        ensureSpace(72);
        page.drawRectangle({ x: margin, y: y - 9, width: pageWidth - margin * 2, height: 1, color: rgb(0.9, 0.9, 0.9) });
        y -= 18;
        drawLine(`Jour ${day.day_number} - ${day.title || "Programme à compléter"}`, 11, bold);
        if (day.city) drawLine(`Ville: ${day.city}`, 9);
        wrapText(compactProgrammeSummary(day.schedule_items?.length ? day.schedule_items : day.description), 96)
          .slice(0, 3)
          .forEach((line) => drawLine(line, 9));
        if (day.included_items?.length) drawLine(`Inclus: ${day.included_items.slice(0, 3).join(" · ")}`, 8);
        y -= 4;
      });

    page.drawText(`Généré le ${fmtDateTime(new Date().toISOString())}`, {
      x: margin,
      y: 24,
      size: 8,
      font,
      color: rgb(0.45, 0.45, 0.45),
    });
    const bytes = await pdfDoc.save();
    downloadBytes(bytes, `programme-resume-${activeProgramme.id.slice(0, 8)}.pdf`);
  };

  return (
    <div className="space-y-6">
      <style>{`
        @media print {
          .agency-programme-sidebar, .agency-programme-actions { display: none !important; }
          .agency-programme-shell { display: block !important; }
          .agency-programme-day { break-inside: avoid; box-shadow: none !important; border: 1px solid #ddd !important; padding: 14px !important; }
          .agency-programme-title { font-size: 22px !important; }
          body { background: white !important; }
        }
      `}</style>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl">Programmes</h1>
          <p className="mt-1 text-sm text-muted-foreground">Lecture jour par jour des programmes publics.</p>
        </div>
        <div className="agency-programme-actions flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => window.print()} disabled={!activeProgramme}>
            <Printer className="h-4 w-4" />
            Imprimer
          </Button>
          <Button variant="outline" onClick={downloadSummaryPdf} disabled={!activeProgramme}>
            <Download className="h-4 w-4" />
            Télécharger programme résumé PDF
          </Button>
          {activeProgramme?.pdf_url && (
            <Button asChild>
              <a
                href={activeProgramme.pdf_url}
                target="_blank"
                rel="noreferrer"
                onClick={() => trackEvent("pdf_downloaded", {
                  source: "agency_programmes_library_attached",
                  pdf_type: "programme",
                  programme_id: activeProgramme.id,
                })}
              >
                Télécharger PDF programme <Download className="h-4 w-4" />
              </a>
            </Button>
          )}
        </div>
      </div>

      {error && <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{error}</Card>}
      {loading ? (
        <Card className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement des programmes…
        </Card>
      ) : programmes.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">Aucun programme public disponible.</Card>
      ) : (
        <div className="agency-programme-shell grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <Card className="agency-programme-sidebar h-fit p-3">
            <div className="space-y-2">
              {programmes.map((programme) => (
                <button
                  key={programme.id}
                  type="button"
                  onClick={() => setActiveId(programme.id)}
                  className={`w-full rounded-lg px-3 py-3 text-left text-sm transition ${programme.id === activeId ? "bg-accent text-accent-foreground" : "hover:bg-secondary"}`}
                >
                  <span className="block font-medium">{programme.title}</span>
                  <span className="text-xs opacity-80">{programme.duration_days ? `${programme.duration_days} jours` : programme.duration || "Programme"}</span>
                </button>
              ))}
            </div>
          </Card>

          {activeProgramme && (
            <div className="space-y-5">
              <Card className="p-6">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-accent">{activeProgramme.duration_days ? `${activeProgramme.duration_days} jours` : activeProgramme.duration}</p>
                <h2 className="agency-programme-title mt-2 font-display text-3xl">{activeProgramme.title}</h2>
                {activeProgramme.subtitle && <p className="mt-2 text-muted-foreground">{activeProgramme.subtitle}</p>}
                {activeProgramme.introduction && <p className="mt-4 whitespace-pre-line text-sm text-muted-foreground">{activeProgramme.introduction}</p>}
              </Card>

              {activeProgramme.rich_days.length === 0 ? (
                <Card className="p-8 text-center text-sm text-muted-foreground">Programme détaillé bientôt disponible.</Card>
              ) : (
                <div className="space-y-3">
                  {activeProgramme.rich_days.map((day) => (
                    <Card key={day.id} className="agency-programme-day p-5">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-[0.12em] text-accent">Jour {day.day_number}</p>
                          <h3 className="mt-1 font-display text-2xl">{day.title || "Programme à compléter"}</h3>
                          {day.city && <p className="text-sm text-muted-foreground">{day.city}</p>}
                        </div>
                      </div>
                      <p className="mt-3 whitespace-pre-line text-sm text-muted-foreground">{day.description || "À compléter"}</p>
                      {day.schedule_items?.length > 0 && (
                        <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                          {day.schedule_items.map((item, index) => <li key={`${day.id}-${index}`}>- {item}</li>)}
                        </ul>
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
