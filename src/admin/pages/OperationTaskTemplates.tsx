/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { Archive, Edit, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/admin/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

type TemplateDraft = {
  id?: string;
  template_key: string;
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | "critical";
  category: string;
  deadline_hours: string;
  display_order: string;
  is_active: boolean;
  allow_auto_trigger: boolean;
  auto_completion_condition: string;
};

const emptyDraft: TemplateDraft = {
  template_key: "",
  title: "",
  description: "",
  priority: "medium",
  category: "",
  deadline_hours: "24",
  display_order: "100",
  is_active: true,
  allow_auto_trigger: true,
  auto_completion_condition: "",
};

const priorityLabels: Record<string, string> = {
  low: "Faible",
  medium: "Moyenne",
  high: "Haute",
  critical: "Critique",
};

const priorityClasses: Record<string, string> = {
  low: "bg-slate-100 text-slate-700 border-slate-200",
  medium: "bg-sky-50 text-sky-800 border-sky-200",
  high: "bg-orange-50 text-orange-800 border-orange-200",
  critical: "bg-red-50 text-red-800 border-red-200",
};

const isMissingSchema = (error: any) =>
  /schema cache|Could not find the table|relation .* does not exist/i.test(error?.message ?? "");

const intervalToHours = (value: unknown) => {
  const text = String(value ?? "");
  const dayMatch = text.match(/(\d+)\s+day/);
  if (dayMatch) return String(Number(dayMatch[1]) * 24);
  const hourMatch = text.match(/(\d+):/);
  if (hourMatch) return String(Number(hourMatch[1]));
  const numberMatch = text.match(/\d+/);
  return numberMatch?.[0] ?? "24";
};

const draftFromTemplate = (template: any): TemplateDraft => ({
  id: template.id,
  template_key: template.template_key ?? "",
  title: template.title ?? "",
  description: template.description ?? "",
  priority: template.priority ?? "medium",
  category: template.category ?? "",
  deadline_hours: intervalToHours(template.deadline_interval),
  display_order: String(template.display_order ?? 100),
  is_active: template.is_active !== false,
  allow_auto_trigger: template.allow_auto_trigger !== false,
  auto_completion_condition: template.auto_completion_condition ?? "",
});

export default function OperationTaskTemplates() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<TemplateDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await (supabase as any)
      .from("operation_task_templates")
      .select("*")
      .order("display_order", { ascending: true })
      .order("template_key", { ascending: true });
    setLoading(false);
    if (error) {
      setError(isMissingSchema(error)
        ? "Migration Operation Task Templates requise pour administrer les tâches standards."
        : error.message ?? "Chargement impossible.");
      setTemplates([]);
      return;
    }
    setTemplates(data ?? []);
  };

  useEffect(() => {
    load();
  }, []);

  const activeCount = useMemo(() => templates.filter((template) => template.is_active && !template.archived_at).length, [templates]);

  const openCreate = () => {
    setDraft(emptyDraft);
    setDialogOpen(true);
  };

  const openEdit = (template: any) => {
    setDraft(draftFromTemplate(template));
    setDialogOpen(true);
  };

  const saveDraft = async () => {
    const key = draft.template_key.trim();
    const title = draft.title.trim();
    const category = draft.category.trim();
    if (!key || !title || !category) {
      toast.error("Clé technique, titre et catégorie sont obligatoires.");
      return;
    }
    setSaving(true);
    const payload = {
      template_key: key,
      title,
      description: draft.description.trim() || null,
      priority: draft.priority,
      category,
      deadline_interval: `${Math.max(Number(draft.deadline_hours) || 0, 0)} hours`,
      display_order: Number(draft.display_order) || 100,
      is_active: draft.is_active,
      allow_auto_trigger: draft.allow_auto_trigger,
      auto_completion_condition: draft.auto_completion_condition.trim() || null,
    };
    const result = draft.id
      ? await (supabase as any).from("operation_task_templates").update(payload).eq("id", draft.id)
      : await (supabase as any).from("operation_task_templates").insert(payload);
    setSaving(false);
    if (result.error) {
      toast.error(result.error.message ?? "Sauvegarde impossible.");
      return;
    }
    toast.success("Modèle de tâche enregistré.");
    setDialogOpen(false);
    load();
  };

  const toggleActive = async (template: any, active: boolean) => {
    const { error } = await (supabase as any)
      .from("operation_task_templates")
      .update({ is_active: active })
      .eq("id", template.id);
    if (error) return toast.error(error.message);
    toast.success(active ? "Modèle activé." : "Modèle désactivé.");
    load();
  };

  const archiveTemplate = async (template: any) => {
    if (!confirm(`Archiver la tâche standard "${template.title}" ? Elle ne sera plus créée automatiquement.`)) return;
    const { error } = await (supabase as any)
      .from("operation_task_templates")
      .update({ archived_at: new Date().toISOString(), is_active: false, allow_auto_trigger: false })
      .eq("id", template.id);
    if (error) return toast.error(error.message);
    toast.success("Modèle archivé.");
    load();
  };

  const deleteTemplate = async (template: any) => {
    const { count, error: countError } = await (supabase as any)
      .from("operation_tasks")
      .select("id", { count: "exact", head: true })
      .eq("category", template.category);
    if (countError) return toast.error(countError.message);
    if ((count ?? 0) > 0) {
      toast.info("Ce modèle a déjà généré des tâches. Il est archivé au lieu d’être supprimé.");
      await archiveTemplate(template);
      return;
    }
    if (!confirm(`Supprimer définitivement "${template.title}" ?`)) return;
    const { error } = await (supabase as any).from("operation_task_templates").delete().eq("id", template.id);
    if (error) return toast.error(error.message);
    toast.success("Modèle supprimé.");
    load();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tâches standards"
        description="Modèles utilisés par les automatisations opérationnelles. Les modifications s’appliquent aux futures tâches, sans écraser les tâches existantes."
        action={
          <>
            <Button type="button" variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className="h-4 w-4" /> Actualiser
            </Button>
            <Button type="button" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Créer une tâche standard
            </Button>
          </>
        }
      />

      <div className="grid gap-3 md:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Modèles</p><p className="text-2xl font-semibold">{templates.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Actifs</p><p className="text-2xl font-semibold text-emerald-700">{activeCount}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Automatiques</p><p className="text-2xl font-semibold">{templates.filter((template) => template.allow_auto_trigger).length}</p></CardContent></Card>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</div>}
      {loading ? <div className="rounded-lg border p-6 text-sm text-muted-foreground">Chargement des modèles...</div> : null}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Ordre</th>
                  <th className="px-4 py-3">Tâche standard</th>
                  <th className="px-4 py-3">Catégorie</th>
                  <th className="px-4 py-3">Priorité</th>
                  <th className="px-4 py-3">Échéance</th>
                  <th className="px-4 py-3">Automatisation</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => (
                  <tr key={template.id} className="border-t align-top hover:bg-slate-50">
                    <td className="px-4 py-3">{template.display_order}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{template.title}</p>
                      <p className="text-xs text-muted-foreground">{template.template_key}</p>
                      {template.description && <p className="mt-1 text-xs text-muted-foreground">{template.description}</p>}
                    </td>
                    <td className="px-4 py-3">{template.category}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${priorityClasses[template.priority] ?? priorityClasses.medium}`}>
                        {priorityLabels[template.priority] ?? template.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">{intervalToHours(template.deadline_interval)} h</td>
                    <td className="px-4 py-3">
                      {template.allow_auto_trigger ? "Déclenchement automatique" : "Manuel uniquement"}
                      {template.auto_completion_condition && <p className="text-xs text-muted-foreground">{template.auto_completion_condition}</p>}
                    </td>
                    <td className="px-4 py-3">
                      {template.archived_at ? "Archivé" : template.is_active ? "Actif" : "Inactif"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => openEdit(template)}>
                          <Edit className="h-4 w-4" /> Modifier
                        </Button>
                        {!template.archived_at && (
                          <Button type="button" size="sm" variant="outline" onClick={() => toggleActive(template, !template.is_active)}>
                            {template.is_active ? "Désactiver" : "Activer"}
                          </Button>
                        )}
                        {!template.archived_at && (
                          <Button type="button" size="sm" variant="outline" onClick={() => archiveTemplate(template)}>
                            <Archive className="h-4 w-4" /> Archiver
                          </Button>
                        )}
                        <Button type="button" size="sm" variant="outline" onClick={() => deleteTemplate(template)}>
                          <Trash2 className="h-4 w-4" /> Supprimer
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {templates.length === 0 && !loading && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Aucun modèle de tâche standard.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle>{draft.id ? "Modifier la tâche standard" : "Créer une tâche standard"}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 space-y-4 overflow-y-auto pr-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Clé technique</Label>
                <Input value={draft.template_key} onChange={(event) => setDraft((current) => ({ ...current, template_key: event.target.value }))} placeholder="reserve_flight" />
              </div>
              <div>
                <Label>Catégorie</Label>
                <Input value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} placeholder="flight_reservation" />
              </div>
              <div className="sm:col-span-2">
                <Label>Titre</Label>
                <Input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
              </div>
              <div className="sm:col-span-2">
                <Label>Description</Label>
                <Textarea rows={3} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
              </div>
              <div>
                <Label>Priorité</Label>
                <Select value={draft.priority} onValueChange={(value) => setDraft((current) => ({ ...current, priority: value as TemplateDraft["priority"] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Faible</SelectItem>
                    <SelectItem value="medium">Moyenne</SelectItem>
                    <SelectItem value="high">Haute</SelectItem>
                    <SelectItem value="critical">Critique</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Délai d’échéance (heures)</Label>
                <Input type="number" min="0" value={draft.deadline_hours} onChange={(event) => setDraft((current) => ({ ...current, deadline_hours: event.target.value }))} />
              </div>
              <div>
                <Label>Ordre d’affichage</Label>
                <Input type="number" value={draft.display_order} onChange={(event) => setDraft((current) => ({ ...current, display_order: event.target.value }))} />
              </div>
              <div>
                <Label>Condition de terminaison automatique</Label>
                <Input value={draft.auto_completion_condition} onChange={(event) => setDraft((current) => ({ ...current, auto_completion_condition: event.target.value }))} />
              </div>
            </div>
            <div className="rounded-lg border bg-slate-50 p-3 text-sm">
              <label className="mb-2 flex items-center gap-2">
                <Checkbox checked={draft.is_active} onCheckedChange={(checked) => setDraft((current) => ({ ...current, is_active: checked === true }))} />
                Modèle actif
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={draft.allow_auto_trigger} onCheckedChange={(checked) => setDraft((current) => ({ ...current, allow_auto_trigger: checked === true }))} />
                Autoriser la création automatique
              </label>
              <p className="mt-2 text-xs text-muted-foreground">
                Les changements ne modifient pas les tâches déjà créées. Les tâches personnalisées ajoutées manuellement restent indépendantes.
              </p>
            </div>
          </div>
          <DialogFooter className="shrink-0 border-t bg-white pt-4">
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button type="button" onClick={saveDraft} disabled={saving}>
              <Save className="h-4 w-4" /> Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
