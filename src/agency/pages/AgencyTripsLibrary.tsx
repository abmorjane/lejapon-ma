import { useEffect, useMemo, useState } from "react";
import { Download, Eye, Loader2 } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Img } from "@/components/ui/Img";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate, fmtMAD } from "@/lib/format";
import { downloadBytes } from "@/lib/booking-pdfs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { toast } from "sonner";

type DbClient = { from: (table: string) => any };
const db = supabase as unknown as DbClient;

type AgencyTrip = {
  id: string;
  title: string;
  slug: string | null;
  label: string | null;
  season: string | null;
  start_date: string | null;
  end_date: string | null;
  duration_days: number | null;
  base_price_mad: number | null;
  currency: string | null;
  cover_url: string | null;
  cover_alt: string | null;
  slots_left: number | null;
  highlights: string[] | null;
  destinations: string[] | null;
  destination: string | null;
  status: string | null;
  program_link: string | null;
  programme_id: string | null;
  programmes?: { id: string; title: string; pdf_url: string | null } | null;
};

const tripColumns = [
  "id",
  "title",
  "slug",
  "label",
  "season",
  "start_date",
  "end_date",
  "duration_days",
  "base_price_mad",
  "currency",
  "cover_url",
  "cover_alt",
  "slots_left",
  "highlights",
  "destinations",
  "destination",
  "status",
  "program_link",
  "programme_id",
  "programmes:programme_id(id,title,pdf_url)",
].join(",");

const formatTripDates = (trip: AgencyTrip) => {
  if (trip.start_date && trip.end_date) return `${fmtDate(trip.start_date)} → ${fmtDate(trip.end_date)}`;
  if (trip.start_date || trip.end_date) return fmtDate(trip.start_date ?? trip.end_date);
  return trip.season || "—";
};

const wrapText = (text: string, maxChars = 82) => {
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

const generateTripPdf = async (trip: AgencyTrip) => {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.addPage([595.28, 841.89]);
  const margin = 48;
  let y = 790;
  const draw = (text: string, size = 10, fontFace = font, color = rgb(0.12, 0.12, 0.14)) => {
    page.drawText(text, { x: margin, y, size, font: fontFace, color });
    y -= size + 7;
  };

  draw("LeJapon.ma", 12, bold, rgb(0.9, 0.33, 0.08));
  draw(trip.title || "Voyage", 22, bold);
  if (trip.label || trip.season) draw(trip.label || trip.season || "", 11, bold);
  y -= 8;
  draw(`Destination: ${(trip.destinations?.length ? trip.destinations.join(", ") : trip.destination) || "À confirmer"}`);
  draw(`Dates: ${formatTripDates(trip)}`);
  draw(`Durée: ${trip.duration_days ? `${trip.duration_days} jours` : "À confirmer"}`);
  draw(`Prix: ${trip.base_price_mad === null || trip.base_price_mad === undefined ? "Prix non renseigné" : fmtMAD(trip.base_price_mad)}`);
  draw(`Places disponibles: ${trip.slots_left ?? "À confirmer"}`);
  y -= 12;
  draw("Points forts", 13, bold);
  const highlights = (trip.highlights ?? []).filter(Boolean);
  if (highlights.length === 0) {
    draw("Programme détaillé disponible sur demande.", 10);
  } else {
    highlights.slice(0, 12).forEach((item) => {
      wrapText(`- ${item}`, 92).forEach((line) => draw(line, 9));
    });
  }
  y -= 10;
  draw("Informations commerciales", 13, bold);
  wrapText("Cette fiche est destinée aux partenaires agences. Les conditions, disponibilités et prestations exactes restent soumises à validation par LeJapon.ma.", 92)
    .forEach((line) => draw(line, 9));
  const bytes = await pdfDoc.save();
  downloadBytes(bytes, `voyage-${trip.slug || trip.id.slice(0, 8)}.pdf`);
};

export default function AgencyTripsLibrary() {
  const [searchParams] = useSearchParams();
  const [trips, setTrips] = useState<AgencyTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [destination, setDestination] = useState("all");

  useEffect(() => {
    const loadTrips = async () => {
      setLoading(true);
      const { data, error } = await db
        .from("trips")
        .select(tripColumns)
        .in("status", ["open", "completed"])
        .order("sort_order", { ascending: true })
        .order("start_date", { ascending: true, nullsFirst: false });

      if (error) {
        setError(error.message);
        setTrips([]);
      } else {
        setError(null);
        setTrips((data ?? []) as AgencyTrip[]);
      }
      setLoading(false);
    };
    void loadTrips();
  }, []);

  const highlightedTripId = searchParams.get("trip");
  const destinations = useMemo(() => {
    const list = trips.flatMap((trip) => trip.destinations?.length ? trip.destinations : [trip.destination]).filter(Boolean) as string[];
    return Array.from(new Set(list)).sort();
  }, [trips]);
  const visibleTrips = destination === "all"
    ? trips
    : trips.filter((trip) => [trip.destination, ...(trip.destinations ?? [])].includes(destination));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Voyages</h1>
        <p className="mt-1 text-sm text-muted-foreground">Bibliothèque commerciale des voyages actifs et publics.</p>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap gap-2">
          <Button variant={destination === "all" ? "default" : "outline"} onClick={() => setDestination("all")}>Toutes destinations</Button>
          {destinations.map((item) => (
            <Button key={item} variant={destination === item ? "default" : "outline"} onClick={() => setDestination(item)}>{item}</Button>
          ))}
        </div>
      </Card>

      {error && <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{error}</Card>}
      {loading ? (
        <Card className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement des voyages…
        </Card>
      ) : visibleTrips.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">Aucun voyage actif disponible.</Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {visibleTrips.map((trip) => {
            const programmePdf = trip.programmes?.pdf_url;
            return (
              <Card key={trip.id} className={`overflow-hidden ${highlightedTripId === trip.id ? "ring-2 ring-accent" : ""}`}>
                <div className="grid gap-0 md:grid-cols-[240px_minmax(0,1fr)]">
                  <Img src={trip.cover_url || "/placeholder.svg"} alt={trip.cover_alt || trip.title} className="h-full min-h-56 w-full object-cover" />
                  <div className="space-y-4 p-5">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-[0.12em] text-accent">{trip.label || trip.season || "Voyage"}</p>
                      <h2 className="mt-2 font-display text-2xl">{trip.title}</h2>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {(trip.destinations?.length ? trip.destinations.join(", ") : trip.destination) || "Destination à confirmer"}
                      </p>
                    </div>
                    <div className="grid gap-2 text-sm sm:grid-cols-2">
                      <span>Durée: {trip.duration_days ? `${trip.duration_days} jours` : "—"}</span>
                      <span>Dates: {formatTripDates(trip)}</span>
                      <span>Prix: {trip.base_price_mad === null || trip.base_price_mad === undefined ? "Prix non renseigné" : fmtMAD(trip.base_price_mad)}</span>
                      <span>Places: {trip.slots_left ?? "—"}</span>
                    </div>
                    {(trip.highlights ?? []).length > 0 && (
                      <div>
                        <p className="text-sm font-medium">Inclus / points forts</p>
                        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                          {trip.highlights?.slice(0, 5).map((item) => <li key={item}>- {item}</li>)}
                        </ul>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">Non inclus: selon conditions de vente et programme détaillé.</p>
                    <div className="flex flex-wrap gap-2">
                      {trip.slug && (
                        <Button asChild variant="outline" size="sm">
                          <Link to={`/voyages?trip=${trip.slug}`} target="_blank">
                            Voir public <Eye className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      )}
                      <Button size="sm" onClick={() => generateTripPdf(trip)}>
                        Télécharger PDF voyage <Download className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (!programmePdf) {
                            toast.info("Aucun PDF programme n'est attaché à ce voyage.");
                            return;
                          }
                          window.open(programmePdf, "_blank", "noopener,noreferrer");
                        }}
                      >
                        Télécharger PDF programme <Download className="h-3.5 w-3.5" />
                      </Button>
                      {trip.programme_id && (
                        <Button asChild variant="outline" size="sm">
                          <Link to={`/agency/programmes?programme=${trip.programme_id}`}>
                            Voir le programme
                          </Link>
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
