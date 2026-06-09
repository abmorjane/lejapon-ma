import { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { toast } from "sonner";
import {
  Banknote,
  CheckCircle2,
  Download,
  FileArchive,
  FileText,
  Loader2,
  Plane,
  Plus,
  Save,
  Settings,
  Upload,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/admin/components/PageHeader";
import { downloadBytes } from "@/lib/booking-pdfs";
import {
  exportInternationalPaymentWorkbook,
  fmtDate,
  fmtJPY,
  fmtMAD,
  generateInternationalInvoicePdf,
  generateParticipantsListPdf,
  generateSubrogationPdf,
  mergePdfBytes,
  type InternationalPaymentFile,
  type InternationalPaymentParticipant,
  type JapanPartnerSettings,
} from "@/lib/international-payments";

const db = supabase as any;
const bucket = "international-payments";

const statuses = [
  "draft",
  "created",
  "submitted_to_bank",
  "waiting_payment",
  "paid",
  "rejected",
  "cancelled",
] as const;

const statusLabels: Record<string, string> = {
  draft: "Brouillon",
  created: "Créé",
  submitted_to_bank: "Déposé banque",
  waiting_payment: "En attente paiement",
  paid: "Payé",
  rejected: "Rejeté",
  cancelled: "Annulé",
};

const documentTypeLabels: Record<string, string> = {
  contract: "Contrat partenaire",
  invoice: "Facture fournisseur",
  participants_pdf: "Liste participants PDF",
  participants_excel: "Liste participants Excel",
  subrogation: "Acte de subrogation",
  subrogations_zip: "Subrogations ZIP",
  subrogations_merged: "Subrogations fusionnées",
  passport_copy: "Copies passeports",
  flight_ticket: "Billets d'avion",
  payment_proof: "Preuve paiement",
  other: "Autre",
};

const checklistItems = [
  ["contract", "Contrat partenaire uploadé"],
  ["invoice", "Facture fournisseur générée"],
  ["participants", "Liste participants générée"],
  ["passports", "Copies passeports complètes"],
  ["subrogations", "Actes de subrogation générés"],
  ["tickets", "Billets d'avion uploadés"],
  ["payment_proof", "Preuve paiement uploadée"],
] as const;

const emptyFile = {
  trip_id: "",
  supplier_name: "Tapis Volant LLC",
  payment_reference: "",
  invoice_number: "",
  issue_date: new Date().toISOString().slice(0, 10),
  due_date: "",
  currency: "JPY",
  total_invoice_amount: 0,
  payment_percentage: 50,
  amount_already_paid: 0,
  notes: "",
  status: "draft",
};

const emptyPartner: JapanPartnerSettings = {
  partner_name: "Tapis Volant LLC",
  address: "",
  email: "",
  phone: "",
  registration_number: "",
  corporate_number: "",
  bank_name: "",
  bank_code: "",
  branch_code: "",
  branch_name: "",
  account_type: "",
  account_number: "",
  account_name: "",
};

const numberValue = (value: unknown) => Number(value || 0);
const fullName = (p: any) => [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || p.full_name || "Participant";
const fileNameSafe = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "dossier";

function passportCopyPath(participant: any) {
  const metadata = participant?.metadata ?? {};
  return participant?.passport_copy_path
    || participant?.passport_file_path
    || participant?.passport_scan_path
    || participant?.passport_url
    || metadata.passport_copy_path
    || metadata.passport_file_path
    || metadata.passport_scan_path
    || metadata.passport_url
    || metadata.passport_ocr?.file_path
    || null;
}

function completion(file: any, docs: any[], participants: InternationalPaymentParticipant[]) {
  const docTypes = new Set(docs.map((doc) => doc.document_type));
  const complete = {
    contract: docTypes.has("contract") || Boolean(file?.metadata?.partner_contract_path),
    invoice: docTypes.has("invoice"),
    participants: docTypes.has("participants_pdf") || docTypes.has("participants_excel"),
    passports: participants.length > 0 && participants.every((participant: any) => Boolean((participant as any).passport_copy_path)),
    subrogations: docTypes.has("subrogation") || docTypes.has("subrogations_zip") || docTypes.has("subrogations_merged"),
    tickets: docTypes.has("flight_ticket"),
    payment_proof: docTypes.has("payment_proof"),
  };
  const done = checklistItems.filter(([key]) => complete[key]).length;
  return { complete, percent: Math.round((done / checklistItems.length) * 100) };
}

function StatusBadge({ status }: { status?: string | null }) {
  const variant = status === "paid" ? "default" : status === "rejected" || status === "cancelled" ? "destructive" : "secondary";
  return <Badge variant={variant as any}>{statusLabels[status || "draft"] ?? status}</Badge>;
}

export default function InternationalPayments() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [trips, setTrips] = useState<any[]>([]);
  const [files, setFiles] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [participants, setParticipants] = useState<InternationalPaymentParticipant[]>([]);
  const [partner, setPartner] = useState<any>(emptyPartner);
  const [selectedTripId, setSelectedTripId] = useState<string>("all");
  const [selectedFileId, setSelectedFileId] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [fileDraft, setFileDraft] = useState<any>(emptyFile);
  const [invoiceDraft, setInvoiceDraft] = useState({ participant_count: "0", unit_price_jpy: "0", tax_percent: "0" });
  const [subrogationDraft, setSubrogationDraft] = useState({
    amount_mad: "0",
    place: "Temara",
    signature_date: new Date().toISOString().slice(0, 10),
    notes: "",
  });
  const [busy, setBusy] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadContext = useRef<{ type: string; folder: string; participantId?: string | null } | null>(null);

  const selectedFile = files.find((file) => file.id === selectedFileId) ?? files[0] ?? null;
  const selectedTrip = trips.find((trip) => trip.id === (selectedFile?.trip_id || selectedTripId));
  const currentDocuments = documents.filter((doc) => doc.payment_file_id === selectedFile?.id);
  const currentHistory = history.filter((row) => row.payment_file_id === selectedFile?.id);
  const currentCompletion = completion(selectedFile, currentDocuments, participants);

  const filteredFiles = useMemo(() => {
    if (selectedTripId === "all") return files;
    return files.filter((file) => file.trip_id === selectedTripId);
  }, [files, selectedTripId]);

  const tripDashboard = useMemo(() => {
    return trips.map((trip) => {
      const tripFiles = files.filter((file) => file.trip_id === trip.id);
      const total = tripFiles.reduce((sum, file) => sum + numberValue(file.total_invoice_amount), 0);
      const paid = tripFiles.reduce((sum, file) => sum + numberValue(file.amount_already_paid), 0);
      const dueDates = tripFiles.map((file) => file.due_date).filter(Boolean).sort();
      return {
        trip,
        total,
        paid,
        remaining: Math.max(0, total - paid),
        count: tripFiles.length,
        nextDueDate: dueDates[0] ?? null,
        statuses: statuses.reduce((acc, status) => ({ ...acc, [status]: tripFiles.filter((file) => file.status === status).length }), {} as Record<string, number>),
      };
    }).filter((row) => row.count > 0);
  }, [files, trips]);

  const load = async () => {
    setLoading(true);
    const [tripResult, fileResult, partnerResult] = await Promise.all([
      supabase.from("trips").select("id,title,season,start_date,end_date,duration_days").order("start_date", { ascending: false, nullsFirst: false }),
      db.from("international_payment_files").select("*").order("created_at", { ascending: false }),
      db.from("japan_partner_settings").select("*").order("created_at", { ascending: true }).limit(1).maybeSingle(),
    ]);
    setTrips(tripResult.data ?? []);
    setFiles(fileResult.data ?? []);
    setPartner(partnerResult.data ?? emptyPartner);
    const firstFile = fileResult.data?.[0];
    if (!selectedFileId && firstFile) setSelectedFileId(firstFile.id);
    setLoading(false);
  };

  const loadFileDetails = async (file: any) => {
    if (!file?.id) {
      setDocuments([]);
      setHistory([]);
      setParticipants([]);
      return;
    }
    const [{ data: docs }, { data: events }, { data: bookings }] = await Promise.all([
      db.from("international_payment_file_documents").select("*").eq("payment_file_id", file.id).order("created_at", { ascending: false }),
      db.from("international_payment_history").select("*").eq("payment_file_id", file.id).order("created_at", { ascending: false }),
      supabase.from("bookings").select("id,reference,contact_name,contact_email,contact_phone,trip_id,room_type,room_preference").eq("trip_id", file.trip_id),
    ]);
    setDocuments(docs ?? []);
    setHistory(events ?? []);
    const bookingRows = bookings ?? [];
    const bookingIds = bookingRows.map((booking: any) => booking.id);
    if (!bookingIds.length) {
      setParticipants([]);
      return;
    }
    const { data: partRows } = await db.from("booking_participants").select("*").in("booking_id", bookingIds);
    const mapped = (partRows ?? []).map((participant: any) => {
      const booking = bookingRows.find((item: any) => item.id === participant.booking_id);
      return {
        id: participant.id,
        full_name: fullName(participant),
        passport_no: participant.passport_no || participant.passport_number || participant.document_number,
        nationality: participant.nationality,
        date_of_birth: participant.date_of_birth || participant.birthdate,
        booking_reference: booking?.reference,
        room_type: participant.room_type || booking?.room_type || booking?.room_preference,
        cin: participant.cin || participant.national_id_number,
        address: participant.address,
        city: participant.city,
        passport_copy_path: passportCopyPath(participant),
      } as InternationalPaymentParticipant & { passport_copy_path?: string | null };
    });
    setParticipants(mapped);
    setInvoiceDraft((current) => ({ ...current, participant_count: String(mapped.length) }));
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => { void loadFileDetails(selectedFile); }, [selectedFile?.id]);

  const saveHistory = async (paymentFileId: string, action: string, oldValue?: unknown, newValue?: unknown, notes?: string) => {
    await db.from("international_payment_history").insert({
      payment_file_id: paymentFileId,
      action,
      actor_id: user?.id ?? null,
      old_value: oldValue ?? null,
      new_value: newValue ?? null,
      notes: notes ?? null,
    });
  };

  const saveFile = async () => {
    if (!fileDraft.trip_id) return toast.error("Choisissez un voyage.");
    const payload = {
      ...fileDraft,
      total_invoice_amount: numberValue(fileDraft.total_invoice_amount),
      payment_percentage: numberValue(fileDraft.payment_percentage),
      amount_already_paid: numberValue(fileDraft.amount_already_paid),
      participants_count: participants.length || 0,
      created_by: user?.id ?? null,
    };
    const current = fileDraft.id ? files.find((file) => file.id === fileDraft.id) : null;
    const request = fileDraft.id
      ? db.from("international_payment_files").update(payload).eq("id", fileDraft.id).select("*").single()
      : db.from("international_payment_files").insert(payload).select("*").single();
    const { data, error } = await request;
    if (error) return toast.error(error.message);
    await saveHistory(data.id, fileDraft.id ? "payment_file_updated" : "payment_file_created", current, data);
    toast.success("Dossier paiement enregistré.");
    setDialogOpen(false);
    setSelectedFileId(data.id);
    await load();
  };

  const savePartner = async () => {
    setBusy("partner");
    const request = partner.id
      ? db.from("japan_partner_settings").update(partner).eq("id", partner.id).select("*").single()
      : db.from("japan_partner_settings").insert(partner).select("*").single();
    const { data, error } = await request;
    setBusy(null);
    if (error) return toast.error(error.message);
    setPartner(data);
    toast.success("Paramètres partenaire enregistrés.");
  };

  const uploadDocument = async (file: File, type: string, folder: string, participantId?: string | null) => {
    if (!selectedFile?.id) return;
    setBusy(`upload-${type}`);
    const path = `${folder}/${selectedFile.id}/${Date.now()}-${fileNameSafe(file.name)}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
    if (error) {
      setBusy(null);
      return toast.error(error.message);
    }
    const { error: insertError } = await db.from("international_payment_file_documents").insert({
      payment_file_id: selectedFile.id,
      document_type: type,
      file_name: file.name,
      storage_path: path,
      mime_type: file.type || null,
      size_bytes: file.size,
      participant_id: participantId ?? null,
      uploaded_by: user?.id ?? null,
    });
    setBusy(null);
    if (insertError) return toast.error(insertError.message);
    await saveHistory(selectedFile.id, "document_uploaded", null, { type, file_name: file.name });
    toast.success("Document uploadé.");
    await loadFileDetails(selectedFile);
  };

  const openUpload = (type: string, folder: string, participantId?: string | null) => {
    uploadContext.current = { type, folder, participantId };
    uploadInputRef.current?.click();
  };

  const uploadGeneratedBytes = async (bytes: Uint8Array, filename: string, type: string, folder: string, participantId?: string | null) => {
    if (!selectedFile?.id) throw new Error("Aucun dossier sélectionné");
    const path = `${folder}/${selectedFile.id}/${Date.now()}-${fileNameSafe(filename)}`;
    const blob = new Blob([bytes], { type: type.includes("excel") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf" });
    const { error } = await supabase.storage.from(bucket).upload(path, blob, { upsert: false, contentType: blob.type });
    if (error) throw error;
    const { error: insertError } = await db.from("international_payment_file_documents").insert({
      payment_file_id: selectedFile.id,
      document_type: type,
      file_name: filename,
      storage_path: path,
      mime_type: blob.type,
      size_bytes: blob.size,
      participant_id: participantId ?? null,
      uploaded_by: user?.id ?? null,
    });
    if (insertError) throw insertError;
    return path;
  };

  const signedDownload = async (doc: any) => {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(doc.storage_path, 120);
    if (error) return toast.error(error.message);
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const generateInvoice = async () => {
    if (!selectedFile) return;
    setBusy("invoice");
    try {
      const pdf = await generateInternationalInvoicePdf({
        file: selectedFile,
        partner,
        tripTitle: selectedTrip?.title ?? "Voyage Japon",
        participantCount: numberValue(invoiceDraft.participant_count),
        unitPriceJpy: numberValue(invoiceDraft.unit_price_jpy),
        taxPercent: numberValue(invoiceDraft.tax_percent),
      });
      const filename = `facture-${selectedFile.invoice_number || selectedFile.payment_reference || selectedFile.id}.pdf`;
      downloadBytes(pdf, filename);
      await uploadGeneratedBytes(pdf, filename, "invoice", "invoices");
      await saveHistory(selectedFile.id, "invoice_generated", null, { filename });
      toast.success("Facture générée.");
      await loadFileDetails(selectedFile);
    } catch (error: any) {
      toast.error(error.message ?? "Impossible de générer la facture.");
    } finally {
      setBusy(null);
    }
  };

  const exportParticipants = async (kind: "pdf" | "excel") => {
    if (!selectedFile) return;
    setBusy(`participants-${kind}`);
    try {
      const baseName = `participants-${fileNameSafe(selectedTrip?.title || "voyage")}`;
      if (kind === "pdf") {
        const pdf = await generateParticipantsListPdf(selectedTrip?.title ?? "Voyage Japon", participants);
        const filename = `${baseName}.pdf`;
        downloadBytes(pdf, filename);
        await uploadGeneratedBytes(pdf, filename, "participants_pdf", "participants");
      } else {
        await exportInternationalPaymentWorkbook(`${baseName}.xlsx`, [
          { name: "Participants", rows: participants.map((participant) => ({
            Nom: participant.full_name,
            Passeport: participant.passport_no,
            Nationalite: participant.nationality,
            Naissance: fmtDate(participant.date_of_birth),
            Reservation: participant.booking_reference,
            Chambre: participant.room_type,
          })) },
        ]);
      }
      await saveHistory(selectedFile.id, `participants_${kind}_generated`);
      toast.success("Liste participants générée.");
      await loadFileDetails(selectedFile);
    } finally {
      setBusy(null);
    }
  };

  const generateSubrogations = async () => {
    if (!selectedFile || !participants.length) return;
    setBusy("subrogations");
    try {
      const zip = new JSZip();
      const pdfs: Uint8Array[] = [];
      for (const participant of participants) {
        const pdf = await generateSubrogationPdf({
          participant,
          amountMad: numberValue(subrogationDraft.amount_mad),
          place: subrogationDraft.place,
          signatureDate: subrogationDraft.signature_date,
          agencyName: "Moroccan Express Travel and Events",
          notes: subrogationDraft.notes,
        });
        pdfs.push(pdf);
        const filename = `subrogation-${fileNameSafe(participant.full_name)}.pdf`;
        zip.file(filename, pdf);
        const path = await uploadGeneratedBytes(pdf, filename, "subrogation", "subrogations", participant.id);
        await db.from("international_payment_subrogations").insert({
          payment_file_id: selectedFile.id,
          participant_id: participant.id ?? null,
          participant_name: participant.full_name,
          amount_mad: numberValue(subrogationDraft.amount_mad),
          place: subrogationDraft.place,
          signature_date: subrogationDraft.signature_date,
          storage_path: path,
          notes: subrogationDraft.notes || null,
          generated_by: user?.id ?? null,
        });
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());
      const zipName = `subrogations-${fileNameSafe(selectedTrip?.title || "voyage")}.zip`;
      const zipUrl = URL.createObjectURL(zipBlob);
      const anchor = document.createElement("a");
      anchor.href = zipUrl;
      anchor.download = zipName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(zipUrl), 1000);
      await uploadGeneratedBytes(zipBytes, zipName, "subrogations_zip", "subrogations");

      const merged = await mergePdfBytes(pdfs);
      const mergedName = `subrogations-fusionnees-${fileNameSafe(selectedTrip?.title || "voyage")}.pdf`;
      downloadBytes(merged, mergedName);
      await uploadGeneratedBytes(merged, mergedName, "subrogations_merged", "subrogations");
      await saveHistory(selectedFile.id, "subrogations_generated", null, { count: participants.length });
      toast.success("Actes de subrogation générés.");
      await loadFileDetails(selectedFile);
    } catch (error: any) {
      toast.error(error.message ?? "Impossible de générer les subrogations.");
    } finally {
      setBusy(null);
    }
  };

  const uploadPartnerAsset = async (file: File, field: "logo" | "stamp" | "default_contract") => {
    setBusy(field);
    const folder = field === "default_contract" ? "contracts" : "partner-assets";
    const path = `${folder}/${Date.now()}-${fileNameSafe(file.name)}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
    if (error) {
      setBusy(null);
      return toast.error(error.message);
    }
    setPartner((current: any) => ({
      ...current,
      [`${field}_path`]: path,
      [`${field}_url`]: path,
    }));
    setBusy(null);
    toast.success("Fichier partenaire prêt à enregistrer.");
  };

  const selectedFilesStats = {
    total: filteredFiles.reduce((sum, file) => sum + numberValue(file.total_invoice_amount), 0),
    paid: filteredFiles.reduce((sum, file) => sum + numberValue(file.amount_already_paid), 0),
  };

  if (loading) {
    return <div className="flex min-h-[420px] items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Chargement…</div>;
  }

  return (
    <div>
      <PageHeader title="Paiements internationaux" description="Préparez les dossiers bancaires, factures, participants et justificatifs pour les paiements fournisseurs Japon." />

      <input
        ref={uploadInputRef}
        type="file"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          const context = uploadContext.current;
          event.target.value = "";
          if (file && context) await uploadDocument(file, context.type, context.folder, context.participantId);
        }}
      />

      <Tabs defaultValue="files" className="space-y-6">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="files"><Banknote className="h-4 w-4" /> Dossiers paiement</TabsTrigger>
          <TabsTrigger value="dashboard"><Plane className="h-4 w-4" /> Dashboard voyages</TabsTrigger>
          <TabsTrigger value="settings"><Settings className="h-4 w-4" /> Partenaire Japon</TabsTrigger>
        </TabsList>

        <TabsContent value="files" className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-4">
            <Metric label="Dossiers affichés" value={filteredFiles.length} />
            <Metric label="Montant total" value={fmtJPY(selectedFilesStats.total)} />
            <Metric label="Déjà payé" value={fmtJPY(selectedFilesStats.paid)} />
            <Metric label="Solde" value={fmtJPY(Math.max(0, selectedFilesStats.total - selectedFilesStats.paid))} />
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <Select value={selectedTripId} onValueChange={setSelectedTripId}>
              <SelectTrigger className="max-w-md"><SelectValue placeholder="Filtrer par voyage" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les voyages</SelectItem>
                {trips.map((trip) => <SelectItem key={trip.id} value={trip.id}>{trip.title}</SelectItem>)}
              </SelectContent>
            </Select>
            <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setFileDraft(emptyFile); }}>
              <DialogTrigger asChild>
                <Button onClick={() => setFileDraft({ ...emptyFile, trip_id: selectedTripId === "all" ? "" : selectedTripId })}>
                  <Plus className="h-4 w-4" /> Nouveau dossier
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
                <DialogHeader><DialogTitle>{fileDraft.id ? "Modifier" : "Créer"} un dossier paiement international</DialogTitle></DialogHeader>
                <PaymentFileForm draft={fileDraft} setDraft={setFileDraft} trips={trips} />
                <DialogFooter><Button onClick={saveFile}><Save className="h-4 w-4" /> Enregistrer</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.6fr)]">
            <Card>
              <CardHeader><CardTitle className="text-base">Dossiers</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {filteredFiles.length === 0 && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Aucun dossier pour ce filtre.</p>}
                {filteredFiles.map((file) => {
                  const trip = trips.find((item) => item.id === file.trip_id);
                  return (
                    <button
                      key={file.id}
                      type="button"
                      onClick={() => setSelectedFileId(file.id)}
                      className={`w-full rounded-xl border p-4 text-left transition hover:border-accent ${selectedFile?.id === file.id ? "border-accent bg-accent/5" : "border-border bg-background"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">{file.payment_reference || file.invoice_number || "Sans référence"}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{trip?.title || "Voyage non renseigné"}</p>
                        </div>
                        <StatusBadge status={file.status} />
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <span>Total: <strong>{fmtJPY(file.total_invoice_amount)}</strong></span>
                        <span>Solde: <strong>{fmtJPY(file.remaining_balance)}</strong></span>
                        <span>Échéance: <strong>{fmtDate(file.due_date)}</strong></span>
                        <span>Fournisseur: <strong>{file.supplier_name || "—"}</strong></span>
                      </div>
                    </button>
                  );
                })}
              </CardContent>
            </Card>

            {selectedFile ? (
              <div className="space-y-6">
                <Card>
                  <CardHeader className="flex-row items-start justify-between space-y-0">
                    <div>
                      <CardTitle>{selectedFile.payment_reference || selectedFile.invoice_number || "Dossier paiement"}</CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">{selectedTrip?.title || "Voyage"} · {selectedFile.supplier_name}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => { setFileDraft(selectedFile); setDialogOpen(true); }}>Modifier</Button>
                      <StatusBadge status={selectedFile.status} />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="grid gap-3 md:grid-cols-4">
                      <Metric label="Facture" value={fmtJPY(selectedFile.total_invoice_amount)} />
                      <Metric label="À payer maintenant" value={fmtJPY(selectedFile.amount_to_pay_now)} />
                      <Metric label="Déjà payé" value={fmtJPY(selectedFile.amount_already_paid)} />
                      <Metric label="Reste" value={fmtJPY(selectedFile.remaining_balance)} />
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="font-medium">Checklist bancaire</span>
                        <span>{currentCompletion.percent}%</span>
                      </div>
                      <Progress value={currentCompletion.percent} />
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {checklistItems.map(([key, label]) => {
                          const ok = currentCompletion.complete[key];
                          return (
                            <div key={key} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                              {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-amber-600" />}
                              <span>{label}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Tabs defaultValue="invoice" className="space-y-4">
                  <TabsList className="flex h-auto flex-wrap justify-start">
                    <TabsTrigger value="invoice">Facture</TabsTrigger>
                    <TabsTrigger value="participants">Participants</TabsTrigger>
                    <TabsTrigger value="subrogations">Subrogations</TabsTrigger>
                    <TabsTrigger value="documents">Documents</TabsTrigger>
                    <TabsTrigger value="history">Historique</TabsTrigger>
                  </TabsList>

                  <TabsContent value="invoice">
                    <Card>
                      <CardHeader><CardTitle className="text-base">Génération facture fournisseur</CardTitle></CardHeader>
                      <CardContent className="grid gap-4 md:grid-cols-4">
                        <Field label="Participants"><Input type="number" value={invoiceDraft.participant_count} onChange={(event) => setInvoiceDraft((current) => ({ ...current, participant_count: event.target.value }))} /></Field>
                        <Field label="Prix unitaire JPY"><Input type="number" value={invoiceDraft.unit_price_jpy} onChange={(event) => setInvoiceDraft((current) => ({ ...current, unit_price_jpy: event.target.value }))} /></Field>
                        <Field label="Taxe %"><Input type="number" value={invoiceDraft.tax_percent} onChange={(event) => setInvoiceDraft((current) => ({ ...current, tax_percent: event.target.value }))} /></Field>
                        <div className="flex items-end"><Button className="w-full" onClick={generateInvoice} disabled={busy === "invoice"}><FileText className="h-4 w-4" /> Générer facture</Button></div>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="participants">
                    <Card>
                      <CardHeader className="flex-row items-center justify-between space-y-0">
                        <CardTitle className="text-base">Liste participants</CardTitle>
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" onClick={() => exportParticipants("pdf")}><Download className="h-4 w-4" /> PDF</Button>
                          <Button variant="outline" size="sm" onClick={() => exportParticipants("excel")}><Download className="h-4 w-4" /> Excel</Button>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <ParticipantsTable participants={participants} />
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="subrogations">
                    <Card>
                      <CardHeader><CardTitle className="text-base">Actes de subrogation</CardTitle></CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-4">
                          <Field label="Montant MAD / participant"><Input type="number" value={subrogationDraft.amount_mad} onChange={(event) => setSubrogationDraft((current) => ({ ...current, amount_mad: event.target.value }))} /></Field>
                          <Field label="Fait à"><Input value={subrogationDraft.place} onChange={(event) => setSubrogationDraft((current) => ({ ...current, place: event.target.value }))} /></Field>
                          <Field label="Date signature"><Input type="date" value={subrogationDraft.signature_date} onChange={(event) => setSubrogationDraft((current) => ({ ...current, signature_date: event.target.value }))} /></Field>
                          <div className="flex items-end"><Button className="w-full" onClick={generateSubrogations} disabled={busy === "subrogations"}><FileArchive className="h-4 w-4" /> Générer</Button></div>
                          <Field label="Notes" className="md:col-span-4"><Textarea value={subrogationDraft.notes} onChange={(event) => setSubrogationDraft((current) => ({ ...current, notes: event.target.value }))} /></Field>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="documents">
                    <Card>
                      <CardHeader><CardTitle className="text-base">Documents du dossier bancaire</CardTitle></CardHeader>
                      <CardContent className="space-y-4">
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" onClick={() => openUpload("contract", "contracts")}><Upload className="h-4 w-4" /> Contrat</Button>
                          <Button variant="outline" onClick={() => openUpload("flight_ticket", "tickets")}><Upload className="h-4 w-4" /> Billets d'avion</Button>
                          <Button variant="outline" onClick={() => openUpload("payment_proof", "payment-proofs")}><Upload className="h-4 w-4" /> Preuve paiement</Button>
                          <Button variant="outline" onClick={() => openUpload("passport_copy", "passports")}><Upload className="h-4 w-4" /> Copies passeports</Button>
                          <Button variant="outline" onClick={() => openUpload("other", "other")}><Upload className="h-4 w-4" /> Autre</Button>
                        </div>
                        <DocumentsList docs={currentDocuments} onDownload={signedDownload} />
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="history">
                    <Card>
                      <CardHeader><CardTitle className="text-base">Historique</CardTitle></CardHeader>
                      <CardContent className="space-y-3">
                        {currentHistory.length === 0 && <p className="text-sm text-muted-foreground">Aucun événement.</p>}
                        {currentHistory.map((event) => (
                          <div key={event.id} className="rounded-lg border border-border p-3 text-sm">
                            <div className="flex justify-between gap-3">
                              <p className="font-semibold">{event.action}</p>
                              <p className="text-xs text-muted-foreground">{fmtDate(event.created_at)}</p>
                            </div>
                            {event.notes && <p className="mt-1 text-muted-foreground">{event.notes}</p>}
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              </div>
            ) : (
              <Card><CardContent className="p-10 text-center text-muted-foreground">Sélectionnez ou créez un dossier paiement.</CardContent></Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="dashboard">
          <Card>
            <CardHeader><CardTitle>Dashboard par voyage</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-secondary/60 text-left">
                  <tr>
                    <th className="p-3">Voyage</th><th className="p-3">Montant fournisseur</th><th className="p-3">Payé</th><th className="p-3">Reste</th><th className="p-3">Dossiers</th><th className="p-3">Prochaine échéance</th><th className="p-3">Statuts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tripDashboard.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Aucun dossier paiement créé.</td></tr>}
                  {tripDashboard.map((row) => (
                    <tr key={row.trip.id}>
                      <td className="p-3 font-medium">{row.trip.title}</td>
                      <td className="p-3">{fmtJPY(row.total)}</td>
                      <td className="p-3 text-emerald-700">{fmtJPY(row.paid)}</td>
                      <td className="p-3 text-amber-700">{fmtJPY(row.remaining)}</td>
                      <td className="p-3">{row.count}</td>
                      <td className="p-3">{fmtDate(row.nextDueDate)}</td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {statuses.filter((status) => row.statuses[status]).map((status) => <Badge key={status} variant="secondary">{statusLabels[status]}: {row.statuses[status]}</Badge>)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <Card>
            <CardHeader><CardTitle>Paramètres partenaire Japon</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-3">
                {[
                  ["partner_name", "Nom partenaire"],
                  ["email", "Email"],
                  ["phone", "Téléphone"],
                  ["registration_number", "N° enregistrement"],
                  ["corporate_number", "Corporate number"],
                  ["bank_name", "Banque"],
                  ["bank_code", "Code banque"],
                  ["branch_code", "Code agence"],
                  ["branch_name", "Nom agence"],
                  ["account_type", "Type compte"],
                  ["account_number", "N° compte"],
                  ["account_name", "Nom compte"],
                ].map(([key, label]) => (
                  <Field key={key} label={label}><Input value={partner?.[key] ?? ""} onChange={(event) => setPartner((current: any) => ({ ...current, [key]: event.target.value }))} /></Field>
                ))}
                <Field label="Adresse" className="md:col-span-3"><Textarea rows={3} value={partner?.address ?? ""} onChange={(event) => setPartner((current: any) => ({ ...current, address: event.target.value }))} /></Field>
              </div>
              <div className="flex flex-wrap gap-2">
                <PartnerUpload label="Logo" onFile={(file) => uploadPartnerAsset(file, "logo")} />
                <PartnerUpload label="Cachet" onFile={(file) => uploadPartnerAsset(file, "stamp")} />
                <PartnerUpload label="Contrat PDF par défaut" onFile={(file) => uploadPartnerAsset(file, "default_contract")} />
              </div>
              <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
                <p>Logo: {partner.logo_path || "Non renseigné"}</p>
                <p>Cachet: {partner.stamp_path || "Non renseigné"}</p>
                <p>Contrat: {partner.default_contract_path || "Non renseigné"}</p>
              </div>
              <Button onClick={savePartner} disabled={busy === "partner"}><Save className="h-4 w-4" /> Enregistrer partenaire</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><Label>{label}</Label><div className="mt-1.5">{children}</div></div>;
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 font-display text-xl">{value}</p>
      </CardContent>
    </Card>
  );
}

function PaymentFileForm({ draft, setDraft, trips }: { draft: any; setDraft: (updater: any) => void; trips: any[] }) {
  const update = (key: string, value: unknown) => setDraft((current: any) => ({ ...current, [key]: value }));
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Voyage" className="md:col-span-2">
        <Select value={draft.trip_id} onValueChange={(value) => update("trip_id", value)}>
          <SelectTrigger><SelectValue placeholder="Choisir voyage" /></SelectTrigger>
          <SelectContent>{trips.map((trip) => <SelectItem key={trip.id} value={trip.id}>{trip.title}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label="Partenaire / fournisseur"><Input value={draft.supplier_name ?? ""} onChange={(event) => update("supplier_name", event.target.value)} /></Field>
      <Field label="Référence paiement"><Input value={draft.payment_reference ?? ""} onChange={(event) => update("payment_reference", event.target.value)} /></Field>
      <Field label="N° facture"><Input value={draft.invoice_number ?? ""} onChange={(event) => update("invoice_number", event.target.value)} /></Field>
      <Field label="Devise"><Input value={draft.currency ?? "JPY"} onChange={(event) => update("currency", event.target.value)} /></Field>
      <Field label="Date émission"><Input type="date" value={draft.issue_date ?? ""} onChange={(event) => update("issue_date", event.target.value || null)} /></Field>
      <Field label="Date échéance"><Input type="date" value={draft.due_date ?? ""} onChange={(event) => update("due_date", event.target.value || null)} /></Field>
      <Field label="Montant facture JPY"><Input type="number" value={draft.total_invoice_amount ?? 0} onChange={(event) => update("total_invoice_amount", event.target.value)} /></Field>
      <Field label="% paiement"><Input type="number" value={draft.payment_percentage ?? 100} onChange={(event) => update("payment_percentage", event.target.value)} /></Field>
      <Field label="Déjà payé JPY"><Input type="number" value={draft.amount_already_paid ?? 0} onChange={(event) => update("amount_already_paid", event.target.value)} /></Field>
      <Field label="Statut">
        <Select value={draft.status ?? "draft"} onValueChange={(value) => update("status", value)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{statuses.map((status) => <SelectItem key={status} value={status}>{statusLabels[status]}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label="Notes" className="md:col-span-2"><Textarea rows={3} value={draft.notes ?? ""} onChange={(event) => update("notes", event.target.value)} /></Field>
    </div>
  );
}

function ParticipantsTable({ participants }: { participants: InternationalPaymentParticipant[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1000px] text-sm">
        <thead className="bg-secondary/60 text-left">
          <tr>
            <th className="p-3">Nom</th><th className="p-3">Passeport</th><th className="p-3">Nationalité</th><th className="p-3">Naissance</th><th className="p-3">Réservation</th><th className="p-3">Chambre</th><th className="p-3">Copie passeport</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {participants.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Aucun participant trouvé pour ce voyage.</td></tr>}
          {participants.map((participant: any) => (
            <tr key={participant.id || participant.full_name}>
              <td className="p-3 font-medium">{participant.full_name}</td>
              <td className="p-3">{participant.passport_no || "—"}</td>
              <td className="p-3">{participant.nationality || "—"}</td>
              <td className="p-3">{fmtDate(participant.date_of_birth)}</td>
              <td className="p-3">{participant.booking_reference || "—"}</td>
              <td className="p-3">{participant.room_type || "—"}</td>
              <td className="p-3">{participant.passport_copy_path ? <Badge variant="secondary">OK</Badge> : <Badge variant="destructive">Copie passeport manquante</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DocumentsList({ docs, onDownload }: { docs: any[]; onDownload: (doc: any) => void }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-secondary/60 text-left">
          <tr><th className="p-3">Type</th><th className="p-3">Fichier</th><th className="p-3">Date</th><th className="p-3"></th></tr>
        </thead>
        <tbody className="divide-y divide-border">
          {docs.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">Aucun document.</td></tr>}
          {docs.map((doc) => (
            <tr key={doc.id}>
              <td className="p-3">{documentTypeLabels[doc.document_type] ?? doc.document_type}</td>
              <td className="p-3 font-medium">{doc.file_name}</td>
              <td className="p-3">{fmtDate(doc.created_at)}</td>
              <td className="p-3 text-right"><Button size="sm" variant="outline" onClick={() => onDownload(doc)}><Download className="h-4 w-4" /> Ouvrir</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PartnerUpload({ label, onFile }: { label: string; onFile: (file: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onFile(file); }} />
      <Button type="button" variant="outline" onClick={() => ref.current?.click()}><Upload className="h-4 w-4" /> {label}</Button>
    </>
  );
}
