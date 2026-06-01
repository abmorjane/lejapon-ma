import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, Download, Eye, FileText, Mail, Pencil, Save } from "lucide-react";
import { toast } from "sonner";
import { generateVisaPdf, downloadBlob } from "@/lib/visa-pdf";
import { generateInvitationLetter, generateGuaranteeLetter } from "@/lib/visa-letters";
import { generateTravelConfirmationPdf, generateTravelProgrammePdf } from "@/lib/travel-documents-pdf";
import { PdfPreviewDialog } from "@/admin/components/PdfPreviewDialog";
import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import { AlertTriangle, MailQuestion, Package } from "lucide-react";
import JSZip from "jszip";
import { QuickActions } from "@/admin/components/QuickActions";
import { fetchAgencySettings, type AgencySettings } from "@/lib/agency-settings";
import { lookupVisaPrefillByPassport, normalizePassportNo } from "@/lib/visa-prefill";

const todayISO = () => new Date().toISOString().slice(0, 10);

const STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon",
  submitted: "Soumise",
  awaiting_documents: "En attente des documents",
  documents_received: "Documents reçus",
  in_review: "En traitement",
  submitted_to_embassy: "Soumise à l'ambassade",
  approved: "Approuvée",
  rejected: "Rejetée",
  completed: "Terminée",
};

const normalizeMatchText = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const hasText = (value: unknown) => String(value ?? "").trim().length > 0;

type TravelContext = {
  trip?: any | null;
  programme?: any | null;
  days?: any[];
  hotels?: any[];
  participants?: any[];
  agency?: AgencySettings | null;
};

async function loadTravelContextForTrip(tripId: string | null | undefined, participants: any[] = [], agency?: AgencySettings | null): Promise<TravelContext> {
  const ctx: TravelContext = { participants, agency, trip: null, programme: null, days: [], hotels: [] };
  if (!tripId) return ctx;

  const { data: trip } = await supabase.from("trips").select("*").eq("id", tripId).maybeSingle();
  ctx.trip = trip ?? null;
  if (!trip) return ctx;

  let programmeId = trip.programme_id;
  let matchedProgramme: any = null;
  if (programmeId) {
    const { data } = await supabase.from("programmes").select("*").eq("id", programmeId).maybeSingle();
    matchedProgramme = data ?? null;
  } else {
    const { data: programmes } = await supabase.from("programmes").select("*").order("sort_order");
    const tripText = normalizeMatchText([trip.title, trip.season, trip.label, trip.program_link].filter(Boolean).join(" "));
    matchedProgramme = (programmes ?? []).find((programme: any) => {
      const title = normalizeMatchText(programme.title);
      const slug = normalizeMatchText(programme.slug);
      return (
        (title && (tripText.includes(title) || title.includes(tripText))) ||
        (slug && (tripText.includes(slug) || String(trip.program_link ?? "").includes(programme.slug)))
      );
    });
    programmeId = matchedProgramme?.id ?? null;
  }

  const [daysRes, hotelsRes] = await Promise.all([
    programmeId
      ? supabase.from("programme_days").select("*").eq("programme_id", programmeId).order("day_number", { ascending: true })
      : Promise.resolve({ data: [] } as any),
    supabase
      .from("trip_hotels")
      .select("*")
      .eq("trip_id", trip.id)
      .order("sort_order")
      .order("check_in"),
  ]);
  ctx.programme = matchedProgramme;
  ctx.days = daysRes.data ?? [];
  ctx.hotels = hotelsRes.data ?? [];
  return ctx;
}

export default function VisaApplicationDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [app, setApp] = useState<any | null>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [settings, setSettings] = useState<any | null>(null);
  const [trips, setTrips] = useState<any[]>([]);
  const [bookingTripId, setBookingTripId] = useState<string | null>(null);
  const [selectedTravelTripId, setSelectedTravelTripId] = useState<string | null>(null);
  const [travelCtx, setTravelCtx] = useState<TravelContext>({});
  const [editingVisaInfo, setEditingVisaInfo] = useState(false);
  const [visaDraft, setVisaDraft] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<null | "visa" | "invitation" | "guarantee" | "programme" | "confirmation">(null);

  useEffect(() => {
    Promise.all([
      supabase.from("visa_applications").select("*").eq("id", id!).maybeSingle(),
      supabase.from("visa_documents").select("*").eq("application_id", id!).order("created_at"),
      supabase.from("visa_settings").select("*").limit(1).maybeSingle(),
      supabase.from("trips").select("id,title,season,start_date,end_date,label").order("start_date", { ascending: false }),
      fetchAgencySettings(),
    ]).then(async ([a, d, s, t, agency]) => {
      if (!a.data) { toast.error("Demande introuvable"); nav("/admin/visa"); return; }
      let appRow: any = a.data;
      let nextBookingTripId: string | null = null;
      const documentTripId: string | null = appRow.document_trip_id ?? null;
      let participants: any[] = [];

      if (appRow.booking_id) {
        const { data: booking } = await supabase
          .from("bookings")
          .select("id, trip_id")
          .eq("id", appRow.booking_id)
          .maybeSingle();
        const { data: participantRows } = await supabase
          .from("booking_participants")
          .select("first_name,last_name,passport_no")
          .eq("booking_id", appRow.booking_id)
          .order("created_at");
        nextBookingTripId = (booking as any)?.trip_id ?? null;
        participants = participantRows ?? [];
      }

      const effectiveTravelTripId = documentTripId || nextBookingTripId;
      const ctx = await loadTravelContextForTrip(effectiveTravelTripId, participants, agency);

      if (ctx.trip) {
          const patch: any = {};
          if (!appRow.date_of_arrival && ctx.trip.visa_japan_arrival_date) patch.date_of_arrival = ctx.trip.visa_japan_arrival_date;
          if (!appRow.port_of_entry && ctx.trip.visa_arrival_port) patch.port_of_entry = ctx.trip.visa_arrival_port;
          if (!appRow.airline_or_ship && ctx.trip.visa_arrival_flight_number) patch.airline_or_ship = ctx.trip.visa_arrival_flight_number;
          if (!appRow.hotel_name && ctx.trip.visa_hotel_name) patch.hotel_name = ctx.trip.visa_hotel_name;
          if (!appRow.hotel_address && ctx.trip.visa_hotel_address) patch.hotel_address = ctx.trip.visa_hotel_address;
          if (!appRow.hotel_tel && ctx.trip.visa_hotel_phone) patch.hotel_tel = ctx.trip.visa_hotel_phone;
          if (Object.keys(patch).length) {
            await supabase.from("visa_applications").update(patch).eq("id", appRow.id);
            appRow = { ...appRow, ...patch };
          }
      }

      setApp(appRow);
      setDocs(d.data ?? []);
      setSettings(s.data);
      setTrips(t.data ?? []);
      setBookingTripId(nextBookingTripId);
      setSelectedTravelTripId(effectiveTravelTripId);
      setTravelCtx(ctx);
    });
  }, [id, nav]);

  const updateStatus = async (status: string) => {
    setBusy(true);
    const patch: any = { status, reviewed_at: new Date().toISOString() };
    const { error } = await supabase.from("visa_applications").update(patch).eq("id", app.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    setApp({ ...app, ...patch });
    toast.success("Statut mis à jour");
    // Fire-and-forget email notification to the client
    supabase.functions.invoke("send-visa-email", {
      body: { application_id: app.id, status, extra: app.requested_documents ?? null },
    }).then(({ error: e }) => {
      if (e) console.warn("notification email failed", e);
    });
  };

  const saveNotes = async () => {
    const { error } = await supabase.from("visa_applications").update({ admin_notes: app.admin_notes ?? "" }).eq("id", app.id);
    if (error) return toast.error(error.message);
    toast.success("Notes enregistrées");
  };

  const openVisaEdit = () => {
    setVisaDraft({
      ...app,
      category: app.category ?? "tourism",
      passport_type: app.passport_type ?? "ordinary",
      purpose_of_visit: app.purpose_of_visit || "Tourisme",
      date_of_application: app.date_of_application || todayISO(),
    });
    setEditingVisaInfo(true);
  };

  const updateVisaDraft = (key: string, value: unknown) => {
    setVisaDraft((current: any) => ({ ...current, [key]: value }));
  };

  const saveVisaInfo = async () => {
    if (!app?.id || !visaDraft) return;
    const editableFields = [
      "category",
      "surname",
      "given_names",
      "other_names",
      "date_of_birth",
      "place_of_birth_city",
      "place_of_birth_state",
      "place_of_birth_country",
      "sex",
      "marital_status",
      "nationality",
      "former_nationality",
      "national_id_no",
      "passport_type",
      "passport_no",
      "passport_place_of_issue",
      "passport_date_of_issue",
      "passport_issuing_authority",
      "passport_date_of_expiry",
      "certificate_of_eligibility_no",
      "purpose_of_visit",
      "intended_length_of_stay",
      "date_of_arrival",
      "port_of_entry",
      "airline_or_ship",
      "hotel_name",
      "hotel_tel",
      "hotel_address",
      "previous_stays",
      "residential_address",
      "residential_tel",
      "residential_mobile",
      "residential_email",
      "profession",
      "partner_profession",
      "employer_name",
      "employer_tel",
      "employer_address",
      "q_convicted_crime",
      "q_imprisoned_1y",
      "q_deported",
      "q_drug_offence",
      "q_prostitution",
      "q_trafficking",
      "declarations_details",
      "remarks",
      "date_of_application",
    ];
    const patch = editableFields.reduce<Record<string, unknown>>((acc, key) => {
      const value = visaDraft[key];
      acc[key] = value === "" ? null : value;
      return acc;
    }, {});
    setBusy(true);
    const { data, error } = await supabase
      .from("visa_applications")
      .update(patch as any)
      .eq("id", app.id)
      .select("*")
      .maybeSingle();
    setBusy(false);
    if (error) return toast.error(error.message);
    if (data) setApp(data);
    setEditingVisaInfo(false);
    toast.success("Informations visa mises à jour");
  };

  const refreshFromTravelerFile = async () => {
    const passportNo = normalizePassportNo(app?.passport_no);
    if (!passportNo) return toast.error("Aucun numéro de passeport à rechercher.");
    setBusy(true);
    const lookup = await lookupVisaPrefillByPassport({
      passportNo,
      lastName: app?.surname ?? "",
      email: app?.residential_email ?? "",
    });
    setBusy(false);
    if (lookup.status !== "matched") {
      toast.info(lookup.message);
      return;
    }
    const patch = {
      ...lookup.patch,
      purpose_of_visit: app.purpose_of_visit || "Tourisme",
      date_of_application: app.date_of_application || todayISO(),
    };
    setBusy(true);
    const { data, error } = await supabase
      .from("visa_applications")
      .update(patch as any)
      .eq("id", app.id)
      .select("*")
      .maybeSingle();
    setBusy(false);
    if (error) return toast.error(error.message);
    if (data) setApp(data);
    toast.success(`Dossier reprérempli depuis: ${lookup.sourceLabel}`);
  };

  const saveTravelFields = async () => {
    const patch = {
      date_of_arrival: app.date_of_arrival || null,
      port_of_entry: app.port_of_entry || null,
      airline_or_ship: app.airline_or_ship || null,
      hotel_name: app.hotel_name || null,
      hotel_tel: app.hotel_tel || null,
      hotel_address: app.hotel_address || null,
    };
    const { error } = await supabase.from("visa_applications").update(patch).eq("id", app.id);
    if (error) return toast.error(error.message);
    toast.success("Informations voyage enregistrées");
  };

  const documentTripId = app?.document_trip_id ?? null;
  const travelTripWarnings = [
    !selectedTravelTripId ? "Aucun voyage n'est sélectionné pour les documents de voyage." : null,
    !documentTripId && !bookingTripId ? "Aucun voyage n'est lié à la réservation de cette demande visa." : null,
    !travelCtx.trip?.id ? "Aucun voyage n'est sélectionné pour les documents de voyage." : null,
  ].filter(Boolean) as string[];

  const confirmationWarnings = [
    !travelCtx.trip?.id ? "Aucun voyage n'est sélectionné pour les documents de voyage." : null,
    !hasText(travelCtx.trip?.outbound_flight_text) ? "Aucun texte complet de vol aller n'est renseigné." : null,
    !hasText(travelCtx.trip?.return_flight_text) ? "Aucun texte complet de vol retour n'est renseigné." : null,
    !(travelCtx.hotels?.length) ? "Aucun hôtel détaillé n'est lié à ce voyage." : null,
    !hasText(travelCtx.trip?.programme_id) ? "Aucun programme n'est lié à ce voyage." : null,
  ].filter(Boolean) as string[];

  const warnIfConfirmationIncomplete = () => {
    if (!confirmationWarnings.length) return;
    toast.warning("Confirmation voyage incomplète", {
      description: confirmationWarnings.join(" "),
    });
  };

  const ensureTravelTripSelected = () => {
    if (travelCtx.trip?.id) return true;
    toast.error("Aucun voyage n'est sélectionné pour les documents de voyage.");
    return false;
  };

  const changeTravelTrip = async (value: string) => {
    if (!app?.id) return;
    const tripId = value === "none" ? null : value;
    setBusy(true);
    const { error } = await supabase
      .from("visa_applications")
      .update({ document_trip_id: tripId } as any)
      .eq("id", app.id);
    setBusy(false);
    if (error) return toast.error(error.message);

    const effectiveTravelTripId = tripId || bookingTripId;
    const nextCtx = await loadTravelContextForTrip(effectiveTravelTripId, travelCtx.participants ?? [], travelCtx.agency ?? null);
    setApp((current: any) => current ? { ...current, document_trip_id: tripId } : current);
    setSelectedTravelTripId(effectiveTravelTripId);
    setTravelCtx(nextCtx);
    toast.success("Voyage utilisé pour les documents enregistré.");
  };

  const requestDocs = async () => {
    const text = (app.requested_documents ?? "").trim();
    if (!text) return toast.error("Indiquez les documents demandés.");
    setBusy(true);
    const patch = { requested_documents: text, documents_requested_at: new Date().toISOString() };
    const { error } = await supabase.from("visa_applications").update(patch).eq("id", app.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    setApp({ ...app, ...patch });
    toast.success("Demande envoyée au client.");
  };

  const sendFormReceived = async () => {
    if (!app) return;
    if (!confirm("Envoyer l'email de confirmation de réception du formulaire au client ?")) return;
    setBusy(true);
    const { error } = await supabase.functions.invoke("send-visa-email", {
      body: { application_id: app.id, status: "form_received" },
    });
    setBusy(false);
    if (error) return toast.error(error.message ?? "Échec de l'envoi");
    toast.success("Email envoyé au client");
  };

  const clearRequest = async () => {
    setBusy(true);
    const patch = { requested_documents: null, documents_requested_at: null };
    const { error } = await supabase.from("visa_applications").update(patch).eq("id", app.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    setApp({ ...app, ...patch });
  };

  const downloadDoc = async (d: any) => {
    const { data, error } = await supabase.storage.from("visa-docs").createSignedUrl(d.storage_path, 60);
    if (error || !data) return toast.error("Lien indisponible");
    window.open(data.signedUrl, "_blank");
  };

  const downloadAll = async () => {
    if (!app || !settings) return;
    if (!ensureTravelTripSelected()) return;
    setBusy(true);
    try {
      const zip = new JSZip();
      // Generated PDFs
      const [visaBytes, invBytes, garBytes] = await Promise.all([
        generateVisaPdf(app, settings),
        generateInvitationLetter(app, settings),
        generateGuaranteeLetter(app, settings),
      ]);
      warnIfConfirmationIncomplete();
      const [programmeBytes, confirmationBytes] = await Promise.all([
        generateTravelProgrammePdf(app, travelCtx),
        generateTravelConfirmationPdf(app, settings, travelCtx),
      ]);
      zip.file(`${app.reference}-visa-japon.pdf`, visaBytes);
      zip.file(`${app.reference}-invitation.pdf`, invBytes);
      zip.file(`${app.reference}-guarantee.pdf`, garBytes);
      zip.file(`${app.reference}-programme-voyage.pdf`, programmeBytes);
      zip.file(`${app.reference}-confirmation-voyage.pdf`, confirmationBytes);
      // Client uploaded documents
      if (docs.length) {
        const folder = zip.folder("documents-client");
        await Promise.all(docs.map(async (d) => {
          const { data } = await supabase.storage.from("visa-docs").download(d.storage_path);
          if (data) folder!.file(d.file_name, await data.arrayBuffer());
        }));
      }
      const blob = await zip.generateAsync({ type: "uint8array" });
      downloadBlob(blob, `${app.reference}-dossier-complet.zip`);
      toast.success("Archive téléchargée");
    } catch (e: any) { toast.error(e.message ?? "Erreur archive"); }
    finally { setBusy(false); }
  };

  const generateProgramme = useCallback(async () => {
    if (!travelCtx.trip?.id) throw new Error("Aucun voyage n'est sélectionné pour les documents de voyage.");
    return generateTravelProgrammePdf(app ?? {}, travelCtx);
  }, [app, travelCtx]);

  const generateConfirmation = useCallback(async () => {
    if (!travelCtx.trip?.id) throw new Error("Aucun voyage n'est sélectionné pour les documents de voyage.");
    return generateTravelConfirmationPdf(app ?? {}, settings ?? {}, travelCtx);
  }, [app, settings, travelCtx]);

  const generators = {
    visa: useCallback(() => generateVisaPdf(app ?? {}, settings ?? {}), [app, settings]),
    invitation: useCallback(() => generateInvitationLetter(app ?? {}, settings ?? {}), [app, settings]),
    guarantee: useCallback(() => generateGuaranteeLetter(app ?? {}, settings ?? {}), [app, settings]),
    programme: generateProgramme,
    confirmation: generateConfirmation,
  };

  const openPreview = (kind: "visa" | "invitation" | "guarantee" | "programme" | "confirmation") => {
    if ((kind === "programme" || kind === "confirmation") && !ensureTravelTripSelected()) return;
    if (kind === "confirmation") warnIfConfirmationIncomplete();
    setPreview(kind);
  };

  const downloadDirect = async (kind: "visa" | "invitation" | "guarantee" | "programme" | "confirmation") => {
    if (!app || !settings) return;
    if ((kind === "programme" || kind === "confirmation") && !ensureTravelTripSelected()) return;
    setBusy(true);
    try {
      if (kind === "confirmation") {
        warnIfConfirmationIncomplete();
      }
      const bytes = kind === "visa"
        ? await generateVisaPdf(app, settings)
        : kind === "invitation"
          ? await generateInvitationLetter(app, settings)
          : kind === "guarantee"
            ? await generateGuaranteeLetter(app, settings)
            : kind === "programme"
              ? await generateTravelProgrammePdf(app, travelCtx)
              : await generateTravelConfirmationPdf(app, settings, travelCtx);
      const suffix = kind === "visa" ? "visa-japon" : kind === "invitation" ? "invitation" : kind === "guarantee" ? "guarantee" : kind === "programme" ? "programme-voyage" : "confirmation-voyage";
      downloadBlob(bytes, `${app.reference}-${suffix}.pdf`);
    } catch (e: any) { toast.error(e.message ?? "Erreur PDF"); }
    finally { setBusy(false); }
  };

  if (!app) return <p className="text-muted-foreground">Chargement…</p>;

  const Row = ({ label, value }: any) => (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-2 py-2 text-sm border-b border-border/40 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="sm:col-span-2 font-medium break-words">{value || "—"}</span>
    </div>
  );

  const DraftInput = ({ field, label, type = "text", className = "" }: { field: string; label: string; type?: string; className?: string }) => (
    <div className={className}>
      <label className="text-xs text-muted-foreground">{label}</label>
      <Input
        type={type}
        value={visaDraft?.[field] ?? ""}
        onChange={(e) => updateVisaDraft(field, e.target.value)}
      />
    </div>
  );

  const DraftSelect = ({ field, label, options }: { field: string; label: string; options: Array<{ value: string; label: string }> }) => (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <Select value={visaDraft?.[field] ?? ""} onValueChange={(value) => updateVisaDraft(field, value)}>
        <SelectTrigger className="min-h-10">
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const DraftBoolean = ({ field, label }: { field: string; label: string }) => (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <Select value={visaDraft?.[field] ? "yes" : "no"} onValueChange={(value) => updateVisaDraft(field, value === "yes")}>
        <SelectTrigger className="min-h-10"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="no">Non</SelectItem>
          <SelectItem value="yes">Oui</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div>
      <button onClick={() => nav("/admin/visa")} className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1">
        <ArrowLeft className="w-4 h-4" /> Toutes les demandes
      </button>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-3xl mb-1">{app.reference}</h1>
          <p className="text-sm text-muted-foreground">{[app.surname, app.given_names].filter(Boolean).join(" ") || "Sans nom"}</p>
          <QuickActions
            phone={app.residential_mobile || app.residential_tel}
            email={app.residential_email}
            passport={app.passport_no}
            onPdf={() => setPreview("visa")}
            className="mt-4 sm:hidden"
          />
          <Button variant="outline" size="sm" className="mt-3" onClick={openVisaEdit}>
            <Pencil className="h-4 w-4" />
            Modifier les informations visa
          </Button>
          <Button variant="outline" size="sm" className="ml-2 mt-3" onClick={refreshFromTravelerFile} disabled={busy || !app.passport_no}>
            <Save className="h-4 w-4" />
            Repréremplir depuis le dossier voyageur
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-3">
          <Badge>{STATUS_LABEL[app.status]}</Badge>
          <Select value={app.status} onValueChange={updateStatus} disabled={busy}>
            <SelectTrigger className="w-full sm:w-44 min-h-11"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_LABEL).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {editingVisaInfo && visaDraft && (
        <Card className="mb-6 p-4 sm:p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-xl">Modifier les informations visa</h2>
              <p className="text-sm text-muted-foreground">Les modifications sont enregistrées dans la demande visa et seront reprises par les PDF.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditingVisaInfo(false)} disabled={busy}>Annuler</Button>
              <Button onClick={saveVisaInfo} disabled={busy}>
                <Save className="h-4 w-4" />
                Enregistrer
              </Button>
            </div>
          </div>

          <div className="space-y-6">
            <section>
              <h3 className="mb-3 font-semibold">Identité</h3>
              <div className="grid gap-3 md:grid-cols-2">
                <DraftInput field="surname" label="Nom" />
                <DraftInput field="given_names" label="Prénom(s)" />
                <DraftInput field="other_names" label="Autres noms / alias" />
                <DraftInput field="date_of_birth" label="Date de naissance" type="date" />
                <DraftInput field="place_of_birth_city" label="Ville de naissance" />
                <DraftInput field="place_of_birth_state" label="Région / Province" />
                <DraftInput field="place_of_birth_country" label="Pays de naissance" />
                <DraftInput field="nationality" label="Nationalité" />
                <DraftInput field="former_nationality" label="Nationalité antérieure" />
                <DraftInput field="national_id_no" label="N° pièce d'identité" />
                <DraftSelect field="sex" label="Sexe" options={[{ value: "male", label: "Homme" }, { value: "female", label: "Femme" }]} />
                <DraftSelect field="marital_status" label="État civil" options={[
                  { value: "single", label: "Célibataire" },
                  { value: "married", label: "Marié(e)" },
                  { value: "widowed", label: "Veuf(ve)" },
                  { value: "divorced", label: "Divorcé(e)" },
                ]} />
              </div>
            </section>

            <section>
              <h3 className="mb-3 font-semibold">Passeport</h3>
              <div className="grid gap-3 md:grid-cols-2">
                <DraftSelect field="passport_type" label="Type de passeport" options={[
                  { value: "ordinary", label: "Ordinaire" },
                  { value: "diplomatic", label: "Diplomatique" },
                  { value: "official", label: "Officiel" },
                  { value: "other", label: "Autre" },
                ]} />
                <DraftInput field="passport_no" label="Numéro de passeport" />
                <DraftInput field="passport_place_of_issue" label="Lieu de délivrance" />
                <DraftInput field="passport_date_of_issue" label="Date de délivrance" type="date" />
                <DraftInput field="passport_issuing_authority" label="Autorité de délivrance" />
                <DraftInput field="passport_date_of_expiry" label="Date d'expiration" type="date" />
                <DraftInput field="certificate_of_eligibility_no" label="N° Certificat d'éligibilité" />
              </div>
            </section>

            <section>
              <h3 className="mb-3 font-semibold">Voyage</h3>
              <div className="grid gap-3 md:grid-cols-2">
                <DraftInput field="purpose_of_visit" label="Motif de voyage" />
                <DraftInput field="intended_length_of_stay" label="Durée prévue du séjour" />
                <DraftInput field="date_of_arrival" label="Arrivée Japon" type="date" />
                <DraftInput field="port_of_entry" label="Port / aéroport d'entrée" />
                <DraftInput field="airline_or_ship" label="Compagnie / vol" />
                <DraftInput field="hotel_name" label="Hôtel" />
                <DraftInput field="hotel_tel" label="Téléphone hôtel" />
                <DraftInput field="hotel_address" label="Adresse hôtel" />
                <DraftInput field="previous_stays" label="Séjours précédents au Japon" className="md:col-span-2" />
              </div>
            </section>

            <section>
              <h3 className="mb-3 font-semibold">Résidence, profession et école</h3>
              <div className="grid gap-3 md:grid-cols-2">
                <DraftInput field="residential_address" label="Adresse de résidence" className="md:col-span-2" />
                <DraftInput field="residential_tel" label="Téléphone fixe" />
                <DraftInput field="residential_mobile" label="Mobile" />
                <DraftInput field="residential_email" label="Email" type="email" />
                <DraftInput field="profession" label="Profession actuelle" />
                <DraftInput field="partner_profession" label="Profession du conjoint / parents, si mineur" />
                <DraftInput field="employer_name" label="Nom de l'employeur ou de l'école si étudiant" />
                <DraftInput field="employer_tel" label="Téléphone de l'employeur ou de l'école si étudiant" />
                <DraftInput field="employer_address" label="Adresse de l'employeur ou de l'école si étudiant" className="md:col-span-2" />
              </div>
            </section>

            <section>
              <h3 className="mb-3 font-semibold">Déclarations et date</h3>
              <div className="grid gap-3 md:grid-cols-2">
                <DraftBoolean field="q_convicted_crime" label="Crime / délit" />
                <DraftBoolean field="q_imprisoned_1y" label="Emprisonnement 1 an+" />
                <DraftBoolean field="q_deported" label="Déportation" />
                <DraftBoolean field="q_drug_offence" label="Drogue" />
                <DraftBoolean field="q_prostitution" label="Prostitution" />
                <DraftBoolean field="q_trafficking" label="Traite" />
                <div className="md:col-span-2">
                  <label className="text-xs text-muted-foreground">Précisions déclarations</label>
                  <Textarea rows={3} value={visaDraft.declarations_details ?? ""} onChange={(e) => updateVisaDraft("declarations_details", e.target.value)} />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs text-muted-foreground">Remarques</label>
                  <Textarea rows={3} value={visaDraft.remarks ?? ""} onChange={(e) => updateVisaDraft("remarks", e.target.value)} />
                </div>
                <DraftInput field="date_of_application" label="Date de la demande" type="date" />
              </div>
            </section>
          </div>
        </Card>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-4 sm:p-5">
            <h2 className="font-display text-lg mb-3">Identité</h2>
            <Row label="Nom / Prénom" value={`${app.surname ?? ""} ${app.given_names ?? ""}`.trim()} />
            <Row label="Autres noms" value={app.other_names} />
            <Row label="Date de naissance" value={app.date_of_birth} />
            <Row label="Lieu de naissance" value={[app.place_of_birth_city, app.place_of_birth_state, app.place_of_birth_country].filter(Boolean).join(", ")} />
            <Row label="Sexe / État civil" value={[app.sex, app.marital_status].filter(Boolean).join(" / ")} />
            <Row label="Nationalité" value={app.nationality} />
            <Row label="N° pièce d'identité" value={app.national_id_no} />
            <Row label="Date de la demande" value={app.date_of_application || todayISO()} />
            <Row
              label="Source voyageur liée"
              value={app.booking_id
                ? `Réservation ${app.booking_id}`
                : app.document_trip_id
                  ? `Voyage ${app.document_trip_id}`
                  : "Aucune source liée"}
            />
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="font-display text-lg mb-3">Passeport</h2>
            <QuickActions passport={app.passport_no} compact className="mb-3" />
            <Row label="Type / N°" value={`${app.passport_type ?? ""} · ${app.passport_no ?? ""}`} />
            <Row label="Lieu de délivrance" value={app.passport_place_of_issue} />
            <Row label="Date de délivrance" value={app.passport_date_of_issue} />
            <Row label="Autorité" value={app.passport_issuing_authority} />
            <Row label="Date d'expiration" value={app.passport_date_of_expiry} />
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="font-display text-lg mb-3">Voyage & hébergement</h2>
            {travelTripWarnings.length > 0 && (
              <Alert className="mb-4 border-amber-300 bg-amber-50 text-amber-950">
                <AlertTriangle className="h-4 w-4 text-amber-700" />
                <AlertTitle>Voyage documents à vérifier</AlertTitle>
                <AlertDescription>
                  <ul className="mt-2 list-disc space-y-1 pl-4">
                    {travelTripWarnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <Row label="Motif" value={app.purpose_of_visit} />
            <Row label="Durée" value={app.intended_length_of_stay} />
            <div className="my-4 rounded-lg border border-border bg-secondary/20 p-3">
              <label className="text-xs text-muted-foreground">Voyage utilisé pour Programme / Confirmation PDF</label>
              <Select value={selectedTravelTripId || "none"} onValueChange={changeTravelTrip}>
                <SelectTrigger className="mt-1 min-h-11">
                  <SelectValue placeholder="Sélectionner un voyage" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Aucun voyage sélectionné</SelectItem>
                  {trips.map((trip) => (
                    <SelectItem key={trip.id} value={trip.id}>
                      {[trip.title, trip.season, trip.start_date].filter(Boolean).join(" · ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-muted-foreground">Arrivée Japon</label>
                <Input type="date" value={app.date_of_arrival ?? ""} onChange={(e) => setApp({ ...app, date_of_arrival: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Port / aéroport d'entrée</label>
                <Input value={app.port_of_entry ?? ""} onChange={(e) => setApp({ ...app, port_of_entry: e.target.value })} placeholder="Narita, Haneda…" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Compagnie / vol</label>
                <Input value={app.airline_or_ship ?? ""} onChange={(e) => setApp({ ...app, airline_or_ship: e.target.value })} placeholder="EK318…" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Hôtel</label>
                <Input value={app.hotel_name ?? ""} onChange={(e) => setApp({ ...app, hotel_name: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Téléphone hôtel</label>
                <Input value={app.hotel_tel ?? ""} onChange={(e) => setApp({ ...app, hotel_tel: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Adresse hôtel</label>
                <Input value={app.hotel_address ?? ""} onChange={(e) => setApp({ ...app, hotel_address: e.target.value })} />
              </div>
            </div>
            <Button size="sm" variant="outline" className="mt-3 min-h-10" onClick={saveTravelFields}>
              <Save className="w-4 h-4" /> Enregistrer les infos voyage
            </Button>
            <Separator className="my-2" />
            <Row label="Voyage lié" value={travelCtx.trip?.title} />
            <Row label="Programme lié" value={travelCtx.programme?.title} />
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="font-display text-lg mb-3">Résidence, profession et école</h2>
            <QuickActions phone={app.residential_mobile || app.residential_tel} email={app.residential_email} compact className="mb-3" />
            <Row label="Adresse" value={app.residential_address} />
            <Row label="Tel / Mobile" value={[app.residential_tel, app.residential_mobile].filter(Boolean).join(" · ")} />
            <Row label="Email" value={app.residential_email} />
            <Row label="Profession" value={app.profession} />
            <Row label="Employeur / école" value={app.employer_name} />
            <Row label="Tel employeur / école" value={app.employer_tel} />
            <Row label="Adresse employeur / école" value={app.employer_address} />
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="font-display text-lg mb-3">Déclarations</h2>
            <Row label="Crime / délit" value={app.q_convicted_crime ? "Oui" : "Non"} />
            <Row label="Emprisonnement 1 an+" value={app.q_imprisoned_1y ? "Oui" : "Non"} />
            <Row label="Déportation" value={app.q_deported ? "Oui" : "Non"} />
            <Row label="Drogue" value={app.q_drug_offence ? "Oui" : "Non"} />
            <Row label="Prostitution" value={app.q_prostitution ? "Oui" : "Non"} />
            <Row label="Traite" value={app.q_trafficking ? "Oui" : "Non"} />
            <Row label="Précisions" value={app.declarations_details} />
            <Row label="Remarques" value={app.remarks} />
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4 sm:p-5">
            <h2 className="font-display text-lg mb-3">Actions</h2>
            <p className="text-xs text-muted-foreground mb-3">Documents officiels pré-remplis avec les informations garant par défaut.</p>
            {confirmationWarnings.length > 0 && (
              <Alert className="mb-3 border-amber-300 bg-amber-50 text-amber-950">
                <AlertTriangle className="h-4 w-4 text-amber-700" />
                <AlertTitle>Confirmation voyage incomplète</AlertTitle>
                <AlertDescription>
                  <ul className="mt-2 list-disc space-y-1 pl-4">
                    {confirmationWarnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <Button
              size="sm"
              className="w-full min-h-11 mb-3"
              onClick={sendFormReceived}
              disabled={busy || !app.residential_email}
              title={!app.residential_email ? "Aucun email client" : undefined}
            >
              <Mail className="w-4 h-4" /> Formulaire de visa reçu
            </Button>
            {([
              { k: "visa", label: "Formulaire visa officiel" },
              { k: "invitation", label: "Lettre d'invitation" },
              { k: "guarantee", label: "Lettre de garantie" },
              { k: "programme", label: "Programme du voyage" },
              { k: "confirmation", label: "Confirmation du voyage" },
            ] as const).map(({ k, label }) => (
              <div key={k} className="flex items-center gap-2 mb-2">
                <Button variant="outline" size="sm" className="flex-1 min-h-11 justify-start" onClick={() => openPreview(k)} disabled={busy}>
                  <Eye className="w-4 h-4" /> {label}
                </Button>
                <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => downloadDirect(k)} disabled={busy} title="Télécharger">
                  <Download className="w-4 h-4" />
                </Button>
              </div>
            ))}
            <Separator className="my-3" />
            <Button size="sm" className="w-full min-h-11" onClick={downloadAll} disabled={busy}>
              <Package className="w-4 h-4" /> Tout télécharger (ZIP)
            </Button>
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="font-display text-lg mb-3">Documents ({docs.length})</h2>
            {docs.length === 0 && <p className="text-sm text-muted-foreground">Aucun document.</p>}
            <div className="space-y-2">
              {docs.map((d) => (
                <button key={d.id} onClick={() => downloadDoc(d)} className="w-full flex items-center gap-2 p-2 border border-border rounded hover:bg-secondary text-left">
                  <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">{d.file_name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{d.doc_type}</p>
                  </div>
                  <Download className="w-4 h-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="font-display text-lg mb-3 flex items-center gap-2"><MailQuestion className="w-4 h-4" /> Demande de documents</h2>
            <p className="text-xs text-muted-foreground mb-2">
              Précisez ce que le client doit téléverser. Le message sera affiché en haut de son formulaire.
            </p>
            <Textarea
              rows={3}
              placeholder="Ex. Photo d'identité 45×35mm, justificatif d'emploi, réservation d'hôtel…"
              value={app.requested_documents ?? ""}
              onChange={(e) => setApp({ ...app, requested_documents: e.target.value })}
            />
            {app.documents_requested_at && (
              <p className="text-xs text-muted-foreground mt-2">
                Demandé le {new Date(app.documents_requested_at).toLocaleDateString("fr-FR")}
              </p>
            )}
            <div className="flex gap-2 mt-2">
              <Button size="sm" className="flex-1" onClick={requestDocs} disabled={busy}>Envoyer la demande</Button>
              {app.requested_documents && (
                <Button size="sm" variant="ghost" onClick={clearRequest} disabled={busy}>Effacer</Button>
              )}
            </div>
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="font-display text-lg mb-3">Notes internes</h2>
            <Textarea rows={6} value={app.admin_notes ?? ""} onChange={(e) => setApp({ ...app, admin_notes: e.target.value })} />
            <Button size="sm" onClick={saveNotes} className="mt-2 w-full"><Save className="w-4 h-4" /> Enregistrer</Button>
          </Card>
        </div>
      </div>

      <PdfPreviewDialog
        open={preview === "visa"}
        onOpenChange={(v) => !v && setPreview(null)}
        title="Formulaire visa officiel"
        filename={`${app.reference}-visa-japon.pdf`}
        generate={generators.visa}
      />
      <PdfPreviewDialog
        open={preview === "invitation"}
        onOpenChange={(v) => !v && setPreview(null)}
        title="Lettre d'invitation"
        filename={`${app.reference}-invitation.pdf`}
        generate={generators.invitation}
      />
      <PdfPreviewDialog
        open={preview === "guarantee"}
        onOpenChange={(v) => !v && setPreview(null)}
        title="Lettre de garantie"
        filename={`${app.reference}-guarantee.pdf`}
        generate={generators.guarantee}
      />
      <PdfPreviewDialog
        open={preview === "programme"}
        onOpenChange={(v) => !v && setPreview(null)}
        title="Programme du voyage"
        filename={`${app.reference}-programme-voyage.pdf`}
        generate={generators.programme}
      />
      <PdfPreviewDialog
        open={preview === "confirmation"}
        onOpenChange={(v) => !v && setPreview(null)}
        title="Confirmation du voyage"
        filename={`${app.reference}-confirmation-voyage.pdf`}
        generate={generators.confirmation}
      />
    </div>
  );
}
