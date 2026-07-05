import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Download, Eye, FileSignature, Plus, RefreshCw, Save, Search, Send, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/admin/components/PageHeader";
import { PdfPreviewDialog } from "@/admin/components/PdfPreviewDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { fmtDateTime } from "@/lib/format";
import { trackEvent } from "@/lib/analytics";
import {
  DEFAULT_INCLUDED_SERVICES_TEXT,
  DEFAULT_STANDARD_AGREEMENT_SECTIONS,
  TRAVEL_AGREEMENT_VERSION,
  buildAgreementContent,
  downloadTravelAgreementPdf,
  generateTravelAgreementPdf,
  loadAgreementSource,
  type TravelAgreement,
  type TravelAgreementAcceptance,
  type TravelAgreementStatus,
  type TravelAgreementTemplateSection,
} from "@/lib/travel-agreements";

type DbClient = { from: (table: string) => any };
const db = supabase as unknown as DbClient;

const STATUS_LABELS: Record<TravelAgreementStatus, string> = {
  draft: "Brouillon",
  sent: "Envoyé",
  opened: "Ouvert",
  accepted: "Accepté",
  declined: "Refusé",
  needs_review: "À revoir",
};

const STATUS_CLASS: Record<TravelAgreementStatus, string> = {
  draft: "border-slate-200 bg-slate-50 text-slate-700",
  sent: "border-blue-200 bg-blue-50 text-blue-700",
  opened: "border-amber-200 bg-amber-50 text-amber-800",
  accepted: "border-emerald-200 bg-emerald-50 text-emerald-700",
  declined: "border-red-200 bg-red-50 text-red-700",
  needs_review: "border-orange-200 bg-orange-50 text-orange-700",
};

const statusBadge = (status: TravelAgreementStatus) => (
  <Badge variant="outline" className={STATUS_CLASS[status]}>{STATUS_LABELS[status]}</Badge>
);

const filenameFor = (agreement: TravelAgreement) =>
  `accord-voyage-${agreement.booking_reference || agreement.id.slice(0, 8)}.pdf`;

const bookingLabel = (booking: any) =>
  [booking.reference, booking.contact_name, booking.contact_email, booking.trips?.title]
    .filter(Boolean)
    .join(" — ");

const mergeStandardSections = (sections?: TravelAgreementTemplateSection[]) => {
  const byKey = new Map((sections ?? []).map((section) => [section.key, section]));
  return DEFAULT_STANDARD_AGREEMENT_SECTIONS.map((defaultSection) => ({
    ...defaultSection,
    ...(byKey.get(defaultSection.key) ?? {}),
  }));
};

const includedServicesFromTemplate = (sections: TravelAgreementTemplateSection[]) =>
  sections.find((section) => section.key === "included_services")?.body || DEFAULT_INCLUDED_SERVICES_TEXT;

export default function TravelAgreements() {
  const [agreements, setAgreements] = useState<TravelAgreement[]>([]);
  const [acceptances, setAcceptances] = useState<Record<string, TravelAgreementAcceptance | null>>({});
  const [bookings, setBookings] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [bookingSearch, setBookingSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [previewAgreement, setPreviewAgreement] = useState<TravelAgreement | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [templateTitle, setTemplateTitle] = useState("Texte standard accord de voyage");
  const [standardSections, setStandardSections] = useState<TravelAgreementTemplateSection[]>(DEFAULT_STANDARD_AGREEMENT_SECTIONS);
  const [sourcePreview, setSourcePreview] = useState<any | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [draft, setDraft] = useState({
    bookingId: "",
    includedServices: "",
    luggageTransferPolicy: "",
    specificCancellationConditions: "",
    complementaryNote: "",
  });

  const loadTemplate = useCallback(async () => {
    const { data, error } = await db
      .from("travel_agreement_templates")
      .select("*")
      .eq("language", "fr")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn("[travel-agreements] template fallback", error.message);
      return;
    }
    if (data?.content?.sections?.length) {
      setTemplateId(data.id);
      setTemplateTitle(data.title || "Texte standard accord de voyage");
      setStandardSections(mergeStandardSections(data.content.sections));
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: agreementRows, error }, { data: bookingRows }] = await Promise.all([
        db.from("travel_agreements").select("*").order("created_at", { ascending: false }).limit(100),
        supabase
          .from("bookings")
          .select("id,reference,contact_name,contact_email,contact_phone,client_id,trip_id,num_adults,num_children,total_amount_mad,paid_amount_mad,created_at,trips(title,start_date,end_date)")
          .order("created_at", { ascending: false })
          .limit(220),
      ]);
      if (error) throw error;
      const rows = (agreementRows ?? []) as TravelAgreement[];
      setAgreements(rows);
      setBookings(bookingRows ?? []);

      const ids = rows.map((row) => row.id);
      if (ids.length) {
        const { data: acceptanceRows } = await db
          .from("travel_agreement_acceptances")
          .select("*")
          .in("agreement_id", ids)
          .order("accepted_at", { ascending: false });
        const map: Record<string, TravelAgreementAcceptance | null> = {};
        (acceptanceRows ?? []).forEach((acceptance: TravelAgreementAcceptance) => {
          if (acceptance.agreement_id && !map[acceptance.agreement_id]) map[acceptance.agreement_id] = acceptance;
        });
        setAcceptances(map);
      } else {
        setAcceptances({});
      }
    } catch (error: any) {
      toast.error(error?.message ?? "Impossible de charger les accords.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadTemplate();
  }, [load, loadTemplate]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!draft.bookingId) {
        setSourcePreview(null);
        return;
      }
      setSourceLoading(true);
      try {
        const source = await loadAgreementSource({ bookingId: draft.bookingId });
        if (!cancelled) setSourcePreview(source);
      } catch (error: any) {
        if (!cancelled) toast.error(error?.message ?? "Impossible de charger la réservation.");
      } finally {
        if (!cancelled) setSourceLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [draft.bookingId]);

  const filteredAgreements = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return agreements;
    return agreements.filter((agreement) =>
      [
        agreement.client_name,
        agreement.client_email,
        agreement.booking_reference,
        agreement.trip_title,
        STATUS_LABELS[agreement.status],
      ].some((value) => String(value ?? "").toLowerCase().includes(needle))
    );
  }, [agreements, query]);

  const filteredBookings = useMemo(() => {
    const needle = bookingSearch.trim().toLowerCase();
    if (!needle) return bookings.slice(0, 80);
    return bookings.filter((booking) => bookingLabel(booking).toLowerCase().includes(needle)).slice(0, 80);
  }, [bookings, bookingSearch]);

  const selectedBooking = bookings.find((booking) => booking.id === draft.bookingId);
  const standardIncludedServicesText = useMemo(() => includedServicesFromTemplate(standardSections), [standardSections]);
  const draftContent = useMemo(() => {
    if (!sourcePreview) return null;
    return buildAgreementContent({
      ...sourcePreview,
      editableFields: {
        included_services: draft.includedServices,
        luggage_transfer_policy: draft.luggageTransferPolicy,
        specific_cancellation_conditions: draft.specificCancellationConditions,
        complementary_note: draft.complementaryNote,
      },
      standardSections,
    });
  }, [draft, sourcePreview, standardSections]);

  const draftPreviewAgreement = useMemo<TravelAgreement | null>(() => {
    if (!draftContent || !sourcePreview) return null;
    return {
      id: "preview",
      booking_id: sourcePreview.booking?.id ?? null,
      trip_id: sourcePreview.booking?.trip_id ?? sourcePreview.trip?.id ?? null,
      status: "draft",
      secure_token: "preview",
      client_name: draftContent.summary.client_name,
      client_email: draftContent.summary.client_email ?? null,
      booking_reference: draftContent.summary.booking_reference ?? null,
      trip_title: draftContent.summary.trip_title,
      trip_start_date: sourcePreview.trip?.start_date ?? null,
      trip_end_date: sourcePreview.trip?.end_date ?? null,
      content: draftContent,
      sent_at: null,
      opened_at: null,
      accepted_at: null,
      declined_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }, [draftContent, sourcePreview]);

  const resetDraft = () => {
    setDraft({
      bookingId: "",
      includedServices: "",
      luggageTransferPolicy: "",
      specificCancellationConditions: "",
      complementaryNote: "",
    });
    setBookingSearch("");
    setSourcePreview(null);
  };

  const createAgreement = async (sendAfterCreate = false) => {
    if (!draft.bookingId) return toast.error("Sélectionnez une réservation.");
    setBusyId(sendAfterCreate ? "create-send" : "create");
    try {
      const source = await loadAgreementSource({ bookingId: draft.bookingId });
      if (!source.clientEmail) throw new Error("Email client introuvable. Complétez la réservation ou le client avant de créer l’accord.");
      const content = buildAgreementContent({
        ...source,
        editableFields: {
          included_services: draft.includedServices,
          luggage_transfer_policy: draft.luggageTransferPolicy,
          specific_cancellation_conditions: draft.specificCancellationConditions,
          complementary_note: draft.complementaryNote,
        },
        standardSections,
      });
      const { data: inserted, error } = await db
        .from("travel_agreements")
        .insert({
          booking_id: source.booking?.id ?? null,
          trip_id: source.booking?.trip_id ?? source.trip?.id ?? null,
          client_name: content.summary.client_name,
          client_email: content.summary.client_email,
          booking_reference: content.summary.booking_reference,
          trip_title: content.summary.trip_title,
          trip_start_date: source.trip?.start_date ?? null,
          trip_end_date: source.trip?.end_date ?? null,
          content,
        })
        .select("*")
        .single();
      if (error) throw error;

      if (sendAfterCreate) {
        const { data, error: sendError } = await supabase.functions.invoke("travel-agreement", {
          body: { action: "send", agreement_id: inserted.id },
        });
        if (sendError || data?.ok === false) throw new Error(data?.error || sendError?.message || "Envoi impossible");
        trackEvent("travel_agreement_email_sent", { status: "sent" });
        toast.success("Accord créé et envoyé au client.");
      } else {
        toast.success("Brouillon d’accord enregistré.");
      }

      setCreateOpen(false);
      resetDraft();
      await load();
    } catch (error: any) {
      toast.error(error?.message ?? "Création impossible.");
    } finally {
      setBusyId(null);
    }
  };

  const saveTemplate = async () => {
    setBusyId("template");
    try {
      const payload = {
        language: "fr",
        version: TRAVEL_AGREEMENT_VERSION,
        title: templateTitle.trim() || "Texte standard accord de voyage",
        content: { sections: standardSections },
        is_active: true,
      };
      const request = templateId
        ? db.from("travel_agreement_templates").update(payload).eq("id", templateId).select("*").single()
        : db.from("travel_agreement_templates").insert(payload).select("*").single();
      const { data, error } = await request;
      if (error) throw error;
      setTemplateId(data.id);
      toast.success("Texte standard enregistré.");
    } catch (error: any) {
      toast.error(error?.message ?? "Enregistrement impossible. Vérifiez que la migration SQL est appliquée.");
    } finally {
      setBusyId(null);
    }
  };

  const updateStandardSection = (index: number, patch: Partial<TravelAgreementTemplateSection>) => {
    setStandardSections((current) => current.map((section, i) => (i === index ? { ...section, ...patch } : section)));
  };

  const deleteAgreement = async (agreement: TravelAgreement) => {
    if (agreement.status === "accepted") {
      toast.error("Un accord accepté ne peut pas être supprimé afin de conserver la preuve d’acceptation.");
      return;
    }
    const warning = agreement.status === "draft"
      ? "Supprimer ce brouillon d’accord ?"
      : "Supprimer cet accord non accepté ? Les logs email resteront conservés.";
    if (!confirm(warning)) return;
    setBusyId(agreement.id);
    try {
      const { error } = await db.from("travel_agreements").delete().eq("id", agreement.id);
      if (error) throw error;
      toast.success("Accord supprimé.");
      await load();
    } catch (error: any) {
      toast.error(error?.message ?? "Suppression impossible.");
    } finally {
      setBusyId(null);
    }
  };

  const sendAgreement = async (agreement: TravelAgreement) => {
    setBusyId(agreement.id);
    try {
      const { data, error } = await supabase.functions.invoke("travel-agreement", {
        body: { action: "send", agreement_id: agreement.id },
      });
      if (error || data?.ok === false) throw new Error(data?.error || error?.message || "Envoi impossible");
      trackEvent("travel_agreement_email_sent", { status: data.agreement?.status || "sent" });
      toast.success("Accord envoyé au client.");
      await load();
    } catch (error: any) {
      toast.error(error?.message ?? "Envoi impossible.");
    } finally {
      setBusyId(null);
    }
  };

  const downloadAgreement = async (agreement: TravelAgreement) => {
    const bytes = await generateTravelAgreementPdf({
      agreement,
      acceptance: acceptances[agreement.id] ?? null,
    });
    downloadTravelAgreementPdf(bytes, filenameFor(agreement));
  };

  return (
    <div>
      <PageHeader
        title="Accords de voyage"
        description="Générez, envoyez et suivez l’acceptation des accords avant départ."
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Nouvel accord
          </Button>
        }
      />

      <Tabs defaultValue="agreements" className="space-y-5">
        <TabsList>
          <TabsTrigger value="agreements">Accords</TabsTrigger>
          <TabsTrigger value="template">Texte standard</TabsTrigger>
        </TabsList>

        <TabsContent value="agreements" className="space-y-5">
          <Card>
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9" placeholder="Rechercher client, référence, voyage..." value={query} onChange={(event) => setQuery(event.target.value)} />
              </div>
              <Button variant="outline" onClick={load} disabled={loading}>
                <RefreshCw className="h-4 w-4" /> Actualiser
              </Button>
            </CardContent>
          </Card>

          <div className="overflow-hidden rounded-lg border bg-background">
            <div className="hidden grid-cols-[1.25fr_1.15fr_.8fr_1fr_auto] gap-4 border-b bg-muted/40 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground lg:grid">
              <span>Client</span>
              <span>Voyage</span>
              <span>Statut</span>
              <span>Suivi</span>
              <span className="text-right">Actions</span>
            </div>
            {loading ? (
              <p className="p-6 text-sm text-muted-foreground">Chargement…</p>
            ) : filteredAgreements.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">Aucun accord de voyage pour le moment.</p>
            ) : (
              filteredAgreements.map((agreement) => {
                const acceptance = acceptances[agreement.id];
                return (
                  <div key={agreement.id} className="grid gap-3 border-b px-4 py-4 last:border-b-0 lg:grid-cols-[1.25fr_1.15fr_.8fr_1fr_auto] lg:items-center">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{agreement.client_name || "Client à confirmer"}</p>
                      <p className="truncate text-sm text-muted-foreground">{agreement.client_email || "Email manquant"}</p>
                      {agreement.booking_id && (
                        <Link to={`/admin/bookings/${agreement.booking_id}`} className="mt-1 inline-flex text-xs font-medium text-accent hover:underline">
                          {agreement.booking_reference || "Réservation"}
                        </Link>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{agreement.trip_title || "Voyage à confirmer"}</p>
                      <p className="text-xs text-muted-foreground">Créé le {fmtDateTime(agreement.created_at)}</p>
                      <p className="text-xs text-muted-foreground">{agreement.content?.summary?.trip_dates}</p>
                    </div>
                    <div>{statusBadge(agreement.status)}</div>
                    <div className="text-sm text-muted-foreground">
                      {agreement.sent_at && <p>Envoyé : {fmtDateTime(agreement.sent_at)}</p>}
                      {agreement.opened_at && <p>Ouvert : {fmtDateTime(agreement.opened_at)}</p>}
                      {acceptance?.accepted_at && <p>Accepté : {fmtDateTime(acceptance.accepted_at)}</p>}
                      {!agreement.sent_at && <p>Non envoyé</p>}
                    </div>
                    <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                      <Button size="sm" variant="outline" onClick={() => setPreviewAgreement(agreement)}>
                        <Eye className="h-4 w-4" /> Aperçu
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void downloadAgreement(agreement)}>
                        <Download className="h-4 w-4" /> PDF
                      </Button>
                      <Button size="sm" onClick={() => void sendAgreement(agreement)} disabled={busyId === agreement.id || !agreement.client_email || agreement.status === "accepted"}>
                        <Send className="h-4 w-4" /> Envoyer
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => void deleteAgreement(agreement)}
                        disabled={busyId === agreement.id || agreement.status === "accepted"}
                        title={agreement.status === "accepted" ? "Suppression désactivée pour les accords acceptés" : "Supprimer"}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </TabsContent>

        <TabsContent value="template">
          <Card>
            <CardContent className="space-y-5 p-5">
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="space-y-2">
                  <Label>Titre du modèle</Label>
                  <Input value={templateTitle} onChange={(event) => setTemplateTitle(event.target.value)} />
                </div>
                <Button onClick={saveTemplate} disabled={busyId === "template"}>
                  <Save className="h-4 w-4" /> Enregistrer le texte standard
                </Button>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                Ce texte est copié dans le snapshot au moment de créer un nouvel accord. Les accords déjà envoyés ou acceptés ne changent pas.
              </div>
              <div className="space-y-4">
                {standardSections.map((section, index) => (
                  <div key={section.key} className="rounded-lg border bg-background p-4">
                    <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
                      <div className="space-y-2">
                        <Label>Titre</Label>
                        <Input value={section.title} onChange={(event) => updateStandardSection(index, { title: event.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>Texte</Label>
                        <Textarea rows={5} value={section.body || ""} onChange={(event) => updateStandardSection(index, { body: event.target.value })} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={createOpen} onOpenChange={(open) => {
        setCreateOpen(open);
        if (!open) resetDraft();
      }}>
        <DialogContent className="flex max-h-[90dvh] w-[95vw] max-w-3xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b px-6 py-4 pr-12">
            <DialogTitle>Nouvel accord depuis une réservation</DialogTitle>
          </DialogHeader>
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5 pr-3 sm:pr-6">
            <div className="space-y-2">
              <Label>Rechercher une réservation</Label>
              <Input
                value={bookingSearch}
                onChange={(event) => setBookingSearch(event.target.value)}
                placeholder="Référence, client, email ou voyage"
              />
              <Select
                value={draft.bookingId || "__none"}
                onValueChange={(value) => {
                  const bookingId = value === "__none" ? "" : value;
                  setDraft((prev) => ({
                    ...prev,
                    bookingId,
                    includedServices: bookingId && !prev.includedServices.trim() ? standardIncludedServicesText : prev.includedServices,
                  }));
                }}
              >
                <SelectTrigger><SelectValue placeholder="Choisir une réservation" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Choisir une réservation</SelectItem>
                  {filteredBookings.map((booking) => (
                    <SelectItem key={booking.id} value={booking.id}>
                      {bookingLabel(booking)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
              <FileSignature className="mr-2 inline h-4 w-4" />
              {selectedBooking
                ? `${selectedBooking.reference} · ${selectedBooking.contact_name} · ${selectedBooking.contact_email || "email manquant"} · ${selectedBooking.trips?.title || "Voyage"}`
                : "Client, email, passeport, voyage, vols, hôtels, paiements et extras seront repris automatiquement depuis la réservation sélectionnée."}
            </div>

            {sourceLoading && <p className="text-sm text-muted-foreground">Chargement des données réservation…</p>}
            {draftContent && (
              <div className="grid gap-3 sm:grid-cols-2">
                <ReadOnlyBlock label="Client" value={draftContent.summary.client_name} />
                <ReadOnlyBlock label="Email" value={draftContent.summary.client_email || "Email manquant"} />
                <ReadOnlyBlock label="Passeport" value={draftContent.summary.passport_number || "À compléter côté dossier client"} />
                <ReadOnlyBlock label="Voyage" value={draftContent.summary.trip_title} />
                <ReadOnlyBlock label="Dates" value={draftContent.summary.trip_dates} />
                <ReadOnlyBlock label="Paiement" value={draftContent.summary.payment_status} />
              </div>
            )}

            <div className="rounded-lg border bg-background p-4">
              <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Champs spécifiques à cet accord</p>
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Prestations incluses</Label>
                  <Textarea rows={4} value={draft.includedServices} onChange={(event) => setDraft((prev) => ({ ...prev, includedServices: event.target.value }))} placeholder="Laissez vide pour utiliser la proposition automatique." />
                </div>
                <div className="space-y-2">
                  <Label>Politique transfert bagages</Label>
                  <Textarea rows={2} value={draft.luggageTransferPolicy} onChange={(event) => setDraft((prev) => ({ ...prev, luggageTransferPolicy: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Conditions particulières d'annulation</Label>
                  <Textarea rows={3} value={draft.specificCancellationConditions} onChange={(event) => setDraft((prev) => ({ ...prev, specificCancellationConditions: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Note complémentaire</Label>
                  <Textarea rows={3} value={draft.complementaryNote} onChange={(event) => setDraft((prev) => ({ ...prev, complementaryNote: event.target.value }))} />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 border-t bg-background px-6 py-4 sm:gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Annuler</Button>
            <Button variant="outline" disabled={!draftPreviewAgreement} onClick={() => draftPreviewAgreement && setPreviewAgreement(draftPreviewAgreement)}>
              <Eye className="h-4 w-4" /> Aperçu PDF
            </Button>
            <Button variant="outline" onClick={() => void createAgreement(false)} disabled={busyId === "create" || !draft.bookingId}>
              <Save className="h-4 w-4" /> Enregistrer brouillon
            </Button>
            <Button onClick={() => void createAgreement(true)} disabled={busyId === "create-send" || !draft.bookingId || !draftContent?.summary.client_email}>
              <Send className="h-4 w-4" /> Envoyer au client
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {previewAgreement && (
        <PdfPreviewDialog
          open={Boolean(previewAgreement)}
          onOpenChange={(open) => !open && setPreviewAgreement(null)}
          title={`Accord de voyage — ${previewAgreement.client_name || "client"}`}
          filename={filenameFor(previewAgreement)}
          generate={() => generateTravelAgreementPdf({
            agreement: previewAgreement,
            acceptance: previewAgreement.id === "preview" ? null : acceptances[previewAgreement.id] ?? null,
          })}
        />
      )}
    </div>
  );
}

function ReadOnlyBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}
