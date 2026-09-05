import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  Headphones,
  Hotel,
  Loader2,
  MapPin,
  MessageCircle,
  Plane,
  ShieldCheck,
  Sparkles,
  Train,
  Users,
  XCircle,
} from "lucide-react";
import { useParams } from "react-router-dom";
import logo from "@/assets/logo-lejapon.png";
import heroFallback from "@/assets/hero-fuji.jpg";
import kyotoFallback from "@/assets/kyoto-alley.jpg";
import shibuyaFallback from "@/assets/tokyo-shibuya.jpg";
import toriiFallback from "@/assets/torii.jpg";
import teaFallback from "@/assets/tea-ceremony.jpg";
import disneyFallback from "@/assets/exp-disneyland.jpg";
import universalFallback from "@/assets/exp-universal.jpg";
import teamlabFallback from "@/assets/exp-teamlab.jpg";
import { Seo } from "@/components/Seo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FitTextarea as Textarea } from "@/components/fit/FitFormControls";
import { supabase } from "@/integrations/supabase/client";
import { downloadFitPdf, generateFitClientPdf } from "@/lib/fit-pdfs";
import { toast } from "sonner";

const db = supabase as any;
const WHATSAPP = "212711449838";
const DEFAULT_CANCELLATION_CONDITIONS = `Cette proposition est établie sous réserve de disponibilité au moment de la confirmation. Aucune réservation ferme n’est effectuée avant validation finale, réception de l’acompte demandé et confirmation des prestataires.

Hôtels : à partir de 90 jours avant le départ, les hôtels peuvent appliquer des frais d’annulation partiels ou totaux selon les conditions de chaque établissement.
Vols : les billets d’avion sont soumis aux conditions de la compagnie aérienne. Une fois émis, les billets peuvent être non remboursables, non modifiables ou modifiables avec frais.
Trains, visites, musées et activités : les billets déjà émis peuvent être non remboursables et non modifiables.
Guides, transferts et transports privés : des frais d’annulation peuvent s’appliquer après confirmation.
Frais de service : les frais de traitement, de préparation, de conseil, de coordination et de réservation peuvent rester dus après validation du dossier.
Modification du programme : toute modification après validation peut entraîner une révision du prix, des frais supplémentaires ou une indisponibilité.
Acceptation : le paiement de l’acompte ou la validation écrite du devis implique l’acceptation des conditions de réservation, de modification et d’annulation.`;

const fmtDate = (value: unknown) => {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
};

const fmtMAD = (value: unknown) =>
  `${new Intl.NumberFormat("fr-FR").format(Math.round(Number(value || 0)))} MAD`;

const asList = (value: unknown) => {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value ?? "")
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const normalizeTextKey = (value: unknown) => String(value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const uniqueList = (items: unknown[], max = 12) => {
  const seen = new Set<string>();
  const result: string[] = [];
  items.flatMap(asList).forEach((item) => {
    const key = normalizeTextKey(item);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });
  return result.slice(0, max);
};
const listHasSimilar = (items: string[], candidate: string) => {
  const key = normalizeTextKey(candidate);
  if (!key) return false;
  return items.some((item) => {
    const itemKey = normalizeTextKey(item);
    return itemKey === key || (key.length > 4 && itemKey.includes(key)) || (itemKey.length > 4 && key.includes(itemKey));
  });
};
const withoutSimilar = (items: string[], reference: string[]) => uniqueList(items.filter((item) => !listHasSimilar(reference, item)));

const cleanText = (value: unknown) =>
  String(value ?? "")
    .replace(/\btransfer\b/gi, "transfert")
    .replace(/\bTeam\s*Lab\b/g, "teamLab Planets")
    .replace(/\bdontonburi\b/gi, "Dotonbori")
    .replace(/\bcur\b/gi, "cœur")
    .replace(/\bVsversa\b/gi, "aller-retour")
    .trim();

const hotelCategoryLabel = (value: unknown) => {
  const label = cleanText(value);
  if (!label) return "";
  return label.replace(/(\d)\s*(?:\*|★|etoiles?|étoiles?)/gi, "$1★");
};

const durationDays = (quote: any, days: any[]) => {
  if (days.length) return days.length;
  if (!quote?.travel_start_date || !quote?.travel_end_date) return 0;
  const start = new Date(quote.travel_start_date);
  const end = new Date(quote.travel_end_date);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
};

const rhythmLabel = (value: string | null | undefined) => ({
  light: "Rythme léger",
  moderate: "Rythme modéré",
  intense: "Rythme soutenu",
  sustained: "Rythme soutenu",
  free_day: "Rythme libre",
  transfer: "Journée de transfert",
}[value || ""] || "Rythme équilibré");

const flightStatusLabel = (value: string | null | undefined) => ({
  included: "Inclus dans le prix",
  optional: "En option",
  estimate: "Estimatif",
}[value || "included"] || "Inclus dans le prix");

const hasIncludedFlights = (flights: any[], quote?: any) =>
  flights.some((flight) => (flight.status || "included") === "included") ||
  /\b(vols?|billets?\s+d['’]?avion|flights?)\b.*\b(inclus|included)\b/i.test(String(quote?.inclusions ?? ""));

const flightPriceLabel = (flights: any[], quote?: any) =>
  hasIncludedFlights(flights, quote) ? "Vols internationaux inclus" : "Prix terrestre hors vols internationaux";

const perPersonLabel = (quote: any, flights: any[], total?: number) =>
  `${fmtMAD(total == null ? quote?.price_per_person_mad : total / Math.max(1,Number(quote?.travelers_count||1)))} / personne ${hasIncludedFlights(flights, quote) ? "vols internationaux inclus" : "hors vols internationaux"}`;

const filteredExclusions = (quote: any, flights: any[]) => {
  const items = asList(quote?.exclusions || "Dépenses personnelles\nRepas non mentionnés\nOptions non confirmées\nAssurances si non précisées");
  const filtered = hasIncludedFlights(flights, quote) ? items.filter((item) => !/vol|flight|billet/i.test(item)) : items;
  if (!hasIncludedFlights(flights, quote) && !filtered.some((item) => /vol|flight|billet/i.test(item))) {
    return ["Vols internationaux si non mentionnés comme inclus", ...filtered];
  }
  return filtered;
};

const fallbackImageForDay = (day: any) => {
  const text = `${day?.city || ""} ${day?.title || ""} ${day?.rhythm || ""} ${day?.transport_type || ""} ${asList(day?.transport_modes).join(" ")}`.toLowerCase();
  if (/transfert|transfer|train|shinkansen|a[ée]roport|gare/.test(text)) return heroFallback;
  if (/libre|repos|free_day/.test(text)) {
    if (/kyoto|gion|arashiyama|fushimi|temple|sanctuaire|torii/.test(text)) return kyotoFallback;
    if (/osaka|dotonbori|namba|universal|usj/.test(text)) return universalFallback;
    return shibuyaFallback;
  }
  if (/disney|land/.test(text)) return disneyFallback;
  if (/universal|usj/.test(text)) return universalFallback;
  if (/team\s*lab|teamlab/.test(text)) return teamlabFallback;
  if (/kyoto|gion|arashiyama|fushimi|temple|sanctuaire|torii/.test(text)) return /fushimi|torii|sanctuaire/.test(text) ? toriiFallback : kyotoFallback;
  if (/osaka|dotonbori|namba/.test(text)) return shibuyaFallback;
  if (/nara|daim/.test(text)) return toriiFallback;
  if (/tokyo|shibuya|ginza|asakusa|ueno|akihabara|shopping/.test(text)) return shibuyaFallback;
  if (/c[ée]r[ée]monie|the|tea|matcha/.test(text)) return teaFallback;
  return heroFallback;
};

const shortSummary = (value: unknown, maxLength = 185) => {
  const text = cleanText(value);
  if (text.length <= maxLength) return text;
  const sentence = text.match(/^(.{80,}?[.!?])\s/);
  if (sentence?.[1] && sentence[1].length <= maxLength) return sentence[1];
  return `${text.slice(0, maxLength).replace(/\s+\S*$/, "").trim()}…`;
};

export default function FitQuotePublic() {
  const { token } = useParams();
  const [quote, setQuote] = useState<any>(null);
  const [days, setDays] = useState<any[]>([]);
  const [visibleLines, setVisibleLines] = useState<any[]>([]);
  const [hotelLines, setHotelLines] = useState<any[]>([]);
  const [flightLines, setFlightLines] = useState<any[]>([]);
  const [proposalContext, setProposalContext] = useState<any>(null);
  const [savingExtra, setSavingExtra] = useState("");
  const [loading, setLoading] = useState(true);
  const [clientNotes, setClientNotes] = useState("");
  const [acceptedConditions, setAcceptedConditions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [acceptanceOpen, setAcceptanceOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionCategories, setRevisionCategories] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setQuote(null);
      const [{ data, error }, { data: contextData }] = await Promise.all([
        db.rpc("get_public_fit_quote_by_token", { p_token: token }),
        db.rpc("get_public_fit_quote_context_v7", { p_token: token }),
      ]);
      if (error || !data) {
        setLoading(false);
        return;
      }
      const publicQuote = data as any;
      const dayRows = (publicQuote.programme?.days ?? []).map((day: any) => ({
        id: String(day.key),
        day_number: day.day_number,
        date: day.date,
        title: day.title,
        city: day.city,
        description_client: day.description,
        client_summary: day.summary,
        client_highlights: day.highlights,
        client_inclusions: day.included_services,
        client_options: day.visible_extras,
        rhythm: day.pace,
        day_pace: day.pace,
        transport_modes: day.transport,
        meal_notes: day.public_meal_notes,
        meals: day.meals,
        meal_plan: day.meals,
        selling_price_mad: day.selling_price,
        image_urls: day.images,
      }));
      const quoteRow = {
        quote_number: publicQuote.fit_reference,
        client_name: publicQuote.client_display_name,
        destination: publicQuote.destination,
        travelers_count: publicQuote.travelers,
        travel_start_date: publicQuote.dates?.start,
        travel_end_date: publicQuote.dates?.end,
        hotel_category: publicQuote.hotel_level,
        room_type: publicQuote.room_type,
        currency: publicQuote.selling_price?.currency || "MAD",
        status: publicQuote.status,
        total_selling_price_mad: publicQuote.selling_price?.total,
        price_per_person_mad: publicQuote.selling_price?.per_traveler,
        deposit_mad: publicQuote.deposit,
        payment_conditions: publicQuote.public_notes?.payment,
        cancellation_conditions: publicQuote.public_notes?.cancellation,
        production_public_note: publicQuote.public_notes?.general,
        inclusions: publicQuote.included_services,
        exclusions: publicQuote.excluded_services,
        valid_until: publicQuote.validity_date,
        client_pdf_link: publicQuote.client_pdf_link,
        version_number: contextData?.version_number || 1,
        quote_family_reference: contextData?.family_reference || publicQuote.fit_reference,
        public_payment_deadline: contextData?.payment_deadline,
      };
      setQuote(quoteRow);
      setProposalContext(contextData || null);
      setClientNotes("");
      setDays(dayRows);
      setVisibleLines((publicQuote.visible_extras ?? []).map((line: any, index: number) => ({
        id: `extra-${index}`,
        day_id: String(line.day_key),
        category: line.category,
        label: line.label,
        is_optional: line.optional,
        is_client_visible: true,
      })));
      setHotelLines((publicQuote.programme?.hotels ?? []).map((hotel: any, index: number) => ({
        id: `hotel-${index}`,
        city: hotel.city,
        hotel_name: hotel.name,
        image_url: hotel.image,
        category: hotel.level,
        room_type: hotel.room_type,
        nights: hotel.nights,
        public_notes: hotel.public_notes,
      })));
      setFlightLines((publicQuote.programme?.flights ?? []).map((flight: any, index: number) => ({
        id: `flight-${index}`,
        route: flight.route,
        airline: flight.airline,
        status: flight.status,
        passengers_count: flight.travelers,
        public_notes: flight.public_notes,
      })));
      void db.rpc("track_public_fit_quote_event_v7", { p_token: token, p_event: "quote_opened" });
      void supabase.functions.invoke("send-admin-notification", {
        body: { type: "fit_quote_viewed", payload: { token } },
      }).catch(() => undefined);
      setLoading(false);
    })();
  }, [token]);

  useEffect(() => {
    if (!quote || !token) return;
    const seen = new Set<string>();
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const event = (entry.target as HTMLElement).dataset.analyticsEvent;
      if (!event || seen.has(event)) return;
      seen.add(event);
      void db.rpc("track_public_fit_quote_event_v7", { p_token: token, p_event: event });
      observer.unobserve(entry.target);
    }), { threshold: 0.3 });
    document.querySelectorAll<HTMLElement>("[data-analytics-event]").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [quote, token]);

  const linesByDay = useMemo(() => {
    const map = new Map<string, any[]>();
    visibleLines.forEach((line) => map.set(line.day_id, [...(map.get(line.day_id) ?? []), line]));
    return map;
  }, [visibleLines]);

  const cities = useMemo(() => Array.from(new Set(days.map((day) => day.city).filter(Boolean))), [days]);
  const transportItems = useMemo(() => uniqueList([
    ...days.flatMap((day) => [...asList(day.transport_modes), day.transport_type].filter(Boolean)),
    ...visibleLines.filter((line) => /transport|train|bus|transfer|luggage/i.test(line.category)).map((line) => line.label),
  ], 10), [days, visibleLines]);
  const activityItems = useMemo(() => uniqueList([
    ...days.flatMap((day) => [...asList(day.client_highlights), ...asList(day.visits)]),
    ...visibleLines.filter((line) => /visit|activit|ticket|entry/i.test(line.category)).map((line) => line.label),
  ], 12), [days, visibleLines]);
  const tripDays = durationDays(quote, days);
  const heroImage = days.flatMap((day) => asList(day.image_urls))[0] || heroFallback;
  const pdfDays = useMemo(() => days.map((day) => ({ ...day, cost_lines: linesByDay.get(day.id) ?? [] })), [days, linesByDay]);
  const includedFlights = hasIncludedFlights(flightLines, quote);
  const brandName = "LeJapon.ma";
  const brandLogo = logo;
  const brandWhatsapp = proposalContext?.advisor?.whatsapp || WHATSAPP;
  const advisorLabel = proposalContext?.advisor?.name || "LeJapon.ma";
  const selectableExtras = proposalContext?.extras || [];
  const selectedExtras = selectableExtras.filter((extra: any) => extra.selected);
  const proposalTotal = Number(proposalContext?.proposal_total_mad ?? quote?.total_selling_price_mad ?? 0);
  const deposit = Number(quote?.deposit_mad || 0);
  const balance = Math.max(0, proposalTotal - deposit);
  const proposalLocked = ["accepted", "lost", "declined"].includes(quote?.status);

  const downloadPdf = async () => {
    if (!quote) return;
    if (quote.client_pdf_link && selectedExtras.length === 0) {
      window.open(quote.client_pdf_link, "_blank", "noopener,noreferrer");
      return;
    }
    const bytes = await generateFitClientPdf({ quote: { ...quote, total_selling_price_mad: proposalTotal, inclusions: [quote.inclusions, ...selectedExtras.map((extra: any) => extra.label)].filter(Boolean).join("\n") }, days: pdfDays, hotelLines, flightLines });
    downloadFitPdf(bytes, `${quote.quote_number || "devis-fit"}-client.pdf`);
  };

  const toggleExtra = async (extra: any) => {
    if (!token || savingExtra || proposalLocked) return;
    setSavingExtra(extra.id);
    const { data, error } = await db.rpc("set_public_fit_quote_extra_selection_v7", { p_token: token, p_line_id: extra.id, p_selected: !extra.selected });
    setSavingExtra("");
    if (error || !data) return toast.error("Cette expérience ne peut pas être modifiée pour le moment.");
    const ids = new Set((data.selected_ids || []).map(String));
    setProposalContext((current: any) => ({ ...current, extras: (current?.extras || []).map((item: any) => ({ ...item, selected: ids.has(String(item.id)) })), selected_extras_total_mad: data.selected_extras_total_mad, proposal_total_mad: data.proposal_total_mad }));
  };

  const respond = async (action: "accepted" | "revision_requested" | "declined") => {
    if (!quote) return;
    if (action === "accepted" && !acceptedConditions) {
      return toast.error("Merci d’accepter les conditions de réservation et d’annulation avant validation.");
    }
    setSaving(true);
    // Record the decline before the commercial transition makes the token
    // intentionally unresolvable. No browser/device metadata is sent.
    if (action === "declined") {
      await db.rpc("track_public_fit_quote_event_v7", { p_token: token, p_event: "quote_declined" });
    }
    const request = action === "accepted"
      ? db.rpc("accept_public_fit_quote_v7", { p_token: token, p_client_confirmation: true, p_client_notes: clientNotes })
      : action === "revision_requested"
        ? db.rpc("request_public_fit_quote_revision_v3", { p_token: token, p_categories: revisionCategories, p_client_notes: clientNotes })
        : db.rpc("decline_public_fit_quote_v3", { p_token: token, p_client_notes: clientNotes });
    const { data, error } = await request;
    setSaving(false);
    if (error || !data) return toast.error("Impossible d'enregistrer votre réponse. Le lien est peut-être expiré.");
    setQuote({
      ...quote,
      status: data.status || quote.status,
      total_selling_price_mad: action === "accepted" ? proposalTotal : quote.total_selling_price_mad,
      price_per_person_mad: action === "accepted" ? proposalTotal / Math.max(1, Number(quote.travelers_count || 1)) : quote.price_per_person_mad,
    });
    setAcceptanceOpen(false);
    setRevisionOpen(false);
    if (action === "accepted") void db.rpc("track_public_fit_quote_event_v7", { p_token: token, p_event: "quote_accepted" });
    void supabase.functions.invoke("send-admin-notification", {
      body: { type: action === "accepted" ? "fit_quote_accepted" : action === "revision_requested" ? "fit_quote_revision_requested" : "fit_quote_declined", payload: { token } },
    }).catch(() => undefined);
    toast.success(action === "accepted"
      ? "Votre accord a bien été transmis. Les disponibilités seront vérifiées avant confirmation finale."
      : action === "revision_requested"
        ? "Votre demande de modification a été envoyée."
        : "Votre réponse a été enregistrée.");
  };

  if (loading) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-muted-foreground" role="status" aria-live="polite">
        <div className="flex items-center"><Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" /> Chargement sécurisé du devis…</div>
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="container-app flex min-h-[65vh] items-center justify-center py-16 text-center">
        <Card className="w-full max-w-xl p-8 md:p-12">
          <ShieldCheck className="mx-auto h-10 w-10 text-accent" aria-hidden="true" />
          <h1 className="mt-5 font-display text-3xl">Lien de devis indisponible</h1>
          <p className="mt-3 leading-7 text-muted-foreground">Ce devis n’est plus disponible ou le lien est incorrect. Contactez votre conseiller LeJapon.ma.</p>
          <Button className="mt-6" variant="outline" asChild>
            <a href={`https://wa.me/${WHATSAPP}`} target="_blank" rel="noreferrer"><Headphones className="h-4 w-4" /> Contacter LeJapon.ma</a>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-w-0 overflow-x-hidden pb-20 md:pb-0">
      <Dialog open={acceptanceOpen} onOpenChange={setAcceptanceOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Accepter ce devis</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-secondary/40 p-4 text-sm">
              <p className="font-semibold">{quote.quote_number}</p>
              <p className="mt-1 text-muted-foreground">Montant accepté : {fmtMAD(proposalTotal)}</p>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-4 text-sm focus-within:ring-2 focus-within:ring-ring">
              <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={acceptedConditions} onChange={(event) => setAcceptedConditions(event.target.checked)} />
              <span>Je confirme avoir pris connaissance du programme, du prix et des conditions de ce devis.</span>
            </label>
            <Textarea value={clientNotes} onChange={(event) => setClientNotes(event.target.value)} placeholder="Note facultative pour votre conseiller" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAcceptanceOpen(false)}>Annuler</Button>
            <Button onClick={() => respond("accepted")} disabled={saving || !acceptedConditions}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Confirmer l’acceptation</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revisionOpen} onOpenChange={setRevisionOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Que souhaitez-vous modifier ?</DialogTitle></DialogHeader>
          <div className="grid gap-2 sm:grid-cols-2">
            {[["hotel","Hôtel"],["dates","Dates"],["programme","Programme"],["travelers","Nombre de voyageurs"],["budget","Budget"],["other","Autre"]].map(([value,label]) => (
              <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-ring">
                <input type="checkbox" className="h-4 w-4" checked={revisionCategories.includes(value)} onChange={(event) => setRevisionCategories((current) => event.target.checked ? [...current,value] : current.filter((item) => item !== value))} />
                {label}
              </label>
            ))}
          </div>
          <Textarea className="min-h-28" value={clientNotes} onChange={(event) => setClientNotes(event.target.value)} placeholder="Décrivez simplement les ajustements souhaités…" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevisionOpen(false)}>Annuler</Button>
            <Button onClick={() => respond("revision_requested")} disabled={saving || (!revisionCategories.length && !clientNotes.trim())}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Envoyer la demande</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Seo
        title={`Devis FIT ${quote.quote_number} — ${brandName}`}
        description={`Votre proposition de voyage privé au Japon préparée par ${brandName}.`}
        canonical={`/devis-fit/${token}`}
        noindex
      />

      <section className="relative overflow-hidden bg-foreground text-background">
        <img src={heroImage} alt="Voyage privé au Japon" className="absolute inset-0 h-full w-full object-cover opacity-45" width={1920} height={1080} loading="eager" fetchPriority="high" decoding="async" />
        <div className="absolute inset-0 bg-gradient-to-r from-foreground via-foreground/88 to-foreground/45" />
        <div className="container-app relative py-10 md:py-16">
          <div className="mb-8 flex flex-wrap items-center justify-between gap-4 md:mb-12">
            <img src={brandLogo} alt={brandName} width={220} height={88} className="h-12 max-w-[65vw] rounded-lg bg-white/90 p-2 object-contain" />
            <span className="max-w-full break-all rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold backdrop-blur">Réf. {quote.quote_number}</span>
          </div>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="max-w-4xl">
              <span className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-bold text-accent-foreground">
                <Sparkles className="h-4 w-4" /> Programme privé sur mesure
              </span>
              {Number(quote.version_number || 1) > 1 && <p className="mt-4 inline-flex rounded-full border border-white/25 bg-white/12 px-4 py-2 text-sm font-semibold backdrop-blur">Nouvelle proposition — Version {quote.version_number}</p>}
              <h1 className="mt-6 font-display text-4xl leading-tight md:text-6xl">Votre voyage privé au Japon</h1>
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/82">
                {quote.client_name || "Cher client"}, voici une proposition pensée pour votre groupe, avec un itinéraire clair, des prestations sélectionnées et l'assistance {advisorLabel}.
              </p>
              <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap">
                <Button size="lg" className="min-h-11 whitespace-normal" onClick={() => setAcceptanceOpen(true)} disabled={saving || proposalLocked}><CheckCircle2 className="h-4 w-4 shrink-0" /> {quote.status === "accepted" ? "Devis accepté" : "Accepter ce devis"}</Button>
                <Button size="lg" className="min-h-11 whitespace-normal" variant="secondary" onClick={() => setRevisionOpen(true)} disabled={saving || ["accepted", "lost", "declined"].includes(quote.status)}><MessageCircle className="h-4 w-4 shrink-0" /> Demander une modification</Button>
                <Button size="lg" variant="outline" className="min-h-11 whitespace-normal border-white/30 bg-white/10 text-white hover:bg-white hover:text-foreground" onClick={downloadPdf}><Download className="h-4 w-4 shrink-0" /> Télécharger le PDF</Button>
                <Button size="lg" variant="outline" className="min-h-11 whitespace-normal border-white/30 bg-white/10 text-white hover:bg-white hover:text-foreground" asChild>
                  <a href={`https://wa.me/${brandWhatsapp}?text=${encodeURIComponent(`Bonjour, je souhaite parler du devis ${quote.quote_number}.`)}`} target="_blank" rel="noreferrer">
                    <Headphones className="h-4 w-4" /> Contacter un conseiller
                  </a>
                </Button>
              </div>
            </div>
            <Card className="bg-white/95 p-5 text-foreground shadow-2xl">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <HeroMetric icon={CalendarDays} label="Dates" value={[fmtDate(quote.travel_start_date), fmtDate(quote.travel_end_date)].filter(Boolean).join(" → ") || "À confirmer"} />
                <HeroMetric icon={Users} label="Voyageurs" value={`${quote.travelers_count || 1} personne(s)`} />
                <HeroMetric icon={Clock3} label="Durée" value={tripDays ? `${tripDays} jours` : "À confirmer"} />
                <HeroMetric icon={MapPin} label="Destination" value={quote.destination || "Japon"} />
              </div>
              <div className="mt-5 rounded-lg bg-accent/10 p-5">
                <p className="text-sm font-medium text-muted-foreground">Prix total</p>
                <p className="mt-1 text-3xl font-bold text-accent">{fmtMAD(proposalTotal)}</p>
                <p className="mt-1 text-sm font-semibold">{perPersonLabel(quote, flightLines, proposalTotal)}</p>
                {selectedExtras.length > 0 && <p className="mt-2 text-sm text-foreground/75">Dont expériences sélectionnées : <strong>{fmtMAD(proposalContext?.selected_extras_total_mad)}</strong></p>}
                {deposit > 0 && <p className="mt-2 text-sm text-foreground/75">Acompte demandé : <strong>{fmtMAD(deposit)}</strong></p>}
                <p className="mt-3 rounded-full bg-background px-3 py-1 text-xs font-bold text-foreground">{flightPriceLabel(flightLines, quote)}</p>
              </div>
              {quote.valid_until && <p className="mt-4 text-sm text-muted-foreground">Valable jusqu'au {fmtDate(quote.valid_until)}</p>}
            </Card>
          </div>
        </div>
      </section>

      <main className="bg-secondary/30">
        <section className="container-app py-10">
          <Card className="p-6 md:p-8">
            <p className="eyebrow mb-3">Synthèse du voyage</p>
            <h2 className="font-display text-2xl md:text-3xl">
              {[
                tripDays ? `${tripDays} jours au Japon` : "Voyage au Japon",
                cities.join(", "),
                quote.hotel_category ? `Hôtels ${hotelCategoryLabel(quote.hotel_category)}` : null,
                includedFlights ? "Vols inclus" : "Hors vols internationaux",
                `Assistance ${advisorLabel}`,
              ].filter(Boolean).join(" · ")}
            </h2>
            <div className="mt-6 grid gap-3 md:grid-cols-4">
              <SummaryCard icon={MapPin} label="Villes" value={cities.length ? cities.join(", ") : "À confirmer"} />
              <SummaryCard icon={Hotel} label="Hôtels" value={`${hotelCategoryLabel(quote.hotel_category) || "Catégorie à confirmer"} · ${quote.room_type || "chambre selon disponibilité"}`} />
              <SummaryCard icon={Train} label="Transport" value={Array.from(new Set(days.flatMap((day) => asList(day.transport_modes).length ? asList(day.transport_modes) : [day.transport_type]).filter(Boolean))).slice(0, 4).join(", ") || "Train, métro et transferts selon programme"} />
              <SummaryCard icon={ShieldCheck} label="Assistance" value="Suivi personnalisé avant et pendant le voyage" />
            </div>
          </Card>
        </section>

        {cities.length > 1 && (
          <section className="container-app pb-10">
            <Card className="p-5">
              <p className="eyebrow mb-3">Itinéraire en un coup d'œil</p>
              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                {cities.map((city, index) => (
                  <div key={`${city}-${index}`} className="flex items-center gap-2">
                    <span className="rounded-full border border-border bg-background px-4 py-2">{city}</span>
                    {index < cities.length - 1 && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
                  </div>
                ))}
              </div>
            </Card>
          </section>
        )}

        <section className="container-app grid gap-6 pb-10 lg:grid-cols-[0.9fr_1.1fr]">
          <Card className="p-6">
            <p className="eyebrow mb-3">Pourquoi ce voyage est fait pour vous</p>
            <div className="space-y-4">
              {[
                "Programme privé et modulable selon vos préférences.",
                "Rythme adapté, avec un équilibre entre visites guidées et temps libre.",
                "Sélection des essentiels du Japon et expériences authentiques.",
                `Assistance ${advisorLabel} pour avancer avec clarté et sérénité.`,
              ].map((item) => <IconLine key={item} icon={CheckCircle2} text={item} />)}
            </div>
          </Card>
          <Card className="p-6">
            <p className="eyebrow mb-3">Timeline rapide</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {days.map((day, index) => (
                <div key={day.id} className="flex items-center gap-3 rounded-xl border border-border bg-background p-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground">J{index + 1}</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{day.city || "Japon"}</p>
                    <p className="truncate text-xs text-muted-foreground">{day.title || "Journée sur mesure"}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </section>

        <section className="container-app space-y-6 pb-10" data-analytics-event="itinerary_viewed">
          {days.map((day, index) => (
            <DayCard
              key={day.id}
              day={day}
              index={index}
              travelers={quote.travelers_count || 1}
              visibleLines={linesByDay.get(day.id) ?? []}
              fallbackImage={fallbackImageForDay(day)}
            />
          ))}
        </section>

        {(transportItems.length > 0 || activityItems.length > 0) && <section className="container-app grid gap-6 pb-10 lg:grid-cols-2">
          <InfoSection title="Transports prévus" items={transportItems.length ? transportItems : ["Transports organisés selon le programme"]} positive />
          <InfoSection title="Activités et expériences" items={activityItems.length ? activityItems : ["Expériences selon le programme détaillé"]} positive />
        </section>}

        {selectableExtras.length > 0 && <section className="container-app pb-10">
          <Card className="overflow-hidden border-accent/25">
            <div className="border-b border-border bg-accent/5 p-6 md:p-8"><p className="eyebrow mb-3">Expériences optionnelles</p><h2 className="font-display text-2xl md:text-3xl">Personnalisez encore votre voyage</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Sélectionnez les expériences qui vous intéressent. Le total est recalculé immédiatement, sans modifier une proposition déjà acceptée.</p></div>
            <div className="grid gap-3 p-4 sm:grid-cols-2 md:p-6">{selectableExtras.map((extra:any)=><button key={extra.id} type="button" onClick={()=>void toggleExtra(extra)} disabled={Boolean(savingExtra)||proposalLocked} aria-pressed={Boolean(extra.selected)} className={`flex min-h-20 cursor-pointer items-center justify-between gap-4 rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 ${extra.selected?"border-accent bg-accent/8":"border-border bg-background hover:border-accent/45"}`}><span className="flex min-w-0 items-start gap-3"><span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${extra.selected?"border-accent bg-accent text-accent-foreground":"border-border"}`}>{extra.selected&&<CheckCircle2 className="h-3.5 w-3.5"/>}</span><span><span className="block font-semibold">{cleanText(extra.label)}</span><span className="mt-1 block text-xs text-muted-foreground">Jour {extra.day_key||"à confirmer"}</span></span></span><span className="shrink-0 font-semibold text-accent">+ {fmtMAD(extra.client_price_mad)}</span></button>)}</div>
          </Card>
        </section>}

        <section className="container-app grid gap-6 pb-10 lg:grid-cols-2">
          <InfoSection title="Ce qui est inclus dans votre voyage" items={buildInclusions(quote, flightLines, days, hotelLines, visibleLines)} positive />
          <InfoSection title="Non inclus" items={filteredExclusions(quote, flightLines)} />
        </section>

        {(hotelLines.length > 0 || flightLines.length > 0) && (
          <section className="container-app grid gap-6 pb-10 lg:grid-cols-2" data-analytics-event={hotelLines.length ? "hotel_viewed" : undefined}>
            {hotelLines.length > 0 && (
              <Card className="p-6">
                <p className="eyebrow mb-3">Hôtels prévus</p>
                <div className="space-y-4">
                  {hotelLines.map((hotelLine) => (
                    <div key={hotelLine.id || hotelLine.local_id} className="overflow-hidden rounded-2xl border border-border bg-background">
                      <img src={hotelLine.image_url || fallbackImageForDay(hotelLine)} alt={hotelLine.hotel_name || "Hôtel prévu"} width={720} height={360} className="aspect-[2/1] w-full object-cover" loading="lazy" decoding="async" />
                      <div className="p-4">
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">{hotelCategoryLabel(hotelLine.category || quote.hotel_category) || "Hôtel 4★"}</span>
                          <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold">{hotelLine.room_type || quote.room_type || "Chambre à confirmer"}</span>
                        </div>
                        <h3 className="mt-3 font-display text-xl">{hotelLine.hotel_name || "Hôtel à confirmer"}</h3>
                        <p className="text-sm text-muted-foreground">{hotelLine.city || "Ville à confirmer"} · {hotelLine.nights || 1} nuit(s)</p>
                        {hotelLine.public_notes && <p className="mt-2 text-sm text-foreground/75">{cleanText(hotelLine.public_notes)}</p>}
                        {(hotelLine.hotel_name||hotelLine.city)&&<a className="mt-3 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-accent hover:underline" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([hotelLine.hotel_name,hotelLine.city,"Japan"].filter(Boolean).join(", "))}`} target="_blank" rel="noreferrer"><MapPin className="h-4 w-4"/>Voir sur la carte</a>}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
            {flightLines.length > 0 && (
              <Card className="p-6">
                <p className="eyebrow mb-3">Vols</p>
                <div className="space-y-3">
                  {flightLines.map((flight) => (
                    <div key={flight.id || flight.local_id} className="rounded-2xl border border-border bg-background p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold">{flight.route || "Route à confirmer"}</h3>
                          <p className="text-sm text-muted-foreground">{flight.airline || "Compagnie à confirmer"} · {flight.passengers_count || quote.travelers_count || 1} passager(s)</p>
                        </div>
                        <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">{flightStatusLabel(flight.status)}</span>
                      </div>
                      {flight.public_notes && <p className="mt-2 text-sm text-foreground/75">{cleanText(flight.public_notes)}</p>}
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </section>
        )}

        <section className="container-app pb-10" data-analytics-event="price_viewed">
          <Card className="overflow-hidden bg-foreground text-background"><div className="grid lg:grid-cols-[1fr_1.15fr]"><div className="p-6 md:p-8"><p className="text-xs font-semibold uppercase tracking-[.18em] text-white/60">Prix et échéancier</p><h2 className="mt-3 font-display text-3xl">Une lecture simple, sans surprise</h2><p className="mt-3 max-w-md text-sm leading-6 text-white/70">Le montant ci-dessous intègre les expériences optionnelles sélectionnées. Les disponibilités restent soumises à confirmation.</p></div><div className="grid grid-cols-2 gap-px bg-white/15"><PriceMetric label="Total de la proposition" value={fmtMAD(proposalTotal)} featured/><PriceMetric label="Acompte" value={fmtMAD(deposit)}/><PriceMetric label="Solde" value={fmtMAD(balance)}/><PriceMetric label="Échéance acompte" value={fmtDate(quote.public_payment_deadline)||"Avec votre conseiller"}/></div></div></Card>
        </section>

        <section className="container-app grid gap-6 pb-10 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="p-6">
            <p className="eyebrow mb-3">Pourquoi voyager avec {advisorLabel}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {whyLeJapon.map((item) => <IconLine key={item.text} icon={item.icon} text={item.text} />)}
            </div>
          </Card>
          <Card className="p-6">
            <p className="eyebrow mb-3">Prochaines étapes</p>
            <div className="space-y-3">
              {["Valider le programme", "Verser l'acompte", "Confirmer les prestations", "Préparer le départ", "Assistance jusqu'au retour"].map((step, index) => (
                <div key={step} className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">{index + 1}</span>
                  <span className="text-sm font-medium">{step}</span>
                </div>
              ))}
            </div>
          </Card>
        </section>

        <section className="container-app pb-10">
          <Card className="p-6 md:p-8">
            <p className="eyebrow mb-3">Conditions de réservation et d’annulation</p>
            <h2 className="font-display text-2xl">Une proposition sous réserve de disponibilité</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Aucune réservation ferme n’est effectuée avant validation finale, réception de l’acompte demandé et confirmation des prestataires.
            </p>
            <div className="mt-5 whitespace-pre-line rounded-2xl border border-border bg-background p-5 text-sm leading-6 text-foreground/80">
              {quote.cancellation_conditions || DEFAULT_CANCELLATION_CONDITIONS}
            </div>
          </Card>
        </section>

        <section className="container-app pb-16">
          <Card className="p-6 md:p-8">
            <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
              <div>
                <p className="eyebrow mb-3">Votre réponse</p>
                <h2 className="font-display text-2xl">Valider ou ajuster votre proposition</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  La validation finale se fait toujours après confirmation avec votre conseiller {advisorLabel}.
                </p>
              </div>
              <div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button onClick={() => setAcceptanceOpen(true)} disabled={saving || proposalLocked}><CheckCircle2 className="h-4 w-4" /> Accepter ce devis</Button>
                  <Button variant="outline" onClick={() => setRevisionOpen(true)} disabled={saving || ["accepted", "lost", "declined"].includes(quote.status)}><MessageCircle className="h-4 w-4" /> Demander une modification</Button>
                  <Button variant="outline" onClick={() => respond("declined")} disabled={saving || ["accepted", "lost", "declined"].includes(quote.status)}><XCircle className="h-4 w-4" /> Décliner</Button>
                  <Button variant="outline" asChild>
                    <a href={`https://wa.me/${brandWhatsapp}?text=${encodeURIComponent(`Bonjour, je souhaite parler du devis ${quote.quote_number}.`)}`} target="_blank" rel="noreferrer">
                      <Headphones className="h-4 w-4" /> Parler à un conseiller
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </section>
      </main>
      <div className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-[1fr_auto] gap-2 border-t border-border bg-background/95 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] shadow-lg backdrop-blur md:hidden">
        <Button className="min-h-12" onClick={() => setAcceptanceOpen(true)} disabled={saving||proposalLocked}><CheckCircle2 className="h-4 w-4"/>{quote.status==="accepted"?"Proposition acceptée":"Accepter"}</Button>
        <Button className="min-h-12" variant="outline" asChild><a href={`https://wa.me/${brandWhatsapp}?text=${encodeURIComponent(`Bonjour, je souhaite parler du devis ${quote.quote_number}.`)}`} target="_blank" rel="noreferrer" aria-label="Contacter votre conseiller sur WhatsApp"><MessageCircle className="h-5 w-5"/></a></Button>
      </div>
    </div>
  );
}

function HeroMetric({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <Icon className="h-4 w-4 text-accent" />
      <p className="mt-2 text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-secondary/45 p-4">
      <Icon className="h-5 w-5 text-accent" />
      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

function PriceMetric({label,value,featured=false}:{label:string;value:string;featured?:boolean}){return <div className={`min-h-28 bg-foreground p-5 md:p-6 ${featured?"col-span-2":""}`}><p className="text-xs text-white/60">{label}</p><p className={`${featured?"text-3xl":"text-xl"} mt-2 font-semibold tabular-nums text-white`}>{value}</p></div>}

function DayCard({ day, index, travelers, visibleLines, fallbackImage }: { day: any; index: number; travelers: number; visibleLines: any[]; fallbackImage: string }) {
  const [expanded, setExpanded] = useState(false);
  const images = asList(day.image_urls);
  const gallery = images.length ? images : [fallbackImage];
  const highlights = uniqueList(asList(day.client_highlights).length ? asList(day.client_highlights) : asList(day.visits), 5);
  const rawInclusions = asList(day.client_inclusions).length ? asList(day.client_inclusions) : visibleLines.filter((line) => !line.is_optional).map((line) => line.label).filter(Boolean);
  const inclusions = withoutSimilar(rawInclusions, highlights).slice(0, 6);
  const options = uniqueList([...asList(day.client_options), ...visibleLines.filter((line) => line.is_optional).map((line) => line.label).filter(Boolean)], 5);
  const transport = asList(day.transport_modes).slice(0, 5);
  const mealPlan = (asList(day.meal_plan).length ? asList(day.meal_plan) : [...asList(day.meals), day.meal_notes].filter(Boolean)).slice(0, 5);
  const dayPrice = Math.round(Number(day.selling_price_mad || 0) / Math.max(1, Number(travelers || 1)));
  const dayPace = day.day_pace || day.rhythm;
  const isFreeDay = dayPrice <= 0 || dayPace === "free_day";
  const summary = day.sales_summary || day.client_summary
    ? cleanText(day.sales_summary || day.client_summary)
    : shortSummary(day.optimized_client_description || day.description_client || "Programme à confirmer avec votre conseiller.");
  const description = cleanText(day.optimized_client_description || day.description_client);
  const details = description && description !== summary ? description : "";
  const shouldCollapseDetails = details.length > 260;
  const displayedDetails = shouldCollapseDetails && !expanded ? `${details.slice(0, 260).trim()}…` : details;
  const freeSuggestions = buildFreeDaySuggestions(day, options);

  return (
    <Card className="overflow-hidden">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="grid min-h-[320px] gap-2 bg-foreground p-2 sm:grid-cols-2">
          <img src={gallery[0]} alt={day.title || `Jour ${index + 1}`} width={900} height={700} className="h-full min-h-[300px] w-full rounded-2xl object-cover sm:col-span-2" loading="lazy" />
          {gallery.slice(1, 5).map((image, imageIndex) => (
            <img key={image} src={image} alt={`${day.title || "Journée"} photo ${imageIndex + 2}`} width={420} height={260} className="hidden h-32 w-full rounded-xl object-cover sm:block" loading="lazy" />
          ))}
        </div>
        <div className="p-6 md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-accent">Jour {index + 1}{day.date ? ` · ${fmtDate(day.date)}` : ""}</p>
              <h2 className="mt-2 font-display text-2xl md:text-3xl">{day.title || "Journée au Japon"}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{day.city || "Ville à confirmer"}</p>
            </div>
            <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold">{rhythmLabel(dayPace)}</span>
          </div>
          <p className="mt-5 text-base leading-7 text-foreground/85">
            {summary}
          </p>
          {details && (
            <div className="mt-3">
              <p className="text-sm leading-7 text-muted-foreground">{displayedDetails}</p>
              {shouldCollapseDetails && (
                <button type="button" className="mt-2 text-sm font-bold text-accent hover:underline" onClick={() => setExpanded((value) => !value)}>
                  {expanded ? "Réduire" : "Lire plus"}
                </button>
              )}
            </div>
          )}
          <div className="mt-5 rounded-2xl bg-accent/10 p-4">
            <p className="text-sm font-semibold text-accent">
              {isFreeDay ? "Journée libre incluse dans votre programme" : `Budget programme du jour : ${fmtMAD(dayPrice)} / personne`}
            </p>
            {isFreeDay && (
              <p className="mt-2 text-sm text-foreground/75">{freeSuggestions.join(" · ")}</p>
            )}
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <ListBlock title="Temps forts" items={highlights} />
            <ListBlock title="Prestations incluses" items={inclusions} empty="Prestations selon descriptif du programme." />
            <ListBlock title="Options possibles à confirmer avec votre conseiller." items={options} empty="Aucune option spécifique à confirmer pour cette journée." />
            <ListBlock title="Transport" items={transport} empty="Organisation adaptée à la journée." />
            <ListBlock title="Repas" items={mealPlan} empty="Repas selon descriptif du programme." />
          </div>
        </div>
      </div>
    </Card>
  );
}

function ListBlock({ title, items, empty = "À confirmer." }: { title: string; items: string[]; empty?: string }) {
  const list = items.map(cleanText).filter(Boolean);
  return (
    <div>
      <h3 className="text-sm font-bold">{title}</h3>
      <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
        {(list.length ? list : [empty]).map((item) => <li key={item} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />{item}</li>)}
      </ul>
    </div>
  );
}

function InfoSection({ title, items, positive = false }: { title: string; items: string[]; positive?: boolean }) {
  return (
    <Card className="p-6">
      <p className="eyebrow mb-3">{title}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item} className="rounded-2xl border border-border bg-background p-4">
            {positive ? <CheckCircle2 className="h-5 w-5 text-accent" /> : <ArrowRight className="h-5 w-5 text-muted-foreground" />}
            <p className="mt-2 text-sm font-medium">{cleanText(item)}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function IconLine({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div className="flex gap-3 rounded-2xl bg-background p-4">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
      <p className="text-sm leading-6 text-foreground/78">{text}</p>
    </div>
  );
}

const whyLeJapon = [
  { icon: MapPin, text: "Spécialiste du Japon avec une vraie connaissance du terrain." },
  { icon: Users, text: "Programmes pensés pour les voyageurs marocains et francophones." },
  { icon: Headphones, text: "Assistance avant et pendant le voyage." },
  { icon: Building2, text: "Suivi personnalisé, transparence et interlocuteur dédié." },
];

function buildFreeDaySuggestions(day: any, options: string[]) {
  const text = `${day?.title || ""} ${day?.city || ""} ${options.join(" ")}`.toLowerCase();
  const suggestions = options.length ? options.slice(0, 3).map(cleanText) : [];
  if (/disney/.test(text)) suggestions.push("Option Disneyland Tokyo possible");
  if (/universal|usj/.test(text)) suggestions.push("Option Universal Studios Japan possible");
  if (!suggestions.length) suggestions.push("Shopping", "Quartier libre", "Promenade selon vos envies", "Assistance disponible");
  return Array.from(new Set(suggestions)).slice(0, 4);
}

function buildInclusions(quote: any, flights: any[], days: any[], hotels: any[], visibleLines: any[]) {
  const base = asList(quote?.inclusions || "Programme selon descriptif\nHôtels prévus\nAssistance LeJapon.ma");
  const transportModes = days.flatMap((day) => [...asList(day.transport_modes), day.transport_type].filter(Boolean)).join(" ");
  const lineText = visibleLines.map((line) => `${line.category || ""} ${line.label || ""}`).join(" ");
  const extras = [
    hasIncludedFlights(flights, quote) ? "Vols internationaux inclus" : null,
    hotels.length || quote?.hotel_category ? `Hôtels ${hotelCategoryLabel(quote?.hotel_category) || "4★"} selon programme` : null,
    "Assistance avant départ",
    "Assistance pendant le voyage",
    /guide|francophone/i.test(lineText) ? "Guides francophones selon les journées indiquées" : null,
    /shinkansen|train|jr/i.test(transportModes + lineText) ? "Shinkansen / trains selon programme" : null,
    /transfer|transfert|private_transfer|airport|aéroport/i.test(transportModes + lineText) ? "Transferts privés ou assistés selon programme" : null,
    /visit|visite|activity|activité|ticket|entrée/i.test(lineText) ? "Entrées et activités visibles dans le programme" : null,
    /bagage|luggage/i.test(lineText) ? "Transfert bagages selon programme" : null,
    "Support WhatsApp / conseiller LeJapon.ma",
  ].filter(Boolean) as string[];
  return Array.from(new Set([...base, ...extras]));
}
