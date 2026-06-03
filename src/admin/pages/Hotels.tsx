import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Save, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  HotelCatalogItem,
  hotelCatalogColumns,
  listFromTextarea,
  makeHotelSlug,
  textareaFromList,
} from "@/lib/hotel-catalog";

type DbClient = { from: (table: string) => any };
const db = supabase as unknown as DbClient;

type HotelForm = {
  id?: string;
  slug: string;
  name: string;
  city: string;
  category: string;
  main_image_url: string;
  gallery_urls: string;
  short_description_fr: string;
  short_description_en: string;
  short_description_ar: string;
  full_description_fr: string;
  full_description_en: string;
  full_description_ar: string;
  address: string;
  website_url: string;
  google_maps_url: string;
  phone: string;
  amenities: string;
  advantages: string;
  internal_notes: string;
  brochure_pdf_url: string;
  is_active: boolean;
  sort_order: string;
};

const emptyHotelForm = (): HotelForm => ({
  slug: "",
  name: "",
  city: "",
  category: "4*",
  main_image_url: "",
  gallery_urls: "",
  short_description_fr: "",
  short_description_en: "",
  short_description_ar: "",
  full_description_fr: "",
  full_description_en: "",
  full_description_ar: "",
  address: "",
  website_url: "",
  google_maps_url: "",
  phone: "",
  amenities: "",
  advantages: "",
  internal_notes: "",
  brochure_pdf_url: "",
  is_active: true,
  sort_order: "100",
});

const formFromHotel = (hotel: HotelCatalogItem): HotelForm => ({
  id: hotel.id,
  slug: hotel.slug || makeHotelSlug(hotel),
  name: hotel.name || "",
  city: hotel.city || "",
  category: hotel.category || "4*",
  main_image_url: hotel.main_image_url || "",
  gallery_urls: textareaFromList(hotel.gallery_urls),
  short_description_fr: hotel.short_description_fr || "",
  short_description_en: hotel.short_description_en || "",
  short_description_ar: hotel.short_description_ar || "",
  full_description_fr: hotel.full_description_fr || "",
  full_description_en: hotel.full_description_en || "",
  full_description_ar: hotel.full_description_ar || "",
  address: hotel.address || "",
  website_url: hotel.website_url || "",
  google_maps_url: hotel.google_maps_url || "",
  phone: hotel.phone || "",
  amenities: textareaFromList(hotel.amenities),
  advantages: textareaFromList(hotel.advantages),
  internal_notes: hotel.internal_notes || "",
  brochure_pdf_url: hotel.brochure_pdf_url || "",
  is_active: hotel.is_active,
  sort_order: String(hotel.sort_order ?? 100),
});

export default function AdminHotels() {
  const [hotels, setHotels] = useState<HotelCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cityFilter, setCityFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<HotelForm>(() => emptyHotelForm());
  const [uploadingImage, setUploadingImage] = useState<null | "main" | "gallery">(null);

  const loadHotels = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await db
      .from("hotel_catalog")
      .select(hotelCatalogColumns)
      .order("city", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      setError(error.message);
      setHotels([]);
    } else {
      setHotels((data ?? []) as HotelCatalogItem[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadHotels();
  }, []);

  const cities = useMemo(() => Array.from(new Set(hotels.map((hotel) => hotel.city).filter(Boolean))).sort(), [hotels]);
  const visibleHotels = cityFilter === "all" ? hotels : hotels.filter((hotel) => hotel.city === cityFilter);

  const openNew = () => {
    setForm(emptyHotelForm());
    setDialogOpen(true);
  };

  const openEdit = (hotel: HotelCatalogItem) => {
    setForm(formFromHotel(hotel));
    setDialogOpen(true);
  };

  const setField = <K extends keyof HotelForm>(key: K, value: HotelForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const uploadHotelImage = async (kind: "main" | "gallery", file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choisissez une image JPG, PNG ou WebP.");
      return;
    }
    setUploadingImage(kind);
    try {
      const safeName = file.name.replace(/[^\w.-]+/g, "_");
      const folder = form.slug || makeHotelSlug({ city: form.city || "hotel", name: form.name || "image" }) || "hotel";
      const path = `${folder}/${Date.now()}-${safeName}`;
      const { error } = await supabase.storage.from("hotel-images").upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (error) throw error;
      const { data } = supabase.storage.from("hotel-images").getPublicUrl(path);
      const url = data.publicUrl;
      if (kind === "main") {
        setField("main_image_url", url);
      } else {
        setForm((current) => ({
          ...current,
          gallery_urls: [...listFromTextarea(current.gallery_urls), url].join("\n"),
        }));
      }
      toast.success(kind === "main" ? "Image principale uploadée." : "Image ajoutée à la galerie.");
    } catch (error: any) {
      toast.error(error?.message ?? "Upload impossible. Vérifiez le bucket hotel-images.");
    } finally {
      setUploadingImage(null);
    }
  };

  const saveHotel = async () => {
    if (!form.name.trim() || !form.city.trim()) {
      toast.error("Nom et ville sont obligatoires.");
      return;
    }

    const payload = {
      slug: form.slug.trim() || makeHotelSlug({ city: form.city.trim(), name: form.name.trim() }),
      name: form.name.trim(),
      city: form.city.trim(),
      category: form.category || null,
      main_image_url: form.main_image_url.trim() || null,
      gallery_urls: listFromTextarea(form.gallery_urls),
      short_description_fr: form.short_description_fr.trim() || null,
      short_description_en: form.short_description_en.trim() || null,
      short_description_ar: form.short_description_ar.trim() || null,
      full_description_fr: form.full_description_fr.trim() || null,
      full_description_en: form.full_description_en.trim() || null,
      full_description_ar: form.full_description_ar.trim() || null,
      address: form.address.trim() || null,
      website_url: form.website_url.trim() || null,
      google_maps_url: form.google_maps_url.trim() || null,
      phone: form.phone.trim() || null,
      amenities: listFromTextarea(form.amenities),
      advantages: listFromTextarea(form.advantages),
      internal_notes: form.internal_notes.trim() || null,
      brochure_pdf_url: form.brochure_pdf_url.trim() || null,
      is_active: form.is_active,
      sort_order: Number(form.sort_order || 100),
      updated_at: new Date().toISOString(),
    };

    setSaving(true);
    const result = form.id
      ? await db.from("hotel_catalog").update(payload).eq("id", form.id)
      : await db.from("hotel_catalog").insert(payload);

    setSaving(false);
    if (result.error) {
      toast.error(result.error.message ?? "Impossible d'enregistrer l'hôtel.");
      return;
    }

    toast.success("Hôtel enregistré.");
    setDialogOpen(false);
    await loadHotels();
  };

  const deleteHotel = async (hotel: HotelCatalogItem) => {
    if (!window.confirm(`Supprimer l'hôtel "${hotel.name}" ? Cette action retire la fiche du catalogue.`)) return;
    const { error } = await db.from("hotel_catalog").delete().eq("id", hotel.id);
    if (error) {
      toast.error(error.message ?? "Impossible de supprimer l'hôtel.");
      return;
    }
    toast.success("Hôtel supprimé.");
    await loadHotels();
  };

  const archiveHotel = async (hotel: HotelCatalogItem) => {
    if (!window.confirm(`Archiver l'hôtel "${hotel.name}" ? Il ne sera plus visible sur le site public ni dans l'extranet agences.`)) return;
    const { error } = await db.from("hotel_catalog").update({ is_active: false }).eq("id", hotel.id);
    if (error) {
      toast.error(error.message ?? "Impossible d'archiver l'hôtel.");
      return;
    }
    toast.success("Hôtel archivé.");
    await loadHotels();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl">Hôtels</h1>
          <p className="mt-1 text-sm text-muted-foreground">Catalogue hôtelier utilisé sur le site public et l'extranet agences.</p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" />
          Nouvel hôtel
        </Button>
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Select value={cityFilter} onValueChange={setCityFilter}>
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les villes</SelectItem>
              {cities.map((city) => (
                <SelectItem key={city} value={city}>{city}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">{visibleHotels.length} hôtel(s)</p>
        </div>
      </Card>

      {error && (
        <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          {error}
        </Card>
      )}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement des hôtels…
          </div>
        ) : visibleHotels.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">Aucun hôtel.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="bg-secondary/55">
                <tr className="text-left">
                  <th className="p-4 font-semibold">Hôtel</th>
                  <th className="p-4 font-semibold">Ville</th>
                  <th className="p-4 font-semibold">Catégorie</th>
                  <th className="p-4 font-semibold">Statut</th>
                  <th className="p-4 font-semibold">Brochure</th>
                  <th className="p-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleHotels.map((hotel) => (
                  <tr key={hotel.id} className="hover:bg-secondary/30">
                    <td className="p-4">
                      <p className="font-medium">{hotel.name}</p>
                      <p className="text-xs text-muted-foreground">{hotel.slug}</p>
                    </td>
                    <td className="p-4">{hotel.city}</td>
                    <td className="p-4">{hotel.category || "—"}</td>
                    <td className="p-4">{hotel.is_active ? "Actif" : "Inactif"}</td>
                    <td className="p-4">{hotel.brochure_pdf_url ? "Disponible" : "—"}</td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => openEdit(hotel)}>
                          Modifier
                        </Button>
                        {hotel.is_active && (
                          <Button type="button" variant="outline" size="sm" onClick={() => archiveHotel(hotel)}>
                            Archiver
                          </Button>
                        )}
                        <Button type="button" variant="outline" size="sm" onClick={() => deleteHotel(hotel)}>
                          <Trash2 className="h-3.5 w-3.5" />
                          Supprimer
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Modifier l'hôtel" : "Nouvel hôtel"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Nom *</Label>
              <Input value={form.name} onChange={(event) => setField("name", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Ville *</Label>
              <Input value={form.city} onChange={(event) => setField("city", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Slug</Label>
              <Input value={form.slug} onChange={(event) => setField("slug", event.target.value)} placeholder="tokyo-shinagawa-prince-hotel" />
            </div>
            <div className="space-y-2">
              <Label>Catégorie</Label>
              <Select value={form.category} onValueChange={(value) => setField("category", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="3*">3*</SelectItem>
                  <SelectItem value="4*">4*</SelectItem>
                  <SelectItem value="5*">5*</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Image principale</Label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input value={form.main_image_url} onChange={(event) => setField("main_image_url", event.target.value)} placeholder="URL ou image uploadée" />
                <Button type="button" variant="outline" disabled={uploadingImage === "main"} className="shrink-0">
                  <label className="inline-flex cursor-pointer items-center gap-2">
                    {uploadingImage === "main" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    Uploader
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        void uploadHotelImage("main", event.target.files?.[0]);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                </Button>
              </div>
              {form.main_image_url && (
                <div className="mt-3 flex items-start gap-3 rounded-lg border border-border p-3">
                  <img src={form.main_image_url} alt="" className="h-24 w-36 rounded-md object-cover" />
                  <Button type="button" variant="ghost" size="sm" onClick={() => setField("main_image_url", "")}>
                    <X className="h-4 w-4" /> Retirer
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Galerie</Label>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <Textarea rows={3} value={form.gallery_urls} onChange={(event) => setField("gallery_urls", event.target.value)} placeholder="URLs une par ligne ou images uploadées" />
                <Button type="button" variant="outline" disabled={uploadingImage === "gallery"} className="shrink-0">
                  <label className="inline-flex cursor-pointer items-center gap-2">
                    {uploadingImage === "gallery" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    Ajouter image
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      multiple
                      onChange={async (event) => {
                        const files = Array.from(event.target.files ?? []);
                        for (const file of files) await uploadHotelImage("gallery", file);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                </Button>
              </div>
              {listFromTextarea(form.gallery_urls).length > 0 && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {listFromTextarea(form.gallery_urls).map((url, index) => (
                    <div key={`${url}-${index}`} className="group relative overflow-hidden rounded-lg border border-border">
                      <img src={url} alt="" className="h-24 w-full object-cover" />
                      <button
                        type="button"
                        className="absolute right-1 top-1 rounded-full bg-background/90 p-1 opacity-0 shadow group-hover:opacity-100"
                        onClick={() => setField("gallery_urls", listFromTextarea(form.gallery_urls).filter((_, itemIndex) => itemIndex !== index).join("\n"))}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>Description courte FR</Label>
              <Textarea rows={3} value={form.short_description_fr} onChange={(event) => setField("short_description_fr", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Description courte EN</Label>
              <Textarea rows={3} value={form.short_description_en} onChange={(event) => setField("short_description_en", event.target.value)} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Description courte AR</Label>
              <Textarea rows={3} value={form.short_description_ar} onChange={(event) => setField("short_description_ar", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Description complète FR</Label>
              <Textarea rows={5} value={form.full_description_fr} onChange={(event) => setField("full_description_fr", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Description complète EN</Label>
              <Textarea rows={5} value={form.full_description_en} onChange={(event) => setField("full_description_en", event.target.value)} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Description complète AR</Label>
              <Textarea rows={4} value={form.full_description_ar} onChange={(event) => setField("full_description_ar", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Adresse</Label>
              <Input value={form.address} onChange={(event) => setField("address", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Téléphone</Label>
              <Input value={form.phone} onChange={(event) => setField("phone", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Site web</Label>
              <Input value={form.website_url} onChange={(event) => setField("website_url", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Google Maps</Label>
              <Input value={form.google_maps_url} onChange={(event) => setField("google_maps_url", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Amenities (une par ligne)</Label>
              <Textarea rows={4} value={form.amenities} onChange={(event) => setField("amenities", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Avantages (un par ligne)</Label>
              <Textarea rows={4} value={form.advantages} onChange={(event) => setField("advantages", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Brochure PDF URL</Label>
              <Input value={form.brochure_pdf_url} onChange={(event) => setField("brochure_pdf_url", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Ordre</Label>
              <Input type="number" value={form.sort_order} onChange={(event) => setField("sort_order", event.target.value)} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Notes internes</Label>
              <Textarea rows={3} value={form.internal_notes} onChange={(event) => setField("internal_notes", event.target.value)} />
            </div>
            <div className="flex items-center gap-3 md:col-span-2">
              <Switch checked={form.is_active} onCheckedChange={(checked) => setField("is_active", checked)} />
              <Label>Actif</Label>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Annuler</Button>
            <Button type="button" onClick={saveHotel} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
