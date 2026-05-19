import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Clock3, MapPin, Minus, Plus, Plane, Hotel, Users, BedDouble, Gift, Sparkles, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Seo } from "@/components/Seo";
import { fmtDate } from "@/lib/format";
import { useExtras, fmtExtraPrice } from "@/hooks/useExtras";
import { useRecaptcha } from "@/hooks/useRecaptcha";

type HotelKey = "modern" | "ryokan";
type RoomKey = "single" | "double" | "triple";

type TripRow = {
  id: string;
  title: string;
  slug: string;
  season: string | null;
  start_date: string | null;
  end_date: string | null;
  duration_days: number | null;
  short_description: string | null;
  base_price_mad: number;
};

const HOTEL_SUPPLEMENT: Record<HotelKey, number> = { modern: 0, ryokan: 2500 };
const SINGLE_SUPPLEMENT_MAD = 15000;
const TRIPLE_DISCOUNT_PER_PERSON_MAD = 1000;
const CHILD_DISCOUNT_MAD = 3000;

const fmt = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n)) + " MAD";

const Booking = () => {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState(1);
  const [tripsList, setTripsList] = useState<TripRow[]>([]);
  const [tripId, setTripId] = useState<string>("");
  const [tripLocked, setTripLocked] = useState(false);
  const [hotel, setHotel] = useState<HotelKey>("modern");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [room, setRoom] = useState<RoomKey>("double");
  const [extras, setExtras] = useState<Record<string, number>>({});
  const { extras: extrasList } = useExtras();
  const [info, setInfo] = useState({ name: "", email: "", phone: "", city: "", notes: "" });
  const [done, setDone] = useState(false);
  const [returning, setReturning] = useState<{ trips: number; tier: string; reward?: string } | null>(null);
  const { ready: captchaReady, executeRecaptcha, verify: verifyRecaptcha } = useRecaptcha();
  const [submitting, setSubmitting] = useState(false);

  // Load trips from admin (open or completed) — runs once
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("trips")
        .select("id,title,slug,season,start_date,end_date,duration_days,short_description,base_price_mad")
        .in("status", ["open", "completed"])
        .order("start_date", { ascending: true, nullsFirst: false });
      setTripsList((data ?? []) as TripRow[]);
    })();
  }, []);

  // Pre-select trip from URL (?trip=slug); falls back to first available
  useEffect(() => {
    if (!tripsList.length) return;
    const requestedTripSlug = searchParams.get("trip");
    const matchedTrip = requestedTripSlug
      ? tripsList.find((row) => row.slug === requestedTripSlug)
      : null;
    if (matchedTrip) {
      setTripId(matchedTrip.id);
      setTripLocked(true);
      setStep((s) => (s < 2 ? 2 : s));
    } else if (!tripId) {
      setTripId(tripsList[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripsList, searchParams]);

  // Detect returning customer when a valid email is entered
  useEffect(() => {
    const email = info.email.trim().toLowerCase();
    if (!email || !email.includes("@")) { setReturning(null); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("clients")
        .select("id, trips_completed, loyalty_tier, is_returning, client_rewards:client_rewards(label,status)" as any)
        .ilike("email", email)
        .maybeSingle();
      const c: any = data;
      if (c?.is_returning) {
        const reward = (c.client_rewards ?? []).find((r: any) => r.status === "available");
        setReturning({ trips: c.trips_completed, tier: c.loyalty_tier, reward: reward?.label });
      } else setReturning(null);
    }, 500);
    return () => clearTimeout(t);
  }, [info.email]);

  const selectedTrip = tripsList.find((tr) => tr.id === tripId) ?? null;

  // If triple becomes invalid (total not a multiple of 3), fall back to double
  useEffect(() => {
    const totalPeople = adults + children;
    if (room === "triple" && (totalPeople < 3 || totalPeople % 3 !== 0)) {
      setRoom("double");
    }
  }, [adults, children, room]);

  const formatDates = (s: string | null, e: string | null) => {
    if (!s && !e) return "";
    if (s && e) return `${fmtDate(s)} → ${fmtDate(e)}`;
    return fmtDate(s ?? e);
  };
  const hotels: Record<HotelKey, { name: string; desc: string; supplement: number }> = {
    modern: { name: "Hôtel moderne (avec le groupe)", desc: "Confort international, sans supplément.", supplement: 0 },
    ryokan: { name: "Ryokan traditionnel", desc: "Auberge japonaise, futon & onsen. Supplément 2 500 MAD/pers.", supplement: 2500 },
  };
  const pricing = useMemo(() => {
    const base = selectedTrip?.base_price_mad ?? 0;
    const hotelSupp = HOTEL_SUPPLEMENT[hotel];
    // Per-person room adjustment: single +15000, triple -1000, double 0
    const roomAdj = room === "single" ? SINGLE_SUPPLEMENT_MAD : room === "triple" ? -TRIPLE_DISCOUNT_PER_PERSON_MAD : 0;
    const adultPrice = base + hotelSupp + roomAdj;
    // Child (3-11): adult price minus a flat 3000 MAD discount
    const childPrice = adultPrice - CHILD_DISCOUNT_MAD;
    const peopleTotal = adultPrice * adults + childPrice * children;
    const extrasTotal = extrasList.reduce((s, e) => s + (extras[e.id] || 0) * e.price_mad, 0);
    const total = peopleTotal + extrasTotal;
    const pax = adults + children;
    const deposit = pax * 25000;
    return { adultPrice, childPrice, peopleTotal, extrasTotal, total, deposit };
  }, [selectedTrip, hotel, room, adults, children, extras, extrasList]);

  const TOTAL_STEPS = 5;

  const minStep = tripLocked ? 2 : 1;
  const visibleTotal = tripLocked ? TOTAL_STEPS - 1 : TOTAL_STEPS;
  const visibleStep = tripLocked ? step - 1 : step;

  const next = () => setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  const prev = () => setStep((s) => Math.max(minStep, s - 1));

  const unlockTrip = () => {
    setTripLocked(false);
    setStep(1);
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      // reCAPTCHA: client → server verification
      let token = "";
      try { token = await executeRecaptcha("booking"); }
      catch { throw new Error("Vérification anti-spam indisponible. Rechargez la page."); }
      const check = await verifyRecaptcha(token, "booking");
      if (!check.ok) {
        throw new Error("Vérification anti-spam refusée. Merci de réessayer.");
      }

      const tripMeta = selectedTrip;
      const tripLabel = tripMeta
        ? (tripMeta.season || tripMeta.title) +
          (tripMeta.start_date ? ` — ${fmtDate(tripMeta.start_date)}` : "")
        : null;
      // Auto-add to CRM via SECURITY DEFINER RPC (anti-doublon email/phone)
      let clientId: string | null = null;
      try {
        const { data: upsertedId } = await supabase.rpc("upsert_client_from_booking" as any, {
          _name: info.name || "",
          _email: info.email || "",
          _phone: info.phone || "",
          _city: info.city || "",
        });
        clientId = (upsertedId as string) ?? null;
      } catch {
        clientId = null;
      }
      const newBookingId = crypto.randomUUID();
      const { error } = await supabase.from("bookings").insert({
        id: newBookingId,
        contact_name: info.name,
        contact_email: info.email,
        contact_phone: info.phone,
        contact_city: info.city,
        client_id: clientId,
        num_adults: adults,
        num_children: children,
        formula: hotel,
        room_type: room,
        trip_id: tripMeta?.id ?? null,
        preferred_dates: tripMeta ? formatDates(tripMeta.start_date, tripMeta.end_date) || tripMeta.season || tripMeta.title : null,
        message: info.notes,
        total_amount_mad: Math.round(pricing.total),
        status: "lead" as const,
        source: "website",
      });
      if (error) throw error;
      // Add chosen extras (priced from admin source of truth)
      const chosenExtras = extrasList.filter((e) => extras[e.id] > 0);
      if (chosenExtras.length) {
        await supabase.from("booking_extras").insert(chosenExtras.map((e) => ({
          booking_id: newBookingId,
          extra_id: e.id,
          name_snapshot: e.name,
          qty: extras[e.id],
          unit_price_mad: e.price_mad,
        })));
      }
      void supabase.functions.invoke("send-admin-notification", {
        body: { event_type: "booking_created", booking_id: newBookingId },
      }).then(({ error }) => {
        if (error) console.warn("admin booking notification failed", error);
      });
      setDone(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) {
      toast.error(e.message ?? "Erreur lors de l'envoi");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="container-app py-32 max-w-2xl text-center">
        <div className="w-16 h-16 mx-auto mb-8 rounded-2xl bg-gradient-vermillion text-accent-foreground flex items-center justify-center font-display text-2xl shadow-cta">✓</div>
        <h1 className="font-display text-5xl md:text-6xl mb-6">{t("booking.success.title")}</h1>
        <p className="text-foreground/70 text-lg leading-relaxed mb-10">{t("booking.success.body")}</p>
        <button onClick={() => { setDone(false); setStep(1); }} className="inline-flex items-center gap-2 border border-foreground px-6 py-3 hover:bg-foreground hover:text-background transition-all">
          {t("booking.success.reset")}
        </button>
      </div>
    );
  }

  return (
    <div className="container-app py-12 md:py-20">
      <Seo
        title="Réserver mon voyage au Japon — Composer votre séjour | lejapon.ma"
        description="Composez votre voyage au Japon en 2 minutes : dates, formule, chambre et options. Prix instantané, paiement sécurisé, départs depuis Casablanca."
        canonical="/reserver"
      />
      <div className="grid lg:grid-cols-12 gap-12 lg:items-start lg:pb-60">
        {/* FORM */}
        <div className="lg:col-span-7 xl:col-span-8">
          <p className="eyebrow mb-3">{t("booking.step")} {visibleStep} {t("booking.of")} {visibleTotal}</p>
          <h1 className="font-display text-4xl md:text-5xl mb-3">{t("booking.title")}</h1>
          <p className="text-foreground/70 mb-10">{t("booking.subtitle")}</p>

          {tripLocked && selectedTrip && (
            <div className="mb-8 flex items-center justify-between gap-3 border border-accent/40 bg-accent-soft/30 p-4">
              <div className="text-sm">
                <p className="eyebrow text-accent mb-1">Voyage sélectionné</p>
                <p className="font-medium">{selectedTrip.title}</p>
                <p className="text-foreground/70 text-xs mt-0.5">
                  {selectedTrip.season || formatDates(selectedTrip.start_date, selectedTrip.end_date)}
                </p>
              </div>
              <button
                type="button"
                onClick={unlockTrip}
                className="text-sm underline hover:text-accent shrink-0"
              >
                Modifier le voyage
              </button>
            </div>
          )}

          {returning && (
            <div className="mb-8 flex items-start gap-3 border border-accent/40 bg-accent-soft/30 p-4">
              <Sparkles className="w-5 h-5 text-accent shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium">Voyageur fidèle · {returning.trips} voyage{returning.trips > 1 ? "s" : ""}</p>
                <p className="text-foreground/70">
                  Heureux de vous revoir&nbsp;! {returning.reward
                    ? <>Une récompense vous attend&nbsp;: <strong>{returning.reward}</strong>. Notre équipe l'appliquera à votre devis.</>
                    : <>Notre équipe vous contactera avec un avantage exclusif.</>}
                </p>
              </div>
            </div>
          )}

          {/* progress */}
          <div className="flex gap-2 mb-12">
            {Array.from({ length: visibleTotal }).map((_, i) => (
              <div key={i} className={cn("h-0.5 flex-1 transition-all duration-500", i < visibleStep ? "bg-accent" : "bg-border")} />
            ))}
          </div>

          {/* top actions */}
          <div className="flex justify-between items-center mb-8">
            <button onClick={prev} disabled={step === minStep} className={cn(
              "inline-flex items-center gap-2 text-sm",
              step === minStep ? "opacity-30 cursor-not-allowed" : "hover:text-accent"
            )}>
              <ArrowLeft className="w-4 h-4" /> {t("cta.back")}
            </button>
            {step < TOTAL_STEPS ? (
              <button onClick={next} className="inline-flex items-center gap-2 bg-foreground text-background px-6 py-3 hover:bg-accent transition-all">
                {t("cta.continue")} <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button onClick={submit} disabled={!info.name || !info.email || submitting || !captchaReady}
                className="inline-flex items-center gap-2 bg-accent text-accent-foreground px-6 py-3 hover:bg-foreground transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                {submitting ? "…" : t("cta.confirm")} <Check className="w-4 h-4" />
              </button>
            )}
          </div>

          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3 }}>
              {step === 1 && (
                <div>
                  <h2 className="font-display text-2xl mb-6">{t("booking.s1.title")}</h2>
                  {tripsList.length === 0 ? (
                    <p className="text-foreground/60">Aucun départ disponible pour le moment. Revenez bientôt.</p>
                  ) : (
                    <div className="grid gap-3">
                      {tripsList.map((tr) => (
                        <button key={tr.id} onClick={() => setTripId(tr.id)} className={cn(
                          "text-start p-5 sm:p-6 border transition-all duration-300",
                          tripId === tr.id ? "border-accent bg-accent-soft/40" : "border-border hover:border-foreground/40"
                        )}>
                          <div className="flex items-baseline justify-between gap-3 mb-1">
                            <h3 className="font-display text-lg sm:text-xl leading-tight">{tr.title}</h3>
                            <span className="text-accent whitespace-nowrap shrink-0 sm:text-base font-bold text-3xl">{fmt(tr.base_price_mad)}</span>
                          </div>
                          <p className="text-xs eyebrow text-muted-foreground mb-2">
                            {tr.season || formatDates(tr.start_date, tr.end_date)}
                          </p>
                          <div className="flex flex-wrap gap-x-4 gap-y-2 mb-3 text-sm text-foreground/70">
                            {typeof tr.duration_days === "number" && tr.duration_days > 0 && (
                              <span className="inline-flex items-center gap-1.5">
                                <Clock3 className="w-4 h-4 text-accent" />
                                {tr.duration_days} jours
                              </span>
                            )}
                            {(tr.start_date || tr.end_date) && (
                              <span className="inline-flex items-center gap-1.5">
                                <CalendarDays className="w-4 h-4 text-accent" />
                                {formatDates(tr.start_date, tr.end_date)}
                              </span>
                            )}
                          </div>
                          {tr.short_description && (
                            <p className="text-sm text-foreground/70">{tr.short_description}</p>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {step === 2 && (
                <div>
                  <h2 className="font-display text-2xl mb-2">Quel hôtel à Kyoto ?</h2>
                  <p className="text-sm text-foreground/70 mb-6">Choisissez votre hébergement pour l'étape de Kyoto.</p>
                  <div className="grid md:grid-cols-2 gap-3">
                    {(Object.keys(hotels) as HotelKey[]).map((k) => (
                      <button key={k} onClick={() => setHotel(k)} className={cn(
                        "text-start p-6 border transition-all min-h-[180px] flex flex-col",
                        hotel === k ? "border-accent bg-accent-soft/40" : "border-border hover:border-foreground/40"
                      )}>
                        <h3 className="font-display text-xl mb-2">{hotels[k].name}</h3>
                        <p className="text-sm text-foreground/70 flex-1">{hotels[k].desc}</p>
                        <p className="text-xs eyebrow mt-4 text-accent">
                          {hotels[k].supplement === 0 ? "Sans supplément" : `+${fmt(hotels[k].supplement)} / pers.`}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {step === 3 && (
                <div>
                  <h2 className="font-display text-2xl mb-6">{t("booking.s3.title")}</h2>
                  <div className="grid sm:grid-cols-2 gap-4 mb-8">
                    <Counter label={t("booking.s3.adults")} value={adults} onChange={setAdults} min={1} />
                    <Counter label={t("booking.s3.children")} value={children} onChange={setChildren} min={0} />
                  </div>
                  <p className="text-xs text-foreground/60 mb-4">Réduction de {fmt(CHILD_DISCOUNT_MAD)} par enfant (3 à 11 ans).</p>
                  <p className="eyebrow mb-3">{t("booking.s3.room")}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {(["single", "double", "triple"] as RoomKey[]).map((r) => {
                      const totalPeople = adults + children;
                      const tripleDisabled = r === "triple" && (totalPeople < 3 || totalPeople % 3 !== 0);
                      return (
                        <button
                          key={r}
                          onClick={() => { if (!tripleDisabled) setRoom(r); }}
                          disabled={tripleDisabled}
                          title={tripleDisabled ? "Le nombre total de voyageurs doit être un multiple de 3" : undefined}
                          className={cn(
                            "py-4 px-2 border text-sm transition-all flex flex-col items-center gap-1",
                            room === r ? "border-accent bg-accent-soft/40" : "border-border hover:border-foreground/40",
                            tripleDisabled && "opacity-40 cursor-not-allowed hover:border-border"
                          )}
                        >
                          <span>{t(`booking.s3.${r}`)}</span>
                          {r === "single" && <span className="text-[10px] text-accent">+{fmt(SINGLE_SUPPLEMENT_MAD)}</span>}
                          {r === "triple" && <span className="text-[10px] text-accent">−{fmt(TRIPLE_DISCOUNT_PER_PERSON_MAD)}/pers.</span>}
                        </button>
                      );
                    })}
                  </div>
                  {adults === 1 && children === 0 && room !== "single" && (
                    <div className="mt-4 border border-accent/30 bg-accent-soft/30 p-4 text-sm text-foreground/80">
                      En choisissant la chambre double tout seul, vous acceptez de partager la chambre avec quelqu&apos;un. Pensez à inviter un ami ou une connaissance.
                    </div>
                  )}
                </div>
              )}

              {step === 4 && (
                <div>
                  <h2 className="font-display text-2xl mb-2">{t("booking.s4.title")}</h2>
                  <p className="eyebrow mb-6">{t("booking.s4.optional")}</p>
                  <div className="space-y-px bg-border">
                    {extrasList.length === 0 && (
                      <p className="bg-background p-4 text-sm text-foreground/60">Aucune activité disponible.</p>
                    )}
                    {extrasList.map((e) => (
                      <div key={e.id} className="bg-background p-4 sm:p-5 flex items-start gap-3 sm:gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-3">
                            <h3 className="font-display text-base sm:text-lg leading-tight">{e.name}</h3>
                            <span className="text-accent text-xs sm:text-sm whitespace-nowrap shrink-0">{fmtExtraPrice(e.price_mad)}</span>
                          </div>
                          {e.description && <p className="text-xs text-foreground/60 mt-1">{e.description}</p>}
                          {(() => {
                            const qty = extras[e.id] || 0;
                            const travelers = adults + children;
                            if (qty > 0 && travelers > 1 && qty < travelers) {
                              return (
                                <p className="text-xs text-accent/80 mt-2 italic">
                                  Vous avez sélectionné {travelers} voyageurs. Êtes-vous sûr de la quantité choisie pour cette option&nbsp;?
                                </p>
                              );
                            }
                            return null;
                          })()}
                        </div>
                        <div className="shrink-0 pt-0.5">
                          <Counter mini value={extras[e.id] || 0} onChange={(v) => setExtras({ ...extras, [e.id]: v })} min={0} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {step === 5 && (
                <div>
                  <h2 className="font-display text-2xl mb-6">{t("booking.s5.title")}</h2>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field label={t("booking.s5.name")} value={info.name} onChange={(v) => setInfo({ ...info, name: v })} />
                    <Field label={t("booking.s5.email")} type="email" value={info.email} onChange={(v) => setInfo({ ...info, email: v })} />
                    <Field label={t("booking.s5.phone")} value={info.phone} onChange={(v) => setInfo({ ...info, phone: v })} />
                    <Field label={t("booking.s5.city")} value={info.city} onChange={(v) => setInfo({ ...info, city: v })} />
                  </div>
                  <Field className="mt-4" label={t("booking.s5.notes")} multiline value={info.notes} onChange={(v) => setInfo({ ...info, notes: v })} />
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          <div className="flex justify-between items-center mt-12 pt-6 border-t border-border">
            <button onClick={prev} disabled={step === minStep} className={cn(
              "inline-flex items-center gap-2 text-sm",
              step === minStep ? "opacity-30 cursor-not-allowed" : "hover:text-accent"
            )}>
              <ArrowLeft className="w-4 h-4" /> {t("cta.back")}
            </button>
            {step < TOTAL_STEPS ? (
              <button onClick={next} className="inline-flex items-center gap-2 bg-foreground text-background px-6 py-3 hover:bg-accent transition-all">
                {t("cta.continue")} <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button onClick={submit} disabled={!info.name || !info.email || submitting || !captchaReady}
                className="inline-flex items-center gap-2 bg-accent text-accent-foreground px-6 py-3 hover:bg-foreground transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                {submitting ? "…" : t("cta.confirm")} <Check className="w-4 h-4" />
              </button>
            )}
          </div>
          <p className="text-xs text-foreground/50 mt-4">
            Protégé par reCAPTCHA — la{" "}
            <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-accent">politique</a>
            {" "}et les{" "}
            <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-accent">conditions</a>
            {" "}de Google s'appliquent.
          </p>
        </div>

        {/* SUMMARY */}
        <aside className="booking-summary-sticky lg:col-span-5 xl:col-span-4">
          <div>
            <div className="relative overflow-hidden bg-gradient-to-br from-secondary via-secondary to-background border border-border/60 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.25)]">
              {/* Decorative accent bar */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-accent via-accent/70 to-accent" />
              <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full bg-accent/10 blur-3xl pointer-events-none" />

              <div className="relative p-8">
                <div className="flex items-center gap-2 mb-6">
                  <Sparkles className="w-3.5 h-3.5 text-accent" />
                  <p className="eyebrow !mb-0 font-bold">{t("booking.summary.title")}</p>
                </div>

                <ul className="space-y-4 text-sm">
                  <SummaryItem icon={<Plane className="w-4 h-4" />} label={t("booking.summary.trip")} value={selectedTrip?.title ?? "—"} />
                  <SummaryItem icon={<Hotel className="w-4 h-4" />} label="Hôtel Kyoto" value={hotels[hotel].name} />
                  <SummaryItem icon={<Users className="w-4 h-4" />} label={t("booking.summary.travelers")} value={`${adults} + ${children}`} />
                  <SummaryItem icon={<BedDouble className="w-4 h-4" />} label={t("booking.s3.room")} value={t(`booking.s3.${room}`)} />
                  <SummaryItem icon={<Gift className="w-4 h-4" />} label={t("booking.summary.extras")} value={fmt(pricing.extrasTotal)} />
                </ul>

                <div className="relative my-7">
                  <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />
                </div>

                <div className="bg-background/60 backdrop-blur-sm border border-accent/20 p-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="eyebrow text-accent">{t("booking.summary.total")}</span>
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">TTC</span>
                  </div>
                  <div className="font-display text-4xl text-accent leading-none tabular-nums font-bold">
                    {fmt(pricing.total)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    <span className="tabular-nums">{fmt(pricing.adultPrice)}</span> {t("booking.summary.perPerson")}
                  </p>
                </div>

                <div className="mt-5 flex items-center justify-between gap-3 text-sm p-4 border border-dashed border-border/70">
                  <div className="flex items-center gap-2 text-foreground/70">
                    <Wallet className="w-4 h-4 text-accent" />
                    <span>{t("booking.summary.deposit")}</span>
                  </div>
                  <span className="font-display text-lg tabular-nums">{fmt(pricing.deposit)}</span>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

const Counter = ({ label, value, onChange, min = 0, mini }: { label?: string; value: number; onChange: (v: number) => void; min?: number; mini?: boolean }) => (
  <div className={cn(!mini && "border border-border p-4")}>
    {label && <p className="eyebrow mb-3">{label}</p>}
    <div className="flex items-center gap-3">
      <button onClick={() => onChange(Math.max(min, value - 1))} className="w-8 h-8 border border-border flex items-center justify-center hover:border-accent hover:text-accent transition-colors">
        <Minus className="w-3 h-3" />
      </button>
      <span className="w-6 text-center font-display text-lg">{value}</span>
      <button onClick={() => onChange(value + 1)} className="w-8 h-8 border border-border flex items-center justify-center hover:border-accent hover:text-accent transition-colors">
        <Plus className="w-3 h-3" />
      </button>
    </div>
  </div>
);

const Field = ({ label, value, onChange, type = "text", multiline, className }: { label: string; value: string; onChange: (v: string) => void; type?: string; multiline?: boolean; className?: string }) => (
  <label className={cn("block", className)}>
    <span className="eyebrow block mb-2">{label}</span>
    {multiline ? (
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3}
        className="w-full bg-background border border-border px-4 py-3 focus:outline-none focus:border-accent transition-colors resize-none" />
    ) : (
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full bg-background border border-border px-4 py-3 focus:outline-none focus:border-accent transition-colors" />
    )}
  </label>
);

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between gap-3">
    <span className="text-foreground/60">{label}</span>
    <span className="text-end font-medium">{value}</span>
  </div>
);

const SummaryItem = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => (
  <li className="flex items-start justify-between gap-4">
    <div className="flex items-center gap-2.5 text-foreground/60 min-w-0">
      <span className="text-accent/80 shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </div>
    <span className="text-end font-medium text-foreground truncate max-w-[60%]">{value}</span>
  </li>
);

export default Booking;
