import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/admin/components/PageHeader";
import { Plus, Trash2, Save, GripVertical, X } from "lucide-react";
import { toast } from "sonner";

type Checklist = {
  id: string;
  category: string;
  label: string;
  description: string | null;
  items: string[];
  is_active: boolean;
  sort_order: number;
};

export default function VisaChecklists() {
  const [list, setList] = useState<Checklist[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("visa_document_checklists")
      .select("*")
      .order("sort_order");
    if (error) return toast.error(error.message);
    setList((data ?? []).map((d: any) => ({ ...d, items: Array.isArray(d.items) ? d.items : [] })));
  };
  useEffect(() => { load(); }, []);

  const update = (id: string, patch: Partial<Checklist>) =>
    setList((arr) => arr.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const save = async (c: Checklist) => {
    setBusy(true);
    const { error } = await supabase.from("visa_document_checklists").update({
      label: c.label, description: c.description, items: c.items as any,
      is_active: c.is_active, sort_order: c.sort_order, category: c.category,
    }).eq("id", c.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Liste enregistrée");
  };

  const remove = async (c: Checklist) => {
    if (!confirm(`Supprimer la catégorie « ${c.label} » ?`)) return;
    const { error } = await supabase.from("visa_document_checklists").delete().eq("id", c.id);
    if (error) return toast.error(error.message);
    setList((arr) => arr.filter((x) => x.id !== c.id));
  };

  const create = async () => {
    const slug = prompt("Identifiant de la catégorie (ex: transit, working_holiday)")?.trim().toLowerCase().replace(/\s+/g, "_");
    if (!slug) return;
    const { data, error } = await supabase.from("visa_document_checklists").insert({
      category: slug, label: slug, items: [] as any, sort_order: list.length + 1,
    }).select("*").single();
    if (error) return toast.error(error.message);
    setList((arr) => [...arr, { ...(data as any), items: [] }]);
  };

  const addItem = (id: string) => {
    const c = list.find((x) => x.id === id);
    if (!c) return;
    update(id, { items: [...c.items, ""] });
  };
  const updItem = (id: string, idx: number, v: string) => {
    const c = list.find((x) => x.id === id)!;
    const next = [...c.items]; next[idx] = v;
    update(id, { items: next });
  };
  const delItem = (id: string, idx: number) => {
    const c = list.find((x) => x.id === id)!;
    update(id, { items: c.items.filter((_, i) => i !== idx) });
  };

  return (
    <div>
      <PageHeader
        title="Documents requis par catégorie"
        description="Listes éditables affichées aux clients selon le type de visa demandé."
        action={<Button onClick={create}><Plus className="w-4 h-4" /> Nouvelle catégorie</Button>}
      />

      <div className="space-y-4">
        {list.length === 0 && (
          <Card className="p-10 text-center text-muted-foreground">Aucune catégorie. Créez-en une pour commencer.</Card>
        )}
        {list.map((c) => (
          <Card key={c.id} className="p-5">
            <div className="grid md:grid-cols-12 gap-3 mb-3">
              <div className="md:col-span-3">
                <label className="text-xs text-muted-foreground">Identifiant</label>
                <Input value={c.category} onChange={(e) => update(c.id, { category: e.target.value })} />
              </div>
              <div className="md:col-span-5">
                <label className="text-xs text-muted-foreground">Libellé affiché</label>
                <Input value={c.label} onChange={(e) => update(c.id, { label: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground">Ordre</label>
                <Input type="number" value={c.sort_order} onChange={(e) => update(c.id, { sort_order: Number(e.target.value) })} />
              </div>
              <div className="md:col-span-2 flex items-end gap-2">
                <div className="flex items-center gap-2">
                  <Switch checked={c.is_active} onCheckedChange={(v) => update(c.id, { is_active: v })} />
                  <span className="text-sm">Actif</span>
                </div>
              </div>
            </div>

            <Textarea
              placeholder="Description (optionnel)"
              rows={2}
              value={c.description ?? ""}
              onChange={(e) => update(c.id, { description: e.target.value })}
            />

            <div className="mt-4">
              <p className="text-sm font-semibold mb-2">Documents requis ({c.items.length})</p>
              <div className="space-y-2">
                {c.items.map((it, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
                    <Input value={it} onChange={(e) => updItem(c.id, i, e.target.value)} placeholder={`Document #${i + 1}`} />
                    <Button variant="ghost" size="icon" onClick={() => delItem(c.id, i)}><X className="w-4 h-4" /></Button>
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={() => addItem(c.id)} className="mt-2">
                <Plus className="w-4 h-4" /> Ajouter un document
              </Button>
            </div>

            <div className="flex justify-between items-center mt-4 pt-4 border-t border-border">
              <Button variant="ghost" size="sm" onClick={() => remove(c)}>
                <Trash2 className="w-4 h-4" /> Supprimer
              </Button>
              <Button size="sm" onClick={() => save(c)} disabled={busy}>
                <Save className="w-4 h-4" /> Enregistrer
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}