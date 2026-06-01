import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, CheckCircle2, FileCheck2, Loader2, Save, Send, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { fmtDateTime } from "@/lib/format";
import { useAgencyContext } from "../useAgencyContext";

type DbClient = { from: (table: string) => any };
const db = supabase as unknown as DbClient;

type OnboardingStatus = "awaiting_documents" | "under_review" | "approved" | "rejected" | "draft" | string;
type DocumentType = "company_registration" | "tax_certificate" | "id_passport" | "bank_certificate";

type OnboardingCase = {
  id: string;
  organization_id: string;
  status: OnboardingStatus;
  form_data?: Record<string, any> | null;
  metadata: Record<string, any> | null;
  created_at: string | null;
  updated_at: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
};

type AgencyInfo = {
  legal_name: string;
  commercial_name: string;
  registration_number: string;
  tax_number: string;
  website: string;
  address: string;
  city: string;
  country: string;
};

type ContactPerson = {
  full_name: string;
  position: string;
  email: string;
  phone: string;
};

type DocumentMeta = {
  document_type: DocumentType;
  file_name: string;
  file_path: string;
  uploaded_at: string;
  status?: string | null;
};

type OnboardingMetadata = {
  agency_information: AgencyInfo;
  contact_person: ContactPerson;
  documents: Partial<Record<DocumentType, DocumentMeta>>;
  digital_signature_acknowledged: boolean;
  digital_signature_acknowledged_at: string | null;
};

type OnboardingFormState = {
  agency_information: AgencyInfo;
  contact_person: ContactPerson;
  digital_signature_acknowledged: boolean;
  digital_signature_acknowledged_at: string | null;
};

const DOCUMENT_LABELS: Record<DocumentType, string> = {
  company_registration: "Company registration",
  tax_certificate: "Tax certificate",
  id_passport: "ID / passport",
  bank_certificate: "Bank certificate",
};

const emptyAgencyInfo = (): AgencyInfo => ({
  legal_name: "",
  commercial_name: "",
  registration_number: "",
  tax_number: "",
  website: "",
  address: "",
  city: "",
  country: "",
});

const emptyContact = (): ContactPerson => ({
  full_name: "",
  position: "",
  email: "",
  phone: "",
});

const emptyMetadata = (): OnboardingMetadata => ({
  agency_information: emptyAgencyInfo(),
  contact_person: emptyContact(),
  documents: {},
  digital_signature_acknowledged: false,
  digital_signature_acknowledged_at: null,
});

const emptyFormState = (): OnboardingFormState => ({
  agency_information: emptyAgencyInfo(),
  contact_person: emptyContact(),
  digital_signature_acknowledged: false,
  digital_signature_acknowledged_at: null,
});

const clean = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizeMetadata = (metadata: Record<string, any> | null | undefined): OnboardingMetadata => {
  const fallback = emptyMetadata();
  const agency = metadata?.agency_information ?? metadata?.agencyInfo ?? {};
  const contact = metadata?.contact_person ?? metadata?.contactPerson ?? {};
  return {
    agency_information: {
      legal_name: clean(agency.legal_name),
      commercial_name: clean(agency.commercial_name),
      registration_number: clean(agency.registration_number),
      tax_number: clean(agency.tax_number),
      website: clean(agency.website),
      address: clean(agency.address),
      city: clean(agency.city),
      country: clean(agency.country),
    },
    contact_person: {
      full_name: clean(contact.full_name),
      position: clean(contact.position),
      email: clean(contact.email),
      phone: clean(contact.phone),
    },
    documents: metadata?.documents ?? fallback.documents,
    digital_signature_acknowledged: Boolean(metadata?.digital_signature_acknowledged),
    digital_signature_acknowledged_at: metadata?.digital_signature_acknowledged_at ?? null,
  };
};

const normalizeDocumentRows = (rows: any[] | null | undefined): Partial<Record<DocumentType, DocumentMeta>> => {
  const documents: Partial<Record<DocumentType, DocumentMeta>> = {};
  for (const row of rows ?? []) {
    const type = row?.document_type as DocumentType | undefined;
    if (!type || documents[type]) continue;
    documents[type] = {
      document_type: type,
      file_name: row.file_name ?? "",
      file_path: row.file_path ?? row.storage_path ?? "",
      uploaded_at: row.created_at ?? row.uploaded_at ?? new Date().toISOString(),
      status: row.status ?? "received",
    };
  }
  return documents;
};

const formStateFromMetadata = (metadata: OnboardingMetadata): OnboardingFormState => ({
  agency_information: metadata.agency_information,
  contact_person: metadata.contact_person,
  digital_signature_acknowledged: metadata.digital_signature_acknowledged,
  digital_signature_acknowledged_at: metadata.digital_signature_acknowledged_at,
});

const buildMetadata = (
  formState: OnboardingFormState,
  documents: Partial<Record<DocumentType, DocumentMeta>>
): OnboardingMetadata => ({
  agency_information: formState.agency_information,
  contact_person: formState.contact_person,
  documents,
  digital_signature_acknowledged: formState.digital_signature_acknowledged,
  digital_signature_acknowledged_at: formState.digital_signature_acknowledged_at,
});

const buildFormData = (
  existingFormData: Record<string, any> | null | undefined,
  formState: OnboardingFormState,
  documents: Partial<Record<DocumentType, DocumentMeta>>
) => ({
  ...(existingFormData && typeof existingFormData === "object" ? existingFormData : {}),
  agency_information: formState.agency_information,
  contact_person: formState.contact_person,
  documents,
  digital_signature_acknowledged: formState.digital_signature_acknowledged,
  digital_signature_acknowledged_at: formState.digital_signature_acknowledged_at,
});

const buildCompleteFormData = (
  existingFormData: Record<string, any> | null | undefined,
  formState: OnboardingFormState,
  documents: Partial<Record<DocumentType, DocumentMeta>>
) => ({
  ...(existingFormData && typeof existingFormData === "object" ? existingFormData : {}),
  agency_information: {
    legal_name: formState.agency_information.legal_name,
    commercial_name: formState.agency_information.commercial_name,
    registration_number: formState.agency_information.registration_number,
    tax_number: formState.agency_information.tax_number,
    website: formState.agency_information.website,
    address: formState.agency_information.address,
    city: formState.agency_information.city,
    country: formState.agency_information.country,
  },
  contact_person: {
    full_name: formState.contact_person.full_name,
    position: formState.contact_person.position,
    email: formState.contact_person.email,
    phone: formState.contact_person.phone,
  },
  documents,
  digital_signature_acknowledged: formState.digital_signature_acknowledged,
  digital_signature_acknowledged_at: formState.digital_signature_acknowledged_at,
});

const sectionComplete = (values: Record<string, string>, required: string[]) =>
  required.every((key) => values[key]?.trim().length > 0);

const statusLabel = (status: string) =>
  ({
    draft: "Brouillon",
    awaiting_documents: "Documents attendus",
    under_review: "En revue",
    submitted: "Soumis",
    approved: "Approuvé",
    rejected: "Rejeté",
  })[status] ?? status;

const statusClass = (status: string) =>
  ({
    approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
    under_review: "border-sky-200 bg-sky-50 text-sky-700",
    submitted: "border-sky-200 bg-sky-50 text-sky-700",
    rejected: "border-destructive/30 bg-destructive/10 text-destructive",
    awaiting_documents: "border-amber-200 bg-amber-50 text-amber-800",
    draft: "border-muted bg-secondary text-muted-foreground",
  })[status] ?? "border-border";

const READ_ONLY_STATUSES = new Set(["under_review", "submitted", "approved", "rejected"]);

export default function AgencyOnboarding() {
  const { user } = useAuth();
  const { organization } = useAgencyContext();
  const [caseRow, setCaseRow] = useState<OnboardingCase | null>(null);
  const [formState, setFormState] = useState<OnboardingFormState>(emptyFormState);
  const [documents, setDocuments] = useState<Partial<Record<DocumentType, DocumentMeta>>>({});
  const [savedCaseData, setSavedCaseData] = useState<OnboardingCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<DocumentType | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [savedDocumentRows, setSavedDocumentRows] = useState<Record<string, any>[]>([]);
  const [saveDebug, setSaveDebug] = useState<Record<string, any> | null>(null);
  const formStateRef = useRef(formState);
  const documentsRef = useRef(documents);
  const caseRowRef = useRef<OnboardingCase | null>(caseRow);
  const fileInputRefs = useRef<Partial<Record<DocumentType, HTMLInputElement | null>>>({});

  useEffect(() => {
    formStateRef.current = formState;
  }, [formState]);

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  useEffect(() => {
    caseRowRef.current = caseRow;
  }, [caseRow]);

  const metadata = useMemo(() => buildMetadata(formState, documents), [formState, documents]);

  const applyMetadata = (nextMetadata: OnboardingMetadata) => {
    setFormState(formStateFromMetadata(nextMetadata));
    setDocuments(nextMetadata.documents);
  };

  const load = async () => {
    if (!organization) return;
    setLoading(true);
    setError(null);
    setDuplicateWarning(null);

    const { data, error } = await db
      .from("partner_onboarding_cases")
      .select("*")
      .eq("organization_id", organization.id)
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(5);

    if (error) {
      setError(error.message);
      setCaseRow(null);
      setSavedCaseData(null);
    } else {
      const rows = (data ?? []) as OnboardingCase[];
      if (rows.length > 1) {
        setDuplicateWarning(
          `${rows.length} dossiers d'onboarding existent pour cette organisation. Le plus récent est utilisé; demandez à l'équipe interne de nettoyer les doublons.`
        );
      }
      const row = rows[0] ?? null;
      let documentRows: any[] = [];
      if (row?.id) {
        const docsResult = await db
          .from("partner_onboarding_documents")
          .select("*")
          .eq("onboarding_case_id", row.id)
          .order("created_at", { ascending: false, nullsFirst: false });
        if (!docsResult.error) documentRows = docsResult.data ?? [];
      }
      console.log("[agency/onboarding diagnostic]", {
        query: {
          case:
            "partner_onboarding_cases.select(*).eq(organization_id).order(created_at desc).limit(5)",
          documents:
            "partner_onboarding_documents.select(*).eq(onboarding_case_id).order(created_at desc)",
        },
        onboarding_case: row,
        form_data: row?.form_data ?? null,
        partner_onboarding_documents: documentRows,
      });
      setCaseRow(row);
      setSavedCaseData(row);
      setSavedDocumentRows(documentRows);
      const nextMetadata = normalizeMetadata(row?.form_data ?? row?.metadata);
      nextMetadata.documents = {
        ...nextMetadata.documents,
        ...normalizeDocumentRows(documentRows),
      };
      applyMetadata(nextMetadata);
      setEditMode(!row || !READ_ONLY_STATUSES.has(String(row.status)));
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [organization?.id]);

  const completedSections = useMemo(() => {
    const agencyDone = sectionComplete(metadata.agency_information, [
      "legal_name",
      "commercial_name",
      "registration_number",
      "tax_number",
      "address",
      "city",
      "country",
    ]);
    const contactDone = sectionComplete(metadata.contact_person, ["full_name", "position", "email", "phone"]);
    const documentsDone = (Object.keys(DOCUMENT_LABELS) as DocumentType[]).every((type) => metadata.documents[type]?.file_path);
    const signatureDone = metadata.digital_signature_acknowledged;
    return [agencyDone, contactDone, documentsDone, signatureDone].filter(Boolean).length;
  }, [metadata]);

  const progress = completedSections * 25;
  const lockedStatus = READ_ONLY_STATUSES.has(String(caseRow?.status));
  const isApproved = caseRow?.status === "approved";
  const isSubmitted = lockedStatus;
  const isLocked = isSubmitted && !editMode;
  const lockedFieldClass = isLocked ? "bg-muted text-muted-foreground opacity-80" : "";

  const refetchCase = async (caseId?: string | null) => {
    if (!organization) return false;
    const request = caseId
      ? db
          .from("partner_onboarding_cases")
          .select("*")
          .eq("id", caseId)
          .maybeSingle()
      : db
          .from("partner_onboarding_cases")
          .select("*")
          .eq("organization_id", organization.id)
          .order("created_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();
    const { data, error } = await request;
    if (error || !data) return false;
    const nextCase = data as OnboardingCase;
    setCaseRow(nextCase);
    setSavedCaseData(nextCase);
    caseRowRef.current = nextCase;
    return true;
  };

  const updateCase = async (nextStatus?: string) => {
    if (!organization) return false;
    const currentCase = caseRowRef.current;
    const completeFormData = buildCompleteFormData(
      (currentCase?.form_data ?? savedCaseData?.form_data) as Record<string, any> | null | undefined,
      formStateRef.current,
      documentsRef.current
    );
    const nextCaseStatus = nextStatus ?? (currentCase?.status === "draft" || !currentCase ? "awaiting_documents" : currentCase.status);
    const payload: Record<string, unknown> = {
      form_data: completeFormData,
      status: nextCaseStatus,
      ...(nextStatus === "under_review" ? { submitted_at: new Date().toISOString() } : {}),
    };

    const startedDebug = {
      target: currentCase
        ? `partner_onboarding_cases.update(payload).eq("id", "${currentCase.id}")`
        : "partner_onboarding_cases.insert({ organization_id, ...payload })",
      payload,
      complete_form_data: completeFormData,
      current_form_state: formStateRef.current,
      existing_form_data: currentCase?.form_data ?? null,
      update_response_data: null,
      update_error: null,
      update_status: null,
      update_status_text: null,
      update_count: null,
      affected_row: null,
      no_row_updated_message: null,
      select_after_update_data: null,
      select_after_update_error: null,
      select_after_update_status: null,
      select_after_update_status_text: null,
    };
    console.log("[agency/onboarding save diagnostic]", startedDebug);
    setSaveDebug(startedDebug);

    const request = currentCase
      ? db
          .from("partner_onboarding_cases")
          .update(payload, { count: "exact" })
          .eq("id", currentCase.id)
          .select("*")
          .maybeSingle()
      : db
          .from("partner_onboarding_cases")
          .insert({ organization_id: organization.id, ...payload })
          .select("*")
          .maybeSingle();

    const updateResponse = await request;
    const { data, error } = updateResponse;
    const updateDebug = {
      ...startedDebug,
      update_response_data: data ?? null,
      update_error: error ?? null,
      update_status: updateResponse.status ?? null,
      update_status_text: updateResponse.statusText ?? null,
      update_count: updateResponse.count ?? null,
      affected_row: data ?? null,
      no_row_updated_message: !error && !data ? "No row updated. Check RLS or wrong case id." : null,
    };
    setSaveDebug(updateDebug);

    if (error) {
      toast.error(error.message ?? "Impossible d'enregistrer le dossier.");
      return false;
    }

    const savedCaseId = (data as OnboardingCase | null)?.id ?? currentCase?.id ?? null;
    if (savedCaseId) {
      const selected = await db
        .from("partner_onboarding_cases")
        .select("*")
        .eq("id", savedCaseId)
        .maybeSingle();
      const selectedCase = (selected.data ?? null) as OnboardingCase | null;
      const selectedDebug = {
        ...updateDebug,
        select_after_update_query: `partner_onboarding_cases.select("*").eq("id", "${savedCaseId}").maybeSingle()`,
        select_after_update_data: selected.data ?? null,
        select_after_update_error: selected.error ?? null,
        select_after_update_status: selected.status ?? null,
        select_after_update_status_text: selected.statusText ?? null,
        select_after_update_form_data: selectedCase?.form_data ?? null,
      };
      console.log("[agency/onboarding save diagnostic after select]", selectedDebug);
      setSaveDebug(selectedDebug);

      if (!selected.error && selectedCase) {
        setCaseRow(selectedCase);
        setSavedCaseData(selectedCase);
        caseRowRef.current = selectedCase;
        if (nextStatus === "under_review" || READ_ONLY_STATUSES.has(String(selectedCase.status))) setEditMode(false);
        return true;
      }
    }

    if (!data) return refetchCase(currentCase?.id);

    const updated = data as OnboardingCase;
    setCaseRow(updated);
    setSavedCaseData(updated);
    caseRowRef.current = updated;
    if (nextStatus === "under_review" || READ_ONLY_STATUSES.has(String(updated.status))) setEditMode(false);
    return true;
  };

  const save = async () => {
    setSaving(true);
    const ok = await updateCase();
    setSaving(false);
    if (ok) toast.success("Informations enregistrées");
  };

  const submitForReview = async () => {
    if (progress < 100) {
      toast.error("Complétez les informations, documents et l'accusé de signature avant soumission.");
      return;
    }
    setSaving(true);
    const ok = await updateCase("under_review");
    setSaving(false);
    if (ok) toast.success("Dossier soumis");
  };

  const bestEffortDocumentInsert = async (document: DocumentMeta, file: File) => {
    if (!caseRow || !organization || !user) return;
    const attempts = [
      {
        organization_id: organization.id,
        onboarding_case_id: caseRow.id,
        document_type: document.document_type,
        file_name: file.name,
        file_path: document.file_path,
        mime_type: file.type || null,
        file_size: file.size,
        status: "received",
        uploaded_by: user.id,
      },
      {
        organization_id: organization.id,
        onboarding_case_id: caseRow.id,
        document_type: document.document_type,
        file_name: file.name,
        file_path: document.file_path,
      },
      {
        organization_id: organization.id,
        document_type: document.document_type,
        file_path: document.file_path,
      },
    ];

    for (const payload of attempts) {
      const { error } = await db.from("partner_onboarding_documents").insert(payload);
      if (!error) return;
    }
  };

  const uploadDocument = async (type: DocumentType, file: File) => {
    if (!caseRow || !organization || !user || isLocked) return;
    setUploading(type);

    const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, "-");
    const path = `${organization.id}/${caseRow.id}/${type}-${Date.now()}-${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from("partner-onboarding")
      .upload(path, file, { upsert: true, contentType: file.type || "application/octet-stream" });

    if (uploadError) {
      toast.error(uploadError.message ?? "Upload impossible.");
      setUploading(null);
      return;
    }

    const document: DocumentMeta = {
      document_type: type,
      file_name: file.name,
      file_path: path,
      uploaded_at: new Date().toISOString(),
      status: "received",
    };
    const nextDocuments = { ...documentsRef.current, [type]: document };
    setDocuments(nextDocuments);
    documentsRef.current = nextDocuments;
    await bestEffortDocumentInsert(document, file);
    await updateCase();
    toast.success("Document ajouté");
    setUploading(null);
  };

  const updateAgencyInfo = (key: keyof AgencyInfo, value: string) =>
    setFormState((current) => ({
      ...current,
      agency_information: { ...current.agency_information, [key]: value },
    }));

  const updateContact = (key: keyof ContactPerson, value: string) =>
    setFormState((current) => ({
      ...current,
      contact_person: { ...current.contact_person, [key]: value },
    }));

  const updateSignature = (checked: boolean) =>
    setFormState((current) => ({
      ...current,
      digital_signature_acknowledged: checked,
      digital_signature_acknowledged_at: checked ? new Date().toISOString() : null,
    }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display text-3xl">Onboarding partenaire</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Complétez votre dossier agence pour validation par Moroccan Express / LeJapon.ma.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isApproved ? null : isSubmitted && !editMode ? (
            <Button type="button" variant="outline" onClick={() => setEditMode(true)} disabled={saving || loading}>
              Modifier la demande
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={save} disabled={saving || loading || !caseRow}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Enregistrer
            </Button>
          )}
          {(!isSubmitted || editMode) && (
            <Button type="button" onClick={submitForReview} disabled={saving || loading || !caseRow || isLocked || progress < 100}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {isSubmitted ? "Soumettre à nouveau" : "Soumettre"}
            </Button>
          )}
        </div>
      </div>

      {duplicateWarning && (
        <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          {duplicateWarning}
        </Card>
      )}

      <Card className="p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/10">
              <Building2 className="h-6 w-6 text-accent" />
            </div>
            <div>
              <h2 className="font-display text-xl">{organization?.display_name}</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="outline">Organisation: {organization?.status}</Badge>
                {loading && <Badge variant="secondary"><Loader2 className="mr-1 h-3 w-3 animate-spin" />Chargement</Badge>}
                {caseRow && <Badge variant="outline" className={statusClass(caseRow.status)}>Dossier: {statusLabel(caseRow.status)}</Badge>}
              </div>
            </div>
          </div>
          <div className="min-w-[220px]">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Progression</span>
              <span className="font-semibold">{progress}%</span>
            </div>
            <Progress value={progress} />
          </div>
        </div>
        {error && <p className="mt-4 text-sm text-amber-700">Dossier onboarding indisponible: {error}</p>}
        {!loading && !caseRow && !error && (
          <p className="mt-4 text-sm text-muted-foreground">
            Aucun dossier onboarding visible pour le moment. Contactez Moroccan Express / LeJapon.ma.
          </p>
        )}
        {caseRow && (
          <p className="mt-4 text-xs text-muted-foreground">
            Dossier créé le {fmtDateTime(caseRow.created_at)}. Dernière mise à jour: {fmtDateTime(caseRow.updated_at)}.
          </p>
        )}
        {isLocked && (
          <p className="mt-3 text-sm text-muted-foreground">
            {isApproved
              ? "Votre dossier partenaire est approuvé. Pour toute modification, contactez LeJapon.ma."
              : "La demande est soumise. Les champs sont en lecture seule jusqu'à ce que vous cliquiez sur Modifier la demande."}
          </p>
        )}
      </Card>

      {caseRow && (
        <>
          <Card className="p-5">
            <h2 className="font-display text-xl">1. Agency information</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {[
                ["legal_name", "Legal name"],
                ["commercial_name", "Commercial name"],
                ["registration_number", "Registration number"],
                ["tax_number", "Tax number"],
                ["website", "Website"],
                ["city", "City"],
                ["country", "Country"],
              ].map(([key, label]) => (
                <div key={key} className="space-y-2">
                  <Label>{label}</Label>
                  <Input
                    value={metadata.agency_information[key as keyof AgencyInfo]}
                    onChange={(event) => updateAgencyInfo(key as keyof AgencyInfo, event.target.value)}
                    disabled={isLocked}
                    readOnly={isLocked}
                    className={lockedFieldClass}
                  />
                </div>
              ))}
              <div className="space-y-2 md:col-span-2">
                <Label>Address</Label>
                <Textarea
                  value={metadata.agency_information.address}
                  onChange={(event) => updateAgencyInfo("address", event.target.value)}
                  disabled={isLocked}
                  readOnly={isLocked}
                  className={lockedFieldClass}
                  rows={3}
                />
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="font-display text-xl">2. Contact person</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {[
                ["full_name", "Full name"],
                ["position", "Position"],
                ["email", "Email"],
                ["phone", "Phone"],
              ].map(([key, label]) => (
                <div key={key} className="space-y-2">
                  <Label>{label}</Label>
                  <Input
                    type={key === "email" ? "email" : "text"}
                    value={metadata.contact_person[key as keyof ContactPerson]}
                    onChange={(event) => updateContact(key as keyof ContactPerson, event.target.value)}
                    disabled={isLocked}
                    readOnly={isLocked}
                    className={lockedFieldClass}
                  />
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="font-display text-xl">3. Documents</h2>
            <div className="mt-4 grid gap-3">
              {(Object.keys(DOCUMENT_LABELS) as DocumentType[]).map((type) => {
                const uploaded = metadata.documents[type];
                return (
                  <div key={type} className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium">{DOCUMENT_LABELS[type]}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {uploaded ? `${uploaded.file_name} · ${fmtDateTime(uploaded.uploaded_at)}` : "Document requis"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {uploaded && <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700"><FileCheck2 className="mr-1 h-3 w-3" />Reçu</Badge>}
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => fileInputRefs.current[type]?.click()}
                        disabled={isLocked || uploading === type}
                      >
                        {uploading === type ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        Upload
                      </Button>
                      <Input
                        ref={(node) => {
                          fileInputRefs.current[type] = node;
                        }}
                        type="file"
                        className="hidden"
                        disabled={isLocked || uploading === type}
                        onChange={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          const file = event.target.files?.[0];
                          event.currentTarget.value = "";
                          if (file) uploadDocument(type, file);
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="font-display text-xl">4. Digital signature acknowledgement</h2>
            <Separator className="my-4" />
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-4">
              <Checkbox
                checked={metadata.digital_signature_acknowledged}
                onCheckedChange={(checked) => updateSignature(Boolean(checked))}
                disabled={isLocked}
              />
              <span className="text-sm text-muted-foreground">
                I confirm that the submitted information is accurate and that I am authorized to complete this partner
                registration on behalf of the agency. I acknowledge that a digital partner contract may be prepared for
                review and signature after validation.
              </span>
            </label>
            {metadata.digital_signature_acknowledged_at && (
              <p className="mt-3 flex items-center gap-2 text-xs text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                Acknowledged on {fmtDateTime(metadata.digital_signature_acknowledged_at)}
              </p>
            )}
          </Card>
        </>
      )}

      <details className="mt-8 rounded-lg border border-border p-4 text-xs">
        <summary className="cursor-pointer font-mono font-semibold text-muted-foreground hover:text-foreground">
          🐛 Debug: form · saved case · documents
        </summary>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          <div>
            <p className="mb-2 font-semibold text-muted-foreground">current form state</p>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">{JSON.stringify(formState, null, 2)}</pre>
          </div>
          <div>
            <p className="mb-2 font-semibold text-muted-foreground">saved case data</p>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">{JSON.stringify(savedCaseData, null, 2)}</pre>
            <p className="mb-2 mt-4 font-semibold text-muted-foreground">saved form_data</p>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">{JSON.stringify(savedCaseData?.form_data ?? null, null, 2)}</pre>
            <p className="mb-2 mt-4 font-semibold text-muted-foreground">last save/update debug</p>
            {saveDebug?.update_error && (
              <div className="mb-2 rounded border border-destructive/30 bg-destructive/10 p-2 font-semibold text-destructive">
                Update error: {JSON.stringify(saveDebug.update_error)}
              </div>
            )}
            {saveDebug?.no_row_updated_message && (
              <div className="mb-2 rounded border border-destructive/30 bg-destructive/10 p-2 font-semibold text-destructive">
                {saveDebug.no_row_updated_message}
              </div>
            )}
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">{JSON.stringify(saveDebug, null, 2)}</pre>
          </div>
          <div>
            <p className="mb-2 font-semibold text-muted-foreground">uploaded documents state</p>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">{JSON.stringify(documents, null, 2)}</pre>
            <p className="mb-2 mt-4 font-semibold text-muted-foreground">partner_onboarding_documents rows</p>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">{JSON.stringify(savedDocumentRows, null, 2)}</pre>
          </div>
        </div>
      </details>
    </div>
  );
}
