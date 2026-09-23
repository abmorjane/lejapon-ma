/* eslint-disable @typescript-eslint/no-explicit-any */
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "../components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertTriangle, ChevronDown, Download, FileScan, Plus, Search, User, Upload, Trash2 } from "lucide-react";
import { fmtDate } from "@/lib/format";
import { fmtMAD } from "@/lib/format";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { LoyaltyBadge, tierLabel } from "../components/LoyaltyBadge";
import { QuickActions } from "../components/QuickActions";
import { OperationChecklistPanel } from "../components/OperationChecklistPanel";
import { PassportScannerDialog, type PassportOcrFields } from "../components/PassportScannerDialog";
import { checkPassportExpiry } from "@/lib/passport-mrz";
import { exportCsv } from "@/admin/lib/export-csv";
import {
  CRM_PROFESSIONAL_SITUATIONS,
  mapProfessionTextToCrmSituation,
  professionalSituationLabel,
} from "@/lib/visa-document-checklists";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const empty = {
  full_name: "", email: "", phone: "", city: "", country: "Maroc", source: "",
  passport_number: "", passport_expiry: "", passport_issue_date: "", birthdate: "",
  nationality: "", sex: "", passport_file_path: "", profession: "", marital_status: "", address: "", metadata: {},
};

type ClientEditPayload = {
  full_name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  source: string | null;
  passport_number: string | null;
  passport_no: string | null;
  passport_expiry: string | null;
  passport_issue_date: string | null;
  birthdate: string | null;
  date_of_birth: string | null;
  nationality: string | null;
  sex: string | null;
  passport_file_path: string | null;
  profession: string | null;
  marital_status: string | null;
  address: string | null;
  metadata: Record<string, any>;
};
const ClientsImportDialog = lazy(() =>
  import("../components/ClientsImportDialog").then((module) => ({ default: module.ClientsImportDialog }))
);

type ExportScope = "selected" | "filtered" | "all" | "travelers";
type ExportFormat = "csv" | "xlsx";
type PassportFilter = "all" | "with_passport" | "expiring";

const exportHeaders = [
  { key: "full_name", label: "Nom complet" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Téléphone" },
  { key: "city", label: "Ville" },
  { key: "profession", label: "Profession" },
  { key: "marital_status", label: "État civil" },
  { key: "address", label: "Adresse" },
  { key: "nationality", label: "Nationalité" },
  { key: "sex", label: "Sexe" },
  { key: "birthdate", label: "Date de naissance" },
  { key: "passport_number", label: "Numéro de passeport" },
  { key: "passport_issue_date", label: "Date d'émission du passeport" },
  { key: "passport_expiry", label: "Date d'expiration du passeport" },
  { key: "passport_expires_soon", label: "Passeport expirant bientôt" },
  { key: "passport_to_renew", label: "Passeport à renouveler" },
  { key: "passport_file_path", label: "Fichier passeport" },
  { key: "trip", label: "Voyage inscrit" },
  { key: "departure_date", label: "Date de départ" },
  { key: "status", label: "Statut client" },
  { key: "trips_completed", label: "Nombre de voyages" },
  { key: "paid_amount_mad", label: "Montant payé" },
  { key: "remaining_amount_mad", label: "Reste à payer" },
  { key: "notes", label: "Notes" },
  { key: "created_at", label: "Date d'inscription" },
  { key: "exported_by", label: "Exporté par" },
  { key: "export_date", label: "Date export" },
  { key: "watermark", label: "Source" },
];

const todayStamp = () => new Date().toISOString().slice(0, 10);
const CLIENT_SELECT = "id, full_name, email, phone, city, country, source, passport_number, passport_no, passport_expiry, birthdate, date_of_birth, nationality, sex, passport_issue_date, passport_file_path, passport_place_of_issue, passport_issuing_authority, national_id_no, profession, marital_status, address, metadata, last_trip_label, loyalty_tier, is_returning, trips_completed, rewards_used, archived_at, archive_reason, created_at";

const MARITAL_STATUS_OPTIONS = [
  { value: "celibataire", label: "Célibataire" },
  { value: "marie", label: "Marié(e)" },
  { value: "divorce", label: "Divorcé(e)" },
  { value: "veuf", label: "Veuf/veuve" },
];

const maritalStatusLabel = (value?: string | null) =>
  MARITAL_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value ?? "";

const clientProfessionalSituation = (client: any) =>
  String(asRecord(client?.metadata).professional_situation ?? "");

const calculateAge = (birthdate?: string | null) => {
  if (!birthdate) return null;
  const birth = new Date(`${birthdate}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age;
};

const passportNeedsRenewal = (expiry?: string | null) => {
  const check = checkPassportExpiry(expiry);
  return check.isExpired || check.expiresWithin12Months;
};

const hasPassportData = (row: any) =>
  Boolean(
    row?.passport_number ||
    row?.passport_no ||
    row?.passport_expiry ||
    row?.passport_issue_date ||
    row?.passport_file_path
  );

const normalizeClientDateFields = (client: any) => ({
  ...client,
  passport_expiry: client.passport_expiry === "" ? null : client.passport_expiry,
  passport_issue_date: client.passport_issue_date === "" ? null : client.passport_issue_date,
  birthdate: client.birthdate === "" ? null : client.birthdate,
});

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};

const nullableText = (value: unknown) => {
  const text = String(value ?? "").trim();
  return text || null;
};

const clientEditPayloadFromForm = (form: any): ClientEditPayload => {
  const normalized = normalizeClientDateFields(form);
  const passportNumber = nullableText(normalized.passport_number ?? normalized.passport_no);
  const birthdate = normalized.birthdate ?? normalized.date_of_birth ?? null;
  return {
    full_name: nullableText(normalized.full_name) ?? "",
    email: nullableText(normalized.email),
    phone: nullableText(normalized.phone),
    city: nullableText(normalized.city),
    country: nullableText(normalized.country) ?? "Maroc",
    source: nullableText(normalized.source),
    passport_number: passportNumber,
    passport_no: passportNumber,
    passport_expiry: normalized.passport_expiry ?? null,
    passport_issue_date: normalized.passport_issue_date ?? null,
    birthdate,
    date_of_birth: birthdate,
    nationality: nullableText(normalized.nationality),
    sex: nullableText(normalized.sex),
    passport_file_path: nullableText(normalized.passport_file_path),
    profession: nullableText(normalized.profession),
    marital_status: nullableText(normalized.marital_status),
    address: nullableText(normalized.address),
    metadata: asRecord(normalized.metadata),
  };
};

const passportOcrMetadata = (fields: PassportOcrFields) => ({
  passport_number: fields.passport_no || null,
  cin: fields.national_id_number || null,
  national_id_number: fields.national_id_number || null,
  first_name: fields.first_name || null,
  last_name: fields.last_name || null,
  full_name: fields.full_name || [fields.first_name, fields.last_name].filter(Boolean).join(" ") || null,
  nationality: fields.nationality || null,
  sex: fields.sex || null,
  birthdate: fields.date_of_birth || null,
  place_of_birth: fields.place_of_birth || null,
  passport_issue_date: fields.passport_issue_date || null,
  passport_expiry_date: fields.passport_expiry || null,
  passport_authority: fields.passport_authority || null,
  profession: fields.profession || null,
  residence_address: fields.residence_address || fields.address || null,
  residence_city: fields.residence_city || fields.city || null,
  residence_country: fields.residence_country || null,
  mrz_raw: fields.mrz_raw || fields.mrz || null,
  captured_at: new Date().toISOString(),
});

const getPassportOcr = (metadata: unknown) => asRecord(asRecord(metadata).passport_ocr);
const isVisaImportedClient = (client: any) => Boolean(asRecord(client?.metadata).visa_imported);

const fadeIn = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.22, ease: "easeOut" },
};

export default function Clients() {
  const { id: routeClientId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isAdmin, isSuperAdmin, session, roles, can } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [professionFilter, setProfessionFilter] = useState("");
  const [maritalFilter, setMaritalFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("");
  const [ageFilter, setAgeFilter] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportScope, setExportScope] = useState<ExportScope>("filtered");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("csv");
  const [passportFilter, setPassportFilter] = useState<PassportFilter>("all");
  const [includePassportData, setIncludePassportData] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [allClientsCount, setAllClientsCount] = useState<number | null>(null);
  const [allTravelersCount, setAllTravelersCount] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<any>(empty);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [notes, setNotes] = useState<any[]>([]);
  const [newNote, setNewNote] = useState("");
  const [rewards, setRewards] = useState<any[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [clientPayments, setClientPayments] = useState<any[]>([]);
  const [clientVisas, setClientVisas] = useState<any[]>([]);
  const [clientDocuments, setClientDocuments] = useState<any[]>([]);
  const [clientParticipants, setClientParticipants] = useState<any[]>([]);
  const [clientFitQuotes, setClientFitQuotes] = useState<any[]>([]);
  const [identityConflicts, setIdentityConflicts] = useState<any[]>([]);
  const relatedTripCount = useMemo(() => new Set([
    ...history.map((booking: any) => booking.trip_id),
    ...clientParticipants.map((participant: any) => participant.trip_id),
    ...clientVisas.flatMap((visa: any) => [visa.document_trip_id, visa.selected_trip_id, visa.trip_id]),
  ].filter(Boolean)).size, [history, clientParticipants, clientVisas]);

  const fetchClients = async () => {
    let query = supabase
      .from("clients")
      .select(CLIENT_SELECT)
      .order("created_at", { ascending: false })
      .limit(150);
    if (!showArchived) query = query.is("archived_at", null);
    const { data, error } = await query;
    if (error) {
      toast.error(error.message);
      setRows([]);
      return;
    }
    const clientIds = (data ?? []).map((client: any) => client.id).filter(Boolean);
    const visaTripByClient = new Map<string, string>();
    if (clientIds.length) {
      const { data: visaRows } = await (supabase as any)
        .from("visa_applications")
        .select("client_id,document_trip_id,trips:document_trip_id(title,season,start_date)")
        .in("client_id", clientIds)
        .not("document_trip_id", "is", null)
        .order("created_at", { ascending: false });
      (visaRows ?? []).forEach((row: any) => {
        if (!row.client_id || visaTripByClient.has(row.client_id)) return;
        const trip = row.trips;
        const label = [trip?.title, trip?.season, trip?.start_date ? fmtDate(trip.start_date) : ""].filter(Boolean).join(" · ");
        if (label) visaTripByClient.set(row.client_id, label);
      });
    }

    const enriched = (data ?? []).map((client: any) => ({
      ...client,
      visa_trip_label: visaTripByClient.get(client.id) ?? null,
    }));
    const search = q.trim().toLowerCase();
    const profession = professionFilter.trim().toLowerCase();
    const city = cityFilter.trim().toLowerCase();
    const age = ageFilter.trim() ? Number(ageFilter) : null;
    const filtered = enriched.filter((c: any) => {
      const haystack = [c.full_name, c.email, c.phone, c.city, c.profession, c.passport_number, c.passport_no, c.last_trip_label, c.visa_trip_label]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const clientAge = calculateAge(c.birthdate);
      return (
        (!search || haystack.includes(search)) &&
        (!profession || c.profession?.toLowerCase().includes(profession)) &&
        (!city || c.city?.toLowerCase().includes(city)) &&
        (maritalFilter === "all" || c.marital_status === maritalFilter) &&
        (age == null || clientAge === age)
      );
    });
    setRows(filtered);
  };
  useEffect(() => { fetchClients(); }, [q, professionFilter, maritalFilter, cityFilter, ageFilter, showArchived]);

  const selectedRows = useMemo(() => rows.filter((row) => selectedIds.has(row.id)), [rows, selectedIds]);
  const canManageClients = can("clients");
  const canScanPassport = canManageClients || roles.some((role) => ["super_admin", "admin", "manager", "sales", "sales_user", "agent"].includes(role));
  const visibleRowsForExport = useMemo(() => {
    const base = exportScope === "selected" ? selectedRows : rows;
    if (passportFilter === "with_passport") return base.filter(hasPassportData);
    if (passportFilter === "expiring") return base.filter((row) => passportNeedsRenewal(row.passport_expiry));
    return base;
  }, [exportScope, passportFilter, rows, selectedRows]);
  const exportCount =
    exportScope === "selected" || exportScope === "filtered"
      ? visibleRowsForExport.length
      : exportScope === "travelers"
        ? allTravelersCount ?? 0
        : allClientsCount ?? rows.length;
  const exportCountLabel = ["all", "travelers"].includes(exportScope) && exportCount === 0 ? "Tous les" : String(exportCount);
  const exportDisabled = exporting || (["selected", "filtered"].includes(exportScope) && exportCount === 0);
  const allVisibleSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.id));

  useEffect(() => {
    if (!exportOpen || !isSuperAdmin) return;
    Promise.all([
      supabase.from("clients").select("id", { count: "exact", head: true }),
      supabase.from("booking_participants").select("id", { count: "exact", head: true }),
    ]).then(([clientsResult, travelersResult]) => {
      if (!clientsResult.error) setAllClientsCount(clientsResult.count ?? null);
      if (!travelersResult.error) setAllTravelersCount(travelersResult.count ?? null);
    });
  }, [exportOpen, isSuperAdmin]);

  const toggleClientSelection = (id: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAllVisible = (checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      rows.forEach((row) => {
        if (checked) next.add(row.id);
        else next.delete(row.id);
      });
      return next;
    });
  };

  const runExport = async () => {
    if (!isSuperAdmin) return toast.error("Export réservé au Super Admin.");
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session || !session) {
      toast.error("Session expirée. Merci de vous reconnecter avant l'export.");
      return;
    }
    const confirmed = window.confirm("Cet export contient des données personnelles sensibles (CRM/passeports). Continuer ?");
    if (!confirmed) return;
    setExporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("crm-export", {
        body: {
          scope: exportScope,
          format: exportFormat,
          passportFilter,
          includePassportData,
          selectedIds: Array.from(selectedIds),
          filteredIds: rows.map((row) => row.id),
          filters: {
            search: q,
            profession: professionFilter,
            marital_status: maritalFilter,
            city: cityFilter,
            age: ageFilter,
          },
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Export refusé");

      const exportRows = data.rows ?? [];
      const filename = `${includePassportData ? "clients-passports" : "clients-crm"}-${todayStamp()}`;
      if (exportFormat === "xlsx") {
        const XLSX = await import("xlsx");
        const sheet = XLSX.utils.json_to_sheet(exportRows, { header: exportHeaders.map((h) => h.key) });
        XLSX.utils.sheet_add_aoa(sheet, [exportHeaders.map((h) => h.label)], { origin: "A1" });
        sheet["!cols"] = exportHeaders.map((header) => ({
          wch: Math.max(header.label.length + 2, header.key.includes("passport") ? 24 : 16),
        }));
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, sheet, "Clients CRM");
        XLSX.writeFile(workbook, `${filename}.xlsx`);
      } else {
        exportCsv(filename, exportRows, exportHeaders, ";");
      }
      toast.success(`${exportRows.length} lignes exportées. Log sécurité: ${data.log_id ?? "créé"}`);
      setExportOpen(false);
    } catch (error: any) {
      toast.error(error?.message ?? "Export impossible ou non autorisé");
    } finally {
      setExporting(false);
    }
  };

  const openClient = async (c: any) => {
    setSelected(c);
    const [{ data: n }, { data: r }, { data: h }, visaResult, participantResult, fitResult, conflictResult] = await Promise.all([
      supabase.from("client_notes").select("*").eq("client_id", c.id).order("created_at", { ascending: false }),
      supabase.from("client_rewards" as any).select("*").eq("client_id", c.id).order("created_at", { ascending: false }),
      supabase
        .from("bookings")
        .select("id, reference, status, total_amount_mad, paid_amount_mad, created_at, trip_id, trips:trip_id(title, season, start_date, end_date), booking_extras(name_snapshot, qty)")
        .eq("client_id", c.id)
        .order("created_at", { ascending: false }),
      (supabase as any)
        .from("visa_applications")
        .select("id, reference, status, document_trip_id, selected_trip_id, trip_id, created_at")
        .eq("client_id", c.id)
        .order("created_at", { ascending: false }),
      (supabase as any)
        .from("booking_participants")
        .select("id, booking_id, trip_id, first_name, last_name, email, phone, passport_no, is_lead, created_at")
        .eq("client_id", c.id)
        .order("created_at", { ascending: false }),
      (supabase as any)
        .from("fit_quotes")
        .select("id, quote_number, status, travelers_count, travel_start_date, travel_end_date, updated_at")
        .eq("client_id", c.id)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false }),
      (supabase as any)
        .from("crm_identity_conflicts")
        .select("id, source_kind, matched_by, candidate_client_ids, created_at")
        .eq("status", "pending")
        .contains("candidate_client_ids", [c.id])
        .order("created_at", { ascending: false }),
    ]);
    setNotes(n ?? []);
    setRewards((r as any) ?? []);
    const bookingRows = (h as any) ?? [];
    setHistory(bookingRows);
    const bookingIds = bookingRows.map((booking: any) => booking.id);
    if (bookingIds.length) {
      const [{ data: paymentRows }, { data: docRows }] = await Promise.all([
        supabase.from("payments").select("*, bookings(reference, trip_id)").in("booking_id", bookingIds).order("created_at", { ascending: false }),
        (supabase as any).from("booking_documents").select("*").in("booking_id", bookingIds).order("created_at", { ascending: false }),
      ]);
      setClientPayments(paymentRows ?? []);
      setClientDocuments(docRows ?? []);
    } else {
      setClientPayments([]);
      setClientDocuments([]);
    }
    setClientVisas(visaResult.data ?? []);
    setClientParticipants(participantResult.data ?? []);
    setClientFitQuotes(fitResult.data ?? []);
    setIdentityConflicts(conflictResult.data ?? []);
  };

  const openClientById = async (id: string) => {
    const { data, error } = await supabase
      .from("clients")
      .select(CLIENT_SELECT)
      .eq("id", id)
      .maybeSingle();
    if (error) return toast.error(error.message);
    if (!data) return toast.error("Fiche client introuvable.");
    await openClient(data);
  };

  useEffect(() => {
    if (!routeClientId || selected?.id === routeClientId) return;
    openClientById(routeClientId);
  }, [routeClientId]);

  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    setEdit(empty);
    setOpen(true);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const save = async () => {
    const payload = clientEditPayloadFromForm(edit);
    const result = edit.id
      ? await supabase.from("clients").update(payload).eq("id", edit.id).select(CLIENT_SELECT).single()
      : await supabase.from("clients").insert(payload).select("*").single();
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Enregistré");
    setOpen(false);
    setEdit(empty);
    await fetchClients();
  };

  const applyPassportFields = (fields: PassportOcrFields) => {
    setEdit((current: any) => {
      const metadata = asRecord(current.metadata);
      const residenceCountry = fields.residence_country || metadata.passport_ocr?.residence_country;
      const mappedSituation = mapProfessionTextToCrmSituation(fields.profession);
      const nextMetadata = {
        ...metadata,
        ...(mappedSituation ? { professional_situation: mappedSituation } : {}),
        ...(fields.profession ? { ocr_profession_source: fields.profession } : {}),
        passport_ocr: {
          ...asRecord(metadata.passport_ocr),
          ...passportOcrMetadata(fields),
        },
      };
      return {
        ...current,
        full_name: fields.full_name || [fields.first_name, fields.last_name].filter(Boolean).join(" ") || current.full_name,
        passport_number: fields.passport_no || current.passport_number,
        passport_expiry: fields.passport_expiry || current.passport_expiry,
        passport_issue_date: fields.passport_issue_date || current.passport_issue_date,
        birthdate: fields.date_of_birth || current.birthdate,
        nationality: fields.nationality || current.nationality,
        sex: fields.sex || current.sex,
        address: fields.residence_address || fields.address || current.address,
        city: fields.residence_city || fields.city || current.city,
        country: residenceCountry || current.country,
        profession: fields.profession || current.profession,
        metadata: nextMetadata,
      };
    });
  };

  const addNote = async () => {
    if (!newNote.trim() || !selected) return;
    const { error } = await supabase.from("client_notes").insert({ client_id: selected.id, body: newNote, author_id: user?.id });
    if (error) return toast.error(error.message);
    setNewNote("");
    openClient(selected);
  };

  const grantReward = async (type: "discount" | "free_activity" | "vip_upgrade") => {
    if (!selected) return;
    const map = {
      discount: { label: "10% sur le prochain voyage", percent: 10 },
      free_activity: { label: "Activité offerte", percent: null },
      vip_upgrade: { label: "Surclassement VIP offert", percent: null },
    } as const;
    const { error } = await supabase.from("client_rewards" as any).insert({
      client_id: selected.id, type, label: map[type].label, percent: map[type].percent, granted_reason: "Octroyé manuellement",
    });
    if (error) return toast.error(error.message);
    toast.success("Récompense créée");
    openClient(selected);
  };

  const markRewardUsed = async (id: string) => {
    const { error } = await supabase.from("client_rewards" as any)
      .update({ status: "used", used_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(error.message);
    if (selected) {
      await supabase.from("clients").update({ rewards_used: (selected.rewards_used ?? 0) + 1 }).eq("id", selected.id);
    }
    openClient(selected);
  };

  const clientHasProtectedHistory = async (clientId: string) => {
    const [bookings, visas, participants, fitQuotes] = await Promise.all([
      supabase.from("bookings").select("id").eq("client_id", clientId).limit(1),
      (supabase as any).from("visa_applications").select("id").eq("client_id", clientId).limit(1),
      (supabase as any).from("booking_participants").select("id").eq("client_id", clientId).limit(1),
      (supabase as any).from("fit_quotes").select("id").eq("client_id", clientId).limit(1),
    ]);
    return [bookings, visas, participants, fitQuotes].some((result) => (result.data ?? []).length > 0);
  };

  const deleteOrArchiveClient = async (client: any) => {
    const protectedHistory = await clientHasProtectedHistory(client.id);
    if (protectedHistory) {
      const { error } = await (supabase as any).from("clients").update({
        archived_at: new Date().toISOString(),
        archived_by: user?.id ?? null,
        archive_reason: "Historique commercial/comptable ou visa conservé",
      }).eq("id", client.id);
      if (error) return { action: "error" as const, error };
      return { action: "archived" as const };
    }
    const { error } = await supabase.from("clients").delete().eq("id", client.id);
    if (error) return { action: "error" as const, error };
    return { action: "deleted" as const };
  };

  const deleteClient = async () => {
    if (!confirmDelete) return;
    const result = await deleteOrArchiveClient(confirmDelete);
    if (result.action === "error") return toast.error(result.error.message);
    toast.success(result.action === "archived" ? "Client archivé pour conserver l'historique." : "Client supprimé");
    if (selected?.id === confirmDelete.id) setSelected(null);
    setConfirmDelete(null);
    fetchClients();
  };

  const deleteOrArchiveSelectedClients = async () => {
    if (selectedRows.length === 0) return;
    const confirmed = window.confirm(`${selectedRows.length} client(s) sélectionné(s). Les clients avec historique seront archivés au lieu d'être supprimés. Continuer ?`);
    if (!confirmed) return;
    let archived = 0;
    let deleted = 0;
    for (const client of selectedRows) {
      const result = await deleteOrArchiveClient(client);
      if (result.action === "archived") archived += 1;
      if (result.action === "deleted") deleted += 1;
      if (result.action === "error") toast.error(`${client.full_name}: ${result.error.message}`);
    }
    toast.success(`${deleted} supprimé(s), ${archived} archivé(s).`);
    setSelectedIds(new Set());
    if (selected && selectedRows.some((row) => row.id === selected.id)) setSelected(null);
    fetchClients();
  };

  const selectedPassportOcr = getPassportOcr(selected?.metadata);

  return (
    <motion.div {...fadeIn} className="space-y-6">
      <PageHeader title="Clients (CRM)" description="Fiches, historique, notes."
        action={
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center sm:flex-wrap">
          {isSuperAdmin && (
            <Button variant="outline" className="min-h-11" onClick={() => setExportOpen(true)}>
              <Download className="w-4 h-4" /> Exporter
            </Button>
          )}
          <Button variant="outline" className="min-h-11" onClick={() => setImportOpen(true)}>
            <Upload className="w-4 h-4" /> Importer
          </Button>
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEdit(empty); }}>
            <DialogTrigger asChild><Button className="col-span-2 min-h-11 rounded-xl sm:col-span-1"><Plus className="w-4 h-4" /> Nouveau client</Button></DialogTrigger>
            <DialogContent className="max-h-[92dvh] overflow-y-auto rounded-2xl sm:max-w-xl">
              <DialogHeader><DialogTitle>{edit.id ? "Modifier" : "Nouveau"} client</DialogTitle></DialogHeader>
              <div className="rounded-xl border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
                Le scan passeport aide à pré-remplir la fiche. L'admin doit toujours vérifier avant validation.
              </div>
              {canScanPassport && (
                <Button type="button" variant="outline" className="h-11 w-full justify-center" onClick={() => setScannerOpen(true)}>
                  <FileScan className="h-4 w-4" /> Scanner passeport
                </Button>
              )}
              <div className="space-y-4">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Informations personnelles</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2"><Label>Nom complet</Label><Input value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></div>
                <div>
                  <Label>Situation professionnelle</Label>
                  <Select
                    value={clientProfessionalSituation(edit) || "none"}
                    onValueChange={(value) => {
                      const metadata = asRecord(edit.metadata);
                      const nextMetadata = { ...metadata };
                      if (value === "none") delete nextMetadata.professional_situation;
                      else nextMetadata.professional_situation = value;
                      setEdit({ ...edit, metadata: nextMetadata });
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {CRM_PROFESSIONAL_SITUATIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Profession / activité exacte</Label><Input value={edit.profession ?? ""} onChange={(e) => setEdit({ ...edit, profession: e.target.value })} placeholder="Ingénieur, médecin…" /></div>
                <div><Label>État civil</Label>
                  <Select value={edit.marital_status || "none"} onValueChange={(v) => setEdit({ ...edit, marital_status: v === "none" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {MARITAL_STATUS_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Date de naissance</Label><Input type="date" value={edit.birthdate ?? ""} onChange={(e) => setEdit({ ...edit, birthdate: e.target.value })} /></div>
                <div><Label>Nationalité</Label><Input value={edit.nationality ?? ""} onChange={(e) => setEdit({ ...edit, nationality: e.target.value })} /></div>
                <div><Label>Sexe</Label><Input value={edit.sex ?? ""} onChange={(e) => setEdit({ ...edit, sex: e.target.value })} placeholder="M / F" /></div>
                <div><Label>Source</Label><Input value={edit.source ?? ""} onChange={(e) => setEdit({ ...edit, source: e.target.value })} placeholder="Instagram, recommandation…" /></div>
                <div className="sm:col-span-2"><Label>Adresse</Label><Textarea rows={3} value={edit.address ?? ""} onChange={(e) => setEdit({ ...edit, address: e.target.value })} placeholder="Adresse complète" /></div>
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Contact</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><Label>Email</Label><Input type="email" autoComplete="email" inputMode="email" value={edit.email ?? ""} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></div>
                <div><Label>Téléphone</Label><Input type="tel" autoComplete="tel" inputMode="tel" value={edit.phone ?? ""} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></div>
                <div><Label>Ville</Label><Input value={edit.city ?? ""} onChange={(e) => setEdit({ ...edit, city: e.target.value })} /></div>
                <div><Label>Pays</Label><Input value={edit.country ?? ""} onChange={(e) => setEdit({ ...edit, country: e.target.value })} /></div>
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Passeport</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><Label>N° Passeport</Label><Input autoCapitalize="characters" value={edit.passport_number ?? edit.passport_no ?? ""} onChange={(e) => setEdit({ ...edit, passport_number: e.target.value, passport_no: e.target.value })} /></div>
                <div><Label>Date d'émission</Label><Input type="date" value={edit.passport_issue_date ?? ""} onChange={(e) => setEdit({ ...edit, passport_issue_date: e.target.value })} /></div>
                <div><Label>Date d'expiration</Label><Input type="date" value={edit.passport_expiry ?? ""} onChange={(e) => setEdit({ ...edit, passport_expiry: e.target.value })} /></div>
                  </div>
                </div>
              </div>
              {checkPassportExpiry(edit.passport_expiry).warning && (
                <div className="flex items-start gap-2 rounded-xl border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{checkPassportExpiry(edit.passport_expiry).warning}</p>
                </div>
              )}
              {canScanPassport && (
                <PassportScannerDialog
                  open={scannerOpen}
                  onOpenChange={setScannerOpen}
                  currentPath={edit.passport_file_path}
                  onStoredPathChange={(path) => setEdit((current: any) => ({ ...current, passport_file_path: path ?? "" }))}
                  onApply={applyPassportFields}
                />
              )}
              <DialogFooter><Button className="w-full sm:w-auto min-h-11" onClick={save} disabled={!edit.full_name}>Enregistrer</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        }
      />

      {importOpen && (
        <Suspense fallback={null}>
          <ClientsImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={fetchClients} />
        </Suspense>
      )}

      {isSuperAdmin && (
        <Dialog open={exportOpen} onOpenChange={setExportOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Exporter les clients</DialogTitle>
            </DialogHeader>
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Export sensible réservé au Super Admin. Chaque export est journalisé côté serveur.
            </div>
            <div className="rounded-xl border border-border bg-secondary/40 p-3 text-sm">
              <strong>{exportCountLabel}</strong> clients seront exportés.
            </div>
            <div className="space-y-3">
              <Label className="text-xs uppercase text-muted-foreground">Périmètre</Label>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-border p-3 text-sm">
                <input
                  type="radio"
                  name="client-export-scope"
                  value="selected"
                  checked={exportScope === "selected"}
                  disabled={selectedRows.length === 0}
                  onChange={() => setExportScope("selected")}
                />
                <span>Exporter les clients sélectionnés ({selectedRows.length})</span>
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-border p-3 text-sm">
                <input
                  type="radio"
                  name="client-export-scope"
                  value="filtered"
                  checked={exportScope === "filtered"}
                  onChange={() => setExportScope("filtered")}
                />
                <span>Exporter les clients filtrés ({rows.length})</span>
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-border p-3 text-sm">
                <input
                  type="radio"
                  name="client-export-scope"
                  value="all"
                  checked={exportScope === "all"}
                  onChange={() => setExportScope("all")}
                />
                <span>Exporter tous les clients ({allClientsCount ?? "..."})</span>
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-border p-3 text-sm">
                <input
                  type="radio"
                  name="client-export-scope"
                  value="travelers"
                  checked={exportScope === "travelers"}
                  onChange={() => setExportScope("travelers")}
                />
                <span>Exporter tous les voyageurs ({allTravelersCount ?? "..."})</span>
              </label>
            </div>
            <div className="space-y-3">
              <Label className="text-xs uppercase text-muted-foreground">Filtre passeport</Label>
              <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-xl border border-border px-3 py-2 text-sm">
                <Checkbox
                  checked={includePassportData}
                  onCheckedChange={(checked) => setIncludePassportData(Boolean(checked))}
                />
                <span>Inclure données passeport sensibles</span>
              </label>
              <div className="grid gap-2">
                <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-xl border border-border px-3 py-2 text-sm">
                  <input
                    type="radio"
                    name="passport-export-filter"
                    value="all"
                    checked={passportFilter === "all"}
                    onChange={() => setPassportFilter("all")}
                  />
                  <span>Tous les clients / voyageurs</span>
                </label>
                <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-xl border border-border px-3 py-2 text-sm">
                  <input
                    type="radio"
                    name="passport-export-filter"
                    value="with_passport"
                    checked={passportFilter === "with_passport"}
                    onChange={() => setPassportFilter("with_passport")}
                  />
                  <span>Seulement avec passeport</span>
                </label>
                <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-xl border border-border px-3 py-2 text-sm">
                  <input
                    type="radio"
                    name="passport-export-filter"
                    value="expiring"
                    checked={passportFilter === "expiring"}
                    onChange={() => setPassportFilter("expiring")}
                  />
                  <span>Passeports expirant bientôt</span>
                </label>
              </div>
            </div>
            <div className="space-y-3">
              <Label className="text-xs uppercase text-muted-foreground">Format</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button variant={exportFormat === "csv" ? "default" : "outline"} onClick={() => setExportFormat("csv")}>
                  CSV
                </Button>
                <Button variant={exportFormat === "xlsx" ? "default" : "outline"} onClick={() => setExportFormat("xlsx")}>
                  Excel XLSX
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setExportOpen(false)}>Annuler</Button>
              <Button onClick={runExport} disabled={exportDisabled}>
                <Download className="h-4 w-4" />
                {exporting ? "Export..." : "Exporter"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0 space-y-4">
          <div className="rounded-xl border border-border bg-background p-3 shadow-sm sm:p-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-semibold">Recherche & filtres</p>
                <p className="text-xs text-muted-foreground">{rows.length} client(s) affiché(s)</p>
              </div>
              <span className="text-xs text-muted-foreground">{selectedRows.length} sélectionné(s)</span>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="min-h-11 pl-9" type="search" enterKeyHint="search" placeholder="Rechercher nom, email, téléphone, passeport…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-background p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
            <Input className="min-h-10" placeholder="Profession" value={professionFilter} onChange={(e) => setProfessionFilter(e.target.value)} />
            <Input className="min-h-10" placeholder="Ville" value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} />
            <Input className="min-h-10" type="number" min="0" inputMode="numeric" placeholder="Âge exact" value={ageFilter} onChange={(e) => setAgeFilter(e.target.value)} />
            <Select value={maritalFilter} onValueChange={setMaritalFilter}>
              <SelectTrigger className="min-h-10"><SelectValue placeholder="État civil" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous états civils</SelectItem>
                {MARITAL_STATUS_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox
                checked={allVisibleSelected}
                onCheckedChange={(checked) => toggleAllVisible(Boolean(checked))}
                aria-label="Tout sélectionner"
              />
              <span>Tout sélectionner</span>
            </label>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox checked={showArchived} onCheckedChange={(checked) => setShowArchived(Boolean(checked))} />
                Clients archivés
              </label>
              {isAdmin && selectedRows.length > 0 && (
                <Button size="sm" variant="destructive" onClick={deleteOrArchiveSelectedClients}>
                  <Trash2 className="h-4 w-4" /> Supprimer / archiver
                </Button>
              )}
              <span className="text-xs text-muted-foreground">{selectedRows.length} sélectionné(s)</span>
            </div>
          </div>
          <div className="space-y-3 md:hidden">
            {rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground bg-background rounded-2xl border border-border">Aucun client.</p>}
            {rows.map((c, index) => (
              <motion.details
                key={c.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.025, 0.2), duration: 0.18 }}
                className="group overflow-hidden rounded-xl border border-border bg-background shadow-sm"
                onClick={() => openClient(c)}
              >
                <summary className="list-none p-4 cursor-pointer">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 gap-3">
                      <Checkbox
                        className="mt-1"
                        checked={selectedIds.has(c.id)}
                        onClick={(e) => e.stopPropagation()}
                        onCheckedChange={(checked) => toggleClientSelection(c.id, Boolean(checked))}
                        aria-label={`Sélectionner ${c.full_name}`}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold">{c.full_name}</p>
                          <LoyaltyBadge tier={c.loyalty_tier} isReturning={c.is_returning} trips={c.trips_completed} />
                          {isVisaImportedClient(c) && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-800">Visa</span>}
                          {c.archived_at && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">Archivé</span>}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{c.email || "—"}</p>
                        <p className="text-xs text-muted-foreground truncate">{c.phone || c.city || "—"}</p>
                      </div>
                    </div>
                    <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  </div>
                  <QuickActions phone={c.phone} email={c.email} passport={c.passport_number} compact className="mt-3" />
                </summary>
                <div className="grid grid-cols-2 gap-3 border-t border-border p-4 text-sm">
                  <div><p className="text-xs text-muted-foreground">Voyage</p><p className="font-medium">{c.last_trip_label ?? c.visa_trip_label ?? "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Ville</p><p className="font-medium">{c.city ?? "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Situation</p><p className="font-medium">{professionalSituationLabel(clientProfessionalSituation(c))}</p></div>
                  <div><p className="text-xs text-muted-foreground">Profession</p><p className="font-medium">{c.profession ?? "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">État civil</p><p className="font-medium">{maritalStatusLabel(c.marital_status) || "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Passeport</p><p className="font-medium">{c.passport_number ?? "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Inscrit</p><p className="font-medium">{fmtDate(c.created_at)}</p></div>
                  {checkPassportExpiry(c.passport_expiry).warning && (
                    <div className="col-span-2 rounded-xl border border-orange-300 bg-orange-50 p-3 text-xs text-orange-900">
                      {checkPassportExpiry(c.passport_expiry).warning}
                    </div>
                  )}
                  <Button variant="secondary" className="col-span-2 min-h-11" onClick={(e) => { e.stopPropagation(); openClient(c); }}>
                    Voir la fiche
                  </Button>
                </div>
              </motion.details>
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-xl border border-border bg-background shadow-sm md:block">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="w-10 p-4">
                    <Checkbox
                      checked={allVisibleSelected}
                      onCheckedChange={(checked) => toggleAllVisible(Boolean(checked))}
                      aria-label="Tout sélectionner"
                    />
                  </th>
                  <th className="p-4">Client</th>
                  <th className="p-4">Contact</th>
                  <th className="p-4">Voyage inscrit</th>
                  <th className="p-4">Ville</th>
                  <th className="p-4">Inscrit</th>
                  <th className="p-4 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">Aucun client.</td></tr>}
                {rows.map((c) => (
                  <tr key={c.id} onClick={() => openClient(c)} className="cursor-pointer transition-colors hover:bg-muted/50">
                    <td className="p-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(c.id)}
                        onCheckedChange={(checked) => toggleClientSelection(c.id, Boolean(checked))}
                        aria-label={`Sélectionner ${c.full_name}`}
                      />
                    </td>
                    <td className="p-4 font-medium">
                      <div className="flex items-center gap-2 flex-wrap">
                        {c.full_name}
                        <LoyaltyBadge tier={c.loyalty_tier} isReturning={c.is_returning} trips={c.trips_completed} />
                        {isVisaImportedClient(c) && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-800">Import visa</span>}
                        {c.archived_at && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">Archivé</span>}
                      </div>
                      {(clientProfessionalSituation(c) || c.profession || c.marital_status) && (
                        <p className="mt-1 text-xs font-normal text-muted-foreground">
                          {[professionalSituationLabel(clientProfessionalSituation(c)), c.profession, maritalStatusLabel(c.marital_status)].filter((value) => value && value !== "Non renseignée").join(" · ")}
                        </p>
                      )}
                    </td>
                    <td className="p-4 text-xs leading-5 text-muted-foreground">{c.email || "—"}<br/>{c.phone || "—"}</td>
                    <td className="p-4 text-xs">{c.last_trip_label ?? c.visa_trip_label ?? "—"}</td>
                    <td className="p-4">{c.city ?? "—"}</td>
                    <td className="p-4 text-xs text-muted-foreground">{fmtDate(c.created_at)}</td>
                    <td className="p-4">
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={(e) => { e.stopPropagation(); setConfirmDelete(c); }}
                          aria-label="Supprimer le client"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </section>

        <Card className="h-fit rounded-xl shadow-sm xl:sticky xl:top-6">
          {!selected ? (
            <CardContent className="py-10 text-center">
              <User className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm font-medium">Aucune fiche sélectionnée</p>
              <p className="mt-1 text-xs text-muted-foreground">Sélectionnez un client pour voir son dossier, ses notes et son historique.</p>
            </CardContent>
          ) : (
            <motion.div key={selected.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }}>
              <CardHeader className="p-4 pb-3 sm:p-6 sm:pb-3">
              <div className="flex items-start justify-between gap-2 mb-1">
                <CardTitle className="text-lg leading-6">{selected.full_name}</CardTitle>
                <LoyaltyBadge tier={selected.loyalty_tier} isReturning={selected.is_returning} trips={selected.trips_completed} />
              </div>
              {isVisaImportedClient(selected) && (
                <div className="mt-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-medium text-orange-900">
                  Données importées depuis formulaire visa.
                </div>
              )}
              {selected.archived_at && (
                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">
                  Client archivé le {fmtDate(selected.archived_at)}. {selected.archive_reason || ""}
                </div>
              )}
              <p className="text-xs text-muted-foreground">{selected.email || "—"}</p>
              </CardHeader>
              <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
              <QuickActions phone={selected.phone} email={selected.email} passport={selected.passport_number} className="mb-4" />
              <div className="mb-4">
                <OperationChecklistPanel
                  title="Checklist opérationnelle client"
                  description="Tâches opérationnelles liées aux réservations et dossiers de ce client."
                  customerId={selected.id}
                  compact
                />
              </div>
              <div className="mb-4 rounded-xl border border-border bg-muted/20 p-3 text-xs">
                <p className="mb-2 font-semibold uppercase text-muted-foreground">Informations personnelles</p>
                <div className="grid grid-cols-2 gap-2">
                  <div><p className="text-muted-foreground">Situation</p><p className="font-medium">{professionalSituationLabel(clientProfessionalSituation(selected))}</p></div>
                  <div><p className="text-muted-foreground">Profession / activité exacte</p><p className="font-medium">{selected.profession || "—"}</p></div>
                  <div><p className="text-muted-foreground">État civil</p><p className="font-medium">{maritalStatusLabel(selected.marital_status) || "—"}</p></div>
                  <div><p className="text-muted-foreground">Naissance</p><p className="font-medium">{selected.birthdate ? fmtDate(selected.birthdate) : "—"}</p></div>
                  <div><p className="text-muted-foreground">Âge</p><p className="font-medium">{calculateAge(selected.birthdate) ?? "—"}</p></div>
                  <div className="col-span-2"><p className="text-muted-foreground">Adresse</p><p className="whitespace-pre-wrap font-medium">{selected.address || "—"}</p></div>
                  <div><p className="text-muted-foreground">Ville</p><p className="font-medium">{selected.city || "—"}</p></div>
                  <div><p className="text-muted-foreground">Pays</p><p className="font-medium">{selected.country || "—"}</p></div>
                </div>
              </div>
              {Object.keys(selectedPassportOcr).length > 0 && (
                <details className="mb-4 rounded-xl border border-border bg-muted/20 p-3 text-xs">
                  <summary className="cursor-pointer font-semibold uppercase text-muted-foreground">Données passeport OCR</summary>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div><p className="text-muted-foreground">Passeport</p><p className="font-medium">{selectedPassportOcr.passport_number || "—"}</p></div>
                    <div><p className="text-muted-foreground">CIN</p><p className="font-medium">{selectedPassportOcr.cin || selectedPassportOcr.national_id_number || "—"}</p></div>
                    <div><p className="text-muted-foreground">Émission</p><p className="font-medium">{selectedPassportOcr.passport_issue_date ? fmtDate(selectedPassportOcr.passport_issue_date) : "—"}</p></div>
                    <div><p className="text-muted-foreground">Expiration</p><p className="font-medium">{selectedPassportOcr.passport_expiry_date ? fmtDate(selectedPassportOcr.passport_expiry_date) : "—"}</p></div>
                    <div><p className="text-muted-foreground">Lieu de naissance</p><p className="font-medium">{selectedPassportOcr.place_of_birth || "—"}</p></div>
                    <div><p className="text-muted-foreground">Autorité</p><p className="font-medium">{selectedPassportOcr.passport_authority || "—"}</p></div>
                    <div className="col-span-2"><p className="text-muted-foreground">Profession OCR</p><p className="font-medium">{selectedPassportOcr.profession || asRecord(selected.metadata).ocr_profession_source || "—"}</p></div>
                    <div className="col-span-2"><p className="text-muted-foreground">Résidence OCR</p><p className="whitespace-pre-wrap font-medium">{[selectedPassportOcr.residence_address, selectedPassportOcr.residence_city, selectedPassportOcr.residence_country].filter(Boolean).join(", ") || "—"}</p></div>
                  </div>
                </details>
              )}
              <div className="mb-4 rounded-xl border border-border bg-muted/20 p-3 text-xs">
                <p className="mb-2 font-semibold uppercase text-muted-foreground">Passeport</p>
                <div className="grid grid-cols-2 gap-2">
                  <div><p className="text-muted-foreground">N° passeport</p><p className="font-medium">{selected.passport_number || selected.passport_no || selectedPassportOcr.passport_number || "—"}</p></div>
                  <div><p className="text-muted-foreground">Nationalité</p><p className="font-medium">{selected.nationality || selectedPassportOcr.nationality || "—"}</p></div>
                  <div><p className="text-muted-foreground">Naissance</p><p className="font-medium">{selected.birthdate ? fmtDate(selected.birthdate) : selectedPassportOcr.birthdate ? fmtDate(selectedPassportOcr.birthdate) : "—"}</p></div>
                  <div><p className="text-muted-foreground">Sexe</p><p className="font-medium">{selected.sex || selectedPassportOcr.sex || "—"}</p></div>
                  <div><p className="text-muted-foreground">Émission</p><p className="font-medium">{selected.passport_issue_date ? fmtDate(selected.passport_issue_date) : selectedPassportOcr.passport_issue_date ? fmtDate(selectedPassportOcr.passport_issue_date) : "—"}</p></div>
                  <div><p className="text-muted-foreground">Expiration</p><p className="font-medium">{selected.passport_expiry ? fmtDate(selected.passport_expiry) : selectedPassportOcr.passport_expiry_date ? fmtDate(selectedPassportOcr.passport_expiry_date) : "—"}</p></div>
                  <div><p className="text-muted-foreground">CIN</p><p className="font-medium">{selected.national_id_no || selectedPassportOcr.cin || selectedPassportOcr.national_id_number || "—"}</p></div>
                  <div><p className="text-muted-foreground">Autorité</p><p className="font-medium">{selected.passport_issuing_authority || selected.passport_place_of_issue || selectedPassportOcr.passport_authority || "—"}</p></div>
                  {selected.passport_file_path && (
                    <div className="col-span-2"><p className="text-muted-foreground">Image passeport</p><p className="truncate font-mono text-[10px]">{selected.passport_file_path}</p></div>
                  )}
                </div>
              </div>
              {checkPassportExpiry(selected.passport_expiry).warning && (
                <div className="mb-4 flex items-start gap-2 rounded-xl border border-orange-300 bg-orange-50 p-3 text-xs text-orange-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{checkPassportExpiry(selected.passport_expiry).warning}</p>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2 mb-4 text-center">
                <div className="rounded-lg bg-muted p-2">
                  <p className="text-[10px] uppercase text-muted-foreground">Voyages</p>
                  <p className="font-display text-lg">{selected.trips_completed ?? 0}</p>
                </div>
                <div className="rounded-lg bg-muted p-2">
                  <p className="text-[10px] uppercase text-muted-foreground">Palier</p>
                  <p className="font-display text-sm pt-1">{tierLabel(selected.loyalty_tier)}</p>
                </div>
                <div className="rounded-lg bg-muted p-2">
                  <p className="text-[10px] uppercase text-muted-foreground">Récomp. utilisées</p>
                  <p className="font-display text-lg">{selected.rewards_used ?? 0}</p>
                </div>
              </div>
              <Button size="sm" variant="outline" className="w-full min-h-11 mb-4" onClick={() => { setEdit(selected); setOpen(true); }}>Modifier la fiche</Button>

              {identityConflicts.length > 0 && (
                <div className="mb-4 flex items-start gap-2 rounded-xl border border-orange-300 bg-orange-50 p-3 text-xs text-orange-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-semibold">Doublon potentiel à valider</p>
                    <p>{identityConflicts.length} rapprochement(s) ambigu(s) ont été laissés sans fusion automatique.</p>
                  </div>
                </div>
              )}

              <div className="mb-4 rounded-xl border border-border bg-muted/20 p-3 text-xs">
                <p className="mb-2 font-semibold uppercase text-muted-foreground">Relations CRM</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <div><p className="text-muted-foreground">Réservations</p><p className="font-display text-lg">{history.length}</p></div>
                  <div><p className="text-muted-foreground">Voyages</p><p className="font-display text-lg">{relatedTripCount}</p></div>
                  <div><p className="text-muted-foreground">Participants</p><p className="font-display text-lg">{clientParticipants.length}</p></div>
                  <div><p className="text-muted-foreground">Dossiers visa</p><p className="font-display text-lg">{clientVisas.length}</p></div>
                  <div><p className="text-muted-foreground">Devis FIT</p><p className="font-display text-lg">{clientFitQuotes.length}</p></div>
                </div>
              </div>

              <div className="mb-4">
                <Label className="text-xs mb-2 block">Historique des voyages</Label>
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {history.length === 0 && <p className="text-xs text-muted-foreground">Aucune réservation.</p>}
                  {history.map((h: any) => {
                    const tripTitle = h.trips?.season || h.trips?.title || "Voyage";
                    const start = h.trips?.start_date ? fmtDate(h.trips.start_date) : null;
                    const extras = (h.booking_extras ?? []).map((e: any) => `${e.name_snapshot}${e.qty > 1 ? ` ×${e.qty}` : ""}`).join(", ");
                    return (
                      <Link key={h.id} to={`/admin/bookings/${h.id}`} className="block rounded-lg bg-muted p-3 text-xs transition-colors hover:bg-muted/70">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium">{tripTitle}{start ? ` — ${start}` : ""}</p>
                          <span className="text-[10px] uppercase text-muted-foreground">{h.status}</span>
                        </div>
                        <p className="text-muted-foreground mt-1">
                          {fmtMAD(h.paid_amount_mad)} payés / {fmtMAD(h.total_amount_mad)}
                        </p>
                        {extras && <p className="text-muted-foreground mt-1 truncate">Extras : {extras}</p>}
                        <p className="text-muted-foreground mt-1">Inscription : {fmtDate(h.created_at)}</p>
                      </Link>
                    );
                  })}
                </div>
              </div>

              <div className="mb-4">
                <Label className="text-xs mb-2 block">Participants liés</Label>
                <div className="space-y-2 max-h-52 overflow-y-auto">
                  {clientParticipants.length === 0 && <p className="text-xs text-muted-foreground">Aucun participant lié.</p>}
                  {clientParticipants.map((participant: any) => (
                    <Link key={participant.id} to={`/admin/bookings/${participant.booking_id}`} className="block rounded-lg bg-muted p-3 text-xs transition-colors hover:bg-muted/70">
                      <div className="flex justify-between gap-2">
                        <p className="font-medium">{[participant.first_name, participant.last_name].filter(Boolean).join(" ") || "Participant"}</p>
                        {participant.is_lead && <span className="text-[10px] uppercase text-muted-foreground">Responsable</span>}
                      </div>
                      <p className="text-muted-foreground">Réservation liée · {fmtDate(participant.created_at)}</p>
                    </Link>
                  ))}
                </div>
              </div>

              <div className="mb-4">
                <Label className="text-xs mb-2 block">Paiements</Label>
                <div className="space-y-2 max-h-52 overflow-y-auto">
                  {clientPayments.length === 0 && <p className="text-xs text-muted-foreground">Aucun paiement lié.</p>}
                  {clientPayments.map((payment: any) => (
                    <Link key={payment.id} to={`/admin/bookings/${payment.booking_id}`} className="block rounded-lg bg-muted p-3 text-xs transition-colors hover:bg-muted/70">
                      <div className="flex justify-between gap-2">
                        <p className="font-medium">{fmtMAD(payment.amount_mad)}</p>
                        <span className="text-muted-foreground">{payment.status}</span>
                      </div>
                      <p className="text-muted-foreground">{payment.bookings?.reference || "Réservation"} · {fmtDate(payment.paid_at || payment.created_at)}</p>
                    </Link>
                  ))}
                </div>
              </div>

              <div className="mb-4">
                <Label className="text-xs mb-2 block">Demandes visa</Label>
                <div className="space-y-2 max-h-52 overflow-y-auto">
                  {clientVisas.length === 0 && <p className="text-xs text-muted-foreground">Aucune demande visa liée.</p>}
                  {clientVisas.map((visa: any) => (
                    <Link key={visa.id} to={`/admin/visa/${visa.id}`} className="block rounded-lg bg-muted p-3 text-xs transition-colors hover:bg-muted/70">
                      <div className="flex justify-between gap-2">
                        <p className="font-medium">{visa.reference || "Dossier visa"}</p>
                        <span className="text-muted-foreground">{visa.status}</span>
                      </div>
                      <p className="text-muted-foreground">Créé le {fmtDate(visa.created_at)}</p>
                    </Link>
                  ))}
                </div>
              </div>

              <div className="mb-4">
                <Label className="text-xs mb-2 block">Devis FIT</Label>
                <div className="space-y-2 max-h-52 overflow-y-auto">
                  {clientFitQuotes.length === 0 && <p className="text-xs text-muted-foreground">Aucun devis FIT lié.</p>}
                  {clientFitQuotes.map((quote: any) => (
                    <Link key={quote.id} to={`/admin/fit-quotes?quote=${quote.id}`} className="block rounded-lg bg-muted p-3 text-xs transition-colors hover:bg-muted/70">
                      <div className="flex justify-between gap-2">
                        <p className="font-medium">{quote.quote_number || "Devis FIT"}</p>
                        <span className="text-muted-foreground">{quote.status}</span>
                      </div>
                      <p className="text-muted-foreground">
                        {quote.travelers_count ?? 1} voyageur(s)
                        {quote.travel_start_date ? ` · ${fmtDate(quote.travel_start_date)}` : ""}
                      </p>
                    </Link>
                  ))}
                </div>
              </div>

              <div className="mb-4">
                <Label className="text-xs mb-2 block">Documents</Label>
                <div className="space-y-2 max-h-52 overflow-y-auto">
                  {clientDocuments.length === 0 && !selected.passport_file_path && <p className="text-xs text-muted-foreground">Aucun document lié.</p>}
                  {selected.passport_file_path && (
                    <div className="rounded-lg bg-muted p-3 text-xs">
                      <p className="font-medium">Scan passeport</p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">{selected.passport_file_path}</p>
                    </div>
                  )}
                  {clientDocuments.map((doc: any) => (
                    <div key={doc.id} className="rounded-lg bg-muted p-3 text-xs">
                      <p className="font-medium">{doc.title || doc.number || doc.file_name || doc.kind || doc.document_type}</p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">{doc.storage_path}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mb-4">
                <Label className="text-xs mb-2 block">Récompenses</Label>
                <div className="space-y-2 mb-2">
                  {rewards.length === 0 && <p className="text-xs text-muted-foreground">Aucune récompense.</p>}
                  {rewards.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted p-2 text-xs">
                      <div>
                        <p className="font-medium">{r.label}</p>
                        <p className="text-muted-foreground capitalize">{r.status}</p>
                      </div>
                      {r.status === "available" && (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => markRewardUsed(r.id)}>Utiliser</Button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <Button size="sm" variant="outline" className="text-[10px] h-7" onClick={() => grantReward("discount")}>-10%</Button>
                  <Button size="sm" variant="outline" className="text-[10px] h-7" onClick={() => grantReward("free_activity")}>Activité</Button>
                  <Button size="sm" variant="outline" className="text-[10px] h-7" onClick={() => grantReward("vip_upgrade")}>VIP</Button>
                </div>
              </div>

              <div className="space-y-3 mb-4">
                <Label className="text-xs">Nouvelle note</Label>
                <Textarea rows={3} value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Appel, RDV, demande spécifique…" />
                <Button size="sm" onClick={addNote} className="w-full">Ajouter</Button>
              </div>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {notes.length === 0 && <p className="text-xs text-muted-foreground">Aucune note.</p>}
                {notes.map((n) => (
                  <div key={n.id} className="rounded-lg bg-muted p-3 text-xs">
                    <p className="text-foreground/80">{n.body}</p>
                    <p className="text-muted-foreground mt-1">{fmtDate(n.created_at)}</p>
                  </div>
                ))}
              </div>
              </CardContent>
            </motion.div>
          )}
        </Card>
      </div>

      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce client ?</AlertDialogTitle>
            <AlertDialogDescription>
              Si <strong>{confirmDelete?.full_name}</strong> n'a aucun historique commercial, comptable ou visa,
              la fiche sera supprimée. Sinon elle sera archivée pour protéger les réservations, paiements,
              reçus, devis, factures et dossiers visa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={deleteClient} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Confirmer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
