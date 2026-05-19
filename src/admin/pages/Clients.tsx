import { lazy, Suspense, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "../components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { ChevronDown, Plus, Search, User, Upload, Trash2 } from "lucide-react";
import { fmtDate } from "@/lib/format";
import { fmtMAD } from "@/lib/format";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { LoyaltyBadge, tierLabel } from "../components/LoyaltyBadge";
import { QuickActions } from "../components/QuickActions";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const empty = { full_name: "", email: "", phone: "", city: "", country: "Maroc", source: "", passport_number: "" };
const ClientsImportDialog = lazy(() =>
  import("../components/ClientsImportDialog").then((module) => ({ default: module.ClientsImportDialog }))
);

export default function Clients() {
  const { user, isAdmin } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [edit, setEdit] = useState<any>(empty);
  const [selected, setSelected] = useState<any>(null);
  const [notes, setNotes] = useState<any[]>([]);
  const [newNote, setNewNote] = useState("");
  const [rewards, setRewards] = useState<any[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);

  const load = async () => {
    const { data } = await supabase
      .from("clients")
      .select("id, full_name, email, phone, city, country, source, passport_number, last_trip_label, loyalty_tier, is_returning, trips_completed, rewards_used, created_at")
      .order("created_at", { ascending: false })
      .limit(150);
    setRows((data ?? []).filter((c: any) =>
      !q || c.full_name?.toLowerCase().includes(q.toLowerCase()) || c.email?.toLowerCase().includes(q.toLowerCase())
    ));
  };
  useEffect(() => { load(); }, [q]);

  const openClient = async (c: any) => {
    setSelected(c);
    const [{ data: n }, { data: r }, { data: h }] = await Promise.all([
      supabase.from("client_notes").select("*").eq("client_id", c.id).order("created_at", { ascending: false }),
      supabase.from("client_rewards" as any).select("*").eq("client_id", c.id).order("created_at", { ascending: false }),
      supabase
        .from("bookings")
        .select("id, reference, status, total_amount_mad, paid_amount_mad, created_at, trip_id, trips:trip_id(title, season, start_date), booking_extras(name_snapshot, qty)")
        .eq("client_id", c.id)
        .order("created_at", { ascending: false }),
    ]);
    setNotes(n ?? []);
    setRewards((r as any) ?? []);
    setHistory((h as any) ?? []);
  };

  const save = async () => {
    if (edit.id) await supabase.from("clients").update(edit).eq("id", edit.id);
    else await supabase.from("clients").insert(edit);
    toast.success("Enregistré");
    setOpen(false); setEdit(empty); load();
  };

  const addNote = async () => {
    if (!newNote.trim() || !selected) return;
    const { error } = await supabase.from("client_notes").insert({ client_id: selected.id, body: newNote, author_id: user?.id });
    if (error) return toast.error(error.message);
    setNewNote("");
    openClient(selected);
  };

  const grantReward = async (type: "discount" | "free_activity" | "vip_upgrade") => {
    if (!selected) return;
    const map = {
      discount: { label: "10% sur le prochain voyage", percent: 10 },
      free_activity: { label: "Activité offerte", percent: null },
      vip_upgrade: { label: "Surclassement VIP offert", percent: null },
    } as const;
    const { error } = await supabase.from("client_rewards" as any).insert({
      client_id: selected.id, type, label: map[type].label, percent: map[type].percent, granted_reason: "Octroyé manuellement",
    });
    if (error) return toast.error(error.message);
    toast.success("Récompense créée");
    openClient(selected);
  };

  const useReward = async (id: string) => {
    const { error } = await supabase.from("client_rewards" as any)
      .update({ status: "used", used_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(error.message);
    if (selected) {
      await supabase.from("clients").update({ rewards_used: (selected.rewards_used ?? 0) + 1 }).eq("id", selected.id);
    }
    openClient(selected);
  };

  const deleteClient = async () => {
    if (!confirmDelete) return;
    const { error } = await supabase.from("clients").delete().eq("id", confirmDelete.id);
    if (error) return toast.error(error.message);
    toast.success("Client supprimé");
    if (selected?.id === confirmDelete.id) setSelected(null);
    setConfirmDelete(null);
    load();
  };

  return (
    <div>
      <PageHeader title="Clients (CRM)" description="Fiches, historique, notes."
        action={
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center sm:flex-wrap">
          <Button variant="outline" className="min-h-11" onClick={() => setImportOpen(true)}>
            <Upload className="w-4 h-4" /> Importer
          </Button>
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEdit(empty); }}>
            <DialogTrigger asChild><Button className="min-h-11"><Plus className="w-4 h-4" /> Nouveau client</Button></DialogTrigger>
            <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
              <DialogHeader><DialogTitle>{edit.id ? "Modifier" : "Nouveau"} client</DialogTitle></DialogHeader>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2"><Label>Nom complet</Label><Input value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></div>
                <div><Label>Email</Label><Input type="email" autoComplete="email" inputMode="email" value={edit.email ?? ""} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></div>
                <div><Label>Téléphone</Label><Input type="tel" autoComplete="tel" inputMode="tel" value={edit.phone ?? ""} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></div>
                <div><Label>Ville</Label><Input value={edit.city ?? ""} onChange={(e) => setEdit({ ...edit, city: e.target.value })} /></div>
                <div><Label>Pays</Label><Input value={edit.country ?? ""} onChange={(e) => setEdit({ ...edit, country: e.target.value })} /></div>
                <div><Label>N° Passeport</Label><Input autoCapitalize="characters" value={edit.passport_number ?? ""} onChange={(e) => setEdit({ ...edit, passport_number: e.target.value })} /></div>
                <div><Label>Source</Label><Input value={edit.source ?? ""} onChange={(e) => setEdit({ ...edit, source: e.target.value })} placeholder="Instagram, recommandation…" /></div>
              </div>
              <DialogFooter><Button className="w-full sm:w-auto min-h-11" onClick={save} disabled={!edit.full_name}>Enregistrer</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        }
      />

      {importOpen && (
        <Suspense fallback={null}>
          <ClientsImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={load} />
        </Suspense>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9 min-h-11" type="search" enterKeyHint="search" placeholder="Rechercher un client…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="md:hidden space-y-3">
            {rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground bg-background rounded-2xl border border-border">Aucun client.</p>}
            {rows.map((c) => (
              <details key={c.id} className="group bg-background rounded-2xl border border-border overflow-hidden" onClick={() => openClient(c)}>
                <summary className="list-none p-4 cursor-pointer">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold">{c.full_name}</p>
                        <LoyaltyBadge tier={c.loyalty_tier} isReturning={c.is_returning} trips={c.trips_completed} />
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{c.email || "—"}</p>
                      <p className="text-xs text-muted-foreground truncate">{c.phone || c.city || "—"}</p>
                    </div>
                    <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  </div>
                  <QuickActions phone={c.phone} email={c.email} passport={c.passport_number} compact className="mt-3" />
                </summary>
                <div className="grid grid-cols-2 gap-3 border-t border-border p-4 text-sm">
                  <div><p className="text-xs text-muted-foreground">Voyage</p><p className="font-medium">{c.last_trip_label ?? "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Ville</p><p className="font-medium">{c.city ?? "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Passeport</p><p className="font-medium">{c.passport_number ?? "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Inscrit</p><p className="font-medium">{fmtDate(c.created_at)}</p></div>
                  <Button variant="secondary" className="col-span-2 min-h-11" onClick={(e) => { e.stopPropagation(); openClient(c); }}>
                    Voir la fiche
                  </Button>
                </div>
              </details>
            ))}
          </div>

          <div className="hidden md:block bg-background rounded-2xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-left">
                <tr>
                  <th className="p-4">Client</th>
                  <th className="p-4">Contact</th>
                  <th className="p-4">Voyage inscrit</th>
                  <th className="p-4">Ville</th>
                  <th className="p-4">Inscrit</th>
                  <th className="p-4 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Aucun client.</td></tr>}
                {rows.map((c) => (
                  <tr key={c.id} onClick={() => openClient(c)} className="cursor-pointer hover:bg-secondary/30">
                    <td className="p-4 font-medium">
                      <div className="flex items-center gap-2 flex-wrap">
                        {c.full_name}
                        <LoyaltyBadge tier={c.loyalty_tier} isReturning={c.is_returning} trips={c.trips_completed} />
                      </div>
                    </td>
                    <td className="p-4 text-xs">{c.email}<br/>{c.phone}</td>
                    <td className="p-4 text-xs">{c.last_trip_label ?? "—"}</td>
                    <td className="p-4">{c.city ?? "—"}</td>
                    <td className="p-4 text-xs text-muted-foreground">{fmtDate(c.created_at)}</td>
                    <td className="p-4">
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={(e) => { e.stopPropagation(); setConfirmDelete(c); }}
                          aria-label="Supprimer le client"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="bg-background rounded-2xl border border-border p-4 sm:p-6 h-fit lg:sticky lg:top-6">
          {!selected ? (
            <div className="text-center py-8">
              <User className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">Sélectionnez un client pour voir ses notes.</p>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2 mb-1">
                <h3 className="font-display text-lg">{selected.full_name}</h3>
                <LoyaltyBadge tier={selected.loyalty_tier} isReturning={selected.is_returning} trips={selected.trips_completed} />
              </div>
              <p className="text-xs text-muted-foreground mb-3">{selected.email}</p>
              <QuickActions phone={selected.phone} email={selected.email} passport={selected.passport_number} className="mb-4" />
              <div className="grid grid-cols-3 gap-2 mb-4 text-center">
                <div className="bg-secondary rounded-lg p-2">
                  <p className="text-[10px] uppercase text-muted-foreground">Voyages</p>
                  <p className="font-display text-lg">{selected.trips_completed ?? 0}</p>
                </div>
                <div className="bg-secondary rounded-lg p-2">
                  <p className="text-[10px] uppercase text-muted-foreground">Palier</p>
                  <p className="font-display text-sm pt-1">{tierLabel(selected.loyalty_tier)}</p>
                </div>
                <div className="bg-secondary rounded-lg p-2">
                  <p className="text-[10px] uppercase text-muted-foreground">Récomp. utilisées</p>
                  <p className="font-display text-lg">{selected.rewards_used ?? 0}</p>
                </div>
              </div>
              <Button size="sm" variant="outline" className="w-full min-h-11 mb-4" onClick={() => { setEdit(selected); setOpen(true); }}>Modifier la fiche</Button>

              <div className="mb-4">
                <Label className="text-xs mb-2 block">Historique des voyages</Label>
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {history.length === 0 && <p className="text-xs text-muted-foreground">Aucune réservation.</p>}
                  {history.map((h: any) => {
                    const tripTitle = h.trips?.season || h.trips?.title || "Voyage";
                    const start = h.trips?.start_date ? fmtDate(h.trips.start_date) : null;
                    const extras = (h.booking_extras ?? []).map((e: any) => `${e.name_snapshot}${e.qty > 1 ? ` ×${e.qty}` : ""}`).join(", ");
                    return (
                      <Link key={h.id} to={`/admin/bookings/${h.id}`} className="block text-xs bg-secondary rounded-lg p-3 hover:bg-secondary/70">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium">{tripTitle}{start ? ` — ${start}` : ""}</p>
                          <span className="text-[10px] uppercase text-muted-foreground">{h.status}</span>
                        </div>
                        <p className="text-muted-foreground mt-1">
                          {fmtMAD(h.paid_amount_mad)} payés / {fmtMAD(h.total_amount_mad)}
                        </p>
                        {extras && <p className="text-muted-foreground mt-1 truncate">Extras : {extras}</p>}
                        <p className="text-muted-foreground mt-1">Inscription : {fmtDate(h.created_at)}</p>
                      </Link>
                    );
                  })}
                </div>
              </div>

              <div className="mb-4">
                <Label className="text-xs mb-2 block">Récompenses</Label>
                <div className="space-y-2 mb-2">
                  {rewards.length === 0 && <p className="text-xs text-muted-foreground">Aucune récompense.</p>}
                  {rewards.map((r) => (
                    <div key={r.id} className="text-xs bg-secondary rounded-lg p-2 flex items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{r.label}</p>
                        <p className="text-muted-foreground capitalize">{r.status}</p>
                      </div>
                      {r.status === "available" && (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => useReward(r.id)}>Utiliser</Button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <Button size="sm" variant="outline" className="text-[10px] h-7" onClick={() => grantReward("discount")}>-10%</Button>
                  <Button size="sm" variant="outline" className="text-[10px] h-7" onClick={() => grantReward("free_activity")}>Activité</Button>
                  <Button size="sm" variant="outline" className="text-[10px] h-7" onClick={() => grantReward("vip_upgrade")}>VIP</Button>
                </div>
              </div>

              <div className="space-y-3 mb-4">
                <Label className="text-xs">Nouvelle note</Label>
                <Textarea rows={3} value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Appel, RDV, demande spécifique…" />
                <Button size="sm" onClick={addNote} className="w-full">Ajouter</Button>
              </div>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {notes.length === 0 && <p className="text-xs text-muted-foreground">Aucune note.</p>}
                {notes.map((n) => (
                  <div key={n.id} className="text-xs bg-secondary rounded-lg p-3">
                    <p className="text-foreground/80">{n.body}</p>
                    <p className="text-muted-foreground mt-1">{fmtDate(n.created_at)}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </aside>
      </div>

      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce client ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est définitive. La fiche de <strong>{confirmDelete?.full_name}</strong> ainsi
              que ses notes et récompenses seront supprimées. Les réservations liées seront conservées
              mais détachées du client.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={deleteClient} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
