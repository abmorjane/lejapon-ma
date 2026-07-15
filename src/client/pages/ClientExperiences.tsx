import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Seo } from "@/components/Seo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtMAD } from "@/lib/format";
import { useExtras } from "@/hooks/useExtras";
import { addClientBookingExtra, loadBookingExtras, type ClientBookingExtra } from "../lib/client-portal";
import { useClientPortalData } from "../lib/useClientPortalData";

export default function ClientExperiences() {
  const { bookings, upcomingBooking, loading, refresh } = useClientPortalData();
  const { extras, loading: extrasLoading } = useExtras({ enabled: true });
  const [bookingId, setBookingId] = useState("");
  const [selectedExtras, setSelectedExtras] = useState<ClientBookingExtra[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const activeBooking = useMemo(
    () => bookings.find((booking) => booking.id === bookingId) ?? upcomingBooking ?? bookings[0] ?? null,
    [bookings, bookingId, upcomingBooking],
  );

  useEffect(() => {
    if (!bookingId && activeBooking?.id) setBookingId(activeBooking.id);
  }, [activeBooking?.id, bookingId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeBooking?.id) {
        setSelectedExtras([]);
        return;
      }
      const rows = await loadBookingExtras(activeBooking.id).catch(() => []);
      if (!cancelled) setSelectedExtras(rows);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeBooking?.id]);

  const selectedTotal = selectedExtras.reduce((sum, extra) => sum + Number(extra.qty || 0) * Number(extra.unit_price_mad || 0), 0);

  const addExtra = async (extraId: string) => {
    if (!activeBooking) return toast.error("Sélectionnez une réservation.");
    const qty = Math.max(1, Number(quantities[extraId] || 1));
    setBusyId(extraId);
    try {
      await addClientBookingExtra({ bookingId: activeBooking.id, extraId, quantity: qty });
      toast.success("Expérience ajoutée à votre réservation.");
      setQuantities((current) => ({ ...current, [extraId]: 1 }));
      const rows = await loadBookingExtras(activeBooking.id).catch(() => []);
      setSelectedExtras(rows);
      await refresh();
    } catch (error: any) {
      toast.error(error?.message ?? "Impossible d’ajouter cette expérience.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <Seo title="Mes expériences — LeJapon.ma" description="Expériences optionnelles disponibles pour votre voyage." noindex />
      <div>
        <h1 className="font-display text-3xl">Mes expériences</h1>
        <p className="mt-2 text-muted-foreground">Des expériences spéciales, 100 % optionnelles.</p>
      </div>

      <Card className="rounded-2xl border-red-100 bg-red-50">
        <CardContent className="p-5 text-sm leading-6 text-red-950">
          Votre voyage est déjà très complet. Ces expériences ne sont pas nécessaires pour profiter pleinement du programme. Elles sont proposées uniquement pour vous permettre d’ajouter des moments particuliers selon vos envies.
        </CardContent>
      </Card>

      {loading ? <p className="text-sm text-muted-foreground">Chargement…</p> : null}
      {!loading && bookings.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="p-8 text-center">
            <Sparkles className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <h2 className="font-display text-2xl">Aucune réservation liée</h2>
            <p className="mt-2 text-muted-foreground">Les expériences sont disponibles après réservation.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {bookings.length > 1 && (
            <div className="max-w-md">
              <Select value={activeBooking?.id ?? ""} onValueChange={setBookingId}>
                <SelectTrigger><SelectValue placeholder="Choisir une réservation" /></SelectTrigger>
                <SelectContent>
                  {bookings.map((booking) => (
                    <SelectItem key={booking.id} value={booking.id}>{booking.reference} · {booking.trips?.title || "Voyage Japon"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-[330px_1fr]">
            <aside className="space-y-4">
              <Card className="rounded-2xl">
                <CardHeader><CardTitle className="font-display text-xl">Voyage réservé</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="font-medium">{activeBooking?.trips?.title || activeBooking?.trips?.season || "Voyage Japon"}</p>
                    <p className="text-sm text-muted-foreground">{activeBooking?.reference}</p>
                  </div>
                  {activeBooking?.is_booking_owner ? (
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">Prix voyage</span>
                      <span className="font-semibold">{fmtMAD(activeBooking?.total_amount_mad)}</span>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Les montants du voyage sont visibles uniquement par le contact principal.</p>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-2xl">
                <CardHeader><CardTitle className="font-display text-xl">Expériences sélectionnées</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {selectedExtras.length === 0 ? <p className="text-sm text-muted-foreground">Aucune expérience ajoutée.</p> : selectedExtras.map((extra) => (
                    <div key={extra.id} className="flex justify-between gap-3 text-sm">
                      <span>{extra.name_snapshot} × {extra.qty}</span>
                      <span className="font-medium">{fmtMAD(extra.qty * extra.unit_price_mad)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t pt-3 font-semibold">
                    <span>Total expériences</span>
                    <span>{fmtMAD(selectedTotal)}</span>
                  </div>
                  {selectedExtras.length > 0 && (
                    <p className="text-xs text-muted-foreground">Pour modifier une expérience déjà confirmée ou payée, contactez votre conseiller.</p>
                  )}
                </CardContent>
              </Card>
            </aside>

            <section className="grid gap-4 md:grid-cols-2">
              {extrasLoading ? <p className="text-sm text-muted-foreground">Chargement des expériences…</p> : null}
              {!extrasLoading && extras.map((extra) => {
                const alreadySelected = selectedExtras.some((item) => item.extra_id === extra.id);
                return (
                  <Card key={extra.id} className="overflow-hidden rounded-2xl shadow-sm">
                    {extra.image_url && <img src={extra.image_url} alt={extra.alt_text || extra.name} className="h-44 w-full object-cover" loading="lazy" />}
                    <CardContent className="space-y-4 p-4">
                      <div>
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          {extra.city && <Badge variant="outline">{extra.city}</Badge>}
                          {alreadySelected && <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" /> Sélectionnée</Badge>}
                        </div>
                        <h2 className="font-display text-xl">{extra.name}</h2>
                        {extra.description && <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">{extra.description}</p>}
                      </div>
                      <div className="flex items-end justify-between gap-3">
                        <div>
                          <p className="text-xs text-muted-foreground">Prix</p>
                          <p className="font-semibold text-red-700">{fmtMAD(extra.price_mad)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={1}
                            className="w-20"
                            value={quantities[extra.id] ?? 1}
                            onChange={(event) => setQuantities((current) => ({ ...current, [extra.id]: Math.max(1, Number(event.target.value || 1)) }))}
                          />
                          <Button onClick={() => addExtra(extra.id)} disabled={busyId === extra.id || !activeBooking}>
                            <Plus className="h-4 w-4" />
                            Ajouter
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
