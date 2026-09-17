import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "../../components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Search, Calendar, Users } from "lucide-react";
import { fmtDate, fmtMAD } from "@/lib/format";
import TripOperations from "./TripOperations";
import { motion, useReducedMotion } from "framer-motion";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { TripArchiveView, tripsForArchiveView } from "@/lib/trip-archiving";

const displayTripDays = (trip: any) => {
  const total = Number(trip.total_trip_days || trip.duration_days || 0);
  const japan = Number(trip.japan_stay_days || 0);
  if (!total && !japan) return null;
  return `Durée ${total || "—"} j · Japon ${japan || "—"} j`;
};

export default function TripsManagement() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [archiveView, setArchiveView] = useState<TripArchiveView>("active");
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("trips")
        .select("id, title, season, label, start_date, end_date, duration_days, total_trip_days, japan_stay_days, total_slots, slots_left, base_price_mad, status, cover_url, archived_at, archive_reason")
        .order("start_date", { ascending: true });
      setRows(data ?? []);
    })();
  }, []);

  const visibleRows = tripsForArchiveView(rows, archiveView);
  const filtered = visibleRows.filter((t) => {
    const s = q.toLowerCase().trim();
    if (!s) return true;
    return (t.title || "").toLowerCase().includes(s) || (t.season || "").toLowerCase().includes(s) || (t.label || "").toLowerCase().includes(s);
  });

  const selected = rows.find((r) => r.id === selectedId);

  if (selected) {
    return (
      <div>
        <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)} className="mb-4 min-h-11">
          <ArrowLeft className="w-4 h-4" /> Retour aux départs
        </Button>
        <TripOperations trip={selected} />
      </div>
    );
  }

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <PageHeader
        title={archiveView === "archived" ? "Voyages archivés" : "Gestion opérationnelle des départs"}
        description={archiveView === "archived"
          ? "Consultez les données opérationnelles conservées des voyages archivés."
          : "Sélectionnez un départ pour gérer inscrits, chambres, activités et paiements."}
      />

      <Tabs value={archiveView} onValueChange={(value) => { setArchiveView(value as TripArchiveView); setSelectedId(null); }} className="mb-4">
        <TabsList className="grid h-11 w-full grid-cols-2 rounded-xl sm:w-[440px]">
          <TabsTrigger value="active" className="rounded-lg">Opérations actives ({tripsForArchiveView(rows, "active").length})</TabsTrigger>
          <TabsTrigger value="archived" className="rounded-lg">Voyages archivés ({tripsForArchiveView(rows, "archived").length})</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mb-4 rounded-2xl border border-border bg-background p-3 shadow-sm sm:p-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un départ…" className="min-h-11 pl-9" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.length === 0 && (
          <div className="col-span-full text-center text-muted-foreground py-12 bg-background rounded-2xl border border-border">
            Aucun départ trouvé.
          </div>
        )}
        {filtered.map((t) => (
          <button
            key={t.id}
            onClick={() => setSelectedId(t.id)}
            className="group overflow-hidden rounded-2xl border border-border bg-background text-left shadow-sm transition-all hover:border-primary hover:shadow-lg"
          >
            {t.cover_url && <img src={t.cover_url} alt={t.title} className="w-full h-32 object-cover" />}
            <div className="p-4">
              <div className="flex items-center gap-2 mb-2">
                {t.label && <span className="text-xs font-bold tracking-wider text-accent">{t.label}</span>}
                {t.season && <span className="text-xs text-muted-foreground">• {t.season}</span>}
                {t.archived_at && <Badge variant="secondary">Archivé</Badge>}
              </div>
              <h3 className="line-clamp-2 font-display text-lg leading-tight transition-colors group-hover:text-primary">{t.title}</h3>
              <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{fmtDate(t.start_date)}</span>
                <span className="inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" />{t.slots_left}/{t.total_slots}</span>
              </div>
              {displayTripDays(t) && <p className="mt-2 text-xs text-muted-foreground">{displayTripDays(t)}</p>}
              <div className="mt-2 text-sm font-semibold">{fmtMAD(t.base_price_mad)}</div>
            </div>
          </button>
        ))}
      </div>
    </motion.div>
  );
}
