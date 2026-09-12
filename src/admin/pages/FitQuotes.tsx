import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, CalendarCheck, CheckCircle2, Copy, CopyPlus, Download, ExternalLink, Eye, FileText, GripVertical, History, ImagePlus, Link2, Loader2, MoreHorizontal, PackageCheck, Plus, RefreshCw, Save, Send, Sparkles, Trash2, Upload, WalletCards } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "../components/PageHeader";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FitInput as Input, FitTextarea as Textarea } from "@/components/fit/FitFormControls";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { fmtMAD } from "@/lib/format";
import { downloadFitPdf, generateFitClientPdf, generateFitInternalPdf } from "@/lib/fit-pdfs";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fitCommercialLabel, fitCommercialStatus, fitCommercialTone, fitNextAction } from "@/lib/fit-commercial";
import { FitFinancialPanel } from "@/components/fit/FitFinancialPanel";
import { FitFinancialClosurePanel } from "@/components/fit/FitFinancialClosurePanel";

const db = supabase as any;

const DEFAULT_FIT_CANCELLATION_CONDITIONS = `Cette proposition est établie sous réserve de disponibilité au moment de la confirmation. Aucune réservation ferme n’est effectuée avant validation finale, réception de l’acompte demandé et confirmation des prestataires.

Hôtels : à partir de 90 jours avant le départ, les hôtels peuvent appliquer des frais d’annulation partiels ou totaux selon les conditions de chaque établissement. Certains hôtels, périodes de haute saison, chambres familiales ou groupes peuvent être non remboursables dès confirmation.

Vols : les billets d’avion sont soumis aux conditions de la compagnie aérienne. Une fois émis, ils peuvent être non remboursables, non modifiables ou modifiables avec frais selon la classe tarifaire.

Trains, musées, visites et activités : les billets, entrées, expériences et activités déjà émis peuvent être non remboursables et non modifiables.

Guides, transferts et transports privés : des frais d’annulation peuvent s’appliquer après confirmation selon les délais imposés par les prestataires locaux.

Frais de service : les frais de traitement, préparation, conseil, coordination et réservation peuvent rester dus après validation du dossier.

Toute modification après validation peut entraîner une révision du prix, des frais supplémentaires ou une indisponibilité de certaines prestations.

Le paiement de l’acompte ou la validation écrite du devis implique l’acceptation des conditions de réservation, de modification et d’annulation.`;

const costCategories = [
  { value: "transport", label: "Transport" },
  { value: "guide", label: "Guide" },
  { value: "visit", label: "Visite / entrée" },
  { value: "train", label: "Train" },
  { value: "bus", label: "Bus" },
  { value: "meal", label: "Repas" },
  { value: "transfer", label: "Transfert" },
  { value: "luggage", label: "Bagages" },
  { value: "agency_fee", label: "Frais agence legacy" },
  { value: "hotel", label: "Hôtel" },
  { value: "flight", label: "Vol" },
  { value: "other", label: "Autre" },
];

const marginScopes = [
  { value: "program_only", label: "Programme uniquement" },
  { value: "program_hotels", label: "Programme + hôtels" },
  { value: "program_hotels_flights", label: "Programme + hôtels + vols" },
  { value: "all", label: "Tout le devis" },
];

const roundingRules = [
  { value: "unit", label: "Arrondir à l'unité" },
  { value: "ten", label: "Arrondir à 10 MAD" },
  { value: "hundred", label: "Arrondir à 100 MAD" },
];

const emptyTemplate = {
  title: "",
  city: "",
  theme: "",
  duration: "1 journée",
  description_client: "",
  source_description: "",
  optimized_client_description: "",
  client_summary: "",
  sales_summary: "",
  client_highlights_text: "",
  client_inclusions_text: "",
  client_options_text: "",
  internal_notes: "",
  included_visits_text: "",
  optional_visits_text: "",
  rhythm: "moderate",
  transport_type: "",
  transport_modes_text: "",
  guide_required: false,
  hotel_night: true,
  meal_notes: "",
  meals_text: "",
  meal_plan_text: "",
  pax_group_size: 2,
  estimated_cost_jpy: 0,
  estimated_cost_mad: 0,
  default_selling_price_mad: 0,
  partner_publish_status: "internal",
  partner_net_pricing_mode: "auto",
  partner_net_price_mad: 0,
  margin_percent: 20,
  image_urls_text: "",
  tags_text: "",
  is_active: true,
  default_cost_lines: [] as any[],
};

const emptyQuote = {
  client_id: "",
  client_name: "",
  travelers_count: 2,
  travel_start_date: "",
  travel_end_date: "",
  hotel_category: "4*",
  room_type: "double/twin",
  currency: "MAD",
  language: "fr",
  notes: "",
  status: "draft",
  calculation_mode: "automatic_v2",
  japan_agency_fee_rate: 10,
  lejapon_margin_rate: 20,
  margin_scope: "program_only",
  rounding_rule: "unit",
  manual_adjustment_mad: 0,
  discount_mad: 0,
  public_deposit_mad: 0,
  public_payment_deadline: "",
  valid_until: "",
  client_notes: "",
  share_enabled: false,
  share_token: "",
  production_status: "draft",
  japan_request_status: "not_started",
  payment_status: "not_authorized",
  booking_status: "not_started",
  reservation_status: "not_started",
  production_public_note: "",
  japan_request_reference: "",
  japan_request_deadline: "",
  japan_response_notes: "",
  japan_confirmed_price: 0,
  japan_conditions: "",
  japan_valid_until: "",
  payment_conditions: "Paiement uniquement après validation finale de LeJapon.ma et confirmation des disponibilités.",
  booking_conditions: "",
  cancellation_conditions: DEFAULT_FIT_CANCELLATION_CONDITIONS,
  inclusions: "Programme selon descriptif, assistance LeJapon.ma.",
  exclusions: "Vols internationaux, dépenses personnelles, options non mentionnées.",
};

const fitProductionStatuses = [
  "draft",
  "sent_to_client",
  "client_modification_requested",
  "client_preapproved",
  "pending_lejapon_review",
  "pending_japan_availability",
  "japan_request_sent",
  "japan_quote_received",
  "admin_approved_for_payment",
  "payment_authorized",
  "partner_payment_pending",
  "partner_payment_received",
  "booking_in_progress",
  "partially_confirmed",
  "confirmed",
  "cancelled",
  "expired",
  "rejected",
];

const productionStatusLabels: Record<string, string> = {
  draft: "Brouillon",
  sent_to_client: "Envoyé client",
  client_modification_requested: "Modification client",
  client_preapproved: "Accord client reçu",
  pending_lejapon_review: "Vérification LeJapon.ma",
  pending_japan_availability: "Vérification Japon",
  japan_request_sent: "Demande Japon envoyée",
  japan_quote_received: "Réponse Japon reçue",
  admin_approved_for_payment: "Validé paiement",
  payment_authorized: "Paiement autorisé",
  partner_payment_pending: "Paiement demandé",
  partner_payment_received: "Paiement reçu",
  booking_in_progress: "Réservation en cours",
  partially_confirmed: "Partiellement confirmé",
  confirmed: "Confirmé",
  cancelled: "Annulé",
  expired: "Expiré",
  rejected: "Refusé",
};

const normalizeProductionStatus = (value?: string | null) =>
  value && fitProductionStatuses.includes(value) ? value : "draft";

const rhythmOptions = [
  { value: "free_day", label: "Libre" },
  { value: "light", label: "Léger" },
  { value: "moderate", label: "Modéré" },
  { value: "sustained", label: "Soutenu" },
  { value: "transfer", label: "Transfert" },
];

const transportOptions = [
  "À pied",
  "Métro / JR",
  "Bus privé",
  "Train",
  "Shinkansen",
  "Taxi",
  "Transfert privé",
  "Vol domestique",
  "Ferry",
  "Aucun transport prévu",
];

const mealOptions = [
  "Petit-déjeuner inclus",
  "Déjeuner inclus",
  "Dîner inclus",
  "Repas libres",
  "Déjeuner libre",
  "Dîner libre",
  "Dîner spécial inclus",
  "Aucun repas inclus",
];

const excelTemplateSeeds = [
  {
    title: "Tokyo Arrival Transfer",
    city: "Tokyo",
    theme: "Arrivée",
    description_client: "Accueil à Tokyo et transfert privé vers l'hôtel.",
    lines: [
      ["transport", "Transfer airport - hotel", 9000, 1, 1, "fixed", 0],
      ["agency_fee", "Frais d'agence", 0, 1, 1, "percentage_day", 20],
    ],
  },
  {
    title: "Meiji Harajuku Shibuya",
    city: "Tokyo",
    theme: "Tokyo moderne",
    description_client: "Découverte de Meiji Jingu, Harajuku et Shibuya.",
    lines: [
      ["transport", "Transport en métro", 80, 2, 1, "fixed", 0],
      ["guide", "Guide FR", 3600, 1, 1, "fixed", 0],
      ["agency_fee", "Frais d'agence", 0, 1, 1, "percentage_day", 20],
    ],
  },
  {
    title: "Tokyo Tower Odaiba TeamLab",
    city: "Tokyo",
    theme: "Art digital",
    description_client: "Tokyo Tower, Odaiba et expérience immersive TeamLab.",
    lines: [
      ["transport", "Transport métro", 120, 2, 1, "fixed", 0],
      ["visit", "Tokyo Tower", 180, 2, 1, "fixed", 0],
      ["visit", "TeamLab", 350, 2, 1, "fixed", 0],
      ["guide", "Guide FR", 3600, 1, 1, "fixed", 0],
      ["agency_fee", "Frais d'agence", 0, 1, 1, "percentage_day", 20],
    ],
  },
  {
    title: "Hiroshima Miyajima",
    city: "Hiroshima",
    theme: "Histoire",
    description_client: "Hiroshima, musée de la paix, ferry et Miyajima.",
    lines: [
      ["transport", "Transport Hiroshima", 160, 2, 1, "fixed", 0],
      ["visit", "Musée de la bombe", 20, 2, 1, "fixed", 0],
      ["transport", "Ferry Miyajima", 20, 2, 1, "fixed", 0],
      ["visit", "Taxe de Miyajima", 10, 2, 1, "fixed", 0],
      ["guide", "Guide FR", 4500, 1, 1, "fixed", 0],
      ["agency_fee", "Frais d'agence", 0, 1, 1, "percentage_day", 20],
    ],
  },
];

const listFromText = (value: unknown) =>
  String(value ?? "")
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);

const textFromList = (value: unknown) => Array.isArray(value) ? value.join("\n") : "";
const numberValue = (value: unknown) => Number(value || 0) || 0;
const dateOnly = (value: unknown) => value ? String(value).slice(0, 10) : "";
const normalizeRhythm = (value: unknown) => value === "intense" ? "sustained" : String(value || "moderate");
const normalizeTextKey = (value: unknown) => String(value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const uniqueList = (items: unknown[], max = 12) => {
  const seen = new Set<string>();
  const result: string[] = [];
  items.flatMap((item) => Array.isArray(item) ? item : listFromText(item)).forEach((item) => {
    const label = String(item ?? "").trim();
    const key = normalizeTextKey(label);
    if (!label || !key || seen.has(key)) return;
    seen.add(key);
    result.push(label);
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

const detectTransportModes = (text: string) => uniqueList([
  /shinkansen|bullet train|train rapide/i.test(text) ? "Shinkansen" : null,
  /m[ée]tro|metro|jr|yamanote/i.test(text) ? "Métro / JR" : null,
  /bus priv[ée]|private bus|coach/i.test(text) ? "Bus privé" : null,
  /\btrain\b|gare|station/i.test(text) ? "Train" : null,
  /taxi/i.test(text) ? "Taxi" : null,
  /transfert priv[ée]|private transfer|chauffeur|a[ée]roport/i.test(text) ? "Transfert privé" : null,
  /vol domestique|domestic flight|avion/i.test(text) ? "Vol domestique" : null,
  /ferry|bateau/i.test(text) ? "Ferry" : null,
  /[àa] pied|marche|walking|promenade/i.test(text) ? "À pied" : null,
].filter(Boolean) as string[], 5);

const detectMealPlan = (text: string) => uniqueList([
  /petit[- ]?d[ée]jeuner|breakfast/i.test(text) ? "Petit-déjeuner inclus" : null,
  /d[ée]jeuner inclus|lunch included/i.test(text) ? "Déjeuner inclus" : null,
  /d[îi]ner sp[ée]cial|special dinner/i.test(text) ? "Dîner spécial inclus" : null,
  /d[îi]ner inclus|dinner included/i.test(text) ? "Dîner inclus" : null,
  /repas libres?|free meals/i.test(text) ? "Repas libres" : null,
  /d[ée]jeuner libre/i.test(text) ? "Déjeuner libre" : null,
  /d[îi]ner libre/i.test(text) ? "Dîner libre" : null,
].filter(Boolean) as string[], 4);

const detectRhythm = (text: string) => {
  if (/transfert|transfer|a[ée]roport|gare|shinkansen|vol domestique/i.test(text)) return "transfer";
  if (/libre|repos|free day|quartier libre|shopping/i.test(text)) return "free_day";
  if (/journ[ée]e compl[èe]te|beaucoup|intense|soutenu|plusieurs visites/i.test(text)) return "sustained";
  if (/léger|leger|matin[ée]e libre|rythme doux/i.test(text)) return "light";
  return "moderate";
};

const placeKeywords = [
  "Shibuya", "Asakusa", "Ginza", "Ueno", "Tokyo Tower", "Tokyo Disneyland", "teamLab Planets",
  "Sanctuaire Meiji", "Harajuku", "Akihabara", "Gion", "Fushimi Inari", "Arashiyama", "Kiyomizu-dera",
  "Dotonbori", "Château d'Osaka", "Universal Studios Japan", "Nara", "Todai-ji", "Miyajima",
];

const generateClientFields = (day: any) => {
  const sourceParts = [
    day.source_description,
    day.description_client,
    day.optimized_client_description,
    day.title,
    day.city,
    textFromList(day.visits),
    textFromList(day.optional_visits),
    ...(day.cost_lines ?? []).filter((line: any) => line.is_client_visible).map((line: any) => line.label),
  ];
  const source = sourceParts.filter(Boolean).join("\n").trim();
  const compactSource = source.replace(/\s+/g, " ").trim();
  const inferredRhythm = detectRhythm(source);
  const visibleLines = (day.cost_lines ?? []).filter((line: any) => line.is_client_visible);
  const detectedPlaces = placeKeywords.filter((place) => new RegExp(place.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(source));
  const highlights = uniqueList([...detectedPlaces, ...listFromText(day.visits), ...listFromText(day.client_highlights)], 5);
  const lineInclusions = visibleLines
    .filter((line: any) => !line.is_optional)
    .map((line: any) => line.label)
    .filter(Boolean);
  const keywordInclusions = [
    /guide|francophone/i.test(source) ? "Guide francophone" : null,
    /shinkansen|billet train|train/i.test(source) ? "Billet train / Shinkansen selon programme" : null,
    /transfert priv[ée]|chauffeur|a[ée]roport/i.test(source) ? "Transfert privé" : null,
    /bagage|luggage/i.test(source) ? "Transfert bagages" : null,
    /assistance|whatsapp/i.test(source) ? "Assistance LeJapon.ma" : null,
    /entr[ée]e|billet|ticket|teamlab|disney|universal/i.test(source) ? "Entrées incluses selon programme" : null,
  ].filter(Boolean) as string[];
  const inclusions = withoutSimilar(uniqueList([...lineInclusions, ...keywordInclusions], 6), highlights);
  const options = uniqueList([
    ...listFromText(day.client_options),
    ...listFromText(day.optional_visits),
    ...visibleLines.filter((line: any) => line.is_optional).map((line: any) => line.label).filter(Boolean),
    /disney/i.test(source) ? "Tokyo Disneyland" : null,
    /universal|usj/i.test(source) ? "Universal Studios Japan" : null,
    /kimono/i.test(source) ? "Expérience kimono" : null,
    /sushi/i.test(source) ? "Atelier sushi" : null,
    /d[îi]ner sp[ée]cial/i.test(source) ? "Dîner spécial" : null,
  ].filter(Boolean) as string[], 5);
  const transport = detectTransportModes(source);
  const meals = detectMealPlan(source);
  const fallbackSummary = `${day.city ? `${day.city} : ` : ""}${day.title || "journée au Japon"} avec un programme fluide et adapté à votre rythme.`;
  const sentence = compactSource.match(/^(.{45,170}?[.!?])\s/)?.[1];
  const summary = sentence || (compactSource ? `${compactSource.slice(0, 150).replace(/\s+\S*$/, "").trim()}.` : fallbackSummary);

  return {
    source_description: day.source_description || day.description_client || textFromList(day.visits),
    sales_summary: day.sales_summary || day.client_summary || summary,
    client_summary: day.client_summary || day.sales_summary || summary,
    optimized_client_description: day.optimized_client_description || day.description_client || compactSource,
    description_client: day.description_client || day.optimized_client_description || compactSource,
    client_highlights: listFromText(day.client_highlights).length ? day.client_highlights : highlights,
    client_inclusions: listFromText(day.client_inclusions).length ? day.client_inclusions : inclusions,
    client_options: listFromText(day.client_options).length ? day.client_options : options,
    transport_modes: listFromText(day.transport_modes).length ? day.transport_modes : (transport.length ? transport : [inferredRhythm === "free_day" ? "Aucun transport prévu" : "À pied"]),
    meals: listFromText(day.meals).length ? day.meals : (meals.length ? meals : ["Repas libres"]),
    meal_plan: listFromText(day.meal_plan).length ? day.meal_plan : (meals.length ? meals : ["Repas libres"]),
    meal_notes: day.meal_notes || textFromList(meals),
    rhythm: !day.rhythm || day.rhythm === "moderate" ? inferredRhythm : normalizeRhythm(day.rhythm),
    day_pace: !day.day_pace || day.day_pace === "moderate" ? inferredRhythm : normalizeRhythm(day.day_pace),
  };
};
const todayToken = () => new Date().toISOString().slice(0, 10).replaceAll("-", "");
const quoteNumber = () => `FIT-${todayToken()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
const imageUrlsFromForm = (form: any) => listFromText(form.image_urls_text);
const imagePathFromPublicUrl = (url: string) => {
  const marker = "/storage/v1/object/public/programme-images/";
  const index = url.indexOf(marker);
  if (index < 0) return null;
  return decodeURIComponent(url.slice(index + marker.length).split("?")[0]);
};

const fitQuotePayload = (form: any, totals?: Record<string, unknown>, extra?: Record<string, unknown>) => ({
  ...(extra ?? {}),
  client_id: form.client_id || null,
  client_name: form.client_name || "Client FIT",
  travelers_count: Math.max(1, numberValue(form.travelers_count)),
  travel_start_date: form.travel_start_date || null,
  travel_end_date: form.travel_end_date || null,
  hotel_category: form.hotel_category || null,
  room_type: form.room_type || null,
  currency: form.currency || "MAD",
  language: form.language || "fr",
  notes: form.notes || null,
  status: form.status || "draft",
  calculation_mode: form.calculation_mode || "legacy",
  japan_agency_fee_rate: numberValue(form.japan_agency_fee_rate ?? 10),
  lejapon_margin_rate: numberValue(form.lejapon_margin_rate ?? 20),
  margin_scope: form.margin_scope || "program_only",
  rounding_rule: form.rounding_rule || "unit",
  manual_adjustment_mad: numberValue(form.manual_adjustment_mad),
  discount_mad: numberValue(form.discount_mad),
  public_deposit_mad: numberValue(form.public_deposit_mad),
  public_payment_deadline: form.public_payment_deadline || null,
  valid_until: form.valid_until || null,
  client_notes: form.client_notes || null,
  share_token: form.share_token || null,
  share_slug: form.share_slug || null,
  share_enabled: Boolean(form.share_enabled),
  payment_conditions: form.payment_conditions || null,
  booking_conditions: form.booking_conditions || null,
  cancellation_conditions: form.cancellation_conditions || DEFAULT_FIT_CANCELLATION_CONDITIONS,
  production_status: normalizeProductionStatus(form.production_status || form.status),
  japan_request_status: form.japan_request_status || "not_started",
  payment_status: form.payment_status || "not_authorized",
  booking_status: form.booking_status || "not_started",
  reservation_status: form.reservation_status || "not_started",
  production_public_note: form.production_public_note || null,
  japan_request_reference: form.japan_request_reference || null,
  japan_request_deadline: form.japan_request_deadline || null,
  japan_response_notes: form.japan_response_notes || null,
  japan_confirmed_price: numberValue(form.japan_confirmed_price),
  japan_conditions: form.japan_conditions || null,
  japan_valid_until: form.japan_valid_until || null,
  inclusions: form.inclusions || null,
  exclusions: form.exclusions || null,
  ...(totals ?? {}),
});

const cleanPayload = (payload: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));

// Quote rows are recreated on save. Preserve the V4/V5 financial overlay so a
// commercial edit cannot silently reset supplier costing fields to their defaults.
const financialOverlayPayload = (line: Record<string, unknown>, estimatedMad: number, sellingMad = 0) => ({
  supplier_id: line.supplier_id || null,
  supplier_quote_id: line.supplier_quote_id || null,
  supplier_confirmation_document_id: line.supplier_confirmation_document_id || null,
  supplier_invoice_id: line.supplier_invoice_id || null,
  supplier_payment_id: line.supplier_payment_id || null,
  estimated_cost: numberValue(line.estimated_cost) > 0 || estimatedMad === 0 ? numberValue(line.estimated_cost) : estimatedMad,
  supplier_quoted_cost: line.supplier_quoted_cost === "" || line.supplier_quoted_cost == null ? null : numberValue(line.supplier_quoted_cost),
  confirmed_cost: line.confirmed_cost === "" || line.confirmed_cost == null ? null : numberValue(line.confirmed_cost),
  final_cost: line.final_cost === "" || line.final_cost == null ? null : numberValue(line.final_cost),
  component_selling_price: numberValue(line.component_selling_price ?? sellingMad),
  cost_currency: line.cost_currency || "MAD",
  exchange_rate_to_mad: Math.max(0.000001, numberValue(line.exchange_rate_to_mad || 1)),
  supplier_payment_status: line.supplier_payment_status || "not_due",
});

const throwIfSupabaseError = (result: { error?: any }, label: string) => {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message ?? "erreur Supabase"}`);
  }
};

const lineSubtotal = (line: any, percentageBase = 0) => {
  if (line.category === "agency_fee" && line.fee_type !== "fixed") {
    return Math.round((percentageBase * numberValue(line.percentage_rate)) / 100);
  }
  return Math.round(numberValue(line.price_mad ?? line.unit_cost_mad) * numberValue(line.quantity) * numberValue(line.times ?? 1));
};

const calculationMode = (quote: any) => quote?.calculation_mode || "legacy";
const isAutoV2 = (quote: any) => calculationMode(quote) === "automatic_v2";
const lineIncluded = (line: any) => line.included_in_calculation !== false;
const lineRole = (line: any) => line.cost_role || (line.category === "agency_fee" ? "japan_agency_fee_auto" : "supplier_cost");
const isSupplierCostLine = (line: any) => lineIncluded(line) && lineRole(line) === "supplier_cost" && line.category !== "agency_fee";
const isLegacyAgencyMarginLine = (line: any) => line.category === "agency_fee" || line.category === "agency_margin";
const sumLines = (lines: any[], predicate: (line: any) => boolean) =>
  lines.filter(predicate).reduce((sum, line) => sum + numberValue(line.subtotal_mad ?? line.total_mad), 0);
const roundAmount = (value: number, rule: string | undefined) => {
  const step = rule === "hundred" ? 100 : rule === "ten" ? 10 : 1;
  return Math.round(value / step) * step;
};

const recalcLines = (lines: any[]) => {
  const base = lines
    .filter((line) => !isLegacyAgencyMarginLine(line))
    .filter(lineIncluded)
    .reduce((sum, line) => sum + lineSubtotal(line), 0);
  return lines.map((line, index) => ({
    ...line,
    local_id: line.local_id ?? line.id ?? crypto.randomUUID(),
    sort_order: index,
    subtotal_mad: lineSubtotal(line, base),
  }));
};

const recalcSpecialLines = (lines: any[]) =>
  recalcLines(lines).map((line) => ({ ...line, total_mad: numberValue(line.subtotal_mad) }));

const legacyRecalcDay = (day: any) => {
  const lines = recalcLines(day.cost_lines ?? []);
  const supplierCost = sumLines(lines, (line) => lineIncluded(line) && !isLegacyAgencyMarginLine(line));
  const agencyMargin = sumLines(lines, (line) => lineIncluded(line) && isLegacyAgencyMarginLine(line));
  return { ...day, cost_lines: lines, cost_mad: supplierCost, selling_price_mad: supplierCost + agencyMargin };
};

const autoV2RecalcDayBase = (day: any, quote: any) => {
  const lines = recalcLines(day.cost_lines ?? []);
  const travelers = Math.max(1, numberValue(quote?.travelers_count || day.pax_group_size || 1));
  const groundCost = sumLines(lines, isSupplierCostLine);
  const japanRate = day.japan_agency_fee_rate_override !== null && day.japan_agency_fee_rate_override !== undefined && String(day.japan_agency_fee_rate_override) !== ""
    ? numberValue(day.japan_agency_fee_rate_override)
    : numberValue(quote?.japan_agency_fee_rate ?? 10);
  const japanFee = roundAmount((groundCost * japanRate) / 100, quote?.rounding_rule);
  const projectCost = groundCost + japanFee;
  return {
    ...day,
    cost_lines: lines,
    cost_mad: groundCost,
    selling_price_mad: projectCost,
    calculated_ground_cost: groundCost,
    calculated_japan_agency_fee: japanFee,
    calculated_project_cost: projectCost,
    calculated_margin: 0,
    calculated_sale_price: projectCost,
    calculated_sale_price_per_person: projectCost / travelers,
  };
};

const recalcDay = (day: any, quote?: any) => isAutoV2(quote) ? autoV2RecalcDayBase(day, quote) : legacyRecalcDay(day);

const calculateTemplatePricing = (template: any) => {
  const lines = recalcLines(template.default_cost_lines ?? []);
  const groundCost = sumLines(lines, isSupplierCostLine);
  const japanFee = Math.round((groundCost * 10) / 100);
  const projectCost = groundCost + japanFee;
  const margin = Math.round((projectCost * numberValue(template.margin_percent ?? 20)) / 100);
  const salePrice = projectCost + margin;
  const mode = template.partner_net_pricing_mode || "auto";
  return {
    lines,
    groundCost,
    japanFee,
    projectCost,
    margin,
    salePrice,
    partnerNet: mode === "manual" ? numberValue(template.partner_net_price_mad) : salePrice,
    includedLines: lines.filter(lineIncluded).length,
    visibleLines: lines.filter((line) => line.is_client_visible).length,
    partnerOptions: lines.filter((line) => line.can_partner_disable || line.is_optional).length,
  };
};

const applyTemplatePricing = (template: any) => {
  const pricing = calculateTemplatePricing(template);
  const isAuto = (template.partner_net_pricing_mode || "auto") !== "manual";
  return {
    ...template,
    default_cost_lines: pricing.lines,
    estimated_cost_mad: pricing.groundCost,
    default_selling_price_mad: pricing.salePrice,
    partner_net_price_mad: isAuto ? pricing.salePrice : numberValue(template.partner_net_price_mad),
    calculated_ground_cost_mad: pricing.groundCost,
    calculated_japan_agency_fee_mad: pricing.japanFee,
    calculated_project_cost_mad: pricing.projectCost,
    calculated_margin_mad: pricing.margin,
    calculated_sale_price_mad: pricing.salePrice,
  };
};

const cloneTemplateLines = (template: any, travelers: number) => {
  const pax = Math.max(1, numberValue(travelers));
  return recalcLines((template.default_cost_lines ?? []).map((line: any, index: number) => {
    const quantity = numberValue(line.quantity) === numberValue(template.pax_group_size ?? 2) ? pax : numberValue(line.quantity ?? 1);
    return {
      local_id: crypto.randomUUID(),
      template_line_id: line.id ?? null,
      sort_order: index,
      category: line.category ?? "other",
      label: line.label ?? "",
      price_mad: numberValue(line.price_mad ?? line.unit_cost_mad),
      price_jpy: numberValue(line.price_jpy),
      quantity,
      times: numberValue(line.times ?? 1),
      fee_type: line.fee_type ?? "fixed",
      percentage_rate: numberValue(line.percentage_rate),
      notes: line.notes ?? "",
      is_optional: Boolean(line.is_optional),
      is_client_visible: Boolean(line.is_client_visible),
      included_in_calculation: line.included_in_calculation !== false,
      cost_role: line.cost_role || (line.category === "agency_fee" ? "japan_agency_fee_auto" : "supplier_cost"),
      partner_visible: line.partner_visible !== false,
      can_partner_disable: Boolean(line.is_optional),
      affects_partner_net_price: line.affects_partner_net_price !== false,
      net_price_impact: numberValue(line.net_price_impact ?? line.subtotal_mad),
    };
  }));
};

const dayFromTemplate = (template: any, index: number, travelers: number, quote?: any) => recalcDay({
  local_id: crypto.randomUUID(),
  template_id: template?.id ?? null,
  day_number: index + 1,
  sort_order: index,
  date: "",
  title: template?.title ?? "Journée sur mesure",
  city: template?.city ?? "",
  source_description: template?.source_description ?? template?.description_client ?? "",
  sales_summary: template?.sales_summary ?? template?.client_summary ?? "",
  optimized_client_description: template?.optimized_client_description ?? template?.description_client ?? "",
  description_client: template?.optimized_client_description ?? template?.description_client ?? "",
  client_summary: template?.sales_summary ?? template?.client_summary ?? "",
  client_highlights: template?.client_highlights ?? template?.included_visits ?? [],
  client_inclusions: template?.client_inclusions ?? [],
  client_options: template?.client_options ?? template?.optional_visits ?? [],
  visits: template?.included_visits ?? [],
  optional_visits: template?.optional_visits ?? [],
  rhythm: normalizeRhythm(template?.day_pace ?? template?.rhythm),
  day_pace: normalizeRhythm(template?.day_pace ?? template?.rhythm),
  transport_type: template?.transport_type ?? "",
  transport_modes: template?.transport_modes ?? [],
  guide_required: Boolean(template?.guide_required),
  hotel_night: template?.hotel_night ?? true,
  meal_notes: template?.meal_notes ?? "",
  meals: template?.meal_plan ?? template?.meals ?? [],
  meal_plan: template?.meal_plan ?? template?.meals ?? [],
  pax_group_size: Math.max(1, numberValue(travelers)),
  cost_jpy: numberValue(template?.estimated_cost_jpy),
  cost_mad: numberValue(template?.estimated_cost_mad),
  selling_price_mad: numberValue(template?.default_selling_price_mad),
  notes: "",
  internal_notes: template?.internal_notes ?? "",
  image_urls: template?.image_urls ?? [],
  cost_lines: cloneTemplateLines(template, travelers),
}, quote);

const blankDay = (index: number, travelers: number, quote?: any) => dayFromTemplate({ title: "Journée personnalisée", default_cost_lines: [] }, index, travelers, quote);

function legacyCalculateFitQuote(days: any[], quote: any, lines: any[], hotelLines: any[], flightLines: any[]) {
  const normalizedDays = days.map((day) => legacyRecalcDay(day));
  const dayCost = normalizedDays.reduce((sum, day) => sum + numberValue(day.cost_mad), 0);
  const dayMargin = normalizedDays.reduce((sum, day) => sum + sumLines(day.cost_lines ?? [], (line) => lineIncluded(line) && isLegacyAgencyMarginLine(line)), 0);
  const normalizedSpecialLines = recalcSpecialLines(lines);
  const specialCost = sumLines(normalizedSpecialLines, (line) => lineIncluded(line) && !isLegacyAgencyMarginLine(line));
  const specialMargin = sumLines(normalizedSpecialLines, (line) => lineIncluded(line) && isLegacyAgencyMarginLine(line));
  const hotelTotal = hotelLines.reduce((sum, line) => sum + numberValue(line.subtotal_mad), 0);
  const flightTotal = flightLines
    .filter((line) => (line.status || "included") === "included")
    .reduce((sum, line) => sum + numberValue(line.subtotal_mad), 0);
  const manual = numberValue(quote.manual_adjustment_mad);
  const discount = numberValue(quote.discount_mad);
  const totalCost = dayCost + specialCost + hotelTotal + flightTotal;
  const agencyMargin = dayMargin + specialMargin;
  const totalSelling = Math.max(0, totalCost + agencyMargin + manual - discount);
  const realMargin = totalSelling - totalCost;
  const travelers = Math.max(1, numberValue(quote.travelers_count));
  const dayLines = normalizedDays.flatMap((day) => day.cost_lines ?? []);
  const categoryTotal = (category: string) => dayLines.filter((line) => line.category === category && lineIncluded(line)).reduce((sum, line) => sum + numberValue(line.subtotal_mad), 0);
  const totals = {
    total_cost_mad: totalCost,
    total_selling_price_mad: totalSelling,
    margin_amount_mad: realMargin,
    margin_percent: totalSelling > 0 ? (realMargin / totalSelling) * 100 : 0,
    price_per_person_mad: totalSelling / travelers,
    ground_cost_total_mad: totalCost,
    japan_agency_fee_total_mad: 0,
    project_cost_total_mad: totalCost,
    hotel_total_mad: hotelTotal,
    hotel_cost_mad: hotelTotal,
    flight_cost_mad: flightTotal,
    transport_total_mad: categoryTotal("transport"),
    guide_total_mad: categoryTotal("guide"),
    activities_total_mad: categoryTotal("visit"),
    other_total_mad: categoryTotal("luggage") + categoryTotal("other") + specialCost,
  };
  return { days: normalizedDays, specialLines: normalizedSpecialLines, totals };
}

function autoV2CalculateFitQuote(days: any[], quote: any, lines: any[], hotelLines: any[], flightLines: any[]) {
  const baseDays = days.map((day) => autoV2RecalcDayBase(day, quote));
  const normalizedSpecialLines = recalcSpecialLines(lines);
  const specialCost = sumLines(normalizedSpecialLines, isSupplierCostLine);
  const hotelTotal = hotelLines.reduce((sum, line) => sum + numberValue(line.subtotal_mad), 0);
  const flightTotal = flightLines
    .filter((line) => (line.status || "included") === "included")
    .reduce((sum, line) => sum + numberValue(line.subtotal_mad), 0);
  const programGround = baseDays.reduce((sum, day) => sum + numberValue(day.calculated_ground_cost), 0);
  const programJapanFee = baseDays.reduce((sum, day) => sum + numberValue(day.calculated_japan_agency_fee), 0);
  const programProject = baseDays.reduce((sum, day) => sum + numberValue(day.calculated_project_cost), 0);
  const groundTotal = programGround + hotelTotal + flightTotal + specialCost;
  const projectTotal = groundTotal + programJapanFee;
  const scope = quote?.margin_scope || "program_only";
  const marginBase = scope === "all"
    ? projectTotal
    : scope === "program_hotels_flights"
      ? programProject + hotelTotal + flightTotal
      : scope === "program_hotels"
        ? programProject + hotelTotal
        : programProject;
  const margin = roundAmount((marginBase * numberValue(quote?.lejapon_margin_rate ?? 20)) / 100, quote?.rounding_rule);
  const manual = numberValue(quote.manual_adjustment_mad);
  const discount = numberValue(quote.discount_mad);
  const totalSelling = Math.max(0, roundAmount(projectTotal + margin + manual - discount, quote?.rounding_rule));
  const realMargin = totalSelling - projectTotal;
  const travelers = Math.max(1, numberValue(quote.travelers_count));
  let allocatedMargin = 0;
  const normalizedDays = baseDays.map((day, index) => {
    const isLast = index === baseDays.length - 1;
    const share = programProject > 0 ? numberValue(day.calculated_project_cost) / programProject : 0;
    const dayMargin = isLast ? margin - allocatedMargin : roundAmount(margin * share, quote?.rounding_rule);
    allocatedMargin += dayMargin;
    const sale = roundAmount(numberValue(day.calculated_project_cost) + dayMargin, quote?.rounding_rule);
    return {
      ...day,
      selling_price_mad: sale,
      calculated_margin: dayMargin,
      calculated_sale_price: sale,
      calculated_sale_price_per_person: sale / travelers,
    };
  });
  const dayLines = normalizedDays.flatMap((day) => day.cost_lines ?? []);
  const categoryTotal = (category: string) => dayLines
    .filter((line) => line.category === category && isSupplierCostLine(line))
    .reduce((sum, line) => sum + numberValue(line.subtotal_mad), 0);
  const totals = {
    total_cost_mad: groundTotal,
    total_selling_price_mad: totalSelling,
    margin_amount_mad: realMargin,
    margin_percent: totalSelling > 0 ? (realMargin / totalSelling) * 100 : 0,
    price_per_person_mad: totalSelling / travelers,
    ground_cost_total_mad: groundTotal,
    japan_agency_fee_total_mad: programJapanFee,
    project_cost_total_mad: projectTotal,
    hotel_total_mad: hotelTotal,
    hotel_cost_mad: hotelTotal,
    flight_cost_mad: flightTotal,
    transport_total_mad: categoryTotal("transport") + categoryTotal("transfer") + categoryTotal("train") + categoryTotal("bus"),
    guide_total_mad: categoryTotal("guide"),
    activities_total_mad: categoryTotal("visit") + categoryTotal("activities"),
    other_total_mad: categoryTotal("luggage") + categoryTotal("meal") + categoryTotal("other") + specialCost,
  };
  return { days: normalizedDays, specialLines: normalizedSpecialLines, totals };
}

function calculateFitQuote(days: any[], quote: any, lines: any[], hotelLines: any[], flightLines: any[]) {
  return isAutoV2(quote)
    ? autoV2CalculateFitQuote(days, quote, lines, hotelLines, flightLines)
    : legacyCalculateFitQuote(days, quote, lines, hotelLines, flightLines);
}

const normalizeTemplateForForm = (template: any) => ({
  ...emptyTemplate,
  ...template,
  source_description: template.source_description ?? template.description_client ?? "",
  sales_summary: template.sales_summary ?? template.client_summary ?? "",
  optimized_client_description: template.optimized_client_description ?? template.description_client ?? "",
  rhythm: normalizeRhythm(template.day_pace ?? template.rhythm),
  client_highlights_text: textFromList(template.client_highlights),
  client_inclusions_text: textFromList(template.client_inclusions),
  client_options_text: textFromList(template.client_options),
  meals_text: textFromList(template.meals),
  meal_plan_text: textFromList(template.meal_plan ?? template.meals),
  transport_modes_text: textFromList(template.transport_modes),
  included_visits_text: textFromList(template.included_visits),
  optional_visits_text: textFromList(template.optional_visits),
  image_urls_text: textFromList(template.image_urls),
  tags_text: textFromList(template.tags),
  default_cost_lines: (template.default_cost_lines ?? []).map((line: any) => ({ ...line, local_id: line.id ?? crypto.randomUUID() })),
});

const partnerTemplateIssues = (template: any) => {
  if (template.partner_publish_status !== "published") return [];
  const issues: string[] = [];
  if (!String(template.title ?? "").trim()) issues.push("titre manquant");
  if (template.is_active === false) issues.push("template inactif");
  if (!String(template.sales_summary ?? template.client_summary ?? template.optimized_client_description ?? template.description_client ?? "").trim()) {
    issues.push("description client manquante");
  }
  if (numberValue(template.partner_net_price_mad) <= 0) issues.push("tarif net agence manquant");
  return issues;
};

export default function FitQuotes() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [templates, setTemplates] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [templateForm, setTemplateForm] = useState<any>(emptyTemplate);
  const [quoteForm, setQuoteForm] = useState<any>(emptyQuote);
  const [selectedQuote, setSelectedQuote] = useState<any>(null);
  const [quoteDays, setQuoteDays] = useState<any[]>([]);
  const [costLines, setCostLines] = useState<any[]>([]);
  const [hotelLines, setHotelLines] = useState<any[]>([]);
  const [flightLines, setFlightLines] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [duplicateTarget, setDuplicateTarget] = useState<any>(null);
  const [duplicateAndEdit, setDuplicateAndEdit] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [versionTarget, setVersionTarget] = useState<any>(null);
  const [versioning, setVersioning] = useState(false);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: "", method: "bank_transfer", reference: "" });

  const load = async () => {
    const [{ data: templateRows }, { data: templateLines }, { data: quoteRows }, { data: clientRows }] = await Promise.all([
      db.from("fit_day_templates").select("*").order("city").order("title"),
      db.from("fit_day_template_cost_lines").select("*").order("sort_order"),
      db.from("fit_quotes").select("*, clients:client_id(full_name,email,phone)").is("deleted_at", null).is("archived_at", null).order("updated_at", { ascending: false }),
      db.from("clients").select("id,full_name,email,phone").order("full_name").limit(200),
    ]);
    const lineRows = templateLines ?? [];
    setTemplates((templateRows ?? []).map((template: any) => ({
      ...template,
      default_cost_lines: lineRows.filter((line: any) => line.template_id === template.id),
    })));
    setQuotes(quoteRows ?? []);
    setClients(clientRows ?? []);
  };

  useEffect(() => { void load(); }, []);

  const syncPartnerLibrary = async () => {
    const { data, error } = await db.rpc("sync_fit_partner_library");
    if (error) return toast.error(error.message);
    const summary = [
      `${data?.found ?? data?.marked_partner ?? 0} trouvée(s)`,
      `${data?.published ?? data?.synced ?? 0} publiée(s)`,
      `${data?.updated ?? 0} mise(s) à jour`,
      `${data?.archived ?? 0} archivée(s)`,
      `${data?.ignored ?? 0} ignorée(s)`,
    ].join(" · ");
    toast.success(`Bibliothèque partenaire synchronisée : ${summary}`);
    const warnings = Array.isArray(data?.warnings) ? data.warnings : [];
    if (warnings.length) {
      toast.warning("Certaines journées ne sont pas publiables", {
        description: warnings.slice(0, 6).map((item: any) => `${item.title || "Journée"} : ${item.reason}`).join("\n"),
      });
    }
    void load();
  };

  const fillPartnerNetFromSale = async (template?: any) => {
    const candidates = template
      ? [template]
      : templates.filter((item) =>
          item.partner_publish_status === "published"
          && numberValue(item.partner_net_price_mad) <= 0
          && numberValue(item.default_selling_price_mad) > 0
        );
    if (!candidates.length) return toast.info("Aucun tarif net agence à remplir depuis la vente.");
    const updates = candidates.map((item) =>
      db
        .from("fit_day_templates")
        .update({ partner_net_price_mad: numberValue(item.default_selling_price_mad) })
        .eq("id", item.id)
    );
    const results = await Promise.all(updates);
    const error = results.find((result: any) => result.error)?.error;
    if (error) return toast.error(error.message);
    toast.success(`${candidates.length} tarif(s) net agence rempli(s) depuis la vente.`);
    void load();
  };

  const calculation = useMemo(
    () => calculateFitQuote(quoteDays, quoteForm, costLines, hotelLines, flightLines),
    [quoteDays, quoteForm, costLines, hotelLines, flightLines],
  );
  const totals = calculation.totals;
  const calculatedQuoteDays = calculation.days;
  const calculatedCostLines = calculation.specialLines;
  const calculatedDayByLocal = useMemo(
    () => new Map(calculatedQuoteDays.map((day: any) => [day.local_id, day])),
    [calculatedQuoteDays],
  );
  const shareUrl = quoteForm.share_token ? `${window.location.origin}/devis-fit/${quoteForm.share_token}` : "";
  const currentQuotes = useMemo(() => quotes.filter((quote) => quote.is_current_version !== false), [quotes]);
  const quoteVersions = useMemo(() => {
    if (!selectedQuote) return [];
    const groupId = selectedQuote.quote_group_id || selectedQuote.id;
    return quotes
      .filter((quote) => (quote.quote_group_id || quote.id) === groupId)
      .sort((a, b) => numberValue(b.version_number) - numberValue(a.version_number));
  }, [quotes, selectedQuote]);
  const isHistoricalVersion = selectedQuote?.is_current_version === false;

  const publicExpiryInput = (() => {
    if (!quoteForm.public_link_expires_at) return "";
    const date = new Date(quoteForm.public_link_expires_at);
    if (Number.isNaN(date.getTime())) return "";
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  })();

  const loadQuote = async (quote: any) => {
    setSelectedQuote(quote);
    setQuoteForm({
      ...emptyQuote,
      ...quote,
      client_id: quote.client_id ?? "",
      travel_start_date: dateOnly(quote.travel_start_date),
      travel_end_date: dateOnly(quote.travel_end_date),
      valid_until: dateOnly(quote.valid_until),
    });
    const [{ data: days }, { data: dayLines }, { data: lines }, { data: hotels }, { data: flights }, { data: timelineRows }] = await Promise.all([
      db.from("fit_quote_days").select("*").eq("quote_id", quote.id).order("sort_order"),
      db.from("fit_quote_day_cost_lines").select("*").eq("quote_id", quote.id).order("sort_order"),
      db.from("fit_quote_cost_lines").select("*").eq("quote_id", quote.id).order("sort_order"),
      db.from("fit_quote_hotel_lines").select("*").eq("quote_id", quote.id).order("sort_order"),
      db.from("fit_quote_flight_lines").select("*").eq("quote_id", quote.id).order("sort_order"),
      db.rpc("get_fit_quote_commercial_timeline_v3", { p_quote_id: quote.id }),
    ]);
    setTimeline(Array.isArray(timelineRows) ? timelineRows : []);
    const lineRows = dayLines ?? [];
    const quoteForCalculation = { ...emptyQuote, ...quote };
    setQuoteDays((days ?? []).map((day: any) => recalcDay({
      ...day,
      local_id: day.local_key || day.id || crypto.randomUUID(),
      source_description: day.source_description ?? day.description_client ?? "",
      sales_summary: day.sales_summary ?? day.client_summary ?? "",
      optimized_client_description: day.optimized_client_description ?? day.description_client ?? "",
      rhythm: normalizeRhythm(day.day_pace ?? day.rhythm),
      day_pace: normalizeRhythm(day.day_pace ?? day.rhythm),
      meal_plan: day.meal_plan ?? day.meals ?? [],
      cost_lines: lineRows.filter((line: any) => line.day_id === day.id).map((line: any) => ({ ...line, local_id: line.id ?? crypto.randomUUID() })),
    }, quoteForCalculation)));
    setCostLines((lines ?? []).map((line: any) => ({ ...line, local_id: line.id ?? crypto.randomUUID(), price_mad: line.price_mad ?? line.unit_cost_mad, times: line.times ?? 1 })));
    setHotelLines((hotels ?? []).map((line: any) => ({ ...line, local_id: line.id ?? crypto.randomUUID() })));
    setFlightLines((flights ?? []).map((line: any) => ({ ...line, local_id: line.id ?? crypto.randomUUID() })));
  };

  const requestedQuoteId = searchParams.get("quote");
  useEffect(() => {
    if (!requestedQuoteId || selectedQuote?.id === requestedQuoteId || quotes.length === 0) return;
    const requestedQuote = quotes.find((quote) => quote.id === requestedQuoteId);
    if (requestedQuote) void loadQuote(requestedQuote);
  }, [quotes, requestedQuoteId, selectedQuote?.id]);

  const saveTemplate = async () => {
    if (!templateForm.title.trim()) return toast.error("Titre requis.");
    const pricedTemplateForm = applyTemplatePricing(templateForm);
    const pricedLines = recalcLines(pricedTemplateForm.default_cost_lines ?? []);
    const partnerCostLines = pricedLines
      .filter((line) => lineIncluded(line) && lineRole(line) === "supplier_cost" && line.category !== "agency_fee")
      .filter((line) => line.partner_visible !== false && (line.label || line.metadata?.contents));
    const partnerComponentTotal = partnerCostLines.reduce((sum, line) => sum + numberValue(line.subtotal_mad), 0);
    const effectivePartnerNet = pricedTemplateForm.partner_net_pricing_mode === "manual"
      ? numberValue(pricedTemplateForm.partner_net_price_mad)
      : partnerComponentTotal;
    const payload = {
      title: pricedTemplateForm.title.trim(),
      city: pricedTemplateForm.city || null,
      theme: pricedTemplateForm.theme || null,
      duration: pricedTemplateForm.duration || null,
      description_client: pricedTemplateForm.description_client || null,
      source_description: pricedTemplateForm.source_description || pricedTemplateForm.description_client || null,
      sales_summary: pricedTemplateForm.sales_summary || pricedTemplateForm.client_summary || null,
      optimized_client_description: pricedTemplateForm.optimized_client_description || pricedTemplateForm.description_client || null,
      client_summary: pricedTemplateForm.client_summary || null,
      client_highlights: listFromText(pricedTemplateForm.client_highlights_text),
      client_inclusions: listFromText(pricedTemplateForm.client_inclusions_text),
      client_options: listFromText(pricedTemplateForm.client_options_text),
      internal_notes: pricedTemplateForm.internal_notes || null,
      included_visits: listFromText(pricedTemplateForm.included_visits_text),
      optional_visits: listFromText(pricedTemplateForm.optional_visits_text),
      rhythm: normalizeRhythm(pricedTemplateForm.rhythm) || null,
      day_pace: normalizeRhythm(pricedTemplateForm.rhythm) || null,
      transport_type: pricedTemplateForm.transport_type || null,
      transport_modes: listFromText(pricedTemplateForm.transport_modes_text),
      guide_required: Boolean(pricedTemplateForm.guide_required),
      hotel_night: Boolean(pricedTemplateForm.hotel_night),
      meal_notes: pricedTemplateForm.meal_notes || null,
      meals: listFromText(pricedTemplateForm.meal_plan_text || pricedTemplateForm.meals_text),
      meal_plan: listFromText(pricedTemplateForm.meal_plan_text || pricedTemplateForm.meals_text),
      pax_group_size: Math.max(1, numberValue(pricedTemplateForm.pax_group_size)),
      estimated_cost_jpy: numberValue(pricedTemplateForm.estimated_cost_jpy),
      estimated_cost_mad: numberValue(pricedTemplateForm.estimated_cost_mad),
      default_selling_price_mad: numberValue(pricedTemplateForm.default_selling_price_mad),
      partner_publish_status: pricedTemplateForm.partner_publish_status || "internal",
      partner_net_pricing_mode: pricedTemplateForm.partner_net_pricing_mode || "auto",
      partner_net_price_mad: effectivePartnerNet,
      calculated_ground_cost_mad: numberValue(pricedTemplateForm.calculated_ground_cost_mad),
      calculated_japan_agency_fee_mad: numberValue(pricedTemplateForm.calculated_japan_agency_fee_mad),
      calculated_project_cost_mad: numberValue(pricedTemplateForm.calculated_project_cost_mad),
      calculated_margin_mad: numberValue(pricedTemplateForm.calculated_margin_mad),
      calculated_sale_price_mad: numberValue(pricedTemplateForm.calculated_sale_price_mad),
      margin_percent: numberValue(pricedTemplateForm.margin_percent),
      image_urls: listFromText(pricedTemplateForm.image_urls_text),
      tags: listFromText(pricedTemplateForm.tags_text),
      is_active: Boolean(pricedTemplateForm.is_active),
    };
    const result = templateForm.id
      ? await db.from("fit_day_templates").update(payload).eq("id", templateForm.id).select("id").single()
      : await db.from("fit_day_templates").insert(payload).select("id").single();
    if (result.error) return toast.error(result.error.message);
    const templateId = result.data.id;
    if (payload.partner_publish_status === "published" && partnerComponentTotal <= 0) {
      toast.warning("Cette journée est marquée partenaire mais aucune ligne de calcul tarifaire active n’est publiable.");
      await db.from("fit_partner_day_templates").update({ is_published: false }).eq("source_template_id", templateId);
    } else if (payload.partner_publish_status === "published") {
      const partnerPayload = {
        source_template_id: templateId,
        title: payload.title,
        city: payload.city,
        theme: payload.theme,
        day_pace: payload.day_pace,
        sales_summary: payload.sales_summary,
        description_client: payload.description_client,
        optimized_client_description: payload.optimized_client_description,
        client_highlights: payload.client_highlights,
        client_inclusions: payload.client_inclusions,
        client_options: payload.client_options,
        transport_modes: payload.transport_modes,
        meal_plan: payload.meal_plan,
        image_urls: payload.image_urls,
        partner_net_price_mad: partnerComponentTotal,
        is_published: partnerComponentTotal > 0,
      };
      const { data: partnerTemplate, error: partnerError } = await db
        .from("fit_partner_day_templates")
        .upsert(partnerPayload, { onConflict: "source_template_id" })
        .select("id")
        .single();
      if (partnerError) toast.warning(`Publication partenaire non mise à jour: ${partnerError.message}`);
      if (partnerTemplate?.id) {
        await db.from("fit_partner_day_template_components").delete().eq("partner_template_id", partnerTemplate.id);
        const publishableCostLines = partnerCostLines;
        const lineComponentType = (line: any) =>
          line.category === "guide" ? "guide"
            : line.category === "train" ? "train"
            : line.category === "flight" ? "transport"
            : line.category === "bus" || line.category === "transport" || line.category === "transfer" ? "transport"
            : line.category === "meal" ? "meal"
            : line.category === "luggage" ? "luggage_transfer"
            : line.category === "visit" ? "entry"
            : "activity";
        const rawComponentRows = publishableCostLines.map((line, index) => {
          const title = line.label || line.metadata?.contents || line.category || "Prestation";
          const canDisable = Boolean(line.is_optional);
          return {
            sort_order: index,
            component_type: lineComponentType(line),
            category: line.category || "other",
            title,
            is_required: !canDisable,
            can_partner_disable: canDisable,
            affects_partner_net_price: true,
            net_price_impact: numberValue(line.subtotal_mad),
            client_text_when_enabled: line.is_client_visible ? title : null,
            client_text_when_disabled: `${title} non inclus`,
          };
        });
        const componentRows = Array.from(rawComponentRows.reduce((map, row) => {
          const key = `${row.component_type}:${row.category}:${row.title.toLowerCase().trim()}:${row.can_partner_disable}`;
          const existing = map.get(key);
          map.set(key, existing ? {
            ...existing,
            sort_order: Math.min(existing.sort_order, row.sort_order),
            net_price_impact: numberValue(existing.net_price_impact) + numberValue(row.net_price_impact),
            client_text_when_enabled: existing.client_text_when_enabled || row.client_text_when_enabled,
          } : row);
          return map;
        }, new Map<string, any>()).values());
        if (componentRows.length) {
          await db.from("fit_partner_day_template_components").insert(componentRows.map((component) => ({
            partner_template_id: partnerTemplate.id,
            partner_visible: true,
            affects_partner_net_price: component.affects_partner_net_price ?? false,
            net_price_impact: numberValue(component.net_price_impact),
            ...component,
          })));
        }
      }
    } else if (templateId) {
      await db.from("fit_partner_day_templates").update({ is_published: false }).eq("source_template_id", templateId);
    }
    await db.from("fit_day_template_cost_lines").delete().eq("template_id", templateId);
    const lines = pricedLines;
    if (lines.length) {
      const { error } = await db.from("fit_day_template_cost_lines").insert(lines.map((line, index) => ({
        template_id: templateId,
        sort_order: index,
        category: line.category || "other",
        label: line.label || "",
        price_mad: numberValue(line.price_mad),
        price_jpy: numberValue(line.price_jpy),
        quantity: numberValue(line.quantity),
        times: numberValue(line.times ?? 1),
        subtotal_mad: numberValue(line.subtotal_mad),
        subtotal_jpy: numberValue(line.subtotal_jpy),
        fee_type: line.fee_type || "fixed",
        percentage_rate: numberValue(line.percentage_rate),
        notes: line.notes || null,
        is_optional: Boolean(line.is_optional),
        is_client_visible: Boolean(line.is_client_visible),
        included_in_calculation: line.included_in_calculation !== false,
        cost_role: line.cost_role || (line.category === "agency_fee" ? "japan_agency_fee_auto" : "supplier_cost"),
        partner_visible: line.partner_visible !== false,
        can_partner_disable: Boolean(line.is_optional),
        affects_partner_net_price: line.affects_partner_net_price !== false,
        net_price_impact: numberValue(line.net_price_impact || line.subtotal_mad),
      })));
      if (error) return toast.error(error.message);
    }
    toast.success("Journée enregistrée.");
    setTemplateOpen(false);
    setTemplateForm(emptyTemplate);
    void load();
  };

  const removeTemplate = async (template: any) => {
    if (!confirm(`Supprimer le template "${template.title}" ?`)) return;
    const { error } = await db.from("fit_day_templates").delete().eq("id", template.id);
    if (error) return toast.error(error.message);
    toast.success("Template supprimé.");
    void load();
  };

  const seedExamples = async () => {
    for (const seed of excelTemplateSeeds) {
      const { data: existing } = await db.from("fit_day_templates").select("id").ilike("title", seed.title).maybeSingle();
      if (existing?.id) continue;
      const { data: template, error } = await db.from("fit_day_templates").insert({
        title: seed.title,
        city: seed.city,
        theme: seed.theme,
        duration: "1 journée",
        description_client: seed.description_client,
        included_visits: [],
        optional_visits: [],
        transport_type: "public_transport",
        guide_required: true,
        hotel_night: true,
        pax_group_size: 2,
        margin_percent: 20,
        tags: [seed.city, seed.theme],
        is_active: true,
      }).select("id").single();
      if (error) return toast.error(error.message);
      await db.from("fit_day_template_cost_lines").insert(seed.lines.map((line, index) => ({
        template_id: template.id,
        sort_order: index,
        category: line[0],
        label: line[1],
        price_mad: line[2],
        quantity: line[3],
        times: line[4],
        fee_type: line[5],
        percentage_rate: line[6],
        subtotal_mad: line[5] === "fixed" ? Number(line[2]) * Number(line[3]) * Number(line[4]) : 0,
      })));
    }
    toast.success("Templates Excel ajoutés.");
    void load();
  };

  const createQuote = async () => {
    const client = clients.find((item) => item.id === quoteForm.client_id);
    const payload = cleanPayload(fitQuotePayload({
      ...quoteForm,
      client_name: quoteForm.client_name || client?.full_name || "Client FIT",
    }, undefined, { quote_number: quoteNumber(), owner_user_id: user?.id ?? null, created_by: user?.id ?? null }));
    const { data, error } = await db.from("fit_quotes").insert(payload).select("*").single();
    if (error) return toast.error(error.message);
    toast.success("Devis FIT créé.");
    setQuoteOpen(false);
    setQuoteForm(emptyQuote);
    await load();
    await loadQuote(data);
  };

  const confirmDuplicate = (quote: any, andEdit = false) => {
    setDuplicateTarget(quote);
    setDuplicateAndEdit(andEdit);
  };

  const duplicateQuote = async () => {
    if (!duplicateTarget?.id) return;
    setDuplicating(true);
    try {
      const { data, error } = await db.rpc("duplicate_fit_quote", { p_source_quote_id: duplicateTarget.id });
      if (error) throw error;
      if (!data?.ok || !data?.new_quote_id) throw new Error("La copie du devis n’a pas été créée correctement.");
      const { data: createdQuote, error: fetchError } = await db
        .from("fit_quotes")
        .select("*, clients:client_id(full_name,email,phone)")
        .eq("id", data.new_quote_id)
        .single();
      if (fetchError || !createdQuote) throw fetchError || new Error("Copie créée mais impossible à ouvrir.");
      const duplicatedQuote = { ...createdQuote, duplicated_from_reference: data.source_reference };
      setDuplicateTarget(null);
      await load();
      await loadQuote(duplicatedQuote);
      toast.success(`Devis ${data.new_reference} créé.`, {
        description: `Copie de ${data.source_reference}. Le devis original reste inchangé.`,
      });
    } catch (error: any) {
      toast.error(error?.message || "Impossible de dupliquer ce devis FIT.");
    } finally {
      setDuplicating(false);
    }
  };

  const createNewVersion = async () => {
    if (!versionTarget?.id) return;
    setVersioning(true);
    try {
      const { data, error } = await db.rpc("create_new_fit_quote_version", { p_source_quote_id: versionTarget.id });
      if (error) throw error;
      const { data: createdQuote, error: fetchError } = await db
        .from("fit_quotes")
        .select("*, clients:client_id(full_name,email,phone)")
        .eq("id", data?.new_quote_id)
        .single();
      if (fetchError || !createdQuote) throw fetchError || new Error("La nouvelle version ne peut pas être ouverte.");
      setVersionTarget(null);
      await load();
      await loadQuote(createdQuote);
      void db.functions.invoke("send-admin-notification", { body: { event_type: "fit_quote_revision_ready", quote_id: createdQuote.id } });
      toast.success(`Version V${data.version_number} créée.`, {
        description: `${data.family_reference} reste lié à son historique. V${data.version_number - 1} est désormais en lecture seule.`,
      });
    } catch (error: any) {
      toast.error(error?.message || "Impossible de créer une nouvelle version.");
    } finally {
      setVersioning(false);
    }
  };

  const addTemplateDay = (templateId: string) => {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    setQuoteDays((current) => current.concat(dayFromTemplate(template, current.length, quoteForm.travelers_count, quoteForm)));
  };

  const addBlankDay = () => setQuoteDays((current) => current.concat(blankDay(current.length, quoteForm.travelers_count, quoteForm)));
  const duplicateDay = (day: any) => setQuoteDays((current) => current.concat(recalcDay({ ...day, id: undefined, local_id: crypto.randomUUID(), sort_order: current.length, day_number: current.length + 1, title: `${day.title} (copie)`, cost_lines: (day.cost_lines ?? []).map((line: any) => ({ ...line, id: undefined, local_id: crypto.randomUUID() })) }, quoteForm)));
  const removeDay = (localId: string) => setQuoteDays((current) => current.filter((day) => day.local_id !== localId).map((day, index) => ({ ...day, sort_order: index, day_number: index + 1 })));
  const updateDay = (localId: string, patch: any) => setQuoteDays((current) => current.map((day) => day.local_id === localId ? recalcDay({ ...day, ...patch }, quoteForm) : day));
  const generateDayWithAI = (day: any) => {
    updateDay(day.local_id, generateClientFields(day));
    toast.success("Champs client générés. Vous pouvez les ajuster avant sauvegarde.");
  };
  const updateDayLine = (dayId: string, lineId: string, patch: any) => updateDay(dayId, {
    cost_lines: quoteDays.find((day) => day.local_id === dayId)?.cost_lines?.map((line: any) => line.local_id === lineId ? { ...line, ...patch } : line) ?? [],
  });
  const addDayLine = (dayId: string) => updateDay(dayId, {
    cost_lines: [
      ...(quoteDays.find((day) => day.local_id === dayId)?.cost_lines ?? []),
      { local_id: crypto.randomUUID(), category: "other", label: "", price_mad: 0, quantity: 1, times: 1, fee_type: "fixed", percentage_rate: 0, notes: "", is_optional: false, is_client_visible: false, included_in_calculation: true, cost_role: "supplier_cost" },
    ],
  });
  const removeDayLine = (dayId: string, lineId: string) => updateDay(dayId, {
    cost_lines: (quoteDays.find((day) => day.local_id === dayId)?.cost_lines ?? []).filter((line: any) => line.local_id !== lineId),
  });
  const reorderDay = (localId: string, direction: -1 | 1) => {
    setQuoteDays((current) => {
      const index = current.findIndex((day) => day.local_id === localId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next.map((day, idx) => ({ ...day, sort_order: idx, day_number: idx + 1 }));
    });
  };
  const dropDayOn = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    setQuoteDays((current) => {
      const from = current.findIndex((day) => day.local_id === dragId);
      const to = current.findIndex((day) => day.local_id === targetId);
      if (from < 0 || to < 0) return current;
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next.map((day, idx) => ({ ...day, sort_order: idx, day_number: idx + 1 }));
    });
    setDragId(null);
  };

  const addCostLine = (category = "other") => setCostLines((current) => current.concat({
    local_id: crypto.randomUUID(),
    sort_order: current.length,
    category,
    label: "",
    price_mad: 0,
    quantity: 1,
    times: 1,
    total_mad: 0,
    notes: "",
    optional: false,
    included_in_calculation: true,
    cost_role: "supplier_cost",
  }));
  const updateCostLine = (localId: string, patch: any) => setCostLines((current) => recalcSpecialLines(current.map((line) => (
    line.local_id === localId ? { ...line, ...patch } : line
  ))));
  const addHotelLine = () => setHotelLines((current) => current.concat({ local_id: crypto.randomUUID(), city: "", hotel_name: "", image_url: "", category: quoteForm.hotel_category || "", room_type: quoteForm.room_type || "", rooms_count: 1, nights: 1, price_per_room_night_mad: 0, subtotal_mad: 0, public_notes: "", notes: "" }));
  const updateHotelLine = (localId: string, patch: any) => setHotelLines((current) => current.map((line) => {
    if (line.local_id !== localId) return line;
    const next = { ...line, ...patch };
    next.subtotal_mad = Math.round(numberValue(next.rooms_count) * numberValue(next.nights) * numberValue(next.price_per_room_night_mad));
    return next;
  }));
  const addFlightLine = () => setFlightLines((current) => current.concat({ local_id: crypto.randomUUID(), route: "", airline: "", status: "included", fare_per_person_mad: 0, passengers_count: quoteForm.travelers_count || 1, subtotal_mad: 0, public_notes: "", notes: "" }));
  const updateFlightLine = (localId: string, patch: any) => setFlightLines((current) => current.map((line) => {
    if (line.local_id !== localId) return line;
    const next = { ...line, ...patch };
    next.subtotal_mad = Math.round(numberValue(next.fare_per_person_mad) * numberValue(next.passengers_count));
    return next;
  }));

  const archiveGeneratedDocuments = async (quoteId: string, version: number, reason = "quote_updated") => {
    const result = await db
      .from("fit_quote_documents")
      .update({
        metadata: {
          archived: true,
          archived_at: new Date().toISOString(),
          archived_reason: reason,
          replaced_by_version: version,
        },
      })
      .eq("quote_id", quoteId)
      .in("document_type", ["client_pdf", "internal_pdf"]);
    throwIfSupabaseError(result, "Archivage anciens PDF");
  };

  const saveQuote = async () => {
    if (!selectedQuote?.id) return toast.error("Sélectionnez un devis.");
    setSaving(true);
    try {
      const quoteCalculation = calculateFitQuote(quoteDays, quoteForm, costLines, hotelLines, flightLines);
      const normalizedDays = quoteCalculation.days;
      const normalizedSpecialLines = quoteCalculation.specialLines;
      const nextVersion = Math.max(1, numberValue(selectedQuote.version_number || quoteForm.version_number || 1));
      const quotePayload = cleanPayload(fitQuotePayload(
        quoteForm,
        quoteCalculation.totals,
        { version_number: nextVersion },
      ));
      const { error: quoteError } = await db.from("fit_quotes").update(quotePayload).eq("id", selectedQuote.id);
      if (quoteError) throw quoteError;

      throwIfSupabaseError(await db.from("fit_quote_day_cost_lines").delete().eq("quote_id", selectedQuote.id), "Suppression anciennes lignes journée");
      throwIfSupabaseError(await db.from("fit_quote_days").delete().eq("quote_id", selectedQuote.id), "Suppression anciens jours");
      const dayRows = normalizedDays.map((day, index) => ({
        quote_id: selectedQuote.id,
        template_id: day.template_id || null,
        local_key: day.local_id,
        day_number: index + 1,
        sort_order: index,
        date: day.date || null,
        title: day.title,
        city: day.city || null,
        source_description: day.source_description || day.description_client || null,
        sales_summary: day.sales_summary || day.client_summary || null,
        optimized_client_description: day.optimized_client_description || day.description_client || null,
        description_client: day.optimized_client_description || day.description_client || null,
        client_summary: day.sales_summary || day.client_summary || null,
        client_highlights: Array.isArray(day.client_highlights) ? day.client_highlights : listFromText(day.client_highlights),
        client_inclusions: Array.isArray(day.client_inclusions) ? day.client_inclusions : listFromText(day.client_inclusions),
        client_options: Array.isArray(day.client_options) ? day.client_options : listFromText(day.client_options),
        visits: Array.isArray(day.visits) ? day.visits : listFromText(day.visits),
        optional_visits: Array.isArray(day.optional_visits) ? day.optional_visits : listFromText(day.optional_visits),
        rhythm: normalizeRhythm(day.day_pace || day.rhythm) || null,
        day_pace: normalizeRhythm(day.day_pace || day.rhythm) || null,
        transport_type: day.transport_type || null,
        transport_modes: Array.isArray(day.transport_modes) ? day.transport_modes : listFromText(day.transport_modes),
        guide_required: Boolean(day.guide_required),
        hotel_night: Boolean(day.hotel_night),
        meal_notes: day.meal_notes || null,
        meals: Array.isArray(day.meals) ? day.meals : listFromText(day.meals),
        meal_plan: Array.isArray(day.meal_plan) ? day.meal_plan : listFromText(day.meal_plan ?? day.meals),
        pax_group_size: Math.max(1, numberValue(day.pax_group_size || quoteForm.travelers_count)),
        cost_jpy: numberValue(day.cost_jpy),
        cost_mad: numberValue(day.cost_mad),
        selling_price_mad: numberValue(day.selling_price_mad),
        japan_agency_fee_rate_override: day.japan_agency_fee_rate_override === "" || day.japan_agency_fee_rate_override === undefined ? null : numberValue(day.japan_agency_fee_rate_override),
        calculated_ground_cost: numberValue(day.calculated_ground_cost ?? day.cost_mad),
        calculated_japan_agency_fee: numberValue(day.calculated_japan_agency_fee),
        calculated_project_cost: numberValue(day.calculated_project_cost ?? day.cost_mad),
        calculated_margin: numberValue(day.calculated_margin),
        calculated_sale_price: numberValue(day.calculated_sale_price ?? day.selling_price_mad),
        calculated_sale_price_per_person: numberValue(day.calculated_sale_price_per_person),
        notes: day.notes || null,
        internal_notes: day.internal_notes || null,
        image_urls: Array.isArray(day.image_urls) ? day.image_urls : listFromText(day.image_urls),
      }));
      const { data: insertedDays, error: dayError } = dayRows.length
        ? await db.from("fit_quote_days").insert(dayRows).select("id,local_key")
        : { data: [], error: null };
      if (dayError) throw dayError;
      const dayIdByLocal = new Map((insertedDays ?? []).map((day: any) => [day.local_key, day.id]));
      const dayLineRows = normalizedDays.flatMap((day) => (day.cost_lines ?? []).map((line: any, index: number) => ({
        quote_id: selectedQuote.id,
        day_id: dayIdByLocal.get(day.local_id),
        template_line_id: line.template_line_id || null,
        sort_order: index,
        category: line.category || "other",
        label: line.label || "",
        price_mad: numberValue(line.price_mad),
        price_jpy: numberValue(line.price_jpy),
        quantity: numberValue(line.quantity),
        times: numberValue(line.times ?? 1),
        subtotal_mad: numberValue(line.subtotal_mad),
        subtotal_jpy: numberValue(line.subtotal_jpy),
        fee_type: line.fee_type || "fixed",
        percentage_rate: numberValue(line.percentage_rate),
        notes: line.notes || null,
        is_optional: Boolean(line.is_optional),
        is_client_visible: Boolean(line.is_client_visible),
        included_in_calculation: line.included_in_calculation !== false,
        cost_role: line.cost_role || (line.category === "agency_fee" ? "japan_agency_fee_auto" : "supplier_cost"),
        ...financialOverlayPayload(line, numberValue(line.subtotal_mad), numberValue(line.subtotal_mad)),
      })).filter((line: any) => line.day_id));
      if (dayLineRows.length) {
        const { error } = await db.from("fit_quote_day_cost_lines").insert(dayLineRows);
        if (error) throw error;
      }

      throwIfSupabaseError(await db.from("fit_quote_cost_lines").delete().eq("quote_id", selectedQuote.id), "Suppression anciennes lignes spéciales");
      if (normalizedSpecialLines.length) {
        const { error } = await db.from("fit_quote_cost_lines").insert(normalizedSpecialLines.map((line, index) => ({
          quote_id: selectedQuote.id,
          sort_order: index,
          category: line.category || "other",
          label: line.label || "",
          quantity: numberValue(line.quantity),
          times: numberValue(line.times ?? 1),
          unit_cost_mad: numberValue(line.price_mad ?? line.unit_cost_mad),
          total_mad: numberValue(line.total_mad ?? line.subtotal_mad),
          notes: line.notes || null,
          optional: Boolean(line.optional),
          included_in_calculation: line.included_in_calculation !== false,
          cost_role: line.cost_role || (line.category === "agency_fee" ? "japan_agency_fee_auto" : "supplier_cost"),
          ...financialOverlayPayload(line, numberValue(line.total_mad ?? line.subtotal_mad), numberValue(line.selling_price_mad)),
        })));
        if (error) throw error;
      }

      throwIfSupabaseError(await db.from("fit_quote_hotel_lines").delete().eq("quote_id", selectedQuote.id), "Suppression anciens hôtels");
      if (hotelLines.length) {
        const { error } = await db.from("fit_quote_hotel_lines").insert(hotelLines.map((line, index) => ({
          quote_id: selectedQuote.id,
          sort_order: index,
          city: line.city || null,
          hotel_name: line.hotel_name || null,
          image_url: line.image_url || null,
          category: line.category || quoteForm.hotel_category || null,
          room_type: line.room_type || null,
          rooms_count: numberValue(line.rooms_count),
          nights: numberValue(line.nights),
          price_per_room_night_mad: numberValue(line.price_per_room_night_mad),
          subtotal_mad: numberValue(line.subtotal_mad),
          notes: line.notes || null,
          public_notes: line.public_notes || null,
          ...financialOverlayPayload(line, numberValue(line.subtotal_mad), numberValue(line.subtotal_mad)),
        })));
        if (error) throw error;
      }

      throwIfSupabaseError(await db.from("fit_quote_flight_lines").delete().eq("quote_id", selectedQuote.id), "Suppression anciens vols");
      if (flightLines.length) {
        const { error } = await db.from("fit_quote_flight_lines").insert(flightLines.map((line, index) => ({
          quote_id: selectedQuote.id,
          sort_order: index,
          route: line.route || null,
          airline: line.airline || null,
          status: line.status || "included",
          fare_per_person_mad: numberValue(line.fare_per_person_mad),
          passengers_count: numberValue(line.passengers_count),
          subtotal_mad: numberValue(line.subtotal_mad),
          notes: line.notes || null,
          public_notes: line.public_notes || null,
          ...financialOverlayPayload(line, numberValue(line.subtotal_mad), numberValue(line.subtotal_mad)),
        })));
        if (error) throw error;
      }
      await archiveGeneratedDocuments(selectedQuote.id, nextVersion);
      toast.success("Devis sauvegardé — lien client et PDF mis à jour.");
      const refreshed = { ...selectedQuote, ...quotePayload };
      setSelectedQuote(refreshed);
      await load();
      await loadQuote(refreshed);
    } catch (error: any) {
      toast.error(error?.message ?? "Impossible d'enregistrer.");
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (status: string) => {
    if (!selectedQuote?.id) return;
    const patch: any = { status, production_status: status };
    if (status === "sent") patch.sent_at = new Date().toISOString();
    if (status === "accepted") patch.accepted_at = new Date().toISOString();
    const { error } = await db.from("fit_quotes").update(patch).eq("id", selectedQuote.id);
    if (error) return toast.error(error.message);
    toast.success("Statut mis à jour.");
    await loadQuote({ ...selectedQuote, ...patch });
    await load();
  };

  const deleteQuote = async () => {
    if (!selectedQuote?.id || !user) return;
    if (!confirm("Voulez-vous vraiment supprimer ce devis ?")) return;
    const { error } = await db.rpc("soft_delete_fit_quote", { _quote_id: selectedQuote.id });
    if (error) return toast.error(error.message);
    setSelectedQuote(null);
    setQuoteForm(emptyQuote);
    setQuoteDays([]);
    setCostLines([]);
    setHotelLines([]);
    setFlightLines([]);
    setQuotes((current) => current.filter((quote) => quote.id !== selectedQuote.id));
    toast.success("Devis FIT supprimé.");
  };

  const archiveQuote = async () => {
    if (!selectedQuote?.id || !user || isHistoricalVersion) return;
    if (!confirm("Archiver ce devis FIT ? Il sera retiré de la liste active.")) return;
    const { error } = await db.from("fit_quotes").update({ archived_at: new Date().toISOString(), archived_by: user.id, share_enabled: false }).eq("id", selectedQuote.id);
    if (error) return toast.error(error.message);
    setSelectedQuote(null);
    setQuotes((current) => current.filter((quote) => quote.id !== selectedQuote.id));
    toast.success("Devis FIT archivé.");
  };

  const auditProduction = async (actionType: string, payload: Record<string, any> = {}) => {
    if (!selectedQuote?.id) return;
    await db.from("quote_audit_logs").insert({
      quote_id: selectedQuote.id,
      organization_id: selectedQuote.partner_organization_id || null,
      user_id: null,
      action_type: actionType,
      payload,
    });
  };

  const updateProduction = async (patch: Record<string, any>, actionType: string) => {
    if (!selectedQuote?.id) return;
    const { error } = await db.from("fit_quotes").update(patch).eq("id", selectedQuote.id);
    if (error) return toast.error(error.message);
    await auditProduction(actionType, patch);
    const next = { ...selectedQuote, ...quoteForm, ...patch };
    setSelectedQuote(next);
    setQuoteForm(next);
    await load();
    toast.success("Workflow production mis à jour.");
  };

  const buildJapanRequestText = () => {
    const quote = { ...selectedQuote, ...quoteForm, ...totals };
    const cities = Array.from(new Set(calculatedQuoteDays.map((day: any) => day.city).filter(Boolean))).join(" → ");
    return [
      `Demande bureau Japon — ${quote.quote_number || "Devis FIT"}`,
      `Agence partenaire : ${quote.partner_organization_id || "LeJapon.ma / interne"}`,
      `Client : ${quote.client_name || "Client FIT"}`,
      `Dates : ${quote.travel_start_date || "à confirmer"} → ${quote.travel_end_date || "à confirmer"}`,
      `Voyageurs : ${quote.travelers_count || 1}`,
      `Villes : ${cities || "à confirmer"}`,
      `Hôtels souhaités : ${quote.hotel_category || "à confirmer"} · ${quote.room_type || "chambre à confirmer"}`,
      `Prix net agence : ${fmtMAD(quote.total_selling_price_mad || 0)} (usage interne production)`,
      "",
      "Journées et prestations demandées :",
      ...calculatedQuoteDays.map((day: any, index: number) => [
        `J${index + 1} — ${day.city || "Japon"} — ${day.title}`,
        `Résumé : ${day.sales_summary || day.client_summary || day.description_client || "—"}`,
        `Inclus : ${textFromList(day.client_inclusions || day.visits) || "—"}`,
        `Transport : ${textFromList(day.transport_modes) || day.transport_type || "—"}`,
        `Repas : ${textFromList(day.meal_plan || day.meals) || day.meal_notes || "—"}`,
      ].join("\n")),
      "",
      "Hôtels :",
      ...(hotelLines.length ? hotelLines.map((hotel: any) => `${hotel.city || "Ville"} — ${hotel.hotel_name || "Hôtel à confirmer"} — ${hotel.nights || 1} nuit(s) — ${hotel.room_type || quote.room_type || "chambre à confirmer"}`) : ["À confirmer selon programme"]),
      "",
      "Contraintes / notes internes LeJapon.ma :",
      quote.notes || "—",
      "",
      `Deadline souhaitée : ${quote.japan_request_deadline || "à préciser"}`,
    ].join("\n");
  };

  const sendToJapan = async () => {
    if (!selectedQuote?.id) return;
    const requestText = buildJapanRequestText();
    await navigator.clipboard?.writeText(requestText).catch(() => undefined);
    await updateProduction({
      status: "japan_request_sent",
      production_status: "japan_request_sent",
      japan_request_status: "sent",
      japan_request_sent_at: new Date().toISOString(),
      japan_request_reference: quoteForm.japan_request_reference || `JP-${quoteForm.quote_number || selectedQuote.quote_number}`,
    }, "admin_sent_to_japan");
    toast.success("Demande Japon copiée et statut mis à jour.");
  };

  const receiveJapanResponse = async () => {
    if (!selectedQuote?.id) return;
    const notes = window.prompt("Réponse / conditions du bureau Japon", quoteForm.japan_response_notes || "");
    if (notes === null) return;
    await updateProduction({
      status: "japan_quote_received",
      production_status: "japan_quote_received",
      japan_request_status: "response_received",
      japan_response_notes: notes,
    }, "japan_response_received");
  };

  const approveForPayment = async () => {
    await updateProduction({
      status: "admin_approved_for_payment",
      production_status: "admin_approved_for_payment",
      japan_request_status: "approved",
      payment_status: "authorized",
      admin_approved_for_payment_at: new Date().toISOString(),
      admin_approved_for_payment_by: user?.id ?? null,
      payment_authorized_at: new Date().toISOString(),
      payment_authorized_by: user?.id ?? null,
      production_public_note: "LeJapon.ma a validé les disponibilités. Le paiement client est autorisé selon les conditions indiquées.",
    }, "admin_approved_for_payment");
  };

  const enableShare = async () => {
    if (!selectedQuote?.id) return;
    if (!quoteForm.share_token) {
      await regenerateShare();
      return;
    }
    const expiresAt = quoteForm.public_link_expires_at || null;
    const { error } = await db.rpc("set_public_fit_quote_link", {
      p_quote_id: selectedQuote.id,
      p_enabled: true,
      p_expires_at: expiresAt,
    });
    if (error) return toast.error(error.message);
    const patch = { share_enabled: true, public_link_revoked_at: null };
    const next = { ...selectedQuote, ...quoteForm, ...patch };
    setSelectedQuote(next);
    setQuoteForm(next);
    await navigator.clipboard?.writeText(shareUrl).catch(() => undefined);
    toast.success("Lien client activé et copié.");
  };

  const regenerateShare = async () => {
    if (!selectedQuote?.id) return;
    const expiresAt = quoteForm.public_link_expires_at || null;
    const { data, error } = await db.rpc("regenerate_public_fit_quote_token", {
      p_quote_id: selectedQuote.id,
      p_expires_at: expiresAt,
    });
    if (error || !data?.token) return toast.error(error?.message || "Impossible de régénérer le lien.");
    const patch = {
      share_token: data.token,
      share_enabled: true,
      public_link_revoked_at: null,
      public_link_expires_at: data.expires_at,
      public_client_status: quoteForm.public_client_status || "quoted",
    };
    const next = { ...selectedQuote, ...quoteForm, ...patch };
    setSelectedQuote(next);
    setQuoteForm(next);
    await navigator.clipboard?.writeText(`${window.location.origin}/devis-fit/${data.token}`).catch(() => undefined);
    toast.success("Nouveau lien privé généré et copié. L’ancien lien est invalide.");
  };

  const sendToClient = async () => {
    if (!selectedQuote?.id || isHistoricalVersion) return;
    if (!quoteForm.share_token) await regenerateShare();
    else await enableShare();
    const sentAt = new Date().toISOString();
    const { error } = await db.rpc("set_fit_commercial_status_v3", {
      p_quote_id: selectedQuote.id,
      p_status: "sent",
      p_reason: null,
      p_override: false,
    });
    if (error) return toast.error(error.message);
    const patch = { status: "sent", commercial_status: "sent", production_status: "sent_to_client", sent_at: sentAt };
    setSelectedQuote((current: any) => ({ ...current, ...patch }));
    setQuoteForm((current: any) => ({ ...current, ...patch }));
    void db.functions.invoke("send-admin-notification", { body: { event_type: "fit_quote_sent", quote_id: selectedQuote.id } });
    toast.success("Devis prêt à être envoyé au client.");
  };

  const copyShare = async () => {
    if (!shareUrl) return toast.error("Générez d’abord un lien client.");
    await navigator.clipboard?.writeText(shareUrl);
    toast.success("Lien client copié.");
  };

  const deactivateShare = async () => {
    if (!selectedQuote?.id || !quoteForm.share_token) return;
    const { error } = await db.rpc("set_public_fit_quote_link", {
      p_quote_id: selectedQuote.id,
      p_enabled: false,
      p_expires_at: quoteForm.public_link_expires_at || null,
    });
    if (error) return toast.error(error.message);
    const patch = { share_enabled: false, public_link_revoked_at: new Date().toISOString() };
    const next = { ...selectedQuote, ...quoteForm, ...patch };
    setSelectedQuote(next);
    setQuoteForm(next);
    toast.success("Lien client désactivé.");
  };

  const savePublicExpiry = async () => {
    if (!selectedQuote?.id || !quoteForm.share_token) return toast.error("Générez d’abord un lien client.");
    const expiresAt = quoteForm.public_link_expires_at || null;
    const { error } = await db.rpc("set_public_fit_quote_link", {
      p_quote_id: selectedQuote.id,
      p_enabled: Boolean(quoteForm.share_enabled),
      p_expires_at: expiresAt,
    });
    if (error) return toast.error(error.message);
    toast.success("Date d’expiration enregistrée.");
  };

  const saveDayAsTemplate = async (day: any) => {
    setTemplateForm(normalizeTemplateForForm({
      title: day.title,
      city: day.city,
      theme: "Sur mesure",
      duration: "1 journée",
      source_description: day.source_description || day.description_client,
      sales_summary: day.sales_summary || day.client_summary,
      optimized_client_description: day.optimized_client_description || day.description_client,
      description_client: day.optimized_client_description || day.description_client,
      client_summary: day.sales_summary || day.client_summary,
      client_highlights: day.client_highlights ?? [],
      client_inclusions: day.client_inclusions ?? [],
      client_options: day.client_options ?? [],
      internal_notes: day.internal_notes,
      included_visits: day.visits ?? [],
      optional_visits: day.optional_visits ?? [],
      rhythm: normalizeRhythm(day.day_pace || day.rhythm),
      day_pace: normalizeRhythm(day.day_pace || day.rhythm),
      transport_type: day.transport_type,
      transport_modes: day.transport_modes ?? [],
      guide_required: day.guide_required,
      hotel_night: day.hotel_night,
      meal_notes: day.meal_notes,
      meals: day.meals ?? [],
      meal_plan: day.meal_plan ?? day.meals ?? [],
      pax_group_size: day.pax_group_size || quoteForm.travelers_count,
      estimated_cost_mad: day.cost_mad,
      default_selling_price_mad: day.selling_price_mad,
      default_cost_lines: day.cost_lines ?? [],
      image_urls: day.image_urls ?? [],
      is_active: true,
    }));
    setTemplateOpen(true);
  };

  const downloadPdf = async (kind: "client" | "internal") => {
    if (!selectedQuote?.id) return toast.error("Sélectionnez un devis.");
    const quote = { ...selectedQuote, ...quoteForm, ...totals };
    const bytes = kind === "client"
      ? await generateFitClientPdf({ quote, days: calculatedQuoteDays, costLines: calculatedCostLines, hotelLines, flightLines })
      : await generateFitInternalPdf({ quote, days: calculatedQuoteDays, costLines: calculatedCostLines, hotelLines, flightLines });
    const filename = `${quote.quote_number || "devis-fit"}-${kind}.pdf`;
    downloadFitPdf(bytes, filename);
    await archiveGeneratedDocuments(selectedQuote.id, numberValue(quote.version_number || 1), `${kind}_pdf_regenerated`);
    const docInsert = await db.from("fit_quote_documents").insert({
      quote_id: selectedQuote.id,
      document_type: kind === "client" ? "client_pdf" : "internal_pdf",
      file_name: filename,
      metadata: {
        generated_in_browser: true,
        quote_version: numberValue(quote.version_number || 1),
        generated_at: new Date().toISOString(),
      },
    });
    throwIfSupabaseError(docInsert, "Enregistrement PDF généré");
  };

  const previewClientPdf = async () => {
    if (!selectedQuote?.id) return toast.error("Sélectionnez un devis.");
    const quote = { ...selectedQuote, ...quoteForm, ...totals };
    const bytes = await generateFitClientPdf({ quote, days: calculatedQuoteDays, costLines: calculatedCostLines, hotelLines, flightLines });
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const requestDeposit = async () => {
    if (!selectedQuote?.id) return;
    setSaving(true);
    try {
      const { error } = await db.rpc("request_fit_deposit_v3", { p_quote_id: selectedQuote.id });
      if (error) throw error;
      const patch = { status: "deposit_pending", commercial_status: "deposit_pending", deposit_requested_at: new Date().toISOString() };
      setSelectedQuote((current: any) => ({ ...current, ...patch }));
      setQuoteForm((current: any) => ({ ...current, ...patch }));
      void db.functions.invoke("send-admin-notification", { body: { event_type: "fit_deposit_requested", quote_id: selectedQuote.id } });
      toast.success("Demande d’acompte enregistrée.");
    } catch (error: any) {
      toast.error(error?.message || "Impossible de demander l’acompte.");
    } finally {
      setSaving(false);
    }
  };

  const confirmDeposit = async () => {
    if (!selectedQuote?.id) return;
    const amount = Number(paymentForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) return toast.error("Saisissez un montant valide.");
    setSaving(true);
    try {
      const { data, error } = await db.rpc("confirm_fit_deposit_payment_v3", {
        p_quote_id: selectedQuote.id,
        p_amount_mad: amount,
        p_method: paymentForm.method,
        p_reference: paymentForm.reference || null,
        p_idempotency_key: `fit-deposit:${selectedQuote.id}:${paymentForm.reference || amount}`,
      });
      if (error) throw error;
      const patch = { status: "deposit_paid", commercial_status: "deposit_paid", deposit_paid_at: new Date().toISOString() };
      setSelectedQuote((current: any) => ({ ...current, ...patch }));
      setQuoteForm((current: any) => ({ ...current, ...patch }));
      setPaymentOpen(false);
      void db.functions.invoke("send-admin-notification", { body: { event_type: "fit_payment_received", quote_id: selectedQuote.id, payment_id: data?.payment_id } });
      toast.success("Acompte confirmé. La réservation peut être créée.");
    } catch (error: any) {
      toast.error(error?.message || "Impossible de confirmer le paiement.");
    } finally {
      setSaving(false);
    }
  };

  const convertToBooking = async () => {
    if (!selectedQuote?.id) return;
    if (selectedQuote.converted_booking_id) return navigate(`/admin/bookings/${selectedQuote.converted_booking_id}`);
    if (!confirm("Créer la réservation depuis la version acceptée ? Cette opération est idempotente.")) return;
    setSaving(true);
    try {
      const { data, error } = await db.rpc("convert_fit_quote_to_booking_v3", { p_quote_id: selectedQuote.id, p_override_reason: null });
      if (error) throw error;
      if (!data?.booking_id) throw new Error("La réservation n’a pas été retournée.");
      toast.success(data.already_created ? "Réservation déjà créée." : `Réservation ${data.booking_reference} créée.`);
      if (!data.already_created) void db.functions.invoke("send-admin-notification", { body: { event_type: "fit_booking_confirmed", quote_id: selectedQuote.id, booking_id: data.booking_id } });
      await load();
      navigate(`/admin/bookings/${data.booking_id}`);
    } catch (error: any) {
      toast.error(error?.message ?? "Conversion impossible.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-w-0 overflow-x-hidden pb-24 md:pb-0">
      <PageHeader
        title="Devis FIT / Programmes sur mesure"
        description="Composez un devis privé avec des blocs journée et des lignes de coût façon Excel."
        action={
          <div className="flex flex-wrap gap-2">
            <Dialog open={templateOpen} onOpenChange={(open) => { setTemplateOpen(open); if (!open) setTemplateForm(emptyTemplate); }}>
              <DialogTrigger asChild><Button variant="outline"><Plus className="h-4 w-4" /> Journée</Button></DialogTrigger>
              <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto">
                <DialogHeader><DialogTitle>{templateForm.id ? "Modifier" : "Nouvelle"} journée template</DialogTitle></DialogHeader>
                <TemplateForm form={templateForm} setForm={setTemplateForm} />
                <DialogFooter><Button onClick={saveTemplate}>Enregistrer</Button></DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog open={quoteOpen} onOpenChange={(open) => { setQuoteOpen(open); if (!open) setQuoteForm(emptyQuote); }}>
              <DialogTrigger asChild><Button><Plus className="h-4 w-4" /> Devis FIT</Button></DialogTrigger>
              <DialogContent className="max-w-3xl">
                <DialogHeader><DialogTitle>Nouveau devis FIT</DialogTitle></DialogHeader>
                <QuoteForm form={quoteForm} setForm={setQuoteForm} clients={clients} />
                <DialogFooter><Button onClick={createQuote}>Créer</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <AlertDialog open={Boolean(duplicateTarget)} onOpenChange={(open) => { if (!open && !duplicating) setDuplicateTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dupliquer ce devis FIT ?</AlertDialogTitle>
            <AlertDialogDescription>
              Une nouvelle copie indépendante de <strong className="text-foreground">{duplicateTarget?.quote_number}</strong> sera créée en brouillon. Aucune modification du devis original ne sera effectuée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-lg border border-border bg-secondary/50 p-3 text-sm text-muted-foreground">
            Le lien client, les validations, paiements, documents générés et historiques ne seront pas copiés.
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={duplicating}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => void duplicateQuote()} disabled={duplicating}>
              {duplicating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CopyPlus className="mr-2 h-4 w-4" />}
              {duplicateAndEdit ? "Dupliquer et modifier" : "Dupliquer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(versionTarget)} onOpenChange={(open) => { if (!open && !versioning) setVersionTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Créer une nouvelle version ?</AlertDialogTitle>
            <AlertDialogDescription>
              Une V{numberValue(versionTarget?.version_number || 1) + 1} liée à <strong className="text-foreground">{versionTarget?.quote_family_reference || versionTarget?.quote_number}</strong> sera créée. La version actuelle restera consultable en lecture seule.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md border border-border bg-secondary/50 p-3 text-sm text-muted-foreground">
            Les validations, signatures, paiements, liens client et PDF générés ne seront pas repris.
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={versioning}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => void createNewVersion()} disabled={versioning}>
              {versioning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <History className="mr-2 h-4 w-4" />}
              Créer la version
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Confirmer l’acompte reçu</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label htmlFor="fit-deposit-amount">Montant reçu (MAD)</Label><Input id="fit-deposit-amount" inputMode="decimal" value={paymentForm.amount} onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))} placeholder={String(quoteForm.public_deposit_mad || "")} /></div>
            <div className="space-y-2"><Label>Moyen de paiement</Label><Select value={paymentForm.method} onValueChange={(method) => setPaymentForm((current) => ({ ...current, method }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bank_transfer">Virement bancaire</SelectItem><SelectItem value="card">Carte</SelectItem><SelectItem value="cash">Espèces</SelectItem><SelectItem value="cheque">Chèque</SelectItem><SelectItem value="other">Autre</SelectItem></SelectContent></Select></div>
            <div className="space-y-2"><Label htmlFor="fit-deposit-reference">Référence</Label><Input id="fit-deposit-reference" value={paymentForm.reference} onChange={(event) => setPaymentForm((current) => ({ ...current, reference: event.target.value }))} placeholder="Référence bancaire ou reçu" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setPaymentOpen(false)}>Annuler</Button><Button onClick={confirmDeposit} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Confirmer le paiement</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Tabs defaultValue="quotes">
        <TabsList className="mb-4">
          <TabsTrigger value="quotes">Devis FIT</TabsTrigger>
          <TabsTrigger value="templates">Bibliothèque journées</TabsTrigger>
        </TabsList>

        <TabsContent value="quotes">
          <div className="grid min-w-0 gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
            <Card className="min-w-0 p-4">
              <h2 className="font-display text-lg">Devis</h2>
              <div className="mt-4 space-y-2">
                {currentQuotes.map((quote) => (
                  <div key={quote.id} className={`rounded-lg border transition-colors hover:bg-secondary ${selectedQuote?.id === quote.id ? "border-accent bg-accent/5" : "border-border"}`}>
                    <button type="button" onClick={() => loadQuote(quote)} className="w-full cursor-pointer p-3 text-left text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold">{quote.quote_family_reference || quote.quote_number} <span className="text-xs text-muted-foreground">· V{quote.version_number || 1}</span></p>
                        <Badge variant={fitCommercialTone(fitCommercialStatus(quote))}>{fitCommercialLabel(quote)}</Badge>
                      </div>
                      <p className="mt-1 text-muted-foreground">{quote.client_name || "Client FIT"} · {quote.travelers_count || 1} pax</p>
                      <p className="mt-1 text-xs font-medium">{fmtMAD(quote.total_selling_price_mad || 0)}</p>
                      {quote.duplicated_from_id && <p className="mt-1 text-xs text-accent">Copie de {quotes.find((item) => item.id === quote.duplicated_from_id)?.quote_number || "un devis FIT"}</p>}
                    </button>
                    <div className="border-t border-border px-2 py-1.5">
                      <Button type="button" size="sm" variant="ghost" className="w-full justify-start" onClick={() => confirmDuplicate(quote)}><CopyPlus className="h-4 w-4" /> Dupliquer</Button>
                    </div>
                  </div>
                ))}
                {currentQuotes.length === 0 && <p className="text-sm text-muted-foreground">Aucun devis FIT.</p>}
              </div>
            </Card>

            <Card className="min-w-0 p-4">
              {!selectedQuote ? (
                <div className="py-16 text-center text-muted-foreground">Sélectionnez ou créez un devis FIT.</div>
              ) : (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-display text-xl">{quoteForm.quote_family_reference || quoteForm.quote_number}</h2>
                        <Select value={String(quoteForm.version_number || 1)} onValueChange={(value) => { const version = quoteVersions.find((item) => String(item.version_number || 1) === value); if (version) void loadQuote(version); }}>
                          <SelectTrigger className="h-9 w-auto min-w-20" aria-label="Choisir une version"><SelectValue /></SelectTrigger>
                          <SelectContent>{quoteVersions.map((version) => <SelectItem key={version.id} value={String(version.version_number || 1)}>V{version.version_number || 1} — {productionStatusLabels[version.production_status || version.status] || version.status}{version.is_current_version ? " — actuelle" : ""}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <p className="text-sm text-muted-foreground">{quoteForm.client_name || "Client FIT"} · {quoteForm.travelers_count} voyageur(s)</p>
                      {isHistoricalVersion && <p className="mt-1 text-sm font-semibold text-amber-700">Version historique en lecture seule</p>}
                      {quoteForm.duplicated_from_id && <p className="mt-1 text-sm font-semibold text-accent">Copie de {quoteForm.duplicated_from_reference || quotes.find((item) => item.id === quoteForm.duplicated_from_id)?.quote_number || "un devis FIT"}</p>}
                      {quotes.some((item) => item.duplicated_from_id === selectedQuote.id) && <p className="mt-1 text-xs text-muted-foreground">Dupliqué en {quotes.filter((item) => item.duplicated_from_id === selectedQuote.id).map((item) => item.quote_number).join(", ")}</p>}
                    </div>
                    <div className="hidden flex-wrap justify-end gap-2 md:flex">
                      <Button onClick={saveQuote} disabled={saving || isHistoricalVersion}><Save className="h-4 w-4" /> {saving ? "Enregistrement…" : "Sauver"}</Button>
                      <Button variant="secondary" onClick={sendToClient} disabled={isHistoricalVersion}><Send className="h-4 w-4" /> Envoyer au client</Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="outline"><MoreHorizontal className="h-4 w-4" /> Actions</Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64">
                          <DropdownMenuLabel>Devis client</DropdownMenuLabel>
                          {shareUrl && quoteForm.share_enabled && <DropdownMenuItem asChild><a href={shareUrl} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" /> Ouvrir comme client</a></DropdownMenuItem>}
                          <DropdownMenuItem onClick={copyShare} disabled={!shareUrl}><Copy className="mr-2 h-4 w-4" /> Copier lien client</DropdownMenuItem>
                          <DropdownMenuItem onClick={previewClientPdf}><Eye className="mr-2 h-4 w-4" /> Aperçu PDF</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => downloadPdf("client")}><Download className="mr-2 h-4 w-4" /> Télécharger PDF client</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => downloadPdf("internal")}><FileText className="mr-2 h-4 w-4" /> Télécharger PDF interne</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => confirmDuplicate(selectedQuote, true)}><CopyPlus className="mr-2 h-4 w-4" /> Dupliquer et modifier</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setVersionTarget(selectedQuote)} disabled={isHistoricalVersion}><History className="mr-2 h-4 w-4" /> Créer nouvelle version</DropdownMenuItem>
                          <DropdownMenuItem onClick={regenerateShare} disabled={isHistoricalVersion}><RefreshCw className="mr-2 h-4 w-4" /> Régénérer le lien</DropdownMenuItem>
                          {shareUrl && quoteForm.share_enabled && <DropdownMenuItem onClick={deactivateShare} disabled={isHistoricalVersion}><Link2 className="mr-2 h-4 w-4" /> Désactiver le lien</DropdownMenuItem>}
                          {quoteForm.accepted_snapshot_id && <DropdownMenuItem onClick={() => navigate(`/admin/fit-supplier-control?quote=${selectedQuote.id}`)}><PackageCheck className="mr-2 h-4 w-4" /> Demandes fournisseurs</DropdownMenuItem>}
                          {fitCommercialStatus(quoteForm) === "deposit_paid" && !quoteForm.converted_booking_id && <DropdownMenuItem onClick={convertToBooking} disabled={isHistoricalVersion}>Créer la réservation</DropdownMenuItem>}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={archiveQuote} disabled={isHistoricalVersion}>Archiver</DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={deleteQuote} disabled={isHistoricalVersion}><Trash2 className="mr-2 h-4 w-4" /> Supprimer</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  <div className="grid gap-3 rounded-md border border-border bg-secondary/25 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={fitCommercialTone(fitCommercialStatus(quoteForm))}>{fitCommercialLabel(quoteForm)}</Badge>
                        <span className="text-sm text-muted-foreground">{quoteForm.client_name || "Client FIT"} · {quoteForm.travelers_count || 1} voyageur(s)</span>
                      </div>
                      <p className="mt-2 text-2xl font-semibold tabular-nums">{fmtMAD(quoteForm.accepted_amount_mad || totals.total_selling_price_mad || 0)}</p>
                      <p className="mt-1 text-sm"><span className="text-muted-foreground">Prochaine action :</span> <strong>{fitNextAction(quoteForm)}</strong></p>
                      {fitCommercialStatus(quoteForm) === "accepted" && <p className="mt-1 text-sm text-muted-foreground">Acompte : {fmtMAD(quoteForm.public_deposit_mad || 0)} · Solde : {fmtMAD(Math.max(0, Number(quoteForm.accepted_amount_mad || totals.total_selling_price_mad || 0) - Number(quoteForm.public_deposit_mad || 0)))}</p>}
                    </div>
                    <div className="flex flex-wrap gap-2 md:justify-end">
                      {fitCommercialStatus(quoteForm) === "revision_requested" && <Button onClick={() => setVersionTarget(selectedQuote)}><History className="h-4 w-4" /> Créer V{Number(quoteForm.version_number || 1) + 1}</Button>}
                      {fitCommercialStatus(quoteForm) === "accepted" && <Button onClick={requestDeposit} disabled={saving}><WalletCards className="h-4 w-4" /> Demander l’acompte</Button>}
                      {fitCommercialStatus(quoteForm) === "deposit_pending" && <Button onClick={() => { setPaymentForm((current) => ({ ...current, amount: String(quoteForm.public_deposit_mad || "") })); setPaymentOpen(true); }}><WalletCards className="h-4 w-4" /> Confirmer paiement</Button>}
                      {fitCommercialStatus(quoteForm) === "deposit_paid" && <Button onClick={convertToBooking} disabled={saving}><CalendarCheck className="h-4 w-4" /> Créer la réservation</Button>}
                      {quoteForm.accepted_snapshot_id && <Button variant="outline" onClick={() => navigate(`/admin/fit-supplier-control?quote=${selectedQuote.id}`)}><PackageCheck className="h-4 w-4" /> Fournisseurs</Button>}
                      {quoteForm.converted_booking_id && <Button onClick={() => navigate(`/admin/bookings/${quoteForm.converted_booking_id}`)}><ExternalLink className="h-4 w-4" /> Ouvrir la réservation</Button>}
                    </div>
                  </div>

                  <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t border-border bg-background/95 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] shadow-lg backdrop-blur md:hidden">
                    <Button className="min-h-11 flex-1" onClick={saveQuote} disabled={saving || isHistoricalVersion}><Save className="h-4 w-4" /> Sauver</Button>
                    <Button className="min-h-11 flex-1" variant="secondary" onClick={sendToClient} disabled={isHistoricalVersion}><Send className="h-4 w-4" /> Envoyer</Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button className="min-h-11" variant="outline" aria-label="Plus d’actions"><MoreHorizontal className="h-5 w-5" /> Plus</Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end" side="top" className="w-64">
                        {shareUrl && quoteForm.share_enabled && <DropdownMenuItem asChild><a href={shareUrl} target="_blank" rel="noreferrer">Ouvrir comme client</a></DropdownMenuItem>}
                        <DropdownMenuItem onClick={copyShare} disabled={!shareUrl}>Copier lien client</DropdownMenuItem>
                        <DropdownMenuItem onClick={previewClientPdf}>Aperçu PDF</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => downloadPdf("client")}>PDF client</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => confirmDuplicate(selectedQuote, true)}>Dupliquer et modifier</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setVersionTarget(selectedQuote)} disabled={isHistoricalVersion}>Créer nouvelle version</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={archiveQuote} disabled={isHistoricalVersion}>Archiver</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={deleteQuote} disabled={isHistoricalVersion}>Supprimer</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <fieldset disabled={isHistoricalVersion} className="contents">

                  {timeline.length > 0 && (
                    <details className="rounded-md border border-border bg-background p-4">
                      <summary className="cursor-pointer text-sm font-semibold">Historique commercial ({timeline.length})</summary>
                      <ol className="mt-4 space-y-3 border-l border-border pl-4">
                        {timeline.slice(0, 20).map((item, index) => <li key={`${item.occurred_at}-${item.event}-${index}`} className="text-sm"><p className="font-medium">{fitCommercialLabel(String(item.event || "").replace(/^client_/, "").replace(/^commercial_status_/, ""))}</p><p className="text-xs text-muted-foreground">{new Date(item.occurred_at).toLocaleString("fr-FR")}{item.payload?.version ? ` · V${item.payload.version}` : ""}{item.payload?.amount_mad ? ` · ${fmtMAD(item.payload.amount_mad)}` : ""}</p></li>)}
                      </ol>
                    </details>
                  )}

                  <FitFinancialPanel quoteId={selectedQuote.id} readOnly={isHistoricalVersion} />
                  <FitFinancialClosurePanel quoteId={selectedQuote.id} readOnly={isHistoricalVersion} />

                  {shareUrl && (
                    <div className="grid gap-4 rounded-lg border border-dashed border-accent/50 bg-accent/5 p-4 text-sm md:grid-cols-[minmax(0,1fr)_280px]">
                      <div>
                        <p><span className="font-medium">Lien client privé :</span> <span className="break-all">{shareUrl}</span></p>
                        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-muted-foreground">
                          <span>Statut du lien : <strong className="text-foreground">{quoteForm.share_enabled ? "Actif" : "Désactivé"}</strong></span>
                          <span>Statut client : <strong className="text-foreground">{quoteForm.public_client_status || "Aucune réponse"}</strong></span>
                          <span>Dernière consultation : <strong className="text-foreground">{quoteForm.public_last_viewed_at ? new Date(quoteForm.public_last_viewed_at).toLocaleString("fr-FR") : "Jamais"}</strong></span>
                        </div>
                      </div>
                      <div className="flex items-end gap-2">
                        <div className="min-w-0 flex-1">
                          <Label htmlFor="fit-public-expiry">Date d’expiration</Label>
                          <Input
                            id="fit-public-expiry"
                            type="datetime-local"
                            value={publicExpiryInput}
                            onChange={(event) => setQuoteForm({ ...quoteForm, public_link_expires_at: event.target.value ? new Date(event.target.value).toISOString() : null })}
                          />
                        </div>
                        <Button variant="outline" onClick={savePublicExpiry}>Enregistrer</Button>
                      </div>
                    </div>
                  )}

                  {quoteForm.quote_channel === "partner" && (
                    <div className="rounded-lg border border-border bg-secondary/35 p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Production partenaire</p>
                          <h3 className="mt-1 font-display text-xl">
                            {productionStatusLabels[quoteForm.production_status || quoteForm.status] || quoteForm.production_status || quoteForm.status}
                          </h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Japon : {quoteForm.japan_request_status || "not_started"} · Paiement : {quoteForm.payment_status || "not_authorized"} · Réservation : {quoteForm.booking_status || "not_started"}
                          </p>
                          {quoteForm.production_public_note && <p className="mt-2 text-sm font-medium">{quoteForm.production_public_note}</p>}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" onClick={sendToJapan}><Send className="h-4 w-4" /> Envoyer au bureau Japon</Button>
                          <Button variant="outline" onClick={receiveJapanResponse}><FileText className="h-4 w-4" /> Saisir réponse Japon</Button>
                          <Button onClick={approveForPayment}><CheckCircle2 className="h-4 w-4" /> Valider paiement</Button>
                          <Button variant="outline" onClick={() => updateProduction({ status: "booking_in_progress", production_status: "booking_in_progress", booking_status: "booking_in_progress", reservation_status: "in_progress", booking_in_progress_at: new Date().toISOString() }, "booking_in_progress")}>Réservation en cours</Button>
                          <Button variant="outline" onClick={() => updateProduction({ status: "confirmed", production_status: "confirmed", booking_status: "confirmed", reservation_status: "confirmed", production_confirmed_at: new Date().toISOString() }, "booking_confirmed")}>Marquer confirmé</Button>
                          <Button variant="ghost" onClick={() => updateProduction({ status: "rejected", production_status: "rejected", japan_request_status: "rejected", production_public_note: "LeJapon.ma ne peut pas valider cette proposition dans les conditions actuelles." }, "admin_rejected_partner_quote")}>Refuser</Button>
                        </div>
                      </div>
                    </div>
                  )}

                  <QuoteForm form={quoteForm} setForm={setQuoteForm} clients={clients} compact />

                  <div className="grid gap-3 md:grid-cols-6">
                    <Metric label="Coût terrain" value={fmtMAD(totals.ground_cost_total_mad ?? totals.total_cost_mad)} />
                    <Metric label="Frais agence Japon" value={fmtMAD(totals.japan_agency_fee_total_mad ?? 0)} />
                    <Metric label="Coût projet" value={fmtMAD(totals.project_cost_total_mad ?? totals.total_cost_mad)} />
                    <Metric label="Marge LeJapon.ma" value={`${fmtMAD(totals.margin_amount_mad)} · ${totals.margin_percent.toFixed(1)}%`} />
                    <Metric label="Vente" value={fmtMAD(totals.total_selling_price_mad)} />
                    <Metric label="Prix/pers." value={fmtMAD(totals.price_per_person_mad)} />
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <Metric label="Taux frais agence Japon" value={`${numberValue(quoteForm.japan_agency_fee_rate ?? 10)}%`} />
                    <Metric label="Taux marge LeJapon.ma" value={`${numberValue(quoteForm.lejapon_margin_rate ?? 20)}%`} />
                    <Metric label="Scope de marge" value={marginScopes.find((scope) => scope.value === quoteForm.margin_scope)?.label || "Programme uniquement"} />
                  </div>
                  {totals.margin_amount_mad < 0 && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm font-medium text-destructive">
                      Attention : marge négative. Ce warning est interne et n'apparaît jamais côté client.
                    </div>
                  )}

                  <div className="rounded-xl border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold">Journées du programme</h3>
                      <div className="flex flex-wrap gap-2">
                        <Select onValueChange={addTemplateDay}>
                          <SelectTrigger className="w-72"><SelectValue placeholder="Ajouter depuis template" /></SelectTrigger>
                          <SelectContent>{templates.filter((item) => item.is_active !== false).map((template) => <SelectItem key={template.id} value={template.id}>{template.city} · {template.title}</SelectItem>)}</SelectContent>
                        </Select>
                        <Button variant="outline" onClick={addBlankDay}><Plus className="h-4 w-4" /> Jour custom</Button>
                      </div>
                    </div>
                    <Accordion type="multiple" className="mt-3 space-y-3" defaultValue={quoteDays.map((day) => day.local_id)}>
                      {quoteDays.map((day, index) => {
                        const pricedDay = calculatedDayByLocal.get(day.local_id) ?? day;
                        return (
                        <AccordionItem
                          key={day.local_id}
                          value={day.local_id}
                          draggable
                          onDragStart={() => setDragId(day.local_id)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={() => dropDayOn(day.local_id)}
                          className="rounded-lg border border-border bg-background px-3"
                        >
                          <AccordionTrigger className="hover:no-underline">
                            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left">
                              <GripVertical className="h-4 w-4 text-muted-foreground" />
                              <Badge>Jour {index + 1}</Badge>
                              <span className="font-semibold">{day.title}</span>
                              <span className="text-sm text-muted-foreground">{day.city}</span>
                              <span className="ml-auto pr-3 font-semibold text-emerald-700">{fmtMAD(pricedDay.selling_price_mad || pricedDay.cost_mad)}</span>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="mb-3 flex flex-wrap justify-end gap-1">
                              <Button size="sm" variant="outline" onClick={() => generateDayWithAI(day)}><Sparkles className="h-4 w-4" /> Générer avec IA</Button>
                              <Button size="sm" variant="outline" onClick={() => saveDayAsTemplate(day)}>Sauver comme template</Button>
                              <Button size="icon" variant="ghost" onClick={() => reorderDay(day.local_id, -1)}><ArrowUp className="h-4 w-4" /></Button>
                              <Button size="icon" variant="ghost" onClick={() => reorderDay(day.local_id, 1)}><ArrowDown className="h-4 w-4" /></Button>
                              <Button size="icon" variant="ghost" onClick={() => duplicateDay(day)}><Copy className="h-4 w-4" /></Button>
                              <Button size="icon" variant="ghost" onClick={() => removeDay(day.local_id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                            </div>
                            <div className="grid gap-3 md:grid-cols-4">
                              <Field label="Titre"><Input value={day.title ?? ""} onChange={(event) => updateDay(day.local_id, { title: event.target.value })} /></Field>
                              <Field label="Date"><Input type="date" value={day.date ?? ""} onChange={(event) => updateDay(day.local_id, { date: event.target.value })} /></Field>
                              <Field label="Ville"><Input value={day.city ?? ""} onChange={(event) => updateDay(day.local_id, { city: event.target.value })} /></Field>
                              <Field label="Pax groupe"><Input type="number" value={day.pax_group_size ?? quoteForm.travelers_count} onChange={(event) => updateDay(day.local_id, { pax_group_size: +event.target.value })} /></Field>
                              <Field label="Rythme">
                                <Select value={normalizeRhythm(day.day_pace || day.rhythm)} onValueChange={(value) => updateDay(day.local_id, { rhythm: value, day_pace: value })}>
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>{rhythmOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                                </Select>
                              </Field>
                              <Field label="Override frais Japon %"><Input type="number" placeholder={`${numberValue(quoteForm.japan_agency_fee_rate ?? 10)}% global`} value={day.japan_agency_fee_rate_override ?? ""} onChange={(event) => updateDay(day.local_id, { japan_agency_fee_rate_override: event.target.value === "" ? "" : +event.target.value })} /></Field>
                              <div className="md:col-span-4 grid gap-2 md:grid-cols-4">
                                <Metric label="Coût terrain jour" value={fmtMAD(pricedDay.calculated_ground_cost ?? pricedDay.cost_mad)} compact />
                                <Metric label="Frais agence Japon" value={fmtMAD(pricedDay.calculated_japan_agency_fee ?? 0)} compact />
                                <Metric label="Coût projet jour" value={fmtMAD(pricedDay.calculated_project_cost ?? pricedDay.cost_mad)} compact />
                                <Metric label="Vente jour / pers." value={fmtMAD(pricedDay.calculated_sale_price_per_person ?? 0)} compact />
                              </div>
                              <div className="md:col-span-4"><Field label="Texte source / description complète"><Textarea rows={5} value={day.source_description ?? day.description_client ?? ""} onChange={(event) => updateDay(day.local_id, { source_description: event.target.value })} placeholder="Collez ici le texte brut complet de la journée. Il sert à générer les champs client." /></Field></div>
                              <div className="md:col-span-2"><Field label="Résumé vendeur client"><Textarea rows={2} value={day.sales_summary ?? day.client_summary ?? ""} onChange={(event) => updateDay(day.local_id, { sales_summary: event.target.value, client_summary: event.target.value })} placeholder="Une phrase courte et commerciale." /></Field></div>
                              <div className="md:col-span-2"><Field label="Description client optimisée"><Textarea rows={3} value={day.optimized_client_description ?? day.description_client ?? ""} onChange={(event) => updateDay(day.local_id, { optimized_client_description: event.target.value, description_client: event.target.value })} placeholder="Texte fluide affiché côté client." /></Field></div>
                              <div className="md:col-span-2"><Field label="Temps forts client"><Textarea rows={3} value={Array.isArray(day.client_highlights) ? day.client_highlights.join("\n") : day.client_highlights ?? ""} onChange={(event) => updateDay(day.local_id, { client_highlights: listFromText(event.target.value) })} placeholder="3 à 5 lieux ou expériences, un par ligne." /></Field></div>
                              <div className="md:col-span-2"><Field label="Inclus aujourd’hui"><Textarea rows={3} value={Array.isArray(day.client_inclusions) ? day.client_inclusions.join("\n") : day.client_inclusions ?? ""} onChange={(event) => updateDay(day.local_id, { client_inclusions: listFromText(event.target.value) })} placeholder="Prestations réelles incluses, pas les lieux simples." /></Field></div>
                              <div className="md:col-span-2"><Field label="Options possibles"><Textarea rows={3} value={Array.isArray(day.client_options) ? day.client_options.join("\n") : day.client_options ?? ""} onChange={(event) => updateDay(day.local_id, { client_options: listFromText(event.target.value) })} placeholder="Options à confirmer avec le conseiller." /></Field></div>
                              <div className="md:col-span-2"><Field label="Transport"><MultiChoiceField options={transportOptions} value={day.transport_modes} onChange={(items) => updateDay(day.local_id, { transport_modes: items })} /></Field></div>
                              <div className="md:col-span-2"><Field label="Repas"><MultiChoiceField options={mealOptions} value={day.meal_plan ?? day.meals} onChange={(items) => updateDay(day.local_id, { meal_plan: items, meals: items, meal_notes: items.join("\n") })} /></Field></div>
                              <div className="md:col-span-2"><Field label="Notes internes"><Textarea rows={3} value={day.internal_notes ?? ""} onChange={(event) => updateDay(day.local_id, { internal_notes: event.target.value })} /></Field></div>
                              <div className="md:col-span-4"><DayImageManager day={day} updateDay={updateDay} quoteId={selectedQuote.id} /></div>
                            </div>
                            <DayCostTable day={pricedDay} quote={quoteForm} updateLine={updateDayLine} addLine={addDayLine} removeLine={removeDayLine} />
                          </AccordionContent>
                        </AccordionItem>
                      );
                      })}
                      {quoteDays.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Ajoutez des journées depuis la bibliothèque ou créez une journée custom.</p>}
                    </Accordion>
                  </div>

                  <HotelLines lines={hotelLines} addLine={addHotelLine} updateLine={updateHotelLine} removeLine={(id) => setHotelLines((current) => current.filter((line) => line.local_id !== id))} />
                  <FlightLines lines={flightLines} addLine={addFlightLine} updateLine={updateFlightLine} removeLine={(id) => setFlightLines((current) => current.filter((line) => line.local_id !== id))} />
                  <SpecialLines lines={costLines} addLine={addCostLine} updateLine={updateCostLine} removeLine={(id) => setCostLines((current) => current.filter((line) => line.local_id !== id))} />
                  </fieldset>
                </div>
              )}
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="templates">
          <div className="mb-4 flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => fillPartnerNetFromSale()}>
              <CheckCircle2 className="h-4 w-4" /> Remplir les tarifs net agence depuis la vente
            </Button>
            <Button variant="outline" onClick={syncPartnerLibrary}><RefreshCw className="h-4 w-4" /> Synchroniser la bibliothèque partenaire</Button>
            <Button variant="outline" onClick={seedExamples}><Plus className="h-4 w-4" /> Ajouter exemples Excel</Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {templates.map((template) => {
              const issues = partnerTemplateIssues(template);
              const missingPartnerNet = issues.includes("tarif net agence manquant");
              const isPartnerPublishable = template.partner_publish_status === "published" && issues.length === 0;
              return (
              <Card key={template.id} className={`overflow-hidden ${missingPartnerNet ? "border-amber-300" : ""}`}>
                {Array.isArray(template.image_urls) && template.image_urls[0] && <img src={template.image_urls[0]} alt={template.title} width={420} height={180} className="h-36 w-full object-cover" />}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-display text-lg">{template.title}</h3>
                      <p className="text-xs text-muted-foreground">{template.city || "Ville"} · {template.theme || "Thème"}</p>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Badge variant={template.is_active ? "default" : "secondary"}>{template.is_active ? "Actif" : "Inactif"}</Badge>
                      {isPartnerPublishable && <Badge variant="outline">Partenaire</Badge>}
                      {template.partner_publish_status === "published" && !isPartnerPublishable && (
                        <Badge variant="secondary">Partenaire · non publiable</Badge>
                      )}
                    </div>
                  </div>
                  <p className="mt-2 line-clamp-3 text-sm">{template.description_client || "—"}</p>
                  {missingPartnerNet && (
                    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                      <div className="flex items-center gap-2 font-semibold">
                        <AlertTriangle className="h-4 w-4" /> Tarif net agence manquant — non publiable
                      </div>
                      <p className="mt-1">Définissez un tarif net agence ou utilisez la vente comme base.</p>
                      {numberValue(template.default_selling_price_mad) > 0 && (
                        <Button
                          className="mt-2"
                          size="sm"
                          variant="outline"
                          onClick={() => fillPartnerNetFromSale(template)}
                        >
                          Utiliser la vente comme tarif net agence
                        </Button>
                      )}
                    </div>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs xl:grid-cols-4">
                    <Metric label="Lignes" value={template.default_cost_lines?.length ?? 0} compact />
                    <Metric label="Coût" value={fmtMAD(template.estimated_cost_mad || 0)} compact />
                    <Metric label="Vente" value={fmtMAD(template.default_selling_price_mad || 0)} compact />
                    <Metric label="Net agence" value={fmtMAD(template.partner_net_price_mad || 0)} compact />
                  </div>
                  <div className="mt-4 flex justify-end gap-1">
                    <Button size="sm" variant="outline" onClick={() => { setTemplateForm(normalizeTemplateForForm(template)); setTemplateOpen(true); }}>Modifier</Button>
                    <Button size="sm" variant="ghost" onClick={() => removeTemplate(template)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                </div>
              </Card>
            );
            })}
            {templates.length === 0 && <p className="col-span-full py-12 text-center text-muted-foreground">Aucune journée template.</p>}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><Label>{label}</Label>{children}</div>;
}

function Metric({ label, value, compact = false }: { label: string; value: ReactNode; compact?: boolean }) {
  return (
    <div className={`rounded-lg border border-border bg-background ${compact ? "p-2" : "p-3"}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}

function MultiChoiceField({ options, value, onChange }: { options: string[]; value: unknown; onChange: (items: string[]) => void }) {
  const selected = Array.isArray(value) ? value.map(String) : listFromText(value);
  const toggle = (option: string) => {
    if (selected.includes(option)) onChange(selected.filter((item) => item !== option));
    else onChange([...selected, option]);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <Button
          key={option}
          type="button"
          size="sm"
          variant={selected.includes(option) ? "default" : "outline"}
          className="h-8"
          onClick={() => toggle(option)}
        >
          {option}
        </Button>
      ))}
    </div>
  );
}

function CategorySelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Select value={value || "other"} onValueChange={onChange}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>{costCategories.map((category) => <SelectItem key={category.value} value={category.value}>{category.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function DayCostTable({ day, quote, updateLine, addLine, removeLine }: { day: any; quote: any; updateLine: (dayId: string, lineId: string, patch: any) => void; addLine: (dayId: string) => void; removeLine: (dayId: string, lineId: string) => void }) {
  const grid = "grid-cols-[150px_1fr_110px_90px_90px_120px_1fr_80px_80px_80px_44px]";
  const japanRate = day.japan_agency_fee_rate_override !== null && day.japan_agency_fee_rate_override !== undefined && String(day.japan_agency_fee_rate_override) !== ""
    ? numberValue(day.japan_agency_fee_rate_override)
    : numberValue(quote?.japan_agency_fee_rate ?? 10);
  return (
    <div className="mt-4 rounded-lg border border-border">
      <div className="flex items-center justify-between border-b border-border p-2">
        <h4 className="font-semibold">Table coûts journée</h4>
        <Button size="sm" variant="outline" onClick={() => addLine(day.local_id)}><Plus className="h-4 w-4" /> Ligne</Button>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[1120px]">
          <div className={`grid ${grid} gap-2 bg-secondary/70 p-2 text-xs font-semibold`}>
            <span>Catégorie</span><span>Contents</span><span>Price</span><span>No</span><span>Times</span><span>Subtotal</span><span>Notes</span><span>Calcul</span><span>Visible</span><span>Option</span><span />
          </div>
          {(day.cost_lines ?? []).map((line: any) => (
            <div key={line.local_id} className={`grid ${grid} gap-2 border-t border-border p-2`}>
              <CategorySelect value={line.category} onChange={(value) => updateLine(day.local_id, line.local_id, { category: value })} />
              <Input value={line.label ?? ""} onChange={(event) => updateLine(day.local_id, line.local_id, { label: event.target.value })} />
              {line.category === "agency_fee" && line.fee_type !== "fixed" ? (
                <Input type="number" value={line.percentage_rate ?? 20} onChange={(event) => updateLine(day.local_id, line.local_id, { percentage_rate: +event.target.value })} />
              ) : (
                <Input type="number" value={line.price_mad ?? 0} onChange={(event) => updateLine(day.local_id, line.local_id, { price_mad: +event.target.value })} />
              )}
              <Input type="number" value={line.quantity ?? 1} onChange={(event) => updateLine(day.local_id, line.local_id, { quantity: +event.target.value })} />
              <Input type="number" value={line.times ?? 1} onChange={(event) => updateLine(day.local_id, line.local_id, { times: +event.target.value })} />
              <Input readOnly value={line.subtotal_mad ?? 0} className="font-semibold text-emerald-700" />
              <Input value={line.notes ?? ""} onChange={(event) => updateLine(day.local_id, line.local_id, { notes: event.target.value })} />
              <Switch checked={line.included_in_calculation !== false} onCheckedChange={(checked) => updateLine(day.local_id, line.local_id, { included_in_calculation: checked })} />
              <Switch checked={Boolean(line.is_client_visible)} onCheckedChange={(checked) => updateLine(day.local_id, line.local_id, { is_client_visible: checked })} />
              <Switch checked={Boolean(line.is_optional)} onCheckedChange={(checked) => updateLine(day.local_id, line.local_id, { is_optional: checked, is_client_visible: checked ? true : line.is_client_visible })} />
              <Button size="icon" variant="ghost" onClick={() => removeLine(day.local_id, line.local_id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
            </div>
          ))}
          {isAutoV2(quote) && (
            <div className={`grid ${grid} gap-2 border-t border-orange-200 bg-orange-50 p-2 text-sm text-orange-950`}>
              <span className="font-semibold">Frais agence Japon</span>
              <span>Frais agence Japon — automatique — {japanRate}%</span>
              <span>-</span>
              <span>-</span>
              <span>-</span>
              <span className="font-semibold">{fmtMAD(day.calculated_japan_agency_fee || 0)}</span>
              <span>Calculé sur le coût terrain journée</span>
              <span>Oui</span>
              <span>Non</span>
              <span>Non</span>
              <span />
            </div>
          )}
          <div className="grid grid-cols-[1fr_180px] gap-2 border-t border-emerald-200 bg-emerald-50 p-3 font-semibold text-emerald-800">
            <span>{isAutoV2(quote) ? "Prix de vente journée" : "Total journée"}</span><span>{fmtMAD(day.selling_price_mad || day.cost_mad || 0)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function HotelLines({ lines, addLine, updateLine, removeLine }: { lines: any[]; addLine: () => void; updateLine: (id: string, patch: any) => void; removeLine: (id: string) => void }) {
  const hotelGrid = "grid-cols-[140px_minmax(240px,1.2fr)_140px_minmax(240px,1fr)_170px_100px_100px_170px_130px_minmax(260px,1fr)_minmax(260px,1fr)_52px]";
  return (
    <TableBlock title="Hôtels" onAdd={addLine}>
      <div className="min-w-[1980px]">
        <div className={`grid ${hotelGrid} gap-2 bg-secondary/70 p-2 text-xs font-semibold`}>
          <span>Ville</span><span>Hôtel</span><span>Catégorie</span><span>Image</span><span>Chambre</span><span>Rooms</span><span>Nuits</span><span>Prix/ch./nuit</span><span>Subtotal</span><span>Note client</span><span>Note interne</span><span />
        </div>
        {lines.map((line) => (
          <div key={line.local_id} className={`grid ${hotelGrid} items-start gap-2 border-t border-border p-2`}>
            <Input value={line.city ?? ""} onChange={(event) => updateLine(line.local_id, { city: event.target.value })} />
            <Input value={line.hotel_name ?? ""} onChange={(event) => updateLine(line.local_id, { hotel_name: event.target.value })} />
            <Input value={line.category ?? ""} onChange={(event) => updateLine(line.local_id, { category: event.target.value })} placeholder="Hôtel 4★" />
            <Input value={line.image_url ?? ""} onChange={(event) => updateLine(line.local_id, { image_url: event.target.value })} placeholder="URL image" />
            <Input value={line.room_type ?? ""} onChange={(event) => updateLine(line.local_id, { room_type: event.target.value })} />
            <Input type="number" value={line.rooms_count ?? 1} onChange={(event) => updateLine(line.local_id, { rooms_count: +event.target.value })} />
            <Input type="number" value={line.nights ?? 1} onChange={(event) => updateLine(line.local_id, { nights: +event.target.value })} />
            <Input type="number" value={line.price_per_room_night_mad ?? 0} onChange={(event) => updateLine(line.local_id, { price_per_room_night_mad: +event.target.value })} />
            <Input readOnly value={line.subtotal_mad ?? 0} className="font-semibold" />
            <Textarea rows={2} value={line.public_notes ?? ""} onChange={(event) => updateLine(line.local_id, { public_notes: event.target.value })} />
            <Textarea rows={2} value={line.notes ?? ""} onChange={(event) => updateLine(line.local_id, { notes: event.target.value })} />
            <Button size="icon" variant="ghost" onClick={() => removeLine(line.local_id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </div>
        ))}
      </div>
    </TableBlock>
  );
}

function FlightLines({ lines, addLine, updateLine, removeLine }: { lines: any[]; addLine: () => void; updateLine: (id: string, patch: any) => void; removeLine: (id: string) => void }) {
  return (
    <TableBlock title="Vols" onAdd={addLine}>
      <div className="min-w-[980px]">
        <div className="grid grid-cols-[1fr_150px_130px_150px_120px_120px_1fr_1fr_44px] gap-2 bg-secondary/70 p-2 text-xs font-semibold">
          <span>Route</span><span>Compagnie</span><span>Statut client</span><span>Tarif/pers.</span><span>Pax</span><span>Subtotal</span><span>Note client</span><span>Note interne</span><span />
        </div>
        {lines.map((line) => (
          <div key={line.local_id} className="grid grid-cols-[1fr_150px_130px_150px_120px_120px_1fr_1fr_44px] gap-2 border-t border-border p-2">
            <Input value={line.route ?? ""} onChange={(event) => updateLine(line.local_id, { route: event.target.value })} />
            <Input value={line.airline ?? ""} onChange={(event) => updateLine(line.local_id, { airline: event.target.value })} />
            <Select value={line.status || "included"} onValueChange={(value) => updateLine(line.local_id, { status: value })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="included">Inclus</SelectItem>
                <SelectItem value="optional">Option</SelectItem>
                <SelectItem value="estimate">Estimatif</SelectItem>
              </SelectContent>
            </Select>
            <Input type="number" value={line.fare_per_person_mad ?? 0} onChange={(event) => updateLine(line.local_id, { fare_per_person_mad: +event.target.value })} />
            <Input type="number" value={line.passengers_count ?? 1} onChange={(event) => updateLine(line.local_id, { passengers_count: +event.target.value })} />
            <Input readOnly value={line.subtotal_mad ?? 0} />
            <Input value={line.public_notes ?? ""} onChange={(event) => updateLine(line.local_id, { public_notes: event.target.value })} />
            <Input value={line.notes ?? ""} onChange={(event) => updateLine(line.local_id, { notes: event.target.value })} />
            <Button size="icon" variant="ghost" onClick={() => removeLine(line.local_id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </div>
        ))}
      </div>
    </TableBlock>
  );
}

function SpecialLines({ lines, addLine, updateLine, removeLine }: { lines: any[]; addLine: () => void; updateLine: (id: string, patch: any) => void; removeLine: (id: string) => void }) {
  return (
    <TableBlock title="Lignes spéciales / options" onAdd={() => addLine()}>
      <div className="min-w-[920px]">
        <div className="grid grid-cols-[150px_1fr_120px_90px_90px_120px_1fr_80px_44px] gap-2 bg-secondary/70 p-2 text-xs font-semibold">
          <span>Catégorie</span><span>Libellé</span><span>Prix</span><span>No</span><span>Times</span><span>Total</span><span>Notes</span><span>Calcul</span><span />
        </div>
        {lines.map((line) => (
          <div key={line.local_id} className="grid grid-cols-[150px_1fr_120px_90px_90px_120px_1fr_80px_44px] gap-2 border-t border-border p-2">
            <CategorySelect value={line.category} onChange={(value) => updateLine(line.local_id, { category: value })} />
            <Input value={line.label ?? ""} onChange={(event) => updateLine(line.local_id, { label: event.target.value })} />
            <Input type="number" value={line.price_mad ?? line.unit_cost_mad ?? 0} onChange={(event) => updateLine(line.local_id, { price_mad: +event.target.value })} />
            <Input type="number" value={line.quantity ?? 1} onChange={(event) => updateLine(line.local_id, { quantity: +event.target.value })} />
            <Input type="number" value={line.times ?? 1} onChange={(event) => updateLine(line.local_id, { times: +event.target.value })} />
            <Input readOnly value={line.total_mad ?? 0} />
            <Input value={line.notes ?? ""} onChange={(event) => updateLine(line.local_id, { notes: event.target.value })} />
            <Switch checked={line.included_in_calculation !== false} onCheckedChange={(checked) => updateLine(line.local_id, { included_in_calculation: checked })} />
            <Button size="icon" variant="ghost" onClick={() => removeLine(line.local_id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </div>
        ))}
      </div>
    </TableBlock>
  );
}

function TableBlock({ title, onAdd, children }: { title: string; onAdd: () => void; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        <Button variant="outline" onClick={onAdd}><Plus className="h-4 w-4" /> Ligne</Button>
      </div>
      <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-background pb-2">{children}</div>
    </div>
  );
}

function QuoteForm({ form, setForm, clients, compact = false }: { form: any; setForm: (form: any) => void; clients: any[]; compact?: boolean }) {
  const update = (key: string, value: unknown) => setForm({ ...form, [key]: value });
  const defaultSections = compact ? ["essential", "travel"] : ["essential", "travel", "pricing"];
  return (
    <Accordion type="multiple" defaultValue={defaultSections} className="space-y-3">
      <AccordionItem value="essential" className="rounded-lg border border-border px-4">
        <AccordionTrigger>Informations essentielles</AccordionTrigger>
        <AccordionContent>
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Client CRM">
              <Select value={form.client_id || "none"} onValueChange={(value) => {
                const client = clients.find((item) => item.id === value);
                setForm({ ...form, client_id: value === "none" ? "" : value, client_name: client?.full_name || form.client_name });
              }}>
                <SelectTrigger><SelectValue placeholder="Optionnel" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Aucun</SelectItem>
                  {clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.full_name || client.email || client.phone}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Nom client"><Input value={form.client_name ?? ""} onChange={(event) => update("client_name", event.target.value)} /></Field>
            <Field label="Voyageurs"><Input type="number" min={1} value={form.travelers_count ?? 1} onChange={(event) => update("travelers_count", +event.target.value)} /></Field>
            <Field label="Validité"><Input type="date" value={form.valid_until ?? ""} onChange={(event) => update("valid_until", event.target.value)} /></Field>
            <Field label="Début"><Input type="date" value={form.travel_start_date ?? ""} onChange={(event) => update("travel_start_date", event.target.value)} /></Field>
            <Field label="Fin"><Input type="date" value={form.travel_end_date ?? ""} onChange={(event) => update("travel_end_date", event.target.value)} /></Field>
            <Field label="Langue"><Input value={form.language ?? "fr"} onChange={(event) => update("language", event.target.value)} /></Field>
            <Field label="Devise"><Input value={form.currency ?? "MAD"} onChange={(event) => update("currency", event.target.value)} /></Field>
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="travel" className="rounded-lg border border-border px-4">
        <AccordionTrigger>Hébergement et voyage</AccordionTrigger>
        <AccordionContent>
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Niveau hôtel"><Input value={form.hotel_category ?? ""} onChange={(event) => update("hotel_category", event.target.value)} /></Field>
            <Field label="Type chambre"><Input value={form.room_type ?? ""} onChange={(event) => update("room_type", event.target.value)} /></Field>
            <div className="md:col-span-2"><Field label="Inclus client"><Textarea rows={compact ? 3 : 4} value={form.inclusions ?? ""} onChange={(event) => update("inclusions", event.target.value)} placeholder={"Hôtels 4★\nAssistance avant départ\nGuides francophones\nShinkansen / train"} /></Field></div>
            <div className="md:col-span-2"><Field label="Non inclus client"><Textarea rows={compact ? 3 : 4} value={form.exclusions ?? ""} onChange={(event) => update("exclusions", event.target.value)} placeholder={"Vols internationaux si non inclus\nDépenses personnelles\nRepas non mentionnés"} /></Field></div>
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="pricing" className="rounded-lg border border-border px-4">
        <AccordionTrigger>Prix et calcul</AccordionTrigger>
        <AccordionContent>
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Mode calcul">
              <Select value={form.calculation_mode || "legacy"} onValueChange={(value) => update("calculation_mode", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="legacy">Calcul ancien</SelectItem>
                  <SelectItem value="automatic_v2">Calcul automatique v2</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Frais agence Japon %"><Input type="number" value={form.japan_agency_fee_rate ?? 10} onChange={(event) => update("japan_agency_fee_rate", +event.target.value)} /></Field>
            <Field label="Marge LeJapon.ma %"><Input type="number" value={form.lejapon_margin_rate ?? 20} onChange={(event) => update("lejapon_margin_rate", +event.target.value)} /></Field>
            <Field label="Scope marge">
              <Select value={form.margin_scope || "program_only"} onValueChange={(value) => update("margin_scope", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{marginScopes.map((scope) => <SelectItem key={scope.value} value={scope.value}>{scope.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Arrondi">
              <Select value={form.rounding_rule || "unit"} onValueChange={(value) => update("rounding_rule", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{roundingRules.map((rule) => <SelectItem key={rule.value} value={rule.value}>{rule.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Ajustement MAD"><Input type="number" value={form.manual_adjustment_mad ?? 0} onChange={(event) => update("manual_adjustment_mad", +event.target.value)} /></Field>
            <Field label="Remise MAD"><Input type="number" value={form.discount_mad ?? 0} onChange={(event) => update("discount_mad", +event.target.value)} /></Field>
            <Field label="Acompte client MAD"><Input type="number" min={0} value={form.public_deposit_mad ?? 0} onChange={(event) => update("public_deposit_mad", +event.target.value)} /></Field>
            <Field label="Échéance acompte"><Input type="date" value={form.public_payment_deadline ?? ""} onChange={(event) => update("public_payment_deadline", event.target.value)} /></Field>
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="conditions" className="rounded-lg border border-border px-4">
        <AccordionTrigger>Conditions</AccordionTrigger>
        <AccordionContent>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Conditions de paiement"><Textarea rows={compact ? 3 : 4} value={form.payment_conditions ?? ""} onChange={(event) => update("payment_conditions", event.target.value)} /></Field>
            <Field label="Conditions de réservation"><Textarea rows={compact ? 3 : 4} value={form.booking_conditions ?? ""} onChange={(event) => update("booking_conditions", event.target.value)} /></Field>
            <div className="md:col-span-2"><Field label="Conditions d’annulation"><Textarea rows={compact ? 4 : 7} value={form.cancellation_conditions ?? ""} onChange={(event) => update("cancellation_conditions", event.target.value)} /></Field></div>
          </div>
        </AccordionContent>
      </AccordionItem>

      {form.quote_channel === "partner" && (
        <AccordionItem value="production" className="rounded-lg border border-border px-4">
          <AccordionTrigger>Production partenaire</AccordionTrigger>
          <AccordionContent>
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="Statut production">
                <Select value={form.production_status || form.status || "draft"} onValueChange={(value) => setForm({ ...form, production_status: value, status: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{fitProductionStatuses.map((status) => <SelectItem key={status} value={status}>{productionStatusLabels[status] || status}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Réf. demande Japon"><Input value={form.japan_request_reference ?? ""} onChange={(event) => update("japan_request_reference", event.target.value)} /></Field>
              <Field label="Deadline Japon"><Input type="date" value={form.japan_request_deadline ?? ""} onChange={(event) => update("japan_request_deadline", event.target.value)} /></Field>
              <Field label="Validité réponse Japon"><Input type="date" value={form.japan_valid_until ?? ""} onChange={(event) => update("japan_valid_until", event.target.value)} /></Field>
              <div className="md:col-span-2"><Field label="Note publique production"><Textarea rows={compact ? 2 : 3} value={form.production_public_note ?? ""} onChange={(event) => update("production_public_note", event.target.value)} /></Field></div>
              <div className="md:col-span-2"><Field label="Réponse / conditions Japon internes"><Textarea rows={compact ? 2 : 3} value={form.japan_response_notes ?? ""} onChange={(event) => update("japan_response_notes", event.target.value)} /></Field></div>
            </div>
          </AccordionContent>
        </AccordionItem>
      )}

      <AccordionItem value="internal" className="rounded-lg border border-border px-4">
        <AccordionTrigger>Notes internes</AccordionTrigger>
        <AccordionContent>
          <Field label="Notes internes"><Textarea rows={compact ? 2 : 4} value={form.notes ?? ""} onChange={(event) => update("notes", event.target.value)} /></Field>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function TemplateForm({ form, setForm }: { form: any; setForm: (form: any) => void }) {
  const pricing = calculateTemplatePricing(form);
  const isNetAuto = (form.partner_net_pricing_mode || "auto") !== "manual";
  const pricedForm = applyTemplatePricing(form);
  const setPricedForm = (next: any) => setForm(applyTemplatePricing(next));
  const update = (key: string, value: unknown) => {
    const next = { ...form, [key]: value };
    setPricedForm(next);
  };
  const updateLine = (lineId: string, patch: any) => {
    const nextLines = (form.default_cost_lines ?? []).map((line: any) => {
      if (line.local_id !== lineId) return line;
      const nextLine = { ...line, ...patch };
      if ("is_optional" in patch) {
        nextLine.can_partner_disable = patch.is_optional === true;
        nextLine.partner_visible = patch.is_optional === true ? true : nextLine.partner_visible;
      }
      if ("included_in_calculation" in patch && patch.included_in_calculation === false) {
        nextLine.net_price_impact = 0;
      }
      return nextLine;
    });
    setPricedForm({ ...form, default_cost_lines: recalcLines(nextLines) });
  };
  const addLine = () => setPricedForm({ ...form, default_cost_lines: [...(form.default_cost_lines ?? []), { local_id: crypto.randomUUID(), category: "other", label: "", price_mad: 0, quantity: 1, times: 1, fee_type: "fixed", percentage_rate: 0, notes: "", is_optional: false, is_client_visible: false, included_in_calculation: true, cost_role: "supplier_cost", partner_visible: true, can_partner_disable: false, affects_partner_net_price: true, net_price_impact: 0 }] });
  const removeLine = (lineId: string) => setPricedForm({ ...form, default_cost_lines: (form.default_cost_lines ?? []).filter((line: any) => line.local_id !== lineId) });
  return (
    <div className="grid gap-3 md:grid-cols-4">
      <Field label="Titre"><Input value={form.title ?? ""} onChange={(event) => update("title", event.target.value)} /></Field>
      <Field label="Ville"><Input value={form.city ?? ""} onChange={(event) => update("city", event.target.value)} /></Field>
      <Field label="Thème"><Input value={form.theme ?? ""} onChange={(event) => update("theme", event.target.value)} /></Field>
      <Field label="Pax base"><Input type="number" value={form.pax_group_size ?? 2} onChange={(event) => update("pax_group_size", +event.target.value)} /></Field>
      <div className="md:col-span-4"><Field label="Texte source / description complète"><Textarea rows={5} value={form.source_description ?? form.description_client ?? ""} onChange={(event) => update("source_description", event.target.value)} /></Field></div>
      <div className="md:col-span-2"><Field label="Résumé vendeur client"><Textarea rows={2} value={form.sales_summary ?? form.client_summary ?? ""} onChange={(event) => setForm({ ...form, sales_summary: event.target.value, client_summary: event.target.value })} /></Field></div>
      <div className="md:col-span-2"><Field label="Description client optimisée"><Textarea rows={3} value={form.optimized_client_description ?? form.description_client ?? ""} onChange={(event) => setForm({ ...form, optimized_client_description: event.target.value, description_client: event.target.value })} /></Field></div>
      <div className="md:col-span-2"><Field label="Notes internes"><Textarea rows={3} value={form.internal_notes ?? ""} onChange={(event) => update("internal_notes", event.target.value)} /></Field></div>
      <Field label="Rythme">
        <Select value={form.rhythm || "moderate"} onValueChange={(value) => update("rhythm", value)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{rhythmOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <div className="md:col-span-2"><Field label="Transport"><MultiChoiceField options={transportOptions} value={form.transport_modes_text} onChange={(items) => update("transport_modes_text", items.join("\n"))} /></Field></div>
      <Field label="Coût JPY"><Input type="number" value={form.estimated_cost_jpy ?? 0} onChange={(event) => update("estimated_cost_jpy", +event.target.value)} /></Field>
      <Field label="Coût MAD"><Input type="number" value={pricedForm.estimated_cost_mad ?? 0} readOnly /></Field>
      <Field label="Prix vente MAD"><Input type="number" value={pricedForm.default_selling_price_mad ?? 0} readOnly /></Field>
      <Field label="Publication partenaire">
        <Select value={form.partner_publish_status || "internal"} onValueChange={(value) => update("partner_publish_status", value)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="internal">Interne uniquement</SelectItem>
            <SelectItem value="published">Publié partenaire</SelectItem>
            <SelectItem value="archived">Archivé partenaire</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Mode tarif net">
        <Select value={form.partner_net_pricing_mode || "auto"} onValueChange={(value) => update("partner_net_pricing_mode", value)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Automatique depuis vente</SelectItem>
            <SelectItem value="manual">Manuel</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Tarif net agence">
        <div className="space-y-1">
          <Input type="number" value={pricedForm.partner_net_price_mad ?? 0} readOnly={isNetAuto} onChange={(event) => update("partner_net_price_mad", +event.target.value)} />
          {!isNetAuto && <Badge variant="secondary">Tarif net agence manuel</Badge>}
        </div>
      </Field>
      <Field label="Guide requis"><Switch checked={Boolean(form.guide_required)} onCheckedChange={(checked) => update("guide_required", checked)} /></Field>
      <Field label="Nuit hôtel"><Switch checked={Boolean(form.hotel_night)} onCheckedChange={(checked) => update("hotel_night", checked)} /></Field>
      <Field label="Actif"><Switch checked={Boolean(form.is_active)} onCheckedChange={(checked) => update("is_active", checked)} /></Field>
      <Field label="Marge %"><Input type="number" value={form.margin_percent ?? 20} onChange={(event) => update("margin_percent", +event.target.value)} /></Field>
      <div className="md:col-span-4 grid gap-2 sm:grid-cols-5">
        <Metric label="Coût terrain jour" value={fmtMAD(pricing.groundCost)} compact />
        <Metric label="Frais agence Japon" value={fmtMAD(pricing.japanFee)} compact />
        <Metric label="Coût projet jour" value={fmtMAD(pricing.projectCost)} compact />
        <Metric label="Prix vente jour" value={fmtMAD(pricing.salePrice)} compact />
        <Metric label="Tarif net agence" value={fmtMAD(pricing.partnerNet)} compact />
      </div>
      <div className="md:col-span-4 rounded-lg border border-border bg-secondary/35 p-3 text-sm text-muted-foreground">
        {pricing.includedLines} ligne(s) incluses dans le calcul · {pricing.visibleLines} ligne(s) visibles client · {pricing.partnerOptions} option(s) partenaires
      </div>
      <div className="md:col-span-2"><Field label="Visites incluses"><Textarea rows={4} value={form.included_visits_text ?? ""} onChange={(event) => update("included_visits_text", event.target.value)} /></Field></div>
      <div className="md:col-span-2"><Field label="Visites optionnelles"><Textarea rows={4} value={form.optional_visits_text ?? ""} onChange={(event) => update("optional_visits_text", event.target.value)} /></Field></div>
      <div className="md:col-span-2"><Field label="Highlights client"><Textarea rows={3} value={form.client_highlights_text ?? ""} onChange={(event) => update("client_highlights_text", event.target.value)} /></Field></div>
      <div className="md:col-span-2"><Field label="Inclus client journée"><Textarea rows={3} value={form.client_inclusions_text ?? ""} onChange={(event) => update("client_inclusions_text", event.target.value)} /></Field></div>
      <div className="md:col-span-2"><Field label="Options client journée"><Textarea rows={3} value={form.client_options_text ?? ""} onChange={(event) => update("client_options_text", event.target.value)} /></Field></div>
      <div className="md:col-span-2"><Field label="Repas"><MultiChoiceField options={mealOptions} value={form.meal_plan_text || form.meals_text} onChange={(items) => setForm({ ...form, meal_plan_text: items.join("\n"), meals_text: items.join("\n"), meal_notes: items.join("\n") })} /></Field></div>
      <div className="md:col-span-4"><TemplateImageManager form={form} setForm={setForm} /></div>
      <div className="md:col-span-4"><Field label="Tags"><Textarea rows={3} value={form.tags_text ?? ""} onChange={(event) => update("tags_text", event.target.value)} /></Field></div>
      <div className="md:col-span-4">
        <div className="mb-2 flex items-center justify-between">
          <Label>Lignes de coût par défaut</Label>
          <Button type="button" variant="outline" size="sm" onClick={addLine}><Plus className="h-4 w-4" /> Ligne</Button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <div className="min-w-[1280px]">
            <div className="grid grid-cols-[150px_1fr_110px_90px_90px_120px_1fr_80px_80px_90px_80px_90px_110px_44px] gap-2 bg-secondary/70 p-2 text-xs font-semibold">
              <span>Catégorie</span><span>Contents</span><span>Price/%</span><span>No</span><span>Times</span><span>Subtotal</span><span>Notes</span><span>Calcul</span><span>Client</span><span>Partenaire</span><span>Option</span><span>Affecte</span><span>Impact net</span><span />
            </div>
            {(form.default_cost_lines ?? []).map((line: any) => (
              <div key={line.local_id} className="grid grid-cols-[150px_1fr_110px_90px_90px_120px_1fr_80px_80px_90px_80px_90px_110px_44px] gap-2 border-t border-border p-2">
                <CategorySelect value={line.category} onChange={(value) => updateLine(line.local_id, { category: value })} />
                <Input value={line.label ?? ""} onChange={(event) => updateLine(line.local_id, { label: event.target.value })} />
                <Input type="number" value={line.category === "agency_fee" && line.fee_type !== "fixed" ? line.percentage_rate ?? 20 : line.price_mad ?? 0} onChange={(event) => updateLine(line.local_id, line.category === "agency_fee" && line.fee_type !== "fixed" ? { percentage_rate: +event.target.value } : { price_mad: +event.target.value })} />
                <Input type="number" value={line.quantity ?? 1} onChange={(event) => updateLine(line.local_id, { quantity: +event.target.value })} />
                <Input type="number" value={line.times ?? 1} onChange={(event) => updateLine(line.local_id, { times: +event.target.value })} />
                <Input readOnly value={line.subtotal_mad ?? 0} />
                <Input value={line.notes ?? ""} onChange={(event) => updateLine(line.local_id, { notes: event.target.value })} />
                <Switch checked={line.included_in_calculation !== false} onCheckedChange={(checked) => updateLine(line.local_id, { included_in_calculation: checked })} />
                <Switch checked={Boolean(line.is_client_visible)} onCheckedChange={(checked) => updateLine(line.local_id, { is_client_visible: checked })} />
                <Switch checked={line.partner_visible !== false} onCheckedChange={(checked) => updateLine(line.local_id, { partner_visible: checked })} />
                <Switch checked={Boolean(line.is_optional)} onCheckedChange={(checked) => updateLine(line.local_id, { is_optional: checked, is_client_visible: checked ? true : line.is_client_visible })} />
                <Switch checked={line.affects_partner_net_price !== false} onCheckedChange={(checked) => updateLine(line.local_id, { affects_partner_net_price: checked })} />
                <Input type="number" value={line.net_price_impact ?? line.subtotal_mad ?? 0} onChange={(event) => updateLine(line.local_id, { net_price_impact: +event.target.value })} />
                <Button size="icon" variant="ghost" onClick={() => removeLine(line.local_id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DayImageManager({ day, updateDay, quoteId }: { day: any; updateDay: (localId: string, patch: any) => void; quoteId?: string }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const urls = Array.isArray(day.image_urls) ? day.image_urls.filter(Boolean) : listFromText(day.image_urls);
  const setUrls = (next: string[]) => updateDay(day.local_id, { image_urls: next.filter(Boolean) });

  const uploadImages = async (files: FileList | null) => {
    const selected = Array.from(files ?? []);
    if (!selected.length) return;
    const valid = selected.filter((file) => {
      if (!["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(file.type)) {
        toast.error(`${file.name}: format non accepté.`);
        return false;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast.error(`${file.name}: image trop lourde, maximum recommandé 5 MB.`);
        return false;
      }
      return true;
    });
    if (!valid.length) return;
    setUploading(true);
    const uploaded: string[] = [];
    try {
      const folder = quoteId || "draft";
      for (const file of valid) {
        const safeName = file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").toLowerCase();
        const path = `fit-quotes/${folder}/${day.local_id}/${Date.now()}-${safeName}`;
        const { error } = await supabase.storage.from("programme-images").upload(path, file, {
          upsert: false,
          contentType: file.type,
        });
        if (error) throw error;
        uploaded.push(supabase.storage.from("programme-images").getPublicUrl(path).data.publicUrl);
      }
      setUrls([...urls, ...uploaded]);
      toast.success(`${uploaded.length} photo(s) ajoutée(s) à la journée.`);
    } catch (error: any) {
      toast.error(error?.message ?? "Upload photo impossible.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const removeImage = async (url: string) => {
    const path = imagePathFromPublicUrl(url);
    if (path) await supabase.storage.from("programme-images").remove([path]);
    setUrls(urls.filter((item) => item !== url));
  };

  const moveImage = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= urls.length) return;
    const next = [...urls];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);
    setUrls(next);
  };

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Label>Photos journée</Label>
          <p className="text-xs text-muted-foreground">La première photo est utilisée comme couverture, les suivantes en galerie client.</p>
        </div>
        <div>
          <input ref={inputRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp" multiple className="hidden" onChange={(event) => uploadImages(event.target.files)} />
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? <Upload className="h-4 w-4 animate-pulse" /> : <ImagePlus className="h-4 w-4" />}
            Ajouter photo
          </Button>
        </div>
      </div>
      {urls.length > 0 ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {urls.map((url, index) => (
            <div key={`${url}-${index}`} className="overflow-hidden rounded-lg border border-border bg-background">
              <div className="aspect-[4/3] bg-secondary">
                <img src={url} alt={`${day.title || "Journée"} photo ${index + 1}`} width={320} height={240} className="h-full w-full object-cover" loading="lazy" />
              </div>
              <div className="flex items-center justify-between gap-1 p-2">
                <span className="truncate text-xs text-muted-foreground">{index === 0 ? "Couverture" : `Photo ${index + 1}`}</span>
                <div className="flex gap-1">
                  <Button type="button" size="icon" variant="ghost" onClick={() => moveImage(index, -1)} disabled={index === 0}><ArrowUp className="h-4 w-4" /></Button>
                  <Button type="button" size="icon" variant="ghost" onClick={() => moveImage(index, 1)} disabled={index === urls.length - 1}><ArrowDown className="h-4 w-4" /></Button>
                  <Button type="button" size="icon" variant="ghost" onClick={() => removeImage(url)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          Aucune photo. Une image fallback sera utilisée côté client.
        </div>
      )}
    </div>
  );
}

function TemplateImageManager({ form, setForm }: { form: any; setForm: (form: any) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const urls = imageUrlsFromForm(form);
  const setUrls = (next: string[]) => setForm({ ...form, image_urls_text: next.filter(Boolean).join("\n") });

  const uploadImages = async (files: FileList | null) => {
    const selected = Array.from(files ?? []);
    if (!selected.length) return;
    const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    const valid = selected.filter((file) => {
      if (!validTypes.includes(file.type)) {
        toast.error(`${file.name}: format non accepté.`);
        return false;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast.error(`${file.name}: image trop lourde, maximum recommandé 5 MB.`);
        return false;
      }
      return true;
    });
    if (!valid.length) return;
    const folderId = form.id || form.local_upload_key || crypto.randomUUID();
    const localUploadKey = form.local_upload_key || folderId;
    setUploading(true);
    const uploaded: string[] = [];
    try {
      for (let index = 0; index < valid.length; index += 1) {
        const file = valid[index];
        setUploadStatus(`${index + 1}/${valid.length}`);
        const safeName = file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").toLowerCase();
        const path = `fit-day-templates/${folderId}/${Date.now()}-${safeName}`;
        const { error } = await supabase.storage.from("programme-images").upload(path, file, {
          upsert: false,
          contentType: file.type,
        });
        if (error) throw error;
        const url = supabase.storage.from("programme-images").getPublicUrl(path).data.publicUrl;
        uploaded.push(url);
      }
      setForm({
        ...form,
        local_upload_key: localUploadKey,
        image_urls_text: [...urls, ...uploaded].join("\n"),
      });
      toast.success(`${uploaded.length} image(s) uploadée(s).`);
    } catch (error: any) {
      toast.error(error?.message ?? "Upload image impossible.");
    } finally {
      setUploading(false);
      setUploadStatus("");
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const removeImage = async (url: string) => {
    const path = imagePathFromPublicUrl(url);
    if (path) {
      await supabase.storage.from("programme-images").remove([path]);
    }
    setUrls(urls.filter((item) => item !== url));
  };

  const moveImage = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= urls.length) return;
    const next = [...urls];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);
    setUrls(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Label>Images</Label>
          <p className="text-xs text-muted-foreground">JPG, PNG ou WebP. Les images uploadées sont utilisées dans le devis public et les PDFs.</p>
        </div>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(event) => uploadImages(event.target.files)}
          />
          <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? <Upload className="h-4 w-4 animate-pulse" /> : <ImagePlus className="h-4 w-4" />}
            {uploading ? `Upload ${uploadStatus}` : "Uploader images"}
          </Button>
        </div>
      </div>

      {urls.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {urls.map((url, index) => (
            <div key={`${url}-${index}`} className="overflow-hidden rounded-lg border border-border bg-background">
              <div className="aspect-[4/3] bg-secondary">
                <img
                  src={url}
                  alt={`Image template ${index + 1}`}
                  width={320}
                  height={240}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              </div>
              <div className="flex items-center justify-between gap-1 p-2">
                <span className="truncate text-xs text-muted-foreground">Image {index + 1}</span>
                <div className="flex gap-1">
                  <Button type="button" size="icon" variant="ghost" onClick={() => moveImage(index, -1)} disabled={index === 0}><ArrowUp className="h-4 w-4" /></Button>
                  <Button type="button" size="icon" variant="ghost" onClick={() => moveImage(index, 1)} disabled={index === urls.length - 1}><ArrowDown className="h-4 w-4" /></Button>
                  <Button type="button" size="icon" variant="ghost" onClick={() => removeImage(url)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Aucune image enregistrée pour cette journée.
        </div>
      )}

      <Field label="URLs manuelles optionnelles">
        <Textarea
          rows={3}
          value={form.image_urls_text ?? ""}
          onChange={(event) => setForm({ ...form, image_urls_text: event.target.value })}
          placeholder="Une URL par ligne"
        />
      </Field>
    </div>
  );
}
