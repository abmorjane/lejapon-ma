/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/admin/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Download, ExternalLink, FileText, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { downloadBytes, participantFullName } from "@/admin/lib/flight-tickets";
import {
  generateVisaGroupSubmissionOfficialPdf,
  visaSubmissionFilename,
  type VisaSubmissionApplicant,
} from "@/lib/visa-group-submission-pdf";

const todayISO = () => new Date().toISOString().slice(0, 10);

const STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon",
  submitted: "Soumise",
  awaiting_documents: "En attente docs",
  documents_received: "Documents reçus",
  in_review: "En traitement",
  submitted_to_embassy: "Soumise ambassade",
  approved: "Approuvée",
  rejected: "Rejetée",
  completed: "Terminée",
};

const BATCH_STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon",
  generated: "Généré",
  submitted: "Déposé",
  needs_completion: "À compléter",
  cancelled: "Annulé",
};

const completeVisaStatuses = new Set(["documents_received", "in_review", "submitted_to_embassy", "approved", "completed"]);
const activeBookingStatuses = new Set(["lead", "confirmed", "paid", "completed"]);
const inactiveParticipantStatuses = new Set(["cancelled", "canceled", "deleted", "archived", "removed", "retired"]);

type SubmissionStatusCode =
  | "submitted_today"
  | "to_be_submitted_later"
  | "already_submitted"
  | "visa_issued"
  | "visa_not_required"
  | "not_started"
  | "incomplete"
  | "not_included";

const SUBMISSION_STATUS_LABEL_FR: Record<SubmissionStatusCode, string> = {
  submitted_today: "Déposé aujourd'hui",
  to_be_submitted_later: "À déposer plus tard",
  already_submitted: "Déjà déposé",
  visa_issued: "Visa obtenu",
  visa_not_required: "Visa non requis",
  not_started: "Dossier non commencé",
  incomplete: "Dossier incomplet",
  not_included: "Non inclus dans ce dépôt",
};

const SUBMISSION_STATUS_LABEL_EN: Record<SubmissionStatusCode, string> = {
  submitted_today: "Submitted today",
  to_be_submitted_later: "To be submitted later",
  already_submitted: "Already submitted",
  visa_issued: "Visa issued",
  visa_not_required: "Visa not required",
  not_started: "Not included in this submission",
  incomplete: "Not included in this submission",
  not_included: "Not included in this submission",
};

const editableSubmissionStatuses: SubmissionStatusCode[] = [
  "to_be_submitted_later",
  "already_submitted",
  "visa_issued",
  "visa_not_required",
  "not_started",
  "incomplete",
  "not_included",
];

type VisaSubmissionRow = {
  rowId: string;
  app: any | null;
  booking: any;
  participant: any;
  officialName: string;
  reservationName: string;
  passportName: string;
  passportNo: string;
  isComplete: boolean;
  isAlreadySubmitted: boolean;
  defaultSubmissionStatus: SubmissionStatusCode;
  lastBatch: any | null;
  warnings: string[];
};

const normalizePassport = (value: unknown) =>
  String(value ?? "").replace(/[\s-]+/g, "").trim().toUpperCase();

const formatDate = (value?: string | null) => {
  if (!value) return "-";
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "-";
  return `${match[3]}/${match[2]}/${match[1]}`;
};

const normalizeName = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

const participantPassportName = (participant: any | null) => {
  const explicit = normalizeName(participant?.passport_full_name || participant?.passport_name);
  if (explicit) return explicit;
  const structured = normalizeName([
    participant?.passport_surname || participant?.surname || participant?.last_name,
    participant?.passport_given_names || participant?.given_names || participant?.first_name,
  ].filter(Boolean).join(" "));
  return structured || normalizeName(participantFullName(participant));
};

const visaApplicationName = (app: any | null) =>
  normalizeName([app?.surname, app?.given_names].filter(Boolean).join(" "));

const officialNameForRow = (app: any | null, participant: any) =>
  participantPassportName(participant) || visaApplicationName(app) || normalizeName(participantFullName(participant));

const visaReservationName = (participant: any | null) => normalizeName(participantFullName(participant));

const isActiveParticipant = (participant: any) => {
  const status = String(participant?.status ?? participant?.booking_status ?? "").trim().toLowerCase();
  return !status || !inactiveParticipantStatuses.has(status);
};

const buildReferencePrefix = (trip: any) => {
  const date = String(trip?.start_date ?? "").match(/^(\d{4})-(\d{2})/);
  if (!date) return "JP-VISA-TRIP";
  const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(Number(date[1]), Number(date[2]) - 1, 1)))
    .toUpperCase();
  return `JP-VISA-${month}${String(date[1]).slice(-2)}`;
};

const buildReference = (trip: any, existingBatches: any[]) => {
  const prefix = buildReferencePrefix(trip);
  const count = existingBatches.filter((batch) => String(batch.reference ?? "").startsWith(prefix)).length + 1;
  return `${prefix}-DEP-${String(count).padStart(2, "0")}`;
};

const byNewest = (a: any, b: any) => String(b?.created_at ?? "").localeCompare(String(a?.created_at ?? ""));

export default function VisaGroupSubmissions() {
  const [params, setParams] = useSearchParams();
  const [trips, setTrips] = useState<any[]>([]);
  const [selectedTripId, setSelectedTripId] = useState(params.get("trip") ?? "");
  const [submissionDate, setSubmissionDate] = useState(todayISO());
  const [rows, setRows] = useState<VisaSubmissionRow[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [submissionStatuses, setSubmissionStatuses] = useState<Record<string, SubmissionStatusCode>>({});
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const selectedTrip = trips.find((trip) => trip.id === selectedTripId) ?? null;

  useEffect(() => {
    supabase.from("trips").select("id,title,start_date,end_date").order("start_date", { ascending: false })
      .then(({ data, error }) => {
        if (error) toast.error(error.message);
        else setTrips(data ?? []);
      });
  }, []);

  useEffect(() => {
    if (selectedTripId) setParams((next) => {
      next.set("trip", selectedTripId);
      return next;
    });
  }, [selectedTripId, setParams]);

  const loadTripRows = useCallback(async () => {
    if (!selectedTripId) {
      setRows([]);
      setBatches([]);
      return;
    }
    setLoading(true);
    try {
      const [{ data: bookings, error: bookingsError }, { data: batchRows, error: batchError }] = await Promise.all([
        supabase
          .from("bookings")
          .select("id,reference,status,contact_name,trip_id,created_at")
          .eq("trip_id", selectedTripId)
          .in("status", Array.from(activeBookingStatuses))
          .order("created_at", { ascending: true }),
        (supabase as any)
          .from("visa_group_submission_batches")
          .select("*")
          .eq("trip_id", selectedTripId)
          .order("created_at", { ascending: false }),
      ]);
      if (bookingsError) throw bookingsError;
      if (batchError) throw batchError;

      const bookingRows = bookings ?? [];
      const bookingIds = bookingRows.map((booking: any) => booking.id);
      const bookingById = new Map(bookingRows.map((booking: any) => [booking.id, booking]));
      const batchList = batchRows ?? [];
      setBatches(batchList);

      if (!bookingIds.length) {
        setRows([]);
        setSelectedIds(new Set());
        return;
      }

      const [{ data: participants, error: participantsError }, { data: apps, error: appsError }, { data: itemRows, error: itemsError }] = await Promise.all([
        supabase
          .from("booking_participants")
          .select("*")
          .in("booking_id", bookingIds)
          .order("created_at", { ascending: true }),
        supabase
          .from("visa_applications")
          .select("id,reference,status,surname,given_names,passport_no,residential_email,booking_id,booking_participant_id,submitted_at,created_at,admin_notes")
          .in("booking_id", bookingIds)
          .order("created_at", { ascending: false }),
        batchList.length
          ? (supabase as any)
            .from("visa_group_submission_items")
            .select("*")
            .in("batch_id", batchList.map((batch: any) => batch.id))
          : Promise.resolve({ data: [], error: null } as any),
      ]);
      if (participantsError) throw participantsError;
      if (appsError) throw appsError;
      if (itemsError) throw itemsError;

      const participantRows = (participants ?? []).filter((participant: any) => {
        if (!isActiveParticipant(participant)) return false;
        const booking = bookingById.get(participant.booking_id);
        return Boolean(booking);
      });

      const appsByParticipant = new Map<string, any[]>();
      const appsByPassport = new Map<string, any[]>();
      for (const app of apps ?? []) {
        if (app.booking_participant_id) {
          const list = appsByParticipant.get(app.booking_participant_id) ?? [];
          list.push(app);
          appsByParticipant.set(app.booking_participant_id, list);
        }
        const passport = normalizePassport(app.passport_no);
        if (passport) {
          const list = appsByPassport.get(passport) ?? [];
          list.push(app);
          appsByPassport.set(passport, list);
        }
      }
      for (const list of appsByParticipant.values()) list.sort(byNewest);
      for (const list of appsByPassport.values()) list.sort(byNewest);

      const batchById = new Map(batchList.map((batch: any) => [batch.id, batch]));
      const submittedItemByParticipant = new Map<string, any>();
      const latestItemByParticipant = new Map<string, any>();
      for (const item of itemRows ?? []) {
        if (!item.booking_participant_id) continue;
        const batch = batchById.get(item.batch_id);
        if (!batch) continue;
        const current = latestItemByParticipant.get(item.booking_participant_id);
        if (!current || String(batch.created_at ?? "").localeCompare(String(current.batch?.created_at ?? "")) > 0) {
          latestItemByParticipant.set(item.booking_participant_id, { ...item, batch });
        }
        const selectedInBatch = item.is_selected_for_submission !== false;
        if (batch.status === "submitted" && selectedInBatch) {
          submittedItemByParticipant.set(item.booking_participant_id, { ...item, batch });
        }
      }

      const passportCounts = new Map<string, number>();
      for (const participant of participantRows) {
        const passport = normalizePassport(participant.passport_no);
        if (passport) passportCounts.set(passport, (passportCounts.get(passport) ?? 0) + 1);
      }

      const nextRows = participantRows.map((participant: any) => {
        const booking = bookingById.get(participant.booking_id);
        const passportNo = normalizePassport(participant.passport_no);
        const directApp = appsByParticipant.get(participant.id)?.[0] ?? null;
        const passportApps = passportNo ? (appsByPassport.get(passportNo) ?? []) : [];
        const passportApp = !directApp && passportApps.length === 1 ? passportApps[0] : null;
        const app = directApp ?? passportApp;
        const officialName = officialNameForRow(app, participant);
        const reservationName = visaReservationName(participant);
        const visaName = visaApplicationName(app);
        const warnings: string[] = [];
        const hasVisaApplication = Boolean(app);
        const latestItem = latestItemByParticipant.get(participant.id);
        const isAlreadySubmitted = submittedItemByParticipant.has(participant.id) || String(app?.status ?? "") === "submitted_to_embassy";
        if (!hasVisaApplication) warnings.push("Aucun dossier visa numérique n'est lié à ce participant.");
        if (passportApp && !directApp) warnings.push("Dossier visa rapproché par passeport exact. À vérifier.");
        if ((appsByParticipant.get(participant.id)?.length ?? 0) > 1) warnings.push("Plusieurs dossiers visa sont liés à ce participant.");
        if (!officialName) warnings.push("Nom officiel absent.");
        if (!passportNo) warnings.push("Numéro de passeport absent.");
        if (visaName && reservationName && visaName !== reservationName) warnings.push("Nom visa/passeport différent du nom du participant.");
        if (passportNo && (passportCounts.get(passportNo) ?? 0) > 1) warnings.push("Deux participants du voyage utilisent le même passeport.");
        if (isAlreadySubmitted) warnings.push("Déjà présent dans un lot marqué déposé ou soumis à l'ambassade.");
        const isComplete = Boolean(hasVisaApplication && officialName && passportNo && completeVisaStatuses.has(String(app?.status ?? "")));
        const defaultSubmissionStatus: SubmissionStatusCode = isAlreadySubmitted
          ? "already_submitted"
          : ["approved", "completed"].includes(String(app?.status ?? ""))
            ? "visa_issued"
            : !hasVisaApplication
              ? "not_started"
              : !isComplete
                ? "incomplete"
                : "to_be_submitted_later";
        return {
          rowId: participant.id,
          app,
          booking,
          participant,
          officialName,
          reservationName,
          passportName: officialName,
          passportNo,
          isComplete,
          isAlreadySubmitted,
          defaultSubmissionStatus,
          lastBatch: latestItem?.batch ?? null,
          warnings,
        };
      }).sort((a, b) => {
        const bookingOrder = String(a.booking?.created_at ?? "").localeCompare(String(b.booking?.created_at ?? ""));
        if (bookingOrder !== 0) return bookingOrder;
        return String(a.participant?.created_at ?? "").localeCompare(String(b.participant?.created_at ?? ""));
      });

      setRows(nextRows);
      setSelectedIds((current) => new Set(Array.from(current).filter((id) => nextRows.some((row) => row.rowId === id))));
      setSubmissionStatuses((current) => {
        const next: Record<string, SubmissionStatusCode> = {};
        for (const row of nextRows) next[row.rowId] = current[row.rowId] ?? row.defaultSubmissionStatus;
        return next;
      });
    } catch (error: any) {
      toast.error(error?.message ?? "Impossible de charger les depots groupes.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [selectedTripId]);

  useEffect(() => {
    void loadTripRows();
  }, [loadTripRows]);

  const effectiveSubmissionStatus = useCallback((row: VisaSubmissionRow): SubmissionStatusCode => (
    selectedIds.has(row.rowId) ? "submitted_today" : (submissionStatuses[row.rowId] ?? row.defaultSubmissionStatus)
  ), [selectedIds, submissionStatuses]);

  const filteredRows = useMemo(() => rows.filter((row) => {
    const status = effectiveSubmissionStatus(row);
    if (filter === "complete" && !row.isComplete) return false;
    if (filter === "incomplete" && row.isComplete) return false;
    if (filter === "not_submitted" && (row.isAlreadySubmitted || status === "already_submitted")) return false;
    if (filter === "submitted" && !row.isAlreadySubmitted && status !== "already_submitted") return false;
    if (filter === "selected" && !selectedIds.has(row.rowId)) return false;
    return true;
  }), [rows, filter, selectedIds, effectiveSubmissionStatus]);

  const selectedRows = rows.filter((row) => selectedIds.has(row.rowId));
  const visaIssuedCount = rows.filter((row) => effectiveSubmissionStatus(row) === "visa_issued").length;
  const visaNotRequiredCount = rows.filter((row) => effectiveSubmissionStatus(row) === "visa_not_required").length;
  const existingVisaCount = rows.filter((row) => row.app).length;

  const toggleSelected = (row: VisaSubmissionRow) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(row.rowId)) {
        next.delete(row.rowId);
        return next;
      }
      if (!row.app) {
        const ok = window.confirm("Aucun dossier visa numérique n'est lié à ce participant. Confirmer tout de même son inclusion dans le dépôt ?");
        if (!ok) return current;
      }
      next.add(row.rowId);
      return next;
    });
  };

  const selectCompleteNotSubmitted = () => {
    setSelectedIds(new Set(rows.filter((row) => row.isComplete && !row.isAlreadySubmitted).map((row) => row.rowId)));
  };

  const setRowSubmissionStatus = (rowId: string, value: SubmissionStatusCode) => {
    setSubmissionStatuses((current) => ({ ...current, [rowId]: value }));
  };

  const toPdfApplicants = (sourceRows: VisaSubmissionRow[]): VisaSubmissionApplicant[] =>
    sourceRows.map((row) => {
      const status = effectiveSubmissionStatus(row);
      return {
        id: row.rowId,
        officialName: row.officialName,
        passportNo: row.passportNo,
        visaReference: row.app?.reference ?? null,
        bookingReference: row.booking?.reference ?? null,
        visaStatus: row.app ? (STATUS_LABEL[row.app.status] ?? row.app.status) : "Aucun dossier visa créé",
        submissionStatus: SUBMISSION_STATUS_LABEL_EN[status],
        lastSubmissionReference: row.lastBatch?.reference ?? null,
        selected: selectedIds.has(row.rowId),
        warnings: row.warnings,
        internalNotes: row.app?.admin_notes ?? null,
      };
    });

  const generateOfficialBatch = async () => {
    if (!selectedTrip) return toast.error("Sélectionnez un voyage.");
    if (!rows.length) return toast.error("Aucun participant actif n'est inscrit sur ce voyage.");
    if (!selectedRows.length) return toast.error("Sélectionnez au moins une personne déposée aujourd'hui.");
    if (!selectedTrip.start_date || !selectedTrip.end_date) return toast.error("Dates du voyage absentes.");

    const missingNames = rows.filter((row) => !row.officialName);
    if (missingNames.length) return toast.error("Nom officiel absent pour au moins un participant du voyage.");

    const selectedWithoutPassport = selectedRows.filter((row) => !row.passportNo);
    if (selectedWithoutPassport.length) {
      return toast.error(`Passeport manquant pour ${selectedWithoutPassport[0].officialName || selectedWithoutPassport[0].booking?.reference}.`);
    }

    const selectedWithoutVisa = selectedRows.filter((row) => !row.app);
    if (selectedWithoutVisa.length) {
      const ok = window.confirm(`${selectedWithoutVisa.length} participant(s) sélectionné(s) n'ont aucun dossier visa numérique lié. Confirmer leur inclusion dans la liste officielle ?`);
      if (!ok) return;
    }

    if (selectedRows.some((row) => row.isAlreadySubmitted)) {
      const ok = window.confirm("Certains participants sont déjà dans un lot marqué déposé. Créer un nouveau lot quand même ?");
      if (!ok) return;
    }

    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const reference = buildReference(selectedTrip, batches);
      const batchInsert = await (supabase as any)
        .from("visa_group_submission_batches")
        .insert({
          trip_id: selectedTrip.id,
          reference,
          submission_date: submissionDate,
          status: "draft",
          prepared_by: userData.user?.id ?? null,
          metadata: {
            source: "admin_visa_group_submissions_full_passenger_list",
            participant_count: rows.length,
            selected_count: selectedRows.length,
            visa_application_count: existingVisaCount,
          },
        })
        .select("*")
        .single();
      if (batchInsert.error) throw batchInsert.error;
      const batch = batchInsert.data;

      const itemPayload = rows.map((row, index) => {
        const status = effectiveSubmissionStatus(row);
        return {
          batch_id: batch.id,
          trip_id: selectedTrip.id,
          visa_application_id: row.app?.id ?? null,
          booking_id: row.booking.id,
          booking_participant_id: row.participant.id,
          official_name: row.officialName,
          passport_no: row.passportNo || "Not provided",
          visa_status: row.app?.status ?? null,
          is_selected_for_submission: selectedIds.has(row.rowId),
          submission_status: status,
          warnings: row.warnings,
          sort_order: index + 1,
          metadata: {
            booking_reference: row.booking?.reference ?? null,
            has_visa_application: Boolean(row.app),
            submission_status_label: SUBMISSION_STATUS_LABEL_EN[status],
          },
        };
      });
      const itemInsert = await (supabase as any).from("visa_group_submission_items").insert(itemPayload);
      if (itemInsert.error) throw itemInsert.error;

      const filename = visaSubmissionFilename(selectedTrip.title, submissionDate, reference);
      const bytes = await generateVisaGroupSubmissionOfficialPdf({
        batchReference: reference,
        submissionDate,
        trip: selectedTrip,
        applicants: toPdfApplicants(rows),
      });
      const path = `visa-group-submissions/${selectedTrip.id}/${batch.id}/v1-${Date.now()}-${filename}`;
      const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)], { type: "application/pdf" });
      const upload = await supabase.storage.from("visa-docs").upload(path, blob, {
        contentType: "application/pdf",
        upsert: false,
      });
      if (upload.error) throw upload.error;

      const update = await (supabase as any)
        .from("visa_group_submission_batches")
        .update({
          status: "generated",
          file_path: path,
          file_name: filename,
          generated_at: new Date().toISOString(),
          generated_by: userData.user?.id ?? null,
        })
        .eq("id", batch.id);
      if (update.error) throw update.error;

      downloadBytes(bytes, filename);
      toast.success(`Lot ${reference} généré avec ${selectedRows.length} dossier(s) déposé(s) sur ${rows.length} voyageur(s).`);
      setSelectedIds(new Set());
      await loadTripRows();
    } catch (error: any) {
      toast.error(error?.message ?? "Impossible de générer le lot officiel.");
    } finally {
      setBusy(false);
    }
  };

  const downloadBatch = async (batch: any) => {
    if (!batch.file_path) return toast.error("Aucun PDF officiel enregistré pour ce lot.");
    const { data, error } = await supabase.storage.from("visa-docs").createSignedUrl(batch.file_path, 60);
    if (error || !data) return toast.error("Lien de téléchargement indisponible.");
    window.open(data.signedUrl, "_blank");
  };

  const markSubmitted = async (batch: any) => {
    const { error } = await (supabase as any)
      .from("visa_group_submission_batches")
      .update({
        status: "submitted",
        actual_submission_date: submissionDate,
        submitted_at: new Date().toISOString(),
      })
      .eq("id", batch.id);
    if (error) return toast.error(error.message);
    toast.success("Lot marqué comme déposé.");
    await loadTripRows();
  };

  return (
    <div>
      <PageHeader
        title="Dépôts groupés visa"
        description="Préparez une seule liste officielle complète pour l'Ambassade du Japon, avec les dossiers remis aujourd'hui clairement identifiés."
        action={(
          <>
            <Button variant="outline" onClick={loadTripRows} disabled={loading || !selectedTripId}>
              <RefreshCw className="h-4 w-4" /> Actualiser
            </Button>
            <Button onClick={generateOfficialBatch} disabled={busy || !selectedTripId}>
              <FileText className="h-4 w-4" /> Générer la liste du dépôt
            </Button>
          </>
        )}
      />

      <Card className="mb-4 rounded-lg p-4">
        <div className="grid gap-3 md:grid-cols-12 md:items-end">
          <div className="md:col-span-5">
            <label className="mb-1 block text-xs text-muted-foreground">Voyage</label>
            <Select value={selectedTripId || "none"} onValueChange={(value) => setSelectedTripId(value === "none" ? "" : value)}>
              <SelectTrigger><SelectValue placeholder="Choisir un voyage" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Choisir un voyage</SelectItem>
                {trips.map((trip) => (
                  <SelectItem key={trip.id} value={trip.id}>
                    {trip.title} - {formatDate(trip.start_date)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-3">
            <label className="mb-1 block text-xs text-muted-foreground">Date prévue du dépôt</label>
            <Input type="date" value={submissionDate} onChange={(event) => setSubmissionDate(event.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs text-muted-foreground">Filtre</label>
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="complete">Dossier complet</SelectItem>
                <SelectItem value="incomplete">Dossier incomplet</SelectItem>
                <SelectItem value="not_submitted">Non déposé</SelectItem>
                <SelectItem value="submitted">Déjà déposé</SelectItem>
                <SelectItem value="selected">Sélectionnés</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Button className="w-full" variant="outline" onClick={selectCompleteNotSubmitted} disabled={!rows.length}>
              Sélectionner complets
            </Button>
          </div>
        </div>
      </Card>

      {selectedTrip && (
        <div className="mb-4 grid gap-3 md:grid-cols-5">
          <Card className="rounded-lg p-4"><p className="text-xs text-muted-foreground">Voyageurs inscrits</p><p className="text-2xl font-semibold">{rows.length}</p></Card>
          <Card className="rounded-lg p-4"><p className="text-xs text-muted-foreground">Sélectionnés aujourd'hui</p><p className="text-2xl font-semibold">{selectedRows.length}</p></Card>
          <Card className="rounded-lg p-4"><p className="text-xs text-muted-foreground">Déjà déposés</p><p className="text-2xl font-semibold">{rows.filter((row) => row.isAlreadySubmitted).length}</p></Card>
          <Card className="rounded-lg p-4"><p className="text-xs text-muted-foreground">Visa obtenu</p><p className="text-2xl font-semibold">{visaIssuedCount}</p></Card>
          <Card className="rounded-lg p-4">
            <p className="text-xs text-muted-foreground">Visa non requis</p>
            <p className="text-2xl font-semibold">{visaNotRequiredCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">{existingVisaCount} dossier(s) visa numérique(s)</p>
          </Card>
        </div>
      )}

      {!selectedTripId ? (
        <Card className="rounded-lg border-dashed p-8 text-center text-muted-foreground">Choisissez un voyage pour préparer un dépôt groupé.</Card>
      ) : loading ? (
        <Card className="rounded-lg p-8 text-center text-muted-foreground">Chargement des voyageurs inscrits...</Card>
      ) : (
        <Card className="rounded-lg">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-sm">
              <thead className="sticky top-0 bg-slate-100 text-left text-xs text-slate-700">
                <tr>
                  <th className="p-3">Inclure aujourd'hui</th>
                  <th className="p-3">Nom officiel</th>
                  <th className="p-3">Passeport</th>
                  <th className="p-3">Reservation</th>
                  <th className="p-3">Dossier visa</th>
                  <th className="p-3">Situation consulaire</th>
                  <th className="p-3">Dernier lot</th>
                  <th className="p-3">Alertes</th>
                  <th className="p-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const status = effectiveSubmissionStatus(row);
                  return (
                    <tr key={row.rowId} className="border-t">
                      <td className="p-3">
                        <Checkbox checked={selectedIds.has(row.rowId)} onCheckedChange={() => toggleSelected(row)} />
                      </td>
                      <td className="p-3">
                        <p className="font-medium">{row.officialName || "Nom manquant"}</p>
                        {row.app && visaApplicationName(row.app) && row.reservationName && visaApplicationName(row.app) !== row.reservationName && (
                          <p className="text-xs text-amber-700">Réservation: {row.reservationName}</p>
                        )}
                        <p className="text-xs text-muted-foreground">{participantFullName(row.participant)}</p>
                      </td>
                      <td className="p-3 font-mono">{row.passportNo || "Not provided"}</td>
                      <td className="p-3">
                        <p>{row.booking?.reference ?? "-"}</p>
                        <p className="text-xs text-muted-foreground">{row.booking?.contact_name ?? ""}</p>
                      </td>
                      <td className="p-3">
                        {row.app ? (
                          <div>
                            <p className="font-medium">{row.app.reference}</p>
                            <p className="text-xs text-muted-foreground">{STATUS_LABEL[row.app.status] ?? row.app.status}</p>
                          </div>
                        ) : (
                          <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-900">Aucun dossier visa créé</Badge>
                        )}
                      </td>
                      <td className="p-3">
                        {selectedIds.has(row.rowId) ? (
                          <Badge className="bg-slate-900 text-white">{SUBMISSION_STATUS_LABEL_FR.submitted_today}</Badge>
                        ) : (
                          <Select value={status} onValueChange={(value) => setRowSubmissionStatus(row.rowId, value as SubmissionStatusCode)}>
                            <SelectTrigger className="h-9 min-w-[190px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {editableSubmissionStatuses.map((value) => (
                                <SelectItem key={value} value={value}>{SUBMISSION_STATUS_LABEL_FR[value]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                      <td className="p-3">
                        {row.lastBatch ? (
                          <div>
                            <p className="font-medium">{row.lastBatch.reference}</p>
                            <p className="text-xs text-muted-foreground">{BATCH_STATUS_LABEL[row.lastBatch.status] ?? row.lastBatch.status}</p>
                          </div>
                        ) : "-"}
                      </td>
                      <td className="p-3">
                        {row.warnings.length ? (
                          <div className="space-y-1">
                            {row.warnings.slice(0, 2).map((warning) => (
                              <p key={warning} className="text-xs text-amber-800">{warning}</p>
                            ))}
                          </div>
                        ) : <span className="text-muted-foreground">-</span>}
                      </td>
                      <td className="p-3">
                        {row.app ? (
                          <Button asChild variant="ghost" size="sm">
                            <Link to={`/admin/visa/${row.app.id}`}><ExternalLink className="h-4 w-4" /> Ouvrir</Link>
                          </Button>
                        ) : (
                          <Button asChild variant="ghost" size="sm">
                            <Link to={`/admin/bookings/${row.booking.id}`}><ExternalLink className="h-4 w-4" /> Réservation</Link>
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filteredRows.length === 0 && (
                  <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">Aucun voyageur pour ce filtre.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="rounded-lg p-4">
          <h2 className="mb-3 font-semibold">Anciens lots</h2>
          <div className="space-y-2">
            {batches.length === 0 && <p className="text-sm text-muted-foreground">Aucun lot enregistré pour ce voyage.</p>}
            {batches.map((batch) => (
              <div key={batch.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                <div>
                  <p className="font-semibold">{batch.reference}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(batch.submission_date)} - {BATCH_STATUS_LABEL[batch.status] ?? batch.status}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => downloadBatch(batch)} disabled={!batch.file_path}>
                    <Download className="h-4 w-4" /> PDF
                  </Button>
                  {batch.status === "generated" && (
                    <Button size="sm" onClick={() => markSubmitted(batch)}>Marquer déposé</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Alert className="h-fit border-amber-300 bg-amber-50 text-amber-950">
          <ShieldAlert className="h-4 w-4 text-amber-700" />
          <AlertTitle>Liste officielle complète</AlertTitle>
          <AlertDescription>
            Le PDF contient tous les participants actifs du voyage. Les dossiers remis aujourd'hui sont en noir gras,
            les autres voyageurs restent en gris avec leur situation consulaire.
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
}
