import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Upload, X, ArrowUp, ArrowDown, Loader2, ImagePlus, Tag } from "lucide-react";
import { fmtDate, slugify } from "@/lib/format";
import { optimizeImage } from "@/lib/image-upload";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

type Category = { id: string; name: string; slug: string };

const parseCategories = (value: string | null | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const serializeCategories = (list: string[]): string =>
  Array.from(new Set(list.map((s) => s.trim()).filter(Boolean))).join(", ");

const empty: any = {
  title: "",
  slug: "",
  excerpt: "",
  body: "",
  cover_url: "",
  category: "",
  status: "draft",
  tags: [],
  meta_title: "",
  meta_description: "",
  gallery_images: [],
  published_at: null,
};

const uploadImage = async (file: File): Promise<string> => {
  const optimized = await optimizeImage(file);
  const ext = optimized.name.split(".").pop() || "webp";
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from("article-images")
    .upload(path, optimized, { upsert: false, contentType: optimized.type });
  if (error) throw error;
  const { data } = supabase.storage.from("article-images").getPublicUrl(path);
  return data.publicUrl;
};

export default function Articles() {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<any>(empty);
  const [tagInput, setTagInput] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);

  const load = async () => {
    const [{ data: arts }, { data: cats }] = await Promise.all([
      supabase.from("articles").select("*").order("created_at", { ascending: false }),
      supabase.from("article_categories").select("*").order("sort_order"),
    ]);
    setRows(arts ?? []);
    setCategories(cats ?? []);
  };
  useEffect(() => { load(); }, []);

  const handleTitleChange = (title: string) => {
    setEdit((prev: any) => ({
      ...prev,
      title,
      slug: prev.id ? prev.slug : slugify(title),
      meta_title: prev.meta_title || title,
    }));
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (!t) return;
    if ((edit.tags ?? []).includes(t)) { setTagInput(""); return; }
    setEdit({ ...edit, tags: [...(edit.tags ?? []), t] });
    setTagInput("");
  };
  const removeTag = (t: string) =>
    setEdit({ ...edit, tags: (edit.tags ?? []).filter((x: string) => x !== t) });

  const onCoverUpload = async (file: File) => {
    try {
      setUploadingCover(true);
      const url = await uploadImage(file);
      setEdit((p: any) => ({ ...p, cover_url: url }));
      toast.success("Image de couverture téléversée");
    } catch (e: any) {
      toast.error(e.message ?? "Échec de l'upload");
    } finally { setUploadingCover(false); }
  };

  const onGalleryUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      setUploadingGallery(true);
      const urls: string[] = [];
      for (const f of Array.from(files)) urls.push(await uploadImage(f));
      setEdit((p: any) => ({ ...p, gallery_images: [...(p.gallery_images ?? []), ...urls] }));
      toast.success(`${urls.length} image(s) ajoutée(s)`);
    } catch (e: any) {
      toast.error(e.message ?? "Échec de l'upload");
    } finally { setUploadingGallery(false); }
  };

  const moveGallery = (i: number, dir: -1 | 1) => {
    const list = [...(edit.gallery_images ?? [])];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setEdit({ ...edit, gallery_images: list });
  };
  const removeGallery = (i: number) =>
    setEdit({ ...edit, gallery_images: (edit.gallery_images ?? []).filter((_: any, k: number) => k !== i) });

  const addCategory = async () => {
    const name = newCategory.trim();
    if (!name) return;
    if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      toast.info("Cette catégorie existe déjà");
      const current = parseCategories(edit.category);
      if (!current.some((c) => c.toLowerCase() === name.toLowerCase())) {
        setEdit({ ...edit, category: serializeCategories([...current, name]) });
      }
      setNewCategory("");
      return;
    }
    const slug = slugify(name);
    const { data, error } = await supabase
      .from("article_categories")
      .insert({ name, slug, sort_order: 999 })
      .select()
      .single();
    if (error) { toast.error(error.message); return; }
    setCategories((prev) => [...prev, data as Category]);
    const current = parseCategories(edit.category);
    setEdit({ ...edit, category: serializeCategories([...current, name]) });
    setNewCategory("");
    toast.success(`Catégorie "${name}" ajoutée`);
  };

  const toggleCategory = (name: string, checked: boolean) => {
    const current = parseCategories(edit.category);
    const next = checked
      ? [...current, name]
      : current.filter((c) => c.toLowerCase() !== name.toLowerCase());
    setEdit({ ...edit, category: serializeCategories(next) });
  };

  const save = async () => {
    if (!edit.title?.trim()) { toast.error("Le titre est requis"); return; }
    setBusy(true);
    try {
      const payload: any = {
        title: edit.title.trim(),
        slug: edit.slug?.trim() || slugify(edit.title),
        excerpt: edit.excerpt || null,
        body: edit.body || null,
        cover_url: edit.cover_url || null,
        category: edit.category || null,
        status: edit.status,
        tags: edit.tags ?? [],
        gallery_images: edit.gallery_images ?? [],
        meta_title: edit.meta_title || null,
        meta_description: edit.meta_description || null,
        author_id: user?.id,
        published_at:
          edit.status === "published"
            ? edit.published_at ?? new Date().toISOString()
            : null,
      };
      const { error } = edit.id
        ? await supabase.from("articles").update(payload).eq("id", edit.id)
        : await supabase.from("articles").insert(payload);
      if (error) throw error;
      toast.success("Article enregistré");
      setOpen(false);
      setEdit(empty);
      load();
    } catch (e: any) {
      toast.error(e.message ?? "Erreur d'enregistrement");
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!confirm("Supprimer cet article ?")) return;
    await supabase.from("articles").delete().eq("id", id);
    load();
  };

  // Aperçu Google
  const googleUrl = useMemo(() => {
    const slug = edit.slug?.trim() || slugify(edit.title || "");
    return `https://lejapon.ma/${slug || "votre-article"}`;
  }, [edit.slug, edit.title]);

  return (
    <div>
      <PageHeader
        title="Articles (Blog)"
        description="Articles publiés sur /blog. Catégories, galerie et SEO."
        action={
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEdit(empty); setTagInput(""); setNewCategory(""); } }}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4" /> Nouvel article</Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{edit.id ? "Modifier" : "Nouvel"} article</DialogTitle>
              </DialogHeader>

              <div className="space-y-6">
                {/* CONTENU */}
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Contenu</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <Label>Titre *</Label>
                      <Input value={edit.title} onChange={(e) => handleTitleChange(e.target.value)} />
                    </div>
                    <div>
                      <Label>Slug (URL)</Label>
                      <Input
                        value={edit.slug ?? ""}
                        onChange={(e) => setEdit({ ...edit, slug: slugify(e.target.value) })}
                        placeholder="auto-genere"
                      />
                    </div>
                    <div>
                      <Label>Date de publication</Label>
                      <Input
                        type="datetime-local"
                        value={edit.published_at ? new Date(edit.published_at).toISOString().slice(0, 16) : ""}
                        onChange={(e) => setEdit({ ...edit, published_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
                      />
                    </div>
                    <div className="col-span-2">
                      <Label>Catégories (plusieurs possibles)</Label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2 p-3 rounded-md border border-border bg-secondary/20">
                        {categories.length === 0 && (
                          <p className="text-xs text-muted-foreground col-span-full">Aucune catégorie. Ajoutez-en une en bas du formulaire.</p>
                        )}
                        {categories.map((c) => {
                          const checked = parseCategories(edit.category).some((x) => x.toLowerCase() === c.name.toLowerCase());
                          return (
                            <label key={c.id} className="flex items-center gap-2 cursor-pointer text-sm">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(v) => toggleCategory(c.name, !!v)}
                              />
                              <span>{c.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <div className="col-span-2">
                      <Label>Extrait (résumé court)</Label>
                      <Textarea rows={2} value={edit.excerpt ?? ""} onChange={(e) => setEdit({ ...edit, excerpt: e.target.value })} />
                    </div>
                    <div className="col-span-2">
                      <Label>Corps (texte / Markdown)</Label>
                      <Textarea rows={10} value={edit.body ?? ""} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
                    </div>
                  </div>
                </section>

                {/* IMAGE COUVERTURE */}
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Image de couverture</h3>
                  <div className="flex items-center gap-3">
                    {edit.cover_url ? (
                      <div className="relative w-40 h-28 rounded-md overflow-hidden border border-border">
                        <img src={edit.cover_url} alt="cover" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setEdit({ ...edit, cover_url: "" })}
                          className="absolute top-1 right-1 bg-background/90 rounded-full p-1 hover:bg-destructive hover:text-destructive-foreground"
                        ><X className="w-3 h-3" /></button>
                      </div>
                    ) : (
                      <div className="w-40 h-28 rounded-md border-2 border-dashed border-border flex items-center justify-center text-muted-foreground text-xs">
                        Aucune image
                      </div>
                    )}
                    <div className="flex-1 space-y-2">
                      <label
                        className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground cursor-pointer ${uploadingCover ? "opacity-50 pointer-events-none" : ""}`}
                      >
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={uploadingCover}
                          onChange={(e) => e.target.files?.[0] && onCoverUpload(e.target.files[0])}
                        />
                        {uploadingCover ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        {uploadingCover ? "Upload..." : "Téléverser une image"}
                      </label>
                      <Input
                        placeholder="Ou coller une URL d'image"
                        value={edit.cover_url ?? ""}
                        onChange={(e) => setEdit({ ...edit, cover_url: e.target.value })}
                      />
                      <Input
                        placeholder="Texte alternatif (ALT) — décrit l'image pour le SEO et l'accessibilité"
                        value={edit.cover_alt ?? ""}
                        onChange={(e) => setEdit({ ...edit, cover_alt: e.target.value })}
                      />
                    </div>
                  </div>
                </section>

                {/* GALERIE */}
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Galerie d'images</h3>
                  <label
                    className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground cursor-pointer ${uploadingGallery ? "opacity-50 pointer-events-none" : ""}`}
                  >
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      disabled={uploadingGallery}
                      onChange={(e) => { onGalleryUpload(e.target.files); e.target.value = ""; }}
                    />
                    {uploadingGallery ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
                    {uploadingGallery ? "Upload..." : "Ajouter des images"}
                  </label>
                  {(edit.gallery_images ?? []).length > 0 && (
                    <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                      {(edit.gallery_images ?? []).map((url: string, i: number) => (
                        <div key={i} className="relative group rounded-md overflow-hidden border border-border aspect-square">
                          <img src={url} alt={`gallery ${i}`} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-foreground/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-1">
                            <button type="button" onClick={() => moveGallery(i, -1)} className="bg-background/90 p-1 rounded hover:bg-background"><ArrowUp className="w-3 h-3" /></button>
                            <button type="button" onClick={() => moveGallery(i, 1)} className="bg-background/90 p-1 rounded hover:bg-background"><ArrowDown className="w-3 h-3" /></button>
                            <button type="button" onClick={() => removeGallery(i)} className="bg-destructive text-destructive-foreground p-1 rounded"><X className="w-3 h-3" /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* SEO */}
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">SEO</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <Label>Meta title</Label>
                      <Input
                        value={edit.meta_title ?? ""}
                        onChange={(e) => setEdit({ ...edit, meta_title: e.target.value })}
                        maxLength={70}
                        placeholder="60 caractères max conseillés"
                      />
                      <p className="text-xs text-muted-foreground mt-1">{(edit.meta_title ?? "").length}/60</p>
                    </div>
                    <div className="col-span-2">
                      <Label>Meta description</Label>
                      <Textarea
                        rows={2}
                        value={edit.meta_description ?? ""}
                        onChange={(e) => setEdit({ ...edit, meta_description: e.target.value })}
                        maxLength={180}
                        placeholder="160 caractères max conseillés"
                      />
                      <p className="text-xs text-muted-foreground mt-1">{(edit.meta_description ?? "").length}/160</p>
                    </div>
                    <div className="col-span-2">
                      <Label>Tags SEO</Label>
                      <div className="flex gap-2">
                        <Input
                          value={tagInput}
                          onChange={(e) => setTagInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                          placeholder="Ajouter un tag puis Entrée"
                        />
                        <Button type="button" variant="outline" onClick={addTag}><Tag className="w-4 h-4" /></Button>
                      </div>
                      {(edit.tags ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {edit.tags.map((t: string) => (
                            <Badge key={t} variant="secondary" className="gap-1">
                              {t}
                              <button type="button" onClick={() => removeTag(t)}><X className="w-3 h-3" /></button>
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Aperçu Google */}
                    <div className="col-span-2 border border-border rounded-md p-4 bg-secondary/30">
                      <p className="text-xs font-medium text-muted-foreground mb-2">Aperçu Google</p>
                      <div className="font-arial">
                        <p className="text-xs text-[#202124] truncate">{googleUrl}</p>
                        <p className="text-[#1a0dab] text-lg leading-snug mt-0.5 truncate">
                          {edit.meta_title || edit.title || "Titre de votre article"}
                        </p>
                        <p className="text-[#4d5156] text-sm leading-snug mt-0.5 line-clamp-2">
                          {edit.meta_description || edit.excerpt || "La meta description s'affichera ici…"}
                        </p>
                      </div>
                    </div>
                  </div>
                </section>

                {/* PUBLICATION */}
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Publication</h3>
                  <div>
                    <Label>Statut</Label>
                    <Select value={edit.status} onValueChange={(v) => setEdit({ ...edit, status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Brouillon</SelectItem>
                        <SelectItem value="published">Publié</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </section>

                {/* AJOUTER UNE CATÉGORIE */}
                <section className="space-y-2 border-t border-border pt-4">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">Ajouter une nouvelle catégorie</Label>
                  <div className="flex gap-2">
                    <Input
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      placeholder="Nom de la nouvelle catégorie"
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCategory(); } }}
                    />
                    <Button type="button" variant="outline" onClick={addCategory}>
                      <Plus className="w-4 h-4" /> Ajouter
                    </Button>
                  </div>
                </section>
              </div>

              <DialogFooter>
                <Button onClick={save} disabled={!edit.title || busy}>
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />} Enregistrer
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="bg-background rounded-2xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-left">
            <tr>
              <th className="p-4">Titre</th>
              <th className="p-4">Catégorie</th>
              <th className="p-4">Statut</th>
              <th className="p-4">Publié</th>
              <th className="p-4"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">Aucun article.</td></tr>
            )}
            {rows.map((a) => (
              <tr key={a.id} className="hover:bg-secondary/30">
                <td className="p-4">
                  <div className="flex items-center gap-3">
                    {a.cover_url && <img src={a.cover_url} alt="" className="w-12 h-12 rounded object-cover" />}
                    <div>
                      <p className="font-medium">{a.title}</p>
                      <p className="text-xs text-muted-foreground">/{a.slug}</p>
                    </div>
                  </div>
                </td>
                <td className="p-4">
                  {parseCategories(a.category).length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {parseCategories(a.category).map((c) => (
                        <Badge key={c} variant="secondary" className="text-xs">{c}</Badge>
                      ))}
                    </div>
                  ) : "—"}
                </td>
                <td className="p-4"><StatusBadge value={a.status} /></td>
                <td className="p-4 text-xs text-muted-foreground">{a.published_at ? fmtDate(a.published_at) : "—"}</td>
                <td className="p-4 text-right">
                  <Button size="sm" variant="ghost" onClick={() => { setEdit(a); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(a.id)}><Trash2 className="w-4 h-4" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
