import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, Download, Pencil, Upload } from "lucide-react";
import { fmtMAD, fmtDate } from "@/lib/format";
import { exportCsv } from "@/admin/lib/export-csv";
import { toast } from "sonner";

export default function OpsJapanPayments({ trip }: { trip: any }) {
  const [rows, setRows] = useState<any[]>([]);
  const [supplierTotal, setSupplierTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const { data } = await supabase.from("trip_japan_payments").select("*").eq("trip_id", trip.id).order("paid_on", { ascending: false });
    setRows(data ?? []);
    const { data: costs } = await supabase.from("supplier_day_costs").select("total_cost").eq("trip_id", trip.id);
    setSupplierTotal((costs ?? []).reduce((s, c) => s + Number(c.total_cost || 0), 0));
  };
  useEffect(() => { load(); }, [trip.id]);

  const totalSent = rows.reduce((s, r) => s + Number(r.amount_mad || 0), 0);

  const save = async () => {
    if (!edit) return;
    const { id, created_at, updated_at, ...patch } = edit;
    patch.amount_mad = Number(patch.amount || 0) * Number(patch.exchange_rate || 1);
    patch.trip_id = trip.id;
    if (id) {
      await supabase.from("trip_japan_payments").update(patch).eq("id", id);
    } else {
      await supabase.from("trip_japan_payments").insert(patch);
    }
    setOpen(false); setEdit(null); load();
  };
  const remove = async (id: string) => {
    if (!confirm("Supprimer ?")) return;
    await supabase.from("trip_japan_payments").delete().eq("id", id);
    load();
  };

  const upload = async (file: File) => {
    const path = `japan-payments/${trip.id}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("media").upload(path, file, { upsert: true });
    if (error) return toast.error(error.message);
    const url = supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
    setEdit({ ...edit, receipt_url: url });
  };

  const doExport = () => {
    exportCsv(`paiements-japon-${trip.title}`, rows.map((r) => ({
      date: r.paid_on, montant: r.amount, devise: r.currency, taux: r.exchange_rate,
      mad: r.amount_mad, methode: r.method, beneficiaire: r.beneficiary, commentaire: r.comment,
    })));
  };

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="bg-background border border-border rounded-xl p-4"><p className="text-xs text-muted-foreground">Total à payer (coûts)</p><p className="font-display text-xl">{fmtMAD(supplierTotal)}</p></div>
        <div className="bg-background border border-border rounded-xl p-4"><p className="text-xs text-muted-foreground">Total envoyé</p><p className="font-display text-xl text-emerald-600">{fmtMAD(totalSent)}</p></div>
        <div className="bg-background border border-border rounded-xl p-4"><p className="text-xs text-muted-foreground">Reste à envoyer</p><p className="font-display text-xl text-amber-600">{fmtMAD(supplierTotal - totalSent)}</p></div>
      </div>

      <div className="flex gap-2 mb-4">
        <Button variant="outline" onClick={doExport}><Download className="w-4 h-4" /> Export CSV</Button>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEdit(null); }}>
          <DialogTrigger asChild>
            <Button onClick={() => setEdit({ paid_on: new Date().toISOString().slice(0, 10), amount: 0, currency: "JPY", exchange_rate: 1 })}>
              <Plus className="w-4 h-4" /> Ajouter envoi
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{edit?.id ? "Modifier" : "Nouveau"} paiement Japon</DialogTitle></DialogHeader>
            {edit && (
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Date</Label><Input type="date" value={edit.paid_on ?? ""} onChange={(e) => setEdit({ ...edit, paid_on: e.target.value })} /></div>
                <div><Label>Devise</Label><Input value={edit.currency} onChange={(e) => setEdit({ ...edit, currency: e.target.value })} /></div>
                <div><Label>Montant</Label><Input type="number" value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: +e.target.value })} /></div>
                <div><Label>Taux → MAD</Label><Input type="number" step="0.0001" value={edit.exchange_rate} onChange={(e) => setEdit({ ...edit, exchange_rate: +e.target.value })} /></div>
                <div className="col-span-2 text-sm text-muted-foreground">≈ {fmtMAD(Number(edit.amount || 0) * Number(edit.exchange_rate || 1))}</div>
                <div><Label>Méthode</Label><Input value={edit.method ?? ""} onChange={(e) => setEdit({ ...edit, method: e.target.value })} placeholder="Wire, Wise, Western Union…" /></div>
                <div><Label>Bénéficiaire</Label><Input value={edit.beneficiary ?? ""} onChange={(e) => setEdit({ ...edit, beneficiary: e.target.value })} /></div>
                <div className="col-span-2"><Label>Commentaire</Label><Input value={edit.comment ?? ""} onChange={(e) => setEdit({ ...edit, comment: e.target.value })} /></div>
                <div className="col-span-2">
                  <Label>Justificatif</Label>
                  <div className="flex items-center gap-2 mt-1.5">
                    {edit.receipt_url && <a href={edit.receipt_url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">Voir</a>}
                    <input ref={fileRef} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
                    <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}><Upload className="w-4 h-4" /> Téléverser</Button>
                  </div>
                </div>
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
              <th className="p-3">Date</th><th className="p-3">Montant</th><th className="p-3">Devise</th>
              <th className="p-3">Taux</th><th className="p-3">≈ MAD</th><th className="p-3">Méthode</th>
              <th className="p-3">Bénéficiaire</th><th className="p-3">Justif.</th><th className="p-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">Aucun envoi.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-secondary/30">
                <td className="p-3">{fmtDate(r.paid_on)}</td>
                <td className="p-3">{r.amount}</td>
                <td className="p-3">{r.currency}</td>
                <td className="p-3">{r.exchange_rate}</td>
                <td className="p-3">{fmtMAD(r.amount_mad)}</td>
                <td className="p-3">{r.method ?? "—"}</td>
                <td className="p-3">{r.beneficiary ?? "—"}</td>
                <td className="p-3">{r.receipt_url ? <a href={r.receipt_url} target="_blank" rel="noreferrer" className="text-primary underline text-xs">Voir</a> : "—"}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => { setEdit(r); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="w-4 h-4" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
