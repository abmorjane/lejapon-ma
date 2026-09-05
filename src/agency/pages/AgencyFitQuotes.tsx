import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Copy, CopyPlus, CreditCard, Download, ExternalLink, FileText, History, ListChecks, Loader2, MoreHorizontal, Pencil, Plus, Send, ShieldCheck, Trash2 } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FitInput as Input, FitTextarea as Textarea } from "@/components/fit/FitFormControls";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { fmtDateTime, fmtMAD } from "@/lib/format";
import { downloadFitPdf, generateFitClientPdf } from "@/lib/fit-pdfs";
import { useAuth } from "@/hooks/useAuth";
import { useOptionalAgencyContext } from "../useAgencyContext";
import {
  PARTNER_COMPONENT_COLUMNS,
  PARTNER_FIT_DAY_COLUMNS,
  PARTNER_FIT_SAFE_QUOTE_COLUMNS,
  PARTNER_TEMPLATE_COLUMNS,
  QUOTE_COMPONENT_COLUMNS,
  calculateDayNet,
  calculatePartnerPricing,
  clientListsFromComponents,
  listItems,
  numberValue,
  partnerQuoteNumber,
  partnerShareToken,
  type PartnerMarginType,
} from "../lib/fitPartner";

type DbClient = { from: (table: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any };
const db = supabase as unknown as DbClient;

const DEFAULT_FIT_CANCELLATION_CONDITIONS = `Cette proposition est établie sous réserve de disponibilité au moment de la confirmation. Aucune réservation ferme n’est effectuée avant validation finale, réception de l’acompte demandé et confirmation des prestataires.

Hôtels : à partir de 90 jours avant le départ, les hôtels peuvent appliquer des frais d’annulation partiels ou totaux selon les conditions de chaque établissement. Certains hôtels, périodes de haute saison, chambres familiales ou groupes peuvent être non remboursables dès confirmation.

Vols : les billets d’avion sont soumis aux conditions de la compagnie aérienne. Une fois émis, ils peuvent être non remboursables, non modifiables ou modifiables avec frais selon la classe tarifaire.

Trains, musées, visites et activités : les billets, entrées, expériences et activités déjà émis peuvent être non remboursables et non modifiables.

Guides, transferts et transports privés : des frais d’annulation peuvent s’appliquer après confirmation selon les délais imposés par les prestataires locaux.

Frais de service : les frais de traitement, préparation, conseil, coordination et réservation peuvent rester dus après validation du dossier.

Toute modification après validation peut entraîner une révision du prix, des frais supplémentaires ou une indisponibilité de certaines prestations.

Le paiement de l’acompte ou la validation écrite du devis implique l’acceptation des conditions de réservation, de modification et d’annulation.`;

const cleanPayload = (payload: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));

const defaultQuoteForm = {
  client_name: "",
  travelers_count: 2,
  travel_start_date: "",
  travel_end_date: "",
  valid_until: "",
  hotel_category: "Hôtels 4★",
  room_type: "Chambre twin/double selon disponibilité",
  payment_conditions: "Paiement uniquement après validation finale de LeJapon.ma et confirmation des disponibilités.",
  booking_conditions: "Réservation sous réserve de disponibilité au moment de la validation finale.",
  cancellation_conditions: DEFAULT_FIT_CANCELLATION_CONDITIONS,
  exclusions: "Vols internationaux\nDépenses personnelles\nRepas non mentionnés\nOptions non confirmées\nAssurances si non précisées",
};

const defaultEditForm = {
  ...defaultQuoteForm,
  client_notes: "",
  partner_margin_type: "percent",
  partner_margin_value: 15,
  manual_adjustment_mad: 0,
};

const statusLabels: Record<string, string> = {
  draft: "Brouillon",
  sent_to_client: "Envoyé client",
  client_modification_requested: "Modification client",
  client_preapproved: "Accord client reçu",
  pending_lejapon_review: "Vérification LeJapon.ma",
  pending_japan_availability: "Disponibilités Japon",
  japan_request_sent: "Demande Japon envoyée",
  japan_quote_received: "Réponse Japon reçue",
  admin_approved_for_payment: "Paiement autorisé",
  payment_authorized: "Paiement autorisé",
  partner_payment_pending: "Paiement demandé",
  partner_payment_received: "Paiement reçu",
  booking_in_progress: "Réservation en cours",
  partially_confirmed: "Partiellement confirmé",
  confirmed: "Confirmé",
  pending_partner_review: "Revue agence",
  pending_lejapon_approval: "Validation LeJapon.ma",
  approved: "Approuvé",
  sent: "Envoyé",
  accepted: "Accepté",
  modification_requested: "Modification demandée",
  expired: "Expiré",
  cancelled: "Annulé",
};

const productionMessages: Record<string, { title: string; body: string }> = {
  draft: {
    title: "En préparation",
    body: "Ce devis peut être préparé puis partagé comme proposition commerciale. Le paiement client n’est pas autorisé à ce stade.",
  },
  sent_to_client: {
    title: "En attente de retour client",
    body: "Le client peut accepter la proposition sous réserve de disponibilité ou demander une modification.",
  },
  client_modification_requested: {
    title: "Modification demandée",
    body: "Le client souhaite ajuster la proposition avant vérification des disponibilités.",
  },
  client_preapproved: {
    title: "Accord client reçu — vérification LeJapon.ma en cours",
    body: "LeJapon.ma doit vérifier les disponibilités avant toute demande de paiement.",
  },
  pending_lejapon_review: {
    title: "Vérification LeJapon.ma en cours",
    body: "Le paiement client ne doit pas être encaissé avant validation finale.",
  },
  pending_japan_availability: {
    title: "Disponibilités en vérification",
    body: "LeJapon.ma vérifie les hôtels, guides, transports, trains et activités.",
  },
  japan_request_sent: {
    title: "Demande envoyée au bureau Japon",
    body: "La réponse du bureau Japon est attendue avant autorisation de paiement.",
  },
  japan_quote_received: {
    title: "Réponse Japon reçue",
    body: "LeJapon.ma examine les disponibilités, prix et conditions avant validation.",
  },
  admin_approved_for_payment: {
    title: "Disponibilités validées — paiement autorisé",
    body: "Vous pouvez maintenant encaisser le client selon les conditions indiquées.",
  },
  payment_authorized: {
    title: "Paiement autorisé",
    body: "Vous pouvez demander l’acompte ou le paiement au client.",
  },
  partner_payment_pending: {
    title: "Paiement demandé",
    body: "Le paiement est en attente de réception côté agence.",
  },
  partner_payment_received: {
    title: "Paiement reçu — réservations en cours",
    body: "LeJapon.ma peut poursuivre les réservations selon les disponibilités validées.",
  },
  booking_in_progress: {
    title: "Réservations en cours",
    body: "Les prestations sont en cours de réservation.",
  },
  confirmed: {
    title: "Prestations principales confirmées",
    body: "Le dossier est confirmé selon les conditions communiquées.",
  },
};

const productionKey = (quote: any) => quote?.production_status || quote?.status || "draft";
const paymentAllowed = (quote: any) => ["admin_approved_for_payment", "payment_authorized", "partner_payment_pending", "partner_payment_received", "booking_in_progress", "partially_confirmed", "confirmed"].includes(productionKey(quote));

const componentLabels: Record<string, string> = {
  guide: "Guide",
  transport: "Transport",
  activity: "Activité",
  entry: "Entrée",
  meal: "Repas",
  luggage_transfer: "Bagages",
  option: "Option",
  assistance: "Assistance",
  hotel: "Hôtel",
  train: "Train",
  shinkansen: "Shinkansen",
  other: "Autre",
};

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="space-y-1.5">
    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</Label>
    {children}
  </div>
);

const Metric = ({ label, value, muted }: { label: string; value: string; muted?: boolean }) => (
  <div className="rounded-md border border-border bg-background p-3">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className={muted ? "mt-1 text-sm font-semibold text-muted-foreground" : "mt-1 text-lg font-semibold"}>{value}</p>
  </div>
);

const sortQuoteDays = (items: any[]) =>
  [...items].sort((a, b) => {
    const dayDelta = numberValue(a.day_number) - numberValue(b.day_number);
    if (dayDelta !== 0) return dayDelta;
    const sortDelta = numberValue(a.sort_order) - numberValue(b.sort_order);
    if (sortDelta !== 0) return sortDelta;
    return String(a.created_at || "").localeCompare(String(b.created_at || ""));
  });

const mergeById = (...groups: any[][]) => {
  const byId = new Map<string, any>();
  groups.flat().filter(Boolean).forEach((item) => {
    if (!item?.id) return;
    byId.set(String(item.id), { ...(byId.get(String(item.id)) ?? {}), ...item });
  });
  return Array.from(byId.values());
};

export default function AgencyFitQuotes({ mode = "partner" }: { mode?: "partner" | "sales" }) {
  const [searchParams] = useSearchParams();
  const { user, roles } = useAuth();
  const agencyContext = useOptionalAgencyContext();
  const organization = mode === "partner" ? agencyContext?.organization ?? null : null;
  const currentMembership = mode === "partner" ? agencyContext?.currentMembership ?? null : null;
  const isSalesMode = mode === "sales";
  const isCommercialUser = roles.some((role) => ["manager", "sales", "sales_user", "sales_manager"].includes(role));
  const [quotes, setQuotes] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateComponents, setTemplateComponents] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [partnerProfile, setPartnerProfile] = useState<any>(null);
  const [selectedQuote, setSelectedQuote] = useState<any | null>(null);
  const [duplicateTarget, setDuplicateTarget] = useState<any | null>(null);
  const [duplicateAndEdit, setDuplicateAndEdit] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [versionTarget, setVersionTarget] = useState<any | null>(null);
  const [versioning, setVersioning] = useState(false);
  const [pricing, setPricing] = useState<any | null>(null);
  const [days, setDays] = useState<any[]>([]);
  const [components, setComponents] = useState<any[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState(defaultQuoteForm);
  const [editForm, setEditForm] = useState(defaultEditForm);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [commission, setCommission] = useState<any | null>(null);

  const canAdjustMargin = isSalesMode || currentMembership?.role !== "viewer";
  const netLabel = isSalesMode ? "Total net commercial" : "Total net agence";
  const dayNetLabel = isSalesMode ? "Tarif net commercial / jour" : "Tarif net agence / jour";
  const marginLabel = isSalesMode ? "Marge commerciale" : "Marge agence";
  const defaultSettings = {
    default_margin_type: "percent",
    default_margin_value: 15,
    min_margin_value: 0,
    requires_approval_below_margin: true,
    allow_manual_adjustment: true,
  };
  const effectiveSettings = settings ?? defaultSettings;
  const shareUrl = selectedQuote?.share_token ? `${window.location.origin}/devis-fit/${selectedQuote.share_token}` : "";
  const currentQuotes = useMemo(() => quotes.filter((quote) => quote.is_current_version !== false), [quotes]);
  const quoteVersions = useMemo(() => {
    if (!selectedQuote) return [];
    const groupId = selectedQuote.quote_group_id || selectedQuote.id;
    return quotes
      .filter((quote) => (quote.quote_group_id || quote.id) === groupId)
      .sort((a, b) => numberValue(b.version_number) - numberValue(a.version_number));
  }, [quotes, selectedQuote]);
  const isHistoricalVersion = selectedQuote?.is_current_version === false;

  const quoteToEditForm = (quote: any, quotePricing = pricing) => ({
    client_name: quote?.client_name || "",
    travelers_count: Math.max(1, numberValue(quote?.travelers_count || 1)),
    travel_start_date: quote?.travel_start_date || "",
    travel_end_date: quote?.travel_end_date || "",
    valid_until: quote?.valid_until || "",
    hotel_category: quote?.hotel_category || "",
    room_type: quote?.room_type || "",
    payment_conditions: quote?.payment_conditions || defaultQuoteForm.payment_conditions,
    booking_conditions: quote?.booking_conditions || defaultQuoteForm.booking_conditions,
    cancellation_conditions: quote?.cancellation_conditions || defaultQuoteForm.cancellation_conditions,
    exclusions: quote?.exclusions || "",
    client_notes: quote?.client_notes || "",
    partner_margin_type: quotePricing?.partner_margin_type || effectiveSettings.default_margin_type || "percent",
    partner_margin_value: numberValue(quotePricing?.partner_margin_value ?? effectiveSettings.default_margin_value ?? 15),
    manual_adjustment_mad: numberValue(quotePricing?.manual_adjustment_mad),
  });

  const applyRpcQuoteState = (quote: any, nextPricing?: any) => {
    if (!quote?.id) return;
    setSelectedQuote(quote);
    setQuotes((current) => current.map((item) => item.id === quote.id ? { ...item, ...quote } : item));
    if (nextPricing) setPricing((current: any) => ({ ...(current ?? {}), quote_id: quote.id, organization_id: quote.partner_organization_id ?? organization?.id ?? null, ...nextPricing }));
  };

  const load = async () => {
    if (!user) return;
    if (mode === "partner" && !organization) return;
    setLoading(true);
    const quoteQuery = db
        .from("fit_quotes")
        .select(PARTNER_FIT_SAFE_QUOTE_COLUMNS)
        .eq("quote_channel", "partner")
        .is("deleted_at", null)
        .is("archived_at", null)
        .order("updated_at", { ascending: false });
    const scopedQuoteQuery = isSalesMode
      ? quoteQuery.is("partner_organization_id", null).eq("owner_user_id", user.id)
      : quoteQuery.eq("partner_organization_id", organization!.id);

    const queries = [
      scopedQuoteQuery,
      db.from("fit_partner_day_templates").select(PARTNER_TEMPLATE_COLUMNS).eq("is_published", true).order("city").order("title"),
      db.from("fit_partner_day_template_components").select(PARTNER_COMPONENT_COLUMNS).order("sort_order"),
      isSalesMode ? Promise.resolve({ data: defaultSettings }) : db.from("partner_quote_settings").select("*").eq("organization_id", organization!.id).maybeSingle(),
      isSalesMode ? Promise.resolve({ data: null }) : db.from("partner_organizations").select("*").eq("id", organization!.id).maybeSingle(),
    ];
    const [{ data: quoteRows }, { data: templateRows }, { data: componentRows }, { data: settingsRows }, { data: profileRow }] = await Promise.all(queries);
    setQuotes(quoteRows ?? []);
    setTemplates(templateRows ?? []);
    setTemplateComponents(componentRows ?? []);
    setSettings(settingsRows ?? defaultSettings);
    setPartnerProfile(profileRow ?? null);
    const requestedQuote = searchParams.get("quote");
    const targetQuote = requestedQuote ? (quoteRows ?? []).find((quote: any) => quote.id === requestedQuote) : null;
    if (targetQuote) await loadQuote(targetQuote);
    setLoading(false);
  };

  const loadQuote = async (quote: any) => {
    setSelectedQuote(quote);
    const [{ data: dayRows, error: daysError }, { data: pricingRow, error: pricingError }, { data: agentCommission }, { data: ownerCommission }] = await Promise.all([
      db.from("fit_quote_days").select(PARTNER_FIT_DAY_COLUMNS).eq("quote_id", quote.id).order("day_number", { ascending: true }).order("sort_order", { ascending: true }),
      db.from("fit_quote_partner_pricing").select("*").eq("quote_id", quote.id).maybeSingle(),
      db.from("agency_fit_sales_agent_commissions").select("*").eq("fit_quote_id", quote.id).eq("is_current", true).maybeSingle(),
      db.from("agency_fit_owner_commissions").select("*").eq("fit_quote_id", quote.id).eq("is_current", true).maybeSingle(),
    ]);
    setCommission(ownerCommission || agentCommission || null);
    if (daysError) throw daysError;
    if (pricingError) throw pricingError;
    const quoteDays = dayRows ?? [];
    const dayIds = quoteDays.map((day: any) => day.id);
    const { data: componentRows, error: componentsError } = dayIds.length
      ? await db.from("fit_quote_day_components").select(QUOTE_COMPONENT_COLUMNS).in("quote_day_id", dayIds)
      : { data: [], error: null };
    if (componentsError) throw componentsError;
    setDays(quoteDays);
    setComponents(componentRows ?? []);
    setPricing(pricingRow ?? null);
    return { quote, days: quoteDays, components: componentRows ?? [], pricing: pricingRow ?? null };
  };

  const refreshSelectedQuote = async (quoteId: string) => {
    const { data: quoteRow, error } = await db
      .from("fit_quotes")
      .select(PARTNER_FIT_SAFE_QUOTE_COLUMNS)
      .eq("id", quoteId)
      .single();
    if (error) throw error;
    if (!quoteRow) throw new Error("Devis introuvable après mise à jour.");
    setQuotes((current) => current.map((item) => item.id === quoteRow.id ? quoteRow : item));
    return loadQuote(quoteRow);
  };

  useEffect(() => { void load(); }, [organization?.id, user?.id, mode]);

  const computed = useMemo(() => calculatePartnerPricing({
    days,
    components,
    travelers: selectedQuote?.travelers_count || form.travelers_count,
    marginType: (pricing?.partner_margin_type || effectiveSettings.default_margin_type || "percent") as PartnerMarginType,
    marginValue: numberValue(pricing?.partner_margin_value ?? effectiveSettings.default_margin_value ?? 0),
    manualAdjustment: numberValue(pricing?.manual_adjustment_mad),
    minMarginValue: numberValue(effectiveSettings.min_margin_value),
    requiresApprovalBelowMargin: effectiveSettings.requires_approval_below_margin !== false,
  }), [days, components, selectedQuote?.travelers_count, pricing, settings, form.travelers_count, mode]);

  const logAction = async (quoteId: string, actionType: string, payload: Record<string, any> = {}) => {
    if (!user) return;
    await db.from("quote_audit_logs").insert({
      quote_id: quoteId,
      organization_id: organization?.id ?? null,
      user_id: user.id,
      action_type: actionType,
      payload,
    });
  };

  const persistPricing = async (quote = selectedQuote, quoteDays = days, quoteComponents = components, nextPricing = pricing) => {
    if (!user || !quote) return null;
    if (mode === "partner" && !organization) return null;
    if (quote.is_current_version === false) return null;
    setAutosaveStatus("saving");
    const result = calculatePartnerPricing({
      days: quoteDays,
      components: quoteComponents,
      travelers: quote.travelers_count,
      marginType: (nextPricing?.partner_margin_type || effectiveSettings.default_margin_type || "percent") as PartnerMarginType,
      marginValue: numberValue(nextPricing?.partner_margin_value ?? effectiveSettings.default_margin_value ?? 0),
      manualAdjustment: numberValue(nextPricing?.manual_adjustment_mad),
      minMarginValue: numberValue(effectiveSettings.min_margin_value),
      requiresApprovalBelowMargin: effectiveSettings.requires_approval_below_margin !== false,
    });
    const patchPricing = {
      quote_id: quote.id,
      organization_id: organization?.id ?? null,
      net_partner_total: result.netPartnerTotal,
      partner_margin_type: nextPricing?.partner_margin_type || effectiveSettings.default_margin_type || "percent",
      partner_margin_value: numberValue(nextPricing?.partner_margin_value ?? effectiveSettings.default_margin_value ?? 0),
      partner_margin_total: result.partnerMarginTotal,
      manual_adjustment_mad: numberValue(nextPricing?.manual_adjustment_mad),
      client_sale_total: result.clientSaleTotal,
      client_sale_per_person: result.clientSalePerPerson,
      approval_required: result.approvalRequired,
      approval_reason: result.approvalReason,
    };
    const { error: pricingSaveError } = await db.from("fit_quote_partner_pricing").upsert(patchPricing);
    if (pricingSaveError) {
      setAutosaveStatus("error");
      throw pricingSaveError;
    }

    const totalNet = Math.max(1, result.netPartnerTotal);
    const dayUpdates = quoteDays.map((day: any) => {
      const dayNet = calculateDayNet(day, quoteComponents);
      const marginShare = Math.round(result.partnerMarginTotal * (dayNet / totalNet));
      const clientLists = clientListsFromComponents(day, quoteComponents);
      return db.from("fit_quote_days").update({
        selling_price_mad: dayNet + marginShare,
        ...clientLists,
      }).eq("id", day.id);
    });
    const dayResults = await Promise.all(dayUpdates);
    const daySaveError = dayResults.find((result: any) => result.error)?.error;
    if (daySaveError) {
      setAutosaveStatus("error");
      throw daySaveError;
    }

    const mutablePricingStatuses = ["draft", "sent", "sent_to_client", "pending_partner_review", "pending_lejapon_approval"];
    const quoteStatus = result.approvalRequired && mutablePricingStatuses.includes(quote.status)
      ? "pending_lejapon_approval"
      : quote.status === "pending_lejapon_approval"
        ? "draft"
        : quote.status;
    const quotePatch = {
      total_selling_price_mad: result.clientSaleTotal,
      price_per_person_mad: result.clientSalePerPerson,
      total_cost_mad: 0,
      margin_amount_mad: 0,
      margin_percent: 0,
      requires_lejapon_approval: result.approvalRequired,
      approval_reason: result.approvalReason,
      status: quoteStatus,
    };
    const { error: quoteSaveError } = await db.from("fit_quotes").update(quotePatch).eq("id", quote.id);
    if (quoteSaveError) {
      setAutosaveStatus("error");
      throw quoteSaveError;
    }
    const updatedQuote = { ...quote, ...quotePatch };
    setSelectedQuote(updatedQuote);
    setPricing(patchPricing);
    setQuotes((current) => current.map((item) => item.id === quote.id ? { ...item, ...quotePatch } : item));
    setAutosaveStatus("saved");
    return { result, quote: updatedQuote, pricing: patchPricing };
  };

  const createQuote = async () => {
    if (!user) return;
    if (mode === "partner" && !organization) return;
    if (isSalesMode && !isCommercialUser) return toast.error("Votre rôle ne permet pas de créer un devis FIT commercial.");
    if (!form.client_name.trim()) return toast.error("Nom client requis.");
    setBusy(true);
    const quotePayload = cleanPayload({
      quote_number: partnerQuoteNumber(),
      client_name: form.client_name.trim(),
      travelers_count: Math.max(1, numberValue(form.travelers_count)),
      travel_start_date: form.travel_start_date || null,
      travel_end_date: form.travel_end_date || null,
      valid_until: form.valid_until || null,
      hotel_category: form.hotel_category || null,
      room_type: form.room_type || null,
      currency: "MAD",
      language: "fr",
      status: "draft",
      quote_channel: "partner",
      partner_organization_id: organization?.id ?? null,
      partner_branding_mode: isSalesMode ? "lejapon_primary" : partnerProfile?.branding_mode || "co_branded",
      partner_contact_name: user.user_metadata?.full_name || user.email,
      payment_conditions: form.payment_conditions,
      booking_conditions: form.booking_conditions,
      cancellation_conditions: form.cancellation_conditions,
      exclusions: form.exclusions,
      inclusions: isSalesMode ? "Programme selon descriptif\nAssistance LeJapon.ma" : "Programme selon descriptif\nAssistance de votre conseiller agence",
      total_cost_mad: 0,
      margin_amount_mad: 0,
      margin_percent: 0,
      total_selling_price_mad: 0,
      price_per_person_mad: 0,
      owner_user_id: user.id,
      created_by: user.id,
    });
    const { data: quote, error } = await db.from("fit_quotes").insert(quotePayload).select(PARTNER_FIT_SAFE_QUOTE_COLUMNS).single();
    if (error) {
      setBusy(false);
      return toast.error(error.message);
    }
    if (organization) {
      await db.from("fit_quote_access").insert({ quote_id: quote.id, organization_id: organization.id, owner_user_id: user.id, role_scope: "partner_owner" });
    }
    await db.from("fit_quote_partner_pricing").insert({
      quote_id: quote.id,
      organization_id: organization?.id ?? null,
      partner_margin_type: effectiveSettings.default_margin_type || "percent",
      partner_margin_value: numberValue(effectiveSettings.default_margin_value ?? 15),
    });
    await logAction(quote.id, isSalesMode ? "sales_fit_quote_created" : "partner_quote_created", { quote_number: quote.quote_number });
    setQuotes((current) => [quote, ...current]);
    setCreateOpen(false);
    setForm(defaultQuoteForm);
    await loadQuote(quote);
    setBusy(false);
    toast.success(isSalesMode ? "Devis FIT commercial créé." : "Devis FIT partenaire créé.");
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
        .select(PARTNER_FIT_SAFE_QUOTE_COLUMNS)
        .eq("id", data.new_quote_id)
        .single();
      if (fetchError || !createdQuote) throw fetchError || new Error("Copie créée mais impossible à ouvrir.");
      const duplicatedQuote = { ...createdQuote, duplicated_from_reference: data.source_reference };
      setDuplicateTarget(null);
      await load();
      const loaded = await loadQuote(duplicatedQuote);
      if (duplicateAndEdit) {
        setEditForm(quoteToEditForm(duplicatedQuote, loaded.pricing));
        setEditOpen(true);
      }
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
        .select(PARTNER_FIT_SAFE_QUOTE_COLUMNS)
        .eq("id", data?.new_quote_id)
        .single();
      if (fetchError || !createdQuote) throw fetchError || new Error("La nouvelle version ne peut pas être ouverte.");
      setVersionTarget(null);
      await load();
      const loaded = await loadQuote(createdQuote);
      setEditForm(quoteToEditForm(createdQuote, loaded.pricing));
      setEditOpen(true);
      toast.success(`Version V${data.version_number} créée.`, {
        description: `${data.family_reference} reste lié à son historique. La version précédente est en lecture seule.`,
      });
    } catch (error: any) {
      toast.error(error?.message || "Impossible de créer une nouvelle version.");
    } finally {
      setVersioning(false);
    }
  };

  const deleteQuote = async (quote = selectedQuote) => {
    if (!quote?.id || !user) return;
    if (!confirm("Voulez-vous vraiment supprimer ce devis ?")) return;
    setBusy(true);
    const { error } = await db.rpc("soft_delete_fit_quote", { _quote_id: quote.id });
    if (error) {
      setBusy(false);
      return toast.error(error.message);
    }
    setSelectedQuote(null);
    setDays([]);
    setComponents([]);
    setPricing(null);
    setQuotes((current) => current.filter((item) => item.id !== quote.id));
    setBusy(false);
    toast.success("Devis supprimé.");
  };

  const archiveQuote = async () => {
    if (!selectedQuote?.id || !user || isHistoricalVersion) return;
    if (!confirm("Archiver ce devis FIT ? Il sera retiré de la liste active.")) return;
    const { error } = await db.from("fit_quotes").update({ archived_at: new Date().toISOString(), archived_by: user.id, share_enabled: false }).eq("id", selectedQuote.id);
    if (error) return toast.error(error.message);
    setSelectedQuote(null);
    setDays([]);
    setComponents([]);
    setPricing(null);
    setQuotes((current) => current.filter((quote) => quote.id !== selectedQuote.id));
    toast.success("Devis FIT archivé.");
  };

  const addTemplateDay = async (templateId: string) => {
    if (!selectedQuote) return;
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    setBusy(true);
    try {
      const quoteId = selectedQuote.id;
      const previousDays = days;
      const previousComponents = components;
      const { data, error } = await db.rpc("add_fit_template_day_to_quote", {
        _quote_id: quoteId,
        _partner_template_id: template.id,
      });
      if (error) throw error;
      const result = data as any;
      if (import.meta.env.DEV) {
        console.debug("[AgencyFitQuotes] add_fit_template_day_to_quote result", {
          result,
          quote_day_id: result?.quote_day_id,
          selected_quote_id: quoteId,
          filters: { table: "fit_quote_days", quote_id: quoteId, order: "day_number/sort_order" },
        });
      }
      if (!result?.ok || !result?.quote_day_id) {
        throw new Error("La journée n’a pas été ajoutée correctement.");
      }

      if (result.quote) applyRpcQuoteState(result.quote, result.pricing);
      const rpcDays = Array.isArray(result.all_days) ? result.all_days : [];
      const rpcComponents = Array.isArray(result.all_components) ? result.all_components : [];
      const createdDay = result.created_day;
      const createdComponents = Array.isArray(result.created_components) ? result.created_components : [];
      const expectedMinimumDays = previousDays.some((day) => String(day.id) === String(result.quote_day_id))
        ? previousDays.length
        : previousDays.length + 1;
      const rpcMergedDays = sortQuoteDays(mergeById(previousDays, rpcDays, createdDay ? [createdDay] : []));
      const rpcMergedComponents = mergeById(previousComponents, rpcComponents, createdComponents);

      if (rpcMergedDays.length >= expectedMinimumDays) {
        setDays(rpcMergedDays);
        setComponents(rpcMergedComponents);
        if (result.pricing) {
          setPricing((current: any) => ({ ...(current ?? {}), quote_id: quoteId, organization_id: selectedQuote.partner_organization_id ?? null, ...result.pricing }));
        }
      }

      const refreshed = await refreshSelectedQuote(quoteId);
      if (import.meta.env.DEV) {
        console.debug("[AgencyFitQuotes] quote days reload after add", {
          quote_id: quoteId,
          reloaded_days_count: refreshed.days.length,
          reloaded_day_ids: refreshed.days.map((day: any) => day.id),
          components_count: refreshed.components.length,
          pricing: refreshed.pricing,
        });
      }
      const reloadHasCreatedDay = refreshed.days.some((day: any) => String(day.id) === String(result.quote_day_id));
      const reloadLooksComplete = refreshed.days.length >= expectedMinimumDays && reloadHasCreatedDay;
      if (!reloadLooksComplete) {
        if (!createdDay && rpcMergedDays.length < expectedMinimumDays) {
          throw new Error("La journée a été créée mais n’apparaît pas après rechargement. Vérifiez les filtres ou les droits d’accès.");
        }
        setDays(rpcMergedDays);
        setComponents(rpcMergedComponents);
        if (result.pricing) {
          setPricing((current: any) => ({ ...(current ?? {}), quote_id: quoteId, organization_id: selectedQuote.partner_organization_id ?? null, ...result.pricing }));
        }
        if (import.meta.env.DEV) {
          console.warn("[AgencyFitQuotes] reload returned an incomplete day list; using merged RPC payload", {
            quote_id: quoteId,
            quote_day_id: result.quote_day_id,
            previous_days: previousDays.length,
            rpc_days: rpcDays.length,
            reloaded_days: refreshed.days.length,
            created_components: createdComponents.length,
          });
        }
      }

      toast.success(result.message || "Journée ajoutée.");
    } catch (error: any) {
      toast.error(error?.message || "Impossible d’ajouter cette journée.");
    } finally {
      setBusy(false);
    }
  };

  const removeDay = async (day: any) => {
    if (!selectedQuote) return;
    if (!confirm(`Supprimer "${day.title}" du devis ?`)) return;
    setBusy(true);
    const { error } = await db.from("fit_quote_days").delete().eq("id", day.id);
    if (error) {
      setBusy(false);
      return toast.error(error.message);
    }
    const nextDays = days.filter((item) => item.id !== day.id);
    const nextComponents = components.filter((component) => component.quote_day_id !== day.id);
    setDays(nextDays);
    setComponents(nextComponents);
    await persistPricing(selectedQuote, nextDays, nextComponents, pricing);
    await logAction(selectedQuote.id, "partner_day_removed", { day_id: day.id, title: day.title });
    await refreshSelectedQuote(selectedQuote.id);
    setBusy(false);
    toast.success("Journée supprimée.");
  };

  useEffect(() => {
    if (!selectedQuote || loading || selectedQuote.is_current_version === false) return;
    const timer = window.setTimeout(() => {
      void persistPricing().catch(() => setAutosaveStatus("error"));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [days.length, components.map((component) => `${component.id}:${component.enabled}`).join("|")]);

  const updateMargin = async (patch: Record<string, any>) => {
    if (!selectedQuote || !pricing || !canAdjustMargin) return;
    const previousPricing = pricing;
    const nextPricing = { ...pricing, ...patch };
    setPricing(nextPricing);
    try {
      const { data, error } = await db.rpc("update_fit_partner_quote_header", {
        _quote_id: selectedQuote.id,
        _payload: {
          partner_margin_type: nextPricing.partner_margin_type || effectiveSettings.default_margin_type || "percent",
          partner_margin_value: numberValue(nextPricing.partner_margin_value ?? effectiveSettings.default_margin_value ?? 0),
          manual_adjustment_mad: numberValue(nextPricing.manual_adjustment_mad),
        },
      });
      if (error) throw error;
      const result = data as any;
      if (!result?.ok || !result?.quote) throw new Error("La marge n’a pas été mise à jour correctement.");
      applyRpcQuoteState(result.quote, result.pricing);
    } catch (error: any) {
      setPricing(previousPricing);
      toast.error(error?.message || "Impossible de modifier la marge.");
    }
  };

  const openEditQuote = () => {
    if (!selectedQuote) return;
    setEditForm(quoteToEditForm(selectedQuote, pricing));
    setEditOpen(true);
  };

  const saveQuoteHeader = async () => {
    if (!selectedQuote) return;
    setBusy(true);
    try {
      const payload = cleanPayload({
        client_name: editForm.client_name?.trim(),
        travelers_count: Math.max(1, numberValue(editForm.travelers_count)),
        travel_start_date: editForm.travel_start_date || null,
        travel_end_date: editForm.travel_end_date || null,
        valid_until: editForm.valid_until || null,
        hotel_category: editForm.hotel_category || null,
        room_type: editForm.room_type || null,
        exclusions: editForm.exclusions ?? "",
        client_notes: editForm.client_notes || null,
        payment_conditions: editForm.payment_conditions || null,
        booking_conditions: editForm.booking_conditions || null,
        cancellation_conditions: editForm.cancellation_conditions || null,
        partner_margin_type: canAdjustMargin ? editForm.partner_margin_type : pricing?.partner_margin_type,
        partner_margin_value: canAdjustMargin ? numberValue(editForm.partner_margin_value) : pricing?.partner_margin_value,
        manual_adjustment_mad: effectiveSettings.allow_manual_adjustment ? numberValue(editForm.manual_adjustment_mad) : pricing?.manual_adjustment_mad,
      });
      const { data, error } = await db.rpc("update_fit_partner_quote_header", {
        _quote_id: selectedQuote.id,
        _payload: payload,
      });
      if (error) throw error;
      const result = data as any;
      if (!result?.ok || !result?.quote) {
        throw new Error("Le devis n’a pas été mis à jour correctement.");
      }
      applyRpcQuoteState(result.quote, result.pricing);
      try {
        await refreshSelectedQuote(selectedQuote.id);
      } catch (refreshError) {
        if (import.meta.env.DEV) {
          console.warn("[AgencyFitQuotes] quote updated but refresh failed", refreshError);
        }
      }
      setEditOpen(false);
      toast.success(result.message || "Devis mis à jour.");
    } catch (error: any) {
      toast.error(error?.message || "Impossible de modifier ce devis.");
    } finally {
      setBusy(false);
    }
  };

  const toggleComponent = async (component: any, enabled: boolean) => {
    if (component.is_required || !component.can_partner_disable) {
      toast.error("Cette composante est obligatoire et ne peut pas être désactivée.");
      return;
    }
    const before = components;
    const next = components.map((item) => item.id === component.id ? { ...item, enabled } : item);
    setComponents(next);
    const { error } = await db.from("fit_quote_day_components").update({ enabled }).eq("id", component.id);
    if (error) {
      setComponents(before);
      return toast.error(error.message);
    }
    await persistPricing(selectedQuote, days, next, pricing);
    await logAction(selectedQuote.id, enabled ? "partner_component_enabled" : "partner_component_disabled", { component_id: component.id, title: component.title });
  };

  const enableShare = async () => {
    if (!selectedQuote) return;
    const latest = await persistPricing();
    const approvalRequired = latest?.result.approvalRequired || selectedQuote.requires_lejapon_approval;
    if (approvalRequired) {
      toast.error("Ce devis doit être validé par LeJapon.ma avant partage client.");
      return;
    }
    const token = selectedQuote.share_token || partnerShareToken();
    const sentAt = new Date().toISOString();
    const linkPatch = { share_token: token, share_enabled: true, public_client_visible: true, public_link_revoked_at: null, production_status: "sent_to_client" };
    const { error } = await db.from("fit_quotes").update(linkPatch).eq("id", selectedQuote.id);
    if (error) return toast.error(error.message);
    const { error: statusError } = await db.rpc("set_fit_commercial_status_v3", { p_quote_id: selectedQuote.id, p_status: "sent", p_reason: null, p_override: false });
    if (statusError) {
      await db.from("fit_quotes").update({ share_enabled: false }).eq("id", selectedQuote.id);
      return toast.error(statusError.message);
    }
    const patch = { ...linkPatch, status: "sent", commercial_status: "sent", sent_at: sentAt };
    const updated = { ...selectedQuote, ...patch };
    setSelectedQuote(updated);
    setQuotes((current) => current.map((quote) => quote.id === updated.id ? updated : quote));
    await logAction(selectedQuote.id, "partner_quote_shared", { token });
    toast.success("Lien client activé.");
  };

  const copyShare = async () => {
    if (!shareUrl) return toast.error("Générez d’abord le lien client.");
    await navigator.clipboard.writeText(shareUrl);
    toast.success("Lien client copié.");
  };

  const downloadPdf = async () => {
    if (!selectedQuote) return;
    const latest = await persistPricing();
    const quote = latest?.quote || selectedQuote;
    const pdfDays = days.map((day) => ({
      ...day,
      ...clientListsFromComponents(day, components),
      selling_price_mad: calculateDayNet(day, components),
    }));
    const branding = {
      logoUrl: partnerProfile?.logo_url || organization?.metadata?.agency_logo_url,
      agencyName: partnerProfile?.commercial_name || partnerProfile?.name || organization?.display_name,
      contactEmail: partnerProfile?.contact_email || organization?.email,
      contactPhone: partnerProfile?.whatsapp || partnerProfile?.contact_phone || organization?.phone,
      website: partnerProfile?.website || organization?.website,
      footerText: partnerProfile?.footer_text,
      brandingMode: quote.partner_branding_mode || partnerProfile?.branding_mode,
      primaryColor: partnerProfile?.primary_color,
    };
    const bytes = await generateFitClientPdf({ quote, days: pdfDays, hotelLines: [], flightLines: [], branding });
    downloadFitPdf(bytes, `${quote.quote_number || (isSalesMode ? "devis-fit-commercial" : "devis-fit-partenaire")}-client.pdf`);
    await logAction(selectedQuote.id, "partner_pdf_generated");
  };

  const previewPdf = async () => {
    if (!selectedQuote) return;
    const latest = await persistPricing();
    const quote = latest?.quote || selectedQuote;
    const pdfDays = days.map((day) => ({ ...day, ...clientListsFromComponents(day, components), selling_price_mad: calculateDayNet(day, components) }));
    const bytes = await generateFitClientPdf({
      quote,
      days: pdfDays,
      hotelLines: [],
      flightLines: [],
      branding: {
        logoUrl: partnerProfile?.logo_url || organization?.metadata?.agency_logo_url,
        agencyName: partnerProfile?.commercial_name || partnerProfile?.name || organization?.display_name,
        contactEmail: partnerProfile?.contact_email || organization?.email,
        contactPhone: partnerProfile?.whatsapp || partnerProfile?.contact_phone || organization?.phone,
        website: partnerProfile?.website || organization?.website,
        footerText: partnerProfile?.footer_text,
        brandingMode: quote.partner_branding_mode || partnerProfile?.branding_mode,
        primaryColor: partnerProfile?.primary_color,
      },
    });
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const updatePaymentStep = async (status: "partner_payment_pending" | "partner_payment_received") => {
    if (!selectedQuote || !paymentAllowed(selectedQuote)) return;
    const patch = status === "partner_payment_pending"
      ? {
          status,
          production_status: status,
          payment_status: "requested",
          partner_payment_requested_at: new Date().toISOString(),
        }
      : {
          status,
          production_status: status,
          payment_status: "deposit_received",
          partner_payment_received_at: new Date().toISOString(),
        };
    const { error } = await db.from("fit_quotes").update(patch).eq("id", selectedQuote.id);
    if (error) return toast.error(error.message);
    const updated = { ...selectedQuote, ...patch };
    setSelectedQuote(updated);
    setQuotes((current) => current.map((quote) => quote.id === updated.id ? updated : quote));
    await logAction(selectedQuote.id, status, {});
    toast.success(status === "partner_payment_pending" ? "Paiement demandé." : "Paiement marqué comme reçu.");
  };

  const selectedDayComponents = (dayId: string) => components.filter((component) => component.quote_day_id === dayId);

  return (
    <div className="min-w-0 space-y-6 overflow-x-hidden pb-24 md:pb-0">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display text-3xl">{isSalesMode ? "Devis FIT commercial" : "Devis FIT partenaire"}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Créez vos devis FIT à partir de programmes validés par LeJapon.ma. Sélectionnez les journées, ajustez les prestations disponibles, ajoutez votre marge commerciale, puis partagez un lien ou un PDF avec votre client.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4" /> Nouveau devis FIT</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{isSalesMode ? "Nouveau devis FIT commercial" : "Nouveau devis FIT partenaire"}</DialogTitle></DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Client"><Input value={form.client_name} onChange={(event) => setForm({ ...form, client_name: event.target.value })} /></Field>
              <Field label="Voyageurs"><Input type="number" min={1} value={form.travelers_count} onChange={(event) => setForm({ ...form, travelers_count: +event.target.value })} /></Field>
              <Field label="Début"><Input type="date" value={form.travel_start_date} onChange={(event) => setForm({ ...form, travel_start_date: event.target.value })} /></Field>
              <Field label="Fin"><Input type="date" value={form.travel_end_date} onChange={(event) => setForm({ ...form, travel_end_date: event.target.value })} /></Field>
              <Field label="Validité"><Input type="date" value={form.valid_until} onChange={(event) => setForm({ ...form, valid_until: event.target.value })} /></Field>
              <Field label="Hôtels"><Input value={form.hotel_category} onChange={(event) => setForm({ ...form, hotel_category: event.target.value })} /></Field>
              <Field label="Chambres"><Input value={form.room_type} onChange={(event) => setForm({ ...form, room_type: event.target.value })} /></Field>
              <Field label="Non inclus"><Textarea rows={3} value={form.exclusions} onChange={(event) => setForm({ ...form, exclusions: event.target.value })} /></Field>
            </div>
            <DialogFooter><Button onClick={createQuote} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Créer</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

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
              Une V{numberValue(versionTarget?.version_number || 1) + 1} liée à <strong className="text-foreground">{versionTarget?.quote_family_reference || versionTarget?.quote_number}</strong> sera créée. La version actuelle restera accessible en lecture seule.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md border border-border bg-secondary/50 p-3 text-sm text-muted-foreground">Les validations, paiements, liens client et documents générés sont réinitialisés.</div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={versioning}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => void createNewVersion()} disabled={versioning}>
              {versioning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <History className="mr-2 h-4 w-4" />} Créer la version
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <Card className="overflow-hidden">
          <div className="border-b border-border p-4">
            <h2 className="font-display text-xl">Mes devis</h2>
            <p className="text-xs text-muted-foreground">{isSalesMode ? "LeJapon.ma" : organization?.display_name}</p>
          </div>
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Chargement…</div>
          ) : currentQuotes.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">{isSalesMode ? "Aucun devis FIT commercial." : "Aucun devis FIT partenaire."}</div>
          ) : (
            <div className="divide-y divide-border">
              {currentQuotes.map((quote) => (
                <div key={quote.id} className={selectedQuote?.id === quote.id ? "bg-secondary" : ""}>
                  <button onClick={() => loadQuote(quote)} className="block w-full cursor-pointer p-4 text-left transition-colors hover:bg-secondary/50">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{quote.client_name}</p>
                        <p className="text-xs text-muted-foreground">{quote.quote_family_reference || quote.quote_number} · V{quote.version_number || 1} · {fmtDateTime(quote.updated_at)}</p>
                      </div>
                      <Badge variant={quote.requires_lejapon_approval ? "destructive" : "outline"}>{statusLabels[quote.status] || quote.status}</Badge>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-accent">{fmtMAD(quote.total_selling_price_mad)}</p>
                    {quote.duplicated_from_id && <p className="mt-1 text-xs text-accent">Copie de {quotes.find((item) => item.id === quote.duplicated_from_id)?.quote_number || "un devis FIT"}</p>}
                  </button>
                  <div className="border-t border-border px-3 py-1.5">
                    <Button type="button" size="sm" variant="ghost" className="w-full justify-start" onClick={() => confirmDuplicate(quote)}><CopyPlus className="h-4 w-4" /> Dupliquer</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {!selectedQuote ? (
          <Card className="flex min-h-[420px] items-center justify-center p-8 text-center">
            <div>
              <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
              <h2 className="mt-3 font-display text-2xl">Sélectionnez ou créez un devis</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">Créez un nouveau devis, puis composez le programme depuis votre bibliothèque {isSalesMode ? "commerciale" : "partenaire"}.</p>
            </div>
          </Card>
        ) : (
          <div className="space-y-6">
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <DialogContent className="max-w-3xl">
                <DialogHeader><DialogTitle>Modifier le devis</DialogTitle></DialogHeader>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Client">
                    <Input value={editForm.client_name} onChange={(event) => setEditForm({ ...editForm, client_name: event.target.value })} />
                  </Field>
                  <Field label="Voyageurs">
                    <Input type="number" min={1} value={editForm.travelers_count} onChange={(event) => setEditForm({ ...editForm, travelers_count: +event.target.value })} />
                  </Field>
                  <Field label="Début">
                    <Input type="date" value={editForm.travel_start_date} onChange={(event) => setEditForm({ ...editForm, travel_start_date: event.target.value })} />
                  </Field>
                  <Field label="Fin">
                    <Input type="date" value={editForm.travel_end_date} onChange={(event) => setEditForm({ ...editForm, travel_end_date: event.target.value })} />
                  </Field>
                  <Field label="Validité">
                    <Input type="date" value={editForm.valid_until} onChange={(event) => setEditForm({ ...editForm, valid_until: event.target.value })} />
                  </Field>
                  <Field label="Hôtels">
                    <Input value={editForm.hotel_category} onChange={(event) => setEditForm({ ...editForm, hotel_category: event.target.value })} />
                  </Field>
                  <Field label="Chambres">
                    <Input value={editForm.room_type} onChange={(event) => setEditForm({ ...editForm, room_type: event.target.value })} />
                  </Field>
                  <Field label="Type marge">
                    <Select value={editForm.partner_margin_type} onValueChange={(value) => setEditForm({ ...editForm, partner_margin_type: value })} disabled={!canAdjustMargin}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percent">Pourcentage global</SelectItem>
                        <SelectItem value="fixed">Montant fixe</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label={editForm.partner_margin_type === "fixed" ? "Marge fixe MAD" : "Marge %"}>
                    <Input type="number" value={editForm.partner_margin_value} disabled={!canAdjustMargin} onChange={(event) => setEditForm({ ...editForm, partner_margin_value: +event.target.value })} />
                  </Field>
                  <Field label="Ajustement manuel">
                    <Input type="number" value={editForm.manual_adjustment_mad} disabled={!effectiveSettings.allow_manual_adjustment} onChange={(event) => setEditForm({ ...editForm, manual_adjustment_mad: +event.target.value })} />
                  </Field>
                  <Field label="Non inclus">
                    <Textarea rows={4} value={editForm.exclusions} onChange={(event) => setEditForm({ ...editForm, exclusions: event.target.value })} />
                  </Field>
                  <Field label="Notes client">
                    <Textarea rows={4} value={editForm.client_notes} onChange={(event) => setEditForm({ ...editForm, client_notes: event.target.value })} />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Conditions de paiement">
                      <Textarea rows={3} value={editForm.payment_conditions} onChange={(event) => setEditForm({ ...editForm, payment_conditions: event.target.value })} />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label="Conditions de réservation">
                      <Textarea rows={3} value={editForm.booking_conditions} onChange={(event) => setEditForm({ ...editForm, booking_conditions: event.target.value })} />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label="Conditions d’annulation">
                      <Textarea rows={5} value={editForm.cancellation_conditions} onChange={(event) => setEditForm({ ...editForm, cancellation_conditions: event.target.value })} />
                    </Field>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setEditOpen(false)} disabled={busy}>Annuler</Button>
                  <Button onClick={saveQuoteHeader} disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />} Enregistrer
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Card className="p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-2xl">{selectedQuote.client_name}</h2>
                    <Badge variant={selectedQuote.requires_lejapon_approval ? "destructive" : "secondary"}>{statusLabels[selectedQuote.status] || selectedQuote.status}</Badge>
                    <Select value={String(selectedQuote.version_number || 1)} onValueChange={(value) => { const version = quoteVersions.find((item) => String(item.version_number || 1) === value); if (version) void loadQuote(version); }}>
                      <SelectTrigger className="h-9 w-auto min-w-20" aria-label="Choisir une version"><SelectValue /></SelectTrigger>
                      <SelectContent>{quoteVersions.map((version) => <SelectItem key={version.id} value={String(version.version_number || 1)}>V{version.version_number || 1} — {statusLabels[version.status] || version.status}{version.is_current_version ? " — actuelle" : ""}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{selectedQuote.quote_family_reference || selectedQuote.quote_number} · {selectedQuote.travelers_count} voyageur(s)</p>
                  {isHistoricalVersion && <p className="mt-1 text-sm font-semibold text-amber-700">Version historique en lecture seule</p>}
                  {!isHistoricalVersion && autosaveStatus !== "idle" && <p className={`mt-1 text-xs ${autosaveStatus === "error" ? "text-destructive" : "text-muted-foreground"}`}>{autosaveStatus === "saving" ? "Enregistrement…" : autosaveStatus === "saved" ? "Modifications enregistrées" : "Erreur d’enregistrement"}</p>}
                  {selectedQuote.duplicated_from_id && <p className="mt-1 text-sm font-semibold text-accent">Copie de {selectedQuote.duplicated_from_reference || quotes.find((item) => item.id === selectedQuote.duplicated_from_id)?.quote_number || "un devis FIT"}</p>}
                  {quotes.some((item) => item.duplicated_from_id === selectedQuote.id) && <p className="mt-1 text-xs text-muted-foreground">Dupliqué en {quotes.filter((item) => item.duplicated_from_id === selectedQuote.id).map((item) => item.quote_number).join(", ")}</p>}
                  {selectedQuote.approval_reason && <p className="mt-2 text-sm font-medium text-destructive">{selectedQuote.approval_reason}</p>}
                </div>
                <div className="hidden flex-wrap justify-end gap-2 md:flex">
                  <Button onClick={openEditQuote} disabled={busy || isHistoricalVersion}><Pencil className="h-4 w-4" /> Sauver</Button>
                  <Button variant="secondary" onClick={enableShare} disabled={busy || isHistoricalVersion}><Send className="h-4 w-4" /> Envoyer au client</Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="outline"><MoreHorizontal className="h-4 w-4" /> Actions</Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                      <DropdownMenuLabel>Devis client</DropdownMenuLabel>
                      {shareUrl && <DropdownMenuItem asChild><a href={shareUrl} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" /> Ouvrir comme client</a></DropdownMenuItem>}
                      <DropdownMenuItem onClick={copyShare} disabled={!shareUrl}><Copy className="mr-2 h-4 w-4" /> Copier lien client</DropdownMenuItem>
                      <DropdownMenuItem onClick={previewPdf}><FileText className="mr-2 h-4 w-4" /> Aperçu PDF</DropdownMenuItem>
                      <DropdownMenuItem onClick={downloadPdf}><Download className="mr-2 h-4 w-4" /> Télécharger PDF client</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => confirmDuplicate(selectedQuote, true)}><CopyPlus className="mr-2 h-4 w-4" /> Dupliquer et modifier</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setVersionTarget(selectedQuote)} disabled={isHistoricalVersion}><History className="mr-2 h-4 w-4" /> Créer nouvelle version</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={archiveQuote} disabled={busy || isHistoricalVersion}>Archiver</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => deleteQuote()} disabled={busy || isHistoricalVersion}><Trash2 className="mr-2 h-4 w-4" /> Supprimer</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              {commission && (
                <div className="mt-4 grid gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-4 sm:grid-cols-3">
                  <div><p className="text-xs font-medium uppercase tracking-wide text-emerald-800">Votre commission</p><p className="mt-1 text-2xl font-semibold text-emerald-950">{fmtMAD(commission.sales_agent_commission_amount_mad || 0)}</p><p className="text-sm text-emerald-800">{commission.sales_agent_commission_status === "paid" ? "Payée" : ["deposit_paid", "converted_to_booking"].includes(selectedQuote.commercial_status) ? "Acquise" : commission.sales_agent_commission_status === "confirmed" ? "Confirmée" : "Estimée"}</p></div>
                  {commission.gross_agency_commission_amount_mad != null && <><div><p className="text-xs text-muted-foreground">Commission brute agence</p><p className="mt-1 font-semibold">{fmtMAD(commission.gross_agency_commission_amount_mad)}</p></div><div><p className="text-xs text-muted-foreground">Commission nette agence</p><p className="mt-1 font-semibold">{fmtMAD(commission.agency_net_commission_amount_mad)}</p></div></>}
                </div>
              )}
              <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t border-border bg-background/95 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] shadow-lg backdrop-blur md:hidden">
                <Button className="min-h-11 flex-1" onClick={openEditQuote} disabled={busy || isHistoricalVersion}><Pencil className="h-4 w-4" /> Sauver</Button>
                <Button className="min-h-11 flex-1" variant="secondary" onClick={enableShare} disabled={busy || isHistoricalVersion}><Send className="h-4 w-4" /> Envoyer</Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button className="min-h-11" variant="outline"><MoreHorizontal className="h-5 w-5" /> Plus</Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="top" className="w-64">
                    {shareUrl && <DropdownMenuItem asChild><a href={shareUrl} target="_blank" rel="noreferrer">Ouvrir comme client</a></DropdownMenuItem>}
                    <DropdownMenuItem onClick={copyShare} disabled={!shareUrl}>Copier lien client</DropdownMenuItem>
                    <DropdownMenuItem onClick={previewPdf}>Aperçu PDF</DropdownMenuItem>
                    <DropdownMenuItem onClick={downloadPdf}>Télécharger PDF client</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => confirmDuplicate(selectedQuote, true)}>Dupliquer et modifier</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setVersionTarget(selectedQuote)} disabled={isHistoricalVersion}>Créer nouvelle version</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={archiveQuote} disabled={isHistoricalVersion}>Archiver</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onClick={() => deleteQuote()} disabled={isHistoricalVersion}>Supprimer</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {shareUrl && (
                <div className="mt-4 rounded-md border border-border bg-secondary/50 p-3 text-sm">
                  <span className="font-semibold">Lien client privé : </span>
                  <Link to={`/devis-fit/${selectedQuote.share_token}`} className="break-all text-accent underline">{shareUrl}</Link>
                </div>
              )}
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label={netLabel} value={fmtMAD(computed.netPartnerTotal)} />
                <Metric label={marginLabel} value={fmtMAD(computed.partnerMarginTotal)} />
                <Metric label="Prix client final" value={fmtMAD(computed.clientSaleTotal)} />
                <Metric label="Prix/personne client" value={fmtMAD(computed.clientSalePerPerson)} />
              </div>
              <div className={`mt-4 rounded-md border p-4 ${paymentAllowed(selectedQuote) ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">État de production</p>
                    <h3 className="mt-1 font-semibold">{productionMessages[productionKey(selectedQuote)]?.title || statusLabels[selectedQuote.status] || selectedQuote.status}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {productionMessages[productionKey(selectedQuote)]?.body || "Le statut de production sera mis à jour par LeJapon.ma."}
                    </p>
                    {selectedQuote.production_public_note && <p className="mt-2 text-sm font-medium">{selectedQuote.production_public_note}</p>}
                    {!paymentAllowed(selectedQuote) && (
                      <p className="mt-2 text-sm font-semibold text-amber-800">
                        Paiement non autorisé pour le moment. LeJapon.ma vérifie les disponibilités et vous notifiera dès validation.
                      </p>
                    )}
                    {paymentAllowed(selectedQuote) && (
                      <p className="mt-2 text-sm font-semibold text-emerald-800">
                        Vous pouvez maintenant encaisser le client selon les conditions indiquées.
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button variant="outline" disabled={!paymentAllowed(selectedQuote)} onClick={() => updatePaymentStep("partner_payment_pending")}>
                      <CreditCard className="h-4 w-4" /> Paiement demandé
                    </Button>
                    <Button disabled={!paymentAllowed(selectedQuote)} onClick={() => updatePaymentStep("partner_payment_received")}>
                      <ShieldCheck className="h-4 w-4" /> Acompte reçu
                    </Button>
                  </div>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Field label="Type marge">
                  <Select value={pricing?.partner_margin_type || "percent"} onValueChange={(value) => updateMargin({ partner_margin_type: value })} disabled={!canAdjustMargin}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percent">Pourcentage global</SelectItem>
                      <SelectItem value="fixed">Montant fixe</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={pricing?.partner_margin_type === "fixed" ? "Marge fixe MAD" : "Marge %"}>
                  <Input type="number" value={pricing?.partner_margin_value ?? 0} disabled={!canAdjustMargin} onChange={(event) => updateMargin({ partner_margin_value: +event.target.value })} />
                </Field>
                <Field label="Ajustement manuel">
                  <Input type="number" value={pricing?.manual_adjustment_mad ?? 0} disabled={!effectiveSettings.allow_manual_adjustment} onChange={(event) => updateMargin({ manual_adjustment_mad: +event.target.value })} />
                </Field>
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <h3 className="font-display text-xl">Journées du programme</h3>
                  <p className="text-sm text-muted-foreground">Choisissez les journées publiées dans votre bibliothèque {isSalesMode ? "commerciale" : "partenaire"}. Vous pouvez activer ou désactiver uniquement les prestations autorisées.</p>
                </div>
                <Select onValueChange={addTemplateDay} disabled={busy || templates.length === 0}>
                  <SelectTrigger className="w-full md:w-80">
                    <SelectValue placeholder={busy ? "Ajout en cours..." : templates.length === 0 ? "Aucune journée publiée disponible" : "Ajouter une journée"} />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.city || "Japon"} · {template.title} · {fmtMAD(template.partner_net_price_mad)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {templates.length === 0 && (
                <div className="mt-4 rounded-md border border-dashed border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
                  Aucune journée publiée n’est disponible {isSalesMode ? "pour les commerciaux" : "pour votre agence"}. Contactez LeJapon.ma pour activer votre bibliothèque de programmes.
                </div>
              )}

              <div className="mt-5 space-y-4">
                {days.map((day, index) => {
                  const dayComponents = selectedDayComponents(day.id);
                  const dayNet = calculateDayNet(day, components);
                  return (
                    <div key={day.id} className="rounded-lg border border-border bg-background p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">Jour {index + 1}</Badge>
                            <Badge variant="secondary">{day.city || "Japon"}</Badge>
                            <Badge variant="outline">{day.day_pace || day.rhythm || "moderate"}</Badge>
                          </div>
                          <h4 className="mt-2 text-lg font-semibold">{day.title}</h4>
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{day.sales_summary || day.description_client}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Metric label={dayNetLabel} value={fmtMAD(dayNet)} />
                          <Button variant="ghost" size="icon" onClick={() => removeDay(day)} aria-label="Supprimer la journée"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </div>
                      </div>
                      {Array.isArray(day.image_urls) && day.image_urls[0] && (
                        <img src={day.image_urls[0]} alt={day.title} className="mt-4 h-44 w-full rounded-md object-cover" />
                      )}
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        {dayComponents.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Aucune composante activable publiée pour cette journée.</p>
                        ) : dayComponents.map((component) => (
                          <div key={component.id} className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline">{componentLabels[component.component_type] || component.component_type}</Badge>
                                {component.is_required && <Badge><ShieldCheck className="mr-1 h-3 w-3" /> Obligatoire</Badge>}
                              </div>
                              <p className="mt-2 font-medium">{component.title}</p>
                              {component.description_client && <p className="mt-1 text-xs text-muted-foreground">{component.description_client}</p>}
                            </div>
                            <Switch
                              checked={component.enabled !== false}
                              disabled={component.is_required || !component.can_partner_disable}
                              onCheckedChange={(checked) => toggleComponent(component, checked === true)}
                              aria-label={`Activer ${component.title}`}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {days.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                    Ajoutez une journée publiée depuis la bibliothèque {isSalesMode ? "commerciale" : "partenaire"}.
                  </div>
                )}
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-start gap-3">
                <ListChecks className="mt-1 h-5 w-5 text-accent" />
                <div>
                  <h3 className="font-display text-xl">Comment créer un devis FIT</h3>
                  <ol className="mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
                    <li>1. Créez un nouveau devis.</li>
                    <li>2. Ajoutez des journées depuis la bibliothèque {isSalesMode ? "commerciale" : "partenaire"}.</li>
                    <li>3. Activez ou désactivez les prestations disponibles.</li>
                    <li>4. Définissez votre marge commerciale.</li>
                    <li>5. Vérifiez le prix final client.</li>
                    <li>6. Générez le lien ou le PDF à partager.</li>
                  </ol>
                  <p className="mt-3 text-sm text-muted-foreground">
                    Le client verra votre logo, vos coordonnées, le programme, les prestations incluses, les conditions et le prix final.
                  </p>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
