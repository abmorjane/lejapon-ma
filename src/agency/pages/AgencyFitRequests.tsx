import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Calculator, FileText, Loader2, MessageSquare, Plus, Send, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FitInput as Input, FitTextarea as Textarea } from "@/components/fit/FitFormControls";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { fmtDate, fmtMAD } from "@/lib/format";
import { calculateDualCommissionSnapshot } from "../commissionEngine";
import { useAgencyContext } from "../useAgencyContext";

type DbClient = { from: (table: string) => any };
const db = supabase as unknown as DbClient;

const statusLabels: Record<string, string> = {
  draft: "Brouillon",
  submitted: "Soumise",
  under_review: "En analyse",
  information_required: "Infos manquantes",
  quote_in_progress: "Devis en préparation",
  quoted: "Devis reçu",
  revision_requested: "Révision demandée",
  converted_to_booking: "Convertie en réservation",
  cancelled: "Annulée",
  new: "Nouveau",
  in_progress: "En cours",
  missing_info: "Infos manquantes",
  quote_preparing: "Devis en préparation",
  quote_sent_to_agency: "Devis envoyé à l’agence",
  accepted: "Accepté",
  declined: "Refusé",
  archived: "Archivé",
};

const cityOptions = ["Tokyo", "Kyoto", "Osaka", "Hiroshima", "Nara", "Hakone", "Kamakura", "Other"];
const styleOptions = ["classique", "premium", "luxe", "famille", "honeymoon", "business", "senior", "halal-friendly", "gluten-free / dietary needs", "anime/pop culture", "culture/traditions", "nature"];
const roomOptions = ["single", "double/twin", "triple", "family rooms", "connecting rooms"];
const extraOptions = ["Universal Studios Japan", "Disney", "TeamLab", "Tea ceremony", "Maiko dinner", "Kimono", "Anime/gaming", "Food tour", "Sumo", "Onsen", "Shopping"];

const emptyForm = {
  client_full_name: "",
  client_phone: "",
  client_email: "",
  adults: 2,
  children: 0,
  babies: 0,
  residence_country: "",
  desired_departure_date: "",
  desired_return_date: "",
  flexibility: "dates fixed",
  destination_country: "Japan",
  cities: [] as string[],
  duration_days: 10,
  travel_styles: [] as string[],
  hotel_category: "4*",
  room_needs: [] as string[],
  hotel_location_preference: "central",
  include_international_flights: "optional",
  departure_airport: "",
  preferred_airline: "",
  baggage_needs: "",
  guide_language: "French",
  guide_coverage: "main visits only",
  transport_preference: "mixed",
  must_have_activities: "",
  optional_extras: [] as string[],
  budget_per_person: "",
  currency: "MAD",
  budget_flexibility: "flexible",
  special_requests: "",
  internal_agency_note: "",
};

const toggle = (values: string[], value: string) =>
  values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

const finalPrice = (row: any) => {
  const base = Number(row.base_total_price || 0);
  const margin = Number(row.agency_margin_value || 0);
  if (!base) return 0;
  return row.agency_margin_type === "percentage" ? Math.round(base * (1 + margin / 100)) : base + margin;
};

const isSchemaMissingError = (message = "") =>
  /agency_fit_requests|agency_fit_request_messages|agency_fit_request_files|schema cache|could not find the table|relation .* does not exist/i.test(message);

const getAgencyFitErrorMessage = (error: any) => {
  const message = String(error?.message ?? error ?? "");
  if (isSchemaMissingError(message)) {
    return "Le module demandes FIT n'est pas encore activé pour votre espace. Merci de contacter l'équipe LeJapon.ma.";
  }
  return message || "Impossible de charger les demandes FIT.";
};

const agencyWideCommissionRoles = new Set(["owner", "admin", "manager", "accountant", "finance"]);

const getCommissionFromRequest = (request: any) => {
  if (request.gross_agency_commission_amount_mad != null) {
    return {
      gross: Number(request.gross_agency_commission_amount_mad || 0),
      agent: Number(request.sales_agent_commission_amount_mad || 0),
      net: Number(request.agency_net_commission_amount_mad || 0),
    };
  }

  const saleAmount = Number(request.final_client_price || request.base_total_price || 0);
  if (!saleAmount || request.gross_agency_commission_value == null) return null;
  const snapshot = calculateDualCommissionSnapshot({
    eligibleSaleAmountMad: saleAmount,
    grossType: request.gross_agency_commission_type,
    grossValue: request.gross_agency_commission_value,
    salesAgentId: request.sales_agent_id || request.assigned_sales_agent_id || request.assigned_to,
    salesAgentType: request.sales_agent_commission_type,
    salesAgentValue: request.sales_agent_commission_value,
    ruleSource: request.commission_rule_source,
  });
  return {
    gross: snapshot.gross_agency_commission_amount_mad,
    agent: snapshot.sales_agent_commission_amount_mad,
    net: snapshot.agency_net_commission_amount_mad,
  };
};

export default function AgencyFitRequests() {
  const { user } = useAuth();
  const { organization, currentMembership } = useAgencyContext();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [messages, setMessages] = useState<Record<string, any[]>>({});
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [replyByRequest, setReplyByRequest] = useState<Record<string, string>>({});

  const load = async () => {
    if (!organization) return;
    setLoading(true);
    const { data, error } = await db
      .from("agency_fit_requests")
      .select("*")
      .eq("organization_id", organization.id)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(getAgencyFitErrorMessage(error));
      setRows([]);
    } else {
      const nextRows = data ?? [];
      setRows(nextRows);
      if (nextRows.length) {
        const { data: messageRows } = await db
          .from("agency_fit_request_messages")
          .select("*")
          .in("request_id", nextRows.map((row: any) => row.id))
          .eq("visibility", "agency")
          .order("created_at", { ascending: true });
        const grouped: Record<string, any[]> = {};
        (messageRows ?? []).forEach((message: any) => {
          grouped[message.request_id] = [...(grouped[message.request_id] ?? []), message];
        });
        setMessages(grouped);
      } else {
        setMessages({});
      }
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, [organization?.id]);

  const stats = useMemo(() => ({
    total: rows.length,
    active: rows.filter((row) => !["accepted", "declined", "archived"].includes(row.status)).length,
    ready: rows.filter((row) => row.quote_link).length,
  }), [rows]);

  const update = (key: keyof typeof emptyForm, value: any) => setForm((current) => ({ ...current, [key]: value }));

  const uploadFiles = async (requestId: string) => {
    if (!organization || !user || files.length === 0) return;
    for (const file of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, "-");
      const filePath = `${organization.id}/${requestId}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("agency-fit-requests")
        .upload(filePath, file, { contentType: file.type || "application/octet-stream" });
      if (uploadError) {
        toast.error(`Fichier non uploadé: ${file.name}`);
        continue;
      }
      await db.from("agency_fit_request_files").insert({
        request_id: requestId,
        organization_id: organization.id,
        uploaded_by: user.id,
        file_name: file.name,
        file_path: filePath,
        mime_type: file.type || null,
        file_size: file.size,
      });
    }
  };

  const submit = async (status: "draft" | "submitted" = "submitted") => {
    if (!organization || !user) return;
    if (!form.client_full_name.trim()) return toast.error("Le nom du client est obligatoire.");
    const travelerCount = Number(form.adults || 0) + Number(form.children || 0);
    const budgetPerPerson = form.budget_per_person ? Number(form.budget_per_person) : null;
    setSaving(true);
    const payload = {
      ...form,
      organization_id: organization.id,
      requested_by: user.id,
      created_by: user.id,
      assigned_sales_agent_id: user.id,
      sales_agent_id: user.id,
      status,
      client_name: form.client_full_name,
      destination: form.destination_country,
      travel_start_date: form.desired_departure_date || null,
      travel_end_date: form.desired_return_date || null,
      adult_count: Number(form.adults || 0),
      child_count: Number(form.children || 0),
      infant_count: Number(form.babies || 0),
      adults: Number(form.adults || 0),
      children: Number(form.children || 0),
      babies: Number(form.babies || 0),
      duration_days: Number(form.duration_days || 0) || null,
      budget_per_person: budgetPerPerson,
      budget_mad: budgetPerPerson ? budgetPerPerson * Math.max(travelerCount, 1) : null,
      departure_city: form.departure_airport || null,
      room_preferences: {
        hotel_category: form.hotel_category,
        room_needs: form.room_needs,
        hotel_location_preference: form.hotel_location_preference,
      },
      requested_services: {
        cities: form.cities,
        travel_styles: form.travel_styles,
        optional_extras: form.optional_extras,
        guide_language: form.guide_language,
        guide_coverage: form.guide_coverage,
        transport_preference: form.transport_preference,
        include_international_flights: form.include_international_flights,
      },
      request_details: form.special_requests || null,
      internal_notes: form.internal_agency_note || null,
    };
    const { data, error } = await db.from("agency_fit_requests").insert(payload).select("id").single();
    if (error || !data) {
      toast.error(getAgencyFitErrorMessage(error));
      setSaving(false);
      return;
    }
    await uploadFiles(data.id);
    await supabase.functions.invoke("send-admin-notification", {
      body: { type: "agency_fit_request", payload: { request_id: data.id } },
    }).catch(() => undefined);
    toast.success(status === "draft" ? "Brouillon FIT enregistré." : "Demande FIT envoyée à l’équipe LeJapon.ma.");
    setForm(emptyForm);
    setFiles([]);
    setShowForm(false);
    setSaving(false);
    void load();
  };

  const addMessage = async (request: any) => {
    const message = (replyByRequest[request.id] ?? "").trim();
    if (!message || !organization || !user) return;
    const { error } = await db.from("agency_fit_request_messages").insert({
      request_id: request.id,
      organization_id: organization.id,
      sender_id: user.id,
      sender_type: "agency",
      visibility: "agency",
      message,
    });
    if (error) return toast.error(error.message);
    setReplyByRequest((current) => ({ ...current, [request.id]: "" }));
    toast.success("Message envoyé.");
    void load();
  };

  const saveMargin = async (request: any, patch: Record<string, unknown>) => {
    const next = { ...request, ...patch };
    const nextFinal = finalPrice(next);
    const { error } = await db
      .from("agency_fit_requests")
      .update({ ...patch, final_client_price: nextFinal || null })
      .eq("id", request.id);
    if (error) return toast.error(error.message);
    void load();
  };

  return (
    <div className="min-w-0 space-y-6 overflow-x-hidden">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display text-3xl">Demandes FIT sur mesure</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Envoyez votre brief client. L’équipe LeJapon.ma prépare le devis FIT interne puis vous renvoie un lien partageable.
          </p>
        </div>
        <Button onClick={() => setShowForm((current) => !current)}>
          <Plus className="h-4 w-4" />
          Nouvelle demande sur mesure
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="p-4"><p className="text-sm text-muted-foreground">Total demandes</p><p className="mt-1 text-2xl font-semibold">{stats.total}</p></Card>
        <Card className="p-4"><p className="text-sm text-muted-foreground">En cours</p><p className="mt-1 text-2xl font-semibold">{stats.active}</p></Card>
        <Card className="p-4"><p className="text-sm text-muted-foreground">Devis prêts</p><p className="mt-1 text-2xl font-semibold">{stats.ready}</p></Card>
      </div>

      {showForm && (
        <Card className="p-5">
          <div className="mb-5 flex items-center gap-2">
            <FileText className="h-5 w-5 text-accent" />
            <h2 className="font-display text-xl">Demander un devis FIT</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Nom complet client"><Input value={form.client_full_name} onChange={(e) => update("client_full_name", e.target.value)} /></Field>
            <Field label="Téléphone"><Input value={form.client_phone} onChange={(e) => update("client_phone", e.target.value)} /></Field>
            <Field label="Email"><Input type="email" value={form.client_email} onChange={(e) => update("client_email", e.target.value)} /></Field>
            <Field label="Adultes"><Input type="number" min={0} value={form.adults} onChange={(e) => update("adults", Number(e.target.value))} /></Field>
            <Field label="Enfants"><Input type="number" min={0} value={form.children} onChange={(e) => update("children", Number(e.target.value))} /></Field>
            <Field label="Bébés"><Input type="number" min={0} value={form.babies} onChange={(e) => update("babies", Number(e.target.value))} /></Field>
            <Field label="Nationalité / résidence"><Input value={form.residence_country} onChange={(e) => update("residence_country", e.target.value)} /></Field>
            <Field label="Départ souhaité"><Input type="date" value={form.desired_departure_date} onChange={(e) => update("desired_departure_date", e.target.value)} /></Field>
            <Field label="Retour souhaité"><Input type="date" value={form.desired_return_date} onChange={(e) => update("desired_return_date", e.target.value)} /></Field>
            <Field label="Flexibilité">
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.flexibility} onChange={(e) => update("flexibility", e.target.value)}>
                <option>dates fixed</option><option>flexible ±3 days</option><option>flexible ±7 days</option><option>not fixed yet</option>
              </select>
            </Field>
            <Field label="Destination"><Input value={form.destination_country} onChange={(e) => update("destination_country", e.target.value)} /></Field>
            <Field label="Durée voyage"><Input type="number" min={1} value={form.duration_days} onChange={(e) => update("duration_days", Number(e.target.value))} /></Field>
          </div>

          <OptionGroup title="Villes à visiter" options={cityOptions} values={form.cities} onToggle={(value) => update("cities", toggle(form.cities, value))} />
          <OptionGroup title="Style de voyage" options={styleOptions} values={form.travel_styles} onToggle={(value) => update("travel_styles", toggle(form.travel_styles, value))} />

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <Field label="Catégorie hôtel">
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.hotel_category} onChange={(e) => update("hotel_category", e.target.value)}>
                {["3*", "4*", "5*", "Ryokan", "Apartment", "mixed"].map((item) => <option key={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="Préférence localisation hôtel">
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.hotel_location_preference} onChange={(e) => update("hotel_location_preference", e.target.value)}>
                {["central", "near station", "premium area", "budget-friendly"].map((item) => <option key={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="Vols internationaux">
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.include_international_flights} onChange={(e) => update("include_international_flights", e.target.value)}>
                {["yes", "no", "optional"].map((item) => <option key={item}>{item}</option>)}
              </select>
            </Field>
          </div>
          <OptionGroup title="Besoin chambres" options={roomOptions} values={form.room_needs} onToggle={(value) => update("room_needs", toggle(form.room_needs, value))} />

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <Field label="Aéroport départ"><Input value={form.departure_airport} onChange={(e) => update("departure_airport", e.target.value)} /></Field>
            <Field label="Compagnie préférée"><Input value={form.preferred_airline} onChange={(e) => update("preferred_airline", e.target.value)} /></Field>
            <Field label="Bagages"><Input value={form.baggage_needs} onChange={(e) => update("baggage_needs", e.target.value)} /></Field>
            <Field label="Langue guide">
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.guide_language} onChange={(e) => update("guide_language", e.target.value)}>
                {["French", "English", "Japanese only", "no guide"].map((item) => <option key={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="Couverture guide">
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.guide_coverage} onChange={(e) => update("guide_coverage", e.target.value)}>
                {["full trip", "main visits only", "arrival assistance only"].map((item) => <option key={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="Transport">
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.transport_preference} onChange={(e) => update("transport_preference", e.target.value)}>
                {["private bus", "private car", "train/JR", "mixed", "lowest cost"].map((item) => <option key={item}>{item}</option>)}
              </select>
            </Field>
          </div>

          <OptionGroup title="Extras souhaités" options={extraOptions} values={form.optional_extras} onToggle={(value) => update("optional_extras", toggle(form.optional_extras, value))} />
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <Field label="Budget approx. / personne"><Input type="number" min={0} value={form.budget_per_person} onChange={(e) => update("budget_per_person", e.target.value)} /></Field>
            <Field label="Devise"><Input value={form.currency} onChange={(e) => update("currency", e.target.value)} /></Field>
            <Field label="Flexibilité budget">
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.budget_flexibility} onChange={(e) => update("budget_flexibility", e.target.value)}>
                {["strict", "flexible", "premium if justified"].map((item) => <option key={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="Activités indispensables" className="md:col-span-3"><Textarea rows={3} value={form.must_have_activities} onChange={(e) => update("must_have_activities", e.target.value)} /></Field>
            <Field label="Description détaillée" className="md:col-span-2"><Textarea rows={4} value={form.special_requests} onChange={(e) => update("special_requests", e.target.value)} /></Field>
            <Field label="Note interne agence"><Textarea rows={4} value={form.internal_agency_note} onChange={(e) => update("internal_agency_note", e.target.value)} /></Field>
          </div>
          <div className="mt-5 rounded-lg border border-dashed border-border p-4">
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
            <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> Joindre brief / passeports</Button>
            {files.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{files.length} fichier(s) sélectionné(s).</p>}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowForm(false)}>Annuler</Button>
            <Button variant="outline" onClick={() => submit("draft")} disabled={saving}>Enregistrer brouillon</Button>
            <Button onClick={() => submit("submitted")} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Envoyer la demande</Button>
          </div>
        </Card>
      )}

      {loading ? (
        <Card className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Chargement…</Card>
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">Aucune demande FIT pour le moment.</Card>
      ) : (
        <div className="grid gap-4">
          {rows.map((request) => {
            const commission = getCommissionFromRequest(request);
            const canSeeAgencyCommission = agencyWideCommissionRoles.has(currentMembership?.role ?? "");
            const isOwnSalesRequest = user?.id && [request.sales_agent_id, request.assigned_sales_agent_id, request.assigned_to, request.created_by, request.requested_by].includes(user.id);
            return (
            <Card key={request.id} className="p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-xl">{request.client_full_name}</h2>
                    <Badge variant="outline">{statusLabels[request.status] ?? request.status}</Badge>
                    {request.quote_link && <Badge className="bg-emerald-600">Devis prêt</Badge>}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {request.destination_country} · {request.duration_days || "—"} jours · {fmtDate(request.desired_departure_date)} → {fmtDate(request.desired_return_date)}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Voyageurs: {Number(request.adults || 0)} adulte(s), {Number(request.children || 0)} enfant(s), {Number(request.babies || 0)} bébé(s)
                  </p>
                </div>
                {request.quote_link && (
                  <Button asChild>
                    <a href={request.quote_link} target="_blank" rel="noreferrer">Ouvrir le devis</a>
                  </Button>
                )}
              </div>

              {request.agency_visible_message && (
                <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">{request.agency_visible_message}</div>
              )}

              {request.quote_link && (
                <div className="mt-4 grid gap-3 rounded-lg border border-border bg-secondary/35 p-4 md:grid-cols-5">
                  <Field label="Prix base LeJapon.ma"><Input value={request.base_total_price ? fmtMAD(request.base_total_price) : "À confirmer"} readOnly /></Field>
                  <Field label="Type marge">
                    <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={request.agency_margin_type} onChange={(e) => saveMargin(request, { agency_margin_type: e.target.value })}>
                      <option value="fixed">Montant fixe</option>
                      <option value="percentage">Pourcentage</option>
                    </select>
                  </Field>
                  <Field label="Marge agence"><Input type="number" value={request.agency_margin_value ?? 0} onChange={(e) => saveMargin(request, { agency_margin_value: Number(e.target.value) })} /></Field>
                  <Field label="Prix client final"><Input value={finalPrice(request) ? fmtMAD(finalPrice(request)) : "—"} readOnly /></Field>
                  <div className="flex items-end">
                    <Button className="w-full" asChild>
                      <a href={request.quote_link} target="_blank" rel="noreferrer"><Calculator className="h-4 w-4" /> Partager</a>
                    </Button>
                  </div>
                </div>
              )}

              {commission && (canSeeAgencyCommission || isOwnSalesRequest) && (
                <div className="mt-4 grid gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 md:grid-cols-3">
                  {canSeeAgencyCommission ? (
                    <>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-amber-700">Commission agence brute</p>
                        <p className="mt-1 text-lg font-semibold">{fmtMAD(commission.gross)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-amber-700">Commission commercial</p>
                        <p className="mt-1 text-lg font-semibold">{fmtMAD(commission.agent)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-amber-700">Commission nette agence</p>
                        <p className="mt-1 text-lg font-semibold">{fmtMAD(commission.net)}</p>
                      </div>
                    </>
                  ) : (
                    <div className="md:col-span-3">
                      <p className="text-xs uppercase tracking-wide text-amber-700">Votre commission estimée</p>
                      <p className="mt-1 text-lg font-semibold">{fmtMAD(commission.agent)}</p>
                      <p className="mt-1 text-xs text-amber-800">Si cette vente est confirmée, vous gagnerez {fmtMAD(commission.agent)}.</p>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4 grid gap-3">
                {(messages[request.id] ?? []).map((message) => (
                  <div key={message.id} className="rounded-md border border-border bg-background p-3 text-sm">
                    <p className="font-medium">{message.sender_type === "admin" ? "LeJapon.ma" : "Agence"}</p>
                    <p className="mt-1 text-muted-foreground">{message.message}</p>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input placeholder="Ajouter une précision à l'équipe…" value={replyByRequest[request.id] ?? ""} onChange={(e) => setReplyByRequest((current) => ({ ...current, [request.id]: e.target.value }))} />
                  <Button variant="outline" onClick={() => addMessage(request)}><MessageSquare className="h-4 w-4" /> Envoyer</Button>
                </div>
              </div>
            </Card>
          );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return <div className={`space-y-2 ${className}`}><Label>{label}</Label>{children}</div>;
}

function OptionGroup({ title, options, values, onToggle }: { title: string; options: string[]; values: string[]; onToggle: (value: string) => void }) {
  return (
    <div className="mt-5">
      <p className="text-sm font-medium">{title}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option} className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm transition-colors hover:bg-secondary">
            <Checkbox checked={values.includes(option)} onCheckedChange={() => onToggle(option)} />
            {option}
          </label>
        ))}
      </div>
    </div>
  );
}
