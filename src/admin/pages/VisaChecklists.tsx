import { useEffect, useState } from "react";
import type { ComponentProps } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/admin/components/PageHeader";
import { Plus, Trash2, Save, GripVertical, X } from "lucide-react";
import { toast } from "sonner";
import {
  PROFESSIONAL_SITUATIONS,
  normalizeVisaChecklistItems,
  type VisaChecklistItem,
} from "@/lib/visa-document-checklists";

type Checklist = {
  id: string;
  category: string;
  label: string;
  description: string | null;
  items: VisaChecklistItem[];
  is_active: boolean;
  sort_order: number;
};

function StableInput({
  value,
  onCommit,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: string | null | undefined;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  return (
    <Input
      {...props}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft)}
    />
  );
}

function StableTextarea({
  value,
  onCommit,
  ...props
}: Omit<ComponentProps<typeof Textarea>, "value" | "onChange"> & {
  value: string | null | undefined;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  return (
    <Textarea
      {...props}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft)}
    />
  );
}

export default function VisaChecklists() {
  const [list, setList] = useState<Checklist[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("visa_document_checklists")
      .select("*")
      .order("sort_order");
    if (error) return toast.error(error.message);
    setList((data ?? []).map((d: any) => ({ ...d, items: normalizeVisaChecklistItems(d.items) })));
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
    const slug = prompt("Identifiant de situation (ex: salarie_prive, etudiant, autre)")?.trim().toLowerCase().replace(/\s+/g, "_");
    if (!slug) return;
    const { data, error } = await supabase.from("visa_document_checklists").insert({
      category: slug, label: PROFESSIONAL_SITUATIONS.find((item) => item.value === slug)?.label ?? slug, items: [] as any, sort_order: list.length + 1,
    }).select("*").single();
    if (error) return toast.error(error.message);
    setList((arr) => [...arr, { ...(data as any), items: [] }]);
  };

  const addItem = (id: string) => {
    const c = list.find((x) => x.id === id);
    if (!c) return;
    update(id, {
      items: [...c.items, {
        id: crypto.randomUUID(),
        title_fr: "",
        title_en: "",
        title_ar: "",
        notes: "",
        required: true,
        original_required: true,
        copy_upload_required: true,
        active: true,
        display_order: c.items.length + 1,
      }],
    });
  };
  const updItem = (id: string, idx: number, patch: Partial<VisaChecklistItem>) => {
    const c = list.find((x) => x.id === id)!;
    const next = [...c.items]; next[idx] = { ...next[idx], ...patch };
    update(id, { items: next });
  };
  const delItem = (id: string, idx: number) => {
    const c = list.find((x) => x.id === id)!;
    update(id, { items: c.items.filter((_, i) => i !== idx) });
  };

  return (
    <div>
      <PageHeader
        title="Documents requis par situation"
        description="Listes éditables affichées aux clients selon leur situation professionnelle."
        action={<Button onClick={create}><Plus className="w-4 h-4" /> Nouvelle situation</Button>}
      />

      <div className="space-y-4">
        {list.length === 0 && (
          <Card className="p-10 text-center text-muted-foreground">Aucune catégorie. Créez-en une pour commencer.</Card>
        )}
        {list.map((c) => (
          <Card key={c.id} className="p-5">
            <div className="grid md:grid-cols-12 gap-3 mb-3">
              <div className="md:col-span-3">
                <label className="text-xs text-muted-foreground">Situation</label>
                <Select
                  value={c.category}
                  onValueChange={(value) => {
                    const label = PROFESSIONAL_SITUATIONS.find((item) => item.value === value)?.label ?? c.label;
                    update(c.id, { category: value, label });
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROFESSIONAL_SITUATIONS.map((situation) => (
                      <SelectItem key={situation.value} value={situation.value}>{situation.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <StableInput className="mt-2" value={c.category} onCommit={(value) => update(c.id, { category: value })} />
              </div>
              <div className="md:col-span-5">
                <label className="text-xs text-muted-foreground">Libellé affiché</label>
                <StableInput value={c.label} onCommit={(value) => update(c.id, { label: value })} />
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

            <StableTextarea
              placeholder="Description (optionnel)"
              rows={2}
              value={c.description ?? ""}
              onCommit={(value) => update(c.id, { description: value })}
            />

            <div className="mt-4">
              <p className="text-sm font-semibold mb-2">Documents requis ({c.items.length})</p>
              <div className="space-y-2">
                {c.items.map((it, i) => (
                  <div key={it.id ?? i} className="rounded-xl border border-border p-3">
                    <div className="flex items-start gap-2">
                      <GripVertical className="mt-3 w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="grid flex-1 gap-3 md:grid-cols-2">
                        <div className="md:col-span-2">
                          <label className="text-xs text-muted-foreground">Titre FR</label>
                          <StableInput value={it.title_fr} onCommit={(value) => updItem(c.id, i, { title_fr: value })} placeholder={`Document #${i + 1}`} />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Titre EN</label>
                          <StableInput value={it.title_en ?? ""} onCommit={(value) => updItem(c.id, i, { title_en: value })} />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Titre AR</label>
                          <StableInput value={it.title_ar ?? ""} onCommit={(value) => updItem(c.id, i, { title_ar: value })} />
                        </div>
                        <div className="md:col-span-2">
                          <label className="text-xs text-muted-foreground">Description / notes</label>
                          <StableTextarea rows={2} value={it.notes ?? ""} onCommit={(value) => updItem(c.id, i, { notes: value })} />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Ordre</label>
                          <Input type="number" value={it.display_order} onChange={(e) => updItem(c.id, i, { display_order: Number(e.target.value) })} />
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                          <label className="flex items-center gap-2"><Checkbox checked={it.required} onCheckedChange={(v) => updItem(c.id, i, { required: v === true })} /> Requis</label>
                          <label className="flex items-center gap-2"><Checkbox checked={it.original_required} onCheckedChange={(v) => updItem(c.id, i, { original_required: v === true })} /> Original</label>
                          <label className="flex items-center gap-2"><Checkbox checked={it.copy_upload_required} onCheckedChange={(v) => updItem(c.id, i, { copy_upload_required: v === true })} /> Copie</label>
                          <label className="flex items-center gap-2"><Checkbox checked={it.active} onCheckedChange={(v) => updItem(c.id, i, { active: v === true })} /> Actif</label>
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => delItem(c.id, i)}><X className="w-4 h-4" /></Button>
                    </div>
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
