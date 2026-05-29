import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Building2,
  CheckCircle2,
  Eye,
  Loader2,
  Mail,
  Phone,
  RefreshCw,
  Search,
  ShieldOff,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/admin/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type PartnerRequestStatus = "new" | "contacted" | "qualified" | "rejected" | "converted";

type PartnerRequestRow = {
  id: string;
  agency_name: string;
  manager_name: string | null;
  email: string | null;
  phone: string | null;
  city_country: string | null;
  website_social: string | null;
  partnership_type: string | null;
  message: string | null;
  status: PartnerRequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ConversionResponse = {
  ok?: boolean;
  organization_id?: string | null;
  onboarding_case_id?: string | null;
  user_id?: string | null;
  member_id?: string | null;
  organization_status?: string | null;
  email_sent?: boolean | null;
  temporary_password?: string | null;
  temp_password?: string | null;
  password?: string | null;
  warnings?: unknown[];
  error?: string;
  [key: string]: unknown;
};

type DbClient = {
  from: (table: string) => any;
};

const db = supabase as unknown as DbClient;

const PARTNER_REQUEST_COLUMNS = [
  "id",
  "agency_name",
  "manager_name",
  "email",
  "phone",
  "city_country",
  "website_social",
  "partnership_type",
  "message",
  "status",
  "reviewed_by",
  "reviewed_at",
  "deleted_at",
  "deleted_by",
  "created_at",
  "updated_at",
].join(",");

const STATUS_LABELS: Record<PartnerRequestStatus, string> = {
  new: "Nouvelle",
  contacted: "Contactée",
  qualified: "Qualifiée",
  rejected: "Rejetée",
  converted: "Convertie",
};

const STATUSES: PartnerRequestStatus[] = ["new", "contacted", "qualified", "rejected", "converted"];

const statusBadgeClass = (status: PartnerRequestStatus) =>
  ({
    new: "border-blue-200 bg-blue-50 text-blue-700",
    contacted: "border-amber-200 bg-amber-50 text-amber-800",
    qualified: "border-emerald-200 bg-emerald-50 text-emerald-700",
    rejected: "border-red-200 bg-red-50 text-red-700",
    converted: "border-stone-200 bg-stone-50 text-stone-700",
  })[status];

const isMissingTableError = (message: string) =>
  /partner_requests|schema cache|relation .* does not exist|could not find/i.test(message);

export default function PartnerRequestsAdmin() {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const [rows, setRows] = useState<PartnerRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | PartnerRequestStatus>("all");
  const [showDeleted, setShowDeleted] = useState(false);
  const [selected, setSelected] = useState<PartnerRequestRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PartnerRequestRow | null>(null);
  const [conversionResponse, setConversionResponse] = useState<ConversionResponse | null>(null);

  const load = async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    let request = db
      .from("partner_requests")
      .select(PARTNER_REQUEST_COLUMNS)
      .order("created_at", { ascending: false, nullsFirst: false });

    if (!showDeleted) request = request.is("deleted_at", null);

    const { data, error: loadError } = await request;

    if (loadError) {
      const message = loadError.message ?? "Impossible de charger les demandes partenaires.";
      setError(
        isMissingTableError(message)
          ? "La table public.partner_requests est introuvable ou non accessible. Vérifiez que la migration Partner Requests est appliquée dans Lovable/Supabase."
          : message
      );
      setRows([]);
    } else {
      setRows((data ?? []) as PartnerRequestRow[]);
    }

    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [isAdmin, showDeleted]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (!needle) return true;
      return [row.agency_name, row.manager_name, row.email, row.phone]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [query, rows, statusFilter]);

  const counts = useMemo(
    () => ({
      total: rows.length,
      visible: filteredRows.length,
      deleted: rows.filter((row) => row.deleted_at).length,
    }),
    [filteredRows.length, rows]
  );

  const selectRow = (row: PartnerRequestRow) => {
    setSelected(row);
    setConversionResponse(null);
  };

  const updateLocalRow = (updated: PartnerRequestRow) => {
    setRows((current) => current.map((row) => (row.id === updated.id ? updated : row)));
    setSelected((current) => (current?.id === updated.id ? updated : current));
  };

  const updateStatus = async (status: PartnerRequestStatus) => {
    if (!selected || !user) return;
    setBusy(true);

    const { data, error: updateError } = await db
      .from("partner_requests")
      .update({
        status,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", selected.id)
      .select(PARTNER_REQUEST_COLUMNS)
      .single();

    if (updateError) {
      toast.error(updateError.message ?? "Impossible de mettre à jour le statut.");
    } else {
      updateLocalRow(data as PartnerRequestRow);
      toast.success("Statut mis à jour.");
    }

    setBusy(false);
  };

  const softDelete = async () => {
    if (!deleteTarget || !user || !isSuperAdmin) return;
    setBusy(true);

    const { data, error: deleteError } = await db
      .from("partner_requests")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: user.id,
      })
      .eq("id", deleteTarget.id)
      .select(PARTNER_REQUEST_COLUMNS)
      .single();

    if (deleteError) {
      toast.error(deleteError.message ?? "Impossible de supprimer la demande.");
    } else {
      const updated = data as PartnerRequestRow;
      if (showDeleted) updateLocalRow(updated);
      else {
        setRows((current) => current.filter((row) => row.id !== updated.id));
        if (selected?.id === updated.id) setSelected(null);
      }
      toast.success("Demande supprimée.");
    }

    setDeleteTarget(null);
    setBusy(false);
  };

  const convertRequest = async () => {
    if (!selected) return;
    setBusy(true);
    setConversionResponse(null);

    const { data, error: functionError } = await supabase.functions.invoke("convert-partner-request", {
      body: { partner_request_id: selected.id },
    });

    if (functionError) {
      const response = {
        ok: false,
        error: functionError.message ?? "Edge Function returned a non-2xx status code.",
      };
      setConversionResponse(response);
      toast.error(response.error);
      setBusy(false);
      return;
    }

    const response = (data ?? {}) as ConversionResponse;
    setConversionResponse(response);

    if (response.ok === false) {
      toast.error(response.error || "Conversion incomplète. Consultez la réponse brute.");
    } else if (!response.organization_id || !response.onboarding_case_id || !response.user_id || !response.member_id) {
      toast.error("Conversion partielle. Certains identifiants sont manquants.");
    } else {
      toast.success("Dossier d'onboarding créé.");
      await updateStatus("converted");
    }

    setBusy(false);
  };

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
          <ShieldOff className="h-6 w-6 text-muted-foreground" />
        </div>
        <h2 className="font-display text-xl">Accès refusé</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Les demandes partenaires sont réservées à l'équipe interne.
        </p>
      </div>
    );
  }

  const temporaryPassword = conversionResponse?.temporary_password || conversionResponse?.temp_password || conversionResponse?.password;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Demandes partenaires"
        description="Demandes reçues depuis /devenir-partenaire. Conversion manuelle uniquement."
        action={
          <Button variant="outline" onClick={load} disabled={loading} className="min-h-11">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Actualiser
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Total</p>
          <p className="mt-1 text-2xl font-semibold">{counts.total}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Affichées</p>
          <p className="mt-1 text-2xl font-semibold">{counts.visible}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Supprimées</p>
          <p className="mt-1 text-2xl font-semibold">{counts.deleted}</p>
        </Card>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher par agence, responsable, email ou téléphone"
              className="min-h-11 pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
            <SelectTrigger className="min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              {STATUSES.map((status) => (
                <SelectItem key={status} value={status}>{STATUS_LABELS[status]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm">
            <Checkbox checked={showDeleted} onCheckedChange={(checked) => setShowDeleted(Boolean(checked))} />
            Afficher supprimées
          </label>
        </div>
      </Card>

      {error && (
        <Card className="border-amber-200 bg-amber-50 p-5 text-amber-950">
          <h2 className="font-semibold">Demandes partenaires indisponibles</h2>
          <p className="mt-1 text-sm">{error}</p>
        </Card>
      )}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement…
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-12 text-center">
            <Building2 className="mx-auto h-10 w-10 text-muted-foreground" />
            <h2 className="mt-3 font-display text-xl">Aucune demande</h2>
            <p className="mt-1 text-sm text-muted-foreground">Ajustez les filtres ou attendez une nouvelle demande partenaire.</p>
          </div>
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agence</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Créée le</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((row) => (
                    <TableRow key={row.id} className={row.deleted_at ? "opacity-60" : ""}>
                      <TableCell>
                        <div className="font-medium">{row.agency_name}</div>
                        <div className="text-xs text-muted-foreground">{row.city_country || "—"}</div>
                      </TableCell>
                      <TableCell>
                        <div>{row.manager_name || "—"}</div>
                        <div className="text-xs text-muted-foreground">{row.email || row.phone || ""}</div>
                      </TableCell>
                      <TableCell>{row.partnership_type || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn(statusBadgeClass(row.status))}>
                          {STATUS_LABELS[row.status] ?? row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmtDateTime(row.created_at)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => selectRow(row)}>
                            <Eye className="h-3.5 w-3.5" />
                            Détail
                          </Button>
                          {isSuperAdmin && !row.deleted_at && (
                            <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(row)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="divide-y md:hidden">
              {filteredRows.map((row) => (
                <div key={row.id} className={cn("space-y-3 p-4", row.deleted_at && "opacity-60")}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold">{row.agency_name}</h2>
                      <p className="text-xs text-muted-foreground">{row.manager_name || row.email || "—"}</p>
                    </div>
                    <Badge variant="outline" className={cn(statusBadgeClass(row.status))}>
                      {STATUS_LABELS[row.status]}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{row.partnership_type || "Type non renseigné"}</p>
                  <p className="text-xs text-muted-foreground">{fmtDateTime(row.created_at)}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => selectRow(row)}>Détail</Button>
                    {isSuperAdmin && !row.deleted_at && (
                      <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(row)}>
                        Supprimer
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="flex max-h-[92vh] flex-col overflow-hidden sm:max-w-4xl">
          <DialogHeader className="shrink-0">
            <DialogTitle>{selected?.agency_name ?? "Demande partenaire"}</DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="grid gap-4 md:grid-cols-2">
                <Card className="p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Responsable</p>
                  <p className="mt-1 font-semibold">{selected.manager_name || "—"}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Statut</p>
                  <div className="mt-2">
                    <Select value={selected.status} onValueChange={(value) => updateStatus(value as PartnerRequestStatus)} disabled={busy || Boolean(selected.deleted_at)}>
                      <SelectTrigger className="min-h-11">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((status) => (
                          <SelectItem key={status} value={status}>{STATUS_LABELS[status]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </Card>
                <Card className="p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Email</p>
                  <p className="mt-1 font-medium">{selected.email || "—"}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Téléphone</p>
                  <p className="mt-1 font-medium">{selected.phone || "—"}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Ville / pays</p>
                  <p className="mt-1 font-medium">{selected.city_country || "—"}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Site / réseaux</p>
                  <p className="mt-1 break-all font-medium">{selected.website_social || "—"}</p>
                </Card>
                <Card className="p-4 md:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Type de partenariat</p>
                  <p className="mt-1 font-medium">{selected.partnership_type || "—"}</p>
                </Card>
                <Card className="p-4 md:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Message</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">{selected.message || "—"}</p>
                </Card>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {selected.email && (
                  <Button asChild variant="outline">
                    <a href={`mailto:${selected.email}`}>
                      <Mail className="h-4 w-4" />
                      Email
                    </a>
                  </Button>
                )}
                {selected.phone && (
                  <Button asChild variant="outline">
                    <a href={`https://wa.me/${selected.phone.replace(/[^+\d]/g, "")}`} target="_blank" rel="noreferrer">
                      <Phone className="h-4 w-4" />
                      WhatsApp / Call
                    </a>
                  </Button>
                )}
                {selected.status !== "converted" && !selected.deleted_at && (
                  <Button onClick={convertRequest} disabled={busy} className="min-h-10">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                    Créer dossier d'onboarding
                  </Button>
                )}
                {selected.status === "converted" && (
                  <Badge variant="outline" className="border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700">
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                    Dossier converti
                  </Badge>
                )}
              </div>

              {conversionResponse && (
                <Card className="mt-5 p-4">
                  <div className="flex items-start gap-3">
                    <Archive className="mt-0.5 h-5 w-5 text-accent" />
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold">Réponse conversion</h3>
                      <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                        <p><span className="text-muted-foreground">organization_id:</span> {String(conversionResponse.organization_id ?? "—")}</p>
                        <p><span className="text-muted-foreground">onboarding_case_id:</span> {String(conversionResponse.onboarding_case_id ?? "—")}</p>
                        <p><span className="text-muted-foreground">user_id:</span> {String(conversionResponse.user_id ?? "—")}</p>
                        <p><span className="text-muted-foreground">member_id:</span> {String(conversionResponse.member_id ?? "—")}</p>
                        <p><span className="text-muted-foreground">organization_status:</span> {String(conversionResponse.organization_status ?? "—")}</p>
                        <p><span className="text-muted-foreground">email_sent:</span> {String(conversionResponse.email_sent ?? "—")}</p>
                      </div>
                      {temporaryPassword && (
                        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                          Email non envoyé. Mot de passe provisoire à communiquer manuellement:{" "}
                          <span className="font-mono font-semibold">{temporaryPassword}</span>
                        </div>
                      )}
                      <pre className="mt-4 max-h-72 overflow-auto rounded-md bg-secondary p-3 text-xs text-muted-foreground">
                        {JSON.stringify(conversionResponse, null, 2)}
                      </pre>
                    </div>
                  </div>
                </Card>
              )}
            </div>
          )}

          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => setSelected(null)}>Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette demande ?</AlertDialogTitle>
            <AlertDialogDescription>
              La demande sera masquée par défaut via soft delete. Aucune organisation ou donnée liée ne sera supprimée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={softDelete} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
