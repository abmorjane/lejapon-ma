import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { toast } from "sonner";
import {
  Banknote,
  CheckCircle2,
  Download,
  Edit3,
  Eye,
  FileArchive,
  FileText,
  Loader2,
  Plane,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  Users,
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
  type JapanSupplier,
} from "@/lib/international-payments";

const db = supabase as any;
const bucket = "international-payments";

const statuses = [
  "draft",
  "created",
  "submitted_to_bank",
  "bank_review",
  "approved",
  "partially_paid",
  "paid",
  "rejected",
  "cancelled",
] as const;

const statusLabels: Record<string, string> = {
  draft: "Brouillon",
  created: "Créé",
  submitted_to_bank: "Déposé banque",
  bank_review: "Revue banque",
  approved: "Approuvé",
  partially_paid: "Partiellement payé",
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
  supplier_id: "",
  supplier_name: "",
  payment_reference: "",
  invoice_number: "",
  issue_date: new Date().toISOString().slice(0, 10),
  due_date: "",
  currency: "JPY",
  total_invoice_amount: 0,
  unit_price_jpy: 0,
  tax_percent: 0,
  payment_percentage: 50,
  amount_already_paid: 0,
  notes: "",
  status: "draft",
};

const emptyParticipant: InternationalPaymentParticipant = {
  full_name: "",
  passport_no: "",
  nationality: "",
  birth_date: "",
  booking_reference: "",
  room_type: "",
  cin: "",
  address: "",
  city: "",
  passport_copy_path: "",
};

const supplierCategoryLabels: Record<string, string> = {
  main_partner: "Bureau Japon principal",
  hotel: "Hôtel",
  bus: "Bus / transport",
  transport: "Transport",
  guide: "Guide",
  activity: "Activité",
  restaurant: "Restaurant",
  other: "Autre fournisseur",
};

const numberValue = (value: unknown) => Number(value || 0);
const fullName = (p: any) => [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || p.full_name || "Participant";
const fileNameSafe = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "dossier";

const bookingRoomPreference = (booking: any) => {
  const metadata = booking?.metadata && typeof booking.metadata === "object" ? booking.metadata : {};
  return metadata.room_preference || metadata.room_type || metadata.accommodation_type || booking?.room_type || null;
};

const conflictTargetMissing = (error: any) =>
  /on conflict|matching unique|unique constraint|42P10/i.test(`${error?.code ?? ""} ${error?.message ?? ""}`);

const samePassport = (left?: string | null, right?: string | null) => {
  const normalize = (value?: string | null) => String(value ?? "").replace(/[\s-]+/g, "").toUpperCase();
  const a = normalize(left);
  const b = normalize(right);
  return Boolean(a && b && a === b);
};

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
    contract: docTypes.has("contract") || Boolean(file?.metadata?.partner_contract_path || file?.supplier_snapshot?.contract_path),
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
  const [suppliers, setSuppliers] = useState<JapanSupplier[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [participants, setParticipants] = useState<InternationalPaymentParticipant[]>([]);
  const [participantDraft, setParticipantDraft] = useState<InternationalPaymentParticipant>(emptyParticipant);
  const [participantDialogOpen, setParticipantDialogOpen] = useState(false);
  const [participantsSqlMissing, setParticipantsSqlMissing] = useState(false);
  const [selectedTripId, setSelectedTripId] = useState<string>("all");
  const [selectedFileId, setSelectedFileId] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [fileDraft, setFileDraft] = useState<any>(emptyFile);
  const [invoiceDraft, setInvoiceDraft] = useState({
    invoice_number: "",
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: "",
    participant_count: "0",
    unit_price_jpy: "0",
    tax_percent: "0",
    payment_percentage: "50",
    override_count: false,
  });
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
  const selectedSupplier = suppliers.find((supplier) => supplier.id === selectedFile?.supplier_id)
    ?? suppliers.find((supplier) => supplier.name === selectedFile?.supplier_name)
    ?? (selectedFile?.supplier_snapshot && Object.keys(selectedFile.supplier_snapshot).length ? selectedFile.supplier_snapshot as JapanSupplier : null);
  const currentDocuments = documents.filter((doc) => doc.payment_file_id === selectedFile?.id);
  const currentHistory = history.filter((row) => row.payment_file_id === selectedFile?.id);
  const currentCompletion = completion(selectedFile, currentDocuments, participants);
  const passportCompletion = participants.length ? Math.round((participants.filter((participant) => participant.passport_copy_path).length / participants.length) * 100) : 0;
  const paymentProgress = numberValue(selectedFile?.total_invoice_amount) > 0
    ? Math.min(100, Math.round((numberValue(selectedFile?.amount_already_paid) / numberValue(selectedFile?.total_invoice_amount)) * 100))
    : 0;

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
    const [tripResult, fileResult, supplierResult] = await Promise.all([
      supabase.from("trips").select("id,title,season,start_date,end_date,duration_days").order("start_date", { ascending: false, nullsFirst: false }),
      db.from("international_payment_files").select("*").order("created_at", { ascending: false }),
      db.from("japan_suppliers").select("*").order("status", { ascending: true }).order("name", { ascending: true }),
    ]);
    setTrips(tripResult.data ?? []);
    setFiles(fileResult.data ?? []);
    if (supplierResult.error) {
      toast.error("Migration fournisseurs Bureau Japon requise.");
      setSuppliers([]);
    } else {
      setSuppliers(supplierResult.data ?? []);
    }
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
    const [{ data: docs }, { data: events }, participantResult] = await Promise.all([
      db.from("international_payment_file_documents").select("*").eq("payment_file_id", file.id).order("created_at", { ascending: false }),
      db.from("international_payment_history").select("*").eq("payment_file_id", file.id).order("created_at", { ascending: false }),
      db.from("international_payment_participants").select("*").eq("payment_file_id", file.id).order("created_at", { ascending: true }),
    ]);
    setDocuments(docs ?? []);
    setHistory(events ?? []);
    if (participantResult.error) {
      setParticipantsSqlMissing(true);
      setParticipants([]);
      return;
    }
    setParticipantsSqlMissing(false);
    const mapped = (participantResult.data ?? []).map((participant: any) => ({
      ...participant,
      date_of_birth: participant.birth_date,
    })) as InternationalPaymentParticipant[];
    setParticipants(mapped);
    setInvoiceDraft((current) => ({
      ...current,
      invoice_number: file.invoice_number ?? current.invoice_number,
      issue_date: file.issue_date ?? current.issue_date,
      due_date: file.due_date ?? current.due_date,
      participant_count: current.override_count ? current.participant_count : String(mapped.length),
      unit_price_jpy: String(file.unit_price_jpy ?? current.unit_price_jpy ?? "0"),
      tax_percent: String(file.tax_percent ?? current.tax_percent ?? "0"),
      payment_percentage: String(file.payment_percentage ?? current.payment_percentage ?? "50"),
    }));
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

  const syncImportedParticipants = async (rows: any[]) => {
    const { error: upsertError } = await db
      .from("international_payment_participants")
      .upsert(rows, { onConflict: "payment_file_id,source_participant_id" });

    if (!upsertError) return;
    if (!conflictTargetMissing(upsertError)) throw upsertError;

    const paymentFileId = rows[0]?.payment_file_id;
    if (!paymentFileId) throw upsertError;

    const { data: existingRows, error: existingError } = await db
      .from("international_payment_participants")
      .select("*")
      .eq("payment_file_id", paymentFileId);
    if (existingError) throw existingError;

    for (const row of rows) {
      const existing = (existingRows ?? []).find((item: any) =>
        (row.source_participant_id && item.source_participant_id === row.source_participant_id)
        || (!row.source_participant_id && samePassport(item.passport_no, row.passport_no))
      );
      if (existing?.id) {
        const { error } = await db.from("international_payment_participants").update(row).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await db.from("international_payment_participants").insert(row);
        if (error) throw error;
      }
    }
  };

  const supplierSnapshot = (supplierId?: string | null) => {
    const supplier = suppliers.find((item) => item.id === supplierId);
    if (!supplier) return {};
    return {
      id: supplier.id,
      name: supplier.name,
      category: supplier.category,
      address: supplier.address,
      email: supplier.email,
      phone: supplier.phone,
      website: supplier.website,
      bank_name: supplier.bank_name,
      branch_name: supplier.branch_name,
      bank_code: supplier.bank_code,
      branch_code: supplier.branch_code,
      account_type: supplier.account_type,
      account_number: supplier.account_number,
      account_holder: supplier.account_holder,
      logo_path: supplier.logo_path,
      stamp_path: supplier.stamp_path,
      contract_path: supplier.contract_path,
      invoice_template_path: supplier.invoice_template_path,
    };
  };

  const saveFile = async () => {
    if (!fileDraft.trip_id) return toast.error("Choisissez un voyage.");
    if (!fileDraft.supplier_id) return toast.error("Choisissez un fournisseur Japon.");
    const supplier = suppliers.find((item) => item.id === fileDraft.supplier_id);
    const payload = {
      ...fileDraft,
      supplier_name: supplier?.name ?? fileDraft.supplier_name ?? "",
      supplier_snapshot: supplierSnapshot(fileDraft.supplier_id),
      total_invoice_amount: numberValue(fileDraft.total_invoice_amount),
      unit_price_jpy: numberValue(fileDraft.unit_price_jpy),
      tax_percent: numberValue(fileDraft.tax_percent),
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

  const importParticipantsFromTrip = async () => {
    if (!selectedFile?.id || !selectedFile.trip_id) return;
    setBusy("import-participants");
    try {
      let bookingResult = await supabase
        .from("bookings")
        .select("id,reference,contact_name,trip_id,room_type,metadata")
        .eq("trip_id", selectedFile.trip_id);
      if (bookingResult.error && /metadata|column .* does not exist|schema cache/i.test(bookingResult.error.message)) {
        bookingResult = await supabase
          .from("bookings")
          .select("id,reference,contact_name,trip_id,room_type")
          .eq("trip_id", selectedFile.trip_id);
      }
      if (bookingResult.error) throw bookingResult.error;
      const bookingRows = bookingResult.data ?? [];
      const bookingIds = bookingRows.map((booking: any) => booking.id);
      if (!bookingIds.length) {
        toast.warning("Aucune réservation trouvée pour ce voyage.");
        setBusy(null);
        return;
      }

      const { data: partRows, error: partError } = await db.from("booking_participants").select("*").in("booking_id", bookingIds);
      if (partError) throw partError;

      const { data: hotelRows } = await db.from("trip_hotels").select("id").eq("trip_id", selectedFile.trip_id);
      const hotelIds = (hotelRows ?? []).map((hotel: any) => hotel.id);
      const { data: roomRows } = hotelIds.length
        ? await db.from("trip_rooms").select("*").in("trip_hotel_id", hotelIds)
        : { data: [] as any[] };
      const roomIds = (roomRows ?? []).map((room: any) => room.id);
      const { data: assignmentRows } = roomIds.length
        ? await db.from("room_assignments").select("*").in("room_id", roomIds)
        : { data: [] as any[] };

      const mapped = (partRows ?? []).map((participant: any) => {
        const booking = bookingRows.find((item: any) => item.id === participant.booking_id);
        const assignment = (assignmentRows ?? []).find((item: any) => item.participant_id === participant.id);
        const room = (roomRows ?? []).find((item: any) => item.id === assignment?.room_id);
        return {
          payment_file_id: selectedFile.id,
          source_participant_id: participant.id,
          full_name: fullName(participant),
          passport_no: participant.passport_no || participant.passport_number || participant.document_number || null,
          nationality: participant.nationality || null,
          birth_date: participant.date_of_birth || participant.birthdate || null,
          booking_reference: booking?.reference || null,
          room_type: room?.room_type || participant.room_type || bookingRoomPreference(booking) || null,
          cin: participant.cin || participant.national_id_number || null,
          address: participant.address || null,
          city: participant.city || null,
          passport_copy_path: passportCopyPath(participant),
          created_by: user?.id ?? null,
          metadata: {
            imported_from_trip_operations: true,
            booking_id: participant.booking_id,
            room_id: room?.id ?? null,
            room_number: room?.room_number ?? room?.room_name ?? null,
          },
        };
      });

      if (!mapped.length) {
        toast.warning("Aucun participant opérationnel trouvé pour ce voyage.");
        setBusy(null);
        return;
      }

      await syncImportedParticipants(mapped);

      await db.from("international_payment_files").update({ participants_count: mapped.length }).eq("id", selectedFile.id);
      await saveHistory(selectedFile.id, "participants_imported_from_trip", null, { count: mapped.length });
      toast.success(`${mapped.length} participant(s) importé(s).`);
      await loadFileDetails(selectedFile);
      await load();
    } catch (error: any) {
      toast.error(error?.message ?? "Import participants impossible.");
    } finally {
      setBusy(null);
    }
  };

  const saveParticipant = async () => {
    if (!selectedFile?.id) return;
    if (!participantDraft.full_name?.trim()) return toast.error("Nom participant requis.");
    setBusy("participant");
    const payload = {
      payment_file_id: selectedFile.id,
      source_participant_id: participantDraft.source_participant_id ?? null,
      full_name: participantDraft.full_name,
      passport_no: participantDraft.passport_no || null,
      nationality: participantDraft.nationality || null,
      birth_date: participantDraft.birth_date || participantDraft.date_of_birth || null,
      booking_reference: participantDraft.booking_reference || null,
      room_type: participantDraft.room_type || null,
      cin: participantDraft.cin || null,
      address: participantDraft.address || null,
      city: participantDraft.city || null,
      passport_copy_path: participantDraft.passport_copy_path || null,
      created_by: user?.id ?? null,
    };
    const request = participantDraft.id
      ? db.from("international_payment_participants").update(payload).eq("id", participantDraft.id)
      : db.from("international_payment_participants").insert(payload);
    const { error } = await request;
    setBusy(null);
    if (error) return toast.error(error.message);
    await saveHistory(selectedFile.id, participantDraft.id ? "participant_updated" : "participant_added", null, payload);
    setParticipantDialogOpen(false);
    setParticipantDraft(emptyParticipant);
    toast.success("Participant enregistré.");
    await loadFileDetails(selectedFile);
  };

  const deleteParticipant = async (participant: InternationalPaymentParticipant) => {
    if (!selectedFile?.id || !participant.id) return;
    const { error } = await db.from("international_payment_participants").delete().eq("id", participant.id);
    if (error) return toast.error(error.message);
    await saveHistory(selectedFile.id, "participant_deleted", participant, null);
    toast.success("Participant supprimé.");
    await loadFileDetails(selectedFile);
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

  const openSupplierAsset = async (path?: string | null) => {
    if (!path) return;
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 120);
    if (error) return toast.error(error.message);
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const generateInvoice = async () => {
    if (!selectedFile) return;
    if (!selectedSupplier) return toast.error("Choisissez un fournisseur avant de générer la facture.");
    setBusy("invoice");
    try {
      const participantCount = numberValue(invoiceDraft.participant_count || participants.length);
      const unitPriceJpy = numberValue(invoiceDraft.unit_price_jpy);
      const taxPercent = numberValue(invoiceDraft.tax_percent);
      const subtotal = participantCount * unitPriceJpy;
      const tax = Math.round(subtotal * taxPercent / 100);
      const total = subtotal + tax;
      const paymentPercentage = numberValue(invoiceDraft.payment_percentage);
      const amountToPayNow = Math.round(total * paymentPercentage / 100);
      const fileForPdf = {
        ...selectedFile,
        invoice_number: invoiceDraft.invoice_number || selectedFile.invoice_number,
        issue_date: invoiceDraft.issue_date || selectedFile.issue_date,
        due_date: invoiceDraft.due_date || selectedFile.due_date,
        unit_price_jpy: unitPriceJpy,
        tax_percent: taxPercent,
        total_invoice_amount: total,
        payment_percentage: paymentPercentage,
        amount_to_pay_now: amountToPayNow,
        remaining_balance: Math.max(0, total - numberValue(selectedFile.amount_already_paid)),
      };
      const { data: updatedFile, error: updateError } = await db
        .from("international_payment_files")
        .update({
          invoice_number: fileForPdf.invoice_number,
          issue_date: fileForPdf.issue_date,
          due_date: fileForPdf.due_date,
          unit_price_jpy: unitPriceJpy,
          tax_percent: taxPercent,
          total_invoice_amount: total,
          payment_percentage: paymentPercentage,
          amount_already_paid: numberValue(selectedFile.amount_already_paid),
          participants_count: participantCount,
        })
        .eq("id", selectedFile.id)
        .select("*")
        .single();
      if (updateError) throw updateError;
      const pdf = await generateInternationalInvoicePdf({
        file: updatedFile ?? fileForPdf,
        supplier: selectedSupplier,
        tripTitle: selectedTrip?.title ?? "Voyage Japon",
        participantCount,
        unitPriceJpy,
        taxPercent,
      });
      const filename = `facture-${fileForPdf.invoice_number || selectedFile.payment_reference || selectedFile.id}.pdf`;
      downloadBytes(pdf, filename);
      await uploadGeneratedBytes(pdf, filename, "invoice", "invoices");
      await saveHistory(selectedFile.id, "invoice_generated", null, { filename, total, amount_to_pay_now: amountToPayNow });
      toast.success("Facture générée.");
      await load();
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
            Naissance: fmtDate(participant.birth_date || participant.date_of_birth),
            Reservation: participant.booking_reference,
            Chambre: participant.room_type,
            Passeport_manquant: participant.passport_copy_path ? "Non" : "Oui",
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
    if (participants.some((participant) => !participant.id)) {
      toast.error("Participant non enregistré dans le dossier paiement.");
      return;
    }
    setBusy("subrogations");
    try {
      const zip = new JSZip();
      const pdfs: Uint8Array[] = [];
      for (const participant of participants) {
        if (!participant.id) throw new Error("Participant non enregistré dans le dossier paiement.");
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
        const { error: subrogationError } = await db.from("international_payment_subrogations").insert({
          payment_file_id: selectedFile.id,
          participant_id: participant.id,
          participant_name: participant.full_name,
          amount_mad: numberValue(subrogationDraft.amount_mad),
          place: subrogationDraft.place,
          signature_date: subrogationDraft.signature_date,
          storage_path: path,
          notes: subrogationDraft.notes || null,
          generated_by: user?.id ?? null,
        });
        if (subrogationError) throw subrogationError;
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

      <Dialog open={participantDialogOpen} onOpenChange={setParticipantDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>{participantDraft.id ? "Modifier" : "Ajouter"} un participant</DialogTitle></DialogHeader>
          <ParticipantForm draft={participantDraft} setDraft={setParticipantDraft} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setParticipantDialogOpen(false)}>Annuler</Button>
            <Button onClick={saveParticipant} disabled={busy === "participant"}><Save className="h-4 w-4" /> Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Tabs defaultValue="files" className="space-y-6">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="files"><Banknote className="h-4 w-4" /> Dossiers paiement</TabsTrigger>
          <TabsTrigger value="dashboard"><Plane className="h-4 w-4" /> Dashboard voyages</TabsTrigger>
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
                <PaymentFileForm draft={fileDraft} setDraft={setFileDraft} trips={trips} suppliers={suppliers} />
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
                    <div className="grid gap-3 md:grid-cols-4">
                      <Metric label="Participants" value={participants.length} />
                      <Metric label="Passeports complets" value={`${passportCompletion}%`} />
                      <Metric label="Checklist dossier" value={`${currentCompletion.percent}%`} />
                      <Metric label="Paiement" value={`${paymentProgress}%`} />
                    </div>
                    <div className="grid gap-4 rounded-xl border border-border bg-secondary/20 p-4 md:grid-cols-[96px_1fr_1fr]">
                      <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border bg-background">
                        {selectedSupplier?.logo_url || selectedSupplier?.logo_path ? (
                          <img src={String(selectedSupplier.logo_url || selectedSupplier.logo_path)} alt="Logo fournisseur" className="h-full w-full object-contain p-2" />
                        ) : (
                          <Users className="h-7 w-7 text-muted-foreground" />
                        )}
                      </div>
                      <div className="text-sm">
                        <p className="font-semibold">{selectedSupplier?.name || selectedFile.supplier_name || "Fournisseur non renseigné"}</p>
                        <p className="text-muted-foreground">{supplierCategoryLabels[String(selectedSupplier?.category || "other")] ?? selectedSupplier?.category ?? "Fournisseur"}</p>
                        <p className="mt-2 text-muted-foreground">{selectedSupplier?.email || "Email non renseigné"} · {selectedSupplier?.phone || "Téléphone non renseigné"}</p>
                      </div>
                      <div className="text-sm">
                        <p className="font-medium">Contrat fournisseur</p>
                        {selectedSupplier?.contract_path ? (
                          <Button variant="outline" size="sm" className="mt-2" onClick={() => openSupplierAsset(selectedSupplier.contract_path)}>
                            <Eye className="h-4 w-4" /> Aperçu contrat
                          </Button>
                        ) : (
                          <p className="mt-1 text-amber-700">Contrat non renseigné</p>
                        )}
                        <p className="mt-2 text-muted-foreground">Banque: {selectedSupplier?.bank_name || "Non renseignée"}</p>
                      </div>
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
                      <CardContent className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-3">
                          <Field label="N° facture"><Input value={invoiceDraft.invoice_number} onChange={(event) => setInvoiceDraft((current) => ({ ...current, invoice_number: event.target.value }))} /></Field>
                          <Field label="Date facture"><Input type="date" value={invoiceDraft.issue_date} onChange={(event) => setInvoiceDraft((current) => ({ ...current, issue_date: event.target.value }))} /></Field>
                          <Field label="Date échéance"><Input type="date" value={invoiceDraft.due_date} onChange={(event) => setInvoiceDraft((current) => ({ ...current, due_date: event.target.value }))} /></Field>
                          <Field label="Participants">
                            <Input type="number" value={invoiceDraft.participant_count} onChange={(event) => setInvoiceDraft((current) => ({ ...current, participant_count: event.target.value, override_count: true }))} />
                          </Field>
                          <Field label="Prix unitaire JPY"><Input type="number" value={invoiceDraft.unit_price_jpy} onChange={(event) => setInvoiceDraft((current) => ({ ...current, unit_price_jpy: event.target.value }))} /></Field>
                          <Field label="Taxe %"><Input type="number" value={invoiceDraft.tax_percent} onChange={(event) => setInvoiceDraft((current) => ({ ...current, tax_percent: event.target.value }))} /></Field>
                          <Field label="% paiement"><Input type="number" value={invoiceDraft.payment_percentage} onChange={(event) => setInvoiceDraft((current) => ({ ...current, payment_percentage: event.target.value }))} /></Field>
                          <div className="rounded-lg border border-border p-3 text-sm md:col-span-2">
                            <p>Sous-total: <strong>{fmtJPY(numberValue(invoiceDraft.participant_count) * numberValue(invoiceDraft.unit_price_jpy))}</strong></p>
                            <p>Taxe: <strong>{fmtJPY(Math.round(numberValue(invoiceDraft.participant_count) * numberValue(invoiceDraft.unit_price_jpy) * numberValue(invoiceDraft.tax_percent) / 100))}</strong></p>
                            <p>Montant dû maintenant: <strong>{fmtJPY(Math.round((numberValue(invoiceDraft.participant_count) * numberValue(invoiceDraft.unit_price_jpy) * (1 + numberValue(invoiceDraft.tax_percent) / 100)) * numberValue(invoiceDraft.payment_percentage) / 100))}</strong></p>
                          </div>
                        </div>
                        <Button onClick={generateInvoice} disabled={busy === "invoice"}><FileText className="h-4 w-4" /> Générer facture</Button>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="participants">
                    <Card>
                      <CardHeader className="flex-row items-center justify-between space-y-0">
                        <div>
                          <CardTitle className="text-base">Liste participants</CardTitle>
                          <p className="mt-1 text-sm text-muted-foreground">{participants.length} participant(s) · passeports {passportCompletion}%</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" onClick={importParticipantsFromTrip} disabled={busy === "import-participants"}>
                            <RefreshCw className="h-4 w-4" /> Importer depuis le voyage
                          </Button>
                          <Button size="sm" onClick={() => { setParticipantDraft(emptyParticipant); setParticipantDialogOpen(true); }}>
                            <Plus className="h-4 w-4" /> Ajouter
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => exportParticipants("pdf")}><Download className="h-4 w-4" /> PDF</Button>
                          <Button variant="outline" size="sm" onClick={() => exportParticipants("excel")}><Download className="h-4 w-4" /> Excel</Button>
                        </div>
                      </CardHeader>
                      <CardContent>
                        {participantsSqlMissing && (
                          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                            Migration SQL V2 requise pour enregistrer les participants du dossier bancaire.
                          </div>
                        )}
                        <ParticipantsTable
                          participants={participants}
                          onEdit={(participant) => { setParticipantDraft(participant); setParticipantDialogOpen(true); }}
                          onDelete={deleteParticipant}
                        />
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

function PaymentFileForm({ draft, setDraft, trips, suppliers }: { draft: any; setDraft: (updater: any) => void; trips: any[]; suppliers: JapanSupplier[] }) {
  const update = (key: string, value: unknown) => setDraft((current: any) => ({ ...current, [key]: value }));
  const updateSupplier = (supplierId: string) => {
    const supplier = suppliers.find((item) => item.id === supplierId);
    setDraft((current: any) => ({
      ...current,
      supplier_id: supplierId,
      supplier_name: supplier?.name ?? current.supplier_name ?? "",
    }));
  };
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Voyage" className="md:col-span-2">
        <Select value={draft.trip_id} onValueChange={(value) => update("trip_id", value)}>
          <SelectTrigger><SelectValue placeholder="Choisir voyage" /></SelectTrigger>
          <SelectContent>{trips.map((trip) => <SelectItem key={trip.id} value={trip.id}>{trip.title}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label="Fournisseur Japon" className="md:col-span-2">
        <Select value={draft.supplier_id ?? ""} onValueChange={updateSupplier}>
          <SelectTrigger><SelectValue placeholder="Choisir un fournisseur" /></SelectTrigger>
          <SelectContent>
            {suppliers.filter((supplier) => supplier.status !== "inactive").map((supplier) => (
              <SelectItem key={supplier.id} value={supplier.id!}>
                {supplier.name} · {supplierCategoryLabels[String(supplier.category || "other")] ?? supplier.category}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Référence paiement"><Input value={draft.payment_reference ?? ""} onChange={(event) => update("payment_reference", event.target.value)} /></Field>
      <Field label="N° facture"><Input value={draft.invoice_number ?? ""} onChange={(event) => update("invoice_number", event.target.value)} /></Field>
      <Field label="Devise"><Input value={draft.currency ?? "JPY"} onChange={(event) => update("currency", event.target.value)} /></Field>
      <Field label="Date émission"><Input type="date" value={draft.issue_date ?? ""} onChange={(event) => update("issue_date", event.target.value || null)} /></Field>
      <Field label="Date échéance"><Input type="date" value={draft.due_date ?? ""} onChange={(event) => update("due_date", event.target.value || null)} /></Field>
      <Field label="Prix unitaire JPY"><Input type="number" value={draft.unit_price_jpy ?? 0} onChange={(event) => update("unit_price_jpy", event.target.value)} /></Field>
      <Field label="Taxe %"><Input type="number" value={draft.tax_percent ?? 0} onChange={(event) => update("tax_percent", event.target.value)} /></Field>
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

function ParticipantForm({
  draft,
  setDraft,
}: {
  draft: InternationalPaymentParticipant;
  setDraft: Dispatch<SetStateAction<InternationalPaymentParticipant>>;
}) {
  const update = (key: keyof InternationalPaymentParticipant, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Nom complet" className="md:col-span-2"><Input value={draft.full_name ?? ""} onChange={(event) => update("full_name", event.target.value)} /></Field>
      <Field label="Passeport"><Input value={draft.passport_no ?? ""} onChange={(event) => update("passport_no", event.target.value)} /></Field>
      <Field label="Nationalité"><Input value={draft.nationality ?? ""} onChange={(event) => update("nationality", event.target.value)} /></Field>
      <Field label="Date de naissance"><Input type="date" value={draft.birth_date || draft.date_of_birth || ""} onChange={(event) => update("birth_date", event.target.value)} /></Field>
      <Field label="Type chambre"><Input value={draft.room_type ?? ""} onChange={(event) => update("room_type", event.target.value)} /></Field>
      <Field label="Référence réservation"><Input value={draft.booking_reference ?? ""} onChange={(event) => update("booking_reference", event.target.value)} /></Field>
      <Field label="CIN"><Input value={draft.cin ?? ""} onChange={(event) => update("cin", event.target.value)} /></Field>
      <Field label="Adresse" className="md:col-span-2"><Input value={draft.address ?? ""} onChange={(event) => update("address", event.target.value)} /></Field>
      <Field label="Ville"><Input value={draft.city ?? ""} onChange={(event) => update("city", event.target.value)} /></Field>
      <Field label="Chemin copie passeport"><Input value={draft.passport_copy_path ?? ""} onChange={(event) => update("passport_copy_path", event.target.value)} /></Field>
    </div>
  );
}

function ParticipantsTable({
  participants,
  onEdit,
  onDelete,
}: {
  participants: InternationalPaymentParticipant[];
  onEdit: (participant: InternationalPaymentParticipant) => void;
  onDelete: (participant: InternationalPaymentParticipant) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1000px] text-sm">
        <thead className="bg-secondary/60 text-left">
          <tr>
            <th className="p-3">Nom</th><th className="p-3">Passeport</th><th className="p-3">Nationalité</th><th className="p-3">Naissance</th><th className="p-3">Réservation</th><th className="p-3">Chambre</th><th className="p-3">Copie passeport</th><th className="p-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {participants.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Aucun participant. Importez depuis le voyage ou ajoutez une ligne manuellement.</td></tr>}
          {participants.map((participant: any) => (
            <tr key={participant.id || participant.full_name}>
              <td className="p-3 font-medium">{participant.full_name}</td>
              <td className="p-3">{participant.passport_no || "—"}</td>
              <td className="p-3">{participant.nationality || "—"}</td>
              <td className="p-3">{fmtDate(participant.birth_date || participant.date_of_birth)}</td>
              <td className="p-3">{participant.booking_reference || "—"}</td>
              <td className="p-3">{participant.room_type || "—"}</td>
              <td className="p-3">{participant.passport_copy_path ? <Badge variant="secondary">OK</Badge> : <Badge variant="destructive">Passeport manquant</Badge>}</td>
              <td className="p-3">
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="icon" onClick={() => onEdit(participant)} aria-label="Modifier participant"><Edit3 className="h-4 w-4" /></Button>
                  <Button variant="outline" size="icon" onClick={() => onDelete(participant)} aria-label="Supprimer participant"><Trash2 className="h-4 w-4" /></Button>
                </div>
              </td>
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
