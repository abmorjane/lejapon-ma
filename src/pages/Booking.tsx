import { memo, useCallback, useState, useMemo, useEffect, useRef, type ChangeEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Clock3, Loader2, MessageCircle, Minus, Plus, PhoneCall, Plane, Hotel, Users, BedDouble, Sparkles, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Seo } from "@/components/Seo";
import { fmtDate } from "@/lib/format";
import { useExtras, fmtExtraPrice } from "@/hooks/useExtras";
import { useRecaptcha } from "@/hooks/useRecaptcha";
import { trackEvent } from "@/lib/analytics";
import { findOrCreateClientForBooking } from "@/lib/crm-client";
import { useAgencySettings } from "@/hooks/useAgencySettings";
import {
  CHILD_DISCOUNT_MAD,
  HOTEL_SUPPLEMENT,
  PUBLIC_HOTEL_OPTIONS,
  SINGLE_SUPPLEMENT_MAD,
  TRIPLE_DISCOUNT_PER_PERSON_MAD,
  type PublicHotelKey,
  type PublicRoomKey,
} from "@/lib/booking-options";

type HotelKey = PublicHotelKey;
type RoomKey = PublicRoomKey;

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
  promo_percent?: number | null;
};

const fmt = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n)) + " MAD";

const WHATSAPP_FALLBACK = "212661800008";
const TOTAL_STEPS = 3;

const Booking = () => {
  const { t } = useTranslation();
  const agency = useAgencySettings();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState(1);
  const [tripsList, setTripsList] = useState<TripRow[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(true);
  const [tripId, setTripId] = useState<string>("");
  const [tripLocked, setTripLocked] = useState(false);
  const [hotel, setHotel] = useState<HotelKey>("modern");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [room, setRoom] = useState<RoomKey>("double");
  const [extras, setExtras] = useState<Record<string, number>>({});
  const [info, setInfo] = useState({ name: "", email: "", phone: "", city: "", notes: "" });
  const [done, setDone] = useState(false);
  const { extras: extrasList, loading: extrasLoading } = useExtras({ enabled: done });
  const [createdBookingId, setCreatedBookingId] = useState<string | null>(null);
  const [postBookingExtrasOpen, setPostBookingExtrasOpen] = useState(false);
  const [postBookingExtrasConfirmed, setPostBookingExtrasConfirmed] = useState(false);
  const [postBookingExtrasSkipped, setPostBookingExtrasSkipped] = useState(false);
  const [savingPostBookingExtras, setSavingPostBookingExtras] = useState(false);
  const [returning, setReturning] = useState<{ trips: number; tier: string; reward?: string } | null>(null);
  const { ready: captchaReady, executeRecaptcha, verify: verifyRecaptcha, enabled: recaptchaEnabled } = useRecaptcha({ active: step >= TOTAL_STEPS });
  const [submitting, setSubmitting] = useState(false);
  const tripAutoAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    trackEvent("booking_form_started", { source: "public_booking" });
  }, []);

  useEffect(() => {
    return () => {
      if (tripAutoAdvanceTimer.current) clearTimeout(tripAutoAdvanceTimer.current);
    };
  }, []);

  // Load trips from admin (open or completed) — runs once
  useEffect(() => {
    let active = true;
    setLoadingTrips(true);
    (async () => {
      const { data } = await supabase
        .from("trips")
        .select("id,title,slug,season,start_date,end_date,duration_days,short_description,base_price_mad,promo_percent")
        .in("status", ["open", "completed"])
        .order("start_date", { ascending: true, nullsFirst: false });
      if (active) {
        setTripsList((data ?? []) as TripRow[]);
        setLoadingTrips(false);
      }
    })();
    return () => {
      active = false;
    };
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
      setStep((s) => {
        if (s >= 2) return s;
        trackEvent("booking_step_1_completed", { source: "trip_url_preselect", from_step: s, to_step: 2 });
        return 2;
      });
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

  const selectedTrip = useMemo(() => tripsList.find((tr) => tr.id === tripId) ?? null, [tripId, tripsList]);

  // If triple becomes invalid (total not a multiple of 3), fall back to double
  useEffect(() => {
    const totalPeople = adults + children;
    if (room === "triple" && (totalPeople < 3 || totalPeople % 3 !== 0)) {
      setRoom("double");
    }
  }, [adults, children, room]);

  const formatDates = useCallback((s: string | null, e: string | null) => {
    if (!s && !e) return "";
    if (s && e) return `${fmtDate(s)} → ${fmtDate(e)}`;
    return fmtDate(s ?? e);
  }, []);
  const hotels = PUBLIC_HOTEL_OPTIONS;
  const pricing = useMemo(() => {
    const base = selectedTrip?.base_price_mad ?? 0;
    const hotelSupp = HOTEL_SUPPLEMENT[hotel];
    // Per-person room adjustment: single +15000, triple -1000, double 0
    const roomAdj = room === "single" ? SINGLE_SUPPLEMENT_MAD : room === "triple" ? -TRIPLE_DISCOUNT_PER_PERSON_MAD : 0;
    const adultPrice = base + hotelSupp + roomAdj;
    // Child (3-11): adult price minus a flat 3000 MAD discount
    const childPrice = adultPrice - CHILD_DISCOUNT_MAD;
    const peopleTotal = adultPrice * adults + childPrice * children;
    const extrasTotal = extrasList.reduce((s, e) => s + Math.max(0, extras[e.id] || 0) * e.price_mad, 0);
    const total = peopleTotal;
    const pax = adults + children;
    const deposit = pax * 25000;
    return { adultPrice, childPrice, peopleTotal, extrasTotal, total, deposit };
  }, [selectedTrip, hotel, room, adults, children, extras, extrasList]);

  const minStep = tripLocked ? 2 : 1;
  const visibleTotal = tripLocked ? TOTAL_STEPS - 1 : TOTAL_STEPS;
  const visibleStep = tripLocked ? step - 1 : step;
  const agencyPhone = String(agency.phone || "").trim();
  const cleanPhone = agencyPhone.replace(/[^+\d]/g, "");
  const phoneHref = cleanPhone ? `tel:${cleanPhone}` : "/contact";
  const whatsappPhone = cleanPhone.replace(/^\+/, "") || WHATSAPP_FALLBACK;
  const whatsappText = selectedTrip
    ? `Bonjour, je souhaite être rappelé pour ${selectedTrip.title}.`
    : "Bonjour, je souhaite être rappelé pour un voyage au Japon.";
  const whatsappHref = `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(whatsappText)}`;

  const next = useCallback(() => {
    setStep((current) => {
      const nextStep = Math.min(TOTAL_STEPS, current + 1);
      if (nextStep !== current) {
        if (current === 1 || current === 2) {
          trackEvent(current === 1 ? "booking_step_1_completed" : "booking_step_2_completed", { source: "next_button", from_step: current, to_step: nextStep });
        }
      }
      return nextStep;
    });
  }, []);
  const prev = useCallback(() => setStep((s) => Math.max(minStep, s - 1)), [minStep]);
  const canSubmit = Boolean(info.name && info.email && !submitting && captchaReady);

  const selectTripAndAdvance = useCallback((nextTripId: string) => {
    const selected = tripsList.find((tr) => tr.id === nextTripId);
    setTripId((current) => (current === nextTripId ? current : nextTripId));
    trackEvent("booking_step_1_completed", {
      source: "public_booking",
      trip_id: nextTripId,
      trip_slug: selected?.slug ?? null,
      trip_index: selected ? tripsList.findIndex((tr) => tr.id === nextTripId) : null,
    });
    if (tripAutoAdvanceTimer.current) clearTimeout(tripAutoAdvanceTimer.current);
    tripAutoAdvanceTimer.current = setTimeout(() => {
      setStep((currentStep) => {
        if (currentStep !== 1) return currentStep;
        trackEvent("booking_step_1_completed", { source: "trip_auto_advance", from_step: 1, to_step: 2 });
        return 2;
      });
    }, 275);
  }, [tripsList]);

  const unlockTrip = useCallback(() => {
    setTripLocked(false);
    setStep(1);
  }, []);

  const updateInfoField = useCallback((key: keyof typeof info, value: string) => {
    setInfo((current) => (current[key] === value ? current : { ...current, [key]: value }));
  }, []);

  const updateExtraQty = useCallback((id: string, value: number) => {
    setExtras((current) => (current[id] === value ? current : { ...current, [id]: value }));
  }, []);
  const updateName = useCallback((value: string) => updateInfoField("name", value), [updateInfoField]);
  const updateEmail = useCallback((value: string) => updateInfoField("email", value), [updateInfoField]);
  const updatePhone = useCallback((value: string) => updateInfoField("phone", value), [updateInfoField]);
  const updateCity = useCallback((value: string) => updateInfoField("city", value), [updateInfoField]);
  const updateNotes = useCallback((value: string) => updateInfoField("notes", value), [updateInfoField]);

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
      let clientId: string | null = null;
      try {
        const result = await findOrCreateClientForBooking({
          full_name: info.name || "",
          email: info.email || "",
          phone: info.phone || "",
          city: info.city || "",
          source: "website_booking",
          metadata: {
            booking_notes: info.notes || null,
            selected_trip_id: tripMeta?.id ?? null,
          },
        });
        clientId = result.clientId ?? null;
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
      const { data: fullBookingData, error: fullBookingError } = await supabase
        .from("bookings")
        .select("*, clients(*), trips(*), booking_extras(*)")
        .eq("id", newBookingId)
        .maybeSingle();
      const notificationPayload = { type: "booking", payload: { booking_id: newBookingId, fullBookingData } };
      if (import.meta.env.DEV) {
        console.info("[admin-email] invoke", { function: "send-admin-notification", payload: notificationPayload });
      }
      void supabase.functions.invoke("send-admin-notification", {
        body: notificationPayload,
      }).then(({ data, error }) => {
        if (import.meta.env.DEV) {
          console.info("[admin-email] invoke response", { function: "send-admin-notification", data, error });
        }
        if (error || data?.ok === false) console.warn("admin booking notification failed", data ?? error);
      });
      trackEvent("booking_form_submitted", {
        source: "public_site",
        trip_id: tripMeta?.id ?? null,
        travelers_count: adults + children,
        extras_count: 0,
      });
      setCreatedBookingId(newBookingId);
      setExtras({});
      setPostBookingExtrasOpen(false);
      setPostBookingExtrasConfirmed(false);
      setPostBookingExtrasSkipped(false);
      setDone(true);
      trackEvent("booking_success_extras_shown", { trip_id: tripMeta?.id ?? null });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) {
      toast.error(e.message ?? "Erreur lors de l'envoi");
    } finally {
      setSubmitting(false);
    }
  };

  const selectedPostBookingExtras = useMemo(
    () => extrasList.filter((extra) => Math.max(0, extras[extra.id] || 0) > 0),
    [extras, extrasList],
  );

  const confirmPostBookingExtras = async () => {
    if (!createdBookingId || savingPostBookingExtras || postBookingExtrasConfirmed) return;
    const chosenExtras = selectedPostBookingExtras;
    if (!chosenExtras.length) {
      toast.info("Sélectionnez au moins une expérience, ou cliquez sur « Je le ferai plus tard ».");
      return;
    }
    setSavingPostBookingExtras(true);
    try {
      const extrasTotal = chosenExtras.reduce((sum, extra) => sum + Math.max(0, extras[extra.id] || 0) * extra.price_mad, 0);
      const { error } = await supabase.from("booking_extras").insert(chosenExtras.map((extra) => ({
        booking_id: createdBookingId,
        extra_id: extra.id,
        name_snapshot: extra.name,
        qty: Math.max(0, extras[extra.id] || 0),
        unit_price_mad: extra.price_mad,
      })));
      if (error) throw error;
      const { error: updateError } = await supabase
        .from("bookings")
        .update({ total_amount_mad: Math.round(pricing.peopleTotal + extrasTotal) })
        .eq("id", createdBookingId);
      if (updateError) throw updateError;
      setPostBookingExtrasConfirmed(true);
      trackEvent("post_booking_extras_confirmed", {
        trip_id: selectedTrip?.id ?? null,
        extras_count: chosenExtras.length,
        extras_total: Math.round(extrasTotal),
      });
      toast.success("Expériences ajoutées à votre réservation.");
    } catch (error: any) {
      toast.error(error?.message ?? "Impossible d'ajouter ces expériences.");
    } finally {
      setSavingPostBookingExtras(false);
    }
  };

  if (done) {
    const postBookingExtrasTotal = selectedPostBookingExtras.reduce(
      (sum, extra) => sum + Math.max(0, extras[extra.id] || 0) * extra.price_mad,
      0,
    );
    return (
      <div className="container-app py-24 md:py-32">
        <Seo
          title="Réservation enregistrée — LeJapon.ma"
          description="Votre réservation LeJapon.ma est enregistrée. Vous pouvez ajouter des expériences optionnelles après réservation."
          canonical="/reserver"
        />
        <div className="mx-auto max-w-4xl">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <div className="w-16 h-16 mx-auto mb-8 rounded-2xl bg-gradient-vermillion text-accent-foreground flex items-center justify-center font-display text-2xl shadow-cta">✓</div>
            <h1 className="font-display text-4xl md:text-6xl mb-6">Votre réservation est enregistrée 🎉</h1>
            <p className="text-foreground/70 text-lg leading-relaxed">
              Votre place pour le Japon est maintenant réservée. Notre équipe vous recontacte sous 24 heures pour confirmer les derniers détails.
            </p>
            <div className="mt-8 rounded-2xl border border-accent/20 bg-accent-soft/30 p-4 text-left sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-display text-xl">Accéder à mon espace voyage</h2>
                  <p className="mt-1 text-sm leading-6 text-foreground/70">
                    Votre espace utilise le même email que celui indiqué dans cette réservation.
                  </p>
                </div>
                <a
                  href="/espace-voyage/login"
                  className="inline-flex min-h-11 shrink-0 items-center justify-center border border-accent bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground transition-all hover:bg-foreground"
                >
                  Accéder à mon espace voyage
                </a>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-background p-5 shadow-soft sm:p-8">
            {postBookingExtrasSkipped ? (
              <div className="mx-auto max-w-2xl text-center">
                <p className="eyebrow mb-3 text-accent">C'est noté</p>
                <h2 className="font-display mb-4 text-2xl md:text-3xl">Vous pourrez voir ces expériences plus tard avec notre équipe.</h2>
                <p className="mb-8 text-foreground/70">
                  Votre réservation reste bien enregistrée. Un conseiller vous contactera pour confirmer votre place et répondre à vos questions.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setDone(false);
                    setStep(minStep);
                    setCreatedBookingId(null);
                    setPostBookingExtrasSkipped(false);
                  }}
                  className="inline-flex min-h-11 items-center justify-center border border-foreground px-6 py-3 font-semibold transition-all hover:bg-foreground hover:text-background"
                >
                  {t("booking.success.reset")}
                </button>
              </div>
            ) : !postBookingExtrasOpen ? (
              <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-center">
                <div>
                  <p className="eyebrow mb-3 text-accent">Étape facultative</p>
                  <h2 className="font-display mb-4 text-2xl md:text-3xl">Personnalisez encore votre expérience au Japon</h2>
                  <div className="space-y-3 text-sm leading-6 text-foreground/75 md:text-base">
                    <p className="font-medium text-foreground">Votre voyage est déjà très riche.</p>
                    <p>
                      Votre programme comprend les villes, visites, transports et activités prévues au programme, ainsi que l'accompagnement et les guides.
                    </p>
                    <p>
                      Les expériences ci-dessous sont entièrement optionnelles. Nous les avons sélectionnées pour ceux qui souhaitent vivre un moment encore plus particulier, selon leurs envies dans leurs journées libres.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    className="inline-flex min-h-12 items-center justify-center gap-2 bg-accent px-5 py-3 font-semibold text-accent-foreground transition-all hover:bg-foreground"
                    onClick={() => {
                      setPostBookingExtrasOpen(true);
                      trackEvent("booking_success_extras_opened", { trip_id: selectedTrip?.id ?? null });
                    }}
                  >
                    <Sparkles className="h-4 w-4" />
                    Découvrir les expériences
                  </button>
                  <button
                    type="button"
                    className="inline-flex min-h-12 items-center justify-center gap-2 border border-border px-5 py-3 font-semibold transition-all hover:border-accent hover:text-accent"
                    onClick={() => {
                      trackEvent("booking_success_extras_skipped", { trip_id: selectedTrip?.id ?? null });
                      setPostBookingExtrasSkipped(true);
                    }}
                  >
                    Je le ferai plus tard
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-8">
                  <p className="eyebrow mb-3 text-accent">100 % optionnel</p>
                  <h2 className="font-display mb-3 text-2xl md:text-4xl">Personnalisez votre expérience</h2>
                  <p className="max-w-2xl text-foreground/70">
                    Des expériences spéciales, 100 % optionnelles.
                  </p>
                </div>

                <div className="mb-6 rounded-xl border border-accent/30 bg-accent-soft/30 p-4 text-sm leading-6 text-foreground/80">
                  Votre voyage est déjà très complet. Ces expériences ne sont pas nécessaires pour profiter pleinement du programme.
                  Elles sont proposées uniquement pour vous permettre d'ajouter des moments particuliers selon vos envies.
                </div>

                <div className="mb-8 grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-border bg-secondary/30 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Voyage réservé</p>
                    <p className="mt-2 font-display text-2xl text-foreground">{fmt(pricing.peopleTotal)}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-secondary/30 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Expériences optionnelles</p>
                    <p className="mt-2 font-display text-2xl text-accent">{fmt(postBookingExtrasTotal)}</p>
                  </div>
                </div>

                {extrasLoading ? (
                  <div className="rounded-xl border border-border p-6 text-sm text-muted-foreground">Chargement des expériences…</div>
                ) : extrasList.length === 0 ? (
                  <div className="rounded-xl border border-border p-6 text-sm text-muted-foreground">Aucune expérience optionnelle active pour le moment.</div>
                ) : (
                  <div className="space-y-px overflow-hidden rounded-xl border border-border bg-border">
                    {extrasList.map((extra) => {
                      const qty = Math.max(0, extras[extra.id] || 0);
                      return (
                        <div key={extra.id} className="grid gap-4 bg-background p-4 sm:grid-cols-[96px_minmax(0,1fr)_120px] sm:items-center">
                          <div className="h-24 overflow-hidden rounded-lg bg-secondary">
                            {extra.image_url ? (
                              <img src={extra.image_url} alt={extra.alt_text || extra.name} className="h-full w-full object-cover" loading="lazy" />
                            ) : (
                              <div className="flex h-full items-center justify-center text-muted-foreground">
                                <Sparkles className="h-5 w-5" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <h3 className="font-display text-lg leading-tight">{extra.name}</h3>
                              <span className="text-sm font-semibold text-accent">{fmtExtraPrice(extra.price_mad)}</span>
                            </div>
                            {extra.description && <p className="mt-1 text-sm leading-6 text-foreground/65">{extra.description}</p>}
                            {(extra.city || extra.category) && (
                              <p className="mt-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">{[extra.city, extra.category].filter(Boolean).join(" · ")}</p>
                            )}
                          </div>
                          <div className="sm:justify-self-end">
                            {postBookingExtrasConfirmed ? (
                              <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-center text-xs font-semibold text-emerald-700">
                                Confirmé x{qty}
                              </div>
                            ) : (
                              <Counter
                                mini
                                value={qty}
                                onChange={(value) => {
                                  updateExtraQty(extra.id, value);
                                  if (value > 0) {
                                    trackEvent("post_booking_extra_selected", { trip_id: selectedTrip?.id ?? null, extra_id: extra.id });
                                  }
                                }}
                                min={0}
                              />
                            )}
                            {qty > 0 && <p className="mt-2 text-right text-xs text-muted-foreground">Total: {fmt(qty * extra.price_mad)}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="mt-8 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center justify-center border border-border px-5 py-3 text-sm font-semibold transition-all hover:border-accent hover:text-accent"
                    onClick={() => {
                      trackEvent("booking_success_extras_skipped", { trip_id: selectedTrip?.id ?? null, source: "extras_selection" });
                      setPostBookingExtrasSkipped(true);
                      setPostBookingExtrasOpen(false);
                    }}
                  >
                    Je le ferai plus tard
                  </button>
                  <button
                    type="button"
                    disabled={savingPostBookingExtras || postBookingExtrasConfirmed || selectedPostBookingExtras.length === 0}
                    className="inline-flex min-h-11 items-center justify-center gap-2 bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground transition-all hover:bg-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={confirmPostBookingExtras}
                  >
                    {savingPostBookingExtras ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    {postBookingExtrasConfirmed ? "Expériences ajoutées" : "Confirmer les expériences"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container-app max-w-full overflow-x-hidden pb-36 pt-8 sm:py-12 md:py-20">
      <Seo
        title="Réserver mon voyage au Japon — Composer votre séjour | lejapon.ma"
        description="Composez votre voyage au Japon en 2 minutes : dates, formule, chambre et options. Prix instantané, paiement sécurisé, départs depuis Casablanca."
        canonical="/reserver"
      />
      <div className="grid max-w-full gap-8 lg:grid-cols-12 lg:items-start lg:gap-12 lg:pb-60">
        {/* FORM */}
        <div className="min-w-0 lg:col-span-7 xl:col-span-8">
          <p className="eyebrow mb-3">{t("booking.step")} {visibleStep} {t("booking.of")} {visibleTotal}</p>
          <h1 className="font-display mb-3 text-3xl leading-tight sm:text-4xl md:text-5xl">{t("booking.title")}</h1>
          <p className="mb-8 text-foreground/70 sm:mb-10">{t("booking.subtitle")}</p>

          {step > 1 && selectedTrip && (
            <div className="mb-8 flex flex-col gap-3 border border-accent/40 bg-accent-soft/30 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-sm">
                <p className="eyebrow text-accent mb-1">Voyage sélectionné</p>
                <p className="break-words font-medium">{selectedTrip.title}</p>
                <p className="text-foreground/70 text-xs mt-0.5">
                  {selectedTrip.season || formatDates(selectedTrip.start_date, selectedTrip.end_date)}
                </p>
              </div>
              <button
                type="button"
                onClick={unlockTrip}
                className="tap-target self-start text-sm underline hover:text-accent sm:shrink-0"
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
          <div className="mb-8 flex gap-2 sm:mb-12">
            {Array.from({ length: visibleTotal }).map((_, i) => (
              <div key={i} className={cn("h-0.5 flex-1 transition-all duration-500", i < visibleStep ? "bg-accent" : "bg-border")} />
            ))}
          </div>

          {/* top actions */}
          <div className="mb-8 hidden flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between md:flex">
            <button type="button" onClick={prev} disabled={step === minStep} className={cn(
              "inline-flex min-h-11 items-center justify-center gap-2 text-sm sm:min-h-0 sm:justify-start",
              step === minStep ? "opacity-30 cursor-not-allowed" : "hover:text-accent"
            )}>
              <ArrowLeft className="w-4 h-4" /> {t("cta.back")}
            </button>
            {step < TOTAL_STEPS ? (
              <button type="button" onClick={next} className="inline-flex min-h-11 w-full items-center justify-center gap-2 bg-foreground px-5 py-3 text-background transition-all hover:bg-accent sm:w-auto sm:px-6">
                {t("cta.continue")} <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button type="button" onClick={submit} disabled={!canSubmit}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 bg-accent px-5 py-3 text-accent-foreground transition-all hover:bg-foreground disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:px-6">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {submitting ? "Envoi…" : t("cta.confirm")}
              </button>
            )}
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={step} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3 }}>
              {step === 1 && (
                <div>
                  <h2 className="font-display text-2xl mb-6">{t("booking.s1.title")}</h2>
                  {loadingTrips ? (
                    <TripCardsSkeleton />
                  ) : tripsList.length === 0 ? (
                    <p className="text-foreground/60">Aucun départ disponible pour le moment. Revenez bientôt.</p>
                  ) : (
                    <div className="grid gap-3">
                      {tripsList.map((tr) => {
                        const hasPromo = typeof tr.promo_percent === "number" && tr.promo_percent > 0 && tr.promo_percent < 100;
                        const originalPrice = hasPromo ? Math.round(Number(tr.base_price_mad || 0) / (1 - Number(tr.promo_percent) / 100)) : null;
                        return (
                          <TripSelectCard
                            key={tr.id}
                            trip={tr}
                            selected={tripId === tr.id}
                            originalPrice={originalPrice}
                            hasPromo={hasPromo}
                            dateLabel={formatDates(tr.start_date, tr.end_date)}
                            onSelect={selectTripAndAdvance}
                          />
                      )})}
                    </div>
                  )}
                </div>
              )}

              {step === 2 && (
                <div>
                  <h2 className="font-display mb-2 text-2xl">Votre formule en 1 minute</h2>
                  <p className="mb-6 text-sm text-foreground/70">
                    Voyageurs, chambre et hôtel. Les expériences spéciales resteront facultatives après réservation.
                  </p>

                  {selectedTrip && (
                    <div className="mb-6 grid gap-3 border border-border bg-secondary/50 p-4 sm:grid-cols-3">
                      <MiniFact icon={<CalendarDays className="h-4 w-4" />} label="Dates" value={formatDates(selectedTrip.start_date, selectedTrip.end_date) || selectedTrip.season || "À confirmer"} />
                      <MiniFact icon={<Clock3 className="h-4 w-4" />} label="Durée" value={selectedTrip.duration_days ? `${selectedTrip.duration_days} jours` : "Programme complet"} />
                      <MiniFact icon={<Wallet className="h-4 w-4" />} label="Acompte" value={`${fmt(25000)} / pers.`} />
                    </div>
                  )}

                  <div className="mb-8 grid gap-4 sm:grid-cols-2">
                    <Counter label={t("booking.s3.adults")} value={adults} onChange={setAdults} min={1} />
                    <Counter label={t("booking.s3.children")} value={children} onChange={setChildren} min={0} />
                  </div>
                  <p className="mb-4 text-xs text-foreground/60">Réduction de {fmt(CHILD_DISCOUNT_MAD)} par enfant (3 à 11 ans).</p>

                  <p className="eyebrow mb-3">{t("booking.s3.room")}</p>
                  <div className="mb-8 grid gap-2 sm:grid-cols-3">
                    {(["single", "double", "triple"] as RoomKey[]).map((r) => {
                      const totalPeople = adults + children;
                      const tripleDisabled = r === "triple" && (totalPeople < 3 || totalPeople % 3 !== 0);
                      return (
                        <button
                          key={r}
                          type="button"
                          onClick={() => { if (!tripleDisabled) setRoom(r); }}
                          disabled={tripleDisabled}
                          title={tripleDisabled ? "Le nombre total de voyageurs doit être un multiple de 3" : undefined}
                          className={cn(
                            "tap-target flex min-h-14 flex-col items-center justify-center gap-1 border px-2 py-3 text-sm transition-colors sm:py-4",
                            room === r ? "border-accent bg-accent-soft/40" : "border-border hover:border-foreground/40",
                            tripleDisabled && "cursor-not-allowed opacity-40 hover:border-border"
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
                    <div className="mb-8 border border-accent/30 bg-accent-soft/30 p-4 text-sm text-foreground/80">
                      En choisissant la chambre double tout seul, vous acceptez de partager la chambre avec quelqu&apos;un. Pensez à inviter un ami ou une connaissance.
                    </div>
                  )}

                  <h3 className="font-display mb-2 text-xl">Hôtel à Kyoto</h3>
                  <p className="mb-4 text-sm text-foreground/70">Choisissez votre hébergement pour l'étape de Kyoto.</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    {(Object.keys(hotels) as HotelKey[]).map((k) => (
                      <button key={k} type="button" onClick={() => setHotel(k)} className={cn(
                        "tap-target flex min-h-[160px] w-full max-w-full flex-col border p-4 text-start transition-colors sm:min-h-[180px] sm:p-6",
                        hotel === k ? "border-accent bg-accent-soft/40" : "border-border hover:border-foreground/40"
                      )}>
                        <h3 className="font-display mb-2 break-words text-lg leading-tight sm:text-xl">{hotels[k].name}</h3>
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
                  <h2 className="font-display text-2xl mb-3">{t("booking.s5.title")}</h2>
                  <p className="mb-6 text-sm text-foreground/70">
                    Minimum requis: nom et email. Le téléphone aide notre conseiller à vous rappeler plus vite.
                  </p>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field label={t("booking.s5.name")} value={info.name} onChange={updateName} />
                    <Field label={t("booking.s5.email")} type="email" value={info.email} onChange={updateEmail} />
                    <Field label={t("booking.s5.phone")} value={info.phone} onChange={updatePhone} />
                    <Field label={t("booking.s5.city")} value={info.city} onChange={updateCity} />
                  </div>
                  <Field className="mt-4" label={t("booking.s5.notes")} multiline value={info.notes} onChange={updateNotes} />
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          <div className="mt-10 hidden flex-col-reverse items-stretch gap-3 border-t border-border pt-6 sm:mt-12 sm:flex-row sm:items-center sm:justify-between md:flex">
            <button type="button" onClick={prev} disabled={step === minStep} className={cn(
              "inline-flex min-h-11 items-center justify-center gap-2 text-sm sm:min-h-0 sm:justify-start",
              step === minStep ? "opacity-30 cursor-not-allowed" : "hover:text-accent"
            )}>
              <ArrowLeft className="w-4 h-4" /> {t("cta.back")}
            </button>
            {step < TOTAL_STEPS ? (
              <button type="button" onClick={next} className="inline-flex min-h-11 w-full items-center justify-center gap-2 bg-foreground px-5 py-3 text-background transition-all hover:bg-accent sm:w-auto sm:px-6">
                {t("cta.continue")} <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button type="button" onClick={submit} disabled={!canSubmit}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 bg-accent px-5 py-3 text-accent-foreground transition-all hover:bg-foreground disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:px-6">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {submitting ? "Envoi…" : t("cta.confirm")}
              </button>
            )}
          </div>
          {recaptchaEnabled && (
            <p className="text-xs text-foreground/50 mt-4">
              Protégé par reCAPTCHA — la{" "}
              <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-accent">politique</a>
              {" "}et les{" "}
              <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-accent">conditions</a>
              {" "}de Google s'appliquent.
            </p>
          )}
        </div>

        {/* SUMMARY */}
        <aside className="booking-summary-sticky min-w-0 lg:col-span-5 xl:col-span-4">
          <div className="min-w-0">
            <div className="relative overflow-hidden bg-gradient-to-br from-secondary via-secondary to-background border border-border/60 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.25)]">
              {/* Decorative accent bar */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-accent via-accent/70 to-accent" />
              <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full bg-accent/10 blur-3xl pointer-events-none" />

              <div className="relative min-w-0 p-4 sm:p-6 lg:p-8">
                <div className="flex items-center gap-2 mb-6">
                  <Sparkles className="w-3.5 h-3.5 text-accent" />
                  <p className="eyebrow !mb-0 font-bold">{t("booking.summary.title")}</p>
                </div>

                <ul className="space-y-4 text-sm">
                  <SummaryItem icon={<Plane className="w-4 h-4" />} label={t("booking.summary.trip")} value={selectedTrip?.title ?? "—"} />
                  <SummaryItem icon={<Hotel className="w-4 h-4" />} label="Hôtel Kyoto" value={hotels[hotel].name} />
                  <SummaryItem icon={<Users className="w-4 h-4" />} label={t("booking.summary.travelers")} value={`${adults} + ${children}`} />
                  <SummaryItem icon={<BedDouble className="w-4 h-4" />} label={t("booking.s3.room")} value={t(`booking.s3.${room}`)} />
                </ul>

                <div className="relative my-7">
                  <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />
                </div>

                <div className="border border-accent/20 bg-background/60 p-4 backdrop-blur-sm sm:p-5">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="eyebrow text-accent">{t("booking.summary.total")}</span>
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">TTC</span>
                  </div>
                  <div className="font-display break-words text-3xl font-bold leading-none text-accent tabular-nums sm:text-4xl">
                    {fmt(pricing.total)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    <span className="tabular-nums">{fmt(pricing.adultPrice)}</span> {t("booking.summary.perPerson")}
                  </p>
                </div>

                <div className="mt-5 flex flex-col gap-2 border border-dashed border-border/70 p-4 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <div className="flex items-center gap-2 text-foreground/70">
                    <Wallet className="w-4 h-4 text-accent" />
                    <span>{t("booking.summary.deposit")}</span>
                  </div>
                  <span className="font-display break-words text-lg tabular-nums">{fmt(pricing.deposit)}</span>
                </div>

                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  <a
                    href={whatsappHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center justify-center gap-2 border border-accent bg-accent text-sm font-semibold text-accent-foreground transition-colors hover:bg-foreground"
                    onClick={() => trackEvent("whatsapp_clicked", { placement: "booking_summary", trip_id: selectedTrip?.id ?? null })}
                  >
                    <MessageCircle className="h-4 w-4" /> WhatsApp
                  </a>
                  <a
                    href={phoneHref}
                    className="inline-flex min-h-11 items-center justify-center gap-2 border border-border bg-background/70 text-sm font-semibold transition-colors hover:border-accent hover:text-accent"
                    onClick={() => trackEvent("phone_clicked", { placement: "booking_summary", trip_id: selectedTrip?.id ?? null })}
                  >
                    <PhoneCall className="h-4 w-4" /> Être rappelé
                  </a>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 shadow-[0_-12px_30px_-24px_rgba(0,0,0,0.45)] backdrop-blur md:hidden">
        <div className="mx-auto max-w-lg">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {t("booking.step")} {visibleStep} {t("booking.of")} {visibleTotal}
            </p>
            <p className="shrink-0 text-xs font-semibold text-accent tabular-nums">{fmt(pricing.total)}</p>
          </div>
          <p className="mb-3 truncate text-xs text-muted-foreground">{selectedTrip?.title ?? "Voyage"} · Acompte {fmt(pricing.deposit)}</p>
          <div className="mb-3 flex gap-1.5">
            {Array.from({ length: visibleTotal }).map((_, i) => (
              <div key={i} className={cn("h-1 flex-1 rounded-full transition-all duration-500", i < visibleStep ? "bg-accent" : "bg-border")} />
            ))}
          </div>
          <div className="grid grid-cols-[0.9fr_1.25fr] gap-3">
            <button
              type="button"
              onClick={prev}
              disabled={step === minStep}
              className={cn(
                "inline-flex min-h-11 items-center justify-center gap-2 border border-border px-4 text-sm font-semibold transition-all",
                step === minStep ? "cursor-not-allowed opacity-35" : "hover:border-accent hover:text-accent"
              )}
            >
              <ArrowLeft className="h-4 w-4" /> {t("cta.back")}
            </button>
            {step < TOTAL_STEPS ? (
              <button type="button" onClick={next} className="inline-flex min-h-11 items-center justify-center gap-2 bg-foreground px-4 text-sm font-semibold text-background transition-all hover:bg-accent">
                {t("cta.continue")} <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                className="inline-flex min-h-11 items-center justify-center gap-2 bg-accent px-4 text-sm font-semibold text-accent-foreground transition-all hover:bg-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {submitting ? "Envoi…" : t("cta.confirm")}
              </button>
            )}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center justify-center gap-2 border border-border text-xs font-semibold"
              onClick={() => trackEvent("whatsapp_clicked", { placement: "booking_mobile_sticky", trip_id: selectedTrip?.id ?? null })}
            >
              <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
            </a>
            <a
              href={phoneHref}
              className="inline-flex min-h-10 items-center justify-center gap-2 border border-border text-xs font-semibold"
              onClick={() => trackEvent("phone_clicked", { placement: "booking_mobile_sticky", trip_id: selectedTrip?.id ?? null })}
            >
              <PhoneCall className="h-3.5 w-3.5" /> Rappel
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

const TripSelectCard = memo(function TripSelectCard({
  trip,
  selected,
  originalPrice,
  hasPromo,
  dateLabel,
  onSelect,
}: {
  trip: TripRow;
  selected: boolean;
  originalPrice: number | null;
  hasPromo: boolean;
  dateLabel: string;
  onSelect: (tripId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(trip.id)}
      className={cn(
        "w-full max-w-full text-start p-4 sm:p-6 border transition-all duration-300",
        selected ? "border-accent bg-accent-soft/40" : "border-border hover:border-foreground/40"
      )}
    >
      <div className="mb-1 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h3 className="font-display min-w-0 break-words text-lg leading-tight sm:text-xl">{trip.title}</h3>
        <div className="min-w-0 text-left sm:shrink-0 sm:text-right">
          {originalPrice && originalPrice > trip.base_price_mad && (
            <div className="text-sm font-semibold text-muted-foreground line-through">{fmt(originalPrice)}</div>
          )}
          {hasPromo && <div className="mb-1 text-xs font-bold uppercase tracking-wide text-accent">Offre spéciale</div>}
          <span className="break-words text-2xl font-bold text-accent sm:whitespace-nowrap sm:text-3xl">{fmt(trip.base_price_mad)}</span>
        </div>
      </div>
      <p className="text-xs eyebrow text-muted-foreground mb-2">
        {trip.season || dateLabel}
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-2 mb-3 text-sm text-foreground/70">
        {typeof trip.duration_days === "number" && trip.duration_days > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <Clock3 className="w-4 h-4 text-accent" />
            {trip.duration_days} jours
          </span>
        )}
        {(trip.start_date || trip.end_date) && (
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="w-4 h-4 text-accent" />
            {dateLabel}
          </span>
        )}
      </div>
      {trip.short_description && (
        <p className="text-sm text-foreground/70">{trip.short_description}</p>
      )}
    </button>
  );
});

const TripCardsSkeleton = memo(function TripCardsSkeleton() {
  return (
    <div className="grid gap-3" aria-label="Chargement des départs">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="min-h-[168px] border border-border p-4 sm:min-h-[182px] sm:p-6">
          <div className="mb-4 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-3">
              <div className="h-6 w-56 max-w-full animate-pulse rounded bg-secondary/70" />
              <div className="h-3 w-32 animate-pulse rounded bg-secondary/60" />
            </div>
            <div className="space-y-2 sm:text-right">
              <div className="h-3 w-24 animate-pulse rounded bg-secondary/60 sm:ml-auto" />
              <div className="h-8 w-36 animate-pulse rounded bg-secondary/70" />
            </div>
          </div>
          <div className="mb-4 flex gap-4">
            <div className="h-4 w-20 animate-pulse rounded bg-secondary/60" />
            <div className="h-4 w-32 animate-pulse rounded bg-secondary/60" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-full animate-pulse rounded bg-secondary/50" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-secondary/50" />
          </div>
        </div>
      ))}
    </div>
  );
});

const Counter = memo(function Counter({ label, value, onChange, min = 0, mini }: { label?: string; value: number; onChange: (v: number) => void; min?: number; mini?: boolean }) {
  const decrement = useCallback(() => onChange(Math.max(min, value - 1)), [min, onChange, value]);
  const increment = useCallback(() => onChange(value + 1), [onChange, value]);
  return (
  <div className={cn("max-w-full min-w-0", !mini && "border border-border p-4")}>
    {label && <p className="eyebrow mb-3 max-w-full whitespace-normal break-words">{label}</p>}
    <div className="flex max-w-full items-center gap-3">
      <button type="button" onClick={decrement} className="flex h-11 w-11 shrink-0 items-center justify-center border border-border transition-colors hover:border-accent hover:text-accent">
        <Minus className="w-3 h-3" />
      </button>
      <span className="w-6 shrink-0 text-center font-display text-lg">{value}</span>
      <button type="button" onClick={increment} className="flex h-11 w-11 shrink-0 items-center justify-center border border-border transition-colors hover:border-accent hover:text-accent">
        <Plus className="w-3 h-3" />
      </button>
    </div>
  </div>
  );
});

const Field = memo(function Field({ label, value, onChange, type = "text", multiline, className }: { label: string; value: string; onChange: (v: string) => void; type?: string; multiline?: boolean; className?: string }) {
  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value), [onChange]);
  return (
  <label className={cn("block max-w-full min-w-0", className)}>
    <span className="eyebrow mb-2 block max-w-full whitespace-normal break-words">{label}</span>
    {multiline ? (
      <textarea value={value} onChange={handleChange} rows={3}
        className="w-full max-w-full resize-none border border-border bg-background px-4 py-3 transition-colors focus:border-accent focus:outline-none" />
    ) : (
      <input type={type} value={value} onChange={handleChange}
        className="w-full max-w-full border border-border bg-background px-4 py-3 transition-colors focus:border-accent focus:outline-none" />
    )}
  </label>
  );
});

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between gap-3">
    <span className="text-foreground/60">{label}</span>
    <span className="text-end font-medium">{value}</span>
  </div>
);

const MiniFact = memo(function MiniFact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className="mt-0.5 shrink-0 text-accent">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="block break-words text-sm font-medium">{value}</span>
      </span>
    </div>
  );
});

const SummaryItem = memo(function SummaryItem({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
  <li className="flex min-w-0 items-start justify-between gap-3">
    <div className="flex min-w-0 items-center gap-2.5 text-foreground/60">
      <span className="text-accent/80 shrink-0">{icon}</span>
      <span className="min-w-0 break-words">{label}</span>
    </div>
    <span className="max-w-[56%] min-w-0 break-words text-end font-medium text-foreground">{value}</span>
  </li>
  );
});

export default Booking;
