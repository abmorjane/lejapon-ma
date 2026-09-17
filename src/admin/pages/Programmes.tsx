import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "../components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Upload, FileText, Loader2, ExternalLink, Save, Image as ImageIcon, Copy, ChevronUp, ChevronDown, Archive } from "lucide-react";
import { toast } from "sonner";
import { DayIcon } from "@/components/programmes/DayIcon";
import { optimizeImage } from "@/lib/image-upload";
import { slugify } from "@/lib/format";

type Day = { day: number; title: string; city?: string; description?: string };
type Programme = {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  introduction: string;
  hero_image_url: string | null;
  hero_alt: string | null;
  cta_label: string;
  cta_url: string;
  meta_description: string | null;
  duration: string;
  cities: string[];
  description: string;
  days: Day[];
  pdf_url: string | null;
  pdf_path: string | null;
  is_published: boolean;
  sort_order: number;
  archived_at?: string | null;
  archived_by?: string | null;
};

type TripOption = {
  id: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  duration_days: number | null;
  programme_id: string | null;
};

type ScheduleItem = { time: string; title: string; description?: string };
type IncludedItem = { icon?: string; label: string };
type ProgrammeDay = {
  id: string;
  programme_id: string;
  day_number: number;
  city: string;
  badge: string | null;
  title: string;
  description: string;
  main_image_url: string | null;
  gallery_images: string[];
  schedule_items: ScheduleItem[];
  included_items: IncludedItem[];
  icons: string[];
  special_note: string | null;
  is_optional: boolean;
  is_active: boolean;
  sort_order: number;
};

const ICON_OPTIONS: { id: string; label: string }[] = [
  { id: "bus", label: "Bus privé" },
  { id: "train", label: "Train" },
  { id: "shinkansen", label: "Shinkansen" },
  { id: "plane", label: "Vol" },
  { id: "guide", label: "Guide" },
  { id: "meal", label: "Repas" },
  { id: "hotel", label: "Hôtel" },
  { id: "free", label: "Journée libre" },
  { id: "option", label: "Option" },
  { id: "walk", label: "À pied" },
  { id: "boat", label: "Bateau" },
];

const PUBLIC_PROGRAMME_SLUGS = new Set(["programme-1", "programme-2"]);

const isPublicProgrammePreset = (programme: Programme) => PUBLIC_PROGRAMME_SLUGS.has(programme.slug);

const parseDurationDays = (value: unknown) => {
  const match = String(value ?? "").match(/\d+/);
  return match ? Number(match[0]) : 0;
};

export default function Programmes() {
  const [rows, setRows] = useState<Programme[]>([]);
  const [trips, setTrips] = useState<TripOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<string>("");
  const [highlightedProgrammeId, setHighlightedProgrammeId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = async (nextActive?: string) => {
    setLoading(true);
    const [{ data, error }, { data: tripRows }] = await Promise.all([
      supabase
        .from("programmes")
        .select("*")
        .order("sort_order"),
      supabase
        .from("trips")
        .select("id,title,start_date,end_date,duration_days,programme_id")
        .is("archived_at", null)
        .order("start_date", { ascending: false }),
    ]);
    if (error) toast.error(error.message);
    const list = (data ?? []).map((r: any) => ({
      ...r,
      cities: r.cities ?? [],
      days: Array.isArray(r.days) ? r.days : [],
    })) as Programme[];
    setRows(list);
    setTrips((tripRows ?? []) as TripOption[]);
    if (nextActive) setActive(nextActive);
    else if (list.length && !active) setActive(list.find(isPublicProgrammePreset)?.id ?? "custom");
    setLoading(false);
  };

  const handleCustomProgrammeCreated = async (programmeId?: string) => {
    setHighlightedProgrammeId(programmeId ?? null);
    await load("custom");
    if (programmeId) {
      window.setTimeout(() => {
        document.getElementById(`custom-programme-${programmeId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Chargement…
      </div>
    );
  }

  const publicProgrammes = rows.filter(isPublicProgrammePreset);
  const customProgrammes = rows.filter((r) => !isPublicProgrammePreset(r) && (showArchived || !r.archived_at));

  return (
    <div>
      <PageHeader
        title="Programmes"
        description="Modifiez le contenu des programmes affichés sur la page publique /programme."
      />
      {rows.length === 0 ? (
        <div className="text-muted-foreground">Aucun programme.</div>
      ) : (
        <Tabs value={active} onValueChange={setActive} className="space-y-6">
          <TabsList>
            {publicProgrammes.map((r) => (
              <TabsTrigger key={r.id} value={r.id}>
                {r.title}
              </TabsTrigger>
            ))}
            <TabsTrigger value="custom">Programmes personnalisés</TabsTrigger>
          </TabsList>
          {publicProgrammes.map((r) => (
            <TabsContent key={r.id} value={r.id}>
              <ProgrammeEditor initial={r} onSaved={load} />
            </TabsContent>
          ))}
          <TabsContent value="custom" className="space-y-6">
            <CustomProgrammeCreator programmes={rows} trips={trips} onCreated={handleCustomProgrammeCreated} />
            <div className="flex items-center justify-end gap-3 rounded-xl border border-border bg-background p-3">
              <Switch checked={showArchived} onCheckedChange={setShowArchived} />
              <Label className="text-sm">Afficher archivés</Label>
            </div>
            {customProgrammes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-background p-6 text-sm text-muted-foreground">
                Aucun programme personnalisé. Créez un programme pour un voyage spécial ou privé.
              </div>
            ) : (
              customProgrammes.map((r) => (
                <section
                  key={r.id}
                  id={`custom-programme-${r.id}`}
                  className={`rounded-2xl border border-border bg-secondary/20 p-4 ${highlightedProgrammeId === r.id ? "ring-2 ring-accent/40" : ""}`}
                >
                  <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {r.is_published ? "Public" : "Admin only"} · Programme personnalisé
                      </p>
                      <h2 className="font-display text-xl">{r.title}</h2>
                    </div>
                    <div className="flex flex-col items-start gap-2 sm:items-end">
                      <LinkedTrips programmeId={r.id} trips={trips} />
                      <ProgrammeRemovalActions programme={r} trips={trips} onChanged={() => load("custom")} />
                    </div>
                  </div>
                  <ProgrammeEditor initial={r} onSaved={load} />
                </section>
              ))
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function CustomProgrammeCreator({
  programmes,
  trips,
  onCreated,
}: {
  programmes: Programme[];
  trips: TripOption[];
  onCreated: (programmeId?: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [title, setTitle] = useState("");
  const [durationDays, setDurationDays] = useState(25);
  const [subtitle, setSubtitle] = useState("");
  const [intro, setIntro] = useState("");
  const [visibility, setVisibility] = useState<"public" | "admin_only">("admin_only");
  const [tripId, setTripId] = useState("none");
  const [sourceProgrammeId, setSourceProgrammeId] = useState(programmes[0]?.id ?? "");
  const [duplicateTitle, setDuplicateTitle] = useState("");
  const [duplicateDurationDays, setDuplicateDurationDays] = useState(25);
  const [duplicateVisibility, setDuplicateVisibility] = useState<"public" | "admin_only">("admin_only");

  const programmeLabel = (programme: Programme) => {
    if (programme.slug === "programme-1") return "Programme (17 jours)";
    if (programme.slug === "programme-2") return "Programme (13 jours)";
    return programme.title;
  };

  const selectedSource = programmes.find((programme) => programme.id === sourceProgrammeId);

  const openDuplicateForm = () => {
    const source = selectedSource ?? programmes[0];
    if (source) {
      const days = parseDurationDays(source.duration) || 25;
      setSourceProgrammeId(source.id);
      setDuplicateTitle(`${source.title} personnalisé`);
      setDuplicateDurationDays(days);
    }
    setDuplicateOpen((value) => !value);
  };

  const create = async () => {
    const cleanTitle = title.trim();
    const days = Math.max(1, Number(durationDays || 1));
    if (!cleanTitle) return toast.error("Titre requis.");
    setSaving(true);
    const baseSlug = slugify(cleanTitle) || "programme-personnalise";
    const slug = `${baseSlug}-${Date.now().toString().slice(-6)}`;
    const sortOrder = Math.max(0, ...programmes.map((p) => p.sort_order ?? 0)) + 10;
    const { data, error } = await supabase
      .from("programmes")
      .insert({
        slug,
        title: cleanTitle,
        duration: `${days} jours`,
        subtitle: subtitle.trim(),
        introduction: intro.trim(),
        description: intro.trim(),
        cities: [],
        days: [],
        is_published: visibility === "public",
        sort_order: sortOrder,
        cta_label: "Demander un devis",
        cta_url: "/contact",
      })
      .select("*")
      .single();

    if (error || !data) {
      setSaving(false);
      return toast.error(error?.message ?? "Création impossible.");
    }

    const dayRows = Array.from({ length: days }, (_, index) => ({
      programme_id: data.id,
      day_number: index + 1,
      sort_order: (index + 1) * 10,
      title: "",
      city: "",
      description: "",
    }));
    const { error: daysError } = await supabase.from("programme_days").insert(dayRows);
    if (daysError) toast.error(daysError.message);

    if (tripId !== "none") {
      const { error: tripError } = await supabase.from("trips").update({ programme_id: data.id }).eq("id", tripId);
      if (tripError) toast.error(tripError.message);
    }

    setTitle("");
    setDurationDays(25);
    setSubtitle("");
    setIntro("");
    setVisibility("admin_only");
    setTripId("none");
    setOpen(false);
    setSaving(false);
    toast.success("Programme personnalisé créé");
    onCreated(data.id);
  };

  const duplicateFromSource = async () => {
    const source = programmes.find((programme) => programme.id === sourceProgrammeId);
    const cleanTitle = duplicateTitle.trim();
    const days = Math.max(1, Number(duplicateDurationDays || 1));
    if (!source) return toast.error("Sélectionnez un programme source.");
    if (!cleanTitle) return toast.error("Titre requis.");

    setDuplicating(true);
    const baseSlug = slugify(cleanTitle) || "programme-personnalise";
    const slug = `${baseSlug}-${Date.now().toString().slice(-6)}`;
    const sortOrder = Math.max(0, ...programmes.map((p) => p.sort_order ?? 0)) + 10;
    const { data: created, error } = await supabase
      .from("programmes")
      .insert({
        slug,
        title: cleanTitle,
        duration: `${days} jours`,
        subtitle: source.subtitle ?? "",
        introduction: source.introduction ?? "",
        hero_image_url: source.hero_image_url,
        hero_alt: source.hero_alt,
        cta_label: source.cta_label ?? "Demander un devis",
        cta_url: source.cta_url ?? "/contact",
        meta_description: source.meta_description,
        cities: source.cities ?? [],
        description: source.description ?? "",
        days: source.days as any,
        pdf_url: null,
        pdf_path: null,
        is_published: duplicateVisibility === "public",
        sort_order: sortOrder,
      })
      .select("*")
      .single();

    if (error || !created) {
      setDuplicating(false);
      return toast.error(error?.message ?? "Duplication impossible.");
    }

    const { data: sourceDays, error: sourceDaysError } = await supabase
      .from("programme_days")
      .select("*")
      .eq("programme_id", source.id)
      .order("day_number", { ascending: true });

    if (sourceDaysError) {
      await supabase.from("programmes").delete().eq("id", created.id);
      setDuplicating(false);
      return toast.error(sourceDaysError.message);
    }

    const sourceByNumber = new Map<number, any>();
    (sourceDays ?? []).forEach((day: any) => {
      const dayNumber = Number(day.day_number);
      if (dayNumber >= 1 && dayNumber <= days && !sourceByNumber.has(dayNumber)) {
        sourceByNumber.set(dayNumber, day);
      }
    });

    const dayRows = Array.from({ length: days }, (_, index) => {
      const dayNumber = index + 1;
      const sourceDay = sourceByNumber.get(dayNumber);
      if (!sourceDay) {
        return {
          programme_id: created.id,
          day_number: dayNumber,
          sort_order: dayNumber * 10,
          title: "Programme à compléter",
          city: "",
          description: "À compléter",
          badge: null,
          main_image_url: null,
          gallery_images: [],
          schedule_items: [],
          included_items: [],
          icons: [],
          special_note: null,
          is_optional: false,
          is_active: true,
        };
      }
      return {
        programme_id: created.id,
        day_number: dayNumber,
        sort_order: dayNumber * 10,
        title: sourceDay.title ?? "",
        city: sourceDay.city ?? "",
        description: sourceDay.description ?? "",
        badge: sourceDay.badge ?? null,
        main_image_url: sourceDay.main_image_url ?? null,
        gallery_images: Array.isArray(sourceDay.gallery_images) ? sourceDay.gallery_images : [],
        schedule_items: Array.isArray(sourceDay.schedule_items) ? sourceDay.schedule_items : [],
        included_items: Array.isArray(sourceDay.included_items) ? sourceDay.included_items : [],
        icons: Array.isArray(sourceDay.icons) ? sourceDay.icons : [],
        special_note: sourceDay.special_note ?? null,
        is_optional: Boolean(sourceDay.is_optional),
        is_active: sourceDay.is_active ?? true,
      };
    });

    const { error: daysError } = await supabase.from("programme_days").insert(dayRows);
    if (daysError) {
      await supabase.from("programmes").delete().eq("id", created.id);
      setDuplicating(false);
      return toast.error(daysError.message);
    }

    setDuplicateOpen(false);
    setDuplicateTitle("");
    setDuplicateDurationDays(25);
    setDuplicateVisibility("admin_only");
    setDuplicating(false);
    toast.success("Programme dupliqué");
    onCreated(created.id);
  };

  return (
    <section className="rounded-2xl border border-border bg-background p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-medium">Créer un programme personnalisé</h2>
          <p className="text-sm text-muted-foreground">Pour les voyages spéciaux, privés ou non publiés sur le site.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={openDuplicateForm} className="min-h-11">
            <Copy className="h-4 w-4" /> Créer depuis un programme existant
          </Button>
          <Button type="button" onClick={() => setOpen((v) => !v)} className="min-h-11">
            <Plus className="h-4 w-4" /> Nouveau personnalisé
          </Button>
        </div>
      </div>
      {duplicateOpen && (
        <div className="mt-5 rounded-xl border border-border bg-secondary/20 p-4">
          <div className="mb-4">
            <h3 className="font-medium">Créer depuis un programme existant</h3>
            <p className="text-sm text-muted-foreground">
              Copie le contenu et les jours du programme source, puis crée un nouveau programme indépendant.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Programme source</Label>
              <Select
                value={sourceProgrammeId}
                onValueChange={(value) => {
                  const source = programmes.find((programme) => programme.id === value);
                  setSourceProgrammeId(value);
                  if (source) {
                    setDuplicateTitle(`${source.title} personnalisé`);
                    setDuplicateDurationDays(parseDurationDays(source.duration) || 25);
                  }
                }}
              >
                <SelectTrigger><SelectValue placeholder="Sélectionner un programme" /></SelectTrigger>
                <SelectContent>
                  {programmes.map((programme) => (
                    <SelectItem key={programme.id} value={programme.id}>
                      {programmeLabel(programme)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Nouveau titre</Label>
              <Input value={duplicateTitle} onChange={(event) => setDuplicateTitle(event.target.value)} placeholder="Programme spécial 25 jours" />
            </div>
            <div>
              <Label>Nouvelle durée (jours)</Label>
              <Input
                type="number"
                min={1}
                value={duplicateDurationDays}
                onChange={(event) => setDuplicateDurationDays(Number(event.target.value || 1))}
              />
            </div>
            <div>
              <Label>Visibilité</Label>
              <Select value={duplicateVisibility} onValueChange={(value) => setDuplicateVisibility(value as "public" | "admin_only")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin_only">Admin only</SelectItem>
                  <SelectItem value="public">Public</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end text-sm text-muted-foreground">
              {selectedSource ? `${parseDurationDays(selectedSource.duration) || 0} jour(s) disponibles dans la source.` : "Aucun programme source sélectionné."}
            </div>
            <div className="sm:col-span-2 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDuplicateOpen(false)}>Annuler</Button>
              <Button type="button" onClick={duplicateFromSource} disabled={duplicating || !sourceProgrammeId || !duplicateTitle.trim()}>
                {duplicating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                Créer la copie
              </Button>
            </div>
          </div>
        </div>
      )}
      {open && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Titre</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Voyage spécial 25 jours" />
          </div>
          <div>
            <Label>Durée (jours)</Label>
            <Input type="number" min={1} value={durationDays} onChange={(e) => setDurationDays(Number(e.target.value || 1))} />
          </div>
          <div className="sm:col-span-2">
            <Label>Sous-titre</Label>
            <Input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label>Introduction / description</Label>
            <Textarea rows={3} value={intro} onChange={(e) => setIntro(e.target.value)} />
          </div>
          <div>
            <Label>Visibilité</Label>
            <Select value={visibility} onValueChange={(value) => setVisibility(value as "public" | "admin_only")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin_only">Admin only</SelectItem>
                <SelectItem value="public">Public</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Voyage associé (optionnel)</Label>
            <Select value={tripId} onValueChange={setTripId}>
              <SelectTrigger><SelectValue placeholder="Aucun voyage" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Aucun voyage</SelectItem>
                {trips.map((trip) => (
                  <SelectItem key={trip.id} value={trip.id}>{trip.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            <Button type="button" onClick={create} disabled={saving || !title.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Créer le programme
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function LinkedTrips({ programmeId, trips }: { programmeId: string; trips: TripOption[] }) {
  const linked = trips.filter((trip) => trip.programme_id === programmeId);
  if (!linked.length) return <p className="text-xs text-muted-foreground">Aucun voyage lié</p>;
  return (
    <div className="text-xs text-muted-foreground">
      Lié à {linked.length} voyage{linked.length > 1 ? "s" : ""}: {linked.map((trip) => trip.title).join(", ")}
    </div>
  );
}

function ProgrammeRemovalActions({
  programme,
  trips,
  onChanged,
}: {
  programme: Programme;
  trips: TripOption[];
  onChanged: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const linkedTrips = trips.filter((trip) => trip.programme_id === programme.id);
  const isDefaultProgramme = isPublicProgrammePreset(programme);
  const canManage = !isDefaultProgramme && !programme.is_published;
  const archiveSupported = "archived_at" in programme;

  if (isDefaultProgramme) return null;

  const archiveProgramme = async () => {
    if (!canManage || !archiveSupported) return;
    setBusy(true);
    const { data: auth } = await supabase.auth.getUser();
    const payload: Record<string, unknown> = {
      archived_at: new Date().toISOString(),
      is_published: false,
    };
    if ("archived_by" in programme) payload.archived_by = auth.user?.id ?? null;
    const { error } = await supabase.from("programmes").update(payload as any).eq("id", programme.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Programme archivé");
    onChanged();
  };

  const hardDelete = async () => {
    if (!canManage) return;
    if (linkedTrips.length) {
      toast.error("Suppression bloquée: ce programme est lié à des voyages.");
      return;
    }
    if (confirmText !== "DELETE") return toast.error("Tapez DELETE pour confirmer.");
    setBusy(true);
    const { error: daysError } = await supabase.from("programme_days").delete().eq("programme_id", programme.id);
    if (daysError) {
      setBusy(false);
      return toast.error(daysError.message);
    }
    const { error } = await supabase.from("programmes").delete().eq("id", programme.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Programme supprimé");
    setConfirmOpen(false);
    setConfirmText("");
    onChanged();
  };

  if (!canManage) {
    return (
      <p className="max-w-md text-xs text-muted-foreground">
        Suppression indisponible: seuls les programmes personnalisés admin only peuvent être supprimés ou archivés.
      </p>
    );
  }

  if (linkedTrips.length) {
    return (
      <div className="max-w-md rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        <p className="font-medium">Suppression bloquée: {linkedTrips.length} voyage{linkedTrips.length > 1 ? "s" : ""} lié{linkedTrips.length > 1 ? "s" : ""}.</p>
        <p className="mt-1">{linkedTrips.map((trip) => trip.title).join(", ")}</p>
        <div className="mt-3">
          {archiveSupported ? (
            <Button type="button" size="sm" variant="outline" onClick={archiveProgramme} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
              Archiver
            </Button>
          ) : (
            <p className="text-amber-800">Archivage non disponible tant que la colonne archived_at n'existe pas.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap justify-end gap-2">
        {archiveSupported && (
          <Button type="button" size="sm" variant="outline" onClick={archiveProgramme} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
            Archiver
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" className="text-destructive" onClick={() => setConfirmOpen(true)}>
          <Trash2 className="h-4 w-4" />
          Supprimer
        </Button>
      </div>
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-background p-5 shadow-xl">
            <h3 className="font-display text-lg">Supprimer le programme</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Cette action supprimera définitivement le programme « {programme.title} » et ses jours associés.
            </p>
            <div className="mt-4">
              <Label>Tapez DELETE pour confirmer</Label>
              <Input value={confirmText} onChange={(event) => setConfirmText(event.target.value)} placeholder="DELETE" />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => {
                setConfirmOpen(false);
                setConfirmText("");
              }}>
                Annuler
              </Button>
              <Button type="button" variant="destructive" onClick={hardDelete} disabled={busy || confirmText !== "DELETE"}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Supprimer définitivement
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ProgrammeEditor({ initial, onSaved }: { initial: Programme; onSaved: () => void }) {
  const [p, setP] = useState<Programme>(initial);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => setP(initial), [initial.id]);

  const setField = <K extends keyof Programme>(k: K, v: Programme[K]) =>
    setP((prev) => ({ ...prev, [k]: v }));

  const updateDay = (idx: number, patch: Partial<Day>) =>
    setP((prev) => ({
      ...prev,
      days: prev.days.map((d, i) => (i === idx ? { ...d, ...patch } : d)),
    }));

  const addDay = () =>
    setP((prev) => ({
      ...prev,
      days: [
        ...prev.days,
        { day: prev.days.length + 1, title: "", city: "", description: "" },
      ],
    }));

  const removeDay = (idx: number) =>
    setP((prev) => ({
      ...prev,
      days: prev.days
        .filter((_, i) => i !== idx)
        .map((d, i) => ({ ...d, day: i + 1 })),
    }));

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("programmes")
      .update({
        title: p.title,
        duration: p.duration,
        cities: p.cities,
        description: p.description,
        days: p.days as any,
        subtitle: p.subtitle ?? "",
        introduction: p.introduction ?? "",
        hero_image_url: p.hero_image_url,
        cta_label: p.cta_label ?? "Demander un devis",
        cta_url: p.cta_url ?? "/contact",
        meta_description: p.meta_description,
        is_published: p.is_published,
        sort_order: p.sort_order,
      })
      .eq("id", p.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Programme enregistré");
    onSaved();
  };

  const onUpload = async (file: File) => {
    if (file.type !== "application/pdf") {
      toast.error("Le fichier doit être un PDF.");
      return;
    }
    setUploading(true);
    const path = `${p.slug}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
    const { error: upErr } = await supabase.storage
      .from("programme-pdfs")
      .upload(path, file, { upsert: true, contentType: "application/pdf" });
    if (upErr) {
      setUploading(false);
      return toast.error(upErr.message);
    }
    const { data: pub } = supabase.storage.from("programme-pdfs").getPublicUrl(path);
    // Optionally remove the previous file
    if (p.pdf_path && p.pdf_path !== path) {
      await supabase.storage.from("programme-pdfs").remove([p.pdf_path]);
    }
    const { error: dbErr } = await supabase
      .from("programmes")
      .update({ pdf_url: pub.publicUrl, pdf_path: path })
      .eq("id", p.id);
    setUploading(false);
    if (dbErr) return toast.error(dbErr.message);
    toast.success("PDF mis à jour");
    setP((prev) => ({ ...prev, pdf_url: pub.publicUrl, pdf_path: path }));
    onSaved();
  };

  const removePdf = async () => {
    if (!p.pdf_path) return;
    if (!confirm("Supprimer le PDF actuel ?")) return;
    await supabase.storage.from("programme-pdfs").remove([p.pdf_path]);
    await supabase
      .from("programmes")
      .update({ pdf_url: null, pdf_path: null })
      .eq("id", p.id);
    setP((prev) => ({ ...prev, pdf_url: null, pdf_path: null }));
    toast.success("PDF supprimé");
    onSaved();
  };

  return (
    <div className="space-y-8">
      {/* General */}
      <section className="bg-background rounded-2xl border border-border p-5 space-y-4">
        <h2 className="font-medium">Informations générales</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label>Titre</Label>
            <Input value={p.title} onChange={(e) => setField("title", e.target.value)} />
          </div>
          <div>
            <Label>Durée</Label>
            <Input
              value={p.duration}
              placeholder="17 jours"
              onChange={(e) => setField("duration", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label>Sous-titre</Label>
            <Input
              value={p.subtitle ?? ""}
              placeholder="De Tokyo à Kyoto, Hiroshima, Osaka et retour à Tokyo"
              onChange={(e) => setField("subtitle", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label>Texte d'introduction (hero)</Label>
            <Textarea
              rows={3}
              value={p.introduction ?? ""}
              onChange={(e) => setField("introduction", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <HeroImageField p={p} setP={setP} />
          </div>
          <div>
            <Label>Libellé du bouton CTA</Label>
            <Input value={p.cta_label ?? ""} placeholder="Demander un devis" onChange={(e) => setField("cta_label", e.target.value)} />
          </div>
          <div>
            <Label>Lien du bouton CTA</Label>
            <Input value={p.cta_url ?? ""} placeholder="/contact" onChange={(e) => setField("cta_url", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label>Itinéraire (villes séparées par des virgules)</Label>
            <Input
              value={p.cities.join(", ")}
              onChange={(e) =>
                setField(
                  "cities",
                  e.target.value
                    .split(",")
                    .map((c) => c.trim())
                    .filter(Boolean),
                )
              }
            />
          </div>
          <div className="sm:col-span-2">
            <Label>Description courte (résumé carte)</Label>
            <Textarea
              rows={4}
              value={p.description}
              onChange={(e) => setField("description", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label>Meta description SEO</Label>
            <Textarea
              rows={2}
              value={p.meta_description ?? ""}
              onChange={(e) => setField("meta_description", e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={p.is_published}
              onCheckedChange={(v) => setField("is_published", v)}
            />
            <Label>Publié sur le site</Label>
          </div>
          <div>
            <Label>Ordre</Label>
            <Input
              type="number"
              value={p.sort_order}
              onChange={(e) => setField("sort_order", +e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* PDF */}
      <section className="bg-background rounded-2xl border border-border p-5 space-y-3">
        <h2 className="font-medium">PDF téléchargeable</h2>
        {p.pdf_url ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <FileText className="w-4 h-4 text-accent" />
            <a
              href={p.pdf_url}
              target="_blank"
              rel="noreferrer"
              className="text-accent underline underline-offset-2 inline-flex items-center gap-1"
            >
              Voir le PDF actuel <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Upload className="w-4 h-4" /> Remplacer
            </Button>
            <Button variant="ghost" size="sm" onClick={removePdf} disabled={uploading}>
              <Trash2 className="w-4 h-4" /> Supprimer
            </Button>
          </div>
        ) : (
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Téléverser un PDF
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = "";
          }}
        />
      </section>

      {/* Rich days editor (programme_days table) */}
      <RichDaysEditor programmeId={p.id} durationDays={parseDurationDays(p.duration)} />

      <div className="sticky bottom-4 flex justify-end">
        <Button onClick={save} disabled={saving} size="lg" className="shadow-lg">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Enregistrer le programme
        </Button>
      </div>
    </div>
  );
}

// ───────────────────── Hero image upload ─────────────────────
function HeroImageField({ p, setP }: { p: Programme; setP: React.Dispatch<React.SetStateAction<Programme>> }) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    if (!file.type.startsWith("image/")) return toast.error("Image requise");
    setBusy(true);
    const optimized = await optimizeImage(file);
    const path = `${p.slug}/hero-${Date.now()}-${optimized.name}`;
    const { error: e1 } = await supabase.storage
      .from("programme-images")
      .upload(path, optimized, { upsert: true, contentType: optimized.type });
    if (e1) { setBusy(false); return toast.error(e1.message); }
    const { data: pub } = supabase.storage.from("programme-images").getPublicUrl(path);
    const { error: e2 } = await supabase.from("programmes").update({ hero_image_url: pub.publicUrl }).eq("id", p.id);
    setBusy(false);
    if (e2) return toast.error(e2.message);
    setP((prev) => ({ ...prev, hero_image_url: pub.publicUrl }));
    toast.success("Image hero mise à jour");
  };

  return (
    <div>
      <Label>Image principale (hero)</Label>
      <div className="mt-2 flex items-center gap-3">
        {p.hero_image_url ? (
          <img src={p.hero_image_url} alt="" className="w-32 h-20 rounded-lg object-cover border border-border" />
        ) : (
          <div className="w-32 h-20 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground">
            <ImageIcon className="w-5 h-5" />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => ref.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Téléverser
          </Button>
          {p.hero_image_url && (
            <Button type="button" variant="ghost" size="sm" onClick={async () => {
              await supabase.from("programmes").update({ hero_image_url: null }).eq("id", p.id);
              setP((prev) => ({ ...prev, hero_image_url: null }));
            }}>
              <Trash2 className="w-4 h-4" /> Retirer
            </Button>
          )}
        </div>
        <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => {
          const f = e.target.files?.[0]; if (f) upload(f); e.target.value = "";
        }} />
      </div>
      <div className="mt-3">
        <Input
          value={p.hero_alt ?? ""}
          placeholder="Texte alternatif (ALT) — décrit l'image hero pour le SEO"
          onChange={(e) => setP((prev) => ({ ...prev, hero_alt: e.target.value }))}
          onBlur={async (e) => {
            await supabase.from("programmes").update({ hero_alt: e.target.value || null }).eq("id", p.id);
          }}
        />
      </div>
    </div>
  );
}

// ───────────────────── Rich days editor ─────────────────────
function RichDaysEditor({ programmeId, durationDays }: { programmeId: string; durationDays: number }) {
  const [days, setDays] = useState<ProgrammeDay[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("programme_days")
      .select("*")
      .eq("programme_id", programmeId)
      .order("sort_order");
    if (error) toast.error(error.message);
    setDays((data ?? []).map((d: any) => ({
      ...d,
      gallery_images: Array.isArray(d.gallery_images) ? d.gallery_images : [],
      schedule_items: Array.isArray(d.schedule_items) ? d.schedule_items : [],
      included_items: Array.isArray(d.included_items) ? d.included_items : [],
      icons: Array.isArray(d.icons) ? d.icons : [],
    })));
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [programmeId]);

  const addDay = async () => {
    const next = (days.at(-1)?.day_number ?? 0) + 1;
    const sort = (days.at(-1)?.sort_order ?? 0) + 10;
    const { data, error } = await supabase.from("programme_days").insert({
      programme_id: programmeId, day_number: next, sort_order: sort, title: "", city: "",
    }).select("*").single();
    if (error) return toast.error(error.message);
    setDays((d) => [...d, data as any]);
  };

  const ensureDayBlocks = async () => {
    const target = Math.max(1, Number(durationDays || 1));
    const existingNumbers = new Set(days.map((day) => day.day_number));
    const missing = Array.from({ length: target }, (_, index) => index + 1).filter((dayNumber) => !existingNumbers.has(dayNumber));
    if (!missing.length) {
      toast.info("Tous les blocs de jour existent déjà.");
      return;
    }
    const { error } = await supabase.from("programme_days").insert(
      missing.map((dayNumber) => ({
        programme_id: programmeId,
        day_number: dayNumber,
        sort_order: dayNumber * 10,
        title: "",
        city: "",
        description: "",
      })),
    );
    if (error) return toast.error(error.message);
    toast.success(`${missing.length} bloc${missing.length > 1 ? "s" : ""} de jour créé${missing.length > 1 ? "s" : ""}.`);
    load();
  };

  const removeDay = async (id: string) => {
    if (!confirm("Supprimer ce jour ?")) return;
    const { error } = await supabase.from("programme_days").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setDays((d) => d.filter((x) => x.id !== id));
  };

  const duplicate = async (d: ProgrammeDay) => {
    const { id, created_at, updated_at, ...rest } = d as any;
    const sort = (days.at(-1)?.sort_order ?? 0) + 10;
    const next = (days.at(-1)?.day_number ?? 0) + 1;
    const { data, error } = await supabase.from("programme_days").insert({
      ...rest, programme_id: programmeId, day_number: next, sort_order: sort,
    }).select("*").single();
    if (error) return toast.error(error.message);
    setDays((arr) => [...arr, data as any]);
    toast.success("Jour dupliqué");
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const j = idx + dir; if (j < 0 || j >= days.length) return;
    const a = days[idx], b = days[j];
    const newArr = [...days]; newArr[idx] = { ...b, sort_order: a.sort_order }; newArr[j] = { ...a, sort_order: b.sort_order };
    setDays(newArr);
    await Promise.all([
      supabase.from("programme_days").update({ sort_order: a.sort_order }).eq("id", b.id),
      supabase.from("programme_days").update({ sort_order: b.sort_order }).eq("id", a.id),
    ]);
  };

  return (
    <section className="bg-background rounded-2xl border border-border p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-medium">Programme jour par jour (riche)</h2>
          <p className="text-xs text-muted-foreground">Photos, horaires, inclus, icônes — visible sur le site public.</p>
        </div>
        <Button variant="outline" size="sm" onClick={addDay}>
          <Plus className="w-4 h-4" /> Ajouter un jour
        </Button>
        {durationDays > 0 && (
          <Button variant="outline" size="sm" onClick={ensureDayBlocks}>
            Créer {durationDays} jours
          </Button>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline" /> Chargement…</div>
      ) : days.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun jour. Cliquez sur « Ajouter un jour » pour commencer.</p>
      ) : (
        <div className="space-y-4">
          {days.map((d, i) => (
            <DayEditor
              key={d.id}
              day={d}
              onChange={(patch) => setDays((arr) => arr.map((x) => x.id === d.id ? { ...x, ...patch } : x))}
              onDelete={() => removeDay(d.id)}
              onDuplicate={() => duplicate(d)}
              onMoveUp={() => move(i, -1)}
              onMoveDown={() => move(i, 1)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function DayEditor({ day, onChange, onDelete, onDuplicate, onMoveUp, onMoveDown }: {
  day: ProgrammeDay;
  onChange: (patch: Partial<ProgrammeDay>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  const persist = async (patch: Partial<ProgrammeDay>) => {
    setSaving(true);
    const { error } = await supabase.from("programme_days").update(patch as any).eq("id", day.id);
    setSaving(false);
    if (error) toast.error(error.message);
  };

  const update = (patch: Partial<ProgrammeDay>) => { onChange(patch); };
  const updateAndSave = (patch: Partial<ProgrammeDay>) => { onChange(patch); persist(patch); };

  const uploadMain = async (file: File) => {
    const optimized = await optimizeImage(file);
    const path = `days/${day.id}/${Date.now()}-${optimized.name}`;
    const { error } = await supabase.storage
      .from("programme-images")
      .upload(path, optimized, { upsert: true, contentType: optimized.type });
    if (error) return toast.error(error.message);
    const url = supabase.storage.from("programme-images").getPublicUrl(path).data.publicUrl;
    updateAndSave({ main_image_url: url });
  };

  const uploadGallery = async (file: File) => {
    const optimized = await optimizeImage(file);
    const path = `days/${day.id}/gal-${Date.now()}-${optimized.name}`;
    const { error } = await supabase.storage
      .from("programme-images")
      .upload(path, optimized, { upsert: true, contentType: optimized.type });
    if (error) return toast.error(error.message);
    const url = supabase.storage.from("programme-images").getPublicUrl(path).data.publicUrl;
    updateAndSave({ gallery_images: [...day.gallery_images, url] });
  };

  const mainRef = useRef<HTMLInputElement | null>(null);
  const galRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="border border-border rounded-xl bg-secondary/30">
      <div className="flex items-center justify-between p-3 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => setOpen((o) => !o)} className="px-2 py-1 rounded hover:bg-background text-sm font-medium">
            Jour {day.day_number} <span className="text-muted-foreground">— {day.city || "(ville)"} {day.title ? `· ${day.title}` : ""}</span>
          </button>
          {day.is_optional && <span className="text-xs px-2 py-0.5 rounded-full bg-accent/15 text-accent">Optionnel</span>}
          {!day.is_active && <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Désactivé</span>}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={onMoveUp}><ChevronUp className="w-4 h-4" /></Button>
          <Button variant="ghost" size="icon" onClick={onMoveDown}><ChevronDown className="w-4 h-4" /></Button>
          <Button variant="ghost" size="icon" onClick={onDuplicate} title="Dupliquer"><Copy className="w-4 h-4" /></Button>
          <Button variant="ghost" size="icon" onClick={onDelete} className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
        </div>
      </div>
      {open && (
        <div className="border-t border-border p-4 space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label>Numéro de jour</Label>
              <Input type="number" value={day.day_number} onChange={(e) => update({ day_number: +e.target.value })} onBlur={(e) => persist({ day_number: +e.target.value })} />
            </div>
            <div>
              <Label>Ville / étape</Label>
              <Input value={day.city} onChange={(e) => update({ city: e.target.value })} onBlur={(e) => persist({ city: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Label>Titre de la journée</Label>
              <Input value={day.title} onChange={(e) => update({ title: e.target.value })} onBlur={(e) => persist({ title: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Label>Description</Label>
              <Textarea rows={4} value={day.description} onChange={(e) => update({ description: e.target.value })} onBlur={(e) => persist({ description: e.target.value })} />
            </div>
            <div>
              <Label>Badge (optionnel)</Label>
              <Input value={day.badge ?? ""} placeholder="ex. Arrivée" onChange={(e) => update({ badge: e.target.value })} onBlur={(e) => persist({ badge: e.target.value })} />
            </div>
            <div>
              <Label>Note spéciale</Label>
              <Input value={day.special_note ?? ""} onChange={(e) => update({ special_note: e.target.value })} onBlur={(e) => persist({ special_note: e.target.value })} />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={day.is_active} onCheckedChange={(v) => updateAndSave({ is_active: v })} />
              <Label>Actif</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={day.is_optional} onCheckedChange={(v) => updateAndSave({ is_optional: v })} />
              <Label>Activité optionnelle</Label>
            </div>
          </div>

          {/* Photos */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label>Photo principale</Label>
              <div className="mt-2 flex items-center gap-3">
                {day.main_image_url ? (
                  <img src={day.main_image_url} className="w-28 h-20 rounded-lg object-cover border border-border" alt="" />
                ) : (
                  <div className="w-28 h-20 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground">
                    <ImageIcon className="w-5 h-5" />
                  </div>
                )}
                <Button variant="outline" size="sm" onClick={() => mainRef.current?.click()}>
                  <Upload className="w-4 h-4" /> Téléverser
                </Button>
                {day.main_image_url && (
                  <Button variant="ghost" size="sm" onClick={() => updateAndSave({ main_image_url: null })}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
                <input ref={mainRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMain(f); e.target.value = ""; }} />
              </div>
            </div>
            <div>
              <Label>Galerie</Label>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {day.gallery_images.map((src, i) => (
                  <div key={i} className="relative">
                    <img src={src} className="w-16 h-16 rounded-lg object-cover border border-border" alt="" />
                    <button
                      type="button"
                      onClick={() => updateAndSave({ gallery_images: day.gallery_images.filter((_, j) => j !== i) })}
                      className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full w-5 h-5 text-xs"
                    >×</button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => galRef.current?.click()}>
                  <Plus className="w-4 h-4" /> Ajouter
                </Button>
                <input ref={galRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadGallery(f); e.target.value = ""; }} />
              </div>
            </div>
          </div>

          {/* Icons */}
          <div>
            <Label>Icônes pratiques</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {ICON_OPTIONS.map((opt) => {
                const on = day.icons.includes(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      const next = on ? day.icons.filter((i) => i !== opt.id) : [...day.icons, opt.id];
                      updateAndSave({ icons: next });
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition ${on ? "bg-accent text-accent-foreground border-accent" : "bg-background border-border hover:border-accent"}`}
                  >
                    <DayIcon id={opt.id} className="w-3.5 h-3.5" />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Schedule */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Programme heure par heure</Label>
              <Button variant="outline" size="sm" onClick={() => updateAndSave({ schedule_items: [...day.schedule_items, { time: "", title: "" }] })}>
                <Plus className="w-4 h-4" /> Ligne
              </Button>
            </div>
            <div className="space-y-2">
              {day.schedule_items.map((s, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
                  <Input className="col-span-3" placeholder="08h00" value={s.time}
                    onChange={(e) => update({ schedule_items: day.schedule_items.map((x, j) => j === i ? { ...x, time: e.target.value } : x) })}
                    onBlur={() => persist({ schedule_items: day.schedule_items })} />
                  <Input className="col-span-8" placeholder="Activité" value={s.title}
                    onChange={(e) => update({ schedule_items: day.schedule_items.map((x, j) => j === i ? { ...x, title: e.target.value } : x) })}
                    onBlur={() => persist({ schedule_items: day.schedule_items })} />
                  <Button className="col-span-1" variant="ghost" size="icon" onClick={() => updateAndSave({ schedule_items: day.schedule_items.filter((_, j) => j !== i) })}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Included */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Inclus ce jour-là</Label>
              <Button variant="outline" size="sm" onClick={() => updateAndSave({ included_items: [...day.included_items, { label: "" }] })}>
                <Plus className="w-4 h-4" /> Ligne
              </Button>
            </div>
            <div className="space-y-2">
              {day.included_items.map((it, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
                  <select
                    className="col-span-3 h-10 rounded-md border border-input bg-background px-2 text-sm"
                    value={it.icon ?? ""}
                    onChange={(e) => updateAndSave({ included_items: day.included_items.map((x, j) => j === i ? { ...x, icon: e.target.value || undefined } : x) })}
                  >
                    <option value="">— icône —</option>
                    {ICON_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                  <Input className="col-span-8" placeholder="Libellé" value={it.label}
                    onChange={(e) => update({ included_items: day.included_items.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })}
                    onBlur={() => persist({ included_items: day.included_items })} />
                  <Button className="col-span-1" variant="ghost" size="icon" onClick={() => updateAndSave({ included_items: day.included_items.filter((_, j) => j !== i) })}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {saving && <p className="text-xs text-muted-foreground"><Loader2 className="w-3 h-3 inline animate-spin" /> Enregistrement…</p>}
        </div>
      )}
    </div>
  );
}
