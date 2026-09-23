import { useEffect, useMemo, useState } from "react";
import { CreditCard, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { fmtMAD } from "@/lib/format";
import { PAYMENT_METHOD_OPTIONS, normalisePaymentMethod } from "@/lib/payment-methods";
import { quoteAdjustmentsFromBooking, quoteTotalWithAdjustments } from "@/lib/quote-adjustments";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  bookingId?: string | null;
};

const today = () => new Date().toISOString().slice(0, 10);
const paymentStatuses = [
  { value: "received", label: "Reçu" },
  { value: "pending", label: "En attente" },
  { value: "refunded", label: "Remboursé" },
];

export function AdminPaymentDialog({ open, onOpenChange, onSaved, bookingId }: Props) {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [selectedBookingId, setSelectedBookingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    amount_mad: "",
    method: "bank_transfer",
    paid_at: today(),
    reference: "",
    status: "received",
    notes: "",
  });

  const loadBookings = async () => {
    let query = (supabase as any)
      .from("bookings")
      .select("id,reference,contact_name,contact_email,contact_phone,client_id,total_amount_mad,paid_amount_mad,quote_adjustments,metadata,status,created_at,trips:trip_id(title,season,start_date)");
    query = bookingId
      ? query.eq("id", bookingId)
      : query.order("created_at", { ascending: false }).limit(250);
    const { data, error } = await query;
    if (error) {
      toast.error(error.message);
      return;
    }
    setBookings(data ?? []);
    if (bookingId && (data ?? []).some((booking: any) => booking.id === bookingId)) {
      setSelectedBookingId(bookingId);
    }
  };

  useEffect(() => {
    if (open) void loadBookings();
  }, [open, bookingId]);

  const filteredBookings = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return bookings;
    return bookings.filter((booking) => [
      booking.reference,
      booking.contact_name,
      booking.contact_email,
      booking.contact_phone,
      booking.trips?.title,
      booking.trips?.season,
    ].some((value) => String(value ?? "").toLowerCase().includes(needle)));
  }, [bookings, query]);

  const selectedBooking = bookings.find((booking) => booking.id === selectedBookingId) ?? null;
  const selectedBookingTotal = selectedBooking
    ? quoteTotalWithAdjustments(Number(selectedBooking.total_amount_mad || 0), quoteAdjustmentsFromBooking(selectedBooking))
    : 0;

  const reset = () => {
    setQuery("");
    setSelectedBookingId(bookingId ?? "");
    setDraft({
      amount_mad: "",
      method: "bank_transfer",
      paid_at: today(),
      reference: "",
      status: "received",
      notes: "",
    });
  };

  const syncBookingPaidAmount = async (bookingId: string) => {
    const { data: payments, error } = await supabase
      .from("payments")
      .select("amount_mad,status")
      .eq("booking_id", bookingId);
    if (error) throw error;
    const paid = (payments ?? [])
      .filter((payment) => ["received", "paid"].includes(String(payment.status)))
      .reduce((sum, payment) => sum + Number(payment.amount_mad || 0), 0);
    const { error: updateError } = await supabase.from("bookings").update({ paid_amount_mad: paid }).eq("id", bookingId);
    if (updateError) throw updateError;
  };

  const insertPayment = async (payload: Record<string, unknown>) => {
    const withClient = await (supabase as any).from("payments").insert(payload).select("id").single();
    if (!withClient.error) return withClient;
    if (!/client_id/i.test(withClient.error.message ?? "")) return withClient;
    const { client_id, ...fallbackPayload } = payload;
    return (supabase as any).from("payments").insert(fallbackPayload).select("id").single();
  };

  const save = async () => {
    if (!selectedBooking) {
      toast.error("Veuillez sélectionner une réservation.");
      return;
    }
    const amount = Number(draft.amount_mad);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Veuillez saisir un montant valide.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        booking_id: selectedBooking.id,
        client_id: selectedBooking.client_id ?? null,
        amount_mad: amount,
        method: normalisePaymentMethod(draft.method),
        paid_at: draft.paid_at || today(),
        reference: draft.reference.trim() || null,
        status: draft.status,
        notes: draft.notes.trim() || null,
        recorded_by: user?.id ?? null,
      };
      const { data, error } = await insertPayment(payload);
      if (error) throw error;
      await syncBookingPaidAmount(selectedBooking.id);
      if (data?.id && ["received", "paid"].includes(String(draft.status))) {
        void supabase.functions.invoke("send-admin-notification", {
          body: { type: "payment", payload: { payment_id: data.id } },
        });
      }
      toast.success("Paiement enregistré.");
      reset();
      onOpenChange(false);
      onSaved?.();
    } catch (error: any) {
      toast.error(error?.message ?? "Impossible d’enregistrer le paiement.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => { onOpenChange(value); if (!value) reset(); }}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-2xl overflow-y-auto rounded-2xl p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Ajouter paiement</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!bookingId && <div>
            <Label>Réservation</Label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-9"
                placeholder="Rechercher par référence, client ou voyage"
              />
            </div>
            <Select value={selectedBookingId} onValueChange={setSelectedBookingId}>
              <SelectTrigger className="mt-2">
                <SelectValue placeholder="Sélectionner une réservation" />
              </SelectTrigger>
              <SelectContent>
                {filteredBookings.map((booking) => {
                  const total = quoteTotalWithAdjustments(Number(booking.total_amount_mad || 0), quoteAdjustmentsFromBooking(booking));
                  const remaining = total - Number(booking.paid_amount_mad || 0);
                  return (
                    <SelectItem key={booking.id} value={booking.id}>
                      {booking.reference} — {booking.contact_name} — {booking.trips?.title || "Voyage"} · reste {fmtMAD(Math.max(0, remaining))}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {selectedBooking && (
              <div className="mt-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">{selectedBooking.contact_name} · {selectedBooking.reference}</p>
                <p>{selectedBooking.trips?.title || "Voyage non renseigné"} · payé {fmtMAD(selectedBooking.paid_amount_mad)} / {fmtMAD(selectedBooking.total_amount_mad)}</p>
              </div>
            )}
          </div>}

          {bookingId && selectedBooking && (
            <div className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-muted/30 p-3 text-sm">
              <div><p className="text-xs text-muted-foreground">Total</p><p className="font-semibold">{fmtMAD(selectedBookingTotal)}</p></div>
              <div><p className="text-xs text-muted-foreground">Déjà payé</p><p className="font-semibold text-emerald-700">{fmtMAD(selectedBooking.paid_amount_mad)}</p></div>
              <div><p className="text-xs text-muted-foreground">Reste</p><p className="font-semibold text-orange-700">{fmtMAD(Math.max(0, selectedBookingTotal - Number(selectedBooking.paid_amount_mad || 0)))}</p></div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Montant MAD</Label>
              <Input className="min-h-11" type="number" min={0} value={draft.amount_mad} onChange={(event) => setDraft((current) => ({ ...current, amount_mad: event.target.value }))} />
            </div>
            <div>
              <Label>Date paiement</Label>
              <Input className="min-h-11" type="date" value={draft.paid_at} onChange={(event) => setDraft((current) => ({ ...current, paid_at: event.target.value }))} />
            </div>
            <div>
              <Label>Méthode</Label>
              <Select value={normalisePaymentMethod(draft.method)} onValueChange={(value) => setDraft((current) => ({ ...current, method: value }))}>
                <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHOD_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Statut</Label>
              <Select value={draft.status} onValueChange={(value) => setDraft((current) => ({ ...current, status: value }))}>
                <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {paymentStatuses.map((status) => <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Référence</Label>
              <Input className="min-h-11" value={draft.reference} onChange={(event) => setDraft((current) => ({ ...current, reference: event.target.value }))} placeholder="Référence virement, reçu, transaction..." />
            </div>
            <div className="sm:col-span-2">
              <Label>Notes</Label>
              <Textarea rows={3} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} />
            </div>
          </div>
        </div>

        <DialogFooter className="sticky bottom-0 -mx-4 border-t bg-background px-4 pb-[env(safe-area-inset-bottom)] pt-3 sm:-mx-6 sm:px-6">
          <Button className="min-h-11" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Annuler</Button>
          <Button className="min-h-11" onClick={save} disabled={saving}>
            <CreditCard className="h-4 w-4" /> {saving ? "Enregistrement…" : "Enregistrer le paiement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
