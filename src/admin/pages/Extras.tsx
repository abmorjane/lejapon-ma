import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "../components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Upload } from "lucide-react";
import { fmtMAD, slugify } from "@/lib/format";
import { optimizeImage } from "@/lib/image-upload";
import { toast } from "sonner";

const empty = { name: "", category: "", description: "", price_mad: 0, city: "", image_url: "", is_active: true, sort_order: 0 };

export default function Extras() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<any>(empty);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const { data } = await supabase.from("extras").select("*").order("sort_order").order("name");
    setRows(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const uploadImage = async (file: File | null) => {
    if (!file) return;
    setUploadingImage(true);
    try {
      const optimized = await optimizeImage(file);
      const path = `extras/${Date.now()}-${optimized.name}`;
      const { error: uploadError } = await supabase.storage
        .from("media")
        .upload(path, optimized, { contentType: optimized.type, upsert: false });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("media").getPublicUrl(path);
      setEdit((prev: any) => ({ ...prev, image_url: data.publicUrl }));
      toast.success("Image uploadée");
    } catch (error: any) {
      toast.error(error.message ?? "Impossible d'uploader l'image");
    } finally {
      setUploadingImage(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = async () => {
    const payload = { ...edit, slug: edit.slug || slugify(edit.name) };
    if (edit.id) await supabase.from("extras").update(payload).eq("id", edit.id);
    else await supabase.from("extras").insert(payload);
    toast.success("Enregistré"); setOpen(false); setEdit(empty); load();
  };
  const remove = async (id: string) => { if (!confirm("Supprimer ?")) return; await supabase.from("extras").delete().eq("id", id); load(); };

  return (
    <div>
      <PageHeader title="Extras / Activités" description="Activités optionnelles ajoutables aux voyages."
        action={
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEdit(empty); }}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4" /> Nouvelle activité</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{edit.id ? "Modifier" : "Nouvelle"} activité</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><Label>Nom</Label><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
                <div><Label>Catégorie</Label><Input value={edit.category ?? ""} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /></div>
                <div><Label>Ville</Label><Input value={edit.city ?? ""} onChange={(e) => setEdit({ ...edit, city: e.target.value })} /></div>
                <div><Label>Prix (MAD)</Label><Input type="number" value={edit.price_mad} onChange={(e) => setEdit({ ...edit, price_mad: +e.target.value })} /></div>
                <div><Label>Ordre</Label><Input type="number" value={edit.sort_order} onChange={(e) => setEdit({ ...edit, sort_order: +e.target.value })} /></div>
                <div className="col-span-2 space-y-3">
                  <Label>Image</Label>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => uploadImage(e.target.files?.[0] ?? null)}
                  />
                  <div className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Téléverser une photo</p>
                      <p className="text-xs text-muted-foreground">
                        JPG, PNG, WEBP… l'URL sera remplie automatiquement.
                      </p>
                    </div>
                    <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploadingImage}>
                      <Upload className="w-4 h-4" />
                      {uploadingImage ? "Upload…" : "Uploader une image"}
                    </Button>
                  </div>
                  <Input
                    value={edit.image_url ?? ""}
                    placeholder="Ou collez une URL d'image"
                    onChange={(e) => setEdit({ ...edit, image_url: e.target.value })}
                  />
                  <Input
                    value={edit.alt_text ?? ""}
                    placeholder="Texte alternatif (ALT) — décrit l'image pour le SEO"
                    onChange={(e) => setEdit({ ...edit, alt_text: e.target.value })}
                  />
                  {edit.image_url && (
                    <div className="overflow-hidden rounded-lg border border-border bg-secondary">
                      <img src={edit.image_url} alt={edit.name || "Aperçu de l'activité"} className="h-40 w-full object-cover" />
                    </div>
                  )}
                </div>
                <div className="col-span-2"><Label>Description</Label><Textarea rows={3} value={edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
                <div className="col-span-2 flex items-center gap-2"><Switch checked={edit.is_active} onCheckedChange={(v) => setEdit({ ...edit, is_active: v })} /> <Label>Actif (visible sur le site)</Label></div>
              </div>
              <DialogFooter><Button onClick={save} disabled={!edit.name}>Enregistrer</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map((e) => (
          <div key={e.id} className="bg-background rounded-2xl border border-border overflow-hidden">
            {e.image_url && <img src={e.image_url} alt={e.name} className="w-full h-40 object-cover" />}
            <div className="p-5">
              <div className="flex items-start justify-between gap-2 mb-1">
                <h3 className="font-display text-lg">{e.name}</h3>
                <span className="text-accent font-semibold whitespace-nowrap">{fmtMAD(e.price_mad)}</span>
              </div>
              <p className="text-xs text-muted-foreground">{e.category} · {e.city}</p>
              <p className="text-sm mt-2 line-clamp-2">{e.description}</p>
              <div className="flex justify-between items-center mt-4">
                <span className={`text-xs ${e.is_active ? "text-success" : "text-muted-foreground"}`}>{e.is_active ? "● Actif" : "○ Inactif"}</span>
                <div>
                  <Button size="sm" variant="ghost" onClick={() => { setEdit(e); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(e.id)}><Trash2 className="w-4 h-4" /></Button>
                </div>
              </div>
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="col-span-full text-center text-muted-foreground py-12">Aucune activité.</p>}
      </div>
    </div>
  );
}
