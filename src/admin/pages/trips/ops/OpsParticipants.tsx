import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Download, Pencil, Trash2, Search } from "lucide-react";
import { fmtMAD } from "@/lib/format";
import { exportCsv } from "@/admin/lib/export-csv";
import { toast } from "sonner";

type Row = {
  participant: any;
  booking: any;
};

export default function OpsParticipants({ trip }: { trip: any }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<any>(null);

  const load = async () => {
    const { data: bks } = await supabase.from("bookings").select("*").eq("trip_id", trip.id).order("created_at");
    const list = bks ?? [];
    setBookings(list);
    if (list.length === 0) { setRows([]); return; }
    const ids = list.map((b) => b.id);
    const { data: parts } = await supabase.from("booking_participants").select("*").in("booking_id", ids);

    // Auto-create lead participant for bookings missing one
    const missing = list.filter((b) => !(parts ?? []).some((p) => p.booking_id === b.id && p.is_lead));
    if (missing.length > 0) {
      const inserts = missing.map((b) => {
        const [first, ...rest] = (b.contact_name || "").split(" ");
        return {
          booking_id: b.id,
          trip_id: trip.id,
          first_name: first || "",
          last_name: rest.join(" "),
          is_lead: true,
        };
      });
      await supabase.from("booking_participants").insert(inserts);
      const { data: refreshed } = await supabase.from("booking_participants").select("*").in("booking_id", ids);
      buildRows(list, refreshed ?? []);
    } else {
      buildRows(list, parts ?? []);
    }
  };

  const buildRows = (bks: any[], parts: any[]) => {
    const out: Row[] = [];
    for (const p of parts) {
      const b = bks.find((x) => x.id === p.booking_id);
      if (b) out.push({ participant: p, booking: b });
    }
    setRows(out);
  };

  useEffect(() => { load(); }, [trip.id]);

  const filtered = rows.filter(({ participant: p, booking: b }) => {
    const s = q.toLowerCase().trim();
    if (!s) return true;
    return [p.first_name, p.last_name, b.contact_name, b.contact_email, b.contact_phone, b.reference]
      .some((v) => (v || "").toLowerCase().includes(s));
  });

  const save = async () => {
    if (!edit) return;
    const { id, booking_id, trip_id: _t, created_at, updated_at, ...patch } = edit;
    if (id) {
      const { error } = await supabase.from("booking_participants").update(patch).eq("id", id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("booking_participants").insert({ ...patch, booking_id, trip_id: trip.id });
      if (error) return toast.error(error.message);
    }
    toast.success("Enregistré");
    setOpen(false); setEdit(null); load();
  };

  const remove = async (id: string) => {
    if (!confirm("Supprimer ce participant ?")) return;
    await supabase.from("booking_participants").delete().eq("id", id);
    load();
  };

  const doExport = () => {
    exportCsv(`inscrits-${trip.title}`, filtered.map(({ participant: p, booking: b }) => ({
      prenom: p.first_name, nom: p.last_name, sexe: p.sex, naissance: p.date_of_birth,
      passeport: p.passport_no, emission: p.passport_issue_date, expiration: p.passport_expiry,
      type_client: p.client_type, email: b.contact_email, telephone: b.contact_phone,
      ville: b.contact_city, reservation_par: b.contact_name, reference: b.reference,
      statut: b.status, total: b.total_amount_mad, paye: b.paid_amount_mad,
      reste: Number(b.total_amount_mad || 0) - Number(b.paid_amount_mad || 0),
    })));
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…" className="pl-9" />
        </div>
        <Button variant="outline" onClick={doExport}><Download className="w-4 h-4" /> Export CSV</Button>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEdit(null); }}>
          <DialogTrigger asChild>
            <Button onClick={() => setEdit({ first_name: "", last_name: "", booking_id: bookings[0]?.id })}>
              <Plus className="w-4 h-4" /> Ajouter participant
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{edit?.id ? "Modifier" : "Ajouter"} un participant</DialogTitle></DialogHeader>
            {edit && (
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label>Réservation</Label>
                  <Select value={edit.booking_id} onValueChange={(v) => setEdit({ ...edit, booking_id: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {bookings.map((b) => <SelectItem key={b.id} value={b.id}>{b.reference} — {b.contact_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Prénom</Label><Input value={edit.first_name ?? ""} onChange={(e) => setEdit({ ...edit, first_name: e.target.value })} /></div>
                <div><Label>Nom</Label><Input value={edit.last_name ?? ""} onChange={(e) => setEdit({ ...edit, last_name: e.target.value })} /></div>
                <div>
                  <Label>Sexe</Label>
                  <Select value={edit.sex || ""} onValueChange={(v) => setEdit({ ...edit, sex: v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="M">M</SelectItem><SelectItem value="F">F</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Date de naissance</Label><Input type="date" value={edit.date_of_birth ?? ""} onChange={(e) => setEdit({ ...edit, date_of_birth: e.target.value || null })} /></div>
                <div><Label>N° passeport</Label><Input value={edit.passport_no ?? ""} onChange={(e) => setEdit({ ...edit, passport_no: e.target.value })} /></div>
                <div>
                  <Label>Type client</Label>
                  <Select value={edit.client_type || ""} onValueChange={(v) => setEdit({ ...edit, client_type: v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SNG">SNG</SelectItem>
                      <SelectItem value="Couple">Couple</SelectItem>
                      <SelectItem value="Friends">Friends</SelectItem>
                      <SelectItem value="Family">Family</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Date émission</Label><Input type="date" value={edit.passport_issue_date ?? ""} onChange={(e) => setEdit({ ...edit, passport_issue_date: e.target.value || null })} /></div>
                <div><Label>Date expiration</Label><Input type="date" value={edit.passport_expiry ?? ""} onChange={(e) => setEdit({ ...edit, passport_expiry: e.target.value || null })} /></div>
              </div>
            )}
            <DialogFooter><Button onClick={save}>Enregistrer</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="bg-background rounded-2xl border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-left">
            <tr>
              <th className="p-3">Prénom</th><th className="p-3">Nom</th><th className="p-3">Sexe</th>
              <th className="p-3">Naissance</th><th className="p-3">Passeport</th>
              <th className="p-3">Émission</th><th className="p-3">Expiration</th>
              <th className="p-3">Email</th><th className="p-3">Téléphone</th>
              <th className="p-3">Ville</th><th className="p-3">Type</th>
              <th className="p-3">Réservé par</th><th className="p-3">N° rés.</th>
              <th className="p-3">Statut</th><th className="p-3">Payé</th><th className="p-3">Reste</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 && <tr><td colSpan={17} className="p-6 text-center text-muted-foreground">Aucun inscrit.</td></tr>}
            {filtered.map(({ participant: p, booking: b }) => {
              const reste = Number(b.total_amount_mad || 0) - Number(b.paid_amount_mad || 0);
              return (
                <tr key={p.id} className="hover:bg-secondary/30">
                  <td className="p-3">{p.first_name}</td>
                  <td className="p-3">{p.last_name}</td>
                  <td className="p-3">{p.sex ?? "—"}</td>
                  <td className="p-3">{p.date_of_birth ?? "—"}</td>
                  <td className="p-3">{p.passport_no ?? "—"}</td>
                  <td className="p-3">{p.passport_issue_date ?? "—"}</td>
                  <td className="p-3">{p.passport_expiry ?? "—"}</td>
                  <td className="p-3">{b.contact_email}</td>
                  <td className="p-3">{b.contact_phone ?? "—"}</td>
                  <td className="p-3">{b.contact_city ?? "—"}</td>
                  <td className="p-3">{p.client_type ?? "—"}</td>
                  <td className="p-3">{b.contact_name}</td>
                  <td className="p-3 font-mono text-xs">{b.reference}</td>
                  <td className="p-3">{b.status}</td>
                  <td className="p-3">{fmtMAD(b.paid_amount_mad)}</td>
                  <td className="p-3 font-medium">{fmtMAD(reste)}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => { setEdit(p); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(p.id)}><Trash2 className="w-4 h-4" /></Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
