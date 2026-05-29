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
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { LoyaltyBadge, tierLabel } from "../components/LoyaltyBadge";
import { QuickActions } from "../components/QuickActions";
import { PassportScannerDialog, type PassportOcrFields } from "../components/PassportScannerDialog";
import { checkPassportExpiry } from "@/lib/passport-mrz";
import { exportCsv } from "@/admin/lib/export-csv";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const empty = {
  full_name: "", email: "", phone: "", city: "", country: "Maroc", source: "",
  passport_number: "", passport_expiry: "", passport_issue_date: "", birthdate: "",
  nationality: "", sex: "", passport_file_path: "", profession: "", marital_status: "", address: "",
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
const CLIENT_SELECT = "id, full_name, email, phone, city, country, source, passport_number, passport_expiry, birthdate, nationality, sex, passport_issue_date, passport_file_path, profession, marital_status, address, last_trip_label, loyalty_tier, is_returning, trips_completed, rewards_used, created_at";

const MARITAL_STATUS_OPTIONS = [
  { value: "celibataire", label: "Célibataire" },
  { value: "marie", label: "Marié(e)" },
  { value: "divorce", label: "Divorcé(e)" },
  { value: "veuf", label: "Veuf/veuve" },
];

const maritalStatusLabel = (value?: string | null) =>
  MARITAL_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value ?? "";

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

const fadeIn = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.22, ease: "easeOut" },
};

export default function Clients() {
  const { user, isAdmin, isSuperAdmin, session } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [professionFilter, setProfessionFilter] = useState("");
  const [maritalFilter, setMaritalFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("");
  const [ageFilter, setAgeFilter] = useState("");
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

  const fetchClients = async () => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    console.log("[CRM Clients] Supabase URL utilisée", supabaseUrl);
    const { data, error } = await supabase
      .from("clients")
      .select(CLIENT_SELECT)
      .order("created_at", { ascending: false })
      .limit(150);
    console.log("[CRM Clients] fetchClients result", { data, error, count: data?.length ?? 0, query: q, professionFilter, maritalFilter, cityFilter, ageFilter });
    if (error) {
      toast.error(error.message);
      setRows([]);
      return;
    }
    const search = q.trim().toLowerCase();
    const profession = professionFilter.trim().toLowerCase();
    const city = cityFilter.trim().toLowerCase();
    const age = ageFilter.trim() ? Number(ageFilter) : null;
    const filtered = (data ?? []).filter((c: any) => {
      const haystack = [c.full_name, c.email, c.phone, c.city, c.profession, c.passport_number]
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
    console.log("[CRM Clients] clients après filtre", { filteredCount: filtered.length, rawCount: data?.length ?? 0, query: q, professionFilter, maritalFilter, cityFilter, ageFilter });
    setRows(filtered);
  };
  useEffect(() => { fetchClients(); }, [q, professionFilter, maritalFilter, cityFilter, ageFilter]);

  const selectedRows = useMemo(() => rows.filter((row) => selectedIds.has(row.id)), [rows, selectedIds]);
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
    const [{ data: n }, { data: r }, { data: h }] = await Promise.all([
      supabase.from("client_notes").select("*").eq("client_id", c.id).order("created_at", { ascending: false }),
      supabase.from("client_rewards" as any).select("*").eq("client_id", c.id).order("created_at", { ascending: false }),
      supabase
        .from("bookings")
        .select("id, reference, status, total_amount_mad, paid_amount_mad, created_at, trip_id, trips:trip_id(title, season, start_date), booking_extras(name_snapshot, qty)")
        .eq("client_id", c.id)
        .order("created_at", { ascending: false }),
    ]);
    setNotes(n ?? []);
    setRewards((r as any) ?? []);
    setHistory((h as any) ?? []);
  };

  const save = async () => {
    const payload = normalizeClientDateFields(edit);
    console.log("CLIENT INSERT PAYLOAD", { table: "public.clients", payload });
    console.log("[CRM Clients] save client payload", { table: "public.clients", payload });
    const result = payload.id
      ? await supabase.from("clients").update(payload).eq("id", payload.id).select("*").single()
      : await supabase.from("clients").insert(payload).select("*").single();
    console.log("[CRM Clients] save client result", result);
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
    setEdit((current: any) => ({
      ...current,
      full_name: fields.full_name || [fields.first_name, fields.last_name].filter(Boolean).join(" ") || current.full_name,
      passport_number: fields.passport_no || current.passport_number,
      passport_expiry: fields.passport_expiry || current.passport_expiry,
      passport_issue_date: fields.passport_issue_date || current.passport_issue_date,
      birthdate: fields.date_of_birth || current.birthdate,
      nationality: fields.nationality || current.nationality,
      sex: fields.sex || current.sex,
    }));
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

  const useReward = async (id: string) => {
    const { error } = await supabase.from("client_rewards" as any)
      .update({ status: "used", used_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(error.message);
    if (selected) {
      await supabase.from("clients").update({ rewards_used: (selected.rewards_used ?? 0) + 1 }).eq("id", selected.id);
    }
    openClient(selected);
  };

  const deleteClient = async () => {
    if (!confirmDelete) return;
    const { error } = await supabase.from("clients").delete().eq("id", confirmDelete.id);
    if (error) return toast.error(error.message);
    toast.success("Client supprimé");
    if (selected?.id === confirmDelete.id) setSelected(null);
    setConfirmDelete(null);
    fetchClients();
  };

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
              {isAdmin && (
                <Button type="button" variant="outline" className="h-11 w-full justify-center" onClick={() => setScannerOpen(true)}>
                  <FileScan className="h-4 w-4" /> Scanner passeport
                </Button>
              )}
              <div className="space-y-4">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Informations personnelles</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2"><Label>Nom complet</Label><Input value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></div>
                <div><Label>Profession</Label><Input value={edit.profession ?? ""} onChange={(e) => setEdit({ ...edit, profession: e.target.value })} placeholder="Ingénieur, médecin…" /></div>
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
                <div><Label>N° Passeport</Label><Input autoCapitalize="characters" value={edit.passport_number ?? ""} onChange={(e) => setEdit({ ...edit, passport_number: e.target.value })} /></div>
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
              {isAdmin && (
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
            <span className="text-xs text-muted-foreground">{selectedRows.length} sélectionné(s)</span>
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
                  <div><p className="text-xs text-muted-foreground">Voyage</p><p className="font-medium">{c.last_trip_label ?? "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Ville</p><p className="font-medium">{c.city ?? "—"}</p></div>
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
                      </div>
                      {(c.profession || c.marital_status) && (
                        <p className="mt-1 text-xs font-normal text-muted-foreground">
                          {[c.profession, maritalStatusLabel(c.marital_status)].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </td>
                    <td className="p-4 text-xs leading-5 text-muted-foreground">{c.email || "—"}<br/>{c.phone || "—"}</td>
                    <td className="p-4 text-xs">{c.last_trip_label ?? "—"}</td>
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
              <p className="text-xs text-muted-foreground">{selected.email || "—"}</p>
              </CardHeader>
              <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
              <QuickActions phone={selected.phone} email={selected.email} passport={selected.passport_number} className="mb-4" />
              <div className="mb-4 rounded-xl border border-border bg-muted/20 p-3 text-xs">
                <p className="mb-2 font-semibold uppercase text-muted-foreground">Informations personnelles</p>
                <div className="grid grid-cols-2 gap-2">
                  <div><p className="text-muted-foreground">Profession</p><p className="font-medium">{selected.profession || "—"}</p></div>
                  <div><p className="text-muted-foreground">État civil</p><p className="font-medium">{maritalStatusLabel(selected.marital_status) || "—"}</p></div>
                  <div><p className="text-muted-foreground">Naissance</p><p className="font-medium">{selected.birthdate ? fmtDate(selected.birthdate) : "—"}</p></div>
                  <div><p className="text-muted-foreground">Âge</p><p className="font-medium">{calculateAge(selected.birthdate) ?? "—"}</p></div>
                  <div className="col-span-2"><p className="text-muted-foreground">Adresse</p><p className="whitespace-pre-wrap font-medium">{selected.address || "—"}</p></div>
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
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => useReward(r.id)}>Utiliser</Button>
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
              Cette action est définitive. La fiche de <strong>{confirmDelete?.full_name}</strong> ainsi
              que ses notes et récompenses seront supprimées. Les réservations liées seront conservées
              mais détachées du client.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={deleteClient} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
