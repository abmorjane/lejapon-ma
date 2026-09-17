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
import { PAYMENT_METHOD_OPTIONS } from "@/lib/payment-methods";
import {
  bookingMetadata,
  getBookingPricingBreakdown,
  resolveBookingTripUnitPrice,
} from "@/lib/booking-pricing";
import { quoteAdjustmentsFromBooking } from "@/lib/quote-adjustments";
import { calculateCommercialDocumentTotals } from "@/lib/commercial-documents";

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
  const [paymentMethod, setPaymentMethod] = useState<string>("bank_transfer");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const nextItems = (initialExtras ?? []).map((e: any) => ({
      id: e.id, extra_id: e.extra_id, name_snapshot: e.name_snapshot, qty: e.qty, unit_price_mad: Number(e.unit_price_mad),
    }));
    setItems(nextItems);
    void (async () => {
      const { data } = await supabase.from("trips").select("id,title,season,base_price_mad,promo_percent").is("archived_at", null).order("title");
      const nextTrips = [...(data ?? [])];
      if (booking.trip_id && !nextTrips.some((trip) => trip.id === booking.trip_id)) {
        const { data: currentTrip } = await supabase
          .from("trips")
          .select("id,title,season,base_price_mad,promo_percent")
          .eq("id", booking.trip_id)
          .maybeSingle();
        if (currentTrip) nextTrips.push(currentTrip);
      }
      setTrips(nextTrips);
      const selectedTrip = nextTrips.find((t) => t.id === booking.trip_id);
      const tripUnitPrice = resolveBookingTripUnitPrice({ booking, trip: selectedTrip, extras: nextItems });
      const metadata = bookingMetadata(booking);
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
        trip_unit_price_per_person_mad: Math.round(tripUnitPrice),
        deposit_type: metadata.deposit_type ?? booking.deposit_type ?? "fixed",
        deposit_value: metadata.deposit_value ?? booking.deposit_value ?? 25000,
        deposit_is_per_person: metadata.deposit_is_per_person ?? booking.deposit_is_per_person ?? true,
        total_amount_mad: Number(booking.total_amount_mad ?? 0),
        paid_amount_mad: Number(booking.paid_amount_mad ?? 0),
      });
    })();
  }, [open, booking?.id]);

  const trip = trips.find((t) => t.id === form.trip_id);
  const pax = Number(form.num_adults || 0) + Number(form.num_children || 0);
  const quoteAdjustments = quoteAdjustmentsFromBooking({ ...booking, metadata: bookingMetadata(booking) });
  const pricingBooking = {
    ...booking,
    num_adults: Number(form.num_adults || 0),
    num_children: Number(form.num_children || 0),
    total_amount_mad: Number(form.total_amount_mad || 0),
    paid_amount_mad: Number(form.paid_amount_mad || 0),
    deposit_type: form.deposit_type === "percentage" ? "percentage" : "fixed",
    deposit_value: Number(form.deposit_value || 0),
    deposit_is_per_person: form.deposit_type === "percentage" ? false : form.deposit_is_per_person !== false,
    metadata: {
      ...bookingMetadata(booking),
      trip_unit_price_per_person_mad: Number(form.trip_unit_price_per_person_mad || 0),
      deposit_type: form.deposit_type === "percentage" ? "percentage" : "fixed",
      deposit_value: Number(form.deposit_value || 0),
      deposit_is_per_person: form.deposit_type === "percentage" ? false : form.deposit_is_per_person !== false,
    },
  };
  const pricing = getBookingPricingBreakdown({
    booking: pricingBooking,
    trip,
    extras: items,
    quoteAdjustments,
  });
  const commercialTotals = calculateCommercialDocumentTotals({
    booking: pricingBooking,
    trip,
    extras: items,
    quoteAdjustments,
  });
  const computedTotal = pricing.calculatedBaseTotal;
  const remaining = commercialTotals.remainingAmount;

  const setField = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const setTripUnitPrice = (value: string) => {
    const unit = Number(value) || 0;
    setForm((current: any) => {
      const nextPax = Number(current.num_adults || 0) + Number(current.num_children || 0);
      const nextExtrasTotal = items.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.unit_price_mad || 0), 0);
      return {
        ...current,
        trip_unit_price_per_person_mad: value,
        total_amount_mad: Math.max(0, unit * nextPax + nextExtrasTotal),
      };
    });
  };

  const setSelectedTrip = (tripId: string) => {
    const nextTripId = tripId === "none" ? "" : tripId;
    const selectedTrip = trips.find((item) => item.id === nextTripId);
    const nextUnitPrice = Number(selectedTrip?.base_price_mad ?? form.trip_unit_price_per_person_mad ?? 0);
    setForm((current: any) => {
      const nextPax = Number(current.num_adults || 0) + Number(current.num_children || 0);
      const nextExtrasTotal = items.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.unit_price_mad || 0), 0);
      return {
        ...current,
        trip_id: nextTripId,
        trip_unit_price_per_person_mad: Math.round(nextUnitPrice),
        total_amount_mad: Math.max(0, nextUnitPrice * nextPax + nextExtrasTotal),
      };
    });
  };

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
      updates.deposit_type = updates.deposit_type === "percentage" ? "percentage" : "fixed";
      updates.deposit_value = Number(updates.deposit_value || 0);
      updates.deposit_is_per_person = updates.deposit_type === "percentage" ? false : updates.deposit_is_per_person !== false;
      updates.deposit_amount = commercialTotals.depositAmount;
      updates.deposit_amount_mad = commercialTotals.depositAmount;
      const nextTripUnitPrice = Number(updates.trip_unit_price_per_person_mad) || 0;
      delete updates.trip_unit_price_per_person_mad;
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

      const previousTripUnitPrice = resolveBookingTripUnitPrice({ booking, trip, extras: initialExtras });
      const tripPriceChanged = Math.round(previousTripUnitPrice) !== Math.round(nextTripUnitPrice);
      const nextMetadata = {
        ...bookingMetadata(booking),
        trip_unit_price_per_person_mad: nextTripUnitPrice,
        deposit_type: updates.deposit_type === "percentage" ? "percentage" : "fixed",
        deposit_value: Number(updates.deposit_value || 0),
        deposit_is_per_person: updates.deposit_type === "percentage" ? false : updates.deposit_is_per_person !== false,
        deposit_amount_calculated: commercialTotals.depositAmount,
        deposit_amount_mad: commercialTotals.depositAmount,
        ...(tripPriceChanged
          ? {
              trip_price_manually_overridden: true,
              trip_price_source: "admin_manual",
            }
          : {}),
      };
      updates.metadata = nextMetadata;

      if (tripPriceChanged) {
        audits.push({
          booking_id: booking.id,
          user_id: user?.id ?? null,
          user_email: user?.email ?? null,
          field: "Prix voyage par personne",
          old_value: fmtMAD(previousTripUnitPrice),
          new_value: fmtMAD(nextTripUnitPrice),
        });
      }

      const updateResult = await supabase.from("bookings").update(updates).eq("id", booking.id);
      if (updateResult.error) {
        const missingDepositColumns = /deposit_type|deposit_value|deposit_is_per_person|deposit_amount|deposit_amount_mad|schema cache|column/i.test(updateResult.error.message ?? "");
        if (!missingDepositColumns) throw updateResult.error;
        const { deposit_type, deposit_value, deposit_is_per_person, deposit_amount, deposit_amount_mad, ...fallbackUpdates } = updates;
        const fallbackResult = await supabase.from("bookings").update(fallbackUpdates).eq("id", booking.id);
        if (fallbackResult.error) throw fallbackResult.error;
      }

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
                <Select value={form.trip_id || "none"} onValueChange={setSelectedTrip}>
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
              <div>
                <Label className="text-xs">Prix voyage par personne (MAD)</Label>
                <Input
                  type="number"
                  min={0}
                  inputMode="decimal"
                  value={form.trip_unit_price_per_person_mad ?? ""}
                  onChange={(e) => setTripUnitPrice(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Total voyage</Label>
                <Input value={fmtMAD(pricing.tripTotal)} readOnly className="bg-secondary/40" />
              </div>
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
                    {PAYMENT_METHOD_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
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
              <div className="flex justify-between"><span className="text-muted-foreground">Prix voyage / personne</span><span className="font-medium">{fmtMAD(pricing.tripUnitPrice)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Nombre de personnes</span><span>{pax}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Total voyage</span><span>{fmtMAD(pricing.tripTotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Extras</span><span>{fmtMAD(pricing.extrasTotal)}</span></div>
              {(pricing.calculatedAdjustmentSummary.supplementsTotal > 0 || pricing.calculatedAdjustmentSummary.discountsTotal > 0) && (
                <>
                  <div className="flex justify-between"><span className="text-muted-foreground">Suppléments</span><span>+{fmtMAD(pricing.calculatedAdjustmentSummary.supplementsTotal)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Réductions</span><span>-{fmtMAD(pricing.calculatedAdjustmentSummary.discountsTotal)}</span></div>
                </>
              )}
              <div className="flex justify-between"><span className="text-muted-foreground">Total calculé</span><span className="font-medium">{fmtMAD(pricing.calculatedFinalTotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Total saisi</span><span className="font-medium">{fmtMAD(pricing.enteredFinalTotal)}</span></div>
              <div className="mt-3 grid gap-2 rounded-lg border border-border bg-background/70 p-3 sm:grid-cols-3">
                <div>
                  <Label className="text-xs">Mode acompte</Label>
                  <Select
                    value={form.deposit_type || "fixed"}
                    onValueChange={(value) => {
                      setForm((current: any) => ({
                        ...current,
                        deposit_type: value,
                        deposit_is_per_person: value === "percentage" ? false : current.deposit_is_per_person !== false,
                      }));
                    }}
                  >
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixed">Montant fixe</SelectItem>
                      <SelectItem value="percentage">Pourcentage</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">{form.deposit_type === "percentage" ? "Pourcentage" : "Montant MAD"}</Label>
                  <Input className="h-9" type="number" min={0} value={form.deposit_value ?? ""} onChange={(e) => setField("deposit_value", e.target.value)} />
                </div>
                <label className="flex items-center gap-2 pt-5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={form.deposit_type !== "percentage" && form.deposit_is_per_person !== false}
                    disabled={form.deposit_type === "percentage"}
                    onChange={(event) => setField("deposit_is_per_person", event.target.checked)}
                  />
                  Par personne
                </label>
              </div>
              <div className="flex justify-between"><span className="text-muted-foreground">{commercialTotals.depositLabel}</span><span>{fmtMAD(commercialTotals.depositAmount)}</span></div>
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
