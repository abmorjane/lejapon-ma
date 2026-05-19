import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useExtras } from "@/hooks/useExtras";
import { fmtMAD } from "@/lib/format";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (id: string) => void;
};

export function CreateBookingDialog({ open, onOpenChange, onCreated }: Props) {
  const navigate = useNavigate();
  const { extras: catalog } = useExtras();
  const [trips, setTrips] = useState<any[]>([]);
  const [form, setForm] = useState<any>({
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    contact_city: "",
    trip_id: "",
    preferred_dates: "",
    num_adults: 1,
    num_children: 0,
    formula: "",
    room_type: "",
    message: "",
    status: "lead",
    paid_amount_mad: 0,
    total_amount_mad: 0,
    use_computed: true,
  });
  const [items, setItems] = useState<{ extra_id: string; name_snapshot: string; qty: number; unit_price_mad: number }[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<string>("virement");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    supabase.from("trips").select("id,title,season,start_date,end_date,base_price_mad").order("title").then(({ data }) => setTrips(data ?? []));
  }, [open]);

  const trip = trips.find((t) => t.id === form.trip_id);
  const basePrice = Number(trip?.base_price_mad ?? 0);
  const adults = Number(form.num_adults || 0);
  const children = Number(form.num_children || 0);
  const pax = adults + children;
  const tripTotal = basePrice * pax;
  const extrasTotal = items.reduce((s, i) => s + i.qty * i.unit_price_mad, 0);
  const computedTotal = tripTotal + extrasTotal;
  const total = form.use_computed ? computedTotal : Number(form.total_amount_mad || 0);
  const deposit = pax * 25000;
  const paid = Number(form.paid_amount_mad || 0);
  const remaining = Math.max(0, total - paid);

  const setField = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const addExtra = (id: string) => {
    const ex = catalog.find((e) => e.id === id);
    if (!ex || items.some((i) => i.extra_id === id)) return;
    setItems([...items, { extra_id: id, name_snapshot: ex.name, qty: 1, unit_price_mad: Number(ex.price_mad) }]);
  };
  const updateItem = (idx: number, patch: any) => setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));

  const create = async () => {
    if (!form.contact_name?.trim() || !form.contact_email?.trim()) {
      toast.error("Nom et email sont requis");
      return;
    }
    setBusy(true);
    try {
      // 1. Upsert client (CRM)
      const { data: clientId, error: clientErr } = await supabase.rpc("upsert_client_from_booking", {
        _name: form.contact_name,
        _email: form.contact_email,
        _phone: form.contact_phone || null,
        _city: form.contact_city || null,
      });
      if (clientErr) throw clientErr;

      // 2. Insert booking
      const bookingId = crypto.randomUUID();
      const insertRow: any = {
        id: bookingId,
        client_id: clientId,
        trip_id: form.trip_id || null,
        contact_name: form.contact_name,
        contact_email: form.contact_email,
        contact_phone: form.contact_phone || null,
        contact_city: form.contact_city || null,
        preferred_dates: form.preferred_dates || null,
        num_adults: adults || 1,
        num_children: children,
        formula: form.formula || null,
        room_type: form.room_type || null,
        message: form.message || null,
        status: form.status,
        total_amount_mad: total,
        paid_amount_mad: paid,
        source: "admin",
      };
      const { error: bErr } = await supabase.from("bookings").insert(insertRow);
      if (bErr) throw bErr;

      // 3. Insert extras
      if (items.length > 0) {
        const rows = items.map((it) => ({
          booking_id: bookingId,
          extra_id: it.extra_id,
          name_snapshot: it.name_snapshot,
          qty: it.qty,
          unit_price_mad: it.unit_price_mad,
        }));
        const { error: exErr } = await supabase.from("booking_extras").insert(rows);
        if (exErr) throw exErr;
      }

      // 4. Optional payment record
      if (paid > 0) {
        await supabase.from("payments").insert({
          booking_id: bookingId,
          amount_mad: paid,
          method: paymentMethod,
          status: "received",
          paid_at: new Date().toISOString(),
        } as any);
      }

      toast.success("Réservation créée");
      onOpenChange(false);
      if (onCreated) onCreated(bookingId);
      else navigate(`/admin/bookings/${bookingId}`);
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
          <DialogTitle>Nouvelle réservation</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <section>
            <h3 className="font-display text-sm uppercase tracking-wide text-muted-foreground mb-3">Client</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Nom complet *</Label><Input value={form.contact_name} onChange={(e) => setField("contact_name", e.target.value)} /></div>
              <div><Label className="text-xs">Email *</Label><Input type="email" value={form.contact_email} onChange={(e) => setField("contact_email", e.target.value)} /></div>
              <div><Label className="text-xs">Téléphone</Label><Input value={form.contact_phone} onChange={(e) => setField("contact_phone", e.target.value)} /></div>
              <div><Label className="text-xs">Ville</Label><Input value={form.contact_city} onChange={(e) => setField("contact_city", e.target.value)} /></div>
            </div>
          </section>

          <section>
            <h3 className="font-display text-sm uppercase tracking-wide text-muted-foreground mb-3">Voyage</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Voyage / saison</Label>
                <Select value={form.trip_id || "none"} onValueChange={(v) => setField("trip_id", v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Aucun —</SelectItem>
                    {trips.map((t) => <SelectItem key={t.id} value={t.id}>{t.title} {t.season ? `· ${t.season}` : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Dates du voyage</Label><Input value={form.preferred_dates} onChange={(e) => setField("preferred_dates", e.target.value)} placeholder="ex: 12–22 oct." /></div>
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
            <Select value="" onValueChange={addExtra}>
              <SelectTrigger><SelectValue placeholder="Ajouter une activité…" /></SelectTrigger>
              <SelectContent>
                {catalog.filter((e) => !items.some((i) => i.extra_id === e.id)).map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.name} · {fmtMAD(e.price_mad)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                <Label className="text-xs">Mode de paiement</Label>
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
              <div className="col-span-2 flex items-center gap-2">
                <input id="usecomp" type="checkbox" checked={form.use_computed} onChange={(e) => setField("use_computed", e.target.checked)} />
                <Label htmlFor="usecomp" className="text-xs cursor-pointer">Utiliser le total calculé automatiquement</Label>
              </div>
              {!form.use_computed && (
                <div>
                  <Label className="text-xs">Total (MAD)</Label>
                  <Input type="number" value={form.total_amount_mad} onChange={(e) => setField("total_amount_mad", e.target.value)} />
                </div>
              )}
              <div>
                <Label className="text-xs">Montant déjà payé (MAD)</Label>
                <Input type="number" value={form.paid_amount_mad} onChange={(e) => setField("paid_amount_mad", e.target.value)} />
              </div>
            </div>
            <div className="mt-3 rounded-lg bg-secondary/50 p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Total voyage ({pax} pax × {fmtMAD(basePrice)})</span><span>{fmtMAD(tripTotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Total extras</span><span>{fmtMAD(extrasTotal)}</span></div>
              <div className="flex justify-between font-medium"><span>Total général</span><span>{fmtMAD(total)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Acompte demandé (25 000 MAD × {pax})</span><span>{fmtMAD(deposit)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Déjà payé</span><span>{fmtMAD(paid)}</span></div>
              <div className="flex justify-between font-semibold"><span>Reste à payer</span><span>{fmtMAD(remaining)}</span></div>
            </div>
          </section>

          <section>
            <h3 className="font-display text-sm uppercase tracking-wide text-muted-foreground mb-3">Notes internes</h3>
            <Textarea rows={3} value={form.message} onChange={(e) => setField("message", e.target.value)} placeholder="Note interne ou message du client" />
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Annuler</Button>
          <Button onClick={create} disabled={busy}>{busy ? "Création…" : "Créer la réservation"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}