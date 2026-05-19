import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/admin/components/PageHeader";
import { format } from "date-fns";
import { ArrowRight, ChevronDown, Search, X, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { QuickActions } from "@/admin/components/QuickActions";

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

export default function VisaApplications() {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [confirmDelete, setConfirmDelete] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = () => {
    supabase.from("visa_applications")
      .select("id, reference, status, surname, given_names, passport_no, residential_email, submitted_at, created_at")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) toast.error(error.message);
        else setItems(data ?? []);
      });
  };
  useEffect(() => { reload(); }, []);

  const doDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    // Remove related documents first to avoid orphaned files
    const { data: docs } = await supabase.from("visa_documents").select("storage_path").eq("application_id", confirmDelete.id);
    if (docs?.length) {
      const paths = docs.map((d: any) => d.storage_path).filter(Boolean);
      if (paths.length) await supabase.storage.from("visa-docs").remove(paths);
      await supabase.from("visa_documents").delete().eq("application_id", confirmDelete.id);
    }
    const { error } = await supabase.from("visa_applications").delete().eq("id", confirmDelete.id);
    setDeleting(false);
    if (error) return toast.error(error.message);
    toast.success("Demande supprimée");
    setConfirmDelete(null);
    reload();
  };

  const filtered = items.filter((it) => {
    if (status !== "all" && it.status !== status) return false;
    if (from && new Date(it.created_at) < new Date(from)) return false;
    if (to && new Date(it.created_at) > new Date(to + "T23:59:59")) return false;
    if (q) {
      const s = q.toLowerCase();
      const match = [it.reference, it.surname, it.given_names, it.passport_no, it.residential_email]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(s));
      if (!match) return false;
    }
    return true;
  });

  const hasFilters = status !== "all" || from || to || q;
  const reset = () => { setStatus("all"); setFrom(""); setTo(""); setQ(""); };

  return (
    <div>
      <PageHeader title="Demandes de visa" description="Toutes les demandes des clients" />

      <Card className="p-4 mb-4">
        <div className="grid gap-3 md:grid-cols-12 items-end">
          <div className="md:col-span-5">
            <label className="text-xs text-muted-foreground mb-1 block">Recherche</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9 min-h-11" type="search" enterKeyHint="search" placeholder="Nom, référence, passeport, email…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          <div className="md:col-span-3">
            <label className="text-xs text-muted-foreground mb-1 block">Statut</label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                {Object.entries(STATUS_LABEL).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-muted-foreground mb-1 block">Du</label>
            <Input className="min-h-11" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-muted-foreground mb-1 block">Au</label>
            <Input className="min-h-11" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        {hasFilters && (
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
            <span className="text-sm text-muted-foreground">{filtered.length} résultat(s)</span>
            <Button variant="ghost" size="sm" onClick={reset}><X className="w-3.5 h-3.5" /> Réinitialiser</Button>
          </div>
        )}
      </Card>

      <div className="space-y-2">
        {filtered.length === 0 && <p className="text-muted-foreground p-4">Aucune demande.</p>}
        {filtered.map((it) => (
          <Card key={it.id} className="overflow-hidden hover:border-accent transition-colors">
            <details className="group md:hidden">
              <summary className="list-none p-4 cursor-pointer">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-semibold">{it.reference}</span>
                      <Badge variant={it.status === "draft" ? "outline" : it.status === "rejected" ? "destructive" : "secondary"}>
                        {STATUS_LABEL[it.status]}
                      </Badge>
                    </div>
                    <p className="text-sm truncate">
                      {[it.surname, it.given_names].filter(Boolean).join(" ") || "—"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{it.residential_email || "—"}</p>
                  </div>
                  <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                </div>
                <QuickActions email={it.residential_email} passport={it.passport_no} compact className="mt-3" />
              </summary>
              <div className="grid grid-cols-2 gap-3 border-t border-border p-4 text-sm">
                <div><p className="text-xs text-muted-foreground">Passeport</p><p className="font-medium">{it.passport_no || "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Créée</p><p className="font-medium">{format(new Date(it.created_at), "dd/MM/yyyy")}</p></div>
                <div className="col-span-2"><p className="text-xs text-muted-foreground">Soumise</p><p className="font-medium">{it.submitted_at ? format(new Date(it.submitted_at), "dd/MM/yyyy") : "—"}</p></div>
                <Link to={`/admin/visa/${it.id}`} className="col-span-2 inline-flex h-11 items-center justify-center rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground">
                  Ouvrir la demande
                </Link>
              </div>
            </details>

            <div className="hidden md:flex p-4 items-center justify-between">
              <Link to={`/admin/visa/${it.id}`} className="min-w-0 flex-1">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold">{it.reference}</span>
                    <Badge variant={it.status === "draft" ? "outline" : it.status === "rejected" ? "destructive" : "secondary"}>
                      {STATUS_LABEL[it.status]}
                    </Badge>
                  </div>
                  <p className="text-sm">
                    {[it.surname, it.given_names].filter(Boolean).join(" ") || "—"}
                    {it.passport_no && <span className="text-muted-foreground"> · {it.passport_no}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {it.residential_email} · créée le {format(new Date(it.created_at), "dd/MM/yyyy")}
                    {it.submitted_at && ` · soumise le ${format(new Date(it.submitted_at), "dd/MM/yyyy")}`}
                  </p>
                </div>
              </Link>
              <div className="flex items-center gap-2 shrink-0 ml-3">
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmDelete(it); }}
                  aria-label="Supprimer la demande"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
              <ArrowRight className="w-5 h-5 text-muted-foreground" />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette demande de visa ?</AlertDialogTitle>
            <AlertDialogDescription>
              La demande <strong>{confirmDelete?.reference}</strong> et tous ses documents associés seront
              supprimés définitivement. La fiche client liée n'est pas affectée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? "Suppression…" : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
