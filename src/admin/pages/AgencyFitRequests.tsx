import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Download, ExternalLink, Loader2, MessageSquare, Save } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/admin/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate, fmtDateTime, fmtMAD } from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";
import { calculateDualCommissionSnapshot } from "@/agency/commissionEngine";

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

const statuses = Object.keys(statusLabels);

const requestColumns = `
  *,
  organizations:organization_id(id,display_name,legal_name,email)
`;

const isSchemaMissingError = (message = "") =>
  /agency_fit_requests|agency_fit_request_messages|agency_fit_request_files|schema cache|could not find the table|relation .* does not exist/i.test(message);

const getAdminFitErrorMessage = (error: any) => {
  const message = String(error?.message ?? error ?? "");
  if (isSchemaMissingError(message)) {
    return `Schéma FIT incomplet dans Lovable/Supabase: ${message}`;
  }
  return message || "Erreur demandes FIT.";
};

const getCommissionAmounts = (request: any) => {
  const gross = Number(request.gross_agency_commission_amount_mad || 0);
  const agent = Number(request.sales_agent_commission_amount_mad || 0);
  const net = request.agency_net_commission_amount_mad != null ? Number(request.agency_net_commission_amount_mad || 0) : Math.max(gross - agent, 0);
  return { gross, agent, net };
};

export default function AdminAgencyFitRequests() {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [messages, setMessages] = useState<Record<string, any[]>>({});
  const [files, setFiles] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [agencyFilter, setAgencyFilter] = useState("all");
  const [destinationFilter, setDestinationFilter] = useState("all");
  const [drafts, setDrafts] = useState<Record<string, any>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await db
      .from("agency_fit_requests")
      .select(requestColumns)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(getAdminFitErrorMessage(error));
      setRows([]);
      setLoading(false);
      return;
    }
    const nextRows = data ?? [];
    setRows(nextRows);
    const ids = nextRows.map((row: any) => row.id);
    if (ids.length) {
      const [{ data: messageRows }, { data: fileRows }] = await Promise.all([
        db.from("agency_fit_request_messages").select("*").in("request_id", ids).order("created_at", { ascending: true }),
        db.from("agency_fit_request_files").select("*").in("request_id", ids).order("created_at", { ascending: false }),
      ]);
      setMessages(groupByRequest(messageRows ?? []));
      setFiles(groupByRequest(fileRows ?? []));
      const nextDrafts: Record<string, any> = {};
      nextRows.forEach((row: any) => {
        nextDrafts[row.id] = {
          status: row.status,
          assigned_to: row.assigned_to ?? "",
          quote_link: row.quote_link ?? "",
          fit_quote_id: row.fit_quote_id ?? "",
          base_price_per_person: row.base_price_per_person ?? "",
          base_total_price: row.base_total_price ?? "",
          eligible_sale_amount_mad: row.eligible_sale_amount_mad ?? row.final_client_price ?? row.base_total_price ?? "",
          gross_agency_commission_type: row.gross_agency_commission_type ?? "percentage",
          gross_agency_commission_value: row.gross_agency_commission_value ?? "",
          sales_agent_commission_type: row.sales_agent_commission_type ?? "fixed_amount",
          sales_agent_commission_value: row.sales_agent_commission_value ?? "",
          agency_visible_message: row.agency_visible_message ?? "",
          admin_internal_notes: row.admin_internal_notes ?? "",
          message: "",
        };
      });
      setDrafts(nextDrafts);
    } else {
      setMessages({});
      setFiles({});
      setDrafts({});
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const agencies = useMemo(() => Array.from(new Map(rows.map((row) => [row.organization_id, row.organizations?.display_name || row.organizations?.legal_name || row.organization_id])).entries()), [rows]);
  const destinations = useMemo(() => Array.from(new Set(rows.map((row) => row.destination_country).filter(Boolean))).sort(), [rows]);
  const visibleRows = rows.filter((row) =>
    (statusFilter === "all" || row.status === statusFilter) &&
    (agencyFilter === "all" || row.organization_id === agencyFilter) &&
    (destinationFilter === "all" || row.destination_country === destinationFilter)
  );

  const updateDraft = (id: string, key: string, value: unknown) =>
    setDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? {}), [key]: value } }));

  const saveRequest = async (request: any) => {
    const draft = drafts[request.id] ?? {};
    setBusyId(request.id);
    const quoteReady = draft.quote_link && draft.quote_link !== request.quote_link;
    const eligibleSaleAmount = Number(draft.eligible_sale_amount_mad || draft.base_total_price || request.final_client_price || request.base_total_price || 0);
    const assignedSalesAgentId = draft.assigned_to || request.assigned_sales_agent_id || request.assigned_to || null;
    const hasGrossCommission = draft.gross_agency_commission_value !== "" && draft.gross_agency_commission_value != null;
    const commission = hasGrossCommission
      ? calculateDualCommissionSnapshot({
        eligibleSaleAmountMad: eligibleSaleAmount,
        grossType: draft.gross_agency_commission_type,
        grossValue: Number(draft.gross_agency_commission_value || 0),
        salesAgentId: assignedSalesAgentId,
        salesAgentType: draft.sales_agent_commission_type,
        salesAgentValue: Number(draft.sales_agent_commission_value || 0),
        ruleSource: "admin_fit_request",
      })
      : null;
    const patch = {
      status: draft.status,
      assigned_to: draft.assigned_to || null,
      assigned_sales_agent_id: assignedSalesAgentId,
      sales_agent_id: assignedSalesAgentId,
      quote_link: draft.quote_link || null,
      fit_quote_id: draft.fit_quote_id || null,
      base_price_per_person: draft.base_price_per_person === "" ? null : Number(draft.base_price_per_person),
      base_total_price: draft.base_total_price === "" ? null : Number(draft.base_total_price),
      eligible_sale_amount_mad: eligibleSaleAmount || null,
      gross_agency_commission_type: commission?.gross_agency_commission_type ?? null,
      gross_agency_commission_value: commission?.gross_agency_commission_value ?? null,
      gross_agency_commission_amount_mad: commission?.gross_agency_commission_amount_mad ?? null,
      sales_agent_commission_type: commission?.sales_agent_commission_type ?? null,
      sales_agent_commission_value: commission?.sales_agent_commission_value ?? null,
      sales_agent_commission_amount_mad: commission?.sales_agent_commission_amount_mad ?? null,
      agency_net_commission_amount_mad: commission?.agency_net_commission_amount_mad ?? null,
      commission_snapshot: commission ?? {},
      commission_calculated_at: commission ? new Date().toISOString() : null,
      commission_rule_source: commission?.rule_source ?? null,
      agency_visible_message: draft.agency_visible_message || null,
      admin_internal_notes: draft.admin_internal_notes || null,
      quoted_at: quoteReady ? new Date().toISOString() : request.quoted_at,
    };
    const { error } = await db.from("agency_fit_requests").update(patch).eq("id", request.id);
    if (error) {
      toast.error(getAdminFitErrorMessage(error));
      setBusyId(null);
      return;
    }
    if (draft.message?.trim()) await addAdminMessage(request, draft.message, "agency", false);
    if (quoteReady) {
      await addAdminMessage(request, "Le devis FIT est prêt. Vous pouvez ajouter votre marge agence et partager le lien final avec votre client.", "agency", true);
      await supabase.functions.invoke("send-admin-notification", {
        body: { type: "agency_fit_quote_ready", payload: { request_id: request.id } },
      }).catch(() => undefined);
    }
    toast.success("Demande mise à jour.");
    setBusyId(null);
    void load();
  };

  const addAdminMessage = async (request: any, message: string, visibility: "agency" | "admin_internal", silentToast = false) => {
    if (!message.trim()) return;
    const { error } = await db.from("agency_fit_request_messages").insert({
      request_id: request.id,
      organization_id: request.organization_id,
      sender_id: user?.id ?? null,
      sender_type: "admin",
      visibility,
      message: message.trim(),
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!silentToast) toast.success("Message ajouté.");
  };

  const downloadFile = async (file: any) => {
    const { data, error } = await supabase.storage.from("agency-fit-requests").createSignedUrl(file.file_path, 120);
    if (error || !data) return toast.error(error?.message ?? "Lien fichier indisponible.");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Demandes FIT agences" description="Réception, qualification et retour des devis FIT vers les agences partenaires." />

      <Card className="grid gap-3 p-4 md:grid-cols-3">
        <Filter label="Statut" value={statusFilter} onChange={setStatusFilter} options={[["all", "Tous les statuts"], ...statuses.map((status) => [status, statusLabels[status]])]} />
        <Filter label="Agence" value={agencyFilter} onChange={setAgencyFilter} options={[["all", "Toutes les agences"], ...agencies]} />
        <Filter label="Destination" value={destinationFilter} onChange={setDestinationFilter} options={[["all", "Toutes destinations"], ...destinations.map((item) => [item, item])]} />
      </Card>

      {loading ? (
        <Card className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Chargement…</Card>
      ) : visibleRows.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">Aucune demande FIT.</Card>
      ) : (
        <div className="grid gap-5">
          {visibleRows.map((request) => {
            const draft = drafts[request.id] ?? {};
            const commission = getCommissionAmounts(request);
            return (
              <Card key={request.id} className="p-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-2xl">{request.client_full_name}</h2>
                      <Badge variant="outline">{statusLabels[request.status] ?? request.status}</Badge>
                      <Badge variant="secondary">{request.organizations?.display_name || request.organizations?.legal_name || "Agence"}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Créée le {fmtDateTime(request.created_at)} · {request.destination_country} · {request.duration_days || "—"} jours
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Voyageurs: {request.adults} adulte(s), {request.children} enfant(s), {request.babies} bébé(s)
                    </p>
                  </div>
                  {request.quote_link && (
                    <Button asChild variant="outline">
                      <a href={request.quote_link} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Devis publié</a>
                    </Button>
                  )}
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
                  <div className="space-y-4">
                    <InfoBlock title="Client" rows={[
                      ["Téléphone", request.client_phone],
                      ["Email", request.client_email],
                      ["Résidence", request.residence_country],
                      ["Budget", request.budget_per_person ? `${Number(request.budget_per_person).toLocaleString("fr-FR")} ${request.currency}` : "—"],
                    ]} />
                    <InfoBlock title="Voyage" rows={[
                      ["Dates", `${fmtDate(request.desired_departure_date)} → ${fmtDate(request.desired_return_date)}`],
                      ["Flexibilité", request.flexibility],
                      ["Villes", (request.cities ?? []).join(", ")],
                      ["Styles", (request.travel_styles ?? []).join(", ")],
                    ]} />
                    <InfoBlock title="Prestations" rows={[
                      ["Hôtels", `${request.hotel_category || "—"} · ${request.hotel_location_preference || "—"}`],
                      ["Chambres", (request.room_needs ?? []).join(", ")],
                      ["Vols", `${request.include_international_flights || "—"} · ${request.departure_airport || "—"}`],
                      ["Guide", `${request.guide_language || "—"} · ${request.guide_coverage || "—"}`],
                      ["Transport", request.transport_preference],
                      ["Extras", (request.optional_extras ?? []).join(", ")],
                    ]} />
                    {(request.must_have_activities || request.special_requests || request.internal_agency_note) && (
                      <Card className="space-y-3 p-4 text-sm">
                        {request.must_have_activities && <TextLine label="Activités indispensables" value={request.must_have_activities} />}
                        {request.special_requests && <TextLine label="Description" value={request.special_requests} />}
                        {request.internal_agency_note && <TextLine label="Note interne agence" value={request.internal_agency_note} />}
                      </Card>
                    )}
                  </div>

                  <div className="space-y-4">
                    <Card className="space-y-3 p-4">
                      <Field label="Statut">
                        <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={draft.status ?? request.status} onChange={(e) => updateDraft(request.id, "status", e.target.value)}>
                          {statuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
                        </select>
                      </Field>
                      <Field label="Assigné à">
                        <Input value={draft.assigned_to ?? ""} onChange={(e) => updateDraft(request.id, "assigned_to", e.target.value)} placeholder="UUID sales user" />
                      </Field>
                      <Field label="FIT quote ID">
                        <Input value={draft.fit_quote_id ?? ""} onChange={(e) => updateDraft(request.id, "fit_quote_id", e.target.value)} placeholder="UUID du devis FIT interne" />
                      </Field>
                      <Field label="Lien devis publié">
                        <Input value={draft.quote_link ?? ""} onChange={(e) => updateDraft(request.id, "quote_link", e.target.value)} placeholder="https://www.lejapon.ma/devis-fit/..." />
                      </Field>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Prix base / personne"><Input type="number" value={draft.base_price_per_person ?? ""} onChange={(e) => updateDraft(request.id, "base_price_per_person", e.target.value)} /></Field>
                        <Field label="Prix base total"><Input type="number" value={draft.base_total_price ?? ""} onChange={(e) => updateDraft(request.id, "base_total_price", e.target.value)} /></Field>
                      </div>
                      <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                        <p className="mb-3 text-sm font-semibold text-amber-950">Commission agence et commercial</p>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label="Montant éligible"><Input type="number" value={draft.eligible_sale_amount_mad ?? ""} onChange={(e) => updateDraft(request.id, "eligible_sale_amount_mad", e.target.value)} /></Field>
                          <Field label="Commission agence">
                            <div className="grid grid-cols-[1fr_120px] gap-2">
                              <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={draft.gross_agency_commission_type ?? "percentage"} onChange={(e) => updateDraft(request.id, "gross_agency_commission_type", e.target.value)}>
                                <option value="percentage">Pourcentage</option>
                                <option value="fixed_amount">Montant fixe</option>
                              </select>
                              <Input type="number" value={draft.gross_agency_commission_value ?? ""} onChange={(e) => updateDraft(request.id, "gross_agency_commission_value", e.target.value)} />
                            </div>
                          </Field>
                          <Field label="Commission commercial">
                            <div className="grid grid-cols-[1fr_120px] gap-2">
                              <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={draft.sales_agent_commission_type ?? "fixed_amount"} onChange={(e) => updateDraft(request.id, "sales_agent_commission_type", e.target.value)}>
                                <option value="fixed_amount">Montant fixe</option>
                                <option value="percentage">Pourcentage</option>
                              </select>
                              <Input type="number" value={draft.sales_agent_commission_value ?? ""} onChange={(e) => updateDraft(request.id, "sales_agent_commission_value", e.target.value)} />
                            </div>
                          </Field>
                          <div className="rounded-md bg-white/70 p-3 text-sm sm:col-span-2">
                            <p>Brute agence: <strong>{fmtMAD(commission.gross)}</strong></p>
                            <p>Commercial: <strong>{fmtMAD(commission.agent)}</strong></p>
                            <p>Nette agence: <strong>{fmtMAD(commission.net)}</strong></p>
                          </div>
                        </div>
                      </div>
                      {request.final_client_price && <p className="text-sm text-muted-foreground">Prix client final agence: <strong>{fmtMAD(request.final_client_price)}</strong></p>}
                      <Field label="Message visible agence">
                        <Textarea rows={3} value={draft.agency_visible_message ?? ""} onChange={(e) => updateDraft(request.id, "agency_visible_message", e.target.value)} />
                      </Field>
                      <Field label="Notes internes">
                        <Textarea rows={3} value={draft.admin_internal_notes ?? ""} onChange={(e) => updateDraft(request.id, "admin_internal_notes", e.target.value)} />
                      </Field>
                      <Button className="w-full" onClick={() => saveRequest(request)} disabled={busyId === request.id}>
                        {busyId === request.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Enregistrer
                      </Button>
                    </Card>

                    <Card className="space-y-3 p-4">
                      <p className="font-semibold">Messages</p>
                      {(messages[request.id] ?? []).map((message) => (
                        <div key={message.id} className="rounded-md border border-border p-3 text-sm">
                          <p className="font-medium">{message.sender_type === "admin" ? "Interne" : "Agence"} · {message.visibility}</p>
                          <p className="mt-1 text-muted-foreground">{message.message}</p>
                        </div>
                      ))}
                      <Textarea rows={3} value={draft.message ?? ""} onChange={(e) => updateDraft(request.id, "message", e.target.value)} placeholder="Message visible à l’agence…" />
                      <Button variant="outline" onClick={() => addAdminMessage(request, draft.message ?? "", "agency")}>
                        <MessageSquare className="h-4 w-4" />
                        Envoyer message
                      </Button>
                    </Card>

                    <Card className="space-y-2 p-4">
                      <p className="font-semibold">Fichiers</p>
                      {(files[request.id] ?? []).length === 0 && <p className="text-sm text-muted-foreground">Aucun fichier joint.</p>}
                      {(files[request.id] ?? []).map((file) => (
                        <div key={file.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                          <span className="truncate">{file.file_name}</span>
                          <Button size="sm" variant="outline" onClick={() => downloadFile(file)}><Download className="h-3.5 w-3.5" /></Button>
                        </div>
                      ))}
                    </Card>
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

const groupByRequest = (rows: any[]) => rows.reduce((acc, row) => {
  acc[row.request_id] = [...(acc[row.request_id] ?? []), row];
  return acc;
}, {} as Record<string, any[]>);

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>;
}

function InfoBlock({ title, rows }: { title: string; rows: Array<[string, unknown]> }) {
  return (
    <Card className="p-4">
      <p className="font-semibold">{title}</p>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-0.5 break-words font-medium">{String(value || "—")}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TextLine({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 whitespace-pre-wrap">{value}</p></div>;
}
