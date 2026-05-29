import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, UserPlus, Trash2, Pencil, Save, X, ExternalLink, AlertTriangle, ChevronDown } from "lucide-react";
import { AddTravelerDialog } from "./AddTravelerDialog";
import { LinkExistingClientDialog } from "./LinkExistingClientDialog";
import { QuickActions } from "./QuickActions";

const RELATIONS: Record<string, string> = {
  self: "Lui-même", spouse: "Conjoint(e)", child: "Enfant",
  friend: "Ami(e)", family: "Famille", other: "Autre",
};

const MARITAL_STATUS_OPTIONS = [
  { value: "celibataire", label: "Célibataire" },
  { value: "marie", label: "Marié(e)" },
  { value: "divorce", label: "Divorcé(e)" },
  { value: "veuf", label: "Veuf/veuve" },
];

const maritalStatusLabel = (value?: string | null) =>
  MARITAL_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value ?? "—";

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
    <section className="rounded-2xl border border-border bg-background p-4 shadow-sm sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg">Voyageurs associés</h2>
          <div className="mt-2 grid grid-cols-3 gap-2 text-xs sm:flex sm:flex-wrap">
            <Badge variant="outline">Prévus : {expectedTravelers}</Badge>
            <Badge variant="outline">Renseignés : {filled}</Badge>
            <Badge variant={remaining === 0 ? "default" : "secondary"}>Restant : {remaining}</Badge>
            {overflow && (
              <Badge variant="destructive" className="gap-1"><AlertTriangle className="w-3 h-3" /> Dépassement</Badge>
            )}
          </div>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:flex">
          <Button size="sm" variant="outline" className="min-h-11" onClick={() => setOpenLink(true)}><UserPlus className="w-4 h-4" /> Associer</Button>
          <Button size="sm" className="min-h-11" onClick={() => setOpenAdd(true)}><Plus className="w-4 h-4" /> Nouveau</Button>
        </div>
      </div>

      {list.length === 0 && <p className="text-sm text-muted-foreground">Aucun voyageur renseigné.</p>}

      <div className="space-y-2">
        {list.map((p) => {
          const isEdit = editing === p.id;
          if (isEdit) {
            return (
              <div key={p.id} className="grid grid-cols-1 gap-2 rounded-xl border border-border p-3 text-sm sm:grid-cols-2 md:grid-cols-4">
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
                <Input placeholder="Profession" value={draft.profession ?? ""} onChange={(e) => setDraft({ ...draft, profession: e.target.value })} />
                <Select value={draft.marital_status ?? "none"} onValueChange={(v) => setDraft({ ...draft, marital_status: v === "none" ? null : v })}>
                  <SelectTrigger><SelectValue placeholder="État civil" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {MARITAL_STATUS_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
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
                <Textarea className="sm:col-span-2 md:col-span-4" placeholder="Adresse complète" value={draft.address ?? ""} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
                <div className="flex gap-1 justify-end sm:col-span-2 md:col-span-4">
                  <Button size="sm" variant="outline" className="min-h-11" onClick={cancelEdit}><X className="w-4 h-4" /></Button>
                  <Button size="sm" className="min-h-11" onClick={saveEdit}><Save className="w-4 h-4" /> Enregistrer</Button>
                </div>
              </div>
            );
          }
          return (
            <div key={p.id} className="rounded-xl border border-border p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="truncate font-medium">{p.first_name} {p.last_name}</p>
                  {p.is_lead && <Badge variant="default" className="text-[10px]">Responsable</Badge>}
                  {p.relation && <Badge variant="outline" className="text-[10px]">{RELATIONS[p.relation] ?? p.relation}</Badge>}
                  {p.client_id && (
                    <Link to={`/admin/clients/${p.client_id}`} className="text-xs text-primary inline-flex items-center gap-1 hover:underline">
                      CRM <ExternalLink className="w-3 h-3" />
                    </Link>
                  )}
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {p.sex || "—"} · {p.date_of_birth ?? "—"} · {p.nationality || "—"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {p.profession || "—"} · {maritalStatusLabel(p.marital_status)}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="icon" variant="ghost" className="h-11 w-11" onClick={() => startEdit(p)}><Pencil className="w-4 h-4" /></Button>
                <Button size="icon" variant="ghost" className="h-11 w-11" onClick={() => remove(p)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
              </div>
              </div>
              <QuickActions phone={p.phone} email={p.email} passport={p.passport_no} compact className="mt-3" />
              <details className="group mt-3 rounded-lg bg-muted/40">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 text-xs font-semibold text-muted-foreground">
                  Passeport & détails
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                </summary>
                <div className="grid grid-cols-2 gap-3 px-3 pb-3 text-xs">
                  <div><p className="text-muted-foreground">Passeport</p><p className="font-medium text-foreground">{p.passport_no || "—"}</p></div>
                  <div><p className="text-muted-foreground">Expiration</p><p className="font-medium text-foreground">{p.passport_expiry || "—"}</p></div>
                  <div><p className="text-muted-foreground">Émission</p><p className="font-medium text-foreground">{p.passport_issue_date || "—"}</p></div>
                  <div><p className="text-muted-foreground">Contact</p><p className="truncate font-medium text-foreground">{p.email || p.phone || "—"}</p></div>
                  {p.address && <div className="col-span-2"><p className="text-muted-foreground">Adresse</p><p className="break-words font-medium text-foreground">{p.address}</p></div>}
                </div>
              </details>
            </div>
          );
        })}
      </div>

      <AddTravelerDialog open={openAdd} onOpenChange={setOpenAdd} bookingId={bookingId} tripId={tripId} onSaved={load} />
      <LinkExistingClientDialog open={openLink} onOpenChange={setOpenLink} bookingId={bookingId} tripId={tripId} onSaved={load} />
    </section>
  );
}
