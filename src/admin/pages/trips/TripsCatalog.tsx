import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, Upload, Star, X, Copy } from "lucide-react";
import { fmtDate, fmtMAD, slugify } from "@/lib/format";
import { toast } from "sonner";

type Trip = any;

const empty: Trip = {
  title: "", slug: "", season: "", destination: "", start_date: "", end_date: "",
  duration_days: 14, base_price_mad: 0, total_slots: 12, slots_left: 12,
  short_description: "", long_description: "", status: "draft", is_featured: false,
  label: "", badge_type: "", badge_text: "", destinations: [] as string[],
  program_link: "", promo_percent: null, sort_order: 0, cover_url: "",
};

export default function TripsCatalog() {
  const [rows, setRows] = useState<Trip[]>([]);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Trip>(empty);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [destInput, setDestInput] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const { data } = await supabase
      .from("trips")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    setRows(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true);
    try {
      const payload: any = {
        ...edit,
        slug: edit.slug || slugify(edit.title),
        destinations: edit.destinations ?? [],
        promo_percent: edit.promo_percent === "" || edit.promo_percent == null ? null : Number(edit.promo_percent),
      };
      if (edit.id) {
        const { error } = await supabase.from("trips").update(payload).eq("id", edit.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("trips").insert(payload);
        if (error) throw error;
      }
      toast.success("Voyage enregistré");
      setOpen(false);
      setEdit(empty);
      setDestInput("");
      load();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!confirm("Supprimer ce voyage ?")) return;
    const { error } = await supabase.from("trips").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Supprimé");
    load();
  };

  const duplicateTrip = async (trip: Trip) => {
    const copyTitle = `${trip.title} (copie)`;
    const copyPayload = {
      ...trip,
      id: undefined,
      created_at: undefined,
      updated_at: undefined,
      created_by: undefined,
      title: copyTitle,
      slug: `${slugify(copyTitle)}-${Date.now().toString().slice(-6)}`,
      status: "draft",
      is_featured: false,
      sort_order: rows.length,
      destinations: [...(trip.destinations ?? [])],
    };

    const { error } = await supabase.from("trips").insert(copyPayload);
    if (error) return toast.error(error.message);
    toast.success("Voyage dupliqué");
    load();
  };

  const moveRow = async (id: string, dir: -1 | 1) => {
    const idx = rows.findIndex((r) => r.id === id);
    const swap = rows[idx + dir];
    if (!swap) return;
    const a = rows[idx];
    const aOrder = a.sort_order ?? idx;
    const bOrder = swap.sort_order ?? idx + dir;
    await supabase.from("trips").update({ sort_order: bOrder }).eq("id", a.id);
    await supabase.from("trips").update({ sort_order: aOrder }).eq("id", swap.id);
    load();
  };

  const toggleFeatured = async (t: Trip) => {
    await supabase.from("trips").update({ is_featured: !t.is_featured }).eq("id", t.id);
    load();
  };

  const uploadCover = async (file: File) => {
    setUploading(true);
    try {
      const { optimizeImage } = await import("@/lib/image-upload");
      const optimized = await optimizeImage(file);
      const ext = optimized.name.split(".").pop() || "webp";
      const path = `trips/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from("media")
        .upload(path, optimized, { upsert: true, contentType: optimized.type });
      if (error) throw error;
      const url = supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
      setEdit({ ...edit, cover_url: url });
      toast.success("Image téléchargée");
    } catch (e: any) { toast.error(e.message); } finally { setUploading(false); }
  };

  const addDestination = () => {
    const v = destInput.trim();
    if (!v) return;
    setEdit({ ...edit, destinations: [...(edit.destinations ?? []), v] });
    setDestInput("");
  };
  const removeDestination = (i: number) => {
    const arr = [...(edit.destinations ?? [])];
    arr.splice(i, 1);
    setEdit({ ...edit, destinations: arr });
  };

  return (
    <div>
      <PageHeader title="Voyages" description="Gérez vos départs, vignettes, badges et tarifs."
        action={
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEdit(empty); setDestInput(""); } }}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4" /> Nouveau voyage</Button></DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>{edit.id ? "Modifier" : "Nouveau"} voyage</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2"><Label>Titre</Label><Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></div>
                <div><Label>Slug</Label><Input value={edit.slug} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} placeholder="auto" /></div>
                <div><Label>Label (ex: SAKURA)</Label><Input value={edit.label ?? ""} onChange={(e) => setEdit({ ...edit, label: e.target.value })} placeholder="SAKURA, MOMIJI…" /></div>
                <div><Label>Saison</Label><Input value={edit.season ?? ""} onChange={(e) => setEdit({ ...edit, season: e.target.value })} placeholder="Printemps, Été…" /></div>
                <div><Label>Statut</Label>
                  <Select value={edit.status} onValueChange={(v) => setEdit({ ...edit, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Brouillon</SelectItem>
                      <SelectItem value="open">Ouvert</SelectItem>
                      <SelectItem value="closed">Fermé</SelectItem>
                      <SelectItem value="completed">Terminé</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Type de badge</Label>
                  <Select value={edit.badge_type || "none"} onValueChange={(v) => setEdit({ ...edit, badge_type: v === "none" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="Aucun" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Aucun</SelectItem>
                      <SelectItem value="popular">Plus populaire</SelectItem>
                      <SelectItem value="new">Nouveau</SelectItem>
                      <SelectItem value="bestseller">Bestseller</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Texte du badge (optionnel)</Label><Input value={edit.badge_text ?? ""} onChange={(e) => setEdit({ ...edit, badge_text: e.target.value })} placeholder="Auto si vide" /></div>
                <div><Label>Date début</Label><Input type="date" value={edit.start_date ?? ""} onChange={(e) => setEdit({ ...edit, start_date: e.target.value })} /></div>
                <div><Label>Date fin</Label><Input type="date" value={edit.end_date ?? ""} onChange={(e) => setEdit({ ...edit, end_date: e.target.value })} /></div>
                <div><Label>Durée (jours)</Label><Input type="number" value={edit.duration_days ?? 14} onChange={(e) => setEdit({ ...edit, duration_days: +e.target.value })} /></div>
                <div><Label>Prix base (MAD)</Label><Input type="number" value={edit.base_price_mad} onChange={(e) => setEdit({ ...edit, base_price_mad: +e.target.value })} /></div>
                <div><Label>Places totales</Label><Input type="number" value={edit.total_slots} onChange={(e) => setEdit({ ...edit, total_slots: +e.target.value })} /></div>
                <div><Label>Places restantes</Label><Input type="number" value={edit.slots_left} onChange={(e) => setEdit({ ...edit, slots_left: +e.target.value })} /></div>
                <div><Label>Promotion (%)</Label><Input type="number" value={edit.promo_percent ?? ""} onChange={(e) => setEdit({ ...edit, promo_percent: e.target.value === "" ? null : +e.target.value })} placeholder="ex: 10" /></div>
                <div><Label>Lien programme</Label><Input value={edit.program_link ?? ""} onChange={(e) => setEdit({ ...edit, program_link: e.target.value })} placeholder="/programme?trip=…" /></div>

                <div className="col-span-2">
                  <Label>Image de couverture</Label>
                  <div className="flex gap-3 items-start mt-1.5">
                    {edit.cover_url && (
                      <img src={edit.cover_url} alt="cover" className="w-32 h-40 object-cover rounded-lg border border-border" />
                    )}
                    <div className="flex-1 space-y-2">
                      <Input value={edit.cover_url ?? ""} onChange={(e) => setEdit({ ...edit, cover_url: e.target.value })} placeholder="URL de l'image" />
                      <Input value={edit.cover_alt ?? ""} onChange={(e) => setEdit({ ...edit, cover_alt: e.target.value })} placeholder="Texte alternatif (ALT) — décrit l'image pour le SEO" />
                      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCover(f); }} />
                      <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                        <Upload className="w-4 h-4" /> {uploading ? "Téléchargement…" : "Téléverser une image"}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="col-span-2">
                  <Label>Destinations (tags)</Label>
                  <div className="flex gap-2 mt-1.5">
                    <Input value={destInput} onChange={(e) => setDestInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDestination(); } }} placeholder="Tokyo, Kyoto, Osaka…" />
                    <Button type="button" variant="outline" onClick={addDestination}>Ajouter</Button>
                  </div>
                  {edit.destinations && edit.destinations.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {edit.destinations.map((d: string, i: number) => (
                        <Badge key={i} variant="secondary" className="gap-1">
                          {d}
                          <button type="button" onClick={() => removeDestination(i)} className="hover:text-destructive"><X className="w-3 h-3" /></button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                <div className="col-span-2"><Label>Description courte</Label><Textarea rows={2} value={edit.short_description ?? ""} onChange={(e) => setEdit({ ...edit, short_description: e.target.value })} /></div>
                <div className="col-span-2"><Label>Description longue</Label><Textarea rows={5} value={edit.long_description ?? ""} onChange={(e) => setEdit({ ...edit, long_description: e.target.value })} /></div>

                <div className="col-span-2 flex items-center gap-3 pt-2 border-t border-border">
                  <Switch checked={!!edit.is_featured} onCheckedChange={(v) => setEdit({ ...edit, is_featured: v })} />
                  <div>
                    <Label className="cursor-pointer">Afficher sur la page d'accueil</Label>
                    <p className="text-xs text-muted-foreground">Le voyage apparaîtra dans "Nos prochains départs"</p>
                  </div>
                </div>
              </div>
              <DialogFooter><Button onClick={save} disabled={busy || !edit.title}>{busy ? "…" : "Enregistrer"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="bg-background rounded-2xl border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50">
            <tr className="text-left">
              <th className="p-4 font-semibold w-20">Ordre</th>
              <th className="p-4 font-semibold">Voyage</th>
              <th className="p-4 font-semibold">Label / Saison</th>
              <th className="p-4 font-semibold">Dates</th>
              <th className="p-4 font-semibold">Prix</th>
              <th className="p-4 font-semibold">Places</th>
              <th className="p-4 font-semibold">Home</th>
              <th className="p-4 font-semibold">Statut</th>
              <th className="p-4"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">Aucun voyage. Créez-en un.</td></tr>}
            {rows.map((t, idx) => (
              <tr key={t.id} className="hover:bg-secondary/30">
                <td className="p-4">
                  <div className="flex flex-col gap-0.5">
                    <Button size="icon" variant="ghost" className="h-6 w-6" disabled={idx === 0} onClick={() => moveRow(t.id, -1)}><ArrowUp className="w-3 h-3" /></Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6" disabled={idx === rows.length - 1} onClick={() => moveRow(t.id, 1)}><ArrowDown className="w-3 h-3" /></Button>
                  </div>
                </td>
                <td className="p-4">
                  <div className="flex gap-3 items-center">
                    {t.cover_url && <img src={t.cover_url} alt={t.title} className="w-12 h-12 rounded-lg object-cover" />}
                    <div>
                      <p className="font-medium">{t.title}</p>
                      <p className="text-xs text-muted-foreground">{t.slug}</p>
                    </div>
                  </div>
                </td>
                <td className="p-4">
                  <div className="flex flex-col gap-0.5">
                    {t.label && <span className="text-xs font-semibold uppercase tracking-wider">{t.label}</span>}
                    <span className="text-xs text-muted-foreground">{t.season ?? "—"}</span>
                  </div>
                </td>
                <td className="p-4">{fmtDate(t.start_date)} → {fmtDate(t.end_date)}</td>
                <td className="p-4">{fmtMAD(t.base_price_mad)}</td>
                <td className="p-4">{t.slots_left} / {t.total_slots}</td>
                <td className="p-4">
                  <Button size="icon" variant="ghost" onClick={() => toggleFeatured(t)} className={t.is_featured ? "text-accent" : "text-muted-foreground"}>
                    <Star className={`w-4 h-4 ${t.is_featured ? "fill-current" : ""}`} />
                  </Button>
                </td>
                <td className="p-4"><StatusBadge value={t.status} /></td>
                <td className="p-4 text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => { setEdit({ ...empty, ...t, destinations: t.destinations ?? [] }); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => duplicateTrip(t)}><Copy className="w-4 h-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(t.id)}><Trash2 className="w-4 h-4" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
