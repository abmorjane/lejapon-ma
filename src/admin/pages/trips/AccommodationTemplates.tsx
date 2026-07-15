import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Hotel, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { hotelCatalogColumns, HotelCatalogItem } from "@/lib/hotel-catalog";

type DbClient = { from: (table: string) => any };
const db = supabase as unknown as DbClient;

type Template = {
  id: string;
  name: string;
  description: string | null;
  duration_days: number | null;
  is_active: boolean;
};

type TemplateRowForm = {
  local_id: string;
  id?: string;
  hotel_catalog_id?: string | null;
  hotel_name: string;
  city: string;
  arrival_day: string;
  departure_day: string;
  address: string;
  phone: string;
  notes: string;
};

const emptyRow = (): TemplateRowForm => ({
  local_id: crypto.randomUUID(),
  hotel_catalog_id: null,
  hotel_name: "",
  city: "",
  arrival_day: "1",
  departure_day: "2",
  address: "",
  phone: "",
  notes: "",
});

const rowFromDb = (row: any): TemplateRowForm => ({
  local_id: row.id ?? crypto.randomUUID(),
  id: row.id,
  hotel_catalog_id: row.hotel_catalog_id ?? null,
  hotel_name: row.hotel_name ?? "",
  city: row.city ?? "",
  arrival_day: String(row.arrival_day ?? 1),
  departure_day: String(row.departure_day ?? 2),
  address: row.address ?? "",
  phone: row.phone ?? "",
  notes: row.notes ?? "",
});

const toPositiveInt = (value: string | number | null | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
};

export default function AccommodationTemplates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [catalogHotels, setCatalogHotels] = useState<HotelCatalogItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    id: "",
    name: "",
    description: "",
    duration_days: "",
    is_active: true,
  });
  const [rows, setRows] = useState<TemplateRowForm[]>([]);

  const selectedTemplate = useMemo(() => templates.find((template) => template.id === selectedId), [selectedId, templates]);

  const loadTemplates = async (nextSelectedId?: string) => {
    setLoading(true);
    const [{ data: templateRows, error: templateError }, { data: hotels }] = await Promise.all([
      db.from("accommodation_templates").select("*").order("name", { ascending: true }),
      db
        .from("hotel_catalog")
        .select(hotelCatalogColumns)
        .eq("is_active", true)
        .order("city", { ascending: true })
        .order("sort_order", { ascending: true }),
    ]);
    if (templateError) {
      toast.error(templateError.message ?? "Impossible de charger les modèles d'hébergement.");
      setTemplates([]);
    } else {
      const list = (templateRows ?? []) as Template[];
      setTemplates(list);
      const targetId = nextSelectedId ?? selectedId ?? list[0]?.id ?? "";
      setSelectedId(list.some((template) => template.id === targetId) ? targetId : list[0]?.id ?? "");
    }
    setCatalogHotels((hotels ?? []) as HotelCatalogItem[]);
    setLoading(false);
  };

  const loadTemplateRows = async (template: Template | undefined) => {
    if (!template?.id) {
      setRows([]);
      return;
    }
    setForm({
      id: template.id,
      name: template.name ?? "",
      description: template.description ?? "",
      duration_days: template.duration_days ? String(template.duration_days) : "",
      is_active: template.is_active !== false,
    });
    const { data, error } = await db
      .from("accommodation_template_rows")
      .select("*")
      .eq("template_id", template.id)
      .order("sort_order", { ascending: true });
    if (error) {
      toast.error(error.message ?? "Impossible de charger les lignes du modèle.");
      setRows([]);
      return;
    }
    setRows((data ?? []).map(rowFromDb));
  };

  useEffect(() => {
    void loadTemplates();
  }, []);

  useEffect(() => {
    void loadTemplateRows(selectedTemplate);
  }, [selectedTemplate?.id]);

  const newTemplate = () => {
    setSelectedId("");
    setForm({ id: "", name: "", description: "", duration_days: "", is_active: true });
    setRows([emptyRow()]);
  };

  const duplicateTemplate = () => {
    setForm({
      id: "",
      name: `${form.name || "Modèle"} (copie)`,
      description: form.description,
      duration_days: form.duration_days,
      is_active: true,
    });
    setSelectedId("");
    setRows(rows.map((row) => ({ ...row, id: undefined, local_id: crypto.randomUUID() })));
    toast.info("Copie prête. Enregistrez pour créer le nouveau modèle.");
  };

  const setRow = (localId: string, patch: Partial<TemplateRowForm>) => {
    setRows((items) => items.map((row) => (row.local_id === localId ? { ...row, ...patch } : row)));
  };

  const selectCatalogHotel = (localId: string, hotelId: string) => {
    if (hotelId === "manual") {
      setRow(localId, { hotel_catalog_id: null });
      return;
    }
    const hotel = catalogHotels.find((item) => item.id === hotelId);
    if (!hotel) return;
    setRow(localId, {
      hotel_catalog_id: hotel.id,
      hotel_name: hotel.name,
      city: hotel.city,
      address: hotel.address ?? "",
      phone: hotel.phone ?? "",
    });
  };

  const moveRow = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= rows.length) return;
    const next = [...rows];
    const [item] = next.splice(index, 1);
    next.splice(targetIndex, 0, item);
    setRows(next);
  };

  const validate = () => {
    if (!form.name.trim()) throw new Error("Le nom du modèle est obligatoire.");
    for (const [index, row] of rows.entries()) {
      const arrival = toPositiveInt(row.arrival_day);
      const departure = toPositiveInt(row.departure_day);
      if (!row.hotel_name.trim()) throw new Error(`L'hôtel de la ligne ${index + 1} est obligatoire.`);
      if (!arrival || !departure || departure <= arrival) {
        throw new Error(`Les jours de la ligne ${index + 1} sont invalides : le départ doit être après l'arrivée.`);
      }
    }
  };

  const saveTemplate = async () => {
    setSaving(true);
    try {
      validate();
      const durationDays = toPositiveInt(form.duration_days);
      const templatePayload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        duration_days: durationDays,
        is_active: form.is_active,
      };

      const result = form.id
        ? await db.from("accommodation_templates").update(templatePayload).eq("id", form.id).select("id").maybeSingle()
        : await db.from("accommodation_templates").insert(templatePayload).select("id").maybeSingle();
      if (result.error) throw result.error;
      const templateId = result.data?.id ?? form.id;
      if (!templateId) throw new Error("Modèle enregistré sans identifiant retourné.");

      const { error: deleteError } = await db.from("accommodation_template_rows").delete().eq("template_id", templateId);
      if (deleteError) throw deleteError;

      const rowPayloads = rows.map((row, index) => ({
        template_id: templateId,
        hotel_catalog_id: row.hotel_catalog_id || null,
        hotel_name: row.hotel_name.trim(),
        city: row.city.trim() || null,
        arrival_day: toPositiveInt(row.arrival_day),
        departure_day: toPositiveInt(row.departure_day),
        address: row.address.trim() || null,
        phone: row.phone.trim() || null,
        notes: row.notes.trim() || null,
        sort_order: index,
      }));
      if (rowPayloads.length > 0) {
        const { error } = await db.from("accommodation_template_rows").insert(rowPayloads);
        if (error) throw error;
      }

      toast.success("Modèle d'hébergement enregistré.");
      setForm((current) => ({ ...current, id: templateId }));
      await loadTemplates(templateId);
    } catch (error: any) {
      toast.error(error?.message ?? "Impossible d'enregistrer le modèle.");
    } finally {
      setSaving(false);
    }
  };

  const deleteTemplate = async () => {
    if (!form.id) return;
    if (!window.confirm(`Supprimer le modèle "${form.name}" ?`)) return;
    const { error } = await db.from("accommodation_templates").delete().eq("id", form.id);
    if (error) return toast.error(error.message ?? "Impossible de supprimer le modèle.");
    toast.success("Modèle supprimé.");
    newTemplate();
    await loadTemplates();
  };

  const durationWarning = (row: TemplateRowForm) => {
    const duration = toPositiveInt(form.duration_days);
    const departure = toPositiveInt(row.departure_day);
    return duration && departure && departure > duration;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl">Modèles d'hébergement</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Créez des séquences J1/J6 réutilisables pour générer automatiquement les hôtels d'un départ.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={newTemplate}><Plus className="h-4 w-4" /> Nouveau modèle</Button>
          <Button type="button" variant="outline" onClick={duplicateTemplate} disabled={!form.name}><Copy className="h-4 w-4" /> Dupliquer</Button>
          <Button type="button" onClick={saveTemplate} disabled={saving}><Save className="h-4 w-4" /> {saving ? "Enregistrement…" : "Enregistrer"}</Button>
        </div>
      </div>

      {loading ? (
        <Card className="p-6 text-sm text-muted-foreground">Chargement des modèles…</Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <Card className="h-fit p-3">
            <div className="space-y-2">
              {templates.length === 0 && <p className="p-3 text-sm text-muted-foreground">Aucun modèle enregistré.</p>}
              {templates.map((template) => (
                <button
                  type="button"
                  key={template.id}
                  onClick={() => setSelectedId(template.id)}
                  className={`w-full rounded-xl px-3 py-3 text-left text-sm transition ${
                    selectedId === template.id ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
                  }`}
                >
                  <span className="block font-medium">{template.name}</span>
                  <span className={selectedId === template.id ? "text-primary-foreground/80" : "text-muted-foreground"}>
                    {template.duration_days ? `${template.duration_days} jours` : "Durée non définie"}
                  </span>
                </button>
              ))}
            </div>
          </Card>

          <div className="space-y-5">
            <Card className="p-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <Label>Nom du modèle</Label>
                  <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Japon classique 17 jours — Liste A" />
                </div>
                <div>
                  <Label>Durée normale</Label>
                  <Input type="number" min={1} value={form.duration_days} onChange={(event) => setForm({ ...form, duration_days: event.target.value })} placeholder="17" />
                </div>
                <div className="sm:col-span-3">
                  <Label>Description interne</Label>
                  <Textarea rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
                </div>
              </div>
            </Card>

            <Card className="overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-semibold">Séquence hôtels</h2>
                  <p className="text-xs text-muted-foreground">Les jours sont relatifs au départ du voyage. J1 → J6 donne 5 nuits.</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setRows((items) => [...items, emptyRow()])}>
                  <Plus className="h-4 w-4" /> Ajouter une ligne
                </Button>
              </div>
              <div className="divide-y divide-border">
                {rows.length === 0 && <p className="p-5 text-sm text-muted-foreground">Ajoutez au moins un hôtel.</p>}
                {rows.map((row, index) => {
                  const arrival = toPositiveInt(row.arrival_day);
                  const departure = toPositiveInt(row.departure_day);
                  const nights = arrival && departure ? Math.max(0, departure - arrival) : 0;
                  return (
                    <div key={row.local_id} className="p-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          <Hotel className="h-4 w-4 text-accent" /> Ligne {index + 1}
                          <span className="text-xs font-normal text-muted-foreground">{nights} nuit(s)</span>
                        </div>
                        <div className="flex gap-1">
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => moveRow(index, -1)} disabled={index === 0}><ArrowUp className="h-4 w-4" /></Button>
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => moveRow(index, 1)} disabled={index === rows.length - 1}><ArrowDown className="h-4 w-4" /></Button>
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setRows((items) => items.filter((item) => item.local_id !== row.local_id))}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-6">
                        <div className="sm:col-span-2">
                          <Label>Catalogue hôtel</Label>
                          <Select value={row.hotel_catalog_id || "manual"} onValueChange={(value) => selectCatalogHotel(row.local_id, value)}>
                            <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="manual">Saisie manuelle</SelectItem>
                              {catalogHotels.map((hotel) => (
                                <SelectItem key={hotel.id} value={hotel.id}>{hotel.city} · {hotel.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="sm:col-span-2">
                          <Label>Hôtel</Label>
                          <Input value={row.hotel_name} onChange={(event) => setRow(row.local_id, { hotel_name: event.target.value })} />
                        </div>
                        <div>
                          <Label>Ville</Label>
                          <Input value={row.city} onChange={(event) => setRow(row.local_id, { city: event.target.value })} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label>Arrivée J</Label>
                            <Input type="number" min={1} value={row.arrival_day} onChange={(event) => setRow(row.local_id, { arrival_day: event.target.value })} />
                          </div>
                          <div>
                            <Label>Départ J</Label>
                            <Input type="number" min={2} value={row.departure_day} onChange={(event) => setRow(row.local_id, { departure_day: event.target.value })} />
                          </div>
                        </div>
                        <div className="sm:col-span-3">
                          <Label>Adresse</Label>
                          <Input value={row.address} onChange={(event) => setRow(row.local_id, { address: event.target.value })} />
                        </div>
                        <div className="sm:col-span-2">
                          <Label>Téléphone</Label>
                          <Input value={row.phone} onChange={(event) => setRow(row.local_id, { phone: event.target.value })} />
                        </div>
                        <div>
                          <Label>Résumé</Label>
                          <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm">J{row.arrival_day || "?"} → J{row.departure_day || "?"}</div>
                        </div>
                        <div className="sm:col-span-6">
                          <Label>Notes internes</Label>
                          <Input value={row.notes} onChange={(event) => setRow(row.local_id, { notes: event.target.value })} />
                        </div>
                      </div>
                      {durationWarning(row) && (
                        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                          Attention : cette ligne dépasse la durée normale du modèle. Elle reste autorisée pour les exceptions opérationnelles.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            <div className="flex flex-wrap justify-between gap-2">
              <Button type="button" variant="outline" onClick={newTemplate}>Réinitialiser</Button>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="destructive" onClick={deleteTemplate} disabled={!form.id}><Trash2 className="h-4 w-4" /> Supprimer</Button>
                <Button type="button" onClick={saveTemplate} disabled={saving}><Save className="h-4 w-4" /> Enregistrer le modèle</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
