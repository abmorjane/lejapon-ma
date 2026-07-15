import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { ArrowLeft, Save, Send, Upload, Trash2, Download, FileText, Camera, CheckCircle2, Info, FileScan, Search } from "lucide-react";
import { Seo } from "@/components/Seo";
import { PassportPhotoDialog } from "./PassportPhotoDialog";
import { useRouteSlugs, pathFor } from "@/hooks/useRouteSlugs";
import { applyEmptyFieldPatch, lookupVisaPrefillByPassport, normalizePassportNo } from "@/lib/visa-prefill";
import { isVisaProcurationDocument, upsertVisaProcurationDocument } from "@/lib/visa-procuration-pdf";
import { isVisaChecklistDocument, upsertVisaChecklistDocument } from "@/lib/visa-checklist-pdf";
import {
  PROFESSIONAL_SITUATIONS,
  checklistSnapshotText,
  crmSituationToVisaSituation,
  findChecklistForSituation,
  professionalSituationLabel,
} from "@/lib/visa-document-checklists";
import { PassportScannerDialog, type PassportOcrFields } from "@/admin/components/PassportScannerDialog";
import {
  buildPreviousJapanStayValue,
  formatVisaDate,
  isRetiredVisaCategory,
  parsePreviousJapanStay,
  RETIRED_NOT_APPLICABLE,
} from "@/lib/visa-format";
import { syncVisaApplicationToClient } from "@/lib/visa-crm-sync";
import { trackEvent } from "@/lib/analytics";
import { visaTripDatesFromTrip } from "@/lib/visa-trip-dates";

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

const F = ({ label, children }: { label: React.ReactNode; children: React.ReactNode }) => (
  <div><Label className="text-xs">{label}</Label>{children}</div>
);

type VisaTripOption = {
  id: string;
  title: string;
  season: string | null;
  start_date: string | null;
  end_date: string | null;
  duration_days: number | null;
  total_trip_days?: number | null;
  japan_stay_days?: number | null;
  visa_japan_arrival_date?: string | null;
  visa_japan_departure_date?: string | null;
};

const todayISO = () => new Date().toISOString().slice(0, 10);

const requiredLabel = (label: string) => (
  <span>
    {label} <span className="text-destructive">*</span>
  </span>
);

const japanStayDaysFromTrip = (trip: VisaTripOption | null) => {
  return visaTripDatesFromTrip(trip).japanStayDays;
};

const isJapanStayFallback = (trip: VisaTripOption | null) =>
  visaTripDatesFromTrip(trip).usesStayFallback;

const firstString = (...values: unknown[]) =>
  values.find((value) => typeof value === "string" && value.trim()) as string | undefined;

export default function VisaForm() {
  const { id } = useParams();
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const slugs = useRouteSlugs();
  const visaBase = pathFor(slugs, "visa");
  const [app, setApp] = useState<any | null>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [settings, setSettings] = useState<any | null>(null);
  const [checklists, setChecklists] = useState<any[]>([]);
  const [tripOptions, setTripOptions] = useState<VisaTripOption[]>([]);
  const [durationSource, setDurationSource] = useState("other");
  const [manualDurationDays, setManualDurationDays] = useState("");
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoDialogOpen, setPhotoDialogOpen] = useState(false);
  const [passportScannerOpen, setPassportScannerOpen] = useState(false);
  const [passportScanPath, setPassportScanPath] = useState<string | null>(null);
  const [passportLookupBusy, setPassportLookupBusy] = useState(false);
  const [lastPassportLookup, setLastPassportLookup] = useState("");
  const [autoSaveAt, setAutoSaveAt] = useState<Date | null>(null);
  const skipAutoSaveRef = useRef(true);
  const saveTimerRef = useRef<number | null>(null);

  const isReadOnly = useMemo(() => app && app.status !== "draft", [app]);
  // Clients can still add complementary documents after submission, until the file is closed.
  const canUploadMore = useMemo(
    () => app && !["completed", "rejected"].includes(app.status),
    [app],
  );

  useEffect(() => {
    if (loading) return;
    if (!user) return nav(`${visaBase}/login`, { replace: true });
    (async () => {
      const [appRes, docsRes, sRes, clRes] = await Promise.all([
        supabase.from("visa_applications").select("*").eq("id", id!).maybeSingle(),
        supabase.from("visa_documents").select("*").eq("application_id", id!).order("created_at"),
        supabase.from("visa_settings").select("*").limit(1).maybeSingle(),
        supabase.from("visa_document_checklists").select("*").eq("is_active", true).order("sort_order"),
      ]);
      if (appRes.error || !appRes.data) { toast.error("Demande introuvable"); nav(`${visaBase}/applications`); return; }
      let hydratedApp = {
        ...appRes.data,
        category: appRes.data.category ?? "",
        passport_type: appRes.data.passport_type ?? "ordinary",
        purpose_of_visit: appRes.data.purpose_of_visit || "Tourisme",
        date_of_application: appRes.data.date_of_application || todayISO(),
      };
      const metadata = user.user_metadata ?? {};
      const metadataPassportNo = normalizePassportNo(firstString(metadata.passport_no, metadata.passport_number));
      const userClientProfile = user.email
        ? await supabase
            .from("clients")
            .select("id,email,passport_number,passport_no,metadata")
            .eq("email", user.email)
            .limit(1)
            .maybeSingle()
        : { data: null, error: null };
      const clientMetadata = userClientProfile.data?.metadata && typeof userClientProfile.data.metadata === "object"
        ? userClientProfile.data.metadata as Record<string, any>
        : {};
      const clientPassportOcr = clientMetadata.passport_ocr && typeof clientMetadata.passport_ocr === "object"
        ? clientMetadata.passport_ocr as Record<string, any>
        : {};
      const profilePassportNo = normalizePassportNo(firstString(
        userClientProfile.data?.passport_number,
        userClientProfile.data?.passport_no,
        clientPassportOcr.passport_number,
        clientPassportOcr.passport_no,
      ));
      const passportForAutoPrefill = metadataPassportNo || profilePassportNo;
      const metadataPatch = applyEmptyFieldPatch(hydratedApp, {
        surname: metadata.last_name,
        given_names: metadata.first_name,
        passport_no: passportForAutoPrefill,
        category: crmSituationToVisaSituation(String(metadata.professional_situation ?? "")) || undefined,
      });
      hydratedApp = { ...hydratedApp, ...metadataPatch };
      if (hydratedApp.status === "draft" && passportForAutoPrefill && !appRes.data.submitted_at) {
        const lookup = await lookupVisaPrefillByPassport({
          passportNo: passportForAutoPrefill,
          lastName: String(metadata.last_name ?? hydratedApp.surname ?? ""),
          email: user.email ?? "",
        });
        if (lookup.status === "matched") {
          const safePatch = applyEmptyFieldPatch(hydratedApp, lookup.patch);
          hydratedApp = { ...hydratedApp, ...safePatch };
          if (Object.keys(safePatch).length) {
            await supabase.from("visa_applications").update(safePatch as any).eq("id", hydratedApp.id);
            toast.info("Informations préremplies depuis votre dossier passeport. Merci de vérifier avant validation.");
          }
        } else if (lookup.status === "none" || lookup.status === "multiple") {
          toast.info(lookup.message);
        }
      }
      setApp(hydratedApp);
      setDocs(docsRes.data ?? []);
      setSettings(sRes.data);
      setChecklists(clRes.data ?? []);
      setDurationSource((hydratedApp as any).document_trip_id || "other");
      const durationMatch = String(hydratedApp.intended_length_of_stay ?? "").match(/\d+/);
      setManualDurationDays(durationMatch?.[0] ?? "");
      // Allow auto-save on subsequent edits, but skip the very first hydration.
      skipAutoSaveRef.current = true;
      window.setTimeout(() => { skipAutoSaveRef.current = false; }, 400);
    })();
  }, [id, user, loading, nav]);

  useEffect(() => {
    supabase
      .from("trips")
      .select("id,title,season,start_date,end_date,duration_days,total_trip_days,japan_stay_days,visa_japan_arrival_date,visa_japan_departure_date")
      .in("status", ["open", "completed"])
      .order("start_date", { ascending: true, nullsFirst: false })
      .then(({ data }) => setTripOptions((data ?? []) as VisaTripOption[]));
  }, []);

  const upd = (patch: any) => setApp((a: any) => ({ ...a, ...patch }));

  const normalizeVisaSex = (value?: string) => {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (["m", "male", "homme", "masculin"].includes(normalized)) return "male";
    if (["f", "female", "femme", "feminin", "féminin"].includes(normalized)) return "female";
    return value || "";
  };

  const applyPassportOcrToVisa = (fields: PassportOcrFields) => {
    const residenceAddress = [fields.residence_address || fields.address, fields.residence_city || fields.city, fields.residence_country]
      .filter(Boolean)
      .join(", ");
    const patch = applyEmptyFieldPatch(app ?? {}, {
      surname: fields.last_name || fields.full_name?.split(/\s+/).slice(-1).join(" ") || "",
      given_names: fields.first_name || fields.full_name?.split(/\s+/).slice(0, -1).join(" ") || "",
      date_of_birth: fields.date_of_birth || "",
      place_of_birth_city: fields.place_of_birth || "",
      nationality: fields.nationality || "",
      national_id_no: fields.national_id_number || "",
      sex: normalizeVisaSex(fields.sex) || "",
      passport_type: "ordinary",
      passport_no: fields.passport_no || "",
      passport_date_of_issue: fields.passport_issue_date || "",
      passport_date_of_expiry: fields.passport_expiry || "",
      passport_place_of_issue: fields.passport_authority || "",
      passport_issuing_authority: fields.passport_authority || "",
      residential_address: residenceAddress || "",
    });
    upd(patch);
    toast.success("Informations passeport appliquées au formulaire. Merci de vérifier avant validation.");
  };

  const lookupPassportFromForm = async (force = false) => {
    if (!app?.passport_no || isReadOnly) return;
    const normalized = normalizePassportNo(app.passport_no);
    if (!normalized) return;
    if (!force && normalized === lastPassportLookup) return;
    setLastPassportLookup(normalized);
    setPassportLookupBusy(true);
    const lookup = await lookupVisaPrefillByPassport({
      passportNo: normalized,
      lastName: String(app.surname ?? ""),
      email: String(app.residential_email ?? user?.email ?? ""),
    });
    setPassportLookupBusy(false);
    if (lookup.status === "matched") {
      const safePatch = applyEmptyFieldPatch(app, lookup.patch);
      const patch = { ...safePatch, passport_no: normalized };
      upd(patch);
      await supabase.from("visa_applications").update(patch as any).eq("id", app.id);
      toast.success("Informations préremplies depuis votre fiche client. Merci de vérifier avant validation.");
      return;
    }
    toast.info(lookup.message);
  };

  const selectDurationSource = (value: string) => {
    setDurationSource(value);
    if (value === "other") {
      upd({
        document_trip_id: null,
        intended_length_of_stay: manualDurationDays ? `${manualDurationDays} jours` : "",
      });
      return;
    }
    const trip = tripOptions.find((item) => item.id === value) ?? null;
    const tripDates = visaTripDatesFromTrip(trip);
    upd({
      document_trip_id: value,
      intended_length_of_stay: tripDates.japanStayDays ? `${tripDates.japanStayDays} jours` : "",
      date_of_arrival: tripDates.japanArrivalDate || app?.date_of_arrival || null,
    });
  };

  const updateManualDuration = (value: string) => {
    setManualDurationDays(value);
    if (durationSource === "other") {
      upd({ intended_length_of_stay: value ? `${value} jours` : "" });
    }
  };

  const normalizeVisaPayload = (source: any) => {
    if (!isRetiredVisaCategory(source?.category)) return source;
    return {
      ...source,
      profession: source.profession || "Retraité",
      employer_name: null,
      employer_tel: null,
      employer_address: null,
    };
  };

  const updateProfessionalSituation = (value: string) => {
    if (isRetiredVisaCategory(value)) {
      upd({
        category: value,
        profession: app?.profession || "Retraité",
        employer_name: "",
        employer_tel: "",
        employer_address: "",
      });
      return;
    }
    upd({ category: value });
  };

  const updatePreviousJapanStay = (patch: Partial<ReturnType<typeof parsePreviousJapanStay>>) => {
    const current = parsePreviousJapanStay(app?.previous_stays);
    upd({ previous_stays: buildPreviousJapanStayValue({ ...current, ...patch }) });
  };

  // Debounced auto-save (drafts only)
  useEffect(() => {
    if (!app || isReadOnly || skipAutoSaveRef.current) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(async () => {
      try {
        const { id: _i, created_at, updated_at, reference, status, user_id, submitted_at, reviewed_at, reviewed_by, admin_notes, ...payload } = normalizeVisaPayload(app);
        const { error } = await supabase.from("visa_applications").update(payload).eq("id", app.id);
        if (!error) setAutoSaveAt(new Date());
      } catch { /* silent */ }
    }, 1500);
    return () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, isReadOnly]);

  // Form completion progress (0-100)
  const progress = useMemo(() => {
    if (!app) return 0;
    const sections = [
      { key: "category", filled: !!app.category, weight: 5 },
      {
        key: "identity",
        filled: !!(app.surname && app.given_names && app.date_of_birth && app.nationality && app.sex),
        weight: 20,
      },
      {
        key: "passport",
        filled: !!(app.passport_no && app.passport_date_of_expiry),
        weight: 15,
      },
      {
        key: "travel",
        filled: !!(app.purpose_of_visit && app.intended_length_of_stay),
        weight: 15,
      },
      {
        key: "residence",
        filled: !!(app.residential_address && app.residential_email && app.profession),
        weight: 15,
      },
      {
        key: "documents",
        filled: docs.length > 0,
        weight: 15,
      },
      {
        key: "consents",
        filled: !!(app.consent_truthful && app.consent_data && app.consent_disclaimer),
        weight: 15,
      },
    ];
    return sections.reduce((acc, s) => acc + (s.filled ? s.weight : 0), 0);
  }, [app, docs]);

  const confirmPhotoUpload = async (file: File) => {
    if (!user || !app) return;
    setUploading(true);
    try {
      const path = `${user.id}/${app.id}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("visa-docs").upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      const { data, error } = await supabase.from("visa_documents").insert({
        application_id: app.id, user_id: user.id,
        doc_type: "photo" as any, storage_path: path,
        file_name: file.name, mime_type: file.type, size_bytes: file.size,
      }).select("*").single();
      if (error) throw error;
      setDocs((d) => [...d, data!]);
      toast.success("Photo téléversée au format visa");
    } catch (e: any) {
      toast.error(e.message ?? "Échec du téléversement");
    } finally {
      setUploading(false);
    }
  };

  const save = async (silent = false) => {
    if (!app) return;
    setBusy(true);
    const normalized = normalizeVisaPayload(app);
    const { id: _id, created_at, updated_at, reference, status, user_id, submitted_at, reviewed_at, reviewed_by, admin_notes, ...payload } = normalized;
    const { error } = await supabase.from("visa_applications").update(payload).eq("id", app.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    setApp(normalized);
    if (!silent) toast.success("Enregistré");
  };

  const submitApp = async () => {
    if (!app) return;
    if (!app.consent_truthful || !app.consent_data || !app.consent_disclaimer) {
      return toast.error("Veuillez accepter les déclarations finales.");
    }
    const { validateVisaApplication } = await import("@/lib/visa-pdf");
    const normalizedApp = normalizeVisaPayload(app);
    const missing = validateVisaApplication(normalizedApp);
    if (durationSource === "other" && !manualDurationDays.trim()) {
      missing.push("Nombre de jours");
    }
    if (!app.category) {
      missing.push("Situation professionnelle");
    }
    setMissingFields(missing);
    if (missing.length) {
      return toast.error("Veuillez compléter les champs obligatoires indiqués.");
    }
    const selectedChecklist = findChecklistForSituation(checklists, app.category);
    const checklistItems = selectedChecklist?.items ?? [];
    const snapshot = checklistSnapshotText(checklistItems);
    const checklistPayload = snapshot
      ? `Liste personnalisée des documents à fournir — ${professionalSituationLabel(app.category)}\n${snapshot}`
      : `Liste personnalisée des documents à fournir — ${professionalSituationLabel(app.category)}\nAucune règle active n'est configurée pour cette situation. Notre équipe vous confirmera les documents à fournir.`;
    const appWithChecklist = { ...normalizedApp, requested_documents: checklistPayload };
    setApp(appWithChecklist);
    const { id: _id, created_at, updated_at, reference, status, user_id, submitted_at, reviewed_at, reviewed_by, admin_notes, ...draftPayload } = appWithChecklist;
    await supabase.from("visa_applications").update(draftPayload as any).eq("id", app.id);
    setBusy(true);
    const submittedAt = new Date().toISOString();
    const { error } = await supabase.from("visa_applications")
      .update({ status: "submitted", submitted_at: submittedAt })
      .eq("id", app.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    const submittedApp = { ...appWithChecklist, status: "submitted", submitted_at: submittedAt };
    try {
      const sync = await syncVisaApplicationToClient(app.id);
      if (sync.clientId) submittedApp.client_id = sync.clientId;
    } catch {
      toast.warning("Demande soumise, mais la synchronisation CRM sera finalisée par l'équipe.");
    }
    try {
      const [checklistDoc, procuration] = await Promise.all([
        upsertVisaChecklistDocument(submittedApp, user!.id, checklistItems),
        upsertVisaProcurationDocument(submittedApp, user!.id),
      ]);
      setDocs((current) => [
        checklistDoc,
        procuration,
        ...current.filter((doc) => !isVisaProcurationDocument(doc) && !isVisaChecklistDocument(doc)),
      ]);
    } catch (e) {
      console.warn("generated visa documents failed", e);
      toast.error("Demande soumise, mais les PDF de checklist/procuration n'ont pas pu être générés automatiquement.");
    }
    toast.success("Demande soumise. Notre équipe va l'examiner.");
    setApp(submittedApp);
    trackEvent("visa_form_submitted", { source: "visa_client_form" });
    supabase.functions.invoke("send-visa-email", {
      body: { application_id: app.id, status: "submitted" },
    }).then(({ error: e }) => { if (e) console.warn("notification email failed", e); });
  };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>, doc_type: string) => {
    const file = e.target.files?.[0];
    if (!file || !user || !app) return;
    if (file.size > 10 * 1024 * 1024) return toast.error("Fichier trop volumineux (max 10 Mo)");
    setUploading(true);
    const path = `${user.id}/${app.id}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
    const { error: upErr } = await supabase.storage.from("visa-docs").upload(path, file, { upsert: false });
    if (upErr) { setUploading(false); return toast.error(upErr.message); }
    const { data, error } = await supabase.from("visa_documents").insert({
      application_id: app.id, user_id: user.id,
      doc_type: doc_type as any, storage_path: path,
      file_name: file.name, mime_type: file.type, size_bytes: file.size,
    }).select("*").single();
    setUploading(false);
    if (error) return toast.error(error.message);
    setDocs((d) => [...d, data!]);
    toast.success("Document téléversé");
    e.target.value = "";
  };

  const removeDoc = async (d: any) => {
    if (!confirm("Supprimer ce document ?")) return;
    await supabase.storage.from("visa-docs").remove([d.storage_path]);
    await supabase.from("visa_documents").delete().eq("id", d.id);
    setDocs((arr) => arr.filter((x) => x.id !== d.id));
  };

  const downloadDoc = async (d: any) => {
    const { data, error } = await supabase.storage.from("visa-docs").createSignedUrl(d.storage_path, 60);
    if (error || !data) return toast.error("Lien indisponible");
    window.open(data.signedUrl, "_blank");
  };

  const removeApp = async () => {
    if (!app || isReadOnly) return;
    if (!confirm("Supprimer définitivement cette demande ?")) return;
    await supabase.from("visa_applications").delete().eq("id", app.id);
    nav(`${visaBase}/applications`);
  };

  if (!app) return <div className="container-app py-20 text-center text-muted-foreground">Chargement…</div>;
  const procurationDoc = docs.find(isVisaProcurationDocument);
  const checklistDoc = docs.find(isVisaChecklistDocument);

  const T = (k: string, label: string, type = "text") => (
    <F key={k} label={label}>
      <Input type={type} disabled={isReadOnly} value={app[k] ?? ""} onChange={(e) => upd({ [k]: e.target.value })} />
    </F>
  );

  const selectedDurationTrip = durationSource === "other" ? null : tripOptions.find((trip) => trip.id === durationSource) ?? null;
  const selectedVisaTripDates = visaTripDatesFromTrip(selectedDurationTrip);
  const selectedDurationDays = selectedVisaTripDates.japanStayDays;
  const selectedDurationUsesFallback = isJapanStayFallback(selectedDurationTrip);
  const selectedChecklist = findChecklistForSituation(checklists, app.category);
  const selectedChecklistItems = selectedChecklist?.items ?? [];
  const previousJapanStay = parsePreviousJapanStay(app.previous_stays);
  const isRetiredApplicant = isRetiredVisaCategory(app.category);

  return (
    <div className="container-app py-10 max-w-5xl" data-clarity-mask="true">
      <Seo title={`Demande de visa ${app.reference} — lejapon.ma`} description="Préparez votre formulaire de visa Japon." canonical={`${visaBase}/formulaire/${app.id}`} />
      <button onClick={() => nav(`${visaBase}/applications`)} className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1">
        <ArrowLeft className="w-4 h-4" /> Mes demandes
      </button>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-3xl mb-1">Formulaire de visa Japon</h1>
          <p className="text-sm text-muted-foreground">Référence <strong>{app.reference}</strong></p>
        </div>
        <Badge>{STATUS_LABEL[app.status]}</Badge>
      </div>

      {!isReadOnly && (
        <div className="sticky top-0 z-30 -mx-5 md:-mx-8 lg:-mx-12 px-5 md:px-8 lg:px-12 py-3 mb-6 bg-background/85 backdrop-blur border-b border-border">
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Progression du dossier
            </p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {progress >= 100 && <CheckCircle2 className="w-4 h-4 text-[hsl(var(--success))]" />}
              <span><strong className="text-foreground">{progress}%</strong> complété</span>
              {autoSaveAt && <span className="hidden sm:inline">· Brouillon enregistré {autoSaveAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
            </div>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      )}

      {isReadOnly && (
        <Card className="p-5 mb-6 border-accent/40 bg-accent/5">
          <p className="text-sm font-semibold mb-2">✅ Votre demande a été soumise</p>
          <ol className="text-sm text-muted-foreground space-y-1 list-decimal pl-5 mb-3">
            <li>Téléchargez les documents PDF générés ci-dessous.</li>
            <li>Merci de signer et légaliser cette procuration, puis de la joindre aux documents à nous envoyer.</li>
            <li>Joignez les documents originaux et copies demandés à votre dossier.</li>
            <li><strong>Envoyez vos documents originaux à notre agence</strong> (passeport, photo, justificatifs) — adresse communiquée par email.</li>
            <li>Notre équipe vous tiendra informé(e) à chaque étape (documents reçus, dépôt à l'ambassade, décision).</li>
          </ol>
          {checklistDoc && (
            <Button type="button" variant="outline" className="mb-3 mr-2 min-h-11" onClick={() => downloadDoc(checklistDoc)}>
              <Download className="w-4 h-4" /> Télécharger la liste des documents
            </Button>
          )}
          {procurationDoc && (
            <Button type="button" variant="outline" className="mb-3 min-h-11" onClick={() => downloadDoc(procurationDoc)}>
              <Download className="w-4 h-4" /> Télécharger la procuration
            </Button>
          )}
          <p className="text-xs text-muted-foreground">Statut actuel&nbsp;: <strong>{STATUS_LABEL[app.status]}</strong></p>
        </Card>
      )}

      {app.requested_documents && (
        <Card className="p-4 mb-6 border-accent/40 bg-accent/5">
          <p className="text-sm font-semibold mb-1">Documents attendus pour votre dossier</p>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{app.requested_documents}</p>
          <p className="text-xs text-muted-foreground mt-2">Téléversez-les dans la section « Documents » ci-dessous.</p>
        </Card>
      )}

      {!isReadOnly && missingFields.length > 0 && (
        <Alert className="mb-6 border-destructive/40 bg-destructive/5">
          <AlertTitle>Champs obligatoires à compléter</AlertTitle>
          <AlertDescription>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {missingFields.map((field) => (
                <li key={field}>{field}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Identity */}
      <Card className="p-6 mb-6">
        <h2 className="font-display text-xl mb-4">Identité</h2>
        <p className="text-xs text-muted-foreground mb-4 inline-flex items-start gap-2">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-accent" />
          Saisissez vos informations <strong className="text-foreground mx-1">exactement comme sur votre passeport</strong> (caractères latins, sans accents).
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          {T("surname", "Nom (comme sur le passeport) *")}
          {T("given_names", "Prénom(s) *")}
          {T("other_names", "Autres noms / alias (le cas échéant)")}
          {T("date_of_birth", "Date de naissance *", "date")}
          {T("place_of_birth_city", "Ville de naissance *")}
          {T("place_of_birth_state", "Région / Province *")}
          {T("place_of_birth_country", "Pays de naissance *")}
          {T("nationality", "Nationalité *")}
          {T("former_nationality", "Nationalité antérieure (Optionnel)")}
          {T("national_id_no", "N° pièce d'identité *")}
          <F label={requiredLabel("Sexe")}>
            <RadioGroup disabled={isReadOnly} value={app.sex ?? ""} onValueChange={(v) => upd({ sex: v })} className="flex gap-4 mt-2">
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="male" /> Homme</label>
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="female" /> Femme</label>
            </RadioGroup>
          </F>
          <F label={requiredLabel("État civil")}>
            <RadioGroup disabled={isReadOnly} value={app.marital_status ?? ""} onValueChange={(v) => upd({ marital_status: v })} className="flex flex-wrap gap-3 mt-2">
              {[["single","Célibataire"],["married","Marié(e)"],["widowed","Veuf(ve)"],["divorced","Divorcé(e)"]].map(([v,l]) => (
                <label key={v} className="flex items-center gap-2 text-sm"><RadioGroupItem value={v} /> {l}</label>
              ))}
            </RadioGroup>
          </F>
        </div>
      </Card>

      {/* Passport */}
      <Card className="p-6 mb-6">
        <h2 className="font-display text-xl mb-4">Passeport</h2>
        <p className="text-xs text-muted-foreground mb-4 inline-flex items-start gap-2">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-accent" />
          Le passeport doit être <strong className="text-foreground mx-1">valide au moins 6 mois</strong> après la date de retour prévue.
        </p>
        {!isReadOnly && (
          <div className="mb-4 rounded-lg border border-accent/30 bg-accent/5 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold">Préremplissage par OCR</p>
                <p className="text-xs text-muted-foreground">Uploadez une image ou un PDF du passeport, corrigez les champs détectés, puis appliquez-les au formulaire.</p>
              </div>
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setPassportScannerOpen(true)}>
                <FileScan className="w-4 h-4" /> Scanner passeport
              </Button>
            </div>
          </div>
        )}
        <div className="grid md:grid-cols-2 gap-4">
          <F label={requiredLabel("Type de passeport")}>
            <RadioGroup disabled={isReadOnly} value={app.passport_type ?? "ordinary"} onValueChange={(v) => upd({ passport_type: v })} className="flex flex-wrap gap-3 mt-2">
              {[["diplomatic","Diplomatique"],["official","Officiel"],["ordinary","Ordinaire"],["other","Autre"]].map(([v,l]) => (
                <label key={v} className="flex items-center gap-2 text-sm"><RadioGroupItem value={v} /> {l}</label>
              ))}
            </RadioGroup>
          </F>
          <F label={requiredLabel("Numéro de passeport")}>
            <div className="flex gap-2">
              <Input
                value={app.passport_no ?? ""}
                disabled={isReadOnly}
                autoCapitalize="characters"
                onChange={(event) => upd({ passport_no: event.target.value })}
                onBlur={() => lookupPassportFromForm(false)}
              />
              {!isReadOnly && (
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => lookupPassportFromForm(true)}
                  disabled={passportLookupBusy || !app.passport_no}
                  title="Rechercher dans le CRM"
                >
                  <Search className="h-4 w-4" />
                </Button>
              )}
            </div>
            {!isReadOnly && (
              <p className="mt-1 text-xs text-muted-foreground">
                Recherche CRM automatique après saisie du numéro.
              </p>
            )}
          </F>
          {T("passport_place_of_issue", "Lieu de délivrance *")}
          {T("passport_date_of_issue", "Date de délivrance *", "date")}
          {T("passport_issuing_authority", "Autorité de délivrance *")}
          {T("passport_date_of_expiry", "Date d'expiration *", "date")}
          {T("certificate_of_eligibility_no", "N° Certificat d'éligibilité (le cas échéant)")}
        </div>
      </Card>

      {/* Travel */}
      <Card className="p-6 mb-6">
        <h2 className="font-display text-xl mb-4">Voyage</h2>
        <p className="text-xs text-muted-foreground mb-4 inline-flex items-start gap-2">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-accent" />
          Les informations de vol, d'arrivée et d'hôtel sont préparées par notre équipe à partir de votre voyage.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          {T("purpose_of_visit", "Motif du séjour *")}
          <F label={requiredLabel("Durée prévue du séjour")}>
            <Select disabled={isReadOnly} value={durationSource} onValueChange={selectDurationSource}>
              <SelectTrigger className="min-h-11">
                <SelectValue placeholder="Sélectionner une durée" />
              </SelectTrigger>
              <SelectContent>
                {tripOptions.map((trip) => (
                  <SelectItem key={trip.id} value={trip.id}>
                    {[trip.title, formatVisaDate(trip.start_date), japanStayDaysFromTrip(trip) ? `Japon ${japanStayDaysFromTrip(trip)} jours` : null].filter(Boolean).join(" · ")}
                  </SelectItem>
                ))}
                <SelectItem value="other">Autre</SelectItem>
              </SelectContent>
            </Select>
            {selectedDurationTrip && (
              <p className="mt-1 text-xs text-muted-foreground">
                Prérempli selon les dates de votre voyage LeJapon.ma : arrivée Japon {formatVisaDate(selectedVisaTripDates.japanArrivalDate)}, départ Japon {formatVisaDate(selectedVisaTripDates.japanDepartureDate)}, séjour {selectedDurationDays ? `${selectedDurationDays} jours` : "à compléter"}.
              </p>
            )}
            {selectedDurationTrip && selectedDurationUsesFallback && (
              <p className="mt-1 text-xs text-amber-700">
                Le nombre de jours au Japon n'est pas encore renseigné sur ce voyage. La durée est estimée depuis les dates ou l'ancienne durée.
              </p>
            )}
          </F>
          {durationSource === "other" && (
            <F label={requiredLabel("Nombre de jours")}>
              <Input
                type="number"
                min="1"
                disabled={isReadOnly}
                value={manualDurationDays}
                onChange={(e) => updateManualDuration(e.target.value)}
              />
            </F>
          )}
          {selectedDurationTrip && (
            <>
              <F label={requiredLabel("Date d'arrivée au Japon")}>
                <Input
                  type="date"
                  disabled={isReadOnly}
                  value={app.date_of_arrival ?? ""}
                  onChange={(e) => upd({ date_of_arrival: e.target.value })}
                />
              </F>
              <F label="Date de départ du Japon">
                <Input type="date" disabled value={selectedVisaTripDates.japanDepartureDate ?? ""} />
              </F>
            </>
          )}
          <F label={requiredLabel("Avez-vous déjà séjourné au Japon ?")}>
            <RadioGroup
              disabled={isReadOnly}
              value={previousJapanStay.hasPrevious}
              onValueChange={(value) => updatePreviousJapanStay({ hasPrevious: value as "yes" | "no" })}
              className="flex gap-4 mt-2"
            >
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="yes" /> Oui</label>
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="no" /> Non</label>
            </RadioGroup>
          </F>
          {previousJapanStay.hasPrevious === "yes" && (
            <>
              <F label="Date du dernier séjour au Japon">
                <Input
                  type="date"
                  disabled={isReadOnly}
                  value={previousJapanStay.lastStayDate}
                  onChange={(event) => updatePreviousJapanStay({ lastStayDate: event.target.value })}
                />
              </F>
              <F label="Nombre de séjours précédents (Optionnel)">
                <Input
                  type="number"
                  min="1"
                  disabled={isReadOnly}
                  value={previousJapanStay.stayCount}
                  onChange={(event) => updatePreviousJapanStay({ stayCount: event.target.value })}
                />
              </F>
            </>
          )}
        </div>
      </Card>

      {/* Residence + Profession */}
      <Card className="p-6 mb-6">
        <h2 className="font-display text-xl mb-4">Résidence, profession et école</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2">{T("residential_address", "Adresse de résidence *")}</div>
          {T("residential_tel", "Téléphone fixe *")}
          {T("residential_mobile", "Mobile *")}
          {T("residential_email", "Email *", "email")}
          <F label={requiredLabel("Situation professionnelle")}>
            <Select disabled={isReadOnly} value={app.category ?? ""} onValueChange={updateProfessionalSituation}>
              <SelectTrigger className="min-h-11">
                <SelectValue placeholder="Sélectionner votre situation" />
              </SelectTrigger>
              <SelectContent>
                {PROFESSIONAL_SITUATIONS.map((situation) => (
                  <SelectItem key={situation.value} value={situation.value}>{situation.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </F>
          {T("profession", "Profession / activité exacte *")}
          {T("partner_profession", "Profession du conjoint / parents, si mineur (Optionnel)")}
          {isRetiredApplicant && (
            <Alert className="md:col-span-2">
              <AlertTitle>Retraité</AlertTitle>
              <AlertDescription>{RETIRED_NOT_APPLICABLE}</AlertDescription>
            </Alert>
          )}
          <F label={isRetiredApplicant ? "Nom de l'employeur ou de l'école si étudiant" : requiredLabel("Nom de l'employeur ou de l'école si étudiant")}>
            <Input
              disabled={isReadOnly || isRetiredApplicant}
              value={isRetiredApplicant ? RETIRED_NOT_APPLICABLE : app.employer_name ?? ""}
              onChange={(event) => upd({ employer_name: event.target.value })}
            />
          </F>
          <F label={isRetiredApplicant ? "Téléphone de l'employeur ou de l'école si étudiant" : requiredLabel("Téléphone de l'employeur ou de l'école si étudiant")}>
            <Input
              disabled={isReadOnly || isRetiredApplicant}
              value={isRetiredApplicant ? RETIRED_NOT_APPLICABLE : app.employer_tel ?? ""}
              onChange={(event) => upd({ employer_tel: event.target.value })}
            />
          </F>
          <F label={isRetiredApplicant ? "Adresse de l'employeur ou de l'école si étudiant" : requiredLabel("Adresse de l'employeur ou de l'école si étudiant")}>
            <Input
              disabled={isReadOnly || isRetiredApplicant}
              value={isRetiredApplicant ? RETIRED_NOT_APPLICABLE : app.employer_address ?? ""}
              onChange={(event) => upd({ employer_address: event.target.value })}
            />
          </F>
        </div>
      </Card>

      <Card className="p-6 mb-6">
        <h2 className="font-display text-xl mb-3">Documents à préparer selon votre situation</h2>
        {!app.category ? (
          <p className="text-sm text-muted-foreground">Sélectionnez votre situation professionnelle pour voir la liste des documents à préparer.</p>
        ) : selectedChecklistItems.length === 0 ? (
          <Alert>
            <AlertTitle>Liste à confirmer</AlertTitle>
            <AlertDescription>
              Aucune règle active n'est configurée pour « {professionalSituationLabel(app.category)} ». Notre équipe vous confirmera les documents à fournir.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-2">
            {selectedChecklistItems.map((item, index) => (
              <div key={item.id ?? index} className="rounded-lg border border-border p-3">
                <p className="text-sm font-semibold">{item.title_fr}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {[
                    item.required ? "Obligatoire" : "Le cas échéant",
                    item.original_required ? "original requis" : null,
                    item.copy_upload_required ? "copie / scan requis" : null,
                  ].filter(Boolean).join(" · ")}
                </p>
                {item.notes && <p className="mt-2 text-xs text-muted-foreground">{item.notes}</p>}
              </div>
            ))}
            <p className="text-xs text-muted-foreground">Téléversez les copies dans la section « Documents » et envoyez les originaux à notre agence.</p>
          </div>
        )}
      </Card>

      {/* Declarations */}
      <Card className="p-6 mb-6">
        <h2 className="font-display text-xl mb-4">Déclarations</h2>
        <p className="text-xs text-muted-foreground mb-4">Cochez « Oui » uniquement si la situation s'applique. Sinon laissez « Non ».</p>
        <div className="space-y-3">
          {[
            ["q_convicted_crime", "Avez-vous été condamné(e) pour un crime ou délit ?"],
            ["q_imprisoned_1y", "Avez-vous été condamné(e) à une peine d'emprisonnement d'1 an ou plus ?"],
            ["q_deported", "Avez-vous été déporté(e) ou expulsé(e) du Japon ou de tout autre pays ?"],
            ["q_drug_offence", "Avez-vous été condamné(e) pour une infraction liée à la drogue ?"],
            ["q_prostitution", "Avez-vous été impliqué(e) dans la prostitution ou son intermédiation ?"],
            ["q_trafficking", "Avez-vous commis ou aidé à commettre la traite des êtres humains ?"],
          ].map(([k, label]) => (
            <div key={k} className="flex items-center justify-between gap-4 py-2 border-b border-border/40">
              <p className="text-sm flex-1">{label}</p>
              <RadioGroup disabled={isReadOnly} value={app[k] ? "yes" : "no"} onValueChange={(v) => upd({ [k]: v === "yes" })} className="flex gap-3">
                <label className="flex items-center gap-1.5 text-sm"><RadioGroupItem value="no" /> Non</label>
                <label className="flex items-center gap-1.5 text-sm"><RadioGroupItem value="yes" /> Oui</label>
              </RadioGroup>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <Label className="text-xs">Précisions (si « Oui » à une question)</Label>
          <Textarea disabled={isReadOnly} value={app.declarations_details ?? ""} onChange={(e) => upd({ declarations_details: e.target.value })} rows={3} />
        </div>
        <div className="mt-4">
          <Label className="text-xs">Remarques / circonstances particulières</Label>
          <Textarea disabled={isReadOnly} value={app.remarks ?? ""} onChange={(e) => upd({ remarks: e.target.value })} rows={3} />
        </div>
      </Card>

      {/* Documents */}
      <Card className="p-6 mb-6">
        <h2 className="font-display text-xl mb-2">Documents</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Vous pouvez téléverser le scan de votre passeport ou tout document complémentaire maintenant, ou l'envoyer plus tard à notre équipe. PDF, JPG ou PNG, 10 Mo max.
        </p>
        {isReadOnly && canUploadMore && (
          <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 mb-4 text-sm text-muted-foreground">
            Vous pouvez toujours ajouter des documents complémentaires demandés par notre équipe.
          </div>
        )}
        <div className="space-y-2 mb-4">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 p-3 border border-border rounded-lg">
              <div className="flex items-center gap-3 min-w-0">
                <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{d.file_name}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {isVisaChecklistDocument(d) ? "Liste des documents générée" : isVisaProcurationDocument(d) ? "Procuration générée · à signer et légaliser" : d.doc_type}
                  </p>
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button size="sm" variant="ghost" onClick={() => downloadDoc(d)}><Download className="w-4 h-4" /></Button>
                {!isReadOnly && <Button size="sm" variant="ghost" onClick={() => removeDoc(d)}><Trash2 className="w-4 h-4" /></Button>}
              </div>
            </div>
          ))}
        </div>
        {canUploadMore && (
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex">
              <input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => onUpload(e, "passport")} disabled={uploading} />
              <span className="btn-primary !py-2 !px-4 text-sm cursor-pointer inline-flex items-center gap-2"><Upload className="w-4 h-4" /> Passeport</span>
            </label>
            <button
              type="button"
              onClick={() => setPhotoDialogOpen(true)}
              disabled={uploading}
              className="px-4 py-2 text-sm border border-border rounded-md inline-flex items-center gap-2 hover:bg-secondary disabled:opacity-60"
            >
              <Camera className="w-4 h-4" /> Photo d'identité (auto-format)
            </button>
            <label className="inline-flex">
              <input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => onUpload(e, "other")} disabled={uploading} />
              <span className="px-4 py-2 text-sm border border-border rounded-md cursor-pointer inline-flex items-center gap-2 hover:bg-secondary"><Upload className="w-4 h-4" /> Autre document</span>
            </label>
          </div>
        )}
      </Card>

      {/* Final consents */}
      {!isReadOnly && (
        <Card className="p-6 mb-6">
          <h2 className="font-display text-xl mb-4">Validation finale</h2>
          <div className="rounded-lg border border-amber-300/60 bg-amber-50 dark:bg-amber-950/20 p-4 mb-4 text-sm">
            <p className="font-semibold mb-1">⚠️ Avis important</p>
            <p className="text-muted-foreground">
              L'agence vous accompagne dans la préparation et le dépôt de votre demande de visa, mais
              <strong> ne garantit en aucun cas l'obtention du visa</strong>. La décision finale relève
              exclusivement des autorités consulaires japonaises. Aucun remboursement des frais de service
              ne pourra être réclamé en cas de refus.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-secondary/30 p-4 mb-4 text-xs text-muted-foreground space-y-2">
            <p className="font-semibold text-foreground text-sm">Protection de vos données personnelles (RGPD)</p>
            <p>
              Conformément au Règlement Général sur la Protection des Données (RGPD) et à la loi marocaine 09-08,
              les informations recueillies font l'objet d'un traitement informatique destiné exclusivement à
              l'instruction de votre demande de visa par LeJapon.ma (Moroccan Express Travel & Events) et sa transmission à
              l'ambassade ou au consulat du Japon.
            </p>
            <p>
              <strong>Destinataires :</strong> personnel autorisé de lejapon.ma et autorités consulaires japonaises.
              <br />
              <strong>Durée de conservation :</strong> 3 ans à compter de la dernière interaction, puis archivage légal.
              <br />
              <strong>Vos droits :</strong> accès, rectification, effacement, portabilité, opposition et limitation du
              traitement. Pour exercer ces droits, contactez-nous à <a href="mailto:contact@lejapon.ma" className="underline">contact@lejapon.ma</a>.
            </p>
          </div>
          <label className="flex items-start gap-3 mb-3 text-sm">
            <input type="checkbox" className="mt-1" checked={!!app.consent_truthful} onChange={(e) => upd({ consent_truthful: e.target.checked })} />
            <span>Je déclare que les informations ci-dessus sont exactes et complètes.</span>
          </label>
          <label className="flex items-start gap-3 mb-3 text-sm">
            <input type="checkbox" className="mt-1" checked={!!app.consent_data} onChange={(e) => upd({ consent_data: e.target.checked })} />
            <span>J'autorise lejapon.ma à collecter, traiter et transmettre ces informations à l'ambassade / consulat du Japon dans le cadre du traitement de ma demande, conformément à la politique de confidentialité (RGPD).</span>
          </label>
          <label className="flex items-start gap-3 mb-3 text-sm">
            <input type="checkbox" className="mt-1" checked={!!app.consent_disclaimer} onChange={(e) => upd({ consent_disclaimer: e.target.checked })} />
            <span>Je reconnais avoir lu et compris que <strong>l'agence assiste à la préparation de ma demande de visa mais ne garantit pas son approbation</strong> par les autorités consulaires japonaises.</span>
          </label>
          <div className="mt-4">
            {T("date_of_application", "Date de la demande *", "date")}
          </div>
        </Card>
      )}

      {/* Desktop action bar */}
      <div className="hidden md:flex flex-wrap gap-3 justify-end pb-4">
        {!isReadOnly && <Button variant="outline" onClick={removeApp}><Trash2 className="w-4 h-4" /> Supprimer</Button>}
        {!isReadOnly && <Button variant="outline" onClick={() => save(false)} disabled={busy}><Save className="w-4 h-4" /> Enregistrer</Button>}
        {!isReadOnly && <Button onClick={submitApp} disabled={busy}><Send className="w-4 h-4" /> Soumettre la demande</Button>}
      </div>

      {/* Mobile sticky action bar */}
      <div className="md:hidden h-24" aria-hidden />
      <div className="md:hidden fixed inset-x-0 bottom-0 z-40 bg-background/95 backdrop-blur border-t border-border px-4 py-3 safe-area-inset-bottom">
        {!isReadOnly && (
          <div className="flex items-center justify-between mb-2 text-xs text-muted-foreground">
            <span><strong className="text-foreground">{progress}%</strong> complété</span>
            {autoSaveAt && <span>Enregistré {autoSaveAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
          </div>
        )}
        <div className="flex gap-2">
          {!isReadOnly && (
            <>
              <Button variant="outline" size="sm" className="flex-1" onClick={() => save(false)} disabled={busy}>
                <Save className="w-4 h-4" /> Sauver
              </Button>
              <Button size="sm" className="flex-1" onClick={submitApp} disabled={busy}>
                <Send className="w-4 h-4" /> Soumettre
              </Button>
            </>
          )}
        </div>
      </div>

      <PassportPhotoDialog
        open={photoDialogOpen}
        onOpenChange={setPhotoDialogOpen}
        onConfirm={confirmPhotoUpload}
      />
      <PassportScannerDialog
        open={passportScannerOpen}
        onOpenChange={setPassportScannerOpen}
        currentPath={passportScanPath}
        bucket="visa-docs"
        onStoredPathChange={setPassportScanPath}
        onApply={applyPassportOcrToVisa}
      />
    </div>
  );
}
