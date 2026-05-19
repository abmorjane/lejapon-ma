import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useExtras } from "@/hooks/useExtras";
import { useAuth } from "@/hooks/useAuth";
import { fmtMAD } from "@/lib/format";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  booking: any;
  extras: any[];
  onSaved: () => void;
};

const SCALAR_FIELDS: { key: string; label: string }[] = [
  { key: "contact_name", label: "Nom client" },
  { key: "contact_email", label: "Email" },
  { key: "contact_phone", label: "Téléphone" },
  { key: "contact_city", label: "Ville" },
  { key: "trip_id", label: "Voyage" },
  { key: "preferred_dates", label: "Dates souhaitées" },
  { key: "num_adults", label: "Adultes" },
  { key: "num_children", label: "Enfants" },
  { key: "formula", label: "Formule" },
  { key: "room_type", label: "Type de chambre" },
  { key: "message", label: "Message" },
  { key: "status", label: "Statut" },
  { key: "total_amount_mad", label: "Total" },
  { key: "paid_amount_mad", label: "Montant payé" },
];

export function EditBookingDialog({ open, onOpenChange, booking, extras: initialExtras, onSaved }: Props) {
  const { user } = useAuth();
  const { extras: catalog } = useExtras();
  const [trips, setTrips] = useState<any[]>([]);
  const [form, setForm] = useState<any>({});
  const [items, setItems] = useState<{ extra_id: string | null; name_snapshot: string; qty: number; unit_price_mad: number; id?: string }[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<string>("virement");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      contact_name: booking.contact_name ?? "",
      contact_email: booking.contact_email ?? "",
      contact_phone: booking.contact_phone ?? "",
      contact_city: booking.contact_city ?? "",
      trip_id: booking.trip_id ?? "",
      preferred_dates: booking.preferred_dates ?? "",
      num_adults: booking.num_adults ?? 1,
      num_children: booking.num_children ?? 0,
      formula: booking.formula ?? "",
      room_type: booking.room_type ?? "",
      message: booking.message ?? "",
      status: booking.status,
      total_amount_mad: Number(booking.total_amount_mad ?? 0),
      paid_amount_mad: Number(booking.paid_amount_mad ?? 0),
    });
    setItems((initialExtras ?? []).map((e: any) => ({
      id: e.id, extra_id: e.extra_id, name_snapshot: e.name_snapshot, qty: e.qty, unit_price_mad: Number(e.unit_price_mad),
    })));
    supabase.from("trips").select("id,title,season,base_price_mad").order("title").then(({ data }) => setTrips(data ?? []));
  }, [open, booking?.id]);

  const trip = trips.find((t) => t.id === form.trip_id);
  const basePrice = Number(trip?.base_price_mad ?? 0);
  const pax = Number(form.num_adults || 0) + Number(form.num_children || 0);
  const extrasTotal = items.reduce((s, i) => s + i.qty * i.unit_price_mad, 0);
  const computedTotal = basePrice * pax + extrasTotal;
  const deposit = pax * 25000;
  const remaining = Math.max(0, Number(form.total_amount_mad || 0) - Number(form.paid_amount_mad || 0));

  const setField = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const addExtra = (id: string) => {
    const ex = catalog.find((e) => e.id === id);
    if (!ex) return;
    if (items.some((i) => i.extra_id === id)) return;
    setItems([...items, { extra_id: id, name_snapshot: ex.name, qty: 1, unit_price_mad: Number(ex.price_mad) }]);
  };

  const updateItem = (idx: number, patch: any) => setItems(items.map((it, i) => i === idx ? { ...it, ...patch } : it));
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));

  const applyComputedTotal = () => setField("total_amount_mad", computedTotal);

  const save = async () => {
    if (Number(form.total_amount_mad) !== Number(booking.total_amount_mad)) {
      if (!confirm(`Le total passe de ${fmtMAD(booking.total_amount_mad)} à ${fmtMAD(Number(form.total_amount_mad))}. Confirmer ?`)) return;
    }
    setBusy(true);
    try {
      const updates: any = { ...form };
      updates.num_adults = Number(updates.num_adults) || 1;
      updates.num_children = Number(updates.num_children) || 0;
      updates.total_amount_mad = Number(updates.total_amount_mad) || 0;
      updates.paid_amount_mad = Number(updates.paid_amount_mad) || 0;
      if (!updates.trip_id) updates.trip_id = null;

      // Audit log: detect changes
      const audits: any[] = [];
      for (const f of SCALAR_FIELDS) {
        const oldV = (booking as any)[f.key];
        const newV = updates[f.key];
        const o = oldV == null ? "" : String(oldV);
        const n = newV == null ? "" : String(newV);
        if (o !== n) audits.push({
          booking_id: booking.id, user_id: user?.id ?? null, user_email: user?.email ?? null,
          field: f.label, old_value: o, new_value: n,
        });
      }

      const { error: updErr } = await supabase.from("bookings").update(updates).eq("id", booking.id);
      if (updErr) throw updErr;

      // Replace extras (simple strategy)
      await supabase.from("booking_extras").delete().eq("booking_id", booking.id);
      if (items.length > 0) {
        const rows = items.map((it) => ({
          booking_id: booking.id, extra_id: it.extra_id, name_snapshot: it.name_snapshot,
          qty: it.qty, unit_price_mad: it.unit_price_mad,
        }));
        const { error: exErr } = await supabase.from("booking_extras").insert(rows);
        if (exErr) throw exErr;
        audits.push({
          booking_id: booking.id, user_id: user?.id ?? null, user_email: user?.email ?? null,
          field: "Extras", old_value: `${initialExtras?.length ?? 0} item(s)`, new_value: `${items.length} item(s)`,
        });
      } else if ((initialExtras?.length ?? 0) > 0) {
        audits.push({
          booking_id: booking.id, user_id: user?.id ?? null, user_email: user?.email ?? null,
          field: "Extras", old_value: `${initialExtras.length} item(s)`, new_value: "0 item(s)",
        });
      }

      if (audits.length > 0) {
        await supabase.from("booking_audit_log" as any).insert(audits as any);
      }

      toast.success("Inscription mise à jour");
      onOpenChange(false);
      onSaved();
    } catch (e: any) {
      toast.error(e.message ?? "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Modifier l'inscription · {booking?.reference}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <section>
            <h3 className="font-display text-sm uppercase tracking-wide text-muted-foreground mb-3">Client</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Nom</Label><Input value={form.contact_name} onChange={(e) => setField("contact_name", e.target.value)} /></div>
              <div><Label className="text-xs">Email</Label><Input type="email" value={form.contact_email} onChange={(e) => setField("contact_email", e.target.value)} /></div>
              <div><Label className="text-xs">Téléphone</Label><Input value={form.contact_phone} onChange={(e) => setField("contact_phone", e.target.value)} /></div>
              <div><Label className="text-xs">Ville</Label><Input value={form.contact_city} onChange={(e) => setField("contact_city", e.target.value)} /></div>
            </div>
          </section>

          <section>
            <h3 className="font-display text-sm uppercase tracking-wide text-muted-foreground mb-3">Voyage</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Voyage</Label>
                <Select value={form.trip_id || "none"} onValueChange={(v) => setField("trip_id", v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Aucun —</SelectItem>
                    {trips.map((t) => <SelectItem key={t.id} value={t.id}>{t.title} {t.season ? `· ${t.season}` : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Dates souhaitées</Label><Input value={form.preferred_dates} onChange={(e) => setField("preferred_dates", e.target.value)} /></div>
              <div><Label className="text-xs">Formule / Hôtel</Label><Input value={form.formula} onChange={(e) => setField("formula", e.target.value)} /></div>
              <div><Label className="text-xs">Adultes</Label><Input type="number" min={0} value={form.num_adults} onChange={(e) => setField("num_adults", e.target.value)} /></div>
              <div><Label className="text-xs">Enfants</Label><Input type="number" min={0} value={form.num_children} onChange={(e) => setField("num_children", e.target.value)} /></div>
              <div className="col-span-2"><Label className="text-xs">Type de chambre</Label><Input value={form.room_type} onChange={(e) => setField("room_type", e.target.value)} /></div>
            </div>
          </section>

          <section>
            <h3 className="font-display text-sm uppercase tracking-wide text-muted-foreground mb-3">Extras</h3>
            <div className="space-y-2 mb-3">
              {items.length === 0 && <p className="text-sm text-muted-foreground">Aucun extra.</p>}
              {items.map((it, idx) => (
                <div key={idx} className="flex items-center gap-2 border border-border rounded-lg p-2">
                  <span className="flex-1 text-sm">{it.name_snapshot}</span>
                  <Input type="number" min={1} className="w-20" value={it.qty} onChange={(e) => updateItem(idx, { qty: Math.max(1, Number(e.target.value) || 1) })} />
                  <Input type="number" className="w-28" value={it.unit_price_mad} onChange={(e) => updateItem(idx, { unit_price_mad: Number(e.target.value) || 0 })} />
                  <span className="w-28 text-right text-sm font-medium">{fmtMAD(it.qty * it.unit_price_mad)}</span>
                  <Button size="sm" variant="ghost" onClick={() => removeItem(idx)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Select value="" onValueChange={addExtra}>
                <SelectTrigger className="flex-1"><SelectValue placeholder="Ajouter une activité…" /></SelectTrigger>
                <SelectContent>
                  {catalog.filter((e) => !items.some((i) => i.extra_id === e.id)).map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.name} · {fmtMAD(e.price_mad)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={() => {}}><Plus className="w-4 h-4" /></Button>
            </div>
          </section>

          <section>
            <h3 className="font-display text-sm uppercase tracking-wide text-muted-foreground mb-3">Paiement</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Statut</Label>
                <Select value={form.status} onValueChange={(v) => setField("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lead">Lead</SelectItem>
                    <SelectItem value="confirmed">Confirmé</SelectItem>
                    <SelectItem value="paid">Payé</SelectItem>
                    <SelectItem value="cancelled">Annulé</SelectItem>
                    <SelectItem value="completed">Terminé</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Mode de paiement (par défaut)</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="virement">Virement</SelectItem>
                    <SelectItem value="especes">Espèces</SelectItem>
                    <SelectItem value="carte">Carte bancaire</SelectItem>
                    <SelectItem value="cheque">Chèque</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Total (MAD)</Label>
                <Input type="number" value={form.total_amount_mad} onChange={(e) => setField("total_amount_mad", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Montant payé (MAD)</Label>
                <Input type="number" value={form.paid_amount_mad} onChange={(e) => setField("paid_amount_mad", e.target.value)} />
              </div>
            </div>
            <div className="mt-3 rounded-lg bg-secondary/50 p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Total calculé (base × pax + extras)</span><span className="font-medium">{fmtMAD(computedTotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Acompte (25 000 MAD × {pax} pers.)</span><span>{fmtMAD(deposit)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Reste à payer (selon total saisi)</span><span className="font-semibold">{fmtMAD(remaining)}</span></div>
              <Button size="sm" variant="outline" className="mt-2" onClick={applyComputedTotal}>Utiliser le total calculé</Button>
            </div>
          </section>

          <section>
            <h3 className="font-display text-sm uppercase tracking-wide text-muted-foreground mb-3">Notes internes</h3>
            <Textarea rows={3} value={form.message} onChange={(e) => setField("message", e.target.value)} />
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Annuler</Button>
          <Button onClick={save} disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer les modifications"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}