import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle, Clock, ListChecks, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type ChecklistScope = {
  bookingId?: string | null;
  tripId?: string | null;
  customerId?: string | null;
  visaApplicationId?: string | null;
};

type Checklist = {
  id: string;
  title: string;
  checklist_type: string;
  progress_percent: number;
  booking_id?: string | null;
  trip_id?: string | null;
  customer_id?: string | null;
  client_id?: string | null;
  created_at?: string | null;
};

type ChecklistItem = {
  id: string;
  checklist_id: string;
  title: string;
  description?: string | null;
  category: string;
  priority: "low" | "medium" | "high" | "critical";
  status: "todo" | "in_progress" | "waiting" | "completed" | "cancelled";
  deadline?: string | null;
  recurring_interval_days?: number | null;
  completed_at?: string | null;
  sort_order?: number | null;
};

const statusLabels: Record<ChecklistItem["status"], string> = {
  todo: "À faire",
  in_progress: "En cours",
  waiting: "En attente",
  completed: "Terminé",
  cancelled: "Annulé",
};

const priorityLabels: Record<ChecklistItem["priority"], string> = {
  low: "Basse",
  medium: "Moyenne",
  high: "Haute",
  critical: "Critique",
};

const priorityClasses: Record<ChecklistItem["priority"], string> = {
  low: "bg-slate-100 text-slate-700",
  medium: "bg-sky-50 text-sky-700",
  high: "bg-orange-50 text-orange-700",
  critical: "bg-red-50 text-red-700",
};

const isOverdue = (item: ChecklistItem) =>
  item.status !== "completed" &&
  item.status !== "cancelled" &&
  item.deadline &&
  new Date(item.deadline).getTime() < Date.now();

export function OperationChecklistPanel({
  title = "Checklist opérationnelle",
  description = "Tâches générées automatiquement et tâches manuelles.",
  bookingId,
  tripId,
  customerId,
  visaApplicationId,
  compact = false,
}: ChecklistScope & { title?: string; description?: string; compact?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [newItem, setNewItem] = useState({
    title: "",
    description: "",
    category: "manual",
    priority: "medium" as ChecklistItem["priority"],
    deadline: "",
    recurring_interval_days: "",
  });

  const primaryChecklist = checklists[0] ?? null;
  const progress = useMemo(() => {
    const active = items.filter((item) => item.status !== "cancelled");
    if (!active.length) return primaryChecklist?.progress_percent ?? 0;
    const completed = active.filter((item) => item.status === "completed").length;
    return Math.round((completed / active.length) * 100);
  }, [items, primaryChecklist?.progress_percent]);
  const completedCount = items.filter((item) => item.status === "completed").length;
  const overdueCount = items.filter(isOverdue).length;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (bookingId) {
        const { error } = await (supabase as any).rpc("ensure_operation_checklist_for_booking", { p_booking_id: bookingId });
        if (error) console.warn("[operation-checklist] ensure failed", error);
      }

      let query = (supabase as any)
        .from("operation_checklists")
        .select("*")
        .order("created_at", { ascending: false });
      if (bookingId) query = query.eq("booking_id", bookingId);
      else if (tripId) query = query.eq("trip_id", tripId);
      else if (customerId) query = query.or(`customer_id.eq.${customerId},client_id.eq.${customerId}`);
      else if (visaApplicationId) query = query.eq("visa_application_id", visaApplicationId);
      else query = query.limit(25);

      const { data: checklistRows, error: checklistError } = await query;
      if (checklistError) throw checklistError;
      const loadedChecklists = (checklistRows ?? []) as Checklist[];
      setChecklists(loadedChecklists);

      const ids = loadedChecklists.map((row) => row.id);
      if (!ids.length) {
        setItems([]);
        return;
      }
      const { data: itemRows, error: itemError } = await (supabase as any)
        .from("operation_checklist_items")
        .select("*")
        .in("checklist_id", ids)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (itemError) throw itemError;
      setItems((itemRows ?? []) as ChecklistItem[]);
    } catch (error: any) {
      const missing = /operation_checklists|operation_checklist_items|schema cache|does not exist/i.test(error?.message ?? "");
      toast.error(missing ? "Migration Smart Operational Checklists requise." : error?.message ?? "Impossible de charger la checklist.");
      setChecklists([]);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [bookingId, customerId, tripId, visaApplicationId]);

  useEffect(() => {
    load();
  }, [load]);

  const ensureManualChecklist = async () => {
    if (primaryChecklist) return primaryChecklist.id;
    const payload: any = {
      title,
      checklist_type: bookingId ? "booking" : tripId ? "trip" : customerId ? "client" : visaApplicationId ? "visa" : "manual",
      booking_id: bookingId ?? null,
      reservation_id: bookingId ?? null,
      trip_id: tripId ?? null,
      customer_id: customerId ?? null,
      client_id: customerId ?? null,
      visa_application_id: visaApplicationId ?? null,
      generated_from: "manual",
    };
    const { data, error } = await (supabase as any).from("operation_checklists").insert(payload).select("id").single();
    if (error) throw error;
    return data.id as string;
  };

  const addManualItem = async () => {
    if (!newItem.title.trim()) return toast.error("Titre de tâche obligatoire.");
    setSaving(true);
    try {
      const checklistId = await ensureManualChecklist();
      const recurringDays = newItem.recurring_interval_days ? Number(newItem.recurring_interval_days) : null;
      const { error } = await (supabase as any).from("operation_checklist_items").insert({
        checklist_id: checklistId,
        title: newItem.title.trim(),
        description: newItem.description.trim() || null,
        category: newItem.category || "manual",
        priority: newItem.priority,
        deadline: newItem.deadline ? new Date(newItem.deadline).toISOString() : null,
        recurring_interval_days: recurringDays && recurringDays > 0 ? recurringDays : null,
        sort_order: 500,
        metadata: { source: "manual_admin" },
      });
      if (error) throw error;
      setNewItem({ title: "", description: "", category: "manual", priority: "medium", deadline: "", recurring_interval_days: "" });
      toast.success("Tâche ajoutée.");
      load();
    } catch (error: any) {
      toast.error(error?.message ?? "Impossible d’ajouter la tâche.");
    } finally {
      setSaving(false);
    }
  };

  const updateItemStatus = async (item: ChecklistItem, status: ChecklistItem["status"]) => {
    const patch: any = {
      status,
      completed_at: status === "completed" ? new Date().toISOString() : null,
    };
    const { error } = await (supabase as any).from("operation_checklist_items").update(patch).eq("id", item.id);
    if (error) return toast.error(error.message);
    setItems((current) => current.map((row) => row.id === item.id ? { ...row, ...patch } : row));
    load();
  };

  return (
    <Card className={cn("rounded-xl border-border shadow-sm", compact && "text-sm")}>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ListChecks className="h-5 w-5 text-orange-600" />
              {title}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Actualiser
          </Button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium">{progress}% complété</span>
              <span className="text-muted-foreground">{completedCount}/{items.filter((item) => item.status !== "cancelled").length || 0}</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
          {overdueCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
              <Clock className="h-3.5 w-3.5" />
              {overdueCount} en retard
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Chargement de la checklist…</p>
        ) : items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Aucune tâche opérationnelle pour ce périmètre.</p>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className={cn("rounded-lg border border-border p-3", item.status === "completed" ? "bg-emerald-50/50" : isOverdue(item) ? "bg-red-50/40" : "bg-background")}>
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={item.status === "completed"}
                    onCheckedChange={(checked) => updateItemStatus(item, checked ? "completed" : "todo")}
                    className="mt-1"
                    aria-label={item.status === "completed" ? "Marquer à faire" : "Marquer terminé"}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={cn("font-medium", item.status === "completed" && "line-through text-muted-foreground")}>{item.title}</p>
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", priorityClasses[item.priority])}>{priorityLabels[item.priority]}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{statusLabels[item.status]}</span>
                    </div>
                    {item.description && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{item.description}</p>}
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                      <span>Catégorie: {item.category}</span>
                      {item.deadline && <span>Échéance: {fmtDateTime(item.deadline)}</span>}
                      {item.recurring_interval_days && <span>Récurrence: tous les {item.recurring_interval_days} jours</span>}
                    </div>
                  </div>
                  {item.status === "completed" ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5 text-muted-foreground" />}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-xl border border-border bg-muted/20 p-3">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ajouter une tâche manuelle</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label className="text-xs">Titre</Label>
              <Input value={newItem.title} onChange={(event) => setNewItem((current) => ({ ...current, title: event.target.value }))} placeholder="Ex: Relancer assurance client" />
            </div>
            <div>
              <Label className="text-xs">Catégorie</Label>
              <Input value={newItem.category} onChange={(event) => setNewItem((current) => ({ ...current, category: event.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Priorité</Label>
              <Select value={newItem.priority} onValueChange={(value) => setNewItem((current) => ({ ...current, priority: value as ChecklistItem["priority"] }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Basse</SelectItem>
                  <SelectItem value="medium">Moyenne</SelectItem>
                  <SelectItem value="high">Haute</SelectItem>
                  <SelectItem value="critical">Critique</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Échéance</Label>
              <Input type="datetime-local" value={newItem.deadline} onChange={(event) => setNewItem((current) => ({ ...current, deadline: event.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Récurrence (jours)</Label>
              <Input type="number" min={1} value={newItem.recurring_interval_days} onChange={(event) => setNewItem((current) => ({ ...current, recurring_interval_days: event.target.value }))} placeholder="Optionnel" />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Description</Label>
              <Textarea rows={2} value={newItem.description} onChange={(event) => setNewItem((current) => ({ ...current, description: event.target.value }))} />
            </div>
          </div>
          <Button className="mt-3 min-h-10" onClick={addManualItem} disabled={saving || !newItem.title.trim()}>
            <Plus className="h-4 w-4" />
            Ajouter la tâche
          </Button>
        </div>

        {!bookingId && checklists.length > 0 && (
          <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
            {checklists.length} checklist(s) liée(s). Ouvrez une réservation pour voir le contexte complet.
            {primaryChecklist?.booking_id && (
              <Button asChild variant="link" className="ml-1 h-auto min-h-0 px-0 py-0 text-xs">
                <Link to={`/admin/bookings/${primaryChecklist.booking_id}`}>Ouvrir la réservation</Link>
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
