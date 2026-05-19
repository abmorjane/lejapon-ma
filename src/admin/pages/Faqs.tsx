import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, Eye, EyeOff } from "lucide-react";

type Category = "voyage" | "prix_reservation" | "visa" | "organisation" | "conseils_pratiques";

const CATEGORY_LABEL: Record<Category, string> = {
  voyage: "Voyage",
  prix_reservation: "Prix & réservation",
  visa: "Visa",
  organisation: "Organisation",
  conseils_pratiques: "Conseils pratiques",
};

type FaqRow = {
  id: string;
  category: Category;
  question_fr: string; answer_fr: string;
  question_en: string | null; answer_en: string | null;
  question_ar: string | null; answer_ar: string | null;
  meta_title_fr: string | null; meta_description_fr: string | null;
  meta_title_en: string | null; meta_description_en: string | null;
  meta_title_ar: string | null; meta_description_ar: string | null;
  sort_order: number;
  is_published: boolean;
};

const emptyFaq: Omit<FaqRow, "id"> = {
  category: "voyage",
  question_fr: "", answer_fr: "",
  question_en: "", answer_en: "",
  question_ar: "", answer_ar: "",
  meta_title_fr: "", meta_description_fr: "",
  meta_title_en: "", meta_description_en: "",
  meta_title_ar: "", meta_description_ar: "",
  sort_order: 0,
  is_published: true,
};

const AdminFaqs = () => {
  const [rows, setRows] = useState<FaqRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCat, setFilterCat] = useState<Category | "all">("all");
  const [editing, setEditing] = useState<FaqRow | null>(null);
  const [open, setOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("faqs")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) toast.error(error.message);
    setRows((data ?? []) as FaqRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    const nextOrder = (rows[rows.length - 1]?.sort_order ?? 0) + 10;
    setEditing({ ...emptyFaq, id: "", sort_order: nextOrder });
    setOpen(true);
  };

  const openEdit = (r: FaqRow) => { setEditing({ ...r }); setOpen(true); };

  const save = async () => {
    if (!editing) return;
    if (!editing.question_fr.trim() || !editing.answer_fr.trim()) {
      toast.error("La question et la réponse en français sont obligatoires.");
      return;
    }
    const payload: any = {
      category: editing.category,
      question_fr: editing.question_fr.trim(),
      answer_fr: editing.answer_fr.trim(),
      question_en: editing.question_en?.trim() || null,
      answer_en: editing.answer_en?.trim() || null,
      question_ar: editing.question_ar?.trim() || null,
      answer_ar: editing.answer_ar?.trim() || null,
      meta_title_fr: editing.meta_title_fr?.trim() || null,
      meta_description_fr: editing.meta_description_fr?.trim() || null,
      meta_title_en: editing.meta_title_en?.trim() || null,
      meta_description_en: editing.meta_description_en?.trim() || null,
      meta_title_ar: editing.meta_title_ar?.trim() || null,
      meta_description_ar: editing.meta_description_ar?.trim() || null,
      sort_order: editing.sort_order ?? 0,
      is_published: editing.is_published,
    };
    const res = editing.id
      ? await supabase.from("faqs").update(payload).eq("id", editing.id)
      : await supabase.from("faqs").insert(payload);
    if (res.error) { toast.error(res.error.message); return; }
    toast.success("Enregistré");
    setOpen(false);
    setEditing(null);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Supprimer cette question ?")) return;
    const { error } = await supabase.from("faqs").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Supprimé");
    load();
  };

  const togglePublish = async (r: FaqRow) => {
    const { error } = await supabase.from("faqs").update({ is_published: !r.is_published }).eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const list = visible;
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= list.length) return;
    const a = list[idx], b = list[swapIdx];
    await supabase.from("faqs").update({ sort_order: b.sort_order }).eq("id", a.id);
    await supabase.from("faqs").update({ sort_order: a.sort_order }).eq("id", b.id);
    load();
  };

  const visible = filterCat === "all" ? rows : rows.filter((r) => r.category === filterCat);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">FAQ</h1>
          <p className="text-sm text-muted-foreground">Questions / réponses publiées sur le site (FR / EN / AR).</p>
        </div>
        <Button onClick={openNew}><Plus className="w-4 h-4" /> Nouvelle question</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => setFilterCat("all")} className={`text-xs uppercase tracking-widest px-3 py-1.5 rounded-full border ${filterCat === "all" ? "bg-foreground text-background border-foreground" : "border-border"}`}>
          Toutes ({rows.length})
        </button>
        {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => {
          const n = rows.filter((r) => r.category === c).length;
          return (
            <button key={c} onClick={() => setFilterCat(c)} className={`text-xs uppercase tracking-widest px-3 py-1.5 rounded-full border ${filterCat === c ? "bg-foreground text-background border-foreground" : "border-border"}`}>
              {CATEGORY_LABEL[c]} ({n})
            </button>
          );
        })}
      </div>

      {loading ? (
        <p className="text-muted-foreground">Chargement…</p>
      ) : (
        <div className="bg-background border border-border rounded-lg divide-y divide-border">
          {visible.length === 0 && (
            <p className="p-6 text-sm text-muted-foreground">Aucune question.</p>
          )}
          {visible.map((r, idx) => (
            <div key={r.id} className="p-4 flex items-start gap-3">
              <div className="flex flex-col gap-1">
                <button onClick={() => move(idx, -1)} disabled={idx === 0} className="p-1 disabled:opacity-30 hover:text-accent"><ArrowUp className="w-4 h-4" /></button>
                <button onClick={() => move(idx, 1)} disabled={idx === visible.length - 1} className="p-1 disabled:opacity-30 hover:text-accent"><ArrowDown className="w-4 h-4" /></button>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-[10px] uppercase tracking-widest text-accent">{CATEGORY_LABEL[r.category]}</span>
                  {!r.is_published && <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Masqué</span>}
                  <span className="text-[10px] text-muted-foreground">
                    FR{r.question_en ? " · EN" : ""}{r.question_ar ? " · AR" : ""}
                  </span>
                </div>
                <p className="font-medium truncate">{r.question_fr}</p>
                <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{r.answer_fr}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => togglePublish(r)} className="p-2 hover:text-accent" title={r.is_published ? "Masquer" : "Publier"}>
                  {r.is_published ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
                <button onClick={() => openEdit(r)} className="p-2 hover:text-accent"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => remove(r.id)} className="p-2 hover:text-destructive"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Modifier la question" : "Nouvelle question"}</DialogTitle>
          </DialogHeader>

          {editing && (
            <div className="space-y-5">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label>Catégorie</Label>
                  <Select value={editing.category} onValueChange={(v) => setEditing({ ...editing, category: v as Category })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
                        <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Ordre d'affichage</Label>
                  <Input
                    type="number"
                    value={editing.sort_order}
                    onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) || 0 })}
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Switch checked={editing.is_published} onCheckedChange={(v) => setEditing({ ...editing, is_published: v })} />
                <Label className="!mb-0">{editing.is_published ? "Publié sur le site" : "Masqué"}</Label>
              </div>

              <Tabs defaultValue="fr">
                <TabsList>
                  <TabsTrigger value="fr">FR</TabsTrigger>
                  <TabsTrigger value="en">EN</TabsTrigger>
                  <TabsTrigger value="ar">AR</TabsTrigger>
                </TabsList>

                {(["fr", "en", "ar"] as const).map((lng) => {
                  const qKey = `question_${lng}` as const;
                  const aKey = `answer_${lng}` as const;
                  const mtKey = `meta_title_${lng}` as const;
                  const mdKey = `meta_description_${lng}` as const;
                  const isAr = lng === "ar";
                  return (
                    <TabsContent key={lng} value={lng} className="space-y-4 pt-4">
                      <div>
                        <Label>Question {lng === "fr" && <span className="text-destructive">*</span>}</Label>
                        <Input
                          dir={isAr ? "rtl" : "ltr"}
                          value={(editing as any)[qKey] ?? ""}
                          onChange={(e) => setEditing({ ...editing, [qKey]: e.target.value } as any)}
                        />
                      </div>
                      <div>
                        <Label>Réponse {lng === "fr" && <span className="text-destructive">*</span>}</Label>
                        <Textarea
                          rows={6}
                          dir={isAr ? "rtl" : "ltr"}
                          value={(editing as any)[aKey] ?? ""}
                          onChange={(e) => setEditing({ ...editing, [aKey]: e.target.value } as any)}
                        />
                      </div>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div>
                          <Label>Meta title (SEO)</Label>
                          <Input
                            dir={isAr ? "rtl" : "ltr"}
                            value={(editing as any)[mtKey] ?? ""}
                            onChange={(e) => setEditing({ ...editing, [mtKey]: e.target.value } as any)}
                          />
                        </div>
                        <div>
                          <Label>Meta description (SEO)</Label>
                          <Input
                            dir={isAr ? "rtl" : "ltr"}
                            value={(editing as any)[mdKey] ?? ""}
                            onChange={(e) => setEditing({ ...editing, [mdKey]: e.target.value } as any)}
                          />
                        </div>
                      </div>
                    </TabsContent>
                  );
                })}
              </Tabs>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            <Button onClick={save}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminFaqs;