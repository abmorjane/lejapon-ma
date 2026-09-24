import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, BedDouble, CalendarDays, CreditCard, ExternalLink, Hotel, Pencil, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { fmtMAD } from "@/lib/format";
import { publicHotelLabel, publicRoomLabel } from "@/lib/booking-options";
import { quoteAdjustmentsFromBooking, quoteTotalWithAdjustments } from "@/lib/quote-adjustments";
import { StatusBadge } from "./StatusBadge";
import { EditBookingDialog } from "./EditBookingDialog";
import { AdminPaymentDialog } from "./AdminPaymentDialog";
import { bookingStatusLabel } from "@/admin/lib/booking-status";
import { useOverlayHistory } from "@/hooks/useOverlayHistory";
import { AdminOverlayCloseButton } from "./AdminOverlayCloseButton";

type Props = {
  booking: any | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
};

const activeTask = (item: any) => !["completed", "cancelled"].includes(String(item.status));
const overdueTask = (item: any) => activeTask(item) && item.deadline && new Date(item.deadline).getTime() < Date.now();

export function BookingQuickViewSheet({ booking, open, onOpenChange, onChanged }: Props) {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<any>(null);
  const [extras, setExtras] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const overlay = useOverlayHistory(open, () => onOpenChange(false), "booking-quick-view");

  const load = async () => {
    if (!booking?.id) return;
    setLoading(true);
    const [{ data: bookingRow, error }, { data: extraRows }] = await Promise.all([
      supabase.from("bookings").select("*,trips(title,season,start_date,end_date)").eq("id", booking.id).maybeSingle(),
      supabase.from("booking_extras").select("*").eq("booking_id", booking.id),
    ]);
    if (error || !bookingRow) {
      toast.error(error?.message ?? "Impossible de charger la réservation.");
      setLoading(false);
      return;
    }
    setDetail(bookingRow);
    setExtras(extraRows ?? []);

    const { data: checklists } = await (supabase as any)
      .from("operation_checklists")
      .select("id")
      .eq("booking_id", booking.id);
    const checklistIds = (checklists ?? []).map((row: any) => row.id);
    if (checklistIds.length) {
      const { data: itemRows } = await (supabase as any)
        .from("operation_checklist_items")
        .select("id,status,priority,deadline,title")
        .in("checklist_id", checklistIds);
      setTasks(itemRows ?? []);
    } else {
      setTasks([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (open) void load();
  }, [open, booking?.id]);

  const removeBooking = async () => {
    const current = detail ?? booking;
    if (!current) return;
    if (!confirm(`Supprimer définitivement la réservation ${current.reference} de ${current.contact_name} ?`)) return;
    await supabase.from("payments").delete().eq("booking_id", current.id);
    await supabase.from("booking_extras").delete().eq("booking_id", current.id);
    const { error } = await supabase.from("bookings").delete().eq("id", current.id);
    if (error) return toast.error(error.message);
    toast.success("Réservation supprimée.");
    overlay.requestClose(onChanged);
  };

  const current = detail ?? booking;
  const travelers = Number(current?.num_adults || 0) + Number(current?.num_children || 0);
  const quoteTotal = current ? quoteTotalWithAdjustments(Number(current.total_amount_mad || 0), quoteAdjustmentsFromBooking(current)) : 0;
  const remaining = Math.max(0, quoteTotal - Number(current?.paid_amount_mad || 0));
  const overdue = tasks.filter(overdueTask).length;
  const critical = tasks.filter((item) => activeTask(item) && item.priority === "critical").length;
  const hotel = current ? publicHotelLabel(current.formula) : "—";
  const room = current ? publicRoomLabel(current.room_type) : "—";

  return (
    <>
      <Sheet open={open} onOpenChange={overlay.handleOpenChange}>
        <SheetContent className="w-full max-w-none p-0 [&>button:last-child]:hidden sm:w-[min(680px,92vw)] sm:max-w-none">
          <div className="flex min-h-full flex-col">
            <SheetHeader className="border-b px-4 pb-4 pt-[calc(1rem+env(safe-area-inset-top))] sm:px-6 sm:pt-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 text-left">
                  <SheetTitle className="truncate font-display text-xl">{current?.contact_name ?? "Réservation"}</SheetTitle>
                  <SheetDescription>{current?.reference ?? "—"} · {current?.trips?.title ?? booking?.trips?.title ?? "Voyage non renseigné"}</SheetDescription>
                  {current?.status && <div className="mt-2"><StatusBadge value={current.status} label={bookingStatusLabel(current.status)} /></div>}
                </div>
                <AdminOverlayCloseButton onClick={() => overlay.requestClose()} />
              </div>
            </SheetHeader>

            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:px-6 sm:pb-6">
              {loading && !detail ? <p className="text-sm text-muted-foreground">Chargement…</p> : null}

              {(overdue > 0 || critical > 0) && (
                <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-900">
                  <AlertTriangle className="h-4 w-4" />
                  {overdue > 0 ? `${overdue} tâche${overdue > 1 ? "s" : ""} en retard` : `${critical} tâche${critical > 1 ? "s" : ""} critique`}
                </div>
              )}

              <section className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div className="rounded-xl bg-muted/50 p-3"><CalendarDays className="mb-2 h-4 w-4 text-muted-foreground" /><p className="text-xs text-muted-foreground">Voyage</p><p className="font-medium">{current?.trips?.title ?? "—"}</p></div>
                <div className="rounded-xl bg-muted/50 p-3"><Users className="mb-2 h-4 w-4 text-muted-foreground" /><p className="text-xs text-muted-foreground">Voyageurs</p><p className="font-medium">{travelers}</p></div>
                <div className="rounded-xl bg-muted/50 p-3"><Hotel className="mb-2 h-4 w-4 text-muted-foreground" /><p className="text-xs text-muted-foreground">Hébergement</p><p className="font-medium">{hotel}</p></div>
                <div className="rounded-xl bg-muted/50 p-3"><BedDouble className="mb-2 h-4 w-4 text-muted-foreground" /><p className="text-xs text-muted-foreground">Chambre</p><p className="font-medium">{room}</p></div>
              </section>

              <section className="grid grid-cols-3 gap-2 rounded-2xl border border-border p-3 text-sm">
                <div><p className="text-xs text-muted-foreground">Total</p><p className="font-semibold">{fmtMAD(quoteTotal)}</p></div>
                <div><p className="text-xs text-muted-foreground">Payé</p><p className="font-semibold text-emerald-700">{fmtMAD(current?.paid_amount_mad)}</p></div>
                <div><p className="text-xs text-muted-foreground">Reste</p><p className="font-semibold text-orange-700">{fmtMAD(remaining)}</p></div>
              </section>

              <section>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Activités et extras</p>
                {extras.length ? (
                  <div className="flex flex-wrap gap-2">
                    {extras.slice(0, 6).map((extra) => <Badge key={extra.id} variant="secondary">{extra.name_snapshot} × {extra.qty}</Badge>)}
                  </div>
                ) : <p className="text-sm text-muted-foreground">Aucun extra.</p>}
              </section>

              <div className="grid gap-2 sm:grid-cols-3">
                <Button
                  className="min-h-11"
                  onClick={() => current?.id && overlay.requestClose(() => navigate(`/admin/bookings/${current.id}`))}
                >
                  <ExternalLink className="h-4 w-4" /> Ouvrir dossier
                </Button>
                <Button variant="outline" className="min-h-11" onClick={() => setEditOpen(true)}><Pencil className="h-4 w-4" /> Modifier</Button>
                <Button className="min-h-11 bg-emerald-700 hover:bg-emerald-800" onClick={() => setPaymentOpen(true)}><CreditCard className="h-4 w-4" /> Ajouter paiement</Button>
              </div>

              <Button variant="ghost" className="min-h-11 text-destructive hover:text-destructive" onClick={removeBooking}>
                <Trash2 className="h-4 w-4" /> Supprimer la réservation
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {current && (
        <EditBookingDialog open={editOpen} onOpenChange={setEditOpen} booking={current} extras={extras} onSaved={() => { void load(); onChanged?.(); }} />
      )}
      <AdminPaymentDialog open={paymentOpen} onOpenChange={setPaymentOpen} bookingId={current?.id} onSaved={() => { void load(); onChanged?.(); }} />
    </>
  );
}
