import { useEffect, useState } from "react";
import { Download, Loader2, Printer } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

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

const normaliseList = (value: unknown): string[] => Array.isArray(value) ? value.filter(Boolean).map(String) : [];

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
            included_items: normaliseList(day.included_items),
            schedule_items: normaliseList(day.schedule_items),
          })),
      })) as Programme[];

      setProgrammes(list);
      setActiveId((current) => current && list.some((programme) => programme.id === current) ? current : list[0]?.id ?? null);
      setLoading(false);
    };
    void loadProgrammes();
  }, []);

  const activeProgramme = programmes.find((programme) => programme.id === activeId) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl">Programmes</h1>
          <p className="mt-1 text-sm text-muted-foreground">Lecture jour par jour des programmes publics.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => window.print()} disabled={!activeProgramme}>
            <Printer className="h-4 w-4" />
            Imprimer
          </Button>
          {activeProgramme?.pdf_url && (
            <Button asChild>
              <a href={activeProgramme.pdf_url} target="_blank" rel="noreferrer">
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
        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <Card className="h-fit p-3">
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
                <h2 className="mt-2 font-display text-3xl">{activeProgramme.title}</h2>
                {activeProgramme.subtitle && <p className="mt-2 text-muted-foreground">{activeProgramme.subtitle}</p>}
                {activeProgramme.introduction && <p className="mt-4 whitespace-pre-line text-sm text-muted-foreground">{activeProgramme.introduction}</p>}
              </Card>

              {activeProgramme.rich_days.length === 0 ? (
                <Card className="p-8 text-center text-sm text-muted-foreground">Programme détaillé bientôt disponible.</Card>
              ) : (
                <div className="space-y-3">
                  {activeProgramme.rich_days.map((day) => (
                    <Card key={day.id} className="p-5">
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
                          {day.schedule_items.map((item) => <li key={item}>- {item}</li>)}
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
