import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, Download, Pencil } from "lucide-react";
import { fmtMAD, fmtDate } from "@/lib/format";
import { exportCsv } from "@/admin/lib/export-csv";
import { toast } from "sonner";

export default function OpsPayments({ trip }: { trip: any }) {
  const [bookings, setBookings] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<any>(null);

  const load = async () => {
    const { data: bks } = await supabase.from("bookings").select("*").eq("trip_id", trip.id);
    setBookings(bks ?? []);
    const ids = (bks ?? []).map((b) => b.id);
    if (!ids.length) { setPayments([]); return; }
    const { data: pays } = await supabase.from("payments").select("*").in("booking_id", ids).order("paid_at", { ascending: false }).order("created_at", { ascending: false });
    setPayments(pays ?? []);
  };
  useEffect(() => { load(); }, [trip.id]);

  const totalExpected = bookings.reduce((s, b) => s + Number(b.total_amount_mad || 0), 0);
  const totalPaid = bookings.reduce((s, b) => s + Number(b.paid_amount_mad || 0), 0);
  const totalLeft = totalExpected - totalPaid;

  const save = async () => {
    if (!edit) return;
    const { id, created_at, ...patch } = edit;
    let notifyPaymentId: string | null = null;
    if (id) {
      const { error } = await supabase.from("payments").update(patch).eq("id", id);
      if (error) return toast.error(error.message);
      if (["paid", "received"].includes(String(patch.status))) {
        notifyPaymentId = id;
      }
    } else {
      const { data: insertedPayment, error } = await supabase.from("payments").insert(patch).select("id").single();
      if (error) return toast.error(error.message);
      if (insertedPayment?.id && ["paid", "received"].includes(String(patch.status))) {
        notifyPaymentId = insertedPayment.id;
      }
    }
    // sync paid_amount on booking
    const { data: pays } = await supabase.from("payments").select("amount_mad,status").eq("booking_id", patch.booking_id);
    const sum = (pays ?? []).filter((p) => ["paid", "received"].includes(String(p.status))).reduce((s, p) => s + Number(p.amount_mad || 0), 0);
    await supabase.from("bookings").update({ paid_amount_mad: sum }).eq("id", patch.booking_id);
    if (notifyPaymentId) {
      void supabase.functions.invoke("send-admin-notification", {
        body: { event_type: "payment_recorded", payment_id: notifyPaymentId },
      }).then(({ error }) => {
        if (error) console.warn("admin payment notification failed", error);
      });
    }
    setOpen(false); setEdit(null); load();
  };

  const remove = async (p: any) => {
    if (!confirm("Supprimer ce paiement ?")) return;
    await supabase.from("payments").delete().eq("id", p.id);
    const { data: pays } = await supabase.from("payments").select("amount_mad,status").eq("booking_id", p.booking_id);
    const sum = (pays ?? []).filter((x) => ["paid", "received"].includes(String(x.status))).reduce((s, x) => s + Number(x.amount_mad || 0), 0);
    await supabase.from("bookings").update({ paid_amount_mad: sum }).eq("id", p.booking_id);
    load();
  };

  const doExport = () => {
    exportCsv(`paiements-clients-${trip.title}`, payments.map((p) => {
      const b = bookings.find((x) => x.id === p.booking_id);
      return {
        date: p.paid_at, client: b?.contact_name, reservation: b?.reference,
        montant: p.amount_mad, mode: p.method, commentaire: p.notes,
        total: b?.total_amount_mad, reste: Number(b?.total_amount_mad || 0) - Number(b?.paid_amount_mad || 0),
      };
    }));
  };

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="bg-background border border-border rounded-xl p-4"><p className="text-xs text-muted-foreground">Total attendu</p><p className="font-display text-xl">{fmtMAD(totalExpected)}</p></div>
        <div className="bg-background border border-border rounded-xl p-4"><p className="text-xs text-muted-foreground">Total payé</p><p className="font-display text-xl text-emerald-600">{fmtMAD(totalPaid)}</p></div>
        <div className="bg-background border border-border rounded-xl p-4"><p className="text-xs text-muted-foreground">Reste à encaisser</p><p className="font-display text-xl text-amber-600">{fmtMAD(totalLeft)}</p></div>
      </div>

      <div className="flex gap-2 mb-4">
        <Button variant="outline" onClick={doExport}><Download className="w-4 h-4" /> Export CSV</Button>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEdit(null); }}>
          <DialogTrigger asChild>
            <Button onClick={() => setEdit({ booking_id: bookings[0]?.id, amount_mad: 0, paid_at: new Date().toISOString().slice(0, 10), method: "virement", status: "paid" })}>
              <Plus className="w-4 h-4" /> Ajouter paiement
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{edit?.id ? "Modifier" : "Nouveau"} paiement</DialogTitle></DialogHeader>
            {edit && (
              <div className="space-y-3">
                <div>
                  <Label>Réservation</Label>
                  <Select value={edit.booking_id} onValueChange={(v) => setEdit({ ...edit, booking_id: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {bookings.map((b) => <SelectItem key={b.id} value={b.id}>{b.reference} — {b.contact_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Date</Label><Input type="date" value={edit.paid_at ?? ""} onChange={(e) => setEdit({ ...edit, paid_at: e.target.value })} /></div>
                  <div><Label>Montant (MAD)</Label><Input type="number" value={edit.amount_mad} onChange={(e) => setEdit({ ...edit, amount_mad: +e.target.value })} /></div>
                  <div>
                    <Label>Mode</Label>
                    <Select value={edit.method || ""} onValueChange={(v) => setEdit({ ...edit, method: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="virement">Virement</SelectItem>
                        <SelectItem value="cheque">Chèque</SelectItem>
                        <SelectItem value="especes">Espèces</SelectItem>
                        <SelectItem value="carte">Carte</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Statut</Label>
                    <Select value={edit.status || "paid"} onValueChange={(v) => setEdit({ ...edit, status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="paid">Payé</SelectItem>
                        <SelectItem value="pending">En attente</SelectItem>
                        <SelectItem value="failed">Échoué</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div><Label>Commentaire</Label><Input value={edit.notes ?? ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></div>
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
              <th className="p-3">Date</th><th className="p-3">Client</th><th className="p-3">Réservation</th>
              <th className="p-3">Montant</th><th className="p-3">Mode</th><th className="p-3">Commentaire</th>
              <th className="p-3">Total</th><th className="p-3">Reste</th><th className="p-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {payments.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">Aucun paiement.</td></tr>}
            {payments.map((p) => {
              const b = bookings.find((x) => x.id === p.booking_id);
              return (
                <tr key={p.id} className="hover:bg-secondary/30">
                  <td className="p-3">{fmtDate(p.paid_at)}</td>
                  <td className="p-3">{b?.contact_name}</td>
                  <td className="p-3 font-mono text-xs">{b?.reference}</td>
                  <td className="p-3">{fmtMAD(p.amount_mad)}</td>
                  <td className="p-3">{p.method}</td>
                  <td className="p-3">{p.notes ?? "—"}</td>
                  <td className="p-3">{fmtMAD(b?.total_amount_mad)}</td>
                  <td className="p-3">{fmtMAD(Number(b?.total_amount_mad || 0) - Number(b?.paid_amount_mad || 0))}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => { setEdit(p); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(p)}><Trash2 className="w-4 h-4" /></Button>
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
