import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, UserPlus, Trash2, Pencil, Save, X, ExternalLink, AlertTriangle } from "lucide-react";
import { AddTravelerDialog } from "./AddTravelerDialog";
import { LinkExistingClientDialog } from "./LinkExistingClientDialog";

const RELATIONS: Record<string, string> = {
  self: "Lui-même", spouse: "Conjoint(e)", child: "Enfant",
  friend: "Ami(e)", family: "Famille", other: "Autre",
};

type Props = {
  bookingId: string;
  tripId?: string | null;
  expectedTravelers: number;
};

export function BookingParticipantsSection({ bookingId, tripId, expectedTravelers }: Props) {
  const [list, setList] = useState<any[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<any>({});
  const [openAdd, setOpenAdd] = useState(false);
  const [openLink, setOpenLink] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("booking_participants")
      .select("*")
      .eq("booking_id", bookingId)
      .order("is_lead", { ascending: false })
      .order("created_at", { ascending: true });
    setList(data ?? []);
  };
  useEffect(() => { load(); }, [bookingId]);

  const startEdit = (p: any) => { setEditing(p.id); setDraft({ ...p }); };
  const cancelEdit = () => { setEditing(null); setDraft({}); };
  const saveEdit = async () => {
    const { id, created_at, updated_at, booking_id, ...patch } = draft;
    const clean: any = {};
    Object.keys(patch).forEach((k) => { clean[k] = patch[k] === "" ? null : patch[k]; });
    const { error } = await supabase.from("booking_participants").update(clean).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Voyageur mis à jour");
    setEditing(null); load();
  };

  const remove = async (p: any) => {
    if (p.is_lead && !confirm("Ce voyageur est le responsable de réservation. Supprimer quand même ?")) return;
    if (!p.is_lead && !confirm("Supprimer ce voyageur de la réservation ?")) return;
    const { error } = await supabase.from("booking_participants").delete().eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("Voyageur retiré");
    load();
  };

  const filled = list.length;
  const remaining = Math.max(0, expectedTravelers - filled);
  const overflow = filled > expectedTravelers;

  return (
    <section className="bg-background rounded-2xl border border-border p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="font-display text-lg">Voyageurs associés</h2>
          <div className="flex flex-wrap items-center gap-2 mt-1 text-xs">
            <Badge variant="outline">Prévus : {expectedTravelers}</Badge>
            <Badge variant="outline">Renseignés : {filled}</Badge>
            <Badge variant={remaining === 0 ? "default" : "secondary"}>Restant : {remaining}</Badge>
            {overflow && (
              <Badge variant="destructive" className="gap-1"><AlertTriangle className="w-3 h-3" /> Dépassement</Badge>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpenLink(true)}><UserPlus className="w-4 h-4" /> Associer un client</Button>
          <Button size="sm" onClick={() => setOpenAdd(true)}><Plus className="w-4 h-4" /> Nouveau voyageur</Button>
        </div>
      </div>

      {list.length === 0 && <p className="text-sm text-muted-foreground">Aucun voyageur renseigné.</p>}

      <div className="space-y-2">
        {list.map((p) => {
          const isEdit = editing === p.id;
          if (isEdit) {
            return (
              <div key={p.id} className="border border-border rounded-lg p-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                <Input placeholder="Prénom" value={draft.first_name ?? ""} onChange={(e) => setDraft({ ...draft, first_name: e.target.value })} />
                <Input placeholder="Nom" value={draft.last_name ?? ""} onChange={(e) => setDraft({ ...draft, last_name: e.target.value })} />
                <Select value={draft.sex ?? "none"} onValueChange={(v) => setDraft({ ...draft, sex: v === "none" ? null : v })}>
                  <SelectTrigger><SelectValue placeholder="Sexe" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    <SelectItem value="M">M</SelectItem>
                    <SelectItem value="F">F</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="date" value={draft.date_of_birth ?? ""} onChange={(e) => setDraft({ ...draft, date_of_birth: e.target.value })} />
                <Input placeholder="Nationalité" value={draft.nationality ?? ""} onChange={(e) => setDraft({ ...draft, nationality: e.target.value })} />
                <Input placeholder="N° passeport" value={draft.passport_no ?? ""} onChange={(e) => setDraft({ ...draft, passport_no: e.target.value })} />
                <Input type="date" placeholder="Émission" value={draft.passport_issue_date ?? ""} onChange={(e) => setDraft({ ...draft, passport_issue_date: e.target.value })} />
                <Input type="date" placeholder="Expiration" value={draft.passport_expiry ?? ""} onChange={(e) => setDraft({ ...draft, passport_expiry: e.target.value })} />
                <Input placeholder="Email" value={draft.email ?? ""} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
                <Input placeholder="Téléphone" value={draft.phone ?? ""} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
                <Select value={draft.relation ?? "other"} onValueChange={(v) => setDraft({ ...draft, relation: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(RELATIONS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                </Select>
                <div className="flex gap-1 col-span-2 md:col-span-4 justify-end">
                  <Button size="sm" variant="outline" onClick={cancelEdit}><X className="w-4 h-4" /></Button>
                  <Button size="sm" onClick={saveEdit}><Save className="w-4 h-4" /> Enregistrer</Button>
                </div>
              </div>
            );
          }
          return (
            <div key={p.id} className="border border-border rounded-lg p-3 flex flex-wrap items-start justify-between gap-3 text-sm">
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium">{p.first_name} {p.last_name}</p>
                  {p.is_lead && <Badge variant="default" className="text-[10px]">Responsable</Badge>}
                  {p.relation && <Badge variant="outline" className="text-[10px]">{RELATIONS[p.relation] ?? p.relation}</Badge>}
                  {p.client_id && (
                    <Link to={`/admin/clients/${p.client_id}`} className="text-xs text-primary inline-flex items-center gap-1 hover:underline">
                      CRM <ExternalLink className="w-3 h-3" />
                    </Link>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {p.sex || "—"} · {p.date_of_birth ?? "—"} · {p.nationality || "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  PP : {p.passport_no || "—"} {p.passport_expiry ? `(exp. ${p.passport_expiry})` : ""}
                </p>
                {(p.email || p.phone) && (
                  <p className="text-xs text-muted-foreground">{p.email || "—"} · {p.phone || "—"}</p>
                )}
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => startEdit(p)}><Pencil className="w-4 h-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => remove(p)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
              </div>
            </div>
          );
        })}
      </div>

      <AddTravelerDialog open={openAdd} onOpenChange={setOpenAdd} bookingId={bookingId} tripId={tripId} onSaved={load} />
      <LinkExistingClientDialog open={openLink} onOpenChange={setOpenLink} bookingId={bookingId} tripId={tripId} onSaved={load} />
    </section>
  );
}