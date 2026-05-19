import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "../components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Link2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";

const empty = { name: "", category: "", city: "", contact_name: "", contact_email: "", contact_phone: "", notes: "" };

export default function Suppliers() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<any>(empty);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkSupplier, setLinkSupplier] = useState<any>(null);
  const [trips, setTrips] = useState<any[]>([]);
  const [assignedTrips, setAssignedTrips] = useState<string[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [memberUid, setMemberUid] = useState("");

  const load = async () => { const { data } = await supabase.from("suppliers").select("*").order("name"); setRows(data ?? []); };
  useEffect(() => { load(); }, []);
  const save = async () => {
    if (edit.id) await supabase.from("suppliers").update(edit).eq("id", edit.id);
    else await supabase.from("suppliers").insert(edit);
    toast.success("Enregistré"); setOpen(false); setEdit(empty); load();
  };
  const remove = async (id: string) => { if (!confirm("Supprimer ?")) return; await supabase.from("suppliers").delete().eq("id", id); load(); };

  const openLink = async (s: any) => {
    setLinkSupplier(s); setLinkOpen(true); setMemberUid("");
    const [{ data: t }, { data: ts }, { data: m }] = await Promise.all([
      supabase.from("trips").select("id,title").order("start_date", { ascending: false }),
      supabase.from("trip_suppliers").select("trip_id").eq("supplier_id", s.id),
      supabase.from("supplier_members").select("id,user_id,created_at").eq("supplier_id", s.id),
    ]);
    setTrips(t ?? []);
    setAssignedTrips((ts ?? []).map((r: any) => r.trip_id));
    setMembers(m ?? []);
  };

  const toggleTrip = async (tripId: string, on: boolean) => {
    if (!linkSupplier) return;
    if (on) {
      const { error } = await supabase.from("trip_suppliers").insert({ trip_id: tripId, supplier_id: linkSupplier.id });
      if (error) return toast.error(error.message);
      setAssignedTrips((p) => [...p, tripId]);
    } else {
      const { error } = await supabase.from("trip_suppliers").delete().eq("trip_id", tripId).eq("supplier_id", linkSupplier.id);
      if (error) return toast.error(error.message);
      setAssignedTrips((p) => p.filter((x) => x !== tripId));
    }
  };

  const addMember = async () => {
    if (!linkSupplier || !memberUid.trim()) return;
    const { error, data } = await supabase.from("supplier_members")
      .insert({ supplier_id: linkSupplier.id, user_id: memberUid.trim() }).select().single();
    if (error) return toast.error(error.message);
    setMembers((p) => [...p, data]);
    setMemberUid("");
    toast.success("Utilisateur lié");
  };

  const removeMember = async (id: string) => {
    const { error } = await supabase.from("supplier_members").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setMembers((p) => p.filter((m) => m.id !== id));
  };

  return (
    <div>
      <PageHeader title="Fournisseurs" description="Hôtels, guides, transporteurs au Japon."
        action={
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEdit(empty); }}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4" /> Nouveau fournisseur</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{edit.id ? "Modifier" : "Nouveau"} fournisseur</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><Label>Nom</Label><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
                <div><Label>Catégorie</Label><Input value={edit.category ?? ""} onChange={(e) => setEdit({ ...edit, category: e.target.value })} placeholder="Hôtel, guide, JR…" /></div>
                <div><Label>Ville</Label><Input value={edit.city ?? ""} onChange={(e) => setEdit({ ...edit, city: e.target.value })} /></div>
                <div><Label>Contact</Label><Input value={edit.contact_name ?? ""} onChange={(e) => setEdit({ ...edit, contact_name: e.target.value })} /></div>
                <div><Label>Email</Label><Input value={edit.contact_email ?? ""} onChange={(e) => setEdit({ ...edit, contact_email: e.target.value })} /></div>
                <div className="col-span-2"><Label>Téléphone</Label><Input value={edit.contact_phone ?? ""} onChange={(e) => setEdit({ ...edit, contact_phone: e.target.value })} /></div>
                <div className="col-span-2"><Label>Notes</Label><Textarea rows={3} value={edit.notes ?? ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></div>
              </div>
              <DialogFooter><Button onClick={save} disabled={!edit.name}>Enregistrer</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />
      <div className="bg-background rounded-2xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-left"><tr><th className="p-4">Nom</th><th className="p-4">Catégorie</th><th className="p-4">Ville</th><th className="p-4">Contact</th><th className="p-4"></th></tr></thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">Aucun fournisseur.</td></tr>}
            {rows.map((s) => (
              <tr key={s.id} className="hover:bg-secondary/30">
                <td className="p-4 font-medium">{s.name}</td>
                <td className="p-4">{s.category ?? "—"}</td>
                <td className="p-4">{s.city ?? "—"}</td>
                <td className="p-4 text-xs">{s.contact_name}<br/>{s.contact_email}</td>
                <td className="p-4 text-right">
                  <Button size="sm" variant="ghost" onClick={() => openLink(s)} title="Voyages & accès"><Link2 className="w-4 h-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEdit(s); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(s.id)}><Trash2 className="w-4 h-4" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{linkSupplier?.name} — Accès & voyages</DialogTitle></DialogHeader>
          <div className="space-y-6">
            <section>
              <h4 className="font-semibold mb-2 text-sm">Voyages assignés</h4>
              <div className="grid gap-2 max-h-60 overflow-y-auto pr-1">
                {trips.length === 0 && <p className="text-sm text-muted-foreground">Aucun voyage.</p>}
                {trips.map((t) => {
                  const on = assignedTrips.includes(t.id);
                  return (
                    <label key={t.id} className="flex items-center gap-2 text-sm border border-border rounded-md px-3 py-2 cursor-pointer hover:bg-secondary/40">
                      <input type="checkbox" checked={on} onChange={(e) => toggleTrip(t.id, e.target.checked)} />
                      <span>{t.title}</span>
                    </label>
                  );
                })}
              </div>
            </section>
            <section>
              <h4 className="font-semibold mb-2 text-sm">Comptes utilisateurs liés</h4>
              <p className="text-xs text-muted-foreground mb-2">
                Collez l'<strong>ID utilisateur</strong> (UUID) du compte fournisseur. Il pourra ensuite se connecter sur <code>/supplier</code>.
              </p>
              <div className="flex gap-2 mb-3">
                <Input value={memberUid} onChange={(e) => setMemberUid(e.target.value)} placeholder="UUID utilisateur" />
                <Button onClick={addMember} disabled={!memberUid.trim()}><UserPlus className="w-4 h-4" /> Lier</Button>
              </div>
              <div className="space-y-1">
                {members.length === 0 && <p className="text-sm text-muted-foreground">Aucun utilisateur lié.</p>}
                {members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between text-sm border border-border rounded-md px-3 py-2">
                    <code className="text-xs">{m.user_id}</code>
                    <Button size="sm" variant="ghost" onClick={() => removeMember(m.id)}><X className="w-4 h-4" /></Button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
