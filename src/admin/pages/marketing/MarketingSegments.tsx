import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/admin/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Filter, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function MarketingSegments() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", filters: "{}" });

  const load = async () => {
    const { data } = await supabase.from("marketing_segments").select("*").order("is_system", { ascending: false }).order("name");
    setRows(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    let parsed: any;
    try { parsed = JSON.parse(form.filters || "{}"); } catch { return toast.error("Filtres JSON invalides"); }
    const { error } = await supabase.from("marketing_segments").insert({ name: form.name, description: form.description, filters: parsed, is_system: false });
    if (error) toast.error(error.message);
    else { toast.success("Segment créé"); setOpen(false); setForm({ name: "", description: "", filters: "{}" }); load(); }
  };

  const remove = async (id: string) => {
    if (!confirm("Supprimer ce segment ?")) return;
    await supabase.from("marketing_segments").delete().eq("id", id);
    load();
  };

  return (
    <div>
      <PageHeader title="Segments" description="Groupes de contacts ciblables." action={
        <Button onClick={() => setOpen(true)}><Plus className="w-4 h-4" /> Nouveau segment</Button>
      } />

      <div className="grid md:grid-cols-2 gap-3">
        {rows.map((s) => (
          <div key={s.id} className="bg-background border border-border rounded-2xl p-4 flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center"><Filter className="w-4 h-4" /></div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-medium">{s.name}</h3>
                {s.is_system && <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">Système</span>}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{s.description || "—"}</p>
              <pre className="mt-2 text-[10px] text-muted-foreground bg-secondary/40 rounded p-2 overflow-x-auto">{JSON.stringify(s.filters)}</pre>
            </div>
            {!s.is_system && <Button size="icon" variant="ghost" onClick={() => remove(s.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>}
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nouveau segment personnalisé</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><label className="text-xs">Nom</label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><label className="text-xs">Description</label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div>
              <label className="text-xs">Filtres (JSON)</label>
              <Textarea rows={6} value={form.filters} onChange={(e) => setForm({ ...form, filters: e.target.value })} placeholder='{"language":"fr","min_trips":1}' />
              <p className="text-[11px] text-muted-foreground mt-1">Clés : language, cities[], min_trips, max_trips, loyalty_tiers[], sources[], tag, returning_only, has_unpaid_balance, season, has_visa_request</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            <Button onClick={create}>Créer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}